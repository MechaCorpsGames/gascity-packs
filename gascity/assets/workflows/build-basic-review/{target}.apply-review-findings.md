Apply build-basic starter review findings.

Read current lanes and synthesis; recompute the current implementation snapshot
from exact member/commit tuples and the review-input snapshot from canonical
summary/context paths and SHA-256. Every lane, synthesis, and root metadata
must match.

If all three review lanes approve those exact snapshots, this is a mandatory
no-op. Optional or non-blocking suggestions must not authorize edits.

In root `gc.var.review_mode=report`, never mutate code. If any lane requires
iteration, record it, set `code_review.verdict=iterate`, and skip fixes.

Resolve the authoritative source worktree from context.
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

Read `<artifact-root>` from root `gc.build.artifact_root`; require it to be
absolute and equal the parent of `gc.build.code_review_context_path`.
Write `<artifact-root>/apply-review-findings-report.md`; never put
review evidence in the authoritative implementation worktree. Prefix Python
proof with `PYTHONDONTWRITEBYTECODE=1`; leave no `__pycache__` or bytecode.
Apply product fixes to the source worktree, not to the launcher rig root; a
root-checkout observation cannot override `iterate`.

Set `code_review.verdict=done` only for an unchanged, all-approved branch. Close
with `gc.outcome=pass`, `code_review.verdict=done|iterate`,
`code_review.reviewed_attempt=<current gc.attempt>`,
`code_review.implementation_snapshot=<current snapshot>`,
`code_review.review_input_snapshot=<current review-input snapshot>`. Set both
`code_review.report_path` and `code_review.output_path` to the exact
`<apply-report>` path above.

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

Do not invoke provider-native subagents; this lane owns fix delegation.
