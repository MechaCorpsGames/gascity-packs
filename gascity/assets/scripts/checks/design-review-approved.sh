#!/usr/bin/env bash
# Check script for github-issue-fix design-review retry loops.

set -euo pipefail

gmol() {   # root_id -> molecule-member JSON array; nonzero if any status leg failed
    # A metadata collection query carries no bead id for bd to route on, so on a
    # city that relocates the graph class `gc bd list --metadata-field` refuses
    # (exit 1) rather than answer from the wrong store -- and swallowing that
    # refusal turned it into an empty member set, so this gate never saw its
    # verdict and looped until ralph exhausted its attempts.
    #
    # `gc ready` is the federating reader: city store, rig stores and the
    # relocated graph store, across both tiers. It takes exactly one --status
    # and has no --all, so the member set is the union of one leg per status.
    # The four legs are independent reads and run concurrently: a check gate has
    # a 10m budget and each `gc ready` costs ~17s on a loaded city.
    #
    # A leg that fails is reported on stderr and fails the function rather than
    # contributing an empty set -- silent starvation is the bug being fixed.
    local root="$1" tmp st rc=0
    tmp="$(mktemp -d)" || return 1
    for st in open in_progress blocked closed; do
        { gc ready --metadata-field "gc.root_bead_id=$root" --status "$st" --limit 0 --json \
            >"$tmp/$st.json" || printf '%s\n' "$st" >>"$tmp/failed"; } &
    done
    wait
    if [ -s "$tmp/failed" ]; then
        echo "gmol: gc ready failed for status: $(tr '\n' ' ' <"$tmp/failed")" >&2
        rc=1
    fi
    # unique_by sorts by id, so the union comes back in bead-id order. The
    # verdict extractors below take `| last`, which must mean "most recently
    # updated" -- without this re-sort the gate picks a verdict by id hash and
    # can sit on a stale `iterate` forever while a newer `done` is ignored.
    jq -s 'map(select(type=="array")) | add // [] | unique_by(.id) | sort_by(.updated_at // "")' "$tmp"/*.json || rc=1
    rm -rf "$tmp"
    return "$rc"
}

BEAD_ID="${GC_BEAD_ID:-}"
if [ -z "$BEAD_ID" ]; then
    echo "ERROR: GC_BEAD_ID not set" >&2
    exit 1
fi

BEAD_JSON=$(gc bd show "$BEAD_ID" --json 2>/dev/null)
ROOT_ID=$(printf '%s\n' "$BEAD_JSON" | jq -r 'if type == "array" then (.[0].metadata["gc.root_bead_id"] // "") else (.metadata["gc.root_bead_id"] // "") end')
ATTEMPT=$(printf '%s\n' "$BEAD_JSON" | jq -r 'if type == "array" then (.[0].metadata["gc.attempt"] // "") else (.metadata["gc.attempt"] // "") end')
if [ -z "$ROOT_ID" ]; then
    echo "ERROR: missing gc.root_bead_id on $BEAD_ID" >&2
    exit 1
fi

VERDICT=$(
    gmol "$ROOT_ID" |
        jq -r --arg root "$ROOT_ID" --arg attempt "$ATTEMPT" '
            [
              .[]
              | select(.metadata["gc.root_bead_id"] == $root)
              | select((.metadata["gc.continuation_group"] // "") == "design-review-fixes")
              | select(($attempt == "") or ((.metadata["gc.attempt"] // "") == $attempt))
              | .metadata["design_review.verdict"]
              | select(. != null and . != "")
            ] | last // ""
        '
)

case "$VERDICT" in
    done|approved|pass)
        echo "Design review approved"
        exit 0
        ;;
    iterate|fail|retry|"")
        echo "Design review needs another pass"
        exit 1
        ;;
    *)
        echo "Unknown design-review verdict: $VERDICT" >&2
        exit 1
        ;;
esac
