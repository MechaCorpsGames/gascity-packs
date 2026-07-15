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
IMPLEMENTATION_PROVENANCE_REQUIRED="$(metadata_value "$ROOT_JSON" "gc.build.require_implementation_provenance")"
if [ -z "$IMPLEMENTATION_PROVENANCE_REQUIRED" ]; then
  IMPLEMENTATION_PROVENANCE_REQUIRED="$(metadata_value "$PARENT_JSON" "gc.build.require_implementation_provenance")"
fi
IMPLEMENTATION_PROVENANCE_VALIDATED=false
CURRENT_IMPLEMENTATION_SNAPSHOT=""

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
  local convoy_id convoy_json member_ids drain_policy member_id member_json
  local status outcome work_dir explicit_worktree canonical_worktree recorded_commit
  local resolved_commit head found_terminal_commit recorded_summary canonical_summary
  local root_summary candidate_worktree relative_path absolute_path allowed_path
  local seen allowed shared_worktree shared_head snapshot_members
  local -a member_worktrees=()
  local -a allowed_untracked_paths=()

  [ "$IMPLEMENTATION_PROVENANCE_REQUIRED" = "true" ] || return 0
  [ "$IMPLEMENTATION_PROVENANCE_VALIDATED" = "false" ] || return 0
  command -v python3 >/dev/null 2>&1 || implementation_provenance_fail \
    "requires python3 to compute the implementation snapshot"

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
  shared_worktree=""
  shared_head=""
  snapshot_members='[]'

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
    snapshot_members="$(printf '%s\n' "$snapshot_members" | jq -c \
      --arg id "$member_id" --arg commit "$resolved_commit" \
      '. + [{id: $id, commit: $commit}]')" || implementation_provenance_fail \
        "could not record the implementation snapshot for member $member_id"
    head="$(git -C "$canonical_worktree" rev-parse HEAD 2>/dev/null)" || \
      implementation_provenance_fail "member $member_id worktree HEAD is unreadable"

    if [ "$drain_policy" = "same-session" ]; then
      if [ -z "$shared_worktree" ]; then
        shared_worktree="$canonical_worktree"
        shared_head="$head"
      elif [ "$canonical_worktree" != "$shared_worktree" ] || [ "$head" != "$shared_head" ]; then
        implementation_provenance_fail \
          "same-session members must share one canonical worktree and terminal HEAD: expected=$shared_worktree@$shared_head observed=$canonical_worktree@$head"
      fi
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

    member_worktrees+=("$canonical_worktree")
    recorded_summary="$(metadata_value "$member_json" "gc.implementation.summary_path")"
    if [ -n "$recorded_summary" ]; then
      case "$recorded_summary" in
        /*) ;;
        *) implementation_provenance_fail \
          "member $member_id gc.implementation.summary_path must be absolute" ;;
      esac
      [ -f "$recorded_summary" ] || implementation_provenance_fail \
        "member $member_id gc.implementation.summary_path is not a file: $recorded_summary"
      [ ! -L "$recorded_summary" ] || implementation_provenance_fail \
        "member $member_id gc.implementation.summary_path must not be a symlink: $recorded_summary"
      canonical_summary="$(cd "$(dirname "$recorded_summary")" 2>/dev/null && pwd -P)/$(basename "$recorded_summary")" || \
        implementation_provenance_fail \
          "member $member_id gc.implementation.summary_path does not resolve: $recorded_summary"
      case "$canonical_summary" in
        "$canonical_worktree"/*) allowed_untracked_paths+=("$canonical_summary") ;;
        *) implementation_provenance_fail \
          "member $member_id gc.implementation.summary_path must be inside its authoritative worktree" ;;
      esac
    fi
  done <<<"$member_ids"

  if [ "$drain_policy" = "same-session" ] && [ "$found_terminal_commit" != "true" ]; then
    implementation_provenance_fail \
      "same-session members do not bind the terminal shared worktree HEAD"
  fi

  if ! CURRENT_IMPLEMENTATION_SNAPSHOT="$(printf '%s' "$snapshot_members" | python3 -c '
import hashlib
import json
import sys

members = json.load(sys.stdin)
members = [
    {"id": str(member["id"]), "commit": str(member["commit"])}
    for member in members
]
members.sort(key=lambda member: member["id"])
payload = json.dumps(members, sort_keys=True, separators=(",", ":")).encode("utf-8")
print("sha256:" + hashlib.sha256(payload).hexdigest())
')"; then
    implementation_provenance_fail "could not compute the current implementation snapshot"
  fi

  root_summary="$(metadata_value "$PARENT_JSON" "gc.build.implementation_summary_path")"
  if [ -n "$root_summary" ] && [ -f "$root_summary" ] && [ ! -L "$root_summary" ]; then
    canonical_summary="$(cd "$(dirname "$root_summary")" 2>/dev/null && pwd -P)/$(basename "$root_summary")" || \
      implementation_provenance_fail \
        "gc.build.implementation_summary_path does not resolve: $root_summary"
    for candidate_worktree in "${member_worktrees[@]}"; do
      case "$canonical_summary" in
        "$candidate_worktree"/*) allowed_untracked_paths+=("$canonical_summary") ;;
      esac
    done
  fi

  local -a checked_worktrees=()
  for candidate_worktree in "${member_worktrees[@]}"; do
    seen=false
    for canonical_worktree in "${checked_worktrees[@]}"; do
      if [ "$candidate_worktree" = "$canonical_worktree" ]; then
        seen=true
        break
      fi
    done
    [ "$seen" = "false" ] || continue
    checked_worktrees+=("$candidate_worktree")

    while IFS= read -r -d '' relative_path; do
      case "$relative_path" in
        .pytest_cache/*|*/.pytest_cache/*|__pycache__/*.py[co]|*/__pycache__/*.py[co])
          continue
          ;;
      esac
      absolute_path="$candidate_worktree/$relative_path"
      allowed=false
      for allowed_path in "${allowed_untracked_paths[@]}"; do
        if [ "$absolute_path" = "$allowed_path" ]; then
          allowed=true
          break
        fi
      done
      if [ "$allowed" != "true" ]; then
        implementation_provenance_fail \
          "unexpected untracked worktree path in $candidate_worktree: $relative_path"
        return 1
      fi
    done < <(git -C "$candidate_worktree" ls-files --others --exclude-standard -z)
  done
  IMPLEMENTATION_PROVENANCE_VALIDATED=true
}

approve() {
  local message="$1"
  validate_declared_artifact
  validate_implementation_provenance
  echo "$message"
  exit 0
}

MATCHES="$(gc bd list --all --metadata-field "gc.root_bead_id=$PARENT_ROOT" --json --limit=0 2>/dev/null || printf '[]')"

if ! CURRENT_MATCHES="$(printf '%s\n' "$MATCHES" | jq -c \
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
  [.[] | current_loop] | sort_by([.updated_at // "", .id // ""])
')"; then
  echo "review check: current-attempt review metadata is malformed" >&2
  exit 1
fi

VERDICT="$(printf '%s\n' "$CURRENT_MATCHES" | jq -r '
  [
    .[] | select((.metadata["code_review.verdict"] // "") != "")
  ]
  | sort_by([.updated_at // "", .id // ""])
  | [
    .[]
    | select((.metadata["code_review.verdict"] // "") != "")
    | .metadata["code_review.verdict"]
  ] | last // ""
' 2>/dev/null)"

REPORT="$(printf '%s\n' "$CURRENT_MATCHES" | jq -r '
  [
    .[] | select((.metadata["code_review.report_path"] // "") != "")
  ]
  | sort_by([.updated_at // "", .id // ""])
  | [
    .[]
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
    REPORT_MODE_PATH="$(printf '%s\n' "$CURRENT_MATCHES" | jq -r '
      [
        .[]
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

validate_implementation_provenance

LANE_STATUS="$(printf '%s\n' "$CURRENT_MATCHES" | jq -r \
  --arg require_snapshot "$IMPLEMENTATION_PROVENANCE_REQUIRED" \
  --arg current_snapshot "$CURRENT_IMPLEMENTATION_SNAPSHOT" '
  def approved($value):
    (($value // "") | ascii_downcase) as $v
    | ($v == "approve" or $v == "approved" or $v == "pass");
  def rendered($row):
    (($row.verdict | if . == "" then "<missing>" else . end) + "@" +
    ($row.snapshot | if . == "" then "<missing implementation snapshot>" else . end));
  [
    .[]
    | .metadata as $metadata
    | [
        {
          lane: "acceptance",
          verdict: ($metadata["code_review.acceptance_verdict"] // ""),
          snapshot: ($metadata["code_review.implementation_snapshot"] // "")
        },
        {
          lane: "test_evidence",
          verdict: ($metadata["code_review.test_evidence_verdict"] // ""),
          snapshot: ($metadata["code_review.implementation_snapshot"] // "")
        },
        {
          lane: "simplicity",
          verdict: ($metadata["code_review.simplicity_verdict"] // ""),
          snapshot: ($metadata["code_review.implementation_snapshot"] // "")
        }
      ][]
    | select(.verdict != "")
  ] as $rows
  | {
      acceptance: ([$rows[] | select(.lane == "acceptance")] | last // {verdict: "", snapshot: ""}),
      test_evidence: ([$rows[] | select(.lane == "test_evidence")] | last // {verdict: "", snapshot: ""}),
      simplicity: ([$rows[] | select(.lane == "simplicity")] | last // {verdict: "", snapshot: ""})
    } as $latest
  | if $require_snapshot == "true" then
      if (
        approved($latest.acceptance.verdict) and
        approved($latest.test_evidence.verdict) and
        approved($latest.simplicity.verdict) and
        $latest.acceptance.snapshot == $current_snapshot and
        $latest.test_evidence.snapshot == $current_snapshot and
        $latest.simplicity.snapshot == $current_snapshot
      ) then
        "approved"
      else
        "iterate: implementation snapshot mismatch current=\($current_snapshot) acceptance=\(rendered($latest.acceptance)) test_evidence=\(rendered($latest.test_evidence)) simplicity=\(rendered($latest.simplicity))"
      end
    elif ($rows | length) > 0 then
      if (
        approved($latest.acceptance.verdict) and
        approved($latest.test_evidence.verdict) and
        approved($latest.simplicity.verdict)
      ) then
        "approved"
      else
        "iterate: acceptance=\($latest.acceptance.verdict // "<missing>") test_evidence=\($latest.test_evidence.verdict // "<missing>") simplicity=\($latest.simplicity.verdict // "<missing>")"
      end
    else
      ""
    end
' 2>/dev/null)"

if [ -n "$LANE_STATUS" ] && [ "$LANE_STATUS" != "approved" ]; then
  echo "Implementation review needs another iteration: $LANE_STATUS"
  exit 1
fi

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
