# gbrain

**Snapshot:** 2026-08-18. Sixteen of twenty-five challenged claims survived verification; strong privacy claims accounted for most refutations.

## Observed

- gbrain is a CLI and MCP service backed by PGLite or Postgres. Its Markdown artifacts are projections around a database-backed brain.
- It cleanly separates generated persona, user context, and memory-oriented material, and uses bounded per-turn context.
- Its multi-agent design serves several agents from one brain. Access is controlled through source scopes and presets; verified evidence did not establish hard per-agent isolation by default.
- The product's design center is aggregation toward one searchable brain for a human across harnesses.

## Implications for City Life

- A shared-brain product is not the canonical store for independently owned citizen Memory projects.
- gbrain may be evaluated later as an optional discovery or organization tool only if project identity, body exposure, and degradation remain explicit.
- Bounded context and persona/memory separation are useful precedents; gbrain's storage and access model should not define City Life's namespace claim.
