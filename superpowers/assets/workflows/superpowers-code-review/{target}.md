Finalize the Superpowers code-review expansion.

Verify the latest loop verdict from the code-review wrapper and
process-code-review lane.

## Authoritative loop result

The code-review loop may have more than one closed
`process-code-review` lane: an earlier attempt with an `iterate` verdict is
expected when the loop repairs findings. Determine the authoritative lane
before choosing either the approval or failure path:

1. List all closed beads for this workflow root whose metadata includes
   `gc.step_id=write-report.process-code-review`.
2. From those lanes, select the one with the highest numeric `gc.attempt`.
   A missing or non-numeric attempt is not authoritative; fail rather than
   guessing if no unique highest attempt exists.
3. Use that selected lane's `code_review.verdict` as the final loop result.
   Do not select an earlier `iterate` verdict merely because it has the same
   title, appears first in a list, or is mentioned by an earlier artifact.

The loop-control bead may corroborate the selected result, but it must not
replace the attempt-scoped process lane. Record the selected attempt and bead
id in the report's Verification section.

## Adapter artifact represents the initial review

The workflow verdict and the adapter artifact have different purposes. The
authoritative process lane above decides whether the repaired implementation may
pass. The adapter artifact preserves the initial review for external consumers,
even after later attempts repair the finding.

## HARD GATE: initial-review adapter artifact

This artifact represents the initial request-review decision, not the repaired
workflow result. If the lowest numeric request-review attempt has
`code_review.review_verdict=iterate`, its YAML front matter MUST contain
`status: changes_required`. status: approved is forbidden in that case, even if
the highest process lane is `done`. Preserve the original blocking finding under
`## Findings`; record later remediation only under `## Verification`.
Compute every upstream hash with `sha256sum` and write it as
`sha256:<digest>`; do not use MD5.

Before closing this target with `gc.outcome=pass`, run this exact validation
from the rig worktree:

```bash
GC_BEAD_ID=<claimed-step-id> .gc/scripts/checks/initial-review-adapter-valid.sh
```

If it fails, repair the adapter report before closing. The check is the
authoritative enforcement of the initial-review status and finding contract.

1. List closed lanes for this workflow root with `gc.step_id=write-report.request-code-review` and select the lowest numeric `gc.attempt`.
2. Read that lane's `code_review.review_verdict` and the initial subject/report evidence. If the initial verdict was `iterate`, the adapter artifact must remain `changes_required` even when the authoritative final process lane is `done`.
3. Preserve the original blocking finding in `## Findings` with enough detail
   to stand alone. For the inference subject, explicitly identify the
   shell-injection risk from user-controlled values reaching `subprocess` with
   `shell=True`, then state that the later repair was verified in
   `## Verification`.

Do not mark the adapter artifact `approved` merely because a retry approved the
fixed implementation. It represents the original review decision, while
`code_review.verdict=done` represents successful remediation.

Approval path:

- Confirm `code_review.verdict=done` on the process-code-review lane.
- Confirm the implementation review report exists at workflow root metadata
  `gc.build.code_review_report_path`.
- Confirm the gap-analysis report exists at workflow root metadata
  `gc.build.gap_analysis_report_path`.
- Confirm the review fix summary exists at workflow root metadata
  `gc.build.review_fix_summary_path`.
- Write the adapter-consumable review artifact to `{{report_path}}` with YAML
  front matter `schema: gc.build.review.v1`. This report represents the
  initial implementation review verdict for external adapters, not the
  post-fix summary. If the implementation review required changes, use
  `status: changes_required` or `status: blocked`; if it approved without
  findings, use `status: approved`.
- The `{{report_path}}` report must include the required `Verdict`,
  `Findings`, and `Verification` sections, mention the implementation review
  report and gap-analysis report in `trace.upstream`, and include matching
  `trace.coverage` entries.
- Use this artifact shape, replacing placeholder values and computing real
  `sha256:<digest>` hashes for the upstream files:

```markdown
---
schema: gc.build.review.v1
workflow:
  id: <workflow root id>
  formula: superpowers-review
methodology:
  pack: superpowers
  name: superpowers-review
producer:
  formula: superpowers-code-review
  stage: finalize
  attempt: 1
status: changes_required
trace:
  upstream:
    - path: .gc/inference-gate/implementation-review-report.md
      hash: sha256:<digest>
      ids: [SP-REVIEW-001]
    - path: .gc/inference-gate/gap-analysis-report.md
      hash: sha256:<digest>
      ids: [SP-REVIEW-002]
  coverage:
    - id: SP-REVIEW-001
      status: covered
    - id: SP-REVIEW-002
      status: covered
---

## Verdict

| ID | Status |
| --- | --- |
| SP-REVIEW-001 | covered |
| SP-REVIEW-002 | covered |

## Findings

## Verification
```

- Update workflow root metadata:
  - `gc.build.code_review_status=approved`
  - `gc.build.code_review_approved_at=<UTC timestamp>`
  - `gc.build.review_report_path={{report_path}}`
- Close this expansion target with `gc.outcome=pass`,
  `code_review.verdict=done`, and
  `code_review.report_path=<review fix summary path>`.

Failure path:

- If unresolved required findings remain, do not approve the expansion.
- Write the adapter-consumable review artifact to `{{report_path}}` with YAML
  front matter `schema: gc.build.review.v1`, `status: changes_required` or
  `status: blocked`, and the required `Verdict`, `Findings`, and
  `Verification` sections.
- Update workflow root metadata with `gc.build.code_review_status=failed` and
  `gc.build.review_report_path={{report_path}}`.
- Close with `gc.outcome=fail`, `code_review.report_path=<review fix summary
  path>`, and a concise `gc.failure_reason` that points at the blocking
  finding.
