import { spawn } from 'node:child_process'
import type {
  AuthHelperBoundary,
  CredentialExecInfo,
  CredentialResult,
  GrantInfo,
  ProviderCredential,
  ProviderRequest,
} from './index.js'

const outputLimit = 64 * 1024

function environment(allowlist?: ReadonlySet<string>): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => {
    if (value === undefined) return false
    if (allowlist !== undefined) return allowlist.has(key)
    return !(key.startsWith('GC_') && key.endsWith('_INFO'))
  }))
}

async function run(
  executable: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; input?: string; timeoutMs: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      if (!settled) {
        settled = true
        reject(new Error('Gas City authentication helper timed out'))
      }
    }, options.timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes <= outputLimit) stdout.push(chunk)
      else child.kill('SIGKILL')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (stderrBytes <= outputLimit) stderr.push(chunk)
      else child.kill('SIGKILL')
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(new Error(`Gas City authentication helper failed: ${error.message}`))
      }
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (stdoutBytes > outputLimit || stderrBytes > outputLimit) {
        reject(new Error('Gas City authentication helper output exceeded its limit'))
        return
      }
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim().slice(0, 512)
        reject(new Error(`Gas City authentication helper exited ${String(code)}${detail === '' ? '' : `: ${detail}`}`))
        return
      }
      resolve(Buffer.concat(stdout).toString('utf8'))
    })
    child.stdin.end(options.input)
  })
}

function requireRecord(raw: string, subject: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new Error(`${subject} returned invalid JSON`)
  }
}

function credentialResult(raw: string): CredentialResult {
  const value = requireRecord(raw, 'credential command')
  if (typeof value.token !== 'string' || value.token.trim() === '') {
    throw new Error('credential command returned an empty token')
  }
  if (typeof value.expiration_timestamp !== 'string' || !Number.isFinite(Date.parse(value.expiration_timestamp))) {
    throw new Error('credential command returned an invalid expiration_timestamp')
  }
  return { token: value.token, expirationTimestamp: value.expiration_timestamp }
}

const providerEnvironment = new Set([
  'PATH', 'HOME', 'XDG_CONFIG_HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA',
  'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'GASWORKS_CONFIG_DIR', 'GASWORKS_STS_URL', 'GASWORKS_OIDC_ISSUER', 'GASWORKS_CLIENT_ID',
])

function providerArgv(): string[] {
  const raw = process.env.GC_CREDENTIAL_PROVIDER
  if (raw === undefined) return ['gasworks', 'credential-provider']
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.includes('\0'))) {
      throw new Error()
    }
    return value as string[]
  } catch {
    throw new Error('GC_CREDENTIAL_PROVIDER must be a non-empty JSON argv array')
  }
}

function providerCredential(raw: string, request: ProviderRequest): ProviderCredential {
  const value = requireRecord(raw, 'credential provider')
  const exactFields = new Set([
    'version', 'kind', 'access_token', 'authorization_scheme', 'expires_at', 'audience', 'scopes',
  ])
  if (Object.keys(value).some(key => !exactFields.has(key))) throw new Error('credential provider returned unknown fields')
  if (value.version !== 'gascity.dev/credential-provider/v1' || value.kind !== 'Credential') {
    throw new Error('credential provider returned an unsupported response')
  }
  if (typeof value.access_token !== 'string' || value.access_token.trim() === '' || value.authorization_scheme !== 'Bearer') {
    throw new Error('credential provider returned an invalid credential')
  }
  if (typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at))) {
    throw new Error('credential provider returned an invalid expiry')
  }
  if (value.audience !== request.audience || !Array.isArray(value.scopes) || value.scopes.some(scope => typeof scope !== 'string')) {
    throw new Error('credential provider returned the wrong audience or scopes')
  }
  const scopes = value.scopes as string[]
  if (request.required_scopes.some(scope => !scopes.includes(scope))) {
    throw new Error('credential provider omitted a required scope')
  }
  return {
    accessToken: value.access_token,
    authorizationScheme: 'Bearer',
    expiresAt: value.expires_at,
    audience: value.audience,
    scopes,
  }
}

export class ProcessAuthHelpers implements AuthHelperBoundary {
  async credential(command: string, info: CredentialExecInfo): Promise<CredentialResult> {
    const env = environment()
    env.GC_EXEC_INFO = JSON.stringify(info)
    return credentialResult(await run('sh', ['-c', command], { env, timeoutMs: 120_000 }))
  }

  async grant(command: string, info: GrantInfo): Promise<string> {
    const env = environment()
    env.GC_GRANT_INFO = JSON.stringify(info)
    return (await run('sh', ['-c', command], { env, timeoutMs: 30_000 })).trim()
  }

  async provider(request: ProviderRequest): Promise<ProviderCredential> {
    const [executable, ...args] = providerArgv()
    if (executable === undefined) throw new Error('credential provider argv is empty')
    const wireRequest = {
      version: 'gascity.dev/credential-provider/v1',
      audience: request.audience,
      required_scopes: [...request.required_scopes].sort(),
      org: request.org,
      force_refresh: request.force_refresh,
      interactive: false,
    }
    return providerCredential(await run(executable, args, {
      env: environment(providerEnvironment),
      input: JSON.stringify(wireRequest),
      timeoutMs: 10_000,
    }), request)
  }
}
