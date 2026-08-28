#!/bin/sh
set -eu

pack_dir="${GC_PACK_DIR:-$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)}"
# shellcheck source=/dev/null
. "$pack_dir/assets/versions.env"

if ! actual=$(pnpm --version 2>/dev/null); then
  echo "pnpm is required by dsh plugin add/remove; install pnpm $PNPM_VERSION"
  exit 2
fi

case "$actual" in
  0|0.*|*[!0-9A-Za-z.+-]*)
    echo "pnpm did not report a usable semantic version; the artifact build pin is $PNPM_VERSION"
    exit 2
    ;;
esac

if ! PNPM_ACTUAL_VERSION=$actual node -e '
const value = process.env.PNPM_ACTUAL_VERSION ?? ""
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) process.exit(2)
'; then
  echo "pnpm did not report a semantic version; the artifact build pin is $PNPM_VERSION"
  exit 2
fi

echo "pnpm $actual is available for DSH plugin management"
