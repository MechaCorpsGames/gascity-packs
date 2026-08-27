#!/bin/sh
set -eu

pack_dir="${GC_PACK_DIR:-$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)}"
# shellcheck source=/dev/null
. "$pack_dir/assets/versions.env"

for check in node dsh pnpm; do
  "$pack_dir/doctor/check-$check.sh"
done

dsh plugin --profile web remove "$PLUGIN_PACKAGE"
echo "Removed $PLUGIN_PACKAGE from the DSH web profile."
echo "Gas City configuration was not changed."
