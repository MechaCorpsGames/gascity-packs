import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { runOwnedCommand } from './support/owned-process.mjs'

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const packDir = resolve(pluginDir, '../..')

export async function checkArtifact(progress = () => {}) {
  const versions = await readFile(join(packDir, 'assets/versions.env'), 'utf8')
  const artifactName = /^PLUGIN_ARTIFACT=(.+)$/m.exec(versions)?.[1]
  const pinnedSha = /^PLUGIN_SHA256=(.+)$/m.exec(versions)?.[1]
  if (artifactName === undefined || pinnedSha === undefined) throw new Error('artifact pins are incomplete')
  const temporary = await mkdtemp(join(tmpdir(), 'deepseek-harness-ui-pack-'))
  try {
    progress('[1/3] rebuilding the plugin from checked-in source')
    await runOwnedCommand(join(pluginDir, 'node_modules/.bin/pnpm'), ['run', 'build'], {
      cwd: pluginDir,
      label: 'plugin build',
      timeoutMs: 120_000,
    })
    progress('[2/3] producing a fresh deterministic package tarball')
    await runOwnedCommand(join(pluginDir, 'node_modules/.bin/pnpm'), ['pack', '--pack-destination', temporary], {
      cwd: pluginDir,
      label: 'plugin pack',
      timeoutMs: 60_000,
    })
    const [fresh, committed] = await Promise.all([
      readFile(join(temporary, artifactName)),
      readFile(join(packDir, 'assets/dist', artifactName)),
    ])
    const freshSha = createHash('sha256').update(fresh).digest('hex')
    if (freshSha !== pinnedSha || !fresh.equals(committed)) {
      throw new Error(`rebuilt artifact ${freshSha} does not byte-match pin ${pinnedSha}`)
    }
    progress('[3/3] rebuilt tarball byte-matches the committed checksum pin')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkArtifact(message => process.stdout.write(`${message}\n`))
}
