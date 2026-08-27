#!/bin/sh
set -eu

pack_dir="${GC_PACK_DIR:-$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)}"
# shellcheck source=/dev/null
. "$pack_dir/assets/versions.env"

if ! actual=$(pnpm --version 2>/dev/null); then
  echo "pnpm is required by dsh plugin add/remove; install pnpm $PNPM_VERSION"
  exit 2
fi

if [ "$actual" != "$PNPM_VERSION" ]; then
  echo "pnpm $actual is incompatible; want $PNPM_VERSION"
  exit 2
fi

echo "pnpm $actual matches the audited toolchain"
