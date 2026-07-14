#!/usr/bin/env bash
set -euo pipefail

ROOT_ID="${GC_BEAD_ID:-}"
ATTEMPT="${GC_ITERATION:-}"

if [ -z "$ROOT_ID" ]; then
  echo "review check: GC_BEAD_ID is required" >&2
  exit 1
fi

if [ -z "$ATTEMPT" ]; then
  ATTEMPT="0"
fi

metadata_value() {
  local json="$1"
  local key="$2"
  printf '%s\n' "$json" | jq -r --arg key "$key" '
    (if type == "array" then (.[0] // {}) else . end)
    | .metadata[$key] // empty
  ' 2>/dev/null
}

ROOT_JSON="$(gc bd show "$ROOT_ID" --json 2>/dev/null || true)"
PARENT_ROOT="$(metadata_value "$ROOT_JSON" "gc.root_bead_id")"
if [ -z "$PARENT_ROOT" ]; then
  PARENT_ROOT="$ROOT_ID"
fi
PARENT_JSON="$ROOT_JSON"
if [ "$PARENT_ROOT" != "$ROOT_ID" ]; then
  PARENT_JSON="$(gc bd show "$PARENT_ROOT" --json 2>/dev/null || true)"
fi
STEP_ID="$(metadata_value "$ROOT_JSON" "gc.step_id")"
SCOPE_REF="$(metadata_value "$ROOT_JSON" "gc.scope_ref")"
if [ -z "$SCOPE_REF" ]; then
  SCOPE_REF="$(metadata_value "$ROOT_JSON" "gc.step_ref")"
fi

validate_declared_artifact() {
  local schema path_keys script_dir artifact_check
  schema="$(metadata_value "$ROOT_JSON" "gc.build.artifact_schema")"
  path_keys="$(metadata_value "$ROOT_JSON" "gc.build.artifact_path_keys")"

  if [ -z "$schema" ] && [ -z "$path_keys" ]; then
    return 0
  fi
  if [ -z "$schema" ] || [ -z "$path_keys" ]; then
    echo "review check: gc.build.artifact_schema and gc.build.artifact_path_keys must be declared together" >&2
    return 1
  fi

  script_dir="$(cd "$(dirname "$0")" && pwd)"
  artifact_check="$script_dir/build-artifact-valid.sh"
  if [ ! -x "$artifact_check" ]; then
    echo "review check: artifact validator is missing or not executable: $artifact_check" >&2
    return 1
  fi

  GC_BEAD_ID="$ROOT_ID" "$artifact_check"
}

approve() {
  local message="$1"
  validate_declared_artifact
  echo "$message"
  exit 0
}

MATCHES="$(gc bd list --all --metadata-field "gc.root_bead_id=$PARENT_ROOT" --json --limit=0 2>/dev/null || printf '[]')"

VERDICT="$(printf '%s\n' "$MATCHES" | jq -r --arg attempt "$ATTEMPT" '
  [
    .[]
    | select((.metadata["gc.attempt"] // "") == $attempt)
    | select((.metadata["code_review.verdict"] // "") != "")
    | .metadata["code_review.verdict"]
  ] | last // ""
' 2>/dev/null)"

REPORT="$(printf '%s\n' "$MATCHES" | jq -r --arg attempt "$ATTEMPT" '
  [
    .[]
    | select((.metadata["gc.attempt"] // "") == $attempt)
    | select((.metadata["code_review.report_path"] // "") != "")
    | .metadata["code_review.report_path"]
  ] | last // ""
' 2>/dev/null)"

REVIEW_MODE="$(metadata_value "$ROOT_JSON" "gc.var.review_mode")"
if [ -z "$REVIEW_MODE" ]; then
  REVIEW_MODE="$(metadata_value "$PARENT_JSON" "gc.var.review_mode")"
fi
if [ "$REVIEW_MODE" = "report" ]; then
  REPORT_MODE_PATH="$(metadata_value "$PARENT_JSON" "gc.build.code_review_report_path")"
  if [ -z "$REPORT_MODE_PATH" ]; then
    REPORT_MODE_PATH="$(metadata_value "$PARENT_JSON" "gc.build.review_report_path")"
  fi
  if [ -z "$REPORT_MODE_PATH" ]; then
    REPORT_MODE_PATH="$(metadata_value "$PARENT_JSON" "gc.var.report_path")"
  fi
  if [ -z "$REPORT_MODE_PATH" ]; then
    REPORT_MODE_PATH="$(printf '%s\n' "$MATCHES" | jq -r --arg attempt "$ATTEMPT" '
      [
        .[]
        | select((.metadata["gc.attempt"] // "") == $attempt)
        | (
            .metadata["code_review.review_report_path"] //
            .metadata["code_review.report_path"] //
            .metadata["code_review.output_path"] //
            ""
          )
        | select(. != "")
      ] | last // ""
    ' 2>/dev/null)"
  fi
  if [ -n "$REPORT_MODE_PATH" ]; then
    approve "Implementation review report mode satisfied: $REPORT_MODE_PATH"
  fi
  echo "Implementation review report mode needs a review report path"
  exit 1
fi

LANE_STATUS="$(printf '%s\n' "$MATCHES" | jq -r \
  --arg root "$PARENT_ROOT" \
  --arg attempt "$ATTEMPT" \
  --arg scope "$SCOPE_REF" \
  --arg step "$STEP_ID" '
  def current_loop:
    select(.metadata["gc.root_bead_id"] == $root)
    | select(($attempt == "") or ((.metadata["gc.attempt"] // "") == $attempt))
    | select(
        if $attempt != "" and $step != "" then
          ((.metadata["gc.ralph_step_id"] // "") == $step) or
          ((.metadata["gc.step_id"] // "") == $step) or
          (((.metadata["gc.scope_ref"] // "") | startswith($step + ".iteration.")))
        elif $attempt != "" and $scope != "" then
          ((.metadata["gc.scope_ref"] // "") == $scope) or
          ((.metadata["gc.step_ref"] // "") == $scope)
        elif $step != "" then
          ((.metadata["gc.ralph_step_id"] // "") == $step) or
          (((.metadata["gc.scope_ref"] // "") | startswith($step + ".iteration.")))
        elif $scope != "" then
          ((.metadata["gc.scope_ref"] // "") == $scope)
        else
          true
        end
      );
  def approved($value):
    (($value // "") | ascii_downcase) as $v
    | ($v == "approve" or $v == "approved" or $v == "pass" or $v == "done");
  [
    .[]
    | current_loop
    | .metadata
    | {
        acceptance: (."code_review.acceptance_verdict" // ""),
        test_evidence: (."code_review.test_evidence_verdict" // ""),
        simplicity: (."code_review.simplicity_verdict" // "")
      }
  ] as $rows
  | {
      acceptance: ([$rows[].acceptance | select(. != "")] | last // ""),
      test_evidence: ([$rows[].test_evidence | select(. != "")] | last // ""),
      simplicity: ([$rows[].simplicity | select(. != "")] | last // "")
    } as $latest
  | if ($latest.acceptance != "" or $latest.test_evidence != "" or $latest.simplicity != "") then
      if (approved($latest.acceptance) and approved($latest.test_evidence) and approved($latest.simplicity)) then
        "approved"
      else
        "iterate: acceptance=\($latest.acceptance // "<missing>") test_evidence=\($latest.test_evidence // "<missing>") simplicity=\($latest.simplicity // "<missing>")"
      end
    else
      ""
    end
' 2>/dev/null)"

if [ "$VERDICT" != "done" ]; then
  case "$VERDICT" in
    approved|pass)
      ;;
    "")
      if [ "$LANE_STATUS" = "approved" ]; then
        approve "Implementation review approved from lane verdicts"
      fi
      echo "Implementation review needs another iteration: ${LANE_STATUS:-missing verdict}"
      exit 1
      ;;
    *)
      echo "Implementation review needs another iteration: $VERDICT"
      exit 1
      ;;
  esac
fi

approve "Implementation review approved"
