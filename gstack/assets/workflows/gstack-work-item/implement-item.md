Implement the assigned gstack shared-drain item.

Gas City owns the shared drain and source-anchor lifecycle. Resolve the source
anchor from the reserved input convoy and `gc.drain_member_id`, not from a
dependency bead. Read the source anchor's `work_dir` and require it to identify
the existing authoritative shared worktree. Set `WORKTREE` to that absolute
path, run `cd "$WORKTREE"`, and verify `pwd -P` equals `$WORKTREE` before any
source read, edit, test, hash, commit, or proof command. The workflow root
bead's `gc.work_dir` identifies the launcher rig root for validation, not the
implementation worktree.

Read only the assigned item scope, implement the smallest complete change, and
run focused proof. Write the item summary as Markdown with YAML front matter
valid for `gc.build.implementation-summary.v1`, not a freeform note or JSON.
Read its path from workflow root metadata `gc.implementation.summary_path`
(fallbacks `gc.build.implementation_summary_path`, then `gc.var.summary_path`).
If all are blank, derive an absolute per-item path for the source anchor and
record it on the workflow root bead as `gc.implementation.summary_path`.

Use nested mappings with this top-level shape:

```yaml
---
schema: gc.build.implementation-summary.v1
workflow:
  id: <gstack-work-item-workflow-root-id>
  formula: gstack-work-item
methodology:
  pack: gstack
  name: gstack-work-item
producer:
  formula: gstack-work-item
  stage: implement-item
  attempt: <positive integer>
status: approved
trace: {upstream: [...], coverage: [...]}
---
```

The artifact's first line must be `---`. Every `trace.upstream` entry must have
`path` and a scheme-qualified `hash`. Represent the source anchor as
`path: beads/<source-anchor-id>` and `hash: bead:<source-anchor-id>`. Preserve
actual source IDs verbatim; never invent, substitute, or renumber them. Every
upstream ID must appear exactly once in `trace.coverage`; when the source
declares no IDs, omit `ids` and use `coverage: []`. Every non-`covered` entry
must include a rationale. Include one Markdown table whose `ID` and `Status`
pairs exactly match the YAML coverage:

| ID | Status |
| --- | --- |
| <actual-source-id> | covered |

Only include the example data row when coverage is non-empty, and replace the
placeholder with an actual ID. When coverage is empty, do not add a data row;
omit the table or use only its header and separator.

Use these schema-required second-level headings in this exact order:

- `## Summary`
- `## Intended Behavior`
- `## Changed Files`
- `## Verification`
- `## Remaining Risks`

Record intended behavior, the first verification command and observed result,
changed files, the final proof command and observed result, and remaining
risks. Before closing, resolve the launcher rig root from the workflow root
bead's `gc.work_dir`. If that root does not contain the validator, use the
nearest ancestor containing `.gc/scripts/checks/build-artifact-valid.sh`.
Read the exact current bead ID from the startup claim output and substitute it
literally below; shell variables from earlier tool calls do not persist. Then
run:

```bash
GC_BEAD_ID=<exact-claimed-bead-id> <launcher-rig>/.gc/scripts/checks/build-artifact-valid.sh
```

Fix every validation error in the recorded summary before setting
`gc.outcome=pass`.

Close with `gc.outcome=pass` only after verification.

Do not invoke provider-native subagents. You are the single item lane.

Artifact validation: this step is gated by `.gc/scripts/checks/build-artifact-valid.sh`, which validates the summary recorded at `gc.implementation.summary_path` (fallbacks `gc.build.implementation_summary_path`, then `gc.var.summary_path`) against schema `gc.build.implementation-summary.v1`. On repair attempts (`gc.attempt` greater than 1), read the validator errors from `gc.attempt_log` on the validation loop control bead (the dependent of this step bead) and repair the summary in place instead of rewriting it. Two bounded repair attempts follow the first failure; exhausting them closes this stage with `gc.outcome=fail` and machine-readable validation errors that block downstream stages. Never ask questions in headless mode; record unresolved ambiguity inside the summary.
