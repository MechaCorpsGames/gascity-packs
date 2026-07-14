Finalize the gstack sprint.

Read the canonical final report path from workflow root metadata
`gc.build.final_report_path` and write the report there. Do not replace it with
an attempt-local path. Include the methodology, interaction_mode, review_mode,
requirements path, plan path, decomposition path, implementation summary,
review report, QA report, release readiness report, tests run, changed files,
residual risks, and next human action.

The report should explain that garrytan/gstack role behavior was adapted into
Gas City fanouts and persistent beads. Keep it useful for someone using
automated factories for the first time.

The report must be Markdown with YAML front matter valid for
`gc.build.final-report.v1`, not JSON. Its first line must be `---`, with a
closing `---` before the Markdown body. Use nested YAML mappings with this
top-level shape:

```yaml
---
schema: gc.build.final-report.v1
workflow:
  id: <workflow-root-id>
  formula: <root-workflow-formula>
methodology:
  pack: gstack
  name: gstack-build
producer:
  formula: gstack-build
  stage: finalize
  attempt: <positive integer>
status: approved
trace:
  upstream:
    - path: <canonical-build-artifact-path>
      hash: sha256:<artifact-digest>
      ids: [<actual-source-id>]
  coverage:
    - id: <actual-source-id>
      status: covered
---
```

Use `status: approved` only when the canonical requirements, plan,
decomposition, implementation summary, review, QA, and release-readiness
evidence support a successful build. Use `status: blocked` and keep failure
metadata when required evidence failed.

Every `trace.upstream` entry must contain a path and scheme-qualified hash.
Preserve actual source IDs verbatim; never invent, substitute, or renumber
them. Account for each declared ID exactly once in `trace.coverage`; when no
source declares IDs, omit `ids` and use `coverage: []`. Every non-`covered`
entry requires a rationale. Include one Markdown table whose `ID` and `Status`
pairs exactly match `trace.coverage`:

| ID | Status |
| --- | --- |
| <actual-source-id> | covered |

Only include the example data row when coverage is non-empty, and replace the
placeholder with an actual ID. When coverage is empty, do not add a data row;
omit the table or use only its header and separator.

Use these schema-required second-level headings in this exact order:

- `## Summary`
- `## Outcome`
- `## Artifacts`
- `## Remaining Risks`

Before closing, resolve the launcher rig root from workflow root metadata
`gc.work_dir`. If it names a step worktree without the check, use the nearest
ancestor containing `.gc/scripts/checks/build-artifact-valid.sh`. Read the exact
current bead ID from the startup claim output and substitute it literally
below; shell variables from earlier tool calls do not persist. Then run:

```bash
GC_BEAD_ID=<exact-claimed-bead-id> <launcher-rig>/.gc/scripts/checks/build-artifact-valid.sh
```

Fix every validation error against the canonical `gc.build.final_report_path`
before declaring success. After validation and all required evidence pass,
reconcile workflow root lifecycle metadata in one update:

```bash
gc bd update <workflow-root-id> \
  --set-metadata 'gc.build.final_report_path=<canonical final report path>' \
  --set-metadata 'gc.build.status=completed' \
  --set-metadata 'gc.build.finalize_status=completed' \
  --set-metadata 'gc.build.finalize_outcome=success' \
  --unset-metadata gc.blocked_reason \
  --unset-metadata gc.failure_class
```

Do not clear either failure marker when validation or required evidence fails.

Close with `gc.outcome=pass` and the sprint report path.

Do not invoke provider-native subagents.

Artifact validation: this stage is gated by `.gc/scripts/checks/build-artifact-valid.sh`, which validates the artifact recorded at `gc.build.final_report_path` against schema `gc.build.final-report.v1`. On repair attempts (`gc.attempt` greater than 1), read the validator errors from `gc.attempt_log` on the validation loop control bead (the dependent of this step bead) and repair the artifact in place instead of rewriting it. Two bounded repair attempts follow the first failure; exhausting them closes this stage with `gc.outcome=fail` and machine-readable validation errors that block downstream stages. Never ask questions in headless mode; record unresolved ambiguity inside the artifact.
