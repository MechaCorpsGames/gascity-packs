import { describe, expect, it, vi } from 'vitest'

import { loadCityTopology } from '../../src/client/api.js'

describe('Gas City browser API errors', () => {
  it('preserves the direct read-grant diagnostic from Problem Details', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/rigs')
      ? Response.json({
          title: 'Unauthorized', status: 401, detail: 'missing X-GC-City-Read grant',
        }, { status: 401 })
      : Response.json({ items: [], total: 0 })) as typeof fetch
    try {
      await expect(loadCityTopology('local', 'demo', new AbortController().signal)).rejects.toThrow(
        'missing X-GC-City-Read grant',
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects malformed list envelopes with a compatibility diagnostic', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/agents')
      ? Response.json({ items: 'not-an-array', total: 1 })
      : Response.json({ items: [], total: 0 })) as typeof fetch
    try {
      await expect(loadCityTopology('local', 'demo', new AbortController().signal)).rejects.toThrow(
        'Incompatible Supervisor agents response: items must be an array',
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fails malformed provider options closed without hiding the provider', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/providers/public')
      ? Response.json({
          items: [{
            name: 'codex', builtin: true, city_level: false,
            options_schema: [{ key: 'permission_mode', label: 'Mode', type: 'choice', default: 'plan', choices: 'unsafe' }],
          }],
          total: 1,
        })
      : Response.json({ items: [], total: 0 })) as typeof fetch
    try {
      const topology = await loadCityTopology('local', 'demo', new AbortController().signal)
      expect(topology.providers[0]).toMatchObject({
        name: 'codex',
        compatibility_error: 'Provider codex options are incompatible: choices must be an array',
      })
      expect(topology.providers[0]!.options_schema).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
