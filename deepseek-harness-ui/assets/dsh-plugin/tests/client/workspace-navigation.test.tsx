// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { apply } from '../../src/client/index.js'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('Gas City workspace navigation', () => {
  it('opens from the DSH sidebar and closes back to the previous hash', () => {
    const components = new Map<string, ComponentType<Record<string, unknown>>>()
    const slots = {
      inject(_name: string, register: () => unknown) {
        return register()
      },
      register(options: { id?: string }, component: ComponentType<Record<string, unknown>>) {
        if (options.id !== undefined) components.set(options.id, component)
        return () => undefined
      },
    }
    apply({ slots } as never)
    const Action = components.get('gas-city-workspace-action')
    const Overlay = components.get('gas-city-workspace-overlay')
    if (Action === undefined || Overlay === undefined) throw new Error('Gas City client slots not registered')

    window.location.hash = '#/sessions'
    render(
      <>
        <Action wide />
        <Overlay />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Gas City' }))
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')))
    expect(window.location.hash).toBe('#/gas-city')
    expect(screen.getByRole('dialog', { name: 'Gas City' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close Gas City' }))
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')))
    expect(window.location.hash).toBe('#/sessions')
    expect(screen.queryByRole('dialog', { name: 'Gas City' })).toBeNull()
  })
})
