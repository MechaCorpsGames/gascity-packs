Apply build-basic starter review findings.

Recompute both snapshots from exact sorted member/commit tuples and canonical
summary/context bytes. Require every lane, synthesis, and root value to match.

If all three review lanes approve those exact snapshots, this is a mandatory
no-op. Optional or non-blocking suggestions must not authorize edits.

In root `gc.var.review_mode=report`, never mutate code. If any lane requires
iteration, record it, set `code_review.verdict=iterate`, and skip fixes.

Resolve the authoritative source worktree from context. Retain
`gc.implementation.worktree_path`, `gc.implementation.commit`, and
`gc.implementation.summary_path`. No-op `done` requires matching `HEAD`, tracked
bytes, and untracked status. Restoration means `iterate`, never `done`.

If required fixes or missing evidence remain, act only on a concrete `iterate`
item in the authoritative implementation worktree at
`gc.implementation.worktree_path`. Resolve its implementation convoy member id,
make the smallest change, run proof, and capture current full commit (`HEAD`).
Update that member (never the root or claimed apply bead) immediately:
`gc bd update "<implementation-member-id>" --set-metadata 'gc.implementation.commit=<current full HEAD>' --set-metadata 'gc.implementation.summary_path=<current absolute member summary>'`.
Refresh `gc.implementation.summary_path`, canonical
`gc.build.implementation_summary_path`, and
`gc.build.code_review_context_path` with current `sha256` traces; before closing
the current Ralph iteration, recompute both snapshots and publish them:
`gc bd update "<workflow-root-id>" --set-metadata 'gc.build.implementation_snapshot=<new snapshot>' --set-metadata 'gc.build.review_input_snapshot=<new review-input snapshot>'`.
Read both beads back; require commit, `HEAD`, summaries, context, and snapshots
to agree. Set `iterate`; only a later unchanged, all-approved pass may set `done`.

Require absolute root `gc.build.artifact_root` to equal the parent of
`gc.build.code_review_context_path`. Write `<artifact-root>/apply-review-findings-report.md`,
never review evidence in the implementation worktree. Use
`PYTHONDONTWRITEBYTECODE=1`; leave no bytecode. Fix only the source worktree; an
unchanged launcher root cannot override `iterate`.

Set `code_review.verdict=done` only when unchanged and all-approved. Close with
`gc.outcome=pass`, `code_review.verdict=done|iterate`,
`code_review.reviewed_attempt=<current gc.attempt>`,
`code_review.implementation_snapshot=<current snapshot>`,
`code_review.review_input_snapshot=<current review-input snapshot>`, and both
report/output paths equal to `<apply-report>`.

Unchanged/no-op `done` example:

```bash
gc bd update "$CLAIMED_BEAD_ID" --set-metadata 'gc.outcome=pass' --set-metadata 'code_review.verdict=done' --set-metadata 'code_review.reviewed_attempt=<current gc.attempt>' --set-metadata 'code_review.implementation_snapshot=<current snapshot>' --set-metadata 'code_review.review_input_snapshot=<current review-input snapshot>' --set-metadata 'code_review.report_path=<apply-report>' --set-metadata 'code_review.output_path=<apply-report>'
gc bd close "$CLAIMED_BEAD_ID" --reason 'Build-basic starter review approved.'
```

Changed/restored-bytes `iterate` example:

```bash
gc bd update "$CLAIMED_BEAD_ID" --set-metadata 'gc.outcome=pass' --set-metadata 'code_review.verdict=iterate' --set-metadata 'code_review.reviewed_attempt=<current gc.attempt>' --set-metadata 'code_review.implementation_snapshot=<new snapshot>' --set-metadata 'code_review.review_input_snapshot=<new review-input snapshot>' --set-metadata 'code_review.report_path=<apply-report>' --set-metadata 'code_review.output_path=<apply-report>'
gc bd close "$CLAIMED_BEAD_ID" --reason 'Inputs changed; fresh review required.'
```
