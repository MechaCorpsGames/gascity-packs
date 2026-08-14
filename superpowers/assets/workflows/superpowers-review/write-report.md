Run Superpowers code review for `{{subject_path}}` with optional context
`{{context_path}}`. Write the final adapter-consumable report to
`{{report_path}}`; do not post comments, push branches, or finalize external
state here.

Artifact validation: this step is gated by `.gc/scripts/checks/build-artifact-valid.sh`, which validates the report recorded at `gc.build.review_report_path` (fallback `gc.var.report_path`) against schema `gc.build.review.v1`. On repair attempts (`gc.attempt` greater than 1), read the validator errors from `gc.attempt_log` on the validation loop control bead (the dependent of this step bead) and repair the report in place instead of rewriting it. Two bounded repair attempts follow the first failure; exhausting them closes this stage with `gc.outcome=fail` and machine-readable validation errors that block downstream stages. Never ask questions in headless mode; record unresolved ambiguity inside the report.

## Adapter artifact represents the initial review

This outer `write-report` description remains the runtime prompt after the
Superpowers code-review expansion. The final adapter artifact and the repaired
workflow result therefore have different purposes:

- the highest numeric `write-report.process-code-review` attempt decides whether
  the repaired implementation is now complete;
- the adapter artifact at `{{report_path}}` preserves the lowest numeric
  `write-report.request-code-review` decision for external consumers.

List the closed lanes for the workflow root before selecting either result. Do
not choose a lane merely because it has the same title or appears first in a
list. Record the selected initial and final attempts in `## Verification`.

## HARD GATE: preserve an initial iterate finding

If the lowest numeric request-review attempt has
`code_review.review_verdict=iterate`, the YAML front matter of
`{{report_path}}` MUST be:

```yaml
status: changes_required
```

`status: approved is forbidden` in that case, even when the highest numeric
process-review attempt has `code_review.verdict=done`. The `## Findings`
section must preserve the original blocking finding. For the inference subject,
it must explicitly identify the shell-injection risk: user-controlled values
reached `subprocess` with `shell=True`. Later repair evidence belongs only in
`## Verification`.

If the initial request review approved, use the status that matches that initial
result. Do not substitute the later repaired workflow verdict for the initial
review result.

Compute every `trace.upstream` hash using `sha256sum`, with the form
`sha256:<digest>`. The artifact must use schema `gc.build.review.v1`, contain
`## Verdict`, `## Findings`, and `## Verification`, and update workflow-root
metadata `gc.build.review_report_path={{report_path}}`.

Before closing the claimed finalizer bead with `gc.outcome=pass`, change to the
rig root and run:

```bash
GC_BEAD_ID=<claimed-step-id> .gc/scripts/checks/initial-review-adapter-valid.sh
```

If this check fails, repair the report in place and rerun it. The generic build
artifact validator is not sufficient for this initial-review adapter contract.
