import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { startMockSupervisor } from '../mock-supervisor.mjs'
import { checkArtifact } from '../check-artifact.mjs'
import {
  CleanupStack,
  runOwnedCommand,
  spawnOwnedCommand,
} from './owned-process.mjs'

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const packDir = resolve(pluginDir, '../..')

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function pluginPresent(manifest, packageName) {
  const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
  if (dependencySections.some(section => manifest?.[section]?.[packageName] !== undefined)) return true
  return manifest?.dsh?.profile?.bundles?.includes(packageName) === true
}

function normalizedProfile(manifest) {
  const normalized = structuredClone(manifest)
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (normalized?.[section] !== null
      && typeof normalized?.[section] === 'object'
      && Object.keys(normalized[section]).length === 0) {
      delete normalized[section]
    }
  }
  return normalized
}

export function assertProfileRestored(baseline, restored, packageName) {
  if (pluginPresent(restored, packageName)) {
    throw new Error(`${packageName} is still present after uninstall`)
  }
  if (canonicalJson(normalizedProfile(restored)) !== canonicalJson(normalizedProfile(baseline))) {
    throw new Error(`DSH web profile did not restore its pre-install semantics; baseline=${canonicalJson(baseline)} restored=${canonicalJson(restored)}`)
  }
}

async function snapshotFile(path) {
  try {
    const [bytes, info] = await Promise.all([readFile(path), stat(path)])
    return { exists: true, bytes, mode: info.mode & 0o777 }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false }
    throw error
  }
}

async function assertFileUnchanged(path, before) {
  const after = await snapshotFile(path)
  if (after.exists !== before.exists) throw new Error(`${path} existence changed`)
  if (!before.exists) return
  if (!after.bytes.equals(before.bytes) || after.mode !== before.mode) {
    throw new Error(`${path} contents or permissions changed`)
  }
}

async function readVersions() {
  const text = await readFile(join(packDir, 'assets/versions.env'), 'utf8')
  const value = name => new RegExp(`^${name}=(.+)$`, 'm').exec(text)?.[1]
  const versions = {
    artifactSha: value('PLUGIN_SHA256'),
    dshVersion: value('DSH_VERSION'),
    packageName: value('PLUGIN_PACKAGE'),
  }
  if (Object.values(versions).some(item => item === undefined || item === '')) {
    throw new Error('pack runtime pins are incomplete')
  }
  return versions
}

async function failWithCleanup(resources, error) {
  try {
    await resources.close(error)
  } catch (combined) {
    throw combined
  }
}

async function startInstalledStack({ gcHome, progress, resources, root, fixture }) {
  const versions = await readVersions()
  const dshHome = join(root, 'dsh-home')
  const profileManifest = join(dshHome, 'profiles/web/package.json')
  let step = 0
  const total = 8
  const tick = message => progress(`[${++step}/${total}] ${message}`)

  await writeFile(join(root, 'pnpm'), `#!/bin/sh\nexec "${join(pluginDir, 'node_modules/.bin/pnpm')}" "$@"\n`)
  await chmod(join(root, 'pnpm'), 0o755)
  await writeFile(join(root, 'dsh'), `#!/bin/sh\nexec "${join(pluginDir, 'node_modules/.bin/dsh')}" "$@"\n`)
  await chmod(join(root, 'dsh'), 0o755)
  const env = {
    ...process.env,
    DSH_HOME: dshHome,
    GC_HOME: gcHome,
    GC_PACK_DIR: packDir,
    PATH: `${root}:${join(pluginDir, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
  }
  const gcSnapshots = new Map()
  for (const name of ['supervisor.toml', 'contexts.toml']) {
    gcSnapshots.set(name, await snapshotFile(join(gcHome, name)))
  }

  tick('initializing an exact clean stock DSH web profile')
  await runOwnedCommand('dsh', ['plugin', '--profile', 'web', 'list', '--depth', '0'], {
    env,
    cwd: root,
    label: 'stock DSH profile initialization',
    timeoutMs: 120_000,
  })
  const baselineProfile = JSON.parse(await readFile(profileManifest, 'utf8'))

  resources.defer('pack uninstall and state preservation', async () => {
    const current = JSON.parse(await readFile(profileManifest, 'utf8'))
    if (pluginPresent(current, versions.packageName)) {
      progress('[cleanup] uninstalling through the real pack command')
      await runOwnedCommand(join(packDir, 'commands/uninstall.sh'), [], {
        env,
        cwd: root,
        label: 'pack uninstall',
        timeoutMs: 120_000,
      })
    }
    const restored = JSON.parse(await readFile(profileManifest, 'utf8'))
    assertProfileRestored(baselineProfile, restored, versions.packageName)
    for (const [name, snapshot] of gcSnapshots) {
      await assertFileUnchanged(join(gcHome, name), snapshot)
    }
    progress('[cleanup] DSH profile restored and both GC config files preserved')
  })

  tick('rebuilding and byte-comparing the deterministic plugin artifact')
  await checkArtifact(message => progress(`  ${message}`))
  tick('installing the checksum-pinned plugin through the real pack command')
  await runOwnedCommand(join(packDir, 'commands/install.sh'), [], {
    env,
    cwd: root,
    label: 'pack install',
    timeoutMs: 180_000,
  })

  tick('attesting the package-local stock DSH version')
  const dshVersionOutput = await runOwnedCommand('dsh', ['--version'], {
    env,
    cwd: root,
    label: 'stock DSH version',
    timeoutMs: 10_000,
  })
  const dshVersion = dshVersionOutput.split(/\r?\n/).map(line => line.trim()).find(line => line === versions.dshVersion)
  if (dshVersion !== versions.dshVersion) {
    throw new Error(`stock DSH version output did not contain exact ${versions.dshVersion}`)
  }

  tick('starting exact stock dsh web on loopback')
  const dsh = spawnOwnedCommand('dsh', ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: root,
    env,
  })
  resources.defer('stock DSH process', async () => {
    progress('[cleanup] stopping the runner-owned stock DSH process group')
    await dsh.stop()
  })

  const url = await new Promise((resolveUrl, reject) => {
    const deadline = setTimeout(() => reject(new Error(`dsh web URL timeout\n${dsh.output}`)), 20_000)
    const inspect = chunk => {
      const match = chunk.toString('utf8').match(/http:\/\/127\.0\.0\.1:\d+/)
        ?? dsh.output.match(/http:\/\/127\.0\.0\.1:\d+/)
      if (match !== null) {
        clearTimeout(deadline)
        resolveUrl(match[0])
      }
    }
    dsh.child.stdout?.on('data', inspect)
    dsh.child.stderr?.on('data', inspect)
    inspect(Buffer.alloc(0))
    dsh.completion.then(
      ({ code, signal }) => {
        clearTimeout(deadline)
        reject(new Error(`dsh web exited ${code ?? signal}\n${dsh.output}`))
      },
      error => {
        clearTimeout(deadline)
        reject(error)
      },
    )
  })
  tick(`stock dsh ready at ${url}`)
  const connections = await fetch(`${url}/api/gas-city/v1/connections`, { signal: AbortSignal.timeout(10_000) })
  if (!connections.ok) throw new Error(`pack gateway readiness returned ${connections.status}`)
  const inventory = await connections.json()
  if (!Array.isArray(inventory.connections)) throw new Error('pack gateway returned an invalid connection inventory')
  tick('pack gateway returned its connection inventory')
  tick('installed stock stack is ready for browser verification')

  return {
    url,
    env,
    fixture,
    inventory,
    dshVersion,
    artifactSha: versions.artifactSha,
    packageName: versions.packageName,
    async close() {
      await resources.close()
    },
  }
}

export async function startOwnedStack(progress = () => {}) {
  const resources = new CleanupStack()
  try {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-harness-ui-e2e-'))
    resources.defer('owned temporary directory', () => rm(root, { recursive: true, force: true }))
    const fixture = await startMockSupervisor()
    resources.defer('fixture Supervisor', () => fixture.close())
    progress(`[fixture] Supervisor listening on random port ${fixture.port}`)
    const gcHome = join(root, 'gc-home')
    await mkdir(gcHome, { recursive: true })
    await writeFile(join(gcHome, 'supervisor.toml'), `[supervisor]\nbind = "127.0.0.1"\nport = ${fixture.port}\n`)
    await writeFile(join(gcHome, 'contexts.toml'), '', { mode: 0o600 })
    return await startInstalledStack({ gcHome, progress, resources, root, fixture })
  } catch (error) {
    return await failWithCleanup(resources, error)
  }
}

export async function startOwnedLiveStack({ gcHome, progress = () => {} }) {
  const resources = new CleanupStack()
  try {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-harness-ui-live-'))
    resources.defer('owned temporary directory', () => rm(root, { recursive: true, force: true }))
    return await startInstalledStack({
      gcHome: resolve(gcHome),
      progress,
      resources,
      root,
      fixture: undefined,
    })
  } catch (error) {
    return await failWithCleanup(resources, error)
  }
}
