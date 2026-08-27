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

describe('Gas City topology', () => {
  it('uses state=all as the master session inventory and keeps unmatched sessions attachable', async () => {
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
      if (path.endsWith('/city/gastown/rigs')) return Response.json({ items: [
        { name: 'main', path: '/srv/gastown/main', suspended: false, agent_count: 1, running_count: 1 },
      ], total: 1 })
      if (path.endsWith('/city/gastown/agents')) return Response.json({ items: [
        { name: 'main/crew', rig: 'main', running: true, suspended: false, available: true, state: 'running' },
      ], total: 1 })
      if (path.endsWith('/city/gastown/sessions?state=all')) return Response.json({ items: [
        { id: 'session-1', template: 'main/crew', state: 'active', title: 'Repair alerts', provider: 'codex', session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: true },
        { id: 'session-2', template: 'provider/codex', state: 'closed', title: 'Provider scratch', provider: 'codex', session_name: 'scratch', created_at: '2026-08-25T00:00:00Z', running: false },
      ], total: 2 })
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchBoundary)
    window.location.hash = '#/gas-city'
    const Overlay = overlayComponent()
    render(<Overlay />)

    fireEvent.click(await screen.findByRole('button', { name: 'Local Supervisor' }))
    fireEvent.click(await screen.findByRole('button', { name: 'gastown' }))

    expect(await screen.findByRole('button', { name: 'main/crew' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Repair alerts' })).toBeTruthy()
    const other = screen.getByRole('region', { name: 'Other sessions' })
    expect(within(other).getByRole('button', { name: 'Provider scratch' })).toBeTruthy()
    expect(requested).toContain('/api/gas-city/v1/connections/local/city/gastown/sessions?state=all')
    expect(requested.some(path => path.includes('template='))).toBe(false)
  })
})
