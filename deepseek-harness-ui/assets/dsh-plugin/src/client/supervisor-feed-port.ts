import type {
  FeedStreamError,
  FeedPort,
  PendingInteraction,
  SessionState,
  StructuredResetReason,
  StructuredMessage,
  TranscriptBootstrap,
} from './feed/index.js'
import type { SessionStreamEvent, SessionStreamRequest } from './feed/index.js'

export interface SupervisorFeedPortConfig {
  connectionId: string
  cityName: string
  includeThinking: boolean
  fetch?: typeof globalThis.fetch
}

interface TranscriptWire {
  id: string
  schema_version: string
  history: {
    transcript_stream_id: string
    cursor: { resume_token: string }
  }
  structured_messages: StructuredMessage[]
}

interface PendingWire {
  supported: boolean
  pending?: {
    request_id: string
    kind: string
    prompt?: string
    options?: string[]
  }
}

interface SessionWire {
  id: string
  state: string
}

interface StructuredEventWire {
  schema_version: string
  operation: 'snapshot' | 'reset' | 'upsert'
  reset_reason?: string
  history: {
    transcript_stream_id: string
    cursor: { resume_token: string }
  }
  structured_messages: StructuredMessage[]
}

const structuredResetReasons = new Set<StructuredResetReason>([
  'resume_invalid',
  'stream_changed',
  'cursor_invalidated',
  'history_rewritten',
])

function reportStreamError(
  request: SessionStreamRequest,
  error: FeedStreamError,
): void {
  request.onError(error)
}

function decodeStreamEvent(event: string, id: string, data: string): SessionStreamEvent {
  const value = JSON.parse(data) as Record<string, unknown>
  if (event === 'structured') {
    const wire = value as unknown as StructuredEventWire
    if (wire.schema_version !== 'session.structured.v1') {
      throw new Error(`Unsupported transcript schema ${wire.schema_version}`)
    }
    if (wire.history.cursor.resume_token !== id) {
      throw new Error('Structured SSE id does not match its resume token')
    }
    if (wire.operation === 'reset' && !structuredResetReasons.has(wire.reset_reason as StructuredResetReason)) {
      throw new Error(`Unsupported structured reset reason ${String(wire.reset_reason)}`)
    }
    if (wire.operation !== 'reset' && wire.reset_reason !== undefined) {
      throw new Error(`Structured ${wire.operation} frame included a reset reason`)
    }
    return {
      type: 'structured',
      id,
      operation: wire.operation,
      transcriptStreamId: wire.history.transcript_stream_id,
      resumeToken: wire.history.cursor.resume_token,
      messages: wire.structured_messages,
      ...(wire.reset_reason === undefined ? {} : { resetReason: wire.reset_reason as StructuredResetReason }),
    }
  }
  if (event === 'activity') return { type: 'activity', activity: String(value.activity ?? '') }
  if (event === 'pending') {
    return {
      type: 'pending',
      interaction: {
        requestId: String(value.request_id ?? ''),
        kind: String(value.kind ?? ''),
        prompt: String(value.prompt ?? ''),
        ...(Array.isArray(value.options) ? { options: value.options.map(String) } : {}),
      },
    }
  }
  if (event === 'pending_cleared') {
    return { type: 'pending_cleared', requestId: String(value.request_id ?? '') }
  }
  throw new Error(`Unsupported session stream event ${event}`)
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  request: SessionStreamRequest,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (reason) {
        if (!signal.aborted) {
          reportStreamError(request, {
            kind: 'network',
            message: reason instanceof Error ? reason.message : String(reason),
          })
        }
        return
      }
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      while (true) {
        const boundary = buffer.search(/\r?\n\r?\n/)
        if (boundary < 0) break
        const frame = buffer.slice(0, boundary)
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n'
        buffer = buffer.slice(boundary + separator.length)
        const lines = frame.split(/\r?\n/)
        if (lines.every(line => line === '' || line.startsWith(':'))) {
          request.onEvent({ type: 'heartbeat' })
          continue
        }
        let event = 'message'
        let id = ''
        const data: string[] = []
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trimStart()
          else if (line.startsWith('id:')) id = line.slice(3).trimStart()
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
        }
        try {
          request.onEvent(decodeStreamEvent(event, id, data.join('\n')))
        } catch (reason) {
          reportStreamError(request, {
            kind: 'contract',
            message: reason instanceof Error ? reason.message : String(reason),
          })
          return
        }
      }
    }
    if (!signal.aborted) request.onEof()
  } finally {
    reader.releaseLock()
  }
}

export function createSupervisorFeedPort(config: SupervisorFeedPortConfig): FeedPort {
  const request = config.fetch ?? globalThis.fetch
  const base = `/api/gas-city/v1/connections/${encodeURIComponent(config.connectionId)}/city/${encodeURIComponent(config.cityName)}`

  async function getJson<T>(path: string): Promise<T> {
    const response = await request(path, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Gas City gateway returned HTTP ${response.status}`)
    return await response.json() as T
  }

  return {
    async fetchTranscript(sessionId: string): Promise<TranscriptBootstrap> {
      const encoded = encodeURIComponent(sessionId)
      const wire = await getJson<TranscriptWire>(
        `${base}/session/${encoded}/transcript?tail=1&format=structured&include_thinking=${String(config.includeThinking)}`,
      )
      if (wire.schema_version !== 'session.structured.v1') {
        throw new Error(`Unsupported transcript schema ${wire.schema_version}`)
      }
      return {
        sessionId: wire.id,
        transcriptStreamId: wire.history.transcript_stream_id,
        resumeToken: wire.history.cursor.resume_token,
        messages: wire.structured_messages,
      }
    },
    async fetchPending(sessionId: string): Promise<readonly PendingInteraction[]> {
      const wire = await getJson<PendingWire>(`${base}/session/${encodeURIComponent(sessionId)}/pending`)
      if (!wire.supported || wire.pending === undefined) return []
      return [{
        requestId: wire.pending.request_id,
        kind: wire.pending.kind,
        prompt: wire.pending.prompt ?? '',
        ...(wire.pending.options === undefined ? {} : { options: wire.pending.options }),
      }]
    },
    async fetchSession(sessionId: string): Promise<SessionState> {
      const wire = await getJson<SessionWire>(`${base}/session/${encodeURIComponent(sessionId)}`)
      return { id: wire.id, state: wire.state, closed: wire.state === 'closed' }
    },
    async openSessionStream(streamRequest) {
      const abort = new AbortController()
      const query = new URLSearchParams({
        format: 'structured',
        include_thinking: String(config.includeThinking),
      })
      const headers: Record<string, string> = { Accept: 'text/event-stream' }
      if (streamRequest.lastEventId !== undefined) headers['Last-Event-ID'] = streamRequest.lastEventId
      else if (streamRequest.afterCursor !== undefined) query.set('after_cursor', streamRequest.afterCursor)
      let response: Response
      try {
        response = await request(
          `${base}/session/${encodeURIComponent(streamRequest.sessionId)}/stream?${query.toString()}`,
          { headers, signal: abort.signal },
        )
      } catch (reason) {
        queueMicrotask(() => reportStreamError(streamRequest, {
          kind: 'network',
          message: reason instanceof Error ? reason.message : String(reason),
        }))
        return { close: () => abort.abort() }
      }
      if (!response.ok) {
        const kind = response.status === 401 || response.status === 403
          ? 'unauthorized'
          : response.status === 409 || response.status === 410
            ? 'resume_rejected'
            : 'http'
        queueMicrotask(() => reportStreamError(streamRequest, {
          kind,
          status: response.status,
          message: `Gas City stream returned HTTP ${response.status}`,
        }))
        return { close: () => abort.abort() }
      }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
        queueMicrotask(() => reportStreamError(streamRequest, {
          kind: 'contract',
          message: 'Gas City stream returned a non-SSE content type',
        }))
        return { close: () => abort.abort() }
      }
      if (response.body === null) {
        queueMicrotask(() => reportStreamError(streamRequest, {
          kind: 'contract',
          message: 'Gas City stream returned no body',
        }))
        return { close: () => abort.abort() }
      }
      void consumeSse(response.body, streamRequest, abort.signal)
      return { close: () => abort.abort() }
    },
    async respond(sessionId, requestId, interactionResponse) {
      const action = interactionResponse.action
      if (typeof action !== 'string' || action === '') throw new Error('Interaction response action is required')
      const body: Record<string, unknown> = { request_id: requestId, action }
      if (typeof interactionResponse.text === 'string') body.text = interactionResponse.text
      if (interactionResponse.metadata !== undefined) body.metadata = interactionResponse.metadata
      const response = await request(`${base}/session/${encodeURIComponent(sessionId)}/respond`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`Gas City gateway returned HTTP ${response.status}`)
    },
  }
}
