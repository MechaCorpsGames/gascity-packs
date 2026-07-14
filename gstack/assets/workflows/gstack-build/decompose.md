Create the gstack implementation convoy.

Read the approved plan and decompose it into implementation beads under the
workflow root bead. Each bead must map to one vertical slice and include
acceptance criteria, files or modules likely affected, first verification
command, and expected proof command.

Create the implementation work-item beads first, then create one new non-empty
implementation convoy from those bead IDs. Do not reuse the workflow's launch
or source convoy. Record the new convoy ID on the workflow root bead as both
`gc.input_convoy_id=<implementation-convoy-id>` and
`gc.build.implementation_convoy_id=<implementation-convoy-id>`. Do not record
these only on the current step. Before closing, verify both workflow root
metadata values identify the new implementation convoy.

Do not copy review-lane procedure into implementation beads. The convoy should
describe product work; `gstack-work` carries the execution process.

Read the exact decomposition path from workflow root metadata
`gc.build.decomposition_path` (fallback `gc.var.decomposition_path`) and write
the canonical artifact there. It must be Markdown with YAML front matter, not
JSON. Its first line must be `---`, with a closing `---` before the Markdown
body. Use nested YAML mappings with this top-level shape:

```yaml
---
schema: gc.build.decomposition.v1
workflow:
  id: <workflow-root-id>
  formula: <root-workflow-formula>
methodology:
  pack: gstack
  name: gstack-decomposition
producer:
  formula: gstack-build
  stage: decompose
  attempt: <positive integer>
status: approved
trace:
  upstream:
    - path: <approved-plan-path>
      hash: sha256:<approved-plan-digest>
      ids: [<actual-source-id>]
  coverage:
    - id: <actual-source-id>
      status: covered
---
```

Every `trace.upstream` entry must contain `path` and a scheme-qualified `hash`.
Preserve actual source IDs verbatim; never invent, substitute, or renumber
them. Every declared upstream ID must appear exactly once in `trace.coverage`;
when none are declared, omit `ids` and use `coverage: []`. Every non-`covered`
row needs a rationale. Include one Markdown coverage table. The table columns
are `ID` and `Status`. Their pairs must exactly match the YAML coverage:

| ID | Status |
| --- | --- |
| <actual-source-id> | covered |

Only include the example data row when coverage is non-empty, and replace the
placeholder with an actual ID. When coverage is empty, do not add a data row;
omit the table or use only its header and separator.

Use these schema-required second-level headings in this exact order:

- `## Summary`
- `## Selected Downstream Formulas`
- `## Implementation Convoy`
- `## Work Items`

Record each work-item bead ID, dependency, accepted requirement IDs, plan
section, affected files, first verification command, and expected proof command
under `## Work Items`. Record the new convoy ID and its members under
`## Implementation Convoy`.

Record `gc.build.decomposition_path=<absolute path>` on the workflow root bead.
Before closing, resolve the launcher rig root from workflow root metadata
`gc.work_dir`, walk to the nearest ancestor containing the canonical check when
needed, and read the exact current bead ID from the startup claim output.
Substitute that ID literally below; shell variables from earlier tool calls do
not persist. Run:

```bash
GC_BEAD_ID=<exact-claimed-bead-id> <launcher-rig>/.gc/scripts/checks/build-artifact-valid.sh
```

Fix every validation error in the canonical artifact and verify both convoy
metadata fields before setting `gc.outcome=pass`.

Close with `gc.outcome=pass`.

Do not invoke provider-native subagents. Gas City graph lanes own fanout.

Artifact validation: this stage is gated by `.gc/scripts/checks/build-artifact-valid.sh`, which validates the artifact recorded at `gc.build.decomposition_path` (fallback `gc.var.decomposition_path`) against schema `gc.build.decomposition.v1`. On repair attempts (`gc.attempt` greater than 1), read the validator errors from `gc.attempt_log` on the validation loop control bead (the dependent of this step bead) and repair the artifact in place instead of rewriting it. Two bounded repair attempts follow the first failure; exhausting them closes this stage with `gc.outcome=fail` and machine-readable validation errors that block downstream stages. Never ask questions in headless mode; record unresolved ambiguity inside the artifact.
