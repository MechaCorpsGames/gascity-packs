import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createProductionBoundary, GatewayDispatchError } from './boundary.js'

const routePrefix = '/api/gas-city/v1'

export interface ConnectionSummary {
  id: string
  label: string
  cities: string[]
  available: boolean
  diagnostic?: string
}

export interface ConnectionInventory {
  connections: ConnectionSummary[]
}

export interface HostBoundary {
  inventory(): Promise<ConnectionInventory>
  refresh?(): Promise<ConnectionInventory>
  proxy?(request: GatewayRequest): Promise<Response>
}

export interface CredentialExecInfo {
  version: 'gascity.dev/client-auth/v1'
  spec: { server_url: string; city: string; interactive: false }
}

export interface CredentialResult {
  token: string
  expirationTimestamp: string
}

export interface GrantInfo {
  version: 'gascity.dev/city-write-grant/v1'
  aud: 'gc-city-write'
  city: string
  method: string
  path: string
  canonical_query: string
  body_sha256: string
  req_digest: string
}

export interface ProviderRequest {
  audience: string
  required_scopes: string[]
  org: string
  force_refresh: boolean
}

export interface ProviderCredential {
  accessToken: string
  authorizationScheme: 'Bearer'
  expiresAt: string
  audience: string
  scopes: string[]
}

export interface AuthHelperBoundary {
  credential(command: string, info: CredentialExecInfo): Promise<CredentialResult>
  grant(command: string, info: GrantInfo): Promise<string>
  provider(request: ProviderRequest): Promise<ProviderCredential>
}

export interface GatewayRequest {
  connectionId: string
  city?: string
  method: string
  path: string
  query: string
  headers: Record<string, string>
  body?: string
}

export interface Config {
  gcHome?: string
  fetch?: typeof globalThis.fetch
  helpers?: AuthHelperBoundary
  /** Test seam and future embedding boundary. Normal profile composition omits it. */
  boundary?: HostBoundary
}

export const inject = ['webServer']

function writeJson(response: Parameters<WebRoute['handler']>[1], status: number, value: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function writeProblem(
  response: Parameters<WebRoute['handler']>[1],
  status: number,
  title: string,
  detail: string,
  code?: string,
): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/problem+json; charset=utf-8')
  response.end(JSON.stringify({
    type: 'urn:gastownhall:deepseek-harness-ui:invalid-request',
    title,
    status,
    detail,
    ...(code === undefined ? {} : { code }),
  }))
}

const responseHeaders = [
  'content-type',
  'cache-control',
  'retry-after',
  'x-gc-index',
  'x-gc-request-id',
  'gc-session-state',
  'gc-session-status',
] as const

async function relayResponse(
  upstream: Response,
  response: Parameters<WebRoute['handler']>[1],
): Promise<void> {
  response.statusCode = upstream.status
  for (const name of responseHeaders) {
    const value = upstream.headers.get(name)
    if (value !== null) response.setHeader(name, value)
  }
  if (upstream.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
    response.setHeader('X-Accel-Buffering', 'no')
    if (!response.hasHeader('Cache-Control')) response.setHeader('Cache-Control', 'no-cache')
  }
  if (upstream.body === null) {
    response.end()
    return
  }
  await pipeline(Readable.fromWeb(upstream.body as never), response)
}

interface ReadRoute {
  suffix: string
  upstreamSuffix: string
  query: readonly string[]
  sse?: boolean
}

const cityReadRoutes: readonly ReadRoute[] = [
  { suffix: 'events/stream', upstreamSuffix: 'events/stream', query: ['after_seq'], sse: true },
  { suffix: 'config', upstreamSuffix: 'config', query: [] },
  { suffix: 'rigs', upstreamSuffix: 'rigs', query: [] },
  { suffix: 'agents', upstreamSuffix: 'agents', query: ['rig'] },
  { suffix: 'providers/public', upstreamSuffix: 'providers/public', query: [] },
  { suffix: 'sessions', upstreamSuffix: 'sessions', query: ['cursor', 'limit', 'state', 'template', 'peek'] },
] as const

const sessionReadRoutes: readonly ReadRoute[] = [
  { suffix: '', upstreamSuffix: '', query: ['peek', 'peek_lines'] },
  { suffix: 'transcript', upstreamSuffix: 'transcript', query: ['tail', 'format', 'include_thinking', 'before', 'after'] },
  { suffix: 'pending', upstreamSuffix: 'pending', query: [] },
  { suffix: 'stream', upstreamSuffix: 'stream', query: ['format', 'include_thinking', 'after_cursor'], sse: true },
] as const

interface MutationRoute {
  method: 'PATCH' | 'POST'
  suffix: string
  query: readonly string[]
  jsonFields?: readonly string[]
  jsonValidator?: (value: Readonly<Record<string, unknown>>) => boolean
}

function isOptionalString(value: Readonly<Record<string, unknown>>, key: string): boolean {
  return value[key] === undefined || typeof value[key] === 'string'
}

function isStringMap(value: unknown): boolean {
  return value !== null
    && !Array.isArray(value)
    && typeof value === 'object'
    && Object.values(value).every(item => typeof item === 'string')
}

function isSessionCreateBody(value: Readonly<Record<string, unknown>>): boolean {
  return value.kind === 'agent'
    && typeof value.name === 'string'
    && value.name.length > 0
    && ['alias', 'session_name', 'message', 'project_id', 'title'].every(key => isOptionalString(value, key))
    && (value.async === undefined || typeof value.async === 'boolean')
    && (value.options === undefined || isStringMap(value.options))
}

function isSessionPatchBody(value: Readonly<Record<string, unknown>>): boolean {
  return isOptionalString(value, 'alias')
    && (value.title === undefined || (typeof value.title === 'string' && value.title.length > 0))
}

function isSessionSubmitBody(value: Readonly<Record<string, unknown>>): boolean {
  return typeof value.message === 'string'
    && /\S/.test(value.message)
    && (value.intent === undefined || ['default', 'follow_up', 'interrupt_now'].includes(value.intent as string))
}

function isSessionRespondBody(value: Readonly<Record<string, unknown>>): boolean {
  return typeof value.action === 'string'
    && value.action.length > 0
    && isOptionalString(value, 'request_id')
    && isOptionalString(value, 'text')
    && (value.metadata === undefined || isStringMap(value.metadata))
}

const sessionMutationRoutes: readonly MutationRoute[] = [
  { method: 'PATCH', suffix: '', query: [], jsonFields: ['title', 'alias'], jsonValidator: isSessionPatchBody },
  { method: 'POST', suffix: 'submit', query: [], jsonFields: ['message', 'intent'], jsonValidator: isSessionSubmitBody },
  { method: 'POST', suffix: 'respond', query: [], jsonFields: ['request_id', 'action', 'text', 'metadata'], jsonValidator: isSessionRespondBody },
  {
    method: 'POST',
    suffix: 'permission-mode',
    query: [],
    jsonFields: ['permission_mode'],
    jsonValidator: value => typeof value.permission_mode === 'string' && /\S/.test(value.permission_mode),
  },
  {
    method: 'POST',
    suffix: 'rename',
    query: [],
    jsonFields: ['title'],
    jsonValidator: value => typeof value.title === 'string' && value.title.length > 0,
  },
  { method: 'POST', suffix: 'stop', query: [] },
  { method: 'POST', suffix: 'kill', query: [] },
  { method: 'POST', suffix: 'suspend', query: [] },
  { method: 'POST', suffix: 'close', query: ['delete'] },
  { method: 'POST', suffix: 'wake', query: [] },
] as const

interface MappedGatewayRequest extends GatewayRequest {
  jsonFields?: readonly string[]
  jsonValidator?: (value: Readonly<Record<string, unknown>>) => boolean
  bodyForbidden?: boolean
}

const queryValidators: Record<string, (value: string) => boolean> = {
  rig: value => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value),
  cursor: value => value.length <= 4096 && !/[\p{Cc}]/u.test(value),
  limit: value => /^\d{1,4}$/.test(value) && Number(value) <= 1000,
  state: value => value.length <= 128 && !/[\p{Cc}]/u.test(value),
  template: value => value.length <= 512 && !/[\p{Cc}]/u.test(value),
  peek: value => value === 'true' || value === 'false',
  peek_lines: value => /^\d{1,5}$/.test(value) && Number(value) <= 10_000,
  tail: value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)),
  format: value => value === 'conversation' || value === 'raw' || value === 'structured',
  include_thinking: value => value === 'true' || value === 'false',
  before: value => value.length <= 2048 && !/[\p{Cc}]/u.test(value),
  after: value => value.length <= 2048 && !/[\p{Cc}]/u.test(value),
  after_cursor: value => value.length <= 2048 && !/[\p{Cc}]/u.test(value),
  after_seq: value => /^\d+$/.test(value) && value.length <= 20,
  delete: value => value === 'true' || value === 'false',
}

function hasOnlyQueryKeys(url: URL, allowed: readonly string[]): boolean {
  const keys = new Set(url.searchParams.keys())
  return [...keys].every(key => allowed.includes(key))
    && [...keys].every(key => url.searchParams.getAll(key).length === 1)
    && [...keys].every((key) => {
      const value = url.searchParams.get(key)
      const validate = queryValidators[key]
      return value !== null && validate !== undefined && validate(value)
    })
}

function mapGatewayRequest(
  method: string | undefined,
  url: URL,
  requestHeaders: Parameters<WebRoute['handler']>[0]['headers'],
): MappedGatewayRequest | 'invalid' | undefined {
  const identifier = '[A-Za-z0-9][A-Za-z0-9._-]*'
  const connectionIdentifier = '[A-Za-z0-9._-]+'
  const supervisor = new RegExp(`^${routePrefix}/connections/(${connectionIdentifier})/(health|cities)$`).exec(url.pathname)
  if (supervisor !== null) {
    if (method !== 'GET') return undefined
    const connectionId = supervisor[1]
    const operation = supervisor[2]
    if (connectionId === undefined || operation === undefined) return undefined
    if (!hasOnlyQueryKeys(url, [])) return 'invalid'
    return {
      connectionId,
      method: 'GET',
      path: operation === 'health' ? '/health' : '/v0/cities',
      query: '',
      headers: {},
    }
  }

  const cityMatch = new RegExp(
    `^${routePrefix}/connections/(${connectionIdentifier})/city/(${identifier})/(.+)$`,
  ).exec(url.pathname)
  if (cityMatch === null) return undefined
  const connectionId = cityMatch[1]
  const city = cityMatch[2]
  const suffix = cityMatch[3]
  if (connectionId === undefined || city === undefined || suffix === undefined) return undefined
  if (method === 'POST' && suffix === 'sessions') {
    if (!hasOnlyQueryKeys(url, [])) return 'invalid'
    return {
      connectionId,
      city,
      method,
      path: `/v0/city/${encodeURIComponent(city)}/sessions`,
      query: '',
      headers: {},
      jsonFields: ['kind', 'name', 'alias', 'session_name', 'message', 'async', 'options', 'project_id', 'title'],
      jsonValidator: isSessionCreateBody,
    } satisfies MappedGatewayRequest
  }

  const cityRoute = method === 'GET' ? cityReadRoutes.find(route => route.suffix === suffix) : undefined
  if (cityRoute !== undefined) {
    if (!hasOnlyQueryKeys(url, cityRoute.query)) return 'invalid'
    const headers: Record<string, string> = cityRoute.sse
      ? { accept: 'text/event-stream', 'accept-encoding': 'identity' }
      : {}
    const lastEventId = requestHeaders['last-event-id']
    if (cityRoute.sse && typeof lastEventId === 'string') headers['last-event-id'] = lastEventId
    return {
      connectionId,
      city,
      method: 'GET',
      path: `/v0/city/${encodeURIComponent(city)}/${cityRoute.upstreamSuffix}`,
      query: url.searchParams.toString(),
      headers,
    }
  }

  const session = new RegExp(`^session/(${identifier})(?:/(.+))?$`).exec(suffix)
  if (session === null) return undefined
  const sessionId = session[1]
  const sessionSuffix = session[2] ?? ''
  if (sessionId === undefined) return undefined
  const basePath = `/v0/city/${encodeURIComponent(city)}/session/${encodeURIComponent(sessionId)}`
  if (method === 'GET') {
    const sessionRoute = sessionReadRoutes.find(route => route.suffix === sessionSuffix)
    if (sessionRoute === undefined) return undefined
    if (!hasOnlyQueryKeys(url, sessionRoute.query)) return 'invalid'
    const headers: Record<string, string> = sessionRoute.sse
      ? { accept: 'text/event-stream', 'accept-encoding': 'identity' }
      : {}
    const lastEventId = requestHeaders['last-event-id']
    if (sessionRoute.sse && typeof lastEventId === 'string') headers['last-event-id'] = lastEventId
    const upstreamSuffix = sessionRoute.upstreamSuffix === '' ? '' : `/${sessionRoute.upstreamSuffix}`
    return {
      connectionId,
      city,
      method,
      path: `${basePath}${upstreamSuffix}`,
      query: url.searchParams.toString(),
      headers,
    }
  }
  const mutation = sessionMutationRoutes.find(route => route.method === method && route.suffix === sessionSuffix)
  if (mutation === undefined) return undefined
  if (!hasOnlyQueryKeys(url, mutation.query)) return 'invalid'
  return {
    connectionId,
    city,
    method: mutation.method,
    path: `${basePath}${mutation.suffix === '' ? '' : `/${mutation.suffix}`}`,
    query: url.searchParams.toString(),
    headers: {},
    ...(mutation.jsonFields === undefined
      ? { bodyForbidden: true }
      : {
          jsonFields: mutation.jsonFields,
          ...(mutation.jsonValidator === undefined ? {} : { jsonValidator: mutation.jsonValidator }),
        }),
  }
}

async function readAllowedJson(
  request: Parameters<WebRoute['handler']>[0],
  fields: readonly string[],
  validate: ((value: Readonly<Record<string, unknown>>) => boolean) | undefined,
): Promise<string | undefined> {
  const contentType = request.headers['content-type']?.toLowerCase().replaceAll(' ', '')
  if (contentType !== 'application/json' && contentType !== 'application/json;charset=utf-8') return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 1024 * 1024) return undefined
    chunks.push(buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
    if (Object.keys(value).some(key => !fields.includes(key))) return undefined
    if (validate !== undefined && !validate(value as Record<string, unknown>)) return undefined
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

async function materializeGatewayRequest(
  mapped: MappedGatewayRequest,
  request: Parameters<WebRoute['handler']>[0],
): Promise<GatewayRequest | undefined> {
  if (mapped.bodyForbidden === true) {
    if ((request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')
      || request.headers['transfer-encoding'] !== undefined) return undefined
    const { bodyForbidden: _bodyForbidden, ...gatewayRequest } = mapped
    return gatewayRequest
  }
  if (mapped.jsonFields === undefined) return mapped
  const body = await readAllowedJson(request, mapped.jsonFields, mapped.jsonValidator)
  if (body === undefined) return undefined
  const { jsonFields: _jsonFields, jsonValidator: _jsonValidator, ...gatewayRequest } = mapped
  return {
    ...gatewayRequest,
    headers: { ...gatewayRequest.headers, 'content-type': 'application/json' },
    body,
  }
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isTrustedRequest(request: Parameters<WebRoute['handler']>[0]): boolean {
  const host = request.headers.host
  if (host === undefined) return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function isCanonicalRequestTarget(raw: string, parsed: URL): boolean {
  if (!raw.startsWith('/') || raw.includes('\\') || raw.includes('#')) return false
  const queryOffset = raw.indexOf('?')
  const rawPath = queryOffset === -1 ? raw : raw.slice(0, queryOffset)
  if (rawPath !== parsed.pathname) return false
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== '%') continue
    const escape = raw.slice(index + 1, index + 3)
    if (!/^[0-9A-F]{2}$/.test(escape)) return false
    index += 2
  }
  return true
}

function gatewayFailure(error: unknown): { status: number; title: string; detail: string } {
  const message = error instanceof Error ? error.message : ''
  if (message === 'Unknown Gas City connection') {
    return { status: 404, title: 'Gas City connection not found', detail: message }
  }
  if (/^(?:multiple exact GC access profiles|city .+ has multiple incompatible GC access profiles)/.test(message)) {
    return { status: 409, title: 'Gas City access profile conflict', detail: message }
  }
  return {
    status: 502,
    title: 'Gas City Supervisor request failed',
    detail: 'Supervisor request failed; check GC authentication, TLS, and connectivity',
  }
}

function safeConfigurationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/^GC contexts (?:file (?:ownership|permissions)|path)/.test(message)) return message
  return 'GC configuration could not be loaded; run the pack doctor for details'
}

export function apply(ctx: Context, config: Config = {}): void {
  if (ctx.webServer.host !== '127.0.0.1') {
    throw new Error('Gas City workspace requires the DSH web server to bind to loopback')
  }
  const boundary = config.boundary ?? createProductionBoundary({
    ...(config.gcHome === undefined ? {} : { gcHome: config.gcHome }),
    ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    ...(config.helpers === undefined ? {} : { helpers: config.helpers }),
  })
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: routePrefix,
      async handler(request, response) {
        if (!isTrustedRequest(request)) {
          writeJson(response, 403, { error: 'Forbidden' })
          return
        }
        const rawTarget = request.url ?? '/'
        const url = new URL(rawTarget, 'http://localhost')
        if (!isCanonicalRequestTarget(rawTarget, url)) {
          writeProblem(response, 400, 'Invalid request', 'The request target is not in canonical form')
          return
        }
        if (request.method === 'GET' && url.pathname === `${routePrefix}/connections`) {
          try {
            writeJson(response, 200, await boundary.inventory())
          } catch (error) {
            writeProblem(
              response,
              500,
              'Gas City configuration error',
              safeConfigurationFailure(error),
            )
          }
          return
        }
        if (request.method === 'POST' && url.pathname === `${routePrefix}/refresh`) {
          if (url.search !== '') {
            writeProblem(response, 400, 'Invalid request', 'The refresh route does not accept query parameters')
            return
          }
          try {
            writeJson(response, 200, boundary.refresh === undefined
              ? await boundary.inventory()
              : await boundary.refresh())
          } catch (error) {
            writeProblem(
              response,
              500,
              'Gas City configuration error',
              safeConfigurationFailure(error),
            )
          }
          return
        }
        const mapped = mapGatewayRequest(request.method, url, request.headers)
        if (mapped === 'invalid') {
          writeProblem(response, 400, 'Invalid request', 'The request contains a query key this route does not accept')
          return
        }
        if (mapped !== undefined && boundary.proxy !== undefined) {
          const gatewayRequest = await materializeGatewayRequest(mapped, request)
          if (gatewayRequest === undefined) {
            writeProblem(response, 400, 'Invalid request', 'The request body or content type is not accepted by this route')
            return
          }
          let upstreamReceived = false
          try {
            const upstream = await boundary.proxy(gatewayRequest)
            upstreamReceived = true
            await relayResponse(upstream, response)
          } catch (error) {
            if (response.headersSent) {
              response.destroy()
              return
            }
            const failure = gatewayFailure(error)
            const mutationOutcomeUnknown = mapped.method !== 'GET'
              && failure.status === 502
              && (upstreamReceived || error instanceof GatewayDispatchError)
            writeProblem(
              response,
              failure.status,
              failure.title,
              failure.detail,
              ...(mutationOutcomeUnknown ? ['outcome_unknown'] : []),
            )
          }
          return
        }
        writeProblem(response, 404, 'Not found', 'No Gas City browser API route matches this request')
      },
    }),
    'deepseek-harness-ui: /api/gas-city/v1 route',
  )
}
