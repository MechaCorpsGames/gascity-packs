import type {
  FeedStreamError,
  FeedPort,
  PendingInteraction,
  SessionState,
  StructuredResetReason,
  StructuredMessage,
  TranscriptDiagnostic,
  TranscriptBootstrap,
} from './feed/index.js'
import type { SessionStreamEvent, SessionStreamRequest } from './feed/index.js'
import { FeedMutationError } from './feed/index.js'

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
    continuity?: { status?: string; note?: string }
    tail_state?: { degraded?: boolean; degraded_reason?: string }
    diagnostics?: TranscriptDiagnostic[]
  }
  structured_messages: StructuredMessage[]
}

interface PendingWire {
  supported: boolean
  pending?: null | {
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
    continuity?: { status?: string; note?: string }
    tail_state?: { degraded?: boolean; degraded_reason?: string }
    diagnostics?: TranscriptDiagnostic[]
  }
  structured_messages: StructuredMessage[]
}

type JsonObject = Record<string, unknown>

const structuredStatuses = new Set(['unknown', 'partial', 'final', 'superseded'])

function incompatible(detail: string): Error {
  return new Error(`Incompatible structured transcript: ${detail}`)
}

function objectValue(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw incompatible(`${path} must be an object`)
  return value as JsonObject
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw incompatible(`${path} must be a string`)
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stringValue(value, path)
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw incompatible(`${path} must be a boolean`)
  return value
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw incompatible(`${path} must be a non-negative number`)
  }
  return value
}

function optionalStringArray(value: unknown, path: string): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw incompatible(`${path} must be an array`)
  return value.map((item, index) => stringValue(item, `${path}[${index}]`))
}

function parseDiagnostics(value: unknown): TranscriptDiagnostic[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw incompatible('history.diagnostics must be an array')
  return value.map((item, index) => {
    const path = `history.diagnostics[${index}]`
    const object = objectValue(item, path)
    return {
      code: stringValue(object.code, `${path}.code`),
      ...(optionalString(object.message, `${path}.message`) === undefined ? {} : { message: object.message as string }),
      ...(object.count === undefined ? {} : { count: nonNegativeNumber(object.count, `${path}.count`) }),
    }
  })
}

function parseUserPrompt(value: unknown, path: string): StructuredMessage['user_prompt'] {
  if (value === undefined) return undefined
  const object = objectValue(value, path)
  let uploadedFiles: NonNullable<StructuredMessage['user_prompt']>['uploaded_files']
  if (object.uploaded_files !== undefined) {
    if (!Array.isArray(object.uploaded_files)) throw incompatible(`${path}.uploaded_files must be an array`)
    uploadedFiles = object.uploaded_files.map((item, index) => {
      const itemPath = `${path}.uploaded_files[${index}]`
      const uploaded = objectValue(item, itemPath)
      return {
        ...(optionalString(uploaded.original_name, `${itemPath}.original_name`) === undefined ? {} : { original_name: uploaded.original_name as string }),
        ...(optionalString(uploaded.size, `${itemPath}.size`) === undefined ? {} : { size: uploaded.size as string }),
        ...(optionalString(uploaded.mime_type, `${itemPath}.mime_type`) === undefined ? {} : { mime_type: uploaded.mime_type as string }),
        ...(optionalString(uploaded.file_path, `${itemPath}.file_path`) === undefined ? {} : { file_path: uploaded.file_path as string }),
        ...(optionalString(uploaded.preview_url, `${itemPath}.preview_url`) === undefined ? {} : { preview_url: uploaded.preview_url as string }),
      }
    })
  }
  let selections: NonNullable<StructuredMessage['user_prompt']>['selections']
  if (object.selections !== undefined) {
    if (!Array.isArray(object.selections)) throw incompatible(`${path}.selections must be an array`)
    selections = object.selections.map((item, index) => {
      const itemPath = `${path}.selections[${index}]`
      const selection = objectValue(item, itemPath)
      return optionalString(selection.text, `${itemPath}.text`) === undefined ? {} : { text: selection.text as string }
    })
  }
  return {
    ...(optionalString(object.text, `${path}.text`) === undefined ? {} : { text: object.text as string }),
    ...(optionalStringArray(object.opened_files, `${path}.opened_files`) === undefined
      ? {}
      : { opened_files: object.opened_files as string[] }),
    ...(uploadedFiles === undefined ? {} : { uploaded_files: uploadedFiles }),
    ...(selections === undefined ? {} : { selections }),
  }
}

function parseSystemEvent(value: unknown, path: string): StructuredMessage['system_event'] {
  if (value === undefined) return undefined
  const object = objectValue(value, path)
  return {
    ...(optionalString(object.kind, `${path}.kind`) === undefined ? {} : { kind: object.kind as string }),
    ...(optionalString(object.category, `${path}.category`) === undefined ? {} : { category: object.category as string }),
    ...(optionalString(object.code, `${path}.code`) === undefined ? {} : { code: object.code as string }),
    ...(optionalString(object.message, `${path}.message`) === undefined ? {} : { message: object.message as string }),
  }
}

function parseMessages(value: unknown): StructuredMessage[] {
  if (!Array.isArray(value)) throw incompatible('structured_messages must be an array')
  return value.map((item, index) => {
    const path = `structured_messages[${index}]`
    const object = objectValue(item, path)
    const status = stringValue(object.status, `${path}.status`)
    if (!structuredStatuses.has(status)) throw incompatible(`${path}.status is unsupported: ${status}`)
    let blocks: Readonly<Record<string, unknown>>[] | undefined
    if (object.blocks !== undefined) {
      if (!Array.isArray(object.blocks)) throw incompatible(`${path}.blocks must be an array`)
      blocks = object.blocks.map((block, blockIndex) => {
        const parsed = objectValue(block, `${path}.blocks[${blockIndex}]`)
        stringValue(parsed.type, `${path}.blocks[${blockIndex}].type`)
        return parsed
      })
    }
    let usage: Record<string, number> | undefined
    if (object.usage !== undefined) {
      const parsed = objectValue(object.usage, `${path}.usage`)
      usage = Object.fromEntries(Object.entries(parsed).map(([key, amount]) => [
        key, nonNegativeNumber(amount, `${path}.usage.${key}`),
      ]))
    }
    return {
      id: stringValue(object.id, `${path}.id`),
      role: stringValue(object.role, `${path}.role`),
      status: status as StructuredMessage['status'],
      ...(optionalString(object.provider, `${path}.provider`) === undefined ? {} : { provider: object.provider as string }),
      ...(optionalString(object.timestamp, `${path}.timestamp`) === undefined ? {} : { timestamp: object.timestamp as string }),
      ...(optionalString(object.model, `${path}.model`) === undefined ? {} : { model: object.model as string }),
      ...(optionalString(object.stop_reason, `${path}.stop_reason`) === undefined ? {} : { stop_reason: object.stop_reason as string }),
      ...(usage === undefined ? {} : { usage }),
      ...(object.user_prompt === undefined ? {} : { user_prompt: parseUserPrompt(object.user_prompt, `${path}.user_prompt`)! }),
      ...(object.system_event === undefined ? {} : { system_event: parseSystemEvent(object.system_event, `${path}.system_event`)! }),
      ...(blocks === undefined ? {} : { blocks }),
    }
  })
}

function parseHistory(value: unknown): TranscriptWire['history'] {
  const history = objectValue(value, 'history')
  const cursor = objectValue(history.cursor, 'history.cursor')
  let continuity: TranscriptWire['history']['continuity']
  if (history.continuity !== undefined) {
    const parsed = objectValue(history.continuity, 'history.continuity')
    continuity = {
      ...(optionalString(parsed.status, 'history.continuity.status') === undefined ? {} : { status: parsed.status as string }),
      ...(optionalString(parsed.note, 'history.continuity.note') === undefined ? {} : { note: parsed.note as string }),
    }
  }
  let tailState: TranscriptWire['history']['tail_state']
  if (history.tail_state !== undefined) {
    const parsed = objectValue(history.tail_state, 'history.tail_state')
    tailState = {
      ...(optionalBoolean(parsed.degraded, 'history.tail_state.degraded') === undefined ? {} : { degraded: parsed.degraded as boolean }),
      ...(optionalString(parsed.degraded_reason, 'history.tail_state.degraded_reason') === undefined
        ? {}
        : { degraded_reason: parsed.degraded_reason as string }),
    }
  }
  return {
    transcript_stream_id: stringValue(history.transcript_stream_id, 'history.transcript_stream_id'),
    cursor: { resume_token: stringValue(cursor.resume_token, 'history.cursor.resume_token') },
    ...(continuity === undefined ? {} : { continuity }),
    ...(tailState === undefined ? {} : { tail_state: tailState }),
    ...(history.diagnostics === undefined ? {} : { diagnostics: parseDiagnostics(history.diagnostics)! }),
  }
}

function parseTranscript(value: unknown): TranscriptWire {
  const object = objectValue(value, 'transcript')
  return {
    id: stringValue(object.id, 'id'),
    schema_version: stringValue(object.schema_version, 'schema_version'),
    history: parseHistory(object.history),
    structured_messages: parseMessages(object.structured_messages),
  }
}

const structuredResetReasons = new Set<StructuredResetReason>([
  'resume_invalid',
  'stream_changed',
  'cursor_invalidated',
  'history_rewritten',
])

function historyProjection(history: TranscriptWire['history']): {
  diagnostics?: readonly TranscriptDiagnostic[]
  degraded?: boolean
  degradedReason?: string
  continuityStatus?: string
  continuityNote?: string
} {
  return {
    ...(history.diagnostics === undefined ? {} : { diagnostics: history.diagnostics }),
    ...(history.tail_state?.degraded === undefined ? {} : { degraded: history.tail_state.degraded }),
    ...(history.tail_state?.degraded_reason === undefined ? {} : { degradedReason: history.tail_state.degraded_reason }),
    ...(history.continuity?.status === undefined ? {} : { continuityStatus: history.continuity.status }),
    ...(history.continuity?.note === undefined ? {} : { continuityNote: history.continuity.note }),
  }
}

function reportStreamError(
  request: SessionStreamRequest,
  error: FeedStreamError,
): void {
  request.onError(error)
}

async function mutationError(response: Response): Promise<FeedMutationError> {
  let detail: string | undefined
  let outcome: 'rejected' | 'unknown' = 'rejected'
  try {
    const problem = await response.json() as Record<string, unknown>
    if (problem.code === 'outcome_unknown') outcome = 'unknown'
    if (typeof problem.detail === 'string' && problem.detail !== '') detail = problem.detail
    else if (typeof problem.title === 'string' && problem.title !== '') detail = problem.title
  } catch {
    // A received HTTP response remains a known rejection without Problem Details.
  }
  return new FeedMutationError(
    outcome,
    response.status,
    detail ?? `Gas City gateway returned HTTP ${response.status}`,
  )
}

function decodeStreamEvent(event: string, id: string, data: string): SessionStreamEvent {
  if (event === 'heartbeat') return { type: 'heartbeat' }
  const value = objectValue(JSON.parse(data), `SSE ${event}`)
  if (event === 'structured') {
    const wire: StructuredEventWire = {
      schema_version: stringValue(value.schema_version, 'schema_version'),
      operation: stringValue(value.operation, 'operation') as StructuredEventWire['operation'],
      history: parseHistory(value.history),
      structured_messages: parseMessages(value.structured_messages),
      ...(value.reset_reason === undefined ? {} : { reset_reason: stringValue(value.reset_reason, 'reset_reason') }),
    }
    if (!['snapshot', 'reset', 'upsert'].includes(wire.operation)) {
      throw incompatible(`operation is unsupported: ${wire.operation}`)
    }
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
      ...historyProjection(wire.history),
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
      const wire = parseTranscript(await getJson<unknown>(
        `${base}/session/${encoded}/transcript?tail=1&format=structured&include_thinking=${String(config.includeThinking)}`,
      ))
      if (wire.schema_version !== 'session.structured.v1') {
        throw new Error(`Unsupported transcript schema ${wire.schema_version}`)
      }
      return {
        sessionId: wire.id,
        transcriptStreamId: wire.history.transcript_stream_id,
        resumeToken: wire.history.cursor.resume_token,
        messages: wire.structured_messages,
        ...historyProjection(wire.history),
      }
    },
    async fetchPending(sessionId: string): Promise<readonly PendingInteraction[]> {
      const wire = await getJson<PendingWire>(`${base}/session/${encodeURIComponent(sessionId)}/pending`)
      if (!wire.supported || wire.pending == null) return []
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
      let response: Response
      try {
        response = await request(`${base}/session/${encodeURIComponent(sessionId)}/respond`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch {
        throw new FeedMutationError('unknown', 0, 'Gas City gateway response was lost')
      }
      if (!response.ok) throw await mutationError(response)
    },
  }
}
