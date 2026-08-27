import { strict as assert } from 'node:assert'
import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  CleanupStack,
  runOwnedCommand,
} from './support/owned-process.mjs'
import { assertProfileRestored } from './support/owned-stack.mjs'
import {
  closeRunOwnedSessions,
  newCompletedToolCallIds,
  sessionEvidence,
} from './support/live-evidence.mjs'

const execFileAsync = promisify(execFile)
const supportDir = resolve(dirname(fileURLToPath(import.meta.url)), 'support')

describe('owned E2E infrastructure', () => {
  it('does not keep the caller alive for a completed command timeout', async () => {
    const script = [
      `import { runOwnedCommand } from ${JSON.stringify(resolve(supportDir, 'owned-process.mjs'))}`,
      `await runOwnedCommand(process.execPath, ['-e', ''], { timeoutMs: 30_000 })`,
    ].join(';')

    await expect(execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
      timeout: 2_000,
    })).resolves.toMatchObject({ stdout: '', stderr: '' })
  })

  it('terminates and reaps a command that exceeds its deadline', async () => {
    const script = [
      "process.on('SIGTERM', () => {})",
      "process.stdout.write(String(process.pid) + '\\n')",
      'setInterval(() => {}, 1_000)',
    ].join(';')

    let failure
    try {
      await runOwnedCommand(process.execPath, ['-e', script], {
        forceKillAfterMs: 30,
        timeoutMs: 500,
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain('timed out')
    const pid = Number(/\b(\d+)\b/.exec(failure.output)?.[1])
    assert(Number.isSafeInteger(pid), `missing child pid in ${failure.output}`)
    await expect(execFileAsync('kill', ['-0', String(pid)])).rejects.toMatchObject({ code: 1 })
  })

  it('runs every cleanup in reverse order and aggregates cleanup failures', async () => {
    const calls = []
    const resources = new CleanupStack()
    resources.defer('first', async () => { calls.push('first') })
    resources.defer('second', async () => {
      calls.push('second')
      throw new Error('second failed')
    })
    resources.defer('third', async () => {
      calls.push('third')
      throw new Error('third failed')
    })

    let failure
    try {
      await resources.close(new Error('operation failed'))
    } catch (error) {
      failure = error
    }

    expect(calls).toEqual(['third', 'second', 'first'])
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.errors.map(error => error.message)).toEqual([
      'operation failed',
      'third cleanup failed: third failed',
      'second cleanup failed: second failed',
    ])
  })

  it('requires uninstall to restore the stock profile and remove the pack', () => {
    const baseline = {
      dependencies: { '@deepseek-ai/dsh-base': '0.1.1-rc.2' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    }
    const restored = structuredClone(baseline)
    expect(() => assertProfileRestored(
      baseline,
      restored,
      '@gastownhall/deepseek-harness-ui',
    )).not.toThrow()

    const retained = structuredClone(baseline)
    retained.dependencies['@gastownhall/deepseek-harness-ui'] = 'file:plugin.tgz'
    retained.dsh.profile.bundles.push('@gastownhall/deepseek-harness-ui')
    expect(() => assertProfileRestored(
      baseline,
      retained,
      '@gastownhall/deepseek-harness-ui',
    )).toThrow('still present')

    const changed = structuredClone(baseline)
    changed.dependencies['@deepseek-ai/dsh-base'] = '0.1.2'
    expect(() => assertProfileRestored(
      baseline,
      changed,
      '@gastownhall/deepseek-harness-ui',
    )).toThrow('did not restore')

    const emptyDependencies = { ...baseline, dependencies: {} }
    const omittedDependencies = structuredClone(baseline)
    delete omittedDependencies.dependencies
    expect(() => assertProfileRestored(
      emptyDependencies,
      omittedDependencies,
      '@gastownhall/deepseek-harness-ui',
    )).not.toThrow()
  })

  it('accepts only an authoritative final assistant nonce from the expected provider', () => {
    const session = { id: 'session-1', template: 'rig/reviewer', provider: 'claude' }
    const transcript = {
      id: 'session-1',
      template: 'rig/reviewer',
      provider: 'claude',
      schema_version: 'session.structured.v1',
      structured_messages: [
        { id: 'user-1', role: 'user', status: 'final', blocks: [{ type: 'text', text: 'nonce-1' }] },
        { id: 'assistant-1', role: 'assistant', status: 'final', blocks: [
          { type: 'text', text: 'completed nonce-1' },
          { type: 'tool_use', id: 'tool-1', name: 'Read' },
          { type: 'tool_result', tool_call_id: 'tool-1', content: 'ok' },
        ] },
      ],
    }

    expect(sessionEvidence(session, transcript, {
      expectedTemplate: 'rig/reviewer',
      expectedProvider: 'claude',
      nonce: 'nonce-1',
    })).toEqual({
      assistantMessageIds: ['assistant-1'],
      provider: 'claude',
      schemaVersion: 'session.structured.v1',
      toolResultCallIds: ['tool-1'],
      toolResultCount: 1,
      toolUseIds: ['tool-1'],
      toolUseCount: 1,
    })
    expect(() => sessionEvidence(session, transcript, {
      expectedTemplate: 'rig/reviewer',
      expectedProvider: 'codex',
      nonce: 'nonce-1',
    })).toThrow('provider')
    expect(() => sessionEvidence(session, {
      ...transcript,
      provider: 'codex',
    }, {
      expectedTemplate: 'rig/reviewer',
      expectedProvider: 'claude',
      nonce: 'nonce-1',
    })).toThrow('transcript provider')
    expect(() => sessionEvidence(session, transcript, {
      expectedTemplate: 'other/agent',
      expectedProvider: 'claude',
      nonce: 'nonce-1',
    })).toThrow('template')
    expect(() => sessionEvidence(session, {
      ...transcript,
      structured_messages: transcript.structured_messages.slice(0, 1),
    }, {
      expectedTemplate: 'rig/reviewer',
      expectedProvider: 'claude',
      nonce: 'nonce-1',
    })).toThrow('final assistant')
  })

  it('attempts cleanup for every run-owned session and reports only those still open', async () => {
    const calls = []
    const states = new Map([['one', 'active'], ['two', 'active'], ['closed', 'closed']])
    const result = await closeRunOwnedSessions(['one', 'two', 'closed'], {
      async getSession(id) { return { id, state: states.get(id) } },
      async closeSession(id) {
        calls.push(id)
        if (id === 'two') throw new Error('close failed')
        states.set(id, 'closed')
      },
    })

    expect(calls).toEqual(['one', 'two'])
    expect(result.remainingSessionIds).toEqual(['two'])
    expect(result.errors.map(error => error.message)).toEqual(['two: close failed'])
  })

  it('proves only new tool calls that gained matching results', () => {
    const before = {
      toolUseIds: ['old-complete', 'old-open'],
      toolResultCallIds: ['old-complete'],
    }
    const after = {
      toolUseIds: ['old-complete', 'old-open', 'new-complete', 'new-open'],
      toolResultCallIds: ['old-complete', 'old-open', 'new-complete'],
    }

    expect(newCompletedToolCallIds(before, after)).toEqual(['new-complete'])
  })
})
