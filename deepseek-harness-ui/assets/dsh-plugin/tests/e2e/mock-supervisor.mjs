import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const activeSession = {
  id: 'session-browser-1', template: 'demo/crew', state: 'active', title: 'Browser streaming check',
  provider: 'codex', session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: true,
  activity: 'in-turn', options: { permission_mode: 'plan' },
  submission_capabilities: { supports_follow_up: true, supports_interrupt_now: true },
}

const dormantSession = {
  id: 'session-browser-2', template: 'demo/crew', state: 'suspended', title: 'Dormant settings check',
  provider: 'codex', session_name: 'crew-suspended', created_at: '2026-08-25T00:00:00Z', running: false,
  activity: 'idle', options: { permission_mode: 'plan' },
  submission_capabilities: { supports_follow_up: false, supports_interrupt_now: false },
}

function json(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(JSON.stringify(value))
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function transcript(session, message, includeThinking, status = 'partial') {
  return {
    id: session.id,
    provider: session.provider,
    format: 'structured',
    schema_version: 'session.structured.v1',
    operation: 'snapshot',
    history: {
      transcript_stream_id: `browser-stream-${session.id}`,
      cursor: { resume_token: `st1.${session.id}.start.${includeThinking}` },
      continuity: { status: 'continuous' },
      tail_state: { activity: session.activity, degraded: false },
      diagnostics: [],
    },
    structured_messages: [{
      id: `assistant-${session.id}`,
      role: 'assistant',
      provider: session.provider,
      model: 'fixture-model',
      status,
      blocks: [
        includeThinking ? { type: 'thinking', thinking: 'Tracing the Supervisor stream' } : { type: 'thinking' },
        { type: 'text', text: message },
        { type: 'tool_use', id: `tool-${session.id}`, name: 'Status', input: { kind: 'command', command: 'gc status' } },
      ],
    }],
  }
}

export async function startMockSupervisor({ port = 0 } = {}) {
  const requests = []
  const sessionStreams = new Set()
  const active = structuredClone(activeSession)
  const dormant = structuredClone(dormantSession)
  const sessions = new Map([[active.id, active], [dormant.id, dormant]])
  const sessionStreamAttempts = new Map()
  const finalizedSessions = new Set()
  const cityResults = []
  let submitCount = 0
  let pendingInteraction = {
    request_id: 'browser-question-1', kind: 'question', prompt: 'Approve the browser verification?', options: [],
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
    const path = url.pathname
    const capture = {
      method: request.method ?? 'GET', path, search: url.search, body: undefined,
      lastEventId: request.headers['last-event-id'],
    }
    requests.push(capture)

    if (request.method === 'GET' && path === '/health') return json(response, 200, { status: 'ok', version: 'fixture' })
    if (request.method === 'GET' && path === '/v0/cities') {
      return json(response, 200, { items: [{ name: 'demo', path: '/tmp/demo', running: true }], total: 1 })
    }
    if (request.method === 'GET' && path === '/v0/city/demo/rigs') {
      return json(response, 200, { items: [{ name: 'demo', path: '/tmp/demo', suspended: false, agent_count: 1, running_count: 1 }], total: 1 })
    }
    if (request.method === 'GET' && path === '/v0/city/demo/agents') {
      return json(response, 200, { items: [{ name: 'demo/crew', rig: 'demo', provider: 'codex', running: true, suspended: false, available: true, state: 'running' }], total: 1 })
    }
    if (request.method === 'GET' && path === '/v0/city/demo/providers/public') {
      return json(response, 200, { items: [{
        name: 'codex', display_name: 'Codex fixture', builtin: true, city_level: false,
        options_schema: [{ key: 'permission_mode', label: 'Permission mode', type: 'choice', default: 'plan', choices: [
          { value: 'plan', label: 'Plan' }, { value: 'auto-edit', label: 'Auto edit' },
        ] }],
        effective_defaults: { permission_mode: 'plan' },
      }], total: 1 })
    }
    if (request.method === 'GET' && path === '/v0/city/demo/sessions') {
      if (url.searchParams.get('cursor') === 'page-2') return json(response, 200, { items: [dormant], total: 2 })
      return json(response, 200, { items: [active], total: 2, next_cursor: 'page-2' })
    }

    const sessionMatch = /^\/v0\/city\/demo\/session\/([^/]+)(?:\/(.+))?$/.exec(path)
    if (sessionMatch !== null) {
      const id = sessionMatch[1]
      const operation = sessionMatch[2] ?? ''
      const session = sessions.get(id)
      if (session === undefined) return json(response, 404, { error: 'unknown fixture session', id })
      if (request.method === 'GET' && operation === '') return json(response, 200, session)
      if (request.method === 'GET' && operation === 'transcript') {
        const includeThinking = url.searchParams.get('include_thinking') === 'true'
        const finalized = finalizedSessions.has(session.id)
        const message = session.id === 'session-created-browser'
          ? 'Created session attached to its own Supervisor stream.'
          : finalized
            ? 'Full structured streaming is live in stock DSH.'
            : 'Connecting to the authoritative Gas City transcript…'
        const wire = transcript(session, message, includeThinking, finalized ? 'final' : 'partial')
        if (finalized) {
          wire.structured_messages[0].blocks.push({
            type: 'tool_result', tool_call_id: `tool-${session.id}`, content: 'Supervisor fixture healthy', is_error: false,
          })
        }
        return json(response, 200, wire)
      }
      if (request.method === 'GET' && operation === 'pending') {
        return json(response, 200, pendingInteraction !== null && session.id === active.id
          ? { supported: true, pending: pendingInteraction }
          : { supported: true, pending: null })
      }
      if (request.method === 'GET' && operation === 'stream') {
        const includeThinking = url.searchParams.get('include_thinking') === 'true'
        const attempt = (sessionStreamAttempts.get(session.id) ?? 0) + 1
        sessionStreamAttempts.set(session.id, attempt)
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        sessionStreams.add(response)
        response.write(': connected\n\n')
        let closeTimer
        const timer = setTimeout(() => {
          const message = session.id === 'session-created-browser'
            ? 'Created session attached to its own Supervisor stream.'
            : 'Full structured streaming is live in stock DSH.'
          const wire = transcript(session, message, includeThinking, 'final')
          wire.operation = attempt === 2 && session.id === active.id ? 'reset' : 'upsert'
          if (wire.operation === 'reset') wire.reset_reason = 'cursor_invalidated'
          wire.history.cursor.resume_token = `st1.${session.id}.${wire.operation}.${attempt}.${includeThinking}`
          wire.structured_messages[0].blocks.push({
            type: 'tool_result', tool_call_id: `tool-${session.id}`, content: 'Supervisor fixture healthy', is_error: false,
          })
          finalizedSessions.add(session.id)
          response.write(`event: structured\nid: ${wire.history.cursor.resume_token}\ndata: ${JSON.stringify(wire)}\n\n`)
          response.write('event: activity\ndata: {"activity":"idle"}\n\n')
          if (attempt === 1 && session.id === active.id) {
            closeTimer = setTimeout(() => response.end(), 50)
          }
        }, 100)
        request.on('close', () => {
          clearTimeout(timer)
          clearTimeout(closeTimer)
          sessionStreams.delete(response)
        })
        return
      }
      if (request.method === 'POST' && operation === 'respond') {
        capture.body = await readJson(request)
        const clearedId = pendingInteraction?.request_id ?? capture.body.request_id
        if (clearedId === 'browser-question-1') {
          pendingInteraction = {
            request_id: 'browser-approval-1', kind: 'tool_approval', prompt: 'Allow the read-only fixture tool?', options: [],
          }
        } else if (clearedId === 'browser-approval-1') {
          pendingInteraction = {
            request_id: 'browser-choice-1', kind: 'choice', prompt: 'Choose the recovery mode.', options: ['Safe', 'Fast'],
          }
        } else {
          pendingInteraction = null
        }
        for (const stream of sessionStreams) {
          stream.write(`event: pending_cleared\ndata: ${JSON.stringify({ request_id: clearedId })}\n\n`)
          if (pendingInteraction !== null) {
            stream.write(`event: pending\ndata: ${JSON.stringify(pendingInteraction)}\n\n`)
          }
        }
        return json(response, 200, { id: session.id, status: 'ok' })
      }
      if (request.method === 'POST' && operation === 'submit') {
        capture.body = await readJson(request)
        submitCount += 1
        const requestId = `browser-submit-${submitCount}`
        const eventCursor = String(200 + (submitCount - 1) * 10)
        cityResults.push({
          seq: String(Number(eventCursor) + 1), type: 'request.result.session.submit',
          payload: { request_id: requestId, session_id: session.id, queued: false, intent: capture.body.intent ?? 'default' },
        })
        return json(response, 202, { status: 'accepted', request_id: requestId, event_cursor: eventCursor })
      }
      if (request.method === 'POST' && operation === 'rename') {
        capture.body = await readJson(request)
        session.title = capture.body.title
        return json(response, 200, session, { 'X-GC-Index': '42' })
      }
      if (request.method === 'POST' && operation === 'permission-mode') {
        capture.body = await readJson(request)
        session.options = { ...session.options, permission_mode: capture.body.permission_mode }
        return json(response, 200, session, { 'X-GC-Index': '43' })
      }
      if (request.method === 'POST' && ['stop', 'kill', 'suspend', 'close', 'wake'].includes(operation)) {
        return json(response, 200, { id: session.id, status: 'ok' })
      }
    }

    if (request.method === 'POST' && path === '/v0/city/demo/sessions') {
      capture.body = await readJson(request)
      const created = { ...structuredClone(active), id: 'session-created-browser', title: 'Created from stock DSH', template: capture.body.name }
      sessions.set(created.id, created)
      cityResults.push({
        seq: '301', type: 'request.result.session.create',
        payload: { request_id: 'browser-create-1', session: created },
      })
      return json(response, 202, { status: 'accepted', request_id: 'browser-create-1', event_cursor: '300' })
    }
    if (request.method === 'GET' && path === '/v0/city/demo/events/stream') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      if (cityResults.length > 0) {
        const event = cityResults.shift()
        response.end(`event: event\nid: ${event.seq}\ndata: ${JSON.stringify({
          seq: Number(event.seq), type: event.type, actor: 'supervisor', ts: '2026-08-26T00:00:00Z', payload: event.payload,
        })}\n\n`)
      } else response.end()
      return
    }

    return json(response, 404, { error: 'not found', method: request.method, path, search: url.search })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture did not bind a TCP port')
  const url = `http://127.0.0.1:${address.port}`
  return {
    url,
    port: address.port,
    requests,
    async close() {
      for (const stream of sessionStreams) stream.end()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startMockSupervisor({ port: Number(process.env.MOCK_SUPERVISOR_PORT ?? '8372') })
  process.stdout.write(`mock Supervisor listening at ${fixture.url}\n`)
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => void fixture.close().then(() => process.exit(0)))
  }
}
