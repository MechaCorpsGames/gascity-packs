Run Superpowers code review with the installed `requesting-code-review` skill.

Review the implementation against the requirements, plan, decomposition, and
test evidence. Write an implementation-review report with pass/fail verdict and
actionable findings. Required fixes must be specific enough for the processing
step to resolve them directly.

## Retry-aware evidence

The subject diff and implementation summary describe the **Initial-review
baseline**. They preserve the original change for traceability, so they may
continue to show a defect after a repair pass. Before issuing a verdict, inspect
the current attempt and its repair evidence:

1. List closed lanes for this workflow root with `gc.step_id=write-report.process-code-review`, then select the highest numeric `gc.attempt` that is lower than this lane's attempt.
2. If that prior process lane has `code_review.verdict=iterate`, read the
   review-fix summary at workflow-root metadata
   `gc.build.review_fix_summary_path`.
3. Verify the claimed resolution against the fixed implementation worktree or
   commit recorded in that summary, including its relevant test evidence.

The static initial subject alone is not evidence that a finding remains open.
On a retry, you must not issue an `iterate` verdict merely because the
Initial-review baseline still contains the original vulnerable code. Return
`iterate` only for a finding that remains in the fixed implementation or whose
claimed resolution cannot be verified.

Read the code-review context from workflow root metadata
`gc.build.code_review_context_path`. Write the implementation review report to
workflow root metadata path `gc.build.code_review_report_path`, which should be
`<artifact_root>/implementation-review-report.md`.

Close with `gc.outcome=pass`,
`code_review.review_verdict=approve|iterate`,
`code_review.review_report_path=<implementation review report path>`, and
`code_review.output_path=<implementation review report path>`.

Use the exact claimed bead id when updating metadata. Do not pass freeform notes
or additional positional arguments to `bd update`; unquoted words can resolve to
unrelated beads. Use this command shape:

```bash
bd update "$CLAIMED_BEAD_ID" \
  --set-metadata 'gc.outcome=pass' \
  --set-metadata 'code_review.review_verdict=approve' \
  --set-metadata 'code_review.review_report_path=<implementation review report path>' \
  --set-metadata 'code_review.output_path=<implementation review report path>'
bd close "$CLAIMED_BEAD_ID" --reason 'Implementation review approved with no required findings.'
```

Do not set `code_review.verdict` or `code_review.report_path`; the
process-code-review lane owns those approval-check fields.

Do not invoke provider-native subagents. You are the Gas City code review lane.
