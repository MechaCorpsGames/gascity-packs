import { spawn } from 'node:child_process'

const DEFAULT_OUTPUT_LIMIT = 200_000
const DEFAULT_FORCE_KILL_MS = 5_000
const DEFAULT_REAP_MS = 5_000
const DEFAULT_TIMEOUT_MS = 120_000

function appendBounded(current, chunk, limit) {
  return (current + chunk.toString('utf8')).slice(-limit)
}

function delay(milliseconds, value) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, milliseconds, value)
    timer.unref?.()
  })
}

function signalOwnedGroup(child, signal) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

export function spawnOwnedCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const outputLimit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT
  let output = ''
  let settled = false
  const completion = new Promise((resolve, reject) => {
    child.stdout?.on('data', chunk => {
      output = appendBounded(output, chunk, outputLimit)
      options.stdout?.write?.(chunk)
    })
    child.stderr?.on('data', chunk => {
      output = appendBounded(output, chunk, outputLimit)
      options.stderr?.write?.(chunk)
    })
    child.once('error', error => {
      settled = true
      reject(error)
    })
    child.once('close', (code, signal) => {
      settled = true
      resolve({ code, signal })
    })
  })

  return {
    child,
    completion,
    get output() { return output },
    async stop({ forceKillAfterMs = DEFAULT_FORCE_KILL_MS, reapAfterMs = DEFAULT_REAP_MS } = {}) {
      if (settled) {
        await completion
        return
      }
      const observedCompletion = completion.then(
        () => ({ closed: true }),
        error => ({ closed: true, error }),
      )
      signalOwnedGroup(child, 'SIGTERM')
      const first = await Promise.race([
        observedCompletion,
        delay(forceKillAfterMs, { closed: false }),
      ])
      if (first.closed) {
        if (first.error !== undefined) throw first.error
        return
      }
      if (!settled) signalOwnedGroup(child, 'SIGKILL')
      const reaped = await Promise.race([
        observedCompletion,
        delay(reapAfterMs, { closed: false }),
      ])
      if (!reaped.closed) {
        const error = new Error(`owned process group ${child.pid ?? '<unknown>'} did not reap within ${reapAfterMs}ms`)
        error.output = output
        throw error
      }
      if (reaped.error !== undefined) throw reaped.error
    },
  }
}

export async function runOwnedCommand(command, args, options = {}) {
  const label = options.label ?? command
  if (options.signal?.aborted) {
    const detail = options.signal.reason instanceof Error
      ? options.signal.reason.message
      : String(options.signal.reason ?? 'aborted')
    const error = new Error(`${label} aborted: ${detail}`)
    error.output = ''
    throw error
  }
  const owned = spawnOwnedCommand(command, args, options)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let abortListener
  const aborted = options.signal === undefined
    ? new Promise(() => {})
    : new Promise(resolve => {
        abortListener = () => resolve({ kind: 'aborted', reason: options.signal.reason })
        options.signal.addEventListener('abort', abortListener, { once: true })
      })
  let outcome
  try {
    outcome = await Promise.race([
      owned.completion.then(result => ({ kind: 'completed', result })),
      delay(timeoutMs, { kind: 'timeout' }),
      aborted,
    ])
  } finally {
    if (abortListener !== undefined) options.signal.removeEventListener('abort', abortListener)
  }
  if (outcome.kind === 'aborted') {
    await owned.stop({
      forceKillAfterMs: options.forceKillAfterMs,
      reapAfterMs: options.reapAfterMs,
    })
    const detail = outcome.reason instanceof Error
      ? outcome.reason.message
      : String(outcome.reason ?? 'aborted')
    const error = new Error(`${label} aborted: ${detail}`)
    error.output = owned.output
    throw error
  }
  if (outcome.kind === 'timeout') {
    await owned.stop({
      forceKillAfterMs: options.forceKillAfterMs,
      reapAfterMs: options.reapAfterMs,
    })
    const error = new Error(`${label} timed out after ${timeoutMs}ms`)
    error.output = owned.output
    throw error
  }
  if (outcome.result.code !== 0) {
    const error = new Error(
      `${options.label ?? `${command} ${args.join(' ')}`} exited ${outcome.result.code ?? outcome.result.signal}\n${owned.output}`,
    )
    error.output = owned.output
    throw error
  }
  return owned.output
}

export function formatOwnedError(error, indent = '') {
  const detail = error instanceof Error ? error.message : String(error)
  if (!(error instanceof AggregateError)) return `${indent}${detail}`
  return [
    `${indent}${detail}`,
    ...error.errors.map(item => formatOwnedError(item, `${indent}  - `)),
  ].join('\n')
}

export class CleanupStack {
  #cleanups = []
  #closed = false

  defer(label, cleanup) {
    if (this.#closed) throw new Error('cleanup stack is already closed')
    this.#cleanups.push({ label, cleanup })
  }

  async close(primaryError) {
    if (this.#closed) {
      if (primaryError !== undefined) throw primaryError
      return
    }
    this.#closed = true
    const errors = primaryError === undefined ? [] : [primaryError]
    for (const { label, cleanup } of this.#cleanups.reverse()) {
      try {
        await cleanup()
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        errors.push(new Error(`${label} cleanup failed: ${detail}`, { cause: error }))
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'operation and owned-resource cleanup failed')
  }
}
