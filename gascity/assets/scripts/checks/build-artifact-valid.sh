#!/usr/bin/env bash
set -euo pipefail

# Generic producer-stage build-artifact validation gate.
#
# The checked formula step names its artifact contract in step metadata:
#   gc.build.artifact_schema    - expected schema id (e.g. gc.build.requirements.v1)
#   gc.build.artifact_path_keys - comma-separated workflow-root metadata keys;
#                                 the first non-empty value is the artifact path
#
# The step bead (and the ralph control bead cloned from it) carries that
# metadata, so this script reads $GC_BEAD_ID, resolves the workflow root via
# gc.root_bead_id, resolves the artifact path, and validates the artifact with
# the shared base validator. All failures print machine-readable lines on
# stderr; the dispatcher records them in gc.attempt_log as repair context for
# the next bounded producer attempt. This gate never prompts.

fail() {
  echo "build-artifact-check: $*" >&2
  exit 1
}

BEAD_ID="${GC_BEAD_ID:-}"
[ -n "$BEAD_ID" ] || fail "GC_BEAD_ID is required"
command -v gc >/dev/null 2>&1 || fail "gc is required on PATH"
command -v python3 >/dev/null 2>&1 || fail "python3 is required on PATH"

metadata_value() {
  # metadata_value <json> <key> -> prints metadata[key] or empty
  printf '%s' "$1" | python3 -c '
import json
import sys

key = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    print("")
    raise SystemExit(0)
if isinstance(data, list):
    data = data[0] if data else {}
if not isinstance(data, dict):
    print("")
    raise SystemExit(0)
metadata = data.get("metadata") or {}
value = metadata.get(key, "") if isinstance(metadata, dict) else ""
print(value if isinstance(value, str) else "")
' "$2"
}

launcher_root_from_work_dir() {
  candidate="${GC_WORK_DIR:-}"
  [ -n "$candidate" ] || return 1
  candidate="$(cd "$candidate" 2>/dev/null && pwd -P)" || return 1

  while :; do
    if [ -f "$candidate/.gc/scripts/checks/build-artifact-valid.sh" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    [ "$candidate" != "/" ] || return 1
    parent="$(dirname "$candidate")"
    [ "$parent" != "$candidate" ] || return 1
    candidate="$parent"
  done
}

resolve_declared_path() {
  value="$1"
  key="$2"
  case "$value" in
    /*) printf '%s\n' "$value" ;;
    *)
      [ -n "${GC_WORK_DIR:-}" ] || fail "artifact path $value from $key is relative and GC_WORK_DIR is unset"
      launcher_root="$(launcher_root_from_work_dir)" || fail "artifact path $value from $key is relative but no launcher root containing .gc/scripts/checks/build-artifact-valid.sh exists at or above GC_WORK_DIR=$GC_WORK_DIR"
      printf '%s/%s\n' "$launcher_root" "$value"
      ;;
  esac
}

canonical_file_path() {
  python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve(strict=True))' "$1"
}

require_subject_trace() {
  report_path="$1"
  subject_path="$2"
  python3 - "$report_path" "$subject_path" <<'PY'
import hashlib
import re
import sys
from pathlib import Path

import yaml

report_path = Path(sys.argv[1])
subject_path = Path(sys.argv[2]).resolve()
text = report_path.read_text(encoding="utf-8", errors="replace")
match = re.match(r"\A---\n(?P<front>.*?)\n---(?:\n|\Z)", text, re.DOTALL)
if not match:
    print(f"build-artifact-check: review report has no parseable front matter: {report_path}", file=sys.stderr)
    raise SystemExit(1)

front_matter = yaml.safe_load(match.group("front")) or {}
trace = front_matter.get("trace") if isinstance(front_matter, dict) else None
upstream = trace.get("upstream") if isinstance(trace, dict) else None
if not isinstance(upstream, list):
    print(f"build-artifact-check: review report trace.upstream is missing: {report_path}", file=sys.stderr)
    raise SystemExit(1)

expected_hash = f"sha256:{hashlib.sha256(subject_path.read_bytes()).hexdigest()}"
observed = []
for entry in upstream:
    if not isinstance(entry, dict):
        continue
    raw_path = entry.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        continue
    traced_path = Path(raw_path.strip())
    path_matches = traced_path.is_absolute() and traced_path.resolve() == subject_path
    if path_matches:
        observed.append(str(entry.get("hash") or ""))

if expected_hash not in observed:
    print(
        "build-artifact-check: review report must trace the canonical review subject digest exactly: "
        f"report={report_path} subject={subject_path} expected={expected_hash} observed={observed}",
        file=sys.stderr,
    )
    raise SystemExit(1)
PY
}

SHOW_JSON="$(gc bd show "$BEAD_ID" --json 2>/dev/null)" || fail "gc bd show $BEAD_ID failed"

SCHEMA="$(metadata_value "$SHOW_JSON" "gc.build.artifact_schema")"
PATH_KEYS="$(metadata_value "$SHOW_JSON" "gc.build.artifact_path_keys")"
[ -n "$SCHEMA" ] || fail "step metadata gc.build.artifact_schema is missing on $BEAD_ID"
[ -n "$PATH_KEYS" ] || fail "step metadata gc.build.artifact_path_keys is missing on $BEAD_ID"

ROOT_ID="$(metadata_value "$SHOW_JSON" "gc.root_bead_id")"
ROOT_JSON="$SHOW_JSON"
if [ -n "$ROOT_ID" ] && [ "$ROOT_ID" != "$BEAD_ID" ]; then
  ROOT_JSON="$(gc bd show "$ROOT_ID" --json 2>/dev/null)" || fail "gc bd show $ROOT_ID failed"
fi

ARTIFACT_PATH=""
RESOLVED_KEY=""
IFS=',' read -r -a KEYS <<<"$PATH_KEYS"
for key in "${KEYS[@]}"; do
  key="$(printf '%s' "$key" | tr -d '[:space:]')"
  [ -n "$key" ] || continue
  value="$(metadata_value "$ROOT_JSON" "$key")"
  if [ -n "$value" ]; then
    ARTIFACT_PATH="$value"
    RESOLVED_KEY="$key"
    break
  fi
done
[ -n "$ARTIFACT_PATH" ] || fail "no artifact path recorded on workflow root ${ROOT_ID:-$BEAD_ID}; tried metadata keys: $PATH_KEYS. The producing stage must record the resolved artifact path before closing."

ARTIFACT_PATH="$(resolve_declared_path "$ARTIFACT_PATH" "$RESOLVED_KEY")"
[ -f "$ARTIFACT_PATH" ] || fail "artifact $ARTIFACT_PATH from $RESOLVED_KEY does not exist"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VALIDATOR="$SCRIPT_DIR/../validate_build_artifact.py"
[ -f "$VALIDATOR" ] || fail "installed validate_build_artifact.py not found beside $SCRIPT_DIR"

if ! OUTPUT="$(python3 "$VALIDATOR" --schema "$SCHEMA" --path "$ARTIFACT_PATH" 2>&1)"; then
  echo "build-artifact-check: schema=$SCHEMA path=$ARTIFACT_PATH failed validation" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if [ "$SCHEMA" = "gc.build.review.v1" ]; then
  CALLER_SUBJECT_RAW="$(metadata_value "$ROOT_JSON" "gc.var.subject_path")"
  CANONICAL_SUBJECT_RAW="$(metadata_value "$ROOT_JSON" "gc.build.review_subject_path")"
  SUBJECT_PATH=""
  if [ -n "$CALLER_SUBJECT_RAW" ]; then
    CALLER_SUBJECT_PATH="$(resolve_declared_path "$CALLER_SUBJECT_RAW" "gc.var.subject_path")"
    [ -f "$CALLER_SUBJECT_PATH" ] || fail "caller review subject does not exist: $CALLER_SUBJECT_PATH"
    SUBJECT_PATH="$CALLER_SUBJECT_PATH"
    if [ -n "$CANONICAL_SUBJECT_RAW" ]; then
      CANONICAL_SUBJECT_PATH="$(resolve_declared_path "$CANONICAL_SUBJECT_RAW" "gc.build.review_subject_path")"
      [ -f "$CANONICAL_SUBJECT_PATH" ] || fail "canonical review subject does not exist: $CANONICAL_SUBJECT_PATH"
      [ "$(canonical_file_path "$CALLER_SUBJECT_PATH")" = "$(canonical_file_path "$CANONICAL_SUBJECT_PATH")" ] || fail "review subject metadata paths disagree: caller=$CALLER_SUBJECT_PATH canonical=$CANONICAL_SUBJECT_PATH"
      SUBJECT_PATH="$CANONICAL_SUBJECT_PATH"
    fi
  elif [ -n "$CANONICAL_SUBJECT_RAW" ]; then
    SUBJECT_PATH="$(resolve_declared_path "$CANONICAL_SUBJECT_RAW" "gc.build.review_subject_path")"
    [ -f "$SUBJECT_PATH" ] || fail "canonical review subject does not exist: $SUBJECT_PATH"
  fi
  if [ -n "$SUBJECT_PATH" ]; then
    require_subject_trace "$ARTIFACT_PATH" "$SUBJECT_PATH" || exit 1
  fi

  REQUIRE_INTERNAL="$(metadata_value "$SHOW_JSON" "gc.build.require_internal_review_report")"
  INTERNAL_RAW="$(metadata_value "$ROOT_JSON" "gc.build.code_review_report_path")"
  if [ "$RESOLVED_KEY" != "gc.build.code_review_report_path" ]; then
    if [ "$REQUIRE_INTERNAL" = "true" ] && [ -z "$INTERNAL_RAW" ]; then
      fail "required internal review report metadata gc.build.code_review_report_path is missing"
    fi
  fi
  if [ -n "$INTERNAL_RAW" ] && [ "$RESOLVED_KEY" != "gc.build.code_review_report_path" ]; then
    INTERNAL_PATH="$(resolve_declared_path "$INTERNAL_RAW" "gc.build.code_review_report_path")"
    [ -f "$INTERNAL_PATH" ] || fail "internal review report does not exist: $INTERNAL_PATH"
    [ ! "$INTERNAL_PATH" -ef "$ARTIFACT_PATH" ] || fail "internal and adapter review report paths must be distinct: internal=$INTERNAL_PATH adapter=$ARTIFACT_PATH"
    if ! INTERNAL_OUTPUT="$(python3 "$VALIDATOR" --schema "$SCHEMA" --path "$INTERNAL_PATH" 2>&1)"; then
      echo "build-artifact-check: internal review report $INTERNAL_PATH failed validation" >&2
      printf '%s\n' "$INTERNAL_OUTPUT" >&2
      exit 1
    fi
    if [ -n "$SUBJECT_PATH" ]; then
      require_subject_trace "$INTERNAL_PATH" "$SUBJECT_PATH" || exit 1
    fi
    cmp -s "$INTERNAL_PATH" "$ARTIFACT_PATH" || fail "internal and adapter review reports must be byte-identical: internal=$INTERNAL_PATH adapter=$ARTIFACT_PATH"
  fi
fi

echo "build artifact valid: schema=$SCHEMA path=$ARTIFACT_PATH"
