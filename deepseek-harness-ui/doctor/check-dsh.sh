#!/bin/sh
set -eu

pack_dir="${GC_PACK_DIR:-$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)}"
# shellcheck source=/dev/null
. "$pack_dir/assets/versions.env"

if ! reported=$(dsh --version 2>/dev/null); then
  echo "dsh is required; install @deepseek-ai/dsh $DSH_VERSION"
  exit 2
fi

case "$reported" in
  "$DSH_VERSION") actual=$reported ;;
  "dsh $DSH_VERSION") actual=$DSH_VERSION ;;
  *) actual=$reported ;;
esac

if [ "$actual" != "$DSH_VERSION" ]; then
  echo "dsh $actual is incompatible; want $DSH_VERSION"
  exit 2
fi

echo "dsh $actual matches the audited release"
