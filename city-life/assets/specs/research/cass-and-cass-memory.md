# cass and cass-memory

**Snapshot:** 2026-08-16. Twenty-one of twenty-five challenged claims survived verification.

## Observed

- cass has provider-specific readers for many coding-agent transcript formats, including Claude Code, Codex, Gemini, Cursor, and structured stores that plain text search cannot cover.
- It offers machine-readable output, token limits, lexical search, and optional semantic ranking. Its index is machine-user scoped, not named-agent scoped.
- cass-memory separates raw sessions, working summaries, and a curated playbook. It implements confidence decay, maturity states, negative-feedback weighting, and evidence checks.
- Neither tool models Gas City source-agent identity. cass-memory intentionally pools learning across agents.

## Implications for City Life

- Session search must begin with an exact citizen-to-native-conversation association. A reader may search only that selected set.
- Each advertised provider needs a proved reader; an unsupported or unreadable source must fail visibly.
- Deterministic lexical matching is a sound baseline. Semantic ranking is optional and must identify its active mode.
- cass-memory's scoring ideas may inform later quality tools, but Memory Beads remains the canonical curated store.
