# Paperclip agent organization

**Snapshot:** `paperclipai/paperclip` at commit `fd472d0`, 2026-08-16. Evidence came from direct repository analysis.

## Observed

- Paperclip stores durable agent records with names, roles, reporting relationships, permissions, budgets, and runtime configuration.
- Each agent has a structured instruction bundle that separates job instructions, persona, wake checklist, and tools.
- Skill loadouts are resolved and materialized per run rather than inferred from incidental directory contents.
- Task sessions are keyed by work item. Resume validity checks include working directory, instruction bundle, model, tools, and execution target.
- Work coordination uses assigned issues, comments, mentions, locks, child tasks, and review stages. It does not provide a shared multi-agent room with a human participant.
- Durable curated agent memory was not implemented in the inspected source. Session identifiers, rolling summaries, and optional model-maintained notes are not an equivalent.

## Implications for City Life

- Gas City should remain authoritative for source-agent identity, persona prompt, skills, task routing, and session lifecycle; Memory Beads should not duplicate those records.
- Conformance should retain the effective source-agent identity, prompt version, and skill catalog used by each run and invalidate unsupported resume paths when those inputs drift.
- Task Beads are the natural place for shared work context, references, and coordination evidence. Citizen Memory remains deliberately curated and separately owned.
- External-message collaboration needs explicit participant mapping, recipient delivery evidence, and recovery; ticket comments alone do not prove the vision's group scene.
