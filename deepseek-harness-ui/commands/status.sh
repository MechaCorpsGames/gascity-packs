#!/bin/sh
set -eu

pack_dir="${GC_PACK_DIR:-$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)}"
# shellcheck source=/dev/null
. "$pack_dir/assets/versions.env"

live=false
if [ "$#" -eq 1 ] && [ "$1" = "--check" ]; then
  live=true
elif [ "$#" -ne 0 ]; then
  echo "usage: status [--check]" >&2
  exit 2
fi

echo "pack version: $PACK_VERSION"
for check in node dsh artifact profile; do
  "$pack_dir/doctor/check-$check.sh"
done
if [ "$live" = true ]; then
  "$pack_dir/doctor/check-gc-contexts.sh"
  GC_REQUIRE_AVAILABLE_CONNECTIONS=1 "$pack_dir/doctor/check-listener.sh"
  for check in supervisor read-grant; do
    "$pack_dir/doctor/check-$check.sh"
  done
  echo "live Supervisor checks: complete"
else
  echo "live Supervisor checks: skipped (pass --check to enable)"
fi
