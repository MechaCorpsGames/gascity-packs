Apply build-basic starter review findings.

Use implementation target {{implementation_target}} for any required code
changes. Read the three current-attempt lane verdicts and the starter review
synthesis before opening an implementation worktree. Lane metadata is
authoritative; prose cannot promote an approved observation into required work.

If all three review lanes approve, this is a mandatory no-op. Optional or
non-blocking suggestions must not authorize or receive implementation edits,
even when described as a recommendation, simplification, or "next step". Do
not apply, edit, modify, or change product files in this branch. Write a no-op
review summary and set `code_review.verdict=done`.

Resolve the authoritative implementation worktree and source-anchor bead from
the review context. Read and retain its absolute
`gc.implementation.worktree_path`, recorded `gc.implementation.commit`, and
`gc.implementation.summary_path`. Before closing a no-op branch, require the
worktree `HEAD` and tracked bytes to equal the recorded commit. If an earlier
review-fix attempt introduced uncommitted optional drift, restore those tracked
bytes from the recorded commit before writing the no-op summary; never bless
the drift as a new implementation.

If required fixes or missing evidence remain, and only when a lane verdict is
`iterate` with a concrete required item, make the smallest focused change in
the authoritative implementation worktree recorded by
`gc.implementation.worktree_path` and run the relevant proof commands. Commit every
product change, capture the current full commit, and update the source anchor's
`gc.implementation.commit` to that exact commit. Refresh the per-item artifact
at `gc.implementation.summary_path`, including its source-bead identity and
current proof. Then refresh the canonical artifact recorded on the workflow
root as `gc.build.implementation_summary_path`, including the exact per-item
summary path and its current `sha256` digest. Refresh the review context so the
next lanes see the new commit and evidence. A change-producing pass must set
`code_review.verdict=iterate`, never `done`; only a subsequent unchanged pass
where all three lanes approve may set `done`.

Write the no-op or review-fix summary under the build artifact root.

Apply fixes to the implementation source anchor/worktree named in the review
context, not to the launcher rig root. An unchanged root checkout is not itself
a required fix for build-basic; publish owns propagation beyond the source
anchor. If the only reported issue is "implementation exists in the worktree but
not the root checkout" and the source anchor/worktree passes the requirements,
record a no-op fix summary and set `code_review.verdict=done`.

Set `code_review.verdict=done` only for the unchanged all-approved branch after
the worktree/recorded-commit check passes. Set `code_review.verdict=iterate`
when required fixes remain or whenever this pass changed implementation bytes.

Always close with `gc.outcome=pass`,
`code_review.verdict=done|iterate`,
`code_review.report_path=<starter review summary path>`, and
`code_review.output_path=<starter review summary path>`.

Use the exact claimed bead id when updating metadata. Do not pass freeform notes
or additional positional arguments to `gc bd update`; unquoted words can resolve to
unrelated beads. Use this command shape:

```bash
gc bd update "$CLAIMED_BEAD_ID" \
  --set-metadata 'gc.outcome=pass' \
  --set-metadata 'code_review.verdict=done' \
  --set-metadata 'code_review.report_path=<starter review summary path>' \
  --set-metadata 'code_review.output_path=<starter review summary path>'
gc bd close "$CLAIMED_BEAD_ID" --reason 'Build-basic starter review approved.'
```

Do not invoke provider-native subagents. This starter factory graph lane is the
fix delegation mechanism.
