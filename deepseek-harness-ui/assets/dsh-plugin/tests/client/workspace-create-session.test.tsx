// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

describe('Gas City create on first send', () => {
  it('keeps an agent selection local until one accepted create resolves the authoritative session', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    const fetchBoundary = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      calls.push({ path, ...(init === undefined ? {} : { init }) })
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
        { name: 'main/crew', rig: 'main', provider: 'codex', running: true, suspended: false, available: true, state: 'running' },
      ], total: 1 })
      if (path.endsWith('/providers/public')) return Response.json({ items: [], total: 0 })
      if (path.endsWith('/sessions?state=all')) return Response.json({ items: [], total: 0 })
      if (path.endsWith('/city/gastown/sessions') && init?.method === 'POST') return Response.json({
        status: 'accepted', request_id: 'create-1', event_cursor: '77',
      }, { status: 202 })
      if (path.endsWith('/events/stream?after_seq=77')) {
        const encoder = new TextEncoder()
        return new Response(new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(encoder.encode(
                'event: event\nid: 78\ndata: {"seq":78,"type":"request.result.session.create","actor":"supervisor","ts":"2026-08-26T00:00:00Z","payload":{"request_id":"create-1","session":{"id":"session-new","template":"main/crew","state":"active","title":"Start repair","provider":"codex","session_name":"crew","created_at":"2026-08-26T00:00:00Z","running":true}}}\n\n',
              ))
              controller.close()
            }, 0)
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      if (path.includes('/session/session-new/transcript?')) return Response.json({
        id: 'session-new', format: 'structured', schema_version: 'session.structured.v1', operation: 'snapshot',
        history: { transcript_stream_id: 'stream-new', cursor: { resume_token: 'st1.new' }, tail_state: { activity: 'in-turn' } },
        structured_messages: [],
      })
      if (path.endsWith('/session/session-new/pending')) return Response.json({ supported: true })
      if (path.endsWith('/session/session-new')) return Response.json({ id: 'session-new', state: 'active', running: true })
      if (path.includes('/session/session-new/stream?')) return new Response(new ReadableStream({
        start(controller) { controller.close() },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchBoundary)
    window.location.hash = '#/gas-city'
    const Overlay = overlayComponent()
    render(<Overlay />)

    fireEvent.click(await screen.findByRole('button', { name: 'Local Supervisor' }))
    fireEvent.click(await screen.findByRole('button', { name: 'gastown' }))
    fireEvent.click(await screen.findByRole('button', { name: 'main/crew' }))

    expect(screen.getByRole('heading', { name: 'New session with main/crew' })).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'Message main/crew' })
    fireEvent.change(composer, { target: { value: 'Start the repair' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }))

    expect(await screen.findByRole('heading', { name: 'Start repair' })).toBeTruthy()
    const topology = screen.getByRole('navigation', { name: 'Gas City topology' })
    const createdSession = within(topology).getByRole('button', { name: 'Start repair' })
    expect(createdSession.getAttribute('aria-pressed')).toBe('true')
    expect(within(topology).getByText('Loaded 1 of 1 sessions')).toBeTruthy()

    fireEvent.click(within(topology).getByRole('button', { name: 'main/crew' }))
    expect(screen.getByRole('heading', { name: 'New session with main/crew' })).toBeTruthy()
    fireEvent.click(within(topology).getByRole('button', { name: 'Start repair' }))
    expect(screen.getByRole('heading', { name: 'Start repair' })).toBeTruthy()
    expect(within(topology).getAllByRole('button', { name: 'Start repair' })).toHaveLength(1)
    const creates = calls.filter(call => call.path.endsWith('/city/gastown/sessions') && call.init?.method === 'POST')
    expect(creates).toHaveLength(1)
    expect(creates[0]?.init?.body).toBe(JSON.stringify({
      kind: 'agent', name: 'main/crew', message: 'Start the repair', async: true,
    }))
  })
})
