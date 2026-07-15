Apply build-basic starter review findings.

Use implementation target {{implementation_target}} for required code changes.
Read the three current-attempt lane verdicts, their
`code_review.implementation_snapshot` values, and the synthesis. Before opening
a worktree, recompute the current implementation snapshot from the exact convoy
member-id/commit tuples. All lane snapshots must equal each other, the root
`gc.build.implementation_snapshot`, and the recomputed value. Lane metadata is
authoritative; prose cannot promote an approved observation into required work.

If all three review lanes approve at that exact snapshot, this is a mandatory
no-op. Optional or non-blocking suggestions must not authorize or receive
implementation edits. Do not apply, edit, modify, or change product files in
this branch. Write a no-op summary and set `code_review.verdict=done` plus the
unchanged `code_review.implementation_snapshot`.

Resolve the authoritative implementation worktree and source-anchor bead from
the review context. Retain its absolute `gc.implementation.worktree_path`,
recorded `gc.implementation.commit`, and `gc.implementation.summary_path`.
Before a no-op `done`, require `HEAD`, tracked bytes, and unexpected-untracked
status to match the recorded evidence. If earlier optional drift must be
restored, that restoration changed implementation bytes during this pass: it
must set `code_review.verdict=iterate`, refresh all evidence, and receive a
subsequent unchanged review. Never restore bytes and report `done` in one pass.

If required fixes or missing evidence remain, and only when a lane verdict is
`iterate` with a concrete required item, make the smallest focused change in
the authoritative implementation worktree recorded by
`gc.implementation.worktree_path` and run the relevant proof commands. Commit
every product change, capture the current full commit, and update the source
anchor's `gc.implementation.commit`. Refresh the per-item artifact at
`gc.implementation.summary_path`, the canonical artifact at
`gc.build.implementation_summary_path` with its current `sha256` digest, and the
review context. Recompute and record `gc.build.implementation_snapshot`. Any
pass that changes implementation bytes or commits must set
`code_review.verdict=iterate` with the new
`code_review.implementation_snapshot`; only a subsequent unchanged pass where
all three freshly bound lanes approve may set `done`.

Write the no-op or review-fix summary under the build artifact root. Apply fixes
to the implementation source anchor/worktree, not to the launcher rig root. An
unchanged root checkout is owned by publish and is not itself product drift, but
a root-checkout observation cannot override an `iterate` lane verdict or
authorize `done`.

Set `code_review.verdict=done` only for an unchanged, all-approved, current-
snapshot branch. Always close with `gc.outcome=pass`,
`code_review.verdict=done|iterate`,
`code_review.implementation_snapshot=<current snapshot>`,
`code_review.report_path=<starter review summary path>`, and
`code_review.output_path=<starter review summary path>`.

Use the exact claimed bead id when updating metadata. Do not pass freeform notes
or additional positional arguments to `gc bd update`; unquoted words can resolve to
unrelated beads. Use this command shape:

```bash
gc bd update "$CLAIMED_BEAD_ID" \
  --set-metadata 'gc.outcome=pass' \
  --set-metadata 'code_review.verdict=done' \
  --set-metadata 'code_review.implementation_snapshot=<current snapshot>' \
  --set-metadata 'code_review.report_path=<starter review summary path>' \
  --set-metadata 'code_review.output_path=<starter review summary path>'
gc bd close "$CLAIMED_BEAD_ID" --reason 'Build-basic starter review approved.'
```

Do not invoke provider-native subagents. This starter factory graph lane is the
fix delegation mechanism.
