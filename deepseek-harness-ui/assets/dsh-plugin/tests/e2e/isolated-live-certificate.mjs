import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CleanupStack,
  formatOwnedError,
  runOwnedCommand,
} from './support/owned-process.mjs'

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const liveAgentFixture = join(pluginDir, 'tests/e2e/fixtures/live-agent-matrix')
const gcBin = process.env.GC_LIVE_GC_BIN === undefined ? undefined : resolve(process.env.GC_LIVE_GC_BIN)
if (gcBin === undefined) {
  process.stderr.write('UNPROVEN: GC_LIVE_GC_BIN must name the audited Gas City binary to certify\n')
  process.exit(2)
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('could not reserve a loopback port')
  await new Promise((resolveClose, rejectClose) => {
    server.close(error => error === undefined ? resolveClose() : rejectClose(error))
  })
  return address.port
}

async function waitForJson(url, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    if (interruptController.signal.aborted) throw interruptController.signal.reason
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([AbortSignal.timeout(5_000), interruptController.signal]),
      })
      if (response.ok) {
        const value = await response.json()
        if (predicate(value)) return value
        lastError = new Error(`${label} returned incomplete state: ${JSON.stringify(value).slice(0, 4_000)}`)
      } else {
        lastError = new Error(`${label} returned HTTP ${response.status}`)
      }
    } catch (error) {
      if (interruptController.signal.aborted) throw interruptController.signal.reason
      lastError = error
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
  }
  throw new Error(`${label} did not become ready: ${lastError?.message ?? 'no response'}`)
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function ownedTmuxServerExists(name) {
  try {
    await runOwnedCommand('tmux', ['-L', name, 'list-sessions'], {
      label: `owned tmux server ${name} probe`,
      timeoutMs: 5_000,
    })
    return true
  } catch {
    return false
  }
}

function includeSupervisorEnv(raw, name) {
  return [...new Set(`${raw ?? ''} ${name}`.split(/[\s,;]+/).filter(Boolean))].sort().join(',')
}

const interruptController = new AbortController()
let interruptedSignal
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (interruptController.signal.aborted) return
    interruptedSignal = signal
    interruptController.abort(new Error(`interrupted by ${signal}`))
  })
}
const resources = new CleanupStack()
const cityName = process.env.GC_LIVE_CITY ?? `dsh-live-${randomUUID().slice(0, 8)}`
const matrix = JSON.stringify({
  'live.release-claude': 'claude',
  'live.release-codex': 'codex',
})
const certificateOutput = resolve(process.env.GC_LIVE_CERTIFICATE ?? 'test-results/live-certificate.json')
let operationError
let diagnosticContext

async function collectFailureDiagnostics() {
  if (diagnosticContext === undefined) return undefined
  const { cityDir, cityName: diagnosticCity, env, supervisorUrl } = diagnosticContext
  const read = async path => {
    try {
      const response = await fetch(`${supervisorUrl}${path}`, { signal: AbortSignal.timeout(10_000) })
      return { status: response.status, body: await response.json() }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
  let status
  try {
    status = await runOwnedCommand(gcBin, ['status', '--city', cityDir], {
      cwd: cityDir,
      env,
      label: 'failure diagnostic city status',
      timeoutMs: 30_000,
    })
  } catch (error) {
    status = error instanceof Error ? error.message : String(error)
  }
  const cityBase = `/v0/city/${encodeURIComponent(diagnosticCity)}`
  const [health, city, sessions, agents, events] = await Promise.all([
    read('/health'),
    read(cityBase),
    read(`${cityBase}/sessions?state=all`),
    read(`${cityBase}/agents`),
    read(`${cityBase}/events?limit=200&since=15m`),
  ])
  return {
    health,
    city,
    sessions,
    agents,
    events,
    gc_status: status,
  }
}

async function appendFailureDiagnostics(diagnostics) {
  if (diagnostics === undefined) return
  try {
    const certificate = JSON.parse(await readFile(certificateOutput, 'utf8'))
    certificate.isolated_diagnostics = diagnostics
    await writeFile(certificateOutput, `${JSON.stringify(certificate, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`UNPROVEN: could not append isolated diagnostics: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

try {
  process.stdout.write('[1/6] validating the audited Gas City binary\n')
  await access(gcBin, constants.X_OK)
  const temporaryBase = process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches') : tmpdir()
  await mkdir(temporaryBase, { recursive: true })
  const root = await mkdtemp(join(temporaryBase, 'dsh-gc-live-'))
  resources.defer('isolated live root', () => rm(root, { recursive: true, force: true }))
  const gcHome = join(root, 'gc-home')
  const runtimeDir = join(root, 'runtime')
  const cityDir = join(root, cityName)
  await Promise.all([
    mkdir(gcHome, { recursive: true }),
    mkdir(runtimeDir, { recursive: true }),
  ])
  const port = await availablePort()
  await writeFile(join(gcHome, 'supervisor.toml'), [
    '[supervisor]',
    'bind = "127.0.0.1"',
    `port = ${port}`,
    'patrol_interval = "1s"',
    '',
  ].join('\n'), { mode: 0o600 })
  const env = {
    ...process.env,
    GC_HOME: gcHome,
    GC_BEADS: 'file',
    GC_SUPERVISOR_ENV: includeSupervisorEnv(process.env.GC_SUPERVISOR_ENV, 'GC_BEADS'),
    XDG_RUNTIME_DIR: runtimeDir,
    GC_SUPERVISOR_LOG_TEE: '0',
  }
  const supervisorUrl = `http://127.0.0.1:${port}`
  diagnosticContext = { cityDir, cityName, env, supervisorUrl }
  // CleanupStack is LIFO: uninstall the Supervisor first so it cannot restart
  // an always-on pool while the direct force-stop is reaping city sessions.
  resources.defer('disposable city processes', async () => {
    let stopError
    if (await pathExists(cityDir)) {
      try {
        await runOwnedCommand(gcBin, ['stop', '--force', '--timeout', '30s', cityDir], {
          cwd: root,
          env,
          label: 'disposable city force-stop',
          timeoutMs: 60_000,
        })
      } catch (error) {
        stopError = error
      }
    }
    if (await ownedTmuxServerExists(cityName)) {
      await runOwnedCommand('tmux', ['-L', cityName, 'kill-server'], {
        label: `owned tmux server ${cityName} cleanup`,
        timeoutMs: 10_000,
      })
    }
    if (await ownedTmuxServerExists(cityName)) {
      throw new Error(`owned tmux server remained after cleanup: ${cityName}`)
    }
    if (stopError !== undefined) throw stopError
  })
  resources.defer('isolated Supervisor service', async () => {
    await runOwnedCommand(gcBin, ['supervisor', 'uninstall'], {
      cwd: root,
      env,
      label: 'isolated Supervisor uninstall',
      timeoutMs: 120_000,
    })
  })

  process.stdout.write(`[2/6] creating the disposable city and letting gc init start its Supervisor on port ${port}\n`)
  await runOwnedCommand(gcBin, ['init',
    '--template', 'minimal',
    '--providers', 'claude,codex',
    '--default-provider', 'codex',
    '--name', cityName,
    '--yes',
    cityDir,
  ], {
    cwd: root,
    env,
    label: 'isolated gc init and start',
    signal: interruptController.signal,
    timeoutMs: 300_000,
    stdout: process.stdout,
    stderr: process.stderr,
  })
  process.stdout.write('[3/6] proving gc init started the Supervisor and city\n')
  await waitForJson(
    `${supervisorUrl}/health`,
    value => value?.status === 'ok',
    30_000,
    'isolated Supervisor health',
  )
  await waitForJson(
    `${supervisorUrl}/v0/cities`,
    value => value?.items?.some(city => city.name === cityName && city.running === true),
    120_000,
    'isolated running city inventory',
  )
  process.stdout.write('[4/6] importing two on-demand fixture agents and proving their providers\n')
  const fixtureDir = join(root, 'live-agent-matrix')
  await cp(liveAgentFixture, fixtureDir, { recursive: true })
  await runOwnedCommand(gcBin, ['import', 'add', fixtureDir, '--name', 'live', '--city', cityDir], {
    cwd: root,
    env,
    label: 'add live agent matrix import',
    signal: interruptController.signal,
    timeoutMs: 120_000,
  })
  await runOwnedCommand(gcBin, ['reload', cityDir], {
    cwd: root,
    env,
    label: 'reload live agent matrix',
    signal: interruptController.signal,
    timeoutMs: 120_000,
  })
  const expectedAgents = new Map(Object.entries(JSON.parse(matrix)))
  await waitForJson(
    `${supervisorUrl}/v0/city/${encodeURIComponent(cityName)}/agents`,
    value => [...expectedAgents].every(([name, provider]) => value?.items?.some(
      agent => agent.name === name && agent.provider === provider && agent.available === true,
    )),
    120_000,
    'isolated agent inventory',
  )

  process.stdout.write(`[5/6] running stock-DSH browser certification for ${expectedAgents.size} providers\n`)
  await runOwnedCommand(process.execPath, [join(pluginDir, 'tests/e2e/live-certificate.mjs')], {
    cwd: pluginDir,
    env: {
      ...env,
      DSH_E2E_ALLOW_MUTATION: '1',
      GC_LIVE_CITY: cityName,
      GC_LIVE_AGENT_MATRIX: matrix,
      GC_LIVE_CERTIFICATE: certificateOutput,
      GC_LIVE_BEADS_PROVIDER: 'file',
    },
    label: 'isolated live browser certificate',
    signal: interruptController.signal,
    forceKillAfterMs: 120_000,
    timeoutMs: 900_000,
    stdout: process.stdout,
    stderr: process.stderr,
  })
  process.stdout.write(`[6/6] isolated live certificate passed: ${certificateOutput}\n`)
} catch (error) {
  operationError = error
  const diagnostics = interruptedSignal === undefined ? await collectFailureDiagnostics() : undefined
  await appendFailureDiagnostics(diagnostics)
  if (diagnostics !== undefined) {
    process.stderr.write(`[isolated failure diagnostics] ${JSON.stringify(diagnostics, null, 2)}\n`)
  }
}

let finalError
try {
  await resources.close(operationError)
} catch (error) {
  finalError = error
}
if (finalError !== undefined) {
  process.stderr.write(`UNPROVEN: ${formatOwnedError(finalError)}\n`)
  process.exitCode = interruptedSignal === undefined ? 2 : 130
}
