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

describe('Gas City topology', () => {
  it('keeps city-level and mismatched-rig agents and their sessions navigable', async () => {
    const fetchBoundary = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/config')) return Response.json({ workspace: { name: 'gastown' }, agents: [], rigs: [] })
      if (path.endsWith('/connections')) return Response.json({ connections: [
        { id: 'local', label: 'Local Supervisor', cities: ['gastown'], available: true },
      ] })
      if (path.endsWith('/connections/local/cities')) return Response.json({ items: [
        { name: 'gastown', path: '/srv/gastown', running: true },
      ], total: 1 })
      if (path.endsWith('/rigs')) return Response.json({ items: [
        { name: 'main', path: '/srv/gastown/main', suspended: false, agent_count: 0, running_count: 0 },
      ], total: 1 })
      if (path.endsWith('/agents')) return Response.json({ items: [
        { name: 'mayor', running: false, suspended: false, available: true, state: 'stopped' },
        { name: 'orphan/crew', rig: 'missing-rig', running: false, suspended: false, available: true, state: 'stopped' },
      ], total: 2 })
      if (path.endsWith('/providers/public')) return Response.json({ items: [], total: 0 })
      if (path.endsWith('/sessions?state=all')) return Response.json({ items: [
        { id: 'session-mayor', template: 'mayor', state: 'asleep', title: 'City planning', provider: 'codex', session_name: 'mayor', created_at: '2026-08-26T00:00:00Z', running: false },
        { id: 'session-orphan', template: 'orphan/crew', state: 'asleep', title: 'Orphan repair', provider: 'codex', session_name: 'orphan', created_at: '2026-08-26T00:00:00Z', running: false },
      ], total: 2 })
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchBoundary)
    window.location.hash = '#/gas-city'
    const Overlay = overlayComponent()
    render(<Overlay />)

    fireEvent.click(await screen.findByRole('button', { name: 'Local Supervisor' }))
    fireEvent.click(await screen.findByRole('button', { name: 'gastown' }))

    const cityAgents = await screen.findByRole('region', { name: 'City and other agents' })
    expect(within(cityAgents).getByRole('button', { name: 'mayor' })).toBeTruthy()
    expect(within(cityAgents).getByRole('button', { name: 'City planning' })).toBeTruthy()
    expect(within(cityAgents).getByRole('button', { name: 'orphan/crew' })).toBeTruthy()
    expect(within(cityAgents).getByRole('button', { name: 'Orphan repair' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Other sessions' })).toBeNull()
  })

  it('uses state=all as the master session inventory and keeps unmatched sessions attachable', async () => {
    const requested: string[] = []
    const fetchBoundary = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      requested.push(path)
      if (path.endsWith('/config')) return Response.json({ workspace: { name: 'gastown' }, agents: [], rigs: [] })
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
      if (path.endsWith('/city/gastown/providers/public')) return Response.json({ items: [], total: 0 })
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

  it('loads later session pages with the opaque cursor and searches the loaded inventory', async () => {
    const requested: string[] = []
    const fetchBoundary = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      requested.push(path)
      if (path.endsWith('/config')) return Response.json({ workspace: { name: 'gastown' }, agents: [], rigs: [] })
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
      if (path.endsWith('/providers/public')) return Response.json({ items: [], total: 0 })
      if (path.endsWith('/sessions?state=all')) return Response.json({ items: [
        { id: 'session-1', template: 'main/crew', state: 'active', title: 'Repair alerts', provider: 'codex', session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: true },
      ], total: 2, next_cursor: 'opaque+/=cursor', partial: true, partial_errors: ['one rig was unavailable'] })
      if (path.endsWith('/sessions?state=all&cursor=opaque%2B%2F%3Dcursor')) return Response.json({ items: [
        { id: 'session-1', template: 'main/crew', state: 'active', title: 'Repair alerts updated', provider: 'codex', session_name: 'crew', created_at: '2026-08-26T00:00:00Z', running: true },
        { id: 'session-2', template: 'main/crew', state: 'suspended', title: 'Ship release', provider: 'codex', session_name: 'crew-2', created_at: '2026-08-25T00:00:00Z', running: false },
      ], total: 2 })
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchBoundary)
    window.location.hash = '#/gas-city'
    const Overlay = overlayComponent()
    render(<Overlay />)

    fireEvent.click(await screen.findByRole('button', { name: 'Local Supervisor' }))
    fireEvent.click(await screen.findByRole('button', { name: 'gastown' }))
    expect(await screen.findByText('Loaded 1 of 2 sessions')).toBeTruthy()
    expect(screen.getByText('Session inventory is partial: one rig was unavailable')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more sessions' }))
    expect(await screen.findByRole('button', { name: 'Ship release' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Repair alerts updated' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Repair alerts' })).toBeNull()
    expect(screen.getByText('Loaded 2 of 2 sessions')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load more sessions' })).toBeNull()
    expect(requested).toContain('/api/gas-city/v1/connections/local/city/gastown/sessions?state=all&cursor=opaque%2B%2F%3Dcursor')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search agents and sessions' }), {
      target: { value: 'ship' },
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Repair alerts' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Ship release' })).toBeTruthy()
  })

  it('drops a late pagination response after the user switches cities', async () => {
    let releaseOldPage!: () => void
    const oldPageBlocked = new Promise<void>(resolve => { releaseOldPage = resolve })
    const fetchBoundary = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/config')) {
        const cityName = path.includes('/city/newtown/') ? 'newtown' : 'oldtown'
        return Response.json({ workspace: { name: cityName }, agents: [], rigs: [] })
      }
      if (path.endsWith('/connections')) return Response.json({ connections: [
        { id: 'local', label: 'Local Supervisor', cities: ['oldtown', 'newtown'], available: true },
      ] })
      if (path.endsWith('/connections/local/cities')) return Response.json({ items: [
        { name: 'oldtown', path: '/srv/oldtown', running: true },
        { name: 'newtown', path: '/srv/newtown', running: true },
      ], total: 2 })
      if (path.endsWith('/rigs')) return Response.json({ items: [], total: 0 })
      if (path.endsWith('/agents')) return Response.json({ items: [], total: 0 })
      if (path.endsWith('/providers/public')) return Response.json({ items: [], total: 0 })
      if (path.includes('/city/oldtown/sessions?state=all&cursor=old-cursor')) {
        await oldPageBlocked
        return Response.json({ items: [{
          id: 'old-late', template: 'old/agent', state: 'suspended', title: 'Late old session', provider: 'codex',
          session_name: 'old', created_at: '2026-08-25T00:00:00Z', running: false,
        }], total: 2 })
      }
      if (path.includes('/city/oldtown/sessions?state=all')) return Response.json({
        items: [], total: 2, next_cursor: 'old-cursor',
      })
      if (path.includes('/city/newtown/sessions?state=all')) return Response.json({ items: [{
        id: 'new-session', template: 'new/agent', state: 'suspended', title: 'New city session', provider: 'gemini',
        session_name: 'new', created_at: '2026-08-26T00:00:00Z', running: false,
      }], total: 1 })
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchBoundary)
    window.location.hash = '#/gas-city'
    const Overlay = overlayComponent()
    render(<Overlay />)

    fireEvent.click(await screen.findByRole('button', { name: 'Local Supervisor' }))
    fireEvent.click(await screen.findByRole('button', { name: 'oldtown' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Load more sessions' }))
    fireEvent.click(screen.getByRole('button', { name: 'newtown' }))
    expect(await screen.findByRole('button', { name: 'New city session' })).toBeTruthy()
    releaseOldPage()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Late old session' })).toBeNull())
    expect(screen.getByText('Loaded 1 of 1 sessions')).toBeTruthy()
  })
})
