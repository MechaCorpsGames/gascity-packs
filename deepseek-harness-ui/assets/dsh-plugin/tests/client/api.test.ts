import { describe, expect, it, vi } from 'vitest'

import { loadCityTopology } from '../../src/client/api.js'

describe('Gas City browser API errors', () => {
  it('merges cold configured pools into the live agent inventory without duplicating running pool instances', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/config')) return Response.json({
        workspace: { name: 'demo' },
        agents: [
          { name: 'workers', provider: 'codex', is_pool: true, suspended: false },
          { name: 'cold-reviewers', dir: 'review', provider: 'claude', is_pool: true, suspended: false },
        ],
        rigs: [],
      })
      if (path.endsWith('/agents')) return Response.json({ items: [{
        name: 'workers-1', pool: 'workers', provider: 'codex', running: true,
        suspended: false, available: true, state: 'running',
      }], total: 1 })
      return Response.json({ items: [], total: 0 })
    }) as typeof fetch
    try {
      const topology = await loadCityTopology('local', 'demo', new AbortController().signal)
      expect(topology.agents).toEqual([
        expect.objectContaining({ name: 'workers-1', pool: 'workers', running: true, available: true }),
        expect.objectContaining({
          name: 'review/cold-reviewers', rig: 'review', provider: 'claude', running: false,
          available: true, state: 'configured', configured: true, is_pool: true,
        }),
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('preserves the direct read-grant diagnostic from Problem Details', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/config')) return Response.json({ workspace: { name: 'demo' }, agents: [], rigs: [] })
      return path.endsWith('/rigs') ? Response.json({
          title: 'Unauthorized', status: 401, detail: 'missing X-GC-City-Read grant',
        }, { status: 401 })
        : Response.json({ items: [], total: 0 })
    }) as typeof fetch
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
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/config')) return Response.json({ workspace: { name: 'demo' }, agents: [], rigs: [] })
      return path.endsWith('/agents')
        ? Response.json({ items: 'not-an-array', total: 1 })
        : Response.json({ items: [], total: 0 })
    }) as typeof fetch
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
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/config')) return Response.json({ workspace: { name: 'demo' }, agents: [], rigs: [] })
      return path.endsWith('/providers/public') ? Response.json({
          items: [{
            name: 'codex', builtin: true, city_level: false,
            options_schema: [{ key: 'permission_mode', label: 'Mode', type: 'choice', default: 'plan', choices: 'unsafe' }],
          }],
          total: 1,
        })
        : Response.json({ items: [], total: 0 })
    }) as typeof fetch
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
