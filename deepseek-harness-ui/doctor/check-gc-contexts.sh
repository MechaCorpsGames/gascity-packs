#!/bin/sh
set -eu

gc_home=${GC_HOME:-"$HOME/.gc"}
contexts="$gc_home/contexts.toml"

if [ -f "$contexts" ]; then
  if mode=$(stat -f '%Lp' "$contexts" 2>/dev/null); then
    :
  elif mode=$(stat -c '%a' "$contexts" 2>/dev/null); then
    :
  else
    echo "could not inspect permissions on $contexts"
    exit 2
  fi
  if [ "$mode" != 600 ]; then
    echo "GC contexts must be owner-only (0600): $contexts is $mode"
    exit 2
  fi
fi

if ! gc context list --json >/dev/null 2>&1; then
  echo "GC contexts could not be parsed or validated: $contexts"
  echo "Run: gc context list --json"
  exit 2
fi

echo "GC context configuration is private and valid"
