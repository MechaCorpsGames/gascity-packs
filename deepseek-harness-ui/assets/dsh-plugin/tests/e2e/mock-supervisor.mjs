import { createServer } from 'node:http'

const port = Number(process.env.MOCK_SUPERVISOR_PORT ?? '8372')
const session = {
  id: 'session-browser-1',
  template: 'demo/crew',
  state: 'active',
  title: 'Browser streaming check',
  provider: 'codex',
  session_name: 'crew',
  created_at: '2026-08-26T00:00:00Z',
  running: true,
  activity: 'in-turn',
  submission_capabilities: {
    supports_follow_up: true,
    supports_interrupt_now: true,
  },
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

function transcript(message, status = 'partial') {
  return {
    id: session.id,
    format: 'structured',
    schema_version: 'session.structured.v1',
    operation: 'snapshot',
    history: {
      transcript_stream_id: 'browser-stream-1',
      cursor: { resume_token: 'st1.browser-start' },
      tail_state: { activity: 'in-turn' },
    },
    structured_messages: [{
      id: 'assistant-browser-1',
      role: 'assistant',
      status,
      blocks: [
        { type: 'thinking', thinking: 'Tracing the Supervisor stream' },
        { type: 'text', text: message },
        { type: 'tool_use', id: 'tool-browser-1', name: 'Status', input: { city: 'demo' } },
      ],
    }],
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  const path = url.pathname

  if (request.method === 'GET' && path === '/health') return json(response, 200, { status: 'ok' })
  if (request.method === 'GET' && path === '/v0/cities') {
    return json(response, 200, { items: [{ name: 'demo', path: '/tmp/demo', running: true }], total: 1 })
  }
  if (request.method === 'GET' && path === '/v0/city/demo/rigs') {
    return json(response, 200, { items: [{ name: 'demo', path: '/tmp/demo', suspended: false, agent_count: 1, running_count: 1 }], total: 1 })
  }
  if (request.method === 'GET' && path === '/v0/city/demo/agents') {
    return json(response, 200, { items: [{ name: 'demo/crew', rig: 'demo', provider: 'codex', running: true, suspended: false, available: true, state: 'running' }], total: 1 })
  }
  if (request.method === 'GET' && path === '/v0/city/demo/sessions') {
    return json(response, 200, { items: [session], total: 1 })
  }
  if (request.method === 'GET' && path === `/v0/city/demo/session/${session.id}`) {
    return json(response, 200, { id: session.id, state: 'active', running: true })
  }
  if (request.method === 'GET' && path === `/v0/city/demo/session/${session.id}/transcript`) {
    return json(response, 200, transcript('Connecting to the authoritative Gas City transcript…'))
  }
  if (request.method === 'GET' && path === `/v0/city/demo/session/${session.id}/pending`) {
    return json(response, 200, {
      supported: true,
      pending: { request_id: 'browser-question-1', kind: 'question', prompt: 'Approve the browser verification?', options: [] },
    })
  }
  if (request.method === 'GET' && path === `/v0/city/demo/session/${session.id}/stream`) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    response.write(': connected\n\n')
    const timer = setTimeout(() => {
      const wire = transcript('Full structured streaming is live in stock DSH.', 'final')
      wire.operation = 'upsert'
      wire.history.cursor.resume_token = 'st1.browser-live'
      wire.structured_messages[0].blocks.push({
        type: 'tool_result',
        tool_call_id: 'tool-browser-1',
        content: 'Supervisor fixture healthy',
        is_error: false,
      })
      response.write(`event: structured\nid: st1.browser-live\ndata: ${JSON.stringify(wire)}\n\n`)
      response.write('event: activity\ndata: {"activity":"idle"}\n\n')
    }, 250)
    request.on('close', () => clearTimeout(timer))
    return
  }
  if (request.method === 'GET' && path === '/v0/city/demo/events/stream') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    response.end('event: event\nid: 201\ndata: {"seq":201,"type":"request.result.session.submit","actor":"supervisor","ts":"2026-08-26T00:00:00Z","payload":{"request_id":"browser-submit-1","session_id":"session-browser-1","queued":false,"intent":"default"}}\n\n')
    return
  }
  if (request.method === 'POST' && path === `/v0/city/demo/session/${session.id}/submit`) {
    return json(response, 202, { status: 'accepted', request_id: 'browser-submit-1', event_cursor: '200' })
  }
  if (request.method === 'POST' && (path.endsWith('/respond') || path.endsWith('/stop'))) {
    return json(response, 200, { id: session.id, status: 'ok' })
  }

  return json(response, 404, { error: 'not found', method: request.method, path })
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`mock Supervisor listening at http://127.0.0.1:${port}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
