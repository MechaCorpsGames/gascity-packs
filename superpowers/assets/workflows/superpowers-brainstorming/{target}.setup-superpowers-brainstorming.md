Prepare the Superpowers brainstorming context.

Resolve the build target, artifact root, design candidate path, requirements
artifact path, optional context bundle, and brainstorming approval mode. Use
workflow root metadata `gc.var.brainstorming_approval_mode` when present;
otherwise default to `autonomous`.

Before writing the context note, preserve the original requested work. Read the
workflow root with `gc bd show "<workflow-root-id>" --json` and read its
`gc.input_convoy_id` metadata while this setup stage still precedes
decomposition. Inspect that source convoy with
`gc convoy status "<source-convoy-id>" --json`, then read every listed source
work item with `gc bd show "<source-work-item-id>" --json`.

The context note must include a `## Source Work Items` section containing each
source work item ID, title, complete description, constraints, acceptance
criteria, and required verification. Treat those items as the authoritative
requested outcome for brainstorming, requirements, planning, and decomposition;
any optional `context_path` is supplementary. Do not invent a replacement feature
or replace an explicit source requirement with a generic example.

If no source work item can be read, do not start brainstorming from the formula
description alone. In headless mode record
`gc.build.status=blocked` and
`gc.blocked_reason=missing-source-work-context` on the workflow root, then
close this setup lane with `gc.outcome=fail` so the workflow fails closed.

Create the brainstorming artifact directory under the build artifact root and
ensure the rig-local script cache contains the imported `gc` pack checks. If
`.gc/scripts/checks/design-review-approved.sh` is missing, locate the imported
`gc` formula search path with `gc formula show superpowers-build --json`, use
its sibling `../assets/scripts` directory as the source, and refresh
`.gc/scripts` from that directory.

Write a compact context note for the design-approval loop and written-spec
loop. Confirm that `.gc/scripts/checks/design-review-approved.sh` is
executable.

Do not invoke provider-native subagents or upstream plugin runtime commands.
This Gas City graph stage is the delegation mechanism.
