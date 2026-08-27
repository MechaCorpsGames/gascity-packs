#!/bin/sh
set -eu

pack_dir="${GC_PACK_DIR:-$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)}"
# shellcheck source=/dev/null
. "$pack_dir/assets/versions.env"

for check in node dsh pnpm artifact; do
  "$pack_dir/doctor/check-$check.sh"
done

artifact="$pack_dir/assets/dist/$PLUGIN_ARTIFACT"
dsh plugin --profile web add --save-exact "$artifact"
"$pack_dir/doctor/check-profile.sh"
"$pack_dir/doctor/check-listener.sh"

echo "Installed $PLUGIN_PACKAGE from the verified pack artifact."
echo "Launch it with: gc <binding> web"
