// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apply } from '../../src/client/index.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.location.hash = ''
})

describe('Gas City workspace inventory', () => {
  it('loads the secret-free connection inventory through the same-origin gateway', async () => {
    const fetchBoundary = vi.fn(async () => new Response(JSON.stringify({
      connections: [{
        id: 'local-supervisor',
        label: 'Local Supervisor',
        cities: ['gastown'],
        available: true,
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchBoundary)

    let Overlay: ComponentType<Record<string, unknown>> | undefined
    const slots = {
      inject(_name: string, register: () => unknown) {
        return register()
      },
      register(options: { id?: string }, component: ComponentType<Record<string, unknown>>) {
        if (options.id === 'gas-city-workspace-overlay') Overlay = component
        return () => undefined
      },
    }
    apply({ slots } as never)
    if (Overlay === undefined) throw new Error('overlay not registered')
    const OverlayComponent = Overlay
    window.location.hash = '#/gas-city'

    render(<OverlayComponent />)

    expect(await screen.findByRole('button', { name: 'Local Supervisor' })).toBeTruthy()
    expect(screen.getByText('gastown')).toBeTruthy()
    expect(fetchBoundary).toHaveBeenCalledWith('/api/gas-city/v1/connections', {
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    })
  })
})
