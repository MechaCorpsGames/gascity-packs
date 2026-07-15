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

implementation_provenance_fail() {
  echo "review check: implementation provenance $*" >&2
  return 1
}

validate_implementation_provenance() {
  local required convoy_id convoy_json member_ids drain_policy member_id member_json
  local status outcome work_dir explicit_worktree canonical_worktree recorded_commit
  local resolved_commit head found_terminal_commit

  required="$(metadata_value "$ROOT_JSON" "gc.build.require_implementation_provenance")"
  if [ -z "$required" ]; then
    required="$(metadata_value "$PARENT_JSON" "gc.build.require_implementation_provenance")"
  fi
  [ "$required" = "true" ] || return 0

  convoy_id="$(metadata_value "$PARENT_JSON" "gc.build.implementation_convoy_id")"
  [ -n "$convoy_id" ] || implementation_provenance_fail \
    "requires gc.build.implementation_convoy_id on workflow root $PARENT_ROOT"

  convoy_json="$(gc convoy status "$convoy_id" --json 2>/dev/null || true)"
  if ! printf '%s\n' "$convoy_json" | jq -e --arg id "$convoy_id" '
    (.convoy.id == $id) and
    (.convoy.status == "closed") and
    (.children | type == "array" and length > 0) and
    (all(.children[]; (.id | type == "string" and length > 0) and .status == "closed")) and
    (([.children[].id] | unique | length) == (.children | length))
  ' >/dev/null 2>&1; then
    implementation_provenance_fail "convoy $convoy_id must be closed with unique closed members"
  fi
  member_ids="$(printf '%s\n' "$convoy_json" | jq -r '.children[].id')"
  drain_policy="$(metadata_value "$PARENT_JSON" "gc.var.drain_policy")"
  found_terminal_commit=false

  while IFS= read -r member_id; do
    [ -n "$member_id" ] || continue
    member_json="$(gc bd show "$member_id" --json 2>/dev/null || true)"
    status="$(printf '%s\n' "$member_json" | jq -r '
      (if type == "array" then (.[0] // {}) else . end) | .status // ""
    ' 2>/dev/null)"
    outcome="$(metadata_value "$member_json" "gc.outcome")"
    if [ "$status" != "closed" ] || [ "$outcome" != "pass" ]; then
      implementation_provenance_fail \
        "member $member_id must be closed/pass, got status=${status:-<missing>} outcome=${outcome:-<missing>}"
    fi

    work_dir="$(metadata_value "$member_json" "work_dir")"
    explicit_worktree="$(metadata_value "$member_json" "gc.implementation.worktree_path")"
    [ -n "$work_dir" ] || implementation_provenance_fail "member $member_id is missing work_dir"
    [ -n "$explicit_worktree" ] || implementation_provenance_fail \
      "member $member_id is missing gc.implementation.worktree_path"
    canonical_worktree="$(cd "$work_dir" 2>/dev/null && pwd -P)" || implementation_provenance_fail \
      "member $member_id work_dir does not resolve: $work_dir"
    if [ "$(cd "$explicit_worktree" 2>/dev/null && pwd -P || true)" != "$canonical_worktree" ]; then
      implementation_provenance_fail \
        "member $member_id work_dir and gc.implementation.worktree_path disagree"
    fi

    recorded_commit="$(metadata_value "$member_json" "gc.implementation.commit")"
    case "$recorded_commit" in
      *[!0-9a-fA-F]*|'') implementation_provenance_fail \
        "member $member_id gc.implementation.commit must be hexadecimal" ;;
    esac
    [ "${#recorded_commit}" -eq 40 ] || implementation_provenance_fail \
      "member $member_id gc.implementation.commit must be a full 40-character commit"
    resolved_commit="$(git -C "$canonical_worktree" rev-parse --verify "${recorded_commit}^{commit}" 2>/dev/null)" || \
      implementation_provenance_fail "member $member_id recorded commit does not resolve"
    head="$(git -C "$canonical_worktree" rev-parse HEAD 2>/dev/null)" || \
      implementation_provenance_fail "member $member_id worktree HEAD is unreadable"

    if [ "$drain_policy" = "same-session" ]; then
      git -C "$canonical_worktree" merge-base --is-ancestor "$resolved_commit" "$head" 2>/dev/null || \
        implementation_provenance_fail \
          "member $member_id recorded commit is not an ancestor of shared worktree HEAD $head"
      if [ "$resolved_commit" = "$head" ]; then
        found_terminal_commit=true
      fi
    elif [ "$resolved_commit" != "$head" ]; then
      implementation_provenance_fail \
        "member $member_id recorded commit $resolved_commit does not equal worktree HEAD $head"
    fi

    if ! git -C "$canonical_worktree" diff --quiet "$head" --; then
      implementation_provenance_fail \
        "member $member_id tracked bytes differ from recorded worktree HEAD $head"
    fi
  done <<<"$member_ids"

  if [ "$drain_policy" = "same-session" ] && [ "$found_terminal_commit" != "true" ]; then
    implementation_provenance_fail \
      "same-session members do not bind the terminal shared worktree HEAD"
  fi
}

approve() {
  local message="$1"
  validate_declared_artifact
  validate_implementation_provenance
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
