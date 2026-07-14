Finalize the Superpowers code-review expansion.

Verify the latest loop verdict from the code-review wrapper and
process-code-review lane.

The expansion keeps its implementation review at workflow root metadata
`gc.build.code_review_report_path`. The terminal bead's
`gc.build.artifact_path_keys` is the caller's adapter-output contract. For
either successful path below, satisfy that exact contract before closing:

- When the only selected key is `gc.build.review_report_path`, use the path
  already recorded on the workflow root or derive
  `<artifact_root>/review-report.md` when it is blank.
- When the only selected key is `gc.var.report_path`, use the exact non-empty
  requested path recorded on the workflow root. Do not replace a
  caller-provided report path with an implementation-specific path.
- Copy the validated `gc.build.review.v1` implementation review report from
  `gc.build.code_review_report_path` to the selected adapter report path when
  the paths differ. Preserve the report's verdict and contents; do not
  substitute the gap-analysis report or review-fix summary.
- Confirm the selected adapter report exists and validates as
  `gc.build.review.v1`. Persist a derived `gc.build.review_report_path` on the
  workflow root; preserve an existing `gc.var.report_path` unchanged.
- On repair attempts (`gc.attempt` greater than 1), read `gc.attempt_log` on
  the validation loop control bead first and repair the exact selected adapter
  path named by the validator. Do not invent an attempt-local report path.

Report-only path:

- If workflow root metadata `gc.var.review_mode=report`, do not require the
  process-code-review lane and do not apply fixes.
- Confirm the implementation review report exists at workflow root metadata
  `gc.build.code_review_report_path`.
- Confirm the gap-analysis report exists at workflow root metadata
  `gc.build.gap_analysis_report_path`.
- Preserve the reports' own verdicts (`approved`, `changes_required`, or
  `blocked`). In report mode, producing the validated reports is the successful
  deliverable even when findings require changes.
- Update workflow root metadata:
  - `gc.build.code_review_status=reported`
  - `gc.build.code_review_report_path=<implementation review report path>`
  - `gc.build.review_report_path=<canonical review report path>` when required
    by the caller-selected artifact contract
  - `gc.var.report_path=<requested adapter report path>` when selected by the
    caller
- Close this expansion target with `gc.outcome=pass`,
  `code_review.verdict=reported`, and
  `code_review.report_path=<selected adapter report path>`.

Approval path for `agent` and `interactive` modes:

- Confirm `code_review.verdict=done` on the process-code-review lane.
- Confirm the implementation review report exists at workflow root metadata
  `gc.build.code_review_report_path`.
- Confirm the gap-analysis report exists at workflow root metadata
  `gc.build.gap_analysis_report_path`.
- Confirm the review fix summary exists at workflow root metadata
  `gc.build.review_fix_summary_path`.
- Update workflow root metadata:
  - `gc.build.code_review_status=approved`
  - `gc.build.code_review_approved_at=<UTC timestamp>`
  - `gc.build.review_report_path=<canonical review report path>` when required
    by the caller-selected artifact contract
- Close this expansion target with `gc.outcome=pass`,
  `code_review.verdict=done`, and
  `code_review.report_path=<review fix summary path>`.

Failure path:

- If unresolved required findings remain, do not approve the expansion.
- Update workflow root metadata with `gc.build.code_review_status=failed`.
- Close with `gc.outcome=fail`, `code_review.report_path=<review fix summary
  path>`, and a concise `gc.failure_reason` that points at the blocking
  finding.
