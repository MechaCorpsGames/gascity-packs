
Write the review verdict report to {{report_path}} with pass/fail, findings,
missing evidence, and recommended fixes for subject {{subject_path}}.

Read the subject input from workflow-root metadata `gc.var.subject_path` and
resolve it to the canonical absolute path represented by `{{subject_path}}`.
Record that exact path in `trace.upstream`, run `sha256sum` on the file, and
record the resulting `sha256:` value with exactly 64 hexadecimal digits.
Never use a placeholder digest, a label, or a guessed revision in place of
the subject's actual bytes.

The requested review authority is `{{review_mode}}`: in `report` mode, write
findings and verdicts without mutating code; in `agent` mode, also include a
structured fix handoff for the caller's review-fix formula to apply; in
`interactive` mode, safe fixes may be negotiated or applied with every change
and reason recorded in the report. The interaction posture is
`{{interaction_mode}}`.

Artifact validation: this step is gated by `.gc/scripts/checks/build-artifact-valid.sh`, which validates the report recorded at `gc.build.review_report_path` (fallback `gc.var.report_path`) against schema `gc.build.review.v1`. On repair attempts (`gc.attempt` greater than 1), read the validator errors from `gc.attempt_log` on the validation loop control bead (the dependent of this step bead) and repair the report in place instead of rewriting it. Two bounded repair attempts follow the first failure; exhausting them closes this stage with `gc.outcome=fail` and machine-readable validation errors that block downstream stages. Never ask questions in headless mode; record unresolved ambiguity inside the report.
