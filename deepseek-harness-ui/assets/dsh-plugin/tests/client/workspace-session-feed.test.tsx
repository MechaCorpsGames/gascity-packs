// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apply } from '../../src/client/index.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.location.hash = ''
})

function overlayComponent(): ComponentType<Record<string, unknown>> {
  let overlay: ComponentType<Record<string, unknown>> | undefined
  const slots = {
    inject(_name: string, register: () => unknown) { return register() },
    register(options: { id?: string }, component: ComponentType<Record<string, unknown>>) {
      if (options.id === 'gas-city-workspace-overlay') overlay = component
      return () => undefined
    },
  }
  apply({ slots } as never)
  if (overlay === undefined) throw new Error('overlay not registered')
  return overlay
}

describe('Gas City session workspace', () => {
  it('attaches to an existing session through the structured feed controller', async () => {
    const requested: string[] = []
    const fetchBoundary = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      requested.push(path)
      if (path.endsWith('/connections')) return Response.json({ connections: [
        { id: 'local', label: 'Local Supervisor', cities: ['gastown'], available: true },
      ] })
      if (path.endsWith('/connections/local/cities')) return Response.json({ items: [
        { name: 'gastown', path: '/srv/gastown', running: true },
      ], total: 1 })
      if (path.endsWith('/rigs')) return Response.json({ items: [
        { name: 'main', path: '/srv/gastown/main', suspended: false, agent_count: 1, running_count: 1 },
      ], total: 1 })
      if (path.endsWith('/agents')) return Response.json({ items: [
        { name: 'main/crew', rig: 'main', running: true, suspended: false, available: true, state: 'running' },
      ], total: 1 })
      if (path.endsWith('/sessions?state=all')) return Response.json({ items: [
        { id: 'session-1', template: 'main/crew', state: 'active', title: 'Repair alerts', provider: 'codex', session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: true, activity: 'in-turn', submission_capabilities: { supports_follow_up: true, supports_interrupt_now: true } },
      ], total: 1 })
      if (path.includes('/session/session-1/transcript?')) return Response.json({
        id: 'session-1', format: 'structured', schema_version: 'session.structured.v1', operation: 'snapshot',
        history: { transcript_stream_id: 'stream-1', cursor: { resume_token: 'st1.cursor-1' }, tail_state: { activity: 'in-turn' } },
        structured_messages: [{
          id: 'message-1', role: 'assistant', status: 'final', blocks: [
            { type: 'thinking', thinking: 'Inspecting the failing checks' },
            { type: 'text', text: 'Hello from Codex' },
            { type: 'tool_use', id: 'tool-1', name: 'Shell', input: { kind: 'command', command: 'gc status' } },
            { type: 'tool_result', tool_call_id: 'tool-1', content: 'all systems nominal', is_error: false },
          ],
        }],
      })
      if (path.endsWith('/session/session-1/pending')) return Response.json({
        supported: true,
        pending: { request_id: 'request-1', kind: 'question', prompt: 'Continue with repair?', options: [] },
      })
      if (path.endsWith('/session/session-1/respond')) return Response.json({ id: 'session-1', status: 'ok' })
      if (path.endsWith('/session/session-1/submit')) return Response.json({
        status: 'accepted', request_id: 'submit-1', event_cursor: '100',
      }, { status: 202 })
      if (path.endsWith('/session/session-1/stop')) return Response.json({ status: 'ok', id: 'session-1' })
      if (path.endsWith('/session/session-1')) return Response.json({ id: 'session-1', state: 'active', running: true })
      if (path.includes('/session/session-1/stream?')) {
        return new Response(new ReadableStream({ start(controller) { controller.close() } }), {
          status: 200, headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      if (path.endsWith('/events/stream?after_seq=100')) {
        const encoder = new TextEncoder()
        return new Response(new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(encoder.encode(
                'event: event\nid: 101\ndata: {"seq":101,"type":"request.result.session.submit","actor":"supervisor","ts":"2026-08-26T00:00:00Z","payload":{"request_id":"submit-1","session_id":"session-1","queued":false,"intent":"default"}}\n\n',
              ))
              controller.close()
            }, 0)
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchBoundary)
    window.location.hash = '#/gas-city'
    const Overlay = overlayComponent()
    render(<Overlay />)

    fireEvent.click(await screen.findByRole('button', { name: 'Local Supervisor' }))
    fireEvent.click(await screen.findByRole('button', { name: 'gastown' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Repair alerts' }))

    expect(await screen.findByText('Hello from Codex')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Repair alerts' })).toBeTruthy()
    expect(screen.getByText('codex')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Interrupt turn' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Kill runtime' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close permanently' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Wake' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt turn' }))
    expect(await screen.findByText('Turn interrupted')).toBeTruthy()
    expect(screen.getByText('Inspecting the failing checks')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Tool call Shell' })).toBeTruthy()
    expect(screen.getByText('all systems nominal')).toBeTruthy()
    const pending = screen.getByRole('region', { name: 'Pending interactions' })
    fireEvent.change(within(pending).getByRole('textbox'), { target: { value: 'Yes, continue' } })
    fireEvent.click(within(pending).getByRole('button', { name: 'Answer' }))
    await waitFor(() => expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/respond',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: 'request-1', action: 'answer', text: 'Yes, continue' }),
      },
    ))
    expect(within(pending).getByRole('button', { name: 'Answer' })).toHaveProperty('disabled', true)
    const composer = screen.getByRole('textbox', { name: 'Message Repair alerts' })
    fireEvent.change(composer, { target: { value: 'Run the checks' } })
    expect(screen.getByRole('button', { name: 'Follow up' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Interrupt and send' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'default' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Submitted')).toBeTruthy()
    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/submit',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Run the checks' }),
      },
    )
    expect(requested).toContain(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/stream?format=structured&include_thinking=false&after_cursor=st1.cursor-1',
    )
  })
})
