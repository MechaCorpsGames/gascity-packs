#!/bin/sh
set -eu

pack_dir="${GC_PACK_DIR:-$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)}"
# shellcheck source=/dev/null
. "$pack_dir/assets/versions.env"
artifact="$pack_dir/assets/dist/$PLUGIN_ARTIFACT"

if [ ! -f "$artifact" ]; then
  echo "plugin artifact is missing: $artifact"
  exit 2
fi

case "${PLUGIN_SHA256:-}" in
  ""|*[!0-9a-fA-F]*)
    echo "plugin artifact checksum pin is missing or invalid"
    exit 2
    ;;
esac
if [ "${#PLUGIN_SHA256}" -ne 64 ]; then
  echo "plugin artifact checksum pin is missing or invalid"
  exit 2
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$artifact" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$artifact" | awk '{print $1}')
else
  echo "sha256sum or shasum is required to verify the plugin artifact"
  exit 2
fi

if [ "$actual" != "$PLUGIN_SHA256" ]; then
  echo "plugin artifact checksum mismatch: $PLUGIN_ARTIFACT"
  echo "expected $PLUGIN_SHA256"
  echo "actual   $actual"
  exit 2
fi

echo "plugin artifact checksum matches: $PLUGIN_ARTIFACT"
