import { describe, expect, it, vi } from 'vitest'

import { allowedSessionControls, createSupervisorOperations, SupervisorRequestError } from '../../src/client/index.js'

describe('Supervisor operations', () => {
  it('fails closed while exposing the exact supported lifecycle matrix', () => {
    expect(allowedSessionControls('active', 'in-turn')).toEqual(['stop', 'kill', 'suspend', 'close'])
    expect(allowedSessionControls('active', 'idle')).toEqual(['kill', 'suspend', 'close'])
    expect(allowedSessionControls('asleep')).toEqual(['suspend', 'wake', 'close'])
    expect(allowedSessionControls('quarantined')).toEqual(['suspend', 'wake', 'close'])
    expect(allowedSessionControls('suspended')).toEqual(['wake', 'close'])
    expect(allowedSessionControls('archived')).toEqual(['wake', 'close'])
    expect(allowedSessionControls('closed')).toEqual([])
    expect(allowedSessionControls('future-state')).toEqual([])
  })

  it('keeps default submit implicit and returns the accepted city-stream cursor', async () => {
    const fetchBoundary = vi.fn(async () => Response.json({
      status: 'accepted', request_id: 'request-1', event_cursor: '18446744073709551614',
    }, { status: 202 }))
    const operations = createSupervisorOperations({
      connectionId: 'local', cityName: 'gastown', fetch: fetchBoundary,
    })

    await expect(operations.submitSession('session-1', 'Run the checks')).resolves.toEqual({
      requestId: 'request-1',
      eventCursor: '18446744073709551614',
      operation: 'session.submit',
    })
    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/submit',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Run the checks' }),
      },
    )
  })

  it('relays city event IDs as decimal strings without Number coercion', async () => {
    const encoder = new TextEncoder()
    const fetchBoundary = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: heartbeat\ndata: {"timestamp":"2026-08-26T00:00:00Z"}\n\n'
          + 'event: event\nid: 18446744073709551615\n'
          + 'data: {"seq":18446744073709551615,"type":"request.result.session.submit","actor":"supervisor","ts":"2026-08-26T00:00:00Z","payload":{"request_id":"request-1","session_id":"session-1","queued":false,"intent":"default"}}\n\n',
        ))
        controller.close()
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const operations = createSupervisorOperations({
      connectionId: 'local', cityName: 'gastown', fetch: fetchBoundary,
    })
    const events: unknown[] = []
    const heartbeats = vi.fn()
    let disconnected!: (value: unknown) => void
    const disconnect = new Promise(resolve => { disconnected = resolve })

    const handle = await operations.cityOperationPort.openCityEventStream({
      afterSeq: '18446744073709551614',
      onEvent: event => events.push(event),
      onHeartbeat: heartbeats,
      onDisconnect: disconnected,
    })
    await expect(disconnect).resolves.toEqual({ kind: 'eof' })

    expect(events).toEqual([{
      id: '18446744073709551615',
      eventType: 'request.result.session.submit',
      payload: { request_id: 'request-1', session_id: 'session-1', queued: false, intent: 'default' },
    }])
    expect(heartbeats).toHaveBeenCalledOnce()
    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/events/stream?after_seq=18446744073709551614',
      { headers: { Accept: 'text/event-stream' }, signal: expect.any(AbortSignal) },
    )
    handle.close()
  })

  it('creates an agent session once with its initial prompt in the accepted request', async () => {
    const fetchBoundary = vi.fn(async () => Response.json({
      status: 'accepted', request_id: 'create-1', event_cursor: '77',
    }, { status: 202 }))
    const operations = createSupervisorOperations({
      connectionId: 'local', cityName: 'gastown', fetch: fetchBoundary,
    })

    await expect(operations.createAgentSession('main/crew', 'Start the repair')).resolves.toEqual({
      requestId: 'create-1', eventCursor: '77', operation: 'session.create',
    })
    expect(fetchBoundary).toHaveBeenCalledTimes(1)
    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/sessions',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'agent', name: 'main/crew', message: 'Start the repair', async: true }),
      },
    )
  })

  it('sends lifecycle controls only to fixed session operation endpoints', async () => {
    const fetchBoundary = vi.fn(async () => Response.json({ status: 'ok', id: 'session-1' }))
    const operations = createSupervisorOperations({
      connectionId: 'local', cityName: 'gastown', fetch: fetchBoundary,
    })

    await operations.controlSession('session-1', 'stop')

    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/stop',
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
      },
    )
  })

  it('reads the authoritative session after a synchronous mutation', async () => {
    const authoritative = {
      id: 'session-1', template: 'main/crew', state: 'suspended', title: 'Repair alerts',
      provider: 'codex', session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: false,
      activity: 'idle', options: { permission_mode: 'plan' },
    }
    const fetchBoundary = vi.fn(async () => Response.json(authoritative))
    const operations = createSupervisorOperations({
      connectionId: 'local', cityName: 'gastown', fetch: fetchBoundary,
    })

    await expect(operations.fetchSession('session-1')).resolves.toEqual(authoritative)
    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1',
      { headers: { Accept: 'application/json' } },
    )
  })

  it('renames sessions through the dedicated Supervisor operation', async () => {
    const updated = {
      id: 'session-1', template: 'main/crew', state: 'suspended', title: 'Release repair',
      provider: 'codex', session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: false,
    }
    const fetchBoundary = vi.fn(async () => Response.json(updated))
    const operations = createSupervisorOperations({
      connectionId: 'local', cityName: 'gastown', fetch: fetchBoundary,
    })

    await expect(operations.renameSession('session-1', 'Release repair')).resolves.toEqual(updated)
    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/rename',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Release repair' }),
      },
    )
  })

  it('updates permission mode only with an explicit schema value', async () => {
    const updated = {
      id: 'session-1', template: 'main/crew', state: 'suspended', title: 'Repair alerts',
      provider: 'codex', session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: false,
      options: { permission_mode: 'plan' },
    }
    const fetchBoundary = vi.fn(async () => Response.json(updated))
    const operations = createSupervisorOperations({
      connectionId: 'local', cityName: 'gastown', fetch: fetchBoundary,
    })

    await expect(operations.setPermissionMode('session-1', 'plan')).resolves.toEqual(updated)
    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/permission-mode',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_mode: 'plan' }),
      },
    )
  })

  it('preserves a received Problem Details rejection as a known HTTP failure', async () => {
    const fetchBoundary = vi.fn(async () => Response.json({
      type: 'https://docs.gascity.com/problems/conflict',
      title: 'Session conflict',
      status: 409,
      detail: 'Session is closed',
    }, { status: 409 }))
    const operations = createSupervisorOperations({
      connectionId: 'local', cityName: 'gastown', fetch: fetchBoundary,
    })

    const failure = operations.submitSession('session-1', 'Try once')
    await expect(failure).rejects.toBeInstanceOf(SupervisorRequestError)
    await expect(failure).rejects.toMatchObject({ status: 409, message: 'Session is closed' })
  })

  it('leaves transport loss distinguishable from a received rejection', async () => {
    const fetchBoundary = vi.fn(async () => { throw new TypeError('fetch failed') })
    const operations = createSupervisorOperations({
      connectionId: 'local', cityName: 'gastown', fetch: fetchBoundary,
    })

    await expect(operations.createAgentSession('main/crew', 'Try once')).rejects.toEqual(
      expect.objectContaining({ name: 'TypeError', message: 'fetch failed' }),
    )
  })
})
