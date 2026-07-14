Finalize the BMAD build and write its canonical final report.

Read the exact report path from workflow root metadata
`gc.build.final_report_path`. Write the report there and do not replace it with
an attempt-local path. Read the canonical requirements, plan, decomposition,
implementation-readiness report, implementation summary, and review report.
Include their paths and hashes, implementation convoy and source anchors,
changed files, tests run, review verdict, residual risks, and next human action.

Write Markdown with YAML front matter valid for
`gc.build.final-report.v1`, not JSON. The artifact's first line must be `---`, followed by
a closing `---` before the Markdown body. Use nested mappings with this
top-level shape:

```yaml
---
schema: gc.build.final-report.v1
workflow:
  id: <workflow-root-id>
  formula: bmad-build
methodology:
  pack: bmad
  name: bmad-build
producer:
  formula: bmad-build
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

Use `status: approved` only when readiness approved, all required
implementation evidence passed, and the review contract permits completion.
Otherwise use `status: blocked`, retain failure metadata, and do not mark the
build completed.

Every `trace.upstream` entry must contain `path` and a scheme-qualified `hash`.
Preserve actual source IDs verbatim; never invent, substitute, or renumber
them. Every declared ID must appear exactly once in `trace.coverage`; when no
source declares IDs, omit `ids` and use `coverage: []`. Give every
non-`covered` row a rationale.

Include one Markdown coverage table whose `ID` and `Status` pairs exactly match
the YAML coverage:

| ID | Status |
| --- | --- |
| <actual-source-id> | covered |

Only include the example data row when coverage is non-empty, replacing the
placeholder with an actual ID. When coverage is empty, omit the table or use
only its header and separator; do not add a placeholder data row.

Use these schema-required second-level headings in this exact order:

- `## Summary`
- `## Outcome`
- `## Artifacts`
- `## Remaining Risks`

Before closing, resolve the launcher rig root from workflow root metadata
`gc.work_dir`. If it names an attempt worktree without the validator, walk to
the nearest ancestor containing
`.gc/scripts/checks/build-artifact-valid.sh`. Read the exact current bead ID
from the startup claim output and assign it literally in the same shell call;
shell variables from earlier tool calls do not persist. Run:

```bash
CLAIMED_BEAD_ID=<exact-claimed-bead-id>; GC_BEAD_ID="$CLAIMED_BEAD_ID" <launcher-rig>/.gc/scripts/checks/build-artifact-valid.sh
```

Fix every validation error at `gc.build.final_report_path`. On repair attempts
(`gc.attempt` greater than 1), read validator errors from `gc.attempt_log` on
the dependent validation-loop control bead and repair the same report in
place. Two bounded repair attempts follow the first failure.

Only after the final report validates and all evidence is successful, reconcile
workflow root lifecycle metadata in one update:

```bash
gc bd update <workflow-root-id> \
  --set-metadata 'gc.build.final_report_path=<canonical final report path>' \
  --set-metadata 'gc.build.status=completed' \
  --set-metadata 'gc.build.finalize_status=completed' \
  --set-metadata 'gc.build.finalize_outcome=success' \
  --unset-metadata gc.blocked_reason \
  --unset-metadata gc.failure_class
```

Then set the claimed step to `gc.outcome=pass` and close it. If validation or
required evidence fails, retain or set `gc.blocked_reason` and
`gc.failure_class`, set `gc.build.finalize_outcome=failure`, and close with
`gc.outcome=fail`; never emit completed lifecycle metadata on failure.

Do not invoke provider-native subagents or upstream BMAD runtime commands.
