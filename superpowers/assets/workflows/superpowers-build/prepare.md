Prepare the Superpowers build context before the brainstorming graph expands.

This is a complete override of the inherited `build-base` prepare step. First
read the workflow root with `gc bd show "<workflow-root-id>" --json`. Use its
already-resolved `gc.var.*` metadata as the launch inputs, including
`gc.var.artifact_root`, `gc.var.context_path`, `gc.var.requirements_path`,
`gc.var.plan_path`, `gc.var.decomposition_path`, `gc.var.drain_policy`,
`gc.var.interaction_mode`, `gc.var.review_mode`, the selected methodology
formula names, `gc.var.max_iterations`, `gc.var.push`, and
`gc.var.open_pr`. Do not rely on unresolved template placeholders in this
external prompt. Persist normalized values back to the workflow root before
any downstream stage runs.

`interaction_mode` must be `interactive`, `autonomous`, or `headless`;
`review_mode` must be `report`, `agent`, or `interactive`; and `drain_policy`
must be `separate` or `same-session`. Read `superpowers-build` with
`gc formula show superpowers-build --json` and verify the selected values are
supported by its `[metadata.gc.methodology]`. If they are not, record
`gc.build.status=blocked`, a machine-readable `gc.blocked_reason`, and
`gc.failure_class=methodology_incompatible` on the workflow root, then close
this step with `gc.outcome=fail`. Never ask questions in headless mode.

Use `GC_RIG_ROOT` as the stable shared filesystem root. Resolve
`{{artifact_root}}` to an absolute directory beneath `GC_RIG_ROOT`; Never resolve shared artifacts relative to the current worktree because each lane
gets a disposable worktree. Every shared path recorded on the workflow root
must be absolute, exist beneath `GC_RIG_ROOT`, and remain readable after this
prepare worktree is removed.

Before any downstream stage runs, capture the immutable source request. Read
the workflow root with `gc bd show "<workflow-root-id>" --json`, obtain its
original `gc.input_convoy_id`, inspect that convoy with
`gc convoy status "<source-convoy-id>" --json`, and read every listed source
work item with `gc bd show "<source-work-item-id>" --json`. Do this before
decomposition can replace `gc.input_convoy_id` with an implementation convoy.

Write `<absolute-artifact-root>/brainstorming-context.md`. It must contain a
`## Source Work Items` section with every source item ID, title, complete
description, constraints, acceptance criteria, and required verification. This
section is the authoritative requested outcome: the formula title and optional
`context_path` are supplementary and never justify inventing a replacement
feature. Before closing, record the existing absolute file on the root:

```sh
gc bd update "<workflow-root-id>" \
  --set-metadata "gc.build.brainstorming_context_path=<absolute context path>" \
  --set-metadata "gc.build.source_context_path=<absolute context path>"
```

If the source convoy, a source item, the stable artifact path, or the metadata
write is unavailable, fail closed: set `gc.build.status=blocked` and
`gc.blocked_reason=missing-source-work-context` on the workflow root, then
close this step with `gc.outcome=fail`. Do not close successfully until the
metadata points to the shared context file.

Persist the normalized launch inputs as `gc.var.<name>` and the resolved,
absolute build artifact paths as `gc.build.<artifact>_path`. Blank optional
paths derive under the artifact root as:

- `requirements.md` for `gc.build.requirements_path`
- `implementation-plan.md` for `gc.build.plan_path`
- `decomposition.md` for `gc.build.decomposition_path`
- `implementation-summary.md` for `gc.build.implementation_summary_path`
- `review-report.md` for `gc.build.review_report_path`
- `factory-run.md` for `gc.build.final_report_path`

Use plain scalar metadata values. Update the claimed step with
`gc.outcome=pass` before closing it with `gc bd close`; close commands do not
accept metadata flags. Do not edit source files in this stage.
