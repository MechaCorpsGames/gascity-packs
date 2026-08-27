#!/bin/sh
set -eu

pack_dir="${GC_PACK_DIR:-$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)}"
# shellcheck source=/dev/null
. "$pack_dir/assets/versions.env"

if ! version=$(node --version 2>/dev/null); then
  echo "node is required; install Node $NODE_22_MIN or any $NODE_NEXT_MIN+ release"
  exit 2
fi

numeric=${version#v}
major=${numeric%%.*}
remainder=${numeric#*.}
minor=${remainder%%.*}
patch=${remainder#*.}

case "$numeric" in
  *.*.*) version_shape=true ;;
  *) version_shape=false ;;
esac
supported=false
if [ "$version_shape" = true ]; then
  case "$major:$minor:$patch" in
    *[!0-9:]*|::*|*::*|*:) ;;
    *)
      if [ "$major" -eq 22 ] && [ "$minor" -ge 19 ]; then
        supported=true
      elif [ "$major" -ge 24 ]; then
        supported=true
      fi
      ;;
  esac
fi

if [ "$supported" != true ]; then
  echo "node $version is unsupported; install Node $NODE_22_MIN or any $NODE_NEXT_MIN+ release"
  exit 2
fi

echo "node $version is supported"
