Apply build-basic starter review findings.

Read current lanes and synthesis; then recompute the current implementation snapshot
from exact member id/commit tuples. Recompute the review-input snapshot
from it plus canonical absolute summary/context paths and raw-byte SHA-256
digests. Every lane, synthesis, and root value must match; metadata, not prose,
is authoritative.

If all three review lanes approve those exact snapshots, this is a mandatory
no-op. Optional or non-blocking suggestions must not authorize edits. Write a
no-op summary that preserves both snapshots.

In root `gc.var.review_mode=report`, never mutate code. If any lane requires
iteration, record it, set `code_review.verdict=iterate`, and skip fixes.

Resolve the authoritative implementation worktree/source anchor from context.
Retain `gc.implementation.worktree_path`, `gc.implementation.commit`, and
`gc.implementation.summary_path`. Before no-op `done`, require `HEAD`, tracked
bytes, and unexpected-untracked status to match. Any restoration changes bytes:
set `code_review.verdict=iterate` and require a subsequent unchanged review;
never restore bytes and report `done` together.

If required fixes or missing evidence remain, act only on a concrete `iterate`
lane item in the authoritative implementation worktree at
`gc.implementation.worktree_path`. Make the smallest change and run proof.
Commit product changes, capture the current full commit, and update
`gc.implementation.commit`. Refresh `gc.implementation.summary_path`, canonical
`gc.build.implementation_summary_path`, and review context with the current
`sha256`. Recompute `gc.build.implementation_snapshot` and
`gc.build.review_input_snapshot`. This pass must set `code_review.verdict=iterate`
with both new snapshots; only a subsequent
unchanged pass approved by all three lanes may set `done`.

Write the summary at a canonical absolute path under the build artifact root.
Apply fixes to the source anchor/worktree, not to the launcher rig root; a
root-checkout observation cannot override an `iterate` verdict or authorize
`done`.

Set `code_review.verdict=done` only for an unchanged, all-approved branch. Close
with `gc.outcome=pass`, `code_review.verdict=done|iterate`,
`code_review.reviewed_attempt=<current gc.attempt>`,
`code_review.implementation_snapshot=<current snapshot>`,
`code_review.review_input_snapshot=<current review-input snapshot>`, and both
`code_review.report_path` and `code_review.output_path` set to the summary.

Use the exact claimed bead id and no extra positional arguments.

Unchanged/no-op `done` example:

```bash
gc bd update "$CLAIMED_BEAD_ID" --set-metadata 'gc.outcome=pass' --set-metadata 'code_review.verdict=done' --set-metadata 'code_review.reviewed_attempt=<current gc.attempt>' --set-metadata 'code_review.implementation_snapshot=<current snapshot>' --set-metadata 'code_review.review_input_snapshot=<current review-input snapshot>' --set-metadata 'code_review.report_path=<summary>' --set-metadata 'code_review.output_path=<summary>'
gc bd close "$CLAIMED_BEAD_ID" --reason 'Build-basic starter review approved.'
```

Changed/restored-bytes `iterate` example:

```bash
gc bd update "$CLAIMED_BEAD_ID" --set-metadata 'gc.outcome=pass' --set-metadata 'code_review.verdict=iterate' --set-metadata 'code_review.reviewed_attempt=<current gc.attempt>' --set-metadata 'code_review.implementation_snapshot=<new snapshot>' --set-metadata 'code_review.review_input_snapshot=<new review-input snapshot>' --set-metadata 'code_review.report_path=<summary>' --set-metadata 'code_review.output_path=<summary>'
gc bd close "$CLAIMED_BEAD_ID" --reason 'Inputs changed; fresh review required.'
```

Do not invoke provider-native subagents; this lane owns fix delegation.
