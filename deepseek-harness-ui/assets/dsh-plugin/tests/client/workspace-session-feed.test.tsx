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
    let renameWrites = 0
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
      if (path.endsWith('/providers/public')) return Response.json({ items: [{
        name: 'codex', display_name: 'Codex', builtin: true, city_level: false,
        options_schema: [{ key: 'permission_mode', label: 'Permission mode', type: 'choice', default: 'plan', choices: [
          { value: 'plan', label: 'Plan' }, { value: 'auto-edit', label: 'Auto edit' },
        ] }],
        effective_defaults: { permission_mode: 'plan' },
      }], total: 1 })
      if (path.endsWith('/sessions?state=all')) return Response.json({ items: [
        { id: 'session-1', template: 'main/crew', state: 'active', title: 'Repair alerts', provider: 'codex', session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: true, activity: 'in-turn', submission_capabilities: { supports_follow_up: true, supports_interrupt_now: true } },
      ], total: 1 })
      if (path.includes('/session/session-1/transcript?')) return Response.json({
        id: 'session-1', format: 'structured', schema_version: 'session.structured.v1', operation: 'snapshot',
        history: {
          transcript_stream_id: 'stream-1', cursor: { resume_token: 'st1.cursor-1' },
          continuity: { status: 'degraded', note: 'fallback active' },
          tail_state: { activity: 'in-turn', degraded: true, degraded_reason: 'provider transcript unavailable' },
          diagnostics: [{ code: 'transcript_unavailable', message: 'using provider-neutral fallback', count: 1 }],
        },
        structured_messages: [{
          id: 'message-user-1', role: 'user', status: 'final', blocks: [],
          user_prompt: {
            text: 'Inspect the attached evidence',
            opened_files: ['/workspace/README.md'],
            uploaded_files: [{
              original_name: 'evidence.png', size: '42 KB', mime_type: 'image/png',
              file_path: '/remote/session/evidence.png', preview_url: 'https://untrusted.invalid/evidence.png',
            }],
            selections: [{ text: 'selected line' }],
          },
        }, {
          id: 'message-1', role: 'assistant', status: 'final', blocks: [
            path.includes('include_thinking=true')
              ? { type: 'thinking', thinking: 'Inspecting the failing checks' }
              : { type: 'thinking' },
            { type: 'text', text: 'Hello from Codex' },
            { type: 'tool_use', id: 'tool-1', name: 'Shell', input: { kind: 'command', command: 'gc status' } },
            { type: 'tool_result', tool_call_id: 'tool-1', content: 'all systems nominal', is_error: false },
          ],
          model: 'gpt-fixture', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
        }, {
          id: 'message-system-1', role: 'system', status: 'final', blocks: [],
          system_event: { kind: 'notice', code: 'fixture_ready', message: 'Fixture system event' },
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
      if (path.endsWith('/session/session-1/suspend')) return Response.json({
        code: 'outcome_unknown', detail: 'suspend helper timed out', status: 502,
      }, { status: 502 })
      if (path.endsWith('/session/session-1/rename')) {
        renameWrites += 1
        if (renameWrites === 2) return Response.json({
          code: 'outcome_unknown', detail: 'rename helper timed out', status: 502,
        }, { status: 502 })
        return Response.json({
          id: 'session-1', template: 'main/crew', state: 'active', title: 'Rename accepted', provider: 'codex',
          session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: true, activity: 'in-turn',
          submission_capabilities: { supports_follow_up: true, supports_interrupt_now: true },
        })
      }
      if (path.endsWith('/session/session-1')) return Response.json({
        id: 'session-1', template: 'main/crew', state: 'active',
        title: renameWrites === 2 ? 'Maybe renamed' : renameWrites === 1 ? 'Release repair' : 'Repair alerts', provider: 'codex',
        session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: true, activity: 'in-turn',
        submission_capabilities: { supports_follow_up: true, supports_interrupt_now: true },
      })
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
    const preferences = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => preferences.get(key) ?? null,
        setItem: (key: string, value: string) => preferences.set(key, value),
      },
    })
    window.location.hash = '#/gas-city'
    const Overlay = overlayComponent()
    render(<Overlay />)

    fireEvent.click(await screen.findByRole('button', { name: 'Local Supervisor' }))
    fireEvent.click(await screen.findByRole('button', { name: 'gastown' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Repair alerts' }))

    expect(await screen.findByText('Hello from Codex')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Repair alerts' })).toBeTruthy()
    expect(screen.getByText('codex')).toBeTruthy()
    expect(screen.getByText('Transcript degraded: provider transcript unavailable')).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Transcript diagnostics' })).toBeTruthy()
    expect(screen.getByText(/transcript_unavailable: using provider-neutral fallback/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Interrupt turn' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Kill runtime' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close permanently' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Wake' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Permission mode' })).toHaveProperty('disabled', true)
    const sessionReadsBeforeControl = requested.filter(path => path.endsWith('/session/session-1')).length
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt turn' }))
    expect(await screen.findByText('Turn interrupted')).toBeTruthy()
    await waitFor(() => expect(requested.filter(path => path.endsWith('/session/session-1')).length).toBeGreaterThan(sessionReadsBeforeControl))
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(await screen.findByText('Suspend outcome unknown: suspend helper timed out')).toBeTruthy()
    expect(screen.queryByText('Inspecting the failing checks')).toBeNull()
    expect(screen.queryByText('Unsupported content')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show reasoning' }))
    expect(preferences.get('gastownhall.deepseek-harness-ui.show-reasoning')).toBe('true')
    expect(await screen.findByText('Inspecting the failing checks')).toBeTruthy()
    expect(requested).toContain(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/stream?format=structured&include_thinking=true&after_cursor=st1.cursor-1',
    )
    expect(screen.getByRole('region', { name: 'Tool call Shell' })).toBeTruthy()
    expect(screen.getByText('all systems nominal')).toBeTruthy()
    expect(screen.getByText('Inspect the attached evidence')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Attachment evidence.png' })).toBeTruthy()
    expect(screen.getByText('Fixture system event')).toBeTruthy()
    expect(screen.getByText(/model gpt-fixture/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /evidence/i })).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(requested.some(path => path.includes('untrusted.invalid'))).toBe(false)
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
    fireEvent.click(screen.getByRole('button', { name: 'Rename session' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New session title' }), { target: { value: 'Release repair' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }))
    expect(await screen.findByRole('heading', { name: 'Release repair' })).toBeTruthy()
    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/rename',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Release repair' }),
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rename session' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New session title' }), { target: { value: 'Maybe renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }))
    expect(await screen.findByText('Rename outcome unknown: rename helper timed out')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Maybe renamed' })).toBeTruthy()
    expect(requested).toContain(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/stream?format=structured&include_thinking=false&after_cursor=st1.cursor-1',
    )
  })
})
