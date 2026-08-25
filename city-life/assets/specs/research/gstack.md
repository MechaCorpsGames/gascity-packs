# gstack

**Snapshot:** 2026-08-18/19. Eighteen of twenty-five challenged claims survived verification.

## Observed

- gstack's CEO, designer, engineering, release, documentation, and QA labels are invoked role skills, not durable named agents. It has no per-agent persona or memory ownership.
- Its decision machinery distinguishes current decisions, replaced decisions, and redaction. A bounded active view supports cheap lookup.
- Learnings are typed and recall is capped at three entries per session.
- Baseline search is simple lexical matching. Optional semantic search falls back silently when its dependency is absent.
- Its transcript ingest supports Claude Code and Codex but scopes by agent type and repository, not Gas City source-agent identity.

## Implications for City Life

- Role and skill loadout do not create citizen identity; Gas City's source-agent binding remains authoritative.
- Bounded recall is strong evidence for compact discovery followed by exact Memory recall.
- Correction, archive, and secret handling need distinct semantics and honest scope. One verb should not imply another.
- Search mode and degradation must be observable rather than silent.
- Taxonomies and active views may be consumer projections. They should not replace canonical Memory Bead identity or versioned state.
