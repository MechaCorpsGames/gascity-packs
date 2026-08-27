import { describe, expect, it } from 'vitest'

import { apply, inject } from '../../src/client/index.js'

describe('Gas City client plugin', () => {
  it('registers additive, uniquely-keyed DSH sidebar and overlay surfaces', () => {
    const injected: string[] = []
    const registrations: Array<{ name: string; id?: string }> = []
    const slots = {
      inject(name: string, register: () => unknown) {
        injected.push(name)
        return register()
      },
      register(options: { name: string; id?: string }, _component: unknown) {
        registrations.push(options)
        return () => undefined
      },
    }

    apply({ slots } as never)

    expect(inject).toEqual(['slots'])
    expect(injected).toEqual(['sidebar.footer.action', 'shell.overlay'])
    expect(registrations).toEqual([
      { name: 'sidebar.footer.action', id: 'gas-city-workspace-action' },
      { name: 'shell.overlay', id: 'gas-city-workspace-overlay' },
    ])
  })
})
