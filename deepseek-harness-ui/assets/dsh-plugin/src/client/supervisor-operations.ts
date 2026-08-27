import type { CityOperationDescriptor, CityOperationPort } from './feed/index.js'
import type { CityEventStreamRequest } from './feed/index.js'
import { parseSessionSummary, type SessionSummary } from './api.js'

export type SubmitIntent = 'default' | 'follow_up' | 'interrupt_now'
export type SessionControl = 'stop' | 'kill' | 'suspend' | 'close' | 'wake'

export class SupervisorRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'SupervisorRequestError'
    this.status = status
  }
}

export class SupervisorOutcomeUnknownError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'SupervisorOutcomeUnknownError'
    this.status = status
  }
}

async function requestError(response: Response): Promise<SupervisorRequestError | SupervisorOutcomeUnknownError> {
  let detail: string | undefined
  let outcomeUnknown = false
  try {
    const problem = await response.json() as Record<string, unknown>
    outcomeUnknown = problem.code === 'outcome_unknown'
    if (typeof problem.detail === 'string' && problem.detail !== '') detail = problem.detail
    else if (typeof problem.title === 'string' && problem.title !== '') detail = problem.title
  } catch {
    // The status is still a known HTTP result even if the body is not Problem Details.
  }
  const message = detail ?? `Gas City gateway returned HTTP ${response.status}`
  return outcomeUnknown
    ? new SupervisorOutcomeUnknownError(response.status, message)
    : new SupervisorRequestError(response.status, message)
}

export function allowedSessionControls(state: string, activity?: string): readonly SessionControl[] {
  if (state === 'active' || state === 'awake') {
    return activity === 'in-turn'
      ? ['stop', 'kill', 'suspend', 'close']
      : ['kill', 'suspend', 'close']
  }
  if (state === 'asleep' || state === 'quarantined') return ['suspend', 'wake', 'close']
  if (state === 'suspended' || state === 'archived') return ['wake', 'close']
  return []
}

export interface SupervisorOperationsConfig {
  connectionId: string
  cityName: string
  fetch?: typeof globalThis.fetch
}

export interface SupervisorOperations {
  submitSession(sessionId: string, message: string, intent?: SubmitIntent): Promise<CityOperationDescriptor>
  createAgentSession(agentName: string, message: string): Promise<CityOperationDescriptor>
  controlSession(sessionId: string, control: SessionControl): Promise<void>
  fetchSession(sessionId: string): Promise<SessionSummary>
  renameSession(sessionId: string, title: string): Promise<SessionSummary>
  setPermissionMode(sessionId: string, permissionMode: string): Promise<SessionSummary>
  cityOperationPort: CityOperationPort
}

interface AcceptedWire {
  status: string
  request_id: string
  event_cursor: string
}

async function consumeCityEvents(
  body: ReadableStream<Uint8Array>,
  callbacks: CityEventStreamRequest,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      while (true) {
        const boundary = buffer.search(/\r?\n\r?\n/)
        if (boundary < 0) break
        const frame = buffer.slice(0, boundary)
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n'
        buffer = buffer.slice(boundary + separator.length)
        let event = 'message'
        let id = ''
        const data: string[] = []
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trimStart()
          else if (line.startsWith('id:')) id = line.slice(3).trimStart()
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
        }
        if (event === 'heartbeat') {
          callbacks.onHeartbeat()
          continue
        }
        if (event !== 'event') throw new Error(`Unsupported city stream event ${event}`)
        const envelope = JSON.parse(data.join('\n')) as Record<string, unknown>
        if (typeof envelope.type !== 'string') throw new Error('City event envelope has no type')
        callbacks.onEvent({ id, eventType: envelope.type, payload: envelope.payload })
      }
    }
    if (!signal.aborted) callbacks.onDisconnect({ kind: 'eof' })
  } catch (reason) {
    if (!signal.aborted) {
      callbacks.onDisconnect({
        kind: reason instanceof SyntaxError ? 'contract' : 'network',
      })
    }
  } finally {
    reader.releaseLock()
  }
}

export function createSupervisorOperations(config: SupervisorOperationsConfig): SupervisorOperations {
  const request = config.fetch ?? globalThis.fetch
  const base = `/api/gas-city/v1/connections/${encodeURIComponent(config.connectionId)}/city/${encodeURIComponent(config.cityName)}`
  const updateSession = async (
    sessionId: string,
    suffix: 'rename' | 'permission-mode',
    body: Readonly<Record<string, string>>,
  ): Promise<SessionSummary> => {
    const response = await request(`${base}/session/${encodeURIComponent(sessionId)}/${suffix}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw await requestError(response)
    return parseSessionSummary(await response.json())
  }
  return {
    async submitSession(sessionId, message, intent) {
      if (message.trim() === '') throw new Error('Message is required')
      const body: { message: string; intent?: SubmitIntent } = { message }
      if (intent !== undefined && intent !== 'default') body.intent = intent
      const response = await request(`${base}/session/${encodeURIComponent(sessionId)}/submit`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (response.status !== 202) throw await requestError(response)
      const accepted = await response.json() as AcceptedWire
      return {
        requestId: accepted.request_id,
        eventCursor: accepted.event_cursor,
        operation: 'session.submit',
      }
    },
    async createAgentSession(agentName, message) {
      if (message.trim() === '') throw new Error('Message is required')
      const response = await request(`${base}/sessions`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'agent', name: agentName, message, async: true }),
      })
      if (response.status !== 202) throw await requestError(response)
      const accepted = await response.json() as AcceptedWire
      return {
        requestId: accepted.request_id,
        eventCursor: accepted.event_cursor,
        operation: 'session.create',
      }
    },
    async controlSession(sessionId, control) {
      const suffix = control === 'close' ? 'close?delete=true' : control
      const response = await request(`${base}/session/${encodeURIComponent(sessionId)}/${suffix}`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw await requestError(response)
    },
    async fetchSession(sessionId) {
      const response = await request(`${base}/session/${encodeURIComponent(sessionId)}`, {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw await requestError(response)
      return parseSessionSummary(await response.json())
    },
    async renameSession(sessionId, title) {
      if (title.trim() === '') throw new Error('Session title is required')
      return await updateSession(sessionId, 'rename', { title: title.trim() })
    },
    async setPermissionMode(sessionId, permissionMode) {
      if (permissionMode.trim() === '') throw new Error('Permission mode is required')
      return await updateSession(sessionId, 'permission-mode', { permission_mode: permissionMode.trim() })
    },
    cityOperationPort: {
      async openCityEventStream(callbacks) {
        const abort = new AbortController()
        const query = new URLSearchParams()
        const headers: Record<string, string> = { Accept: 'text/event-stream' }
        if (callbacks.lastEventId !== undefined) headers['Last-Event-ID'] = callbacks.lastEventId
        else if (callbacks.afterSeq !== undefined) query.set('after_seq', callbacks.afterSeq)
        const suffix = query.size === 0 ? '' : `?${query.toString()}`
        const response = await request(`${base}/events/stream${suffix}`, { headers, signal: abort.signal })
        if (!response.ok) {
          const retryAfter = response.headers.get('retry-after')
          callbacks.onDisconnect({
            kind: 'http',
            status: response.status,
            ...(retryAfter === null ? {} : { retryAfterMs: Number(retryAfter) * 1_000 }),
          })
          return { close: () => abort.abort() }
        }
        if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream') || response.body === null) {
          callbacks.onDisconnect({ kind: 'contract' })
          return { close: () => abort.abort() }
        }
        void consumeCityEvents(response.body, callbacks, abort.signal)
        return { close: () => abort.abort() }
      },
    },
  }
}
