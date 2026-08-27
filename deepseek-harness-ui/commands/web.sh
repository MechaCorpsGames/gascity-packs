#!/bin/sh
set -eu

pack_dir="${GC_PACK_DIR:-$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)}"

expect_host=false
for argument in "$@"; do
  if [ "$expect_host" = true ]; then
    if [ "$argument" != "127.0.0.1" ]; then
      echo "deepseek-harness-ui supports a loopback-only DSH listener"
      exit 2
    fi
    expect_host=false
    continue
  fi
  case "$argument" in
    --host) expect_host=true ;;
    --host=127.0.0.1) ;;
    --host=*)
      echo "deepseek-harness-ui supports a loopback-only DSH listener"
      exit 2
      ;;
  esac
done
if [ "$expect_host" = true ]; then
  echo "--host requires the loopback value 127.0.0.1"
  exit 2
fi

for check in node dsh; do
  "$pack_dir/doctor/check-$check.sh"
done

exec dsh web --host 127.0.0.1 "$@"
