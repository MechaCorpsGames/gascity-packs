import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type Config, type HostBoundary } from '../../src/host/index.js'

interface RegisteredRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>
}

const servers: ReturnType<typeof createServer>[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })))
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function mount(
  boundary?: HostBoundary,
  config: Omit<Config, 'boundary'> = {},
): Promise<{ baseUrl: string; route: RegisteredRoute }> {
  let route: RegisteredRoute | undefined
  apply({
    effect(callback: () => unknown) {
      return callback()
    },
    webServer: {
      host: '127.0.0.1',
      register(candidate: RegisteredRoute) {
        route = candidate
        return () => undefined
      },
    },
  } as never, { ...config, ...(boundary === undefined ? {} : { boundary }) })

  if (route === undefined) throw new Error('plugin did not register a route')
  const server = createServer((request, response) => void route?.handler(request, response))
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind TCP')
  return { baseUrl: `http://127.0.0.1:${address.port}`, route }
}

async function rawRequest(baseUrl: string, path: string): Promise<{ status: number; headers: IncomingMessage['headers']; body: string }> {
  const base = new URL(baseUrl)
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: base.hostname,
      port: base.port,
      path,
      headers: { Host: base.host },
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.once('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.once('error', reject)
    request.end()
  })
}

describe('Gas City host plugin', () => {
  it('serves a secret-free connection inventory from the versioned DSH route', async () => {
    const boundary: HostBoundary = {
      inventory: vi.fn(async () => ({ connections: [] })),
    }
    const { baseUrl, route } = await mount(boundary)

    const response = await fetch(`${baseUrl}/api/gas-city/v1/connections`)

    expect(route).toMatchObject({ kind: 'prefix', path: '/api/gas-city/v1' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^application\/json\b/)
    await expect(response.json()).resolves.toEqual({ connections: [] })
    expect(boundary.inventory).toHaveBeenCalledOnce()
  })

  it('refuses to register on an all-interfaces DSH bind', () => {
    const register = vi.fn()

    expect(() => apply({
      webServer: { host: '0.0.0.0', register },
    } as never, {
      boundary: { inventory: async () => ({ connections: [] }) },
    })).toThrow(/loopback/i)
    expect(register).not.toHaveBeenCalled()
  })

  it('rejects a cross-origin browser request before discovery runs', async () => {
    const boundary: HostBoundary = {
      inventory: vi.fn(async () => ({ connections: [] })),
    }
    const { baseUrl } = await mount(boundary)

    const response = await fetch(`${baseUrl}/api/gas-city/v1/connections`, {
      headers: { Origin: 'https://attacker.example' },
    })

    expect(response.status).toBe(403)
    expect(boundary.inventory).not.toHaveBeenCalled()
  })

  it('maps an allowlisted city read and relays its status, body, and GC index', async () => {
    const proxy = vi.fn(async () => new Response('{"agents":[]}', {
      status: 206,
      headers: {
        'Content-Type': 'application/json',
        'X-GC-Index': '42',
        'X-GC-Request-Id': 'request-7',
      },
    }))
    const boundary = {
      inventory: async () => ({ connections: [] }),
      proxy,
    } as HostBoundary
    const { baseUrl } = await mount(boundary)

    const response = await fetch(`${baseUrl}/api/gas-city/v1/connections/alpha/city/acme/agents?rig=main`)

    expect(proxy).toHaveBeenCalledWith({
      connectionId: 'alpha',
      city: 'acme',
      method: 'GET',
      path: '/v0/city/acme/agents',
      query: 'rig=main',
      headers: {},
    })
    expect(response.status).toBe(206)
    expect(response.headers.get('x-gc-index')).toBe('42')
    expect(response.headers.get('x-gc-request-id')).toBe('request-7')
    await expect(response.json()).resolves.toEqual({ agents: [] })
  })

  it('returns a pack-owned problem for a query key outside the route allowlist', async () => {
    const proxy = vi.fn()
    const { baseUrl } = await mount({
      inventory: async () => ({ connections: [] }),
      proxy,
    })

    const response = await fetch(
      `${baseUrl}/api/gas-city/v1/connections/alpha/city/acme/agents?upstream_url=https://attacker.example`,
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json\b/)
    await expect(response.json()).resolves.toMatchObject({
      type: 'urn:gastownhall:deepseek-harness-ui:invalid-request',
      status: 400,
    })
    expect(proxy).not.toHaveBeenCalled()
  })

  it('enumerates the supported Supervisor and per-city read surface', async () => {
    const proxy = vi.fn(async () => new Response('{}', {
      headers: { 'Content-Type': 'application/json' },
    }))
    const { baseUrl } = await mount({
      inventory: async () => ({ connections: [] }),
      proxy,
    })
    const base = `${baseUrl}/api/gas-city/v1/connections/alpha`
    const cases = [
      [`${base}/health`, '/health', '', undefined],
      [`${base}/cities`, '/v0/cities', '', undefined],
      [`${base}/city/acme/events/stream?after_seq=41`, '/v0/city/acme/events/stream', 'after_seq=41', 'evt-40'],
      [`${base}/city/acme/rigs`, '/v0/city/acme/rigs', '', undefined],
      [`${base}/city/acme/providers/public`, '/v0/city/acme/providers/public', '', undefined],
      [`${base}/city/acme/sessions?cursor=next&limit=10&state=active&template=mayor&peek=true`, '/v0/city/acme/sessions', 'cursor=next&limit=10&state=active&template=mayor&peek=true', undefined],
      [`${base}/city/acme/session/session-1?peek=true&peek_lines=10`, '/v0/city/acme/session/session-1', 'peek=true&peek_lines=10', undefined],
      [`${base}/city/acme/session/session-1/transcript?tail=2&format=structured&include_thinking=false`, '/v0/city/acme/session/session-1/transcript', 'tail=2&format=structured&include_thinking=false', undefined],
      [`${base}/city/acme/session/session-1/pending`, '/v0/city/acme/session/session-1/pending', '', undefined],
      [`${base}/city/acme/session/session-1/stream?format=structured&after_cursor=cursor-1`, '/v0/city/acme/session/session-1/stream', 'format=structured&after_cursor=cursor-1', 'frame-9'],
    ] as const

    for (const [browserUrl, upstreamPath, query, lastEventId] of cases) {
      const response = await fetch(browserUrl, {
        headers: lastEventId === undefined ? {} : { 'Last-Event-ID': lastEventId },
      })
      expect(response.status, browserUrl).toBe(200)
      expect(proxy).toHaveBeenLastCalledWith({
        connectionId: 'alpha',
        ...(upstreamPath.startsWith('/v0/city/') ? { city: 'acme' } : {}),
        method: 'GET',
        path: upstreamPath,
        query,
        headers: lastEventId === undefined ? {} : {
          accept: 'text/event-stream',
          'accept-encoding': 'identity',
          'last-event-id': lastEventId,
        },
      })
    }
  })

  it('does not expose the Supervisor-wide event stream', async () => {
    const proxy = vi.fn()
    const { baseUrl } = await mount({
      inventory: async () => ({ connections: [] }),
      proxy,
    })

    const response = await fetch(
      `${baseUrl}/api/gas-city/v1/connections/alpha/events/stream`,
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json\b/)
    expect(proxy).not.toHaveBeenCalled()
  })

  it('maps only the enumerated session mutations with normalized JSON bodies', async () => {
    const proxy = vi.fn(async () => new Response('{"status":"accepted"}', {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    }))
    const { baseUrl } = await mount({
      inventory: async () => ({ connections: [] }),
      proxy,
    })
    const city = `${baseUrl}/api/gas-city/v1/connections/alpha/city/acme`
    const cases = [
      {
        method: 'POST',
        url: `${city}/sessions`,
        body: { kind: 'agent', name: 'mayor', message: 'Start' },
        path: '/v0/city/acme/sessions',
      },
      {
        method: 'PATCH',
        url: `${city}/session/session-1`,
        body: { title: 'New title', alias: 'primary' },
        path: '/v0/city/acme/session/session-1',
      },
      {
        method: 'POST',
        url: `${city}/session/session-1/submit`,
        body: { message: 'Continue', intent: 'follow_up' },
        path: '/v0/city/acme/session/session-1/submit',
      },
      {
        method: 'POST',
        url: `${city}/session/session-1/respond`,
        body: { request_id: 'prompt-1', action: 'allow' },
        path: '/v0/city/acme/session/session-1/respond',
      },
      {
        method: 'POST',
        url: `${city}/session/session-1/permission-mode`,
        body: { permission_mode: 'plan' },
        path: '/v0/city/acme/session/session-1/permission-mode',
      },
      {
        method: 'POST',
        url: `${city}/session/session-1/rename`,
        body: { title: 'Renamed' },
        path: '/v0/city/acme/session/session-1/rename',
      },
    ] as const

    for (const item of cases) {
      const response = await fetch(item.url, {
        method: item.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.body),
      })
      expect(response.status, item.url).toBe(202)
      expect(proxy).toHaveBeenLastCalledWith({
        connectionId: 'alpha',
        city: 'acme',
        method: item.method,
        path: item.path,
        query: '',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item.body),
      })
    }
  })

  it('rejects raw provider session creation before it reaches the Supervisor', async () => {
    const proxy = vi.fn(async () => new Response('{}'))
    const { baseUrl } = await mount({ inventory: async () => ({ connections: [] }), proxy })

    const response = await fetch(
      `${baseUrl}/api/gas-city/v1/connections/alpha/city/acme/sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'provider', name: 'claude' }),
      },
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json\b/)
    expect(proxy).not.toHaveBeenCalled()
  })

  it('rejects known JSON fields whose values violate the enumerated Supervisor schemas', async () => {
    const proxy = vi.fn(async () => new Response('{}'))
    const { baseUrl } = await mount({ inventory: async () => ({ connections: [] }), proxy })
    const city = `${baseUrl}/api/gas-city/v1/connections/alpha/city/acme`
    const cases = [
      [`${city}/sessions`, { kind: 'agent', name: 7 }],
      [`${city}/sessions`, { kind: 'agent', name: 'mayor', options: { model: 7 } }],
      [`${city}/session/session-1`, { title: '' }],
      [`${city}/session/session-1/submit`, { intent: 'default' }],
      [`${city}/session/session-1/submit`, { message: 'Continue', intent: 'later' }],
      [`${city}/session/session-1/respond`, { request_id: 'request-1' }],
      [`${city}/session/session-1/permission-mode`, { permission_mode: '' }],
      [`${city}/session/session-1/rename`, { title: '' }],
    ] as const

    for (const [url, body] of cases) {
      const response = await fetch(url, {
        method: url.endsWith('/session-1') ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(response.status, `${url} ${JSON.stringify(body)}`).toBe(400)
    }
    expect(proxy).not.toHaveBeenCalled()
  })

  it('relays SSE framing byte-for-byte while disabling upstream compression and buffering', async () => {
    const frames = ': ready\n\nid: 7\nevent: message\ndata: {"text":"hello"}\n\n'
    const proxy = vi.fn(async () => new Response(frames, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'GC-Session-State': 'active',
        'GC-Session-Status': 'running',
        'X-GC-Request-Id': 'stream-1',
      },
    }))
    const { baseUrl } = await mount({
      inventory: async () => ({ connections: [] }),
      proxy,
    })

    const response = await fetch(
      `${baseUrl}/api/gas-city/v1/connections/alpha/city/acme/session/session-1/stream?format=structured`,
      { headers: { 'Last-Event-ID': 'frame-6' } },
    )

    expect(proxy).toHaveBeenCalledWith(expect.objectContaining({
      headers: {
        accept: 'text/event-stream',
        'accept-encoding': 'identity',
        'last-event-id': 'frame-6',
      },
    }))
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    expect(response.headers.get('gc-session-state')).toBe('active')
    expect(response.headers.get('gc-session-status')).toBe('running')
    expect(response.headers.get('x-gc-request-id')).toBe('stream-1')
    await expect(response.text()).resolves.toBe(frames)
  })

  it('discovers canonical Supervisor groups without returning endpoints or helper configuration', async () => {
    const gcHome = await mkdtemp(join(tmpdir(), 'dsh-gc-home-'))
    tempDirs.push(gcHome)
    await writeFile(join(gcHome, 'contexts.toml'), `
default = "east"

[[context]]
name = "east"
url = "https://EXAMPLE.test:443/control/"
city = "alpha"
credential_command = "secret-helper --mint"

[[context]]
name = "west"
url = "https://example.test/control"
city = "beta"
credential_command = "secret-helper --mint"
`, { mode: 0o600 })
    const fetchSupervisor = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('https://example.test/control/health')) {
        return new Response('{"status":"ok"}', { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.startsWith('https://example.test/control/v0/cities')) {
        return new Response('{"items":[{"name":"alpha","running":true},{"name":"beta","running":true}]}', {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error('local Supervisor unavailable')
    }) as typeof fetch
    const { baseUrl } = await mount(undefined, { gcHome, fetch: fetchSupervisor })

    const response = await fetch(`${baseUrl}/api/gas-city/v1/connections`)
    const body = await response.json() as { connections: Array<{ label: string; cities: string[] }> }

    expect(response.status).toBe(200)
    expect(body.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'east, west', cities: ['alpha', 'beta'] }),
    ]))
    expect(JSON.stringify(body)).not.toContain('example.test')
    expect(JSON.stringify(body)).not.toContain('secret-helper')
  })

  it('fails closed when duplicate exact city access profiles match', async () => {
    const gcHome = await mkdtemp(join(tmpdir(), 'dsh-gc-home-'))
    tempDirs.push(gcHome)
    await writeFile(join(gcHome, 'contexts.toml'), `
[[context]]
name = "first"
url = "https://example.test"
city = "alpha"

[[context]]
name = "second"
url = "https://example.test"
city = "alpha"
`, { mode: 0o600 })
    const fetchSupervisor = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('https://example.test/health')) return new Response('{}')
      if (url.startsWith('https://example.test/v0/cities')) {
        return new Response('{"items":[{"name":"alpha","running":true}]}')
      }
      throw new Error('local unavailable')
    }) as typeof fetch
    const { baseUrl } = await mount(undefined, { gcHome, fetch: fetchSupervisor })
    const inventory = await fetch(`${baseUrl}/api/gas-city/v1/connections`).then(
      response => response.json() as Promise<{ connections: Array<{ id: string; label: string }> }>,
    )
    const connection = inventory.connections.find(item => item.label === 'first, second')
    expect(connection).toBeDefined()

    const response = await fetch(
      `${baseUrl}/api/gas-city/v1/connections/${connection?.id}/city/alpha/rigs`,
      { signal: AbortSignal.timeout(500) },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ detail: expect.stringMatching(/multiple exact/i) })
    expect(fetchSupervisor).toHaveBeenCalledTimes(3)
  })

  it('refreshes the host-owned GC context inventory without restarting DSH', async () => {
    const gcHome = await mkdtemp(join(tmpdir(), 'dsh-gc-home-'))
    tempDirs.push(gcHome)
    const contextsPath = join(gcHome, 'contexts.toml')
    await writeFile(contextsPath, `
[[context]]
name = "one"
url = "https://example.test"
city = "alpha"
`, { mode: 0o600 })
    const unavailable = vi.fn(async () => { throw new Error('unavailable') }) as typeof fetch
    const { baseUrl } = await mount(undefined, { gcHome, fetch: unavailable })
    const before = await fetch(`${baseUrl}/api/gas-city/v1/connections`).then(response => response.text())
    expect(before).toContain('one')
    await writeFile(contextsPath, `
[[context]]
name = "one"
url = "https://example.test"
city = "alpha"

[[context]]
name = "two"
url = "https://example.test"
city = "beta"
`, { mode: 0o600 })

    const response = await fetch(`${baseUrl}/api/gas-city/v1/refresh`, { method: 'POST' })

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('one, two')
  })

  it('keeps credential and write-grant helpers behind the host boundary', async () => {
    const gcHome = await mkdtemp(join(tmpdir(), 'dsh-gc-home-'))
    tempDirs.push(gcHome)
    await writeFile(join(gcHome, 'contexts.toml'), `
[[context]]
name = "remote"
url = "https://example.test"
city = "alpha"
credential_command = "mint-bearer"
grant_command = "mint-write-grant"
`, { mode: 0o600 })
    const seenHeaders: Headers[] = []
    const fetchSupervisor = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seenHeaders.push(new Headers(init?.headers))
      const url = String(input)
      if (url.endsWith('/v0/cities')) return new Response('{"items":[{"name":"alpha","running":true}]}')
      if (url.endsWith('/health')) return new Response('{}')
      return new Response('{"status":"accepted"}', { status: 202 })
    }) as typeof fetch
    const credential = vi.fn(async () => ({
      token: 'opaque-bearer',
      expirationTimestamp: '2099-01-01T00:00:00Z',
    }))
    const writeGrant = `${Buffer.from('{}').toString('base64url')}.${Buffer.alloc(64).toString('base64url')}`
    const grant = vi.fn(async () => writeGrant)
    const helpers = { credential, grant, provider: vi.fn() }
    const { baseUrl } = await mount(undefined, { gcHome, fetch: fetchSupervisor, helpers } as never)
    const inventory = await fetch(`${baseUrl}/api/gas-city/v1/connections`).then(
      response => response.json() as Promise<{ connections: Array<{ id: string; label: string }> }>,
    )
    const connection = inventory.connections.find(item => item.label === 'remote')
    expect(connection).toBeDefined()
    const body = JSON.stringify({ message: 'Continue', intent: 'follow_up' })

    const response = await fetch(
      `${baseUrl}/api/gas-city/v1/connections/${connection?.id}/city/alpha/session/session-1/submit`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
    )

    expect(response.status).toBe(202)
    const upstreamHeaders = seenHeaders.at(-1)
    expect(upstreamHeaders?.get('authorization')).toBe('Bearer opaque-bearer')
    expect(upstreamHeaders?.get('x-gc-request')).toBe('true')
    expect(upstreamHeaders?.get('x-gc-city-write')).toBe(writeGrant)
    expect(credential).toHaveBeenCalledWith('mint-bearer', {
      version: 'gascity.dev/client-auth/v1',
      spec: { server_url: 'https://example.test', city: 'alpha', interactive: false },
    })
    const bodySHA256 = createHash('sha256').update(body).digest('hex')
    const path = '/v0/city/alpha/session/session-1/submit'
    expect(grant).toHaveBeenCalledWith('mint-write-grant', {
      version: 'gascity.dev/city-write-grant/v1',
      aud: 'gc-city-write',
      city: 'alpha',
      method: 'POST',
      path,
      canonical_query: '',
      body_sha256: bodySHA256,
      req_digest: createHash('sha256').update(`POST\n${path}\n${bodySHA256}`).digest('hex'),
    })
  })

  it('refuses Supervisor redirects before credentials can cross an endpoint boundary', async () => {
    const gcHome = await mkdtemp(join(tmpdir(), 'dsh-gc-home-'))
    tempDirs.push(gcHome)
    await writeFile(join(gcHome, 'contexts.toml'), `
[[context]]
name = "remote"
url = "https://example.test"
city = "alpha"
`, { mode: 0o600 })
    const calls: Array<{ url: string; redirect?: RequestRedirect }> = []
    const fetchSupervisor = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        ...(init?.redirect === undefined ? {} : { redirect: init.redirect }),
      })
      if (String(input).endsWith('/v0/cities')) return new Response('{"items":[]}')
      return new Response('{}')
    }) as typeof fetch
    const { baseUrl } = await mount(undefined, { gcHome, fetch: fetchSupervisor })

    await fetch(`${baseUrl}/api/gas-city/v1/connections`)

    const remoteCalls = calls.filter(call => call.url.startsWith('https://example.test'))
    expect(remoteCalls).toHaveLength(2)
    expect(remoteCalls.every(call => call.redirect === 'error')).toBe(true)
  })

  it('rejects a browser path that WHATWG parsing would normalize', async () => {
    const proxy = vi.fn(async () => new Response('{}'))
    const { baseUrl } = await mount({
      inventory: async () => ({ connections: [] }),
      proxy,
    })

    const response = await rawRequest(
      baseUrl,
      '/api/gas-city/v1/connections/alpha/city/acme/session/%2e%2e/rigs',
    )

    expect(response.status).toBe(400)
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json\b/)
    expect(proxy).not.toHaveBeenCalled()
  })

  it('rejects query values outside the enumerated Supervisor schemas', async () => {
    const proxy = vi.fn(async () => new Response('{}'))
    const { baseUrl } = await mount({ inventory: async () => ({ connections: [] }), proxy })
    const city = `${baseUrl}/api/gas-city/v1/connections/alpha/city/acme`
    const invalidUrls = [
      `${city}/sessions?limit=1001`,
      `${city}/sessions?peek=maybe`,
      `${city}/session/session-1?peek_lines=-1`,
      `${city}/session/session-1/transcript?format=html`,
      `${city}/events/stream?after_seq=-4`,
    ]

    for (const url of invalidUrls) {
      const response = await fetch(url)
      expect(response.status, url).toBe(400)
    }
    expect(proxy).not.toHaveBeenCalled()
  })

  it('rejects a body on a bodyless lifecycle operation', async () => {
    const proxy = vi.fn(async () => new Response('{}'))
    const { baseUrl } = await mount({ inventory: async () => ({ connections: [] }), proxy })

    const response = await fetch(
      `${baseUrl}/api/gas-city/v1/connections/alpha/city/acme/session/session-1/stop`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"unexpected":true}',
      },
    )

    expect(response.status).toBe(400)
    expect(proxy).not.toHaveBeenCalled()
  })

  it('fails closed before Supervisor-wide probes when access profiles conflict', async () => {
    const gcHome = await mkdtemp(join(tmpdir(), 'dsh-gc-home-'))
    tempDirs.push(gcHome)
    await writeFile(join(gcHome, 'contexts.toml'), `
[[context]]
name = "alpha-access"
url = "https://example.test"
city = "alpha"
credential_command = "credential-a"

[[context]]
name = "beta-access"
url = "https://example.test"
city = "beta"
credential_command = "credential-b"
`, { mode: 0o600 })
    const fetchSupervisor = vi.fn(async () => { throw new Error('must not probe conflicting remote profiles') }) as typeof fetch
    const helpers = {
      credential: vi.fn(),
      grant: vi.fn(),
      provider: vi.fn(),
    }
    const { baseUrl } = await mount(undefined, { gcHome, fetch: fetchSupervisor, helpers })

    const inventory = await fetch(`${baseUrl}/api/gas-city/v1/connections`).then(
      response => response.json() as Promise<{ connections: Array<{ label: string; available: boolean; diagnostic?: string }> }>,
    )
    const remote = inventory.connections.find(item => item.label === 'alpha-access, beta-access')

    expect(remote).toMatchObject({
      available: false,
      diagnostic: expect.stringMatching(/Supervisor-wide probe.*incompatible/i),
    })
    expect(helpers.credential).not.toHaveBeenCalled()
    expect(fetchSupervisor).toHaveBeenCalledTimes(1)
  })

  it('treats credential-command city scope as part of Supervisor-wide profile compatibility', async () => {
    const gcHome = await mkdtemp(join(tmpdir(), 'dsh-gc-home-'))
    tempDirs.push(gcHome)
    await writeFile(join(gcHome, 'contexts.toml'), `
[[context]]
name = "alpha-access"
url = "https://example.test"
city = "alpha"
credential_command = "shared-helper"

[[context]]
name = "beta-access"
url = "https://example.test"
city = "beta"
credential_command = "shared-helper"
`, { mode: 0o600 })
    const fetchSupervisor = vi.fn(async () => { throw new Error('must not probe ambiguous remote profiles') }) as typeof fetch
    const helpers = {
      credential: vi.fn(),
      grant: vi.fn(),
      provider: vi.fn(),
    }
    const { baseUrl } = await mount(undefined, { gcHome, fetch: fetchSupervisor, helpers })

    const inventory = await fetch(`${baseUrl}/api/gas-city/v1/connections`).then(
      response => response.json() as Promise<{ connections: Array<{ label: string; available: boolean; diagnostic?: string }> }>,
    )
    const remote = inventory.connections.find(item => item.label === 'alpha-access, beta-access')

    expect(remote).toMatchObject({
      available: false,
      diagnostic: expect.stringMatching(/Supervisor-wide probe.*incompatible/i),
    })
    expect(helpers.credential).not.toHaveBeenCalled()
    expect(fetchSupervisor).toHaveBeenCalledTimes(1)
  })

  it('rejects a GC context file readable by other users', async () => {
    const gcHome = await mkdtemp(join(tmpdir(), 'dsh-gc-home-'))
    tempDirs.push(gcHome)
    await writeFile(join(gcHome, 'contexts.toml'), `
[[context]]
name = "remote"
url = "https://example.test"
`, { mode: 0o644 })
    const { baseUrl } = await mount(undefined, {
      gcHome,
      fetch: vi.fn(async () => new Response('{}')) as typeof fetch,
    })

    const response = await fetch(`${baseUrl}/api/gas-city/v1/connections`)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      detail: expect.stringMatching(/ownership|permission/i),
    })
  })

  it('applies the selected access profile TLS policy only on the host transport', async () => {
    const gcHome = await mkdtemp(join(tmpdir(), 'dsh-gc-home-'))
    tempDirs.push(gcHome)
    await writeFile(join(gcHome, 'contexts.toml'), `
[[context]]
name = "remote"
url = "https://example.test"
city = "alpha"
insecure_skip_verify = true
`, { mode: 0o600 })
    const calls: Array<{ url: string; dispatcher?: unknown }> = []
    const fetchSupervisor = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        ...((init as RequestInit & { dispatcher?: unknown } | undefined)?.dispatcher === undefined
          ? {}
          : { dispatcher: (init as RequestInit & { dispatcher?: unknown }).dispatcher }),
      })
      if (String(input).endsWith('/v0/cities')) return new Response('{"items":[]}')
      return new Response('{}')
    }) as typeof fetch
    const { baseUrl } = await mount(undefined, { gcHome, fetch: fetchSupervisor })

    await fetch(`${baseUrl}/api/gas-city/v1/connections`)

    const remoteCalls = calls.filter(call => call.url.startsWith('https://example.test'))
    expect(remoteCalls).toHaveLength(2)
    expect(remoteCalls.every(call => call.dispatcher !== undefined)).toBe(true)
  })

  it('owns the route through the public Cordis effect lifecycle', () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const effect = vi.fn((callback: () => unknown) => callback())

    apply({
      effect,
      webServer: { host: '127.0.0.1', register },
    } as never, {
      boundary: { inventory: async () => ({ connections: [] }) },
    })

    expect(effect).toHaveBeenCalledWith(expect.any(Function), 'deepseek-harness-ui: /api/gas-city/v1 route')
    expect(register).toHaveBeenCalledOnce()
  })
})
