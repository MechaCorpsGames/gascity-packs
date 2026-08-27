#!/bin/sh
set -eu

pack_dir="${GC_PACK_DIR:-$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)}"
# shellcheck source=/dev/null
. "$pack_dir/assets/versions.env"
dsh_home=${DSH_HOME:-"$HOME/.dsh"}
profile_manifest="$dsh_home/profiles/web/package.json"

if [ ! -f "$profile_manifest" ]; then
  echo "DSH web profile is missing: $profile_manifest"
  echo "Run the pack install command to initialize and install it."
  exit 2
fi

if node - "$profile_manifest" "$PLUGIN_PACKAGE" "$PLUGIN_ARTIFACT" <<'NODE'
const fs = require('node:fs')
const [manifestPath, packageName, artifactName] = process.argv.slice(2)
let manifest
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
} catch {
  process.exit(1)
}
const dependency = manifest.dependencies?.[packageName]
const bundles = manifest.dsh?.profile?.bundles
if (typeof dependency !== 'string' || !dependency || !Array.isArray(bundles)) {
  process.exit(1)
}
if (bundles.filter((entry) => entry === packageName).length !== 1) {
  process.exit(1)
}
const normalized = dependency.replaceAll('\\', '/')
if (!normalized.startsWith('file:')
  || !(normalized === `file:${artifactName}` || normalized.endsWith(`/${artifactName}`))) {
  process.exit(3)
}
NODE
then
  :
else
  status=$?
  if [ "$status" -eq 3 ]; then
    echo "$PLUGIN_PACKAGE is not pinned to the verified pack tarball $PLUGIN_ARTIFACT"
    exit 2
  fi
  echo "$PLUGIN_PACKAGE must be installed and activated exactly once in the DSH web profile"
  exit 2
fi

if ! composed=$(dsh --profile web --dump-config 2>&1); then
  echo "DSH web profile composition failed"
  echo "$composed"
  exit 2
fi

layer_count=$(printf '%s\n' "$composed" | awk -v marker="# == $PLUGIN_PACKAGE" '
  $0 == marker { count++ }
  END { print count + 0 }
')
if [ "$layer_count" -ne 1 ]; then
  echo "DSH web profile composition has $layer_count pack layers; want exactly 1"
  exit 2
fi

echo "DSH web profile has one installed bundle and one composed pack layer"
