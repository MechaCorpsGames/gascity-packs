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

function captureOverlay(): ComponentType<Record<string, unknown>> {
  let Overlay: ComponentType<Record<string, unknown>> | undefined
  const slots = {
    inject(_name: string, register: () => unknown) { return register() },
    register(options: { id?: string }, component: ComponentType<Record<string, unknown>>) {
      if (options.id === 'gas-city-workspace-overlay') Overlay = component
      return () => undefined
    },
  }
  apply({ slots } as never)
  if (Overlay === undefined) throw new Error('overlay not registered')
  return Overlay
}

describe('Gas City city discovery', () => {
  it('loads authoritative city readiness only after a Supervisor is selected', async () => {
    const fetchBoundary = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/connections')) {
        return new Response(JSON.stringify({ connections: [{
          id: 'local-supervisor', label: 'Local Supervisor', cities: ['gastown'], available: true,
        }] }), { status: 200 })
      }
      if (path.endsWith('/connections/local-supervisor/cities')) {
        return new Response(JSON.stringify({ items: [
          { name: 'gastown', path: '/srv/gastown', running: true, status: 'running' },
          { name: 'sleepy', path: '/srv/sleepy', running: false, status: 'starting' },
        ], total: 2 }), { status: 200 })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchBoundary)
    window.location.hash = '#/gas-city'
    const Overlay = captureOverlay()
    render(<Overlay />)

    fireEvent.click(await screen.findByRole('button', { name: 'Local Supervisor' }))

    expect(await screen.findByRole('button', { name: 'gastown' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'sleepy' })).toHaveProperty('disabled', true)
    expect(fetchBoundary).toHaveBeenCalledWith(
      '/api/gas-city/v1/connections/local-supervisor/cities',
      { headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal) },
    )
  })
})
