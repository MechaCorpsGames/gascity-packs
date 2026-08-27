import { describe, expect, it, vi } from 'vitest'

import { createSupervisorFeedPort } from '../../src/client/index.js'
import { FeedMutationError } from '../../src/client/feed/index.js'

describe('Supervisor feed port', () => {
  it('bootstraps transcript, pending, and session from the exact same-origin routes', async () => {
    const fetchBoundary = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.includes('/transcript?')) return Response.json({
        id: 'session-1',
        format: 'structured',
        schema_version: 'session.structured.v1',
        operation: 'snapshot',
        history: {
          transcript_stream_id: 'stream-1',
          cursor: { resume_token: 'st1.cursor-1' },
          tail_state: { activity: 'idle' },
        },
        structured_messages: [{
          id: 'message-1', role: 'assistant', status: 'partial', blocks: [{ type: 'text', text: 'Hello' }],
        }],
      })
      if (path.endsWith('/pending')) return Response.json({
        supported: true,
        pending: { request_id: 'request-1', kind: 'question', prompt: 'Continue?', options: [] },
      })
      if (path.endsWith('/session/session-1')) return Response.json({
        id: 'session-1', state: 'active', running: true,
      })
      return new Response(null, { status: 404 })
    })
    const port = createSupervisorFeedPort({
      connectionId: 'local', cityName: 'gastown', includeThinking: false, fetch: fetchBoundary,
    })

    await expect(port.fetchTranscript('session-1')).resolves.toEqual({
      sessionId: 'session-1',
      transcriptStreamId: 'stream-1',
      resumeToken: 'st1.cursor-1',
      messages: [{
        id: 'message-1', role: 'assistant', status: 'partial', blocks: [{ type: 'text', text: 'Hello' }],
      }],
    })
    await expect(port.fetchPending('session-1')).resolves.toEqual([{
      requestId: 'request-1', kind: 'question', prompt: 'Continue?', options: [],
    }])
    await expect(port.fetchSession('session-1')).resolves.toEqual({
      id: 'session-1', state: 'active', closed: false,
    })

    expect(fetchBoundary.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/transcript?tail=1&format=structured&include_thinking=false',
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/pending',
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1',
    ])
  })

  it('streams structured, activity, pending, and clear SSE frames without EventSource', async () => {
    const encoder = new TextEncoder()
    const fetchBoundary = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: structured\n'
          + 'id: st1.next\n'
          + 'data: {"id":"session-1","format":"structured","schema_version":"session.structured.v1","operation":"upsert","history":{"transcript_stream_id":"stream-1","cursor":{"resume_token":"st1.next"}},"structured_messages":[{"id":"message-1","role":"assistant","status":"final","blocks":[{"type":"text","text":"Done"}]}]}\n\n'
          + 'event: activity\ndata: {"activity":"idle"}\n\n'
          + 'event: pending\ndata: {"request_id":"request-1","kind":"approval","prompt":"Proceed?"}\n\n',
        ))
        controller.enqueue(encoder.encode(
          'event: pending_cleared\ndata: {"request_id":"request-1"}\n\n: keepalive\n\n',
        ))
        controller.close()
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const port = createSupervisorFeedPort({
      connectionId: 'local', cityName: 'gastown', includeThinking: false, fetch: fetchBoundary,
    })
    const events: unknown[] = []
    let reachedEof!: () => void
    const eof = new Promise<void>(resolve => { reachedEof = resolve })

    const handle = await port.openSessionStream({
      sessionId: 'session-1',
      afterCursor: 'st1.cursor-1',
      onEvent: event => events.push(event),
      onEof: reachedEof,
      onError: vi.fn(),
    })
    await eof

    expect(events).toEqual([
      {
        type: 'structured', id: 'st1.next', operation: 'upsert',
        transcriptStreamId: 'stream-1', resumeToken: 'st1.next',
        messages: [{ id: 'message-1', role: 'assistant', status: 'final', blocks: [{ type: 'text', text: 'Done' }] }],
      },
      { type: 'activity', activity: 'idle' },
      { type: 'pending', interaction: { requestId: 'request-1', kind: 'approval', prompt: 'Proceed?' } },
      { type: 'pending_cleared', requestId: 'request-1' },
      { type: 'heartbeat' },
    ])
    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/stream?format=structured&include_thinking=false&after_cursor=st1.cursor-1',
      {
        headers: { Accept: 'text/event-stream' },
        signal: expect.any(AbortSignal),
      },
    )
    handle.close()
  })

  it('reports a malformed structured frame as a contract error', async () => {
    const encoder = new TextEncoder()
    const fetchBoundary = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: structured\n'
          + 'id: st1.next\n'
          + 'data: {"schema_version":"session.structured.v1","operation":"reset","reset_reason":"invented","history":{"transcript_stream_id":"stream-1","cursor":{"resume_token":"st1.next"}},"structured_messages":[]}\n\n',
        ))
        controller.close()
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const port = createSupervisorFeedPort({
      connectionId: 'local', cityName: 'gastown', includeThinking: false, fetch: fetchBoundary,
    })
    let reportError!: (value: unknown) => void
    const reported = new Promise<unknown>(resolve => { reportError = resolve })

    await port.openSessionStream({
      sessionId: 'session-1',
      afterCursor: 'st1.cursor-1',
      onEvent: vi.fn(),
      onEof: vi.fn(),
      onError: reportError,
    })

    await expect(reported).resolves.toMatchObject({
      kind: 'contract',
      message: expect.stringContaining('reset reason'),
    })
  })

  it('rejects malformed structured bootstrap messages with a controlled compatibility error', async () => {
    const fetchBoundary = vi.fn(async () => Response.json({
      id: 'session-1',
      schema_version: 'session.structured.v1',
      history: {
        transcript_stream_id: 'stream-1',
        cursor: { resume_token: 'st1.cursor-1' },
        diagnostics: [{ code: 'fixture', count: 'many' }],
      },
      structured_messages: [{ id: 'message-1', role: 'assistant', status: 'invented', blocks: [] }],
    }))
    const port = createSupervisorFeedPort({
      connectionId: 'local', cityName: 'gastown', includeThinking: false, fetch: fetchBoundary,
    })

    await expect(port.fetchTranscript('session-1')).rejects.toThrow(
      'Incompatible structured transcript: history.diagnostics[0].count must be a non-negative number',
    )
  })

  it('reports malformed structured message blocks as a stream contract error', async () => {
    const encoder = new TextEncoder()
    const fetchBoundary = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: structured\n'
          + 'id: st1.next\n'
          + 'data: {"schema_version":"session.structured.v1","operation":"upsert","history":{"transcript_stream_id":"stream-1","cursor":{"resume_token":"st1.next"}},"structured_messages":[{"id":"message-1","role":"assistant","status":"final","blocks":["unsafe"]}]}\n\n',
        ))
        controller.close()
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const port = createSupervisorFeedPort({
      connectionId: 'local', cityName: 'gastown', includeThinking: false, fetch: fetchBoundary,
    })
    let reportError!: (value: unknown) => void
    const reported = new Promise<unknown>(resolve => { reportError = resolve })

    await port.openSessionStream({
      sessionId: 'session-1', afterCursor: 'st1.cursor-1',
      onEvent: vi.fn(), onEof: vi.fn(), onError: reportError,
    })

    await expect(reported).resolves.toMatchObject({
      kind: 'contract',
      message: 'Incompatible structured transcript: structured_messages[0].blocks[0] must be an object',
    })
  })

  it('posts normalized interaction responses to the selected session only', async () => {
    const fetchBoundary = vi.fn(async () => Response.json({ id: 'session-1', status: 'ok' }))
    const port = createSupervisorFeedPort({
      connectionId: 'local', cityName: 'gastown', includeThinking: false, fetch: fetchBoundary,
    })

    await port.respond('session-1', 'request-1', { action: 'approve' })

    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/respond',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: 'request-1', action: 'approve' }),
      },
    )
  })

  it('treats the Supervisor pending null sentinel as an empty interaction list', async () => {
    const fetchBoundary = vi.fn(async () => Response.json({ supported: true, pending: null }))
    const port = createSupervisorFeedPort({
      connectionId: 'local', cityName: 'gastown', includeThinking: false, fetch: fetchBoundary,
    })

    await expect(port.fetchPending('session-1')).resolves.toEqual([])
  })

  it.each([
    [409, { title: 'Interaction conflict', detail: 'The interaction is no longer pending' }, 'rejected'],
    [502, { title: 'Supervisor request failed', detail: 'The response may have been accepted', code: 'outcome_unknown' }, 'unknown'],
  ] as const)('decodes an HTTP %s interaction response as a typed %s outcome', async (status, problem, outcome) => {
    const fetchBoundary = vi.fn(async () => Response.json(problem, {
      status,
      headers: { 'Content-Type': 'application/problem+json' },
    }))
    const port = createSupervisorFeedPort({
      connectionId: 'local', cityName: 'gastown', includeThinking: false, fetch: fetchBoundary,
    })

    const responding = port.respond('session-1', 'request-1', { action: 'deny' })

    await expect(responding).rejects.toMatchObject({
      name: 'FeedMutationError',
      status,
      outcome,
      message: problem.detail,
    } satisfies Partial<FeedMutationError>)
  })
})
