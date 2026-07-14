Apply required BMAD code-review findings.

Read the synthesized BMAD review report and resolve required findings in this
single lane. Preserve traceability to the review lane, story id, acceptance
criteria, file anchors, and severity.

Read the canonical absolute review directory from workflow root metadata
`gc.build.code_review_artifact_root` and the synthesized report from the exact
`gc.build.code_review_report_path`. Require the report to be absolute and
contained by that root. Write the review-fix summary to the exact path already
recorded in `gc.build.review_fix_summary_path`; if it is blank, derive
`<code-review-artifact-root>/apply-summary.md` and record it on the workflow
root before writing. Reject any input or output path outside the recorded
review root.

Use implementation target {{implementation_target}} for any code changes.
Close this lane only after the implementation summary and BMAD review artifact
record changed files, tests run, resolved findings, and blockers. If there are
no required fixes, record a no-op review-fix artifact instead of editing code.

If the synthesized report approves the implementation with no required fixes,
perform a no-op pass, update workflow root metadata with
`gc.build.code_review_status=approved`, and close with
`code_review.verdict=done`. If required fixes remain after processing, update
workflow root metadata with `gc.build.code_review_status=draft` and close with
`code_review.verdict=iterate`.

Always close with `gc.outcome=pass`,
`code_review.report_path=<review fix summary path>`, and
`code_review.output_path=<review fix summary path>`.

Do not invoke provider-native subagents. This graph lane is the delegation
mechanism.
