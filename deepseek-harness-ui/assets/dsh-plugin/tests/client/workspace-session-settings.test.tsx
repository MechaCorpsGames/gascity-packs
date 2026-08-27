// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

describe('Gas City session settings', () => {
  it('offers provider-schema permission modes only for a dormant session', async () => {
    let permissionWrites = 0
    const fetchBoundary = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/connections')) return Response.json({ connections: [
        { id: 'local', label: 'Local Supervisor', cities: ['gastown'], available: true },
      ] })
      if (path.endsWith('/connections/local/cities')) return Response.json({ items: [
        { name: 'gastown', path: '/srv/gastown', running: true },
      ], total: 1 })
      if (path.endsWith('/rigs')) return Response.json({ items: [
        { name: 'main', path: '/srv/gastown/main', suspended: false, agent_count: 1, running_count: 0 },
      ], total: 1 })
      if (path.endsWith('/agents')) return Response.json({ items: [
        { name: 'main/crew', rig: 'main', running: false, suspended: true, available: true, state: 'suspended' },
      ], total: 1 })
      if (path.endsWith('/providers/public')) return Response.json({ items: [{
        name: 'codex', display_name: 'Codex', builtin: true, city_level: false,
        options_schema: [{
          key: 'permission_mode', label: 'Permission mode', type: 'choice', default: 'plan',
          choices: [{ value: 'plan', label: 'Plan' }, { value: 'auto-edit', label: 'Auto edit' }],
        }],
        effective_defaults: { permission_mode: 'plan' },
      }], total: 1 })
      if (path.endsWith('/sessions?state=all')) return Response.json({ items: [{
        id: 'session-1', template: 'main/crew', state: 'suspended', title: 'Repair alerts', provider: 'codex',
        session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: false,
        activity: 'idle',
        options: { permission_mode: 'plan' },
      }], total: 1 })
      if (path.includes('/session/session-1/transcript?')) return Response.json({
        id: 'session-1', format: 'structured', schema_version: 'session.structured.v1', operation: 'snapshot',
        history: { transcript_stream_id: 'stream-1', cursor: { resume_token: 'st1.cursor-1' }, tail_state: { activity: 'idle' } },
        structured_messages: [],
      })
      if (path.endsWith('/session/session-1/pending')) return Response.json({ supported: true, pending: null })
      if (path.endsWith('/session/session-1/permission-mode')) {
        permissionWrites += 1
        if (permissionWrites === 2) return Response.json({
          code: 'outcome_unknown', detail: 'write helper timed out', status: 502,
        }, { status: 502 })
        return Response.json({
          id: 'session-1', template: 'main/crew', state: 'suspended', title: 'Repair alerts', provider: 'codex',
          session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: false,
          activity: 'idle',
          options: { permission_mode: 'auto-edit' },
        })
      }
      if (path.endsWith('/session/session-1')) return Response.json({
        id: 'session-1', template: 'main/crew', state: 'suspended', title: 'Repair alerts', provider: 'codex',
        session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: false,
        activity: 'idle',
        options: { permission_mode: permissionWrites === 2 ? 'plan' : permissionWrites === 1 ? 'auto-edit' : 'plan' },
      })
      if (path.includes('/session/session-1/stream?')) {
        return new Response(new ReadableStream({ start(controller) { controller.close() } }), {
          status: 200, headers: { 'Content-Type': 'text/event-stream' },
        })
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

    const permissionMode = await screen.findByRole('combobox', { name: 'Permission mode' })
    expect(permissionMode).toHaveProperty('value', 'plan')
    fireEvent.change(permissionMode, { target: { value: 'auto-edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply permission mode' }))
    expect(await screen.findByText('Permission mode updated; it applies on the next launch')).toBeTruthy()
    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local/city/gastown/session/session-1/permission-mode',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_mode: 'auto-edit' }),
      },
    )

    fireEvent.change(permissionMode, { target: { value: 'plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply permission mode' }))
    expect(await screen.findByText('Permission mode outcome unknown: write helper timed out')).toBeTruthy()
    expect(permissionMode).toHaveProperty('value', 'plan')
  })
})
