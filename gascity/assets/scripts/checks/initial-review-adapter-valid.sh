#!/usr/bin/env bash
set -euo pipefail

# Validate that an adapter report preserves the first request-review decision.
# A later repaired attempt may approve the implementation, but external
# consumers need the original blocking outcome and finding for traceability.

fail() {
  echo "initial-review-adapter-check: $*" >&2
  exit 1
}

BEAD_ID="${GC_BEAD_ID:-}"
[ -n "$BEAD_ID" ] || fail "GC_BEAD_ID is required"
command -v bd >/dev/null 2>&1 || fail "bd is required on PATH"
command -v jq >/dev/null 2>&1 || fail "jq is required on PATH"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Preserve the universal schema and provenance contract before enforcing the
# Superpowers-specific requirement to retain an initial blocking verdict.
"$SCRIPT_DIR/build-artifact-valid.sh"

metadata_value() {
  local json="$1"
  local key="$2"
  printf '%s\n' "$json" | jq -r --arg key "$key" '
    (if type == "array" then (.[0] // {}) else . end)
    | .metadata[$key] // empty
  ' 2>/dev/null
}

STEP_JSON="$(bd show "$BEAD_ID" --json 2>/dev/null)" || fail "bd show $BEAD_ID failed"
ROOT_ID="$(metadata_value "$STEP_JSON" "gc.root_bead_id")"
[ -n "$ROOT_ID" ] || ROOT_ID="$BEAD_ID"
ROOT_JSON="$STEP_JSON"
if [ "$ROOT_ID" != "$BEAD_ID" ]; then
  ROOT_JSON="$(bd show "$ROOT_ID" --json 2>/dev/null)" || fail "bd show $ROOT_ID failed"
fi

LANES="$(bd list --all --metadata-field "gc.root_bead_id=$ROOT_ID" --json --limit=0 2>/dev/null || printf '[]')"
INITIAL_VERDICT="$(printf '%s\n' "$LANES" | jq -r '
  [
    .[]
    | select((.metadata["gc.step_id"] // "") == "write-report.request-code-review")
    | {
        attempt: ((.metadata["gc.attempt"] // "") | tonumber? // 999999),
        verdict: (.metadata["code_review.review_verdict"] // "")
      }
  ]
  | sort_by(.attempt)
  | .[0].verdict // empty
' 2>/dev/null)"

# No initial iterate means the adapter may legitimately reflect approval.
if [ "$INITIAL_VERDICT" != "iterate" ]; then
  echo "initial review adapter valid: initial request verdict=${INITIAL_VERDICT:-missing}"
  exit 0
fi

REPORT_PATH="$(metadata_value "$ROOT_JSON" "gc.build.review_report_path")"
[ -n "$REPORT_PATH" ] || REPORT_PATH="$(metadata_value "$ROOT_JSON" "gc.var.report_path")"
[ -n "$REPORT_PATH" ] || fail "review report path is missing from workflow root $ROOT_ID"

# Artifact metadata is rig-relative. Controller checks can run from a
# per-bead worktree, so GC_WORK_DIR alone is not a reliable base. Prefer the
# rig root and, for compatibility with older runtimes, search ancestors of the
# known working directories for the recorded relative artifact.
if [ "${REPORT_PATH#/}" = "$REPORT_PATH" ]; then
  RELATIVE_REPORT_PATH="$REPORT_PATH"
  for REPORT_BASE in "${GC_RIG_ROOT:-}" "${GC_DIR:-}" "${GC_BEADS_SCOPE_ROOT:-}"; do
    [ -n "$REPORT_BASE" ] || continue
    if [ -f "$REPORT_BASE/$RELATIVE_REPORT_PATH" ]; then
      REPORT_PATH="$REPORT_BASE/$RELATIVE_REPORT_PATH"
      break
    fi
  done

  if [ ! -f "$REPORT_PATH" ]; then
    for REPORT_BASE in "${GC_WORK_DIR:-}" "$PWD"; do
      [ -n "$REPORT_BASE" ] || continue
      while :; do
        if [ -f "$REPORT_BASE/$RELATIVE_REPORT_PATH" ]; then
          REPORT_PATH="$REPORT_BASE/$RELATIVE_REPORT_PATH"
          break 2
        fi
        REPORT_PARENT="$(dirname "$REPORT_BASE")"
        [ "$REPORT_PARENT" = "$REPORT_BASE" ] && break
        REPORT_BASE="$REPORT_PARENT"
      done
    done
  fi
fi
[ -f "$REPORT_PATH" ] || fail "review report does not exist: $REPORT_PATH"

STATUS="$(awk '
  /^---[[:space:]]*$/ { delimiters += 1; next }
  delimiters == 1 && /^status:[[:space:]]*/ {
    sub(/^status:[[:space:]]*/, "")
    print
    exit
  }
' "$REPORT_PATH")"
case "$STATUS" in
  changes_required|blocked) ;;
  *)
    fail "initial request review verdict is iterate; adapter report status must be changes_required or blocked, got ${STATUS:-missing}: $REPORT_PATH"
    ;;
esac

grep -q '^## Findings' "$REPORT_PATH" || fail "adapter report lacks a Findings section: $REPORT_PATH"
grep -Eiq 'shell[[:space:]-]+injection' "$REPORT_PATH" || fail "adapter report lacks the initial shell-injection finding: $REPORT_PATH"

echo "initial review adapter valid: preserved iterate status and shell-injection finding"
