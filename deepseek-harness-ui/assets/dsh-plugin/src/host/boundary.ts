import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { parse } from 'smol-toml'
import { Agent, type Dispatcher } from 'undici'
import type {
  ConnectionInventory,
  ConnectionSummary,
  AuthHelperBoundary,
  GatewayRequest,
  HostBoundary,
} from './index.js'
import { ProcessAuthHelpers } from './helpers.js'

export class GatewayDispatchError extends Error {
  constructor(cause: unknown) {
    super('Supervisor transport failed after dispatch began', { cause })
    this.name = 'GatewayDispatchError'
  }
}

interface AccessProfile {
  name: string
  endpoint: string
  city?: string
  credentialCommand?: string
  credentialAudience?: string
  credentialRequiredScopes: string[]
  credentialOrg?: string
  grantCommand?: string
  caFile?: string
  tlsServerName?: string
  insecureSkipVerify: boolean
  timeout?: string
}

interface ConnectionGroup {
  id: string
  endpoint: string
  profiles: AccessProfile[]
}

export interface ProductionBoundaryOptions {
  gcHome?: string
  fetch?: typeof globalThis.fetch
  helpers?: AuthHelperBoundary
}

const contextName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`GC context ${key} must be a string`)
  return value
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new Error(`GC context ${key} must be a boolean`)
  return value
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`GC context ${key} must be an array of strings`)
  }
  return [...value] as string[]
}

function isLoopback(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function canonicalEndpoint(raw: string): string {
  if (raw.trim() !== raw || raw.includes('\\')) throw new Error('GC context URL is not canonical')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('GC context URL is invalid')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('GC context URL must not include credentials, query, or fragment')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('GC context URL scheme must be https or loopback http')
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new Error('GC context URL permits http only for loopback')
  }
  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
  return `${url.origin}${pathname}`
}

function connectionId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('base64url').slice(0, 24)
}

function validateCredentialValue(value: string): boolean {
  return value.length > 0
    && value.length <= 512
    && !/[\s\p{Cc}]/u.test(value)
}

function accessProfile(raw: unknown): AccessProfile {
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') {
    throw new Error('GC context entry must be a table')
  }
  const record = raw as Record<string, unknown>
  const name = stringField(record, 'name')
  const url = stringField(record, 'url')
  const city = stringField(record, 'city')
  if (name === undefined || !contextName.test(name)) throw new Error('GC context name is invalid')
  if (url === undefined) throw new Error(`GC context ${name} URL is required`)
  if (city !== undefined && !contextName.test(city)) throw new Error(`GC context ${name} city is invalid`)
  const credentialCommand = stringField(record, 'credential_command')
  const credentialAudience = stringField(record, 'credential_audience')
  const credentialRequiredScopes = stringArrayField(record, 'credential_required_scopes')
  const credentialOrg = stringField(record, 'credential_org')
  const providerConfigured = credentialAudience !== undefined
    || credentialRequiredScopes.length > 0
    || credentialOrg !== undefined
  if (providerConfigured) {
    if (credentialCommand !== undefined || credentialAudience === undefined || credentialRequiredScopes.length === 0) {
      throw new Error(`GC context ${name} credential provider tuple is invalid`)
    }
    const values = [credentialAudience, ...credentialRequiredScopes, ...(credentialOrg === undefined ? [] : [credentialOrg])]
    if (values.some(value => !validateCredentialValue(value))) {
      throw new Error(`GC context ${name} credential provider tuple is invalid`)
    }
    if (new Set(credentialRequiredScopes).size !== credentialRequiredScopes.length) {
      throw new Error(`GC context ${name} credential provider scopes contain duplicates`)
    }
  }
  const effectiveCity = city ?? name
  const grantCommand = stringField(record, 'grant_command')
  const caFile = stringField(record, 'ca_file')
  const tlsServerName = stringField(record, 'tls_server_name')
  const timeout = stringField(record, 'timeout')
  return {
    name,
    endpoint: canonicalEndpoint(url),
    city: effectiveCity,
    ...(credentialCommand === undefined ? {} : { credentialCommand }),
    ...(credentialAudience === undefined ? {} : { credentialAudience }),
    credentialRequiredScopes,
    ...(credentialOrg === undefined ? {} : { credentialOrg }),
    ...(grantCommand === undefined ? {} : { grantCommand }),
    ...(caFile === undefined ? {} : { caFile }),
    ...(tlsServerName === undefined ? {} : { tlsServerName }),
    insecureSkipVerify: booleanField(record, 'insecure_skip_verify'),
    ...(timeout === undefined ? {} : { timeout }),
  }
}

async function parseTomlFile(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = parse(await readFile(path, 'utf8'))
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('TOML root must be a table')
    return parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

async function assertPrivateContextFile(path: string): Promise<void> {
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('GC contexts path is not a regular file')
    const getuid = process.getuid
    if (getuid !== undefined && info.uid !== getuid()) {
      throw new Error('GC contexts file ownership is unsafe')
    }
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
      throw new Error('GC contexts file permissions must be owner-only')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

async function loadProfiles(gcHome: string): Promise<AccessProfile[]> {
  const contextsPath = join(gcHome, 'contexts.toml')
  await assertPrivateContextFile(contextsPath)
  const contexts = await parseTomlFile(contextsPath)
  const rawContexts = contexts.context ?? []
  if (!Array.isArray(rawContexts)) throw new Error('GC contexts.toml context must be an array of tables')
  const profiles = rawContexts.map(accessProfile)
  const names = new Set<string>()
  for (const profile of profiles) {
    if (names.has(profile.name)) throw new Error(`duplicate GC context name ${profile.name}`)
    names.add(profile.name)
  }
  const defaultName = contexts.default
  if (defaultName !== undefined && (typeof defaultName !== 'string' || !names.has(defaultName))) {
    throw new Error('GC default context is not defined')
  }

  const supervisor = await parseTomlFile(join(gcHome, 'supervisor.toml'))
  const section = supervisor.supervisor
  if (section !== undefined && (section === null || Array.isArray(section) || typeof section !== 'object')) {
    throw new Error('GC supervisor config must contain a supervisor table')
  }
  const supervisorSection = (section ?? {}) as Record<string, unknown>
  const bind = stringField(supervisorSection, 'bind') ?? '127.0.0.1'
  const rawPort = supervisorSection.port
  if (rawPort !== undefined && (!Number.isInteger(rawPort) || (rawPort as number) < 1 || (rawPort as number) > 65535)) {
    throw new Error('GC supervisor port is invalid')
  }
  const port = rawPort === undefined ? 8372 : rawPort as number
  const localHost = bind === '0.0.0.0' ? '127.0.0.1' : bind
  if (!isLoopback(localHost)) throw new Error('GC local Supervisor bind is not loopback')
  profiles.push({
    name: 'Local Supervisor',
    endpoint: canonicalEndpoint(`http://${localHost === '::1' ? '[::1]' : localHost}:${port}`),
    credentialRequiredScopes: [],
    insecureSkipVerify: false,
  })
  return profiles
}

function groupProfiles(profiles: AccessProfile[]): ConnectionGroup[] {
  const groups = new Map<string, ConnectionGroup>()
  for (const profile of profiles) {
    let group = groups.get(profile.endpoint)
    if (group === undefined) {
      group = { id: connectionId(profile.endpoint), endpoint: profile.endpoint, profiles: [] }
      groups.set(profile.endpoint, group)
    }
    group.profiles.push(profile)
  }
  return [...groups.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function profileFingerprint(profile: AccessProfile): string {
  return JSON.stringify({
    city: profile.city ?? '',
    credentialCommand: profile.credentialCommand ?? '',
    credentialAudience: profile.credentialAudience ?? '',
    credentialRequiredScopes: [...profile.credentialRequiredScopes].sort(),
    credentialOrg: profile.credentialOrg ?? '',
    grantCommand: profile.grantCommand ?? '',
    caFile: profile.caFile ?? '',
    tlsServerName: profile.tlsServerName ?? '',
    insecureSkipVerify: profile.insecureSkipVerify,
    timeout: profile.timeout ?? '',
  })
}

function selectProfile(group: ConnectionGroup, city?: string): AccessProfile {
  if (city !== undefined) {
    const exact = group.profiles.filter(profile => profile.city === city)
    if (exact.length === 1) return exact[0] as AccessProfile
    if (exact.length > 1) throw new Error(`multiple exact GC access profiles match city ${city}`)
  }
  const byFingerprint = new Map<string, AccessProfile>()
  for (const profile of group.profiles) byFingerprint.set(profileFingerprint(profile), profile)
  if (byFingerprint.size !== 1) {
    throw new Error(city === undefined
      ? 'Supervisor-wide probe has multiple incompatible GC access profiles'
      : `city ${city} has multiple incompatible GC access profiles`)
  }
  return [...byFingerprint.values()][0] as AccessProfile
}

function safeProbeDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/multiple (?:exact|incompatible) GC access profiles|Supervisor-wide probe has multiple incompatible/.test(message)) {
    return message
  }
  const status = /^(health|cities) returned \d{3}$/.exec(message)
  if (status !== null) return status[0]
  return 'Supervisor probe failed; check GC authentication and connectivity'
}

function validateGrantToken(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return false
  if (!/^[A-Za-z0-9_-]+$/.test(parts[0] as string) || !/^[A-Za-z0-9_-]+$/.test(parts[1] as string)) return false
  try {
    return Buffer.from(parts[1] as string, 'base64url').byteLength === 64
  } catch {
    return false
  }
}

class ProductionBoundary implements HostBoundary {
  private groups: ConnectionGroup[] | undefined
  private readonly bearerCache = new Map<string, { token: string; expiresAt: number }>()
  private readonly dispatchers = new Map<string, Agent>()

  constructor(
    private readonly gcHome: string,
    private readonly fetchFn: typeof globalThis.fetch,
    private readonly helpers: AuthHelperBoundary,
  ) {}

  private async dispatcher(profile: AccessProfile): Promise<Dispatcher | undefined> {
    if (profile.caFile === undefined && profile.tlsServerName === undefined && !profile.insecureSkipVerify) {
      return undefined
    }
    const key = profileFingerprint(profile)
    const cached = this.dispatchers.get(key)
    if (cached !== undefined) return cached
    const ca = profile.caFile === undefined ? undefined : await readFile(profile.caFile)
    const agent = new Agent({
      connect: {
        ...(ca === undefined ? {} : { ca }),
        ...(profile.tlsServerName === undefined ? {} : { servername: profile.tlsServerName }),
        rejectUnauthorized: !profile.insecureSkipVerify,
      },
    })
    this.dispatchers.set(key, agent)
    return agent
  }

  private async bearer(profile: AccessProfile, forceRefresh = false): Promise<string | undefined> {
    if (profile.credentialCommand === undefined && profile.credentialAudience === undefined) return undefined
    const city = profile.city ?? profile.name
    const key = `${profileFingerprint(profile)}\0${city}`
    const cached = this.bearerCache.get(key)
    if (!forceRefresh && cached !== undefined && Date.now() + 30_000 < cached.expiresAt) return cached.token
    if (profile.credentialCommand !== undefined) {
      const result = await this.helpers.credential(profile.credentialCommand, {
        version: 'gascity.dev/client-auth/v1',
        spec: { server_url: profile.endpoint, city, interactive: false },
      })
      const expiresAt = Date.parse(result.expirationTimestamp)
      if (result.token.trim() === '' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('credential command returned an invalid credential')
      }
      this.bearerCache.set(key, { token: result.token, expiresAt })
      return result.token
    }
    const credential = await this.helpers.provider({
      audience: profile.credentialAudience as string,
      required_scopes: [...profile.credentialRequiredScopes],
      org: profile.credentialOrg ?? '',
      force_refresh: forceRefresh,
    })
    const expiresAt = Date.parse(credential.expiresAt)
    if (credential.authorizationScheme !== 'Bearer' || credential.accessToken.trim() === ''
      || !Number.isFinite(expiresAt) || expiresAt <= Date.now()
      || credential.audience !== profile.credentialAudience
      || profile.credentialRequiredScopes.some(scope => !credential.scopes.includes(scope))) {
      throw new Error('credential provider returned an invalid credential')
    }
    this.bearerCache.set(key, { token: credential.accessToken, expiresAt })
    return credential.accessToken
  }

  private async authorizedHeaders(
    profile: AccessProfile,
    request: GatewayRequest,
    forceRefresh = false,
  ): Promise<Headers> {
    const headers = new Headers(request.headers)
    const bearer = await this.bearer(profile, forceRefresh)
    if (bearer !== undefined) headers.set('Authorization', `Bearer ${bearer}`)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      headers.set('X-GC-Request', 'true')
      if (profile.grantCommand !== undefined) {
        const body = request.body ?? ''
        const bodySHA256 = createHash('sha256').update(body).digest('hex')
        const canonicalQuery = new URLSearchParams(request.query)
        canonicalQuery.sort()
        const preimage = `${request.method}\n${request.path}`
          + (canonicalQuery.toString() === '' ? '' : `\n${canonicalQuery.toString()}`)
          + `\n${bodySHA256}`
        const grant = (await this.helpers.grant(profile.grantCommand, {
          version: 'gascity.dev/city-write-grant/v1',
          aud: 'gc-city-write',
          city: request.city ?? profile.city ?? profile.name,
          method: request.method,
          path: request.path,
          canonical_query: request.query,
          body_sha256: bodySHA256,
          req_digest: createHash('sha256').update(preimage).digest('hex'),
        })).trim()
        if (!validateGrantToken(grant)) throw new Error('write-grant helper returned a malformed token')
        headers.set('X-GC-City-Write', grant)
      }
    }
    return headers
  }

  private async perform(profile: AccessProfile, request: GatewayRequest): Promise<Response> {
    const query = request.query === '' ? '' : `?${request.query}`
    const call = async (forceRefresh: boolean): Promise<Response> => {
      const dispatcher = await this.dispatcher(profile)
      const init: RequestInit & { dispatcher?: Dispatcher } = {
        method: request.method,
        redirect: 'error',
        headers: await this.authorizedHeaders(profile, request, forceRefresh),
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(dispatcher === undefined ? {} : { dispatcher }),
      }
      try {
        return await this.fetchFn(`${profile.endpoint}${request.path}${query}`, init as RequestInit)
      } catch (cause) {
        throw new GatewayDispatchError(cause)
      }
    }
    let response = await call(false)
    const isSSE = request.headers.accept === 'text/event-stream'
    if (response.status === 401 && !isSSE
      && (profile.credentialCommand !== undefined || profile.credentialAudience !== undefined)) {
      response = await call(true)
    }
    return response
  }

  private async connectionGroups(): Promise<ConnectionGroup[]> {
    this.groups ??= groupProfiles(await loadProfiles(this.gcHome))
    return this.groups
  }

  async inventory(): Promise<ConnectionInventory> {
    const summaries: ConnectionSummary[] = []
    for (const group of await this.connectionGroups()) {
      const configuredCities = new Set(group.profiles.flatMap(profile => profile.city === undefined ? [] : [profile.city]))
      let available = false
      let diagnostic: string | undefined
      try {
        const profile = selectProfile(group)
        const health = await this.perform(profile, {
          connectionId: group.id,
          method: 'GET',
          path: '/health',
          query: '',
          headers: { accept: 'application/json' },
        })
        if (!health.ok) throw new Error(`health returned ${health.status}`)
        const cities = await this.perform(profile, {
          connectionId: group.id,
          method: 'GET',
          path: '/v0/cities',
          query: '',
          headers: { accept: 'application/json' },
        })
        if (!cities.ok) throw new Error(`cities returned ${cities.status}`)
        const body: unknown = await cities.json()
        if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
          const items = (body as { items?: unknown }).items
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
                const name = (item as { name?: unknown }).name
                if (typeof name === 'string' && contextName.test(name)) configuredCities.add(name)
              }
            }
          }
        }
        available = true
      } catch (error) {
        diagnostic = safeProbeDiagnostic(error)
      }
      summaries.push({
        id: group.id,
        label: group.profiles.map(profile => profile.name).sort().join(', '),
        cities: [...configuredCities].sort(),
        available,
        ...(diagnostic === undefined ? {} : { diagnostic }),
      })
    }
    return { connections: summaries }
  }

  async refresh(): Promise<ConnectionInventory> {
    this.groups = undefined
    return this.inventory()
  }

  async proxy(request: GatewayRequest): Promise<Response> {
    const group = (await this.connectionGroups()).find(candidate => candidate.id === request.connectionId)
    if (group === undefined) throw new Error('Unknown Gas City connection')
    const profile = selectProfile(group, request.city)
    return this.perform(profile, request)
  }
}

export function createProductionBoundary(options: ProductionBoundaryOptions = {}): HostBoundary {
  const gcHome = options.gcHome ?? process.env.GC_HOME ?? join(homedir(), '.gc')
  return new ProductionBoundary(gcHome, options.fetch ?? globalThis.fetch, options.helpers ?? new ProcessAuthHelpers())
}
