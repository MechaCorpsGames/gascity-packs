#!/bin/sh
set -eu

pack_dir="${GC_PACK_DIR:-$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)}"
compatibility="$pack_dir/assets/dsh-compatibility.json"

if ! reported=$(dsh --version 2>/dev/null); then
  echo "dsh is required; install @deepseek-ai/dsh"
  exit 2
fi

case "$reported" in
  "dsh "*) actual=${reported#dsh } ;;
  *) actual=$reported ;;
esac

DSH_ACTUAL_VERSION=$actual DSH_COMPATIBILITY=$compatibility exec node - <<'NODE'
const fs = require('node:fs')

function parseVersion(raw) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw)
  if (match === null) throw new Error('invalid version')
  const prerelease = match[4] === undefined ? [] : match[4].split('.').map((part) => {
    if (part === '' || !/^[0-9A-Za-z-]+$/.test(part)) throw new Error('invalid prerelease')
    return /^\d+$/.test(part) ? Number(part) : part
  })
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease }
}

function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] < right.core[index] ? -1 : 1
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0
    return left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === rightPart) continue
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (typeof leftPart === 'number' && typeof rightPart !== 'number') return -1
    if (typeof leftPart !== 'number' && typeof rightPart === 'number') return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

try {
  const actual = process.env.DSH_ACTUAL_VERSION?.trim() ?? ''
  const compatibility = JSON.parse(fs.readFileSync(process.env.DSH_COMPATIBILITY, 'utf8'))
  if (compatibility.schema !== 1
    || typeof compatibility.minimum_version !== 'string'
    || !Array.isArray(compatibility.certified)
    || !Array.isArray(compatibility.known_incompatible)) {
    throw new Error('invalid compatibility manifest')
  }
  const parsedActual = parseVersion(actual)
  if (compare(parsedActual, parseVersion(compatibility.minimum_version)) < 0) {
    console.log(`dsh ${actual} is older than minimum ${compatibility.minimum_version}`)
    process.exit(2)
  }
  const incompatible = compatibility.known_incompatible.find(item => item?.version === actual)
  if (incompatible !== undefined) {
    const reason = typeof incompatible.reason === 'string' && incompatible.reason !== ''
      ? `: ${incompatible.reason}`
      : ''
    console.log(`dsh ${actual} is known incompatible${reason}`)
    process.exit(2)
  }
  if (compatibility.certified.some(item => item?.version === actual)) {
    console.log(`dsh ${actual} is certified for this pack release`)
    process.exit(0)
  }
  console.log(`dsh ${actual} is not yet certified; installation may continue, but browser compatibility is unverified for this version`)
} catch {
  console.log(`dsh ${process.env.DSH_ACTUAL_VERSION ?? ''} could not be evaluated against the pack compatibility manifest`)
  process.exit(2)
}
NODE
