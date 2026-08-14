# Phase 3 — Standardize per-agent Manifold attribution in the employees pack

Directive: "Let's take a pass and standardize all of these in the employees pack" +
"all 13 — mint the 4" + "local-path import (no shared-repo push)".
Governing mandate: each of the 18 Gas City agents mints + uses its own `mn_live_`
key so Claude inference attributes per agent (spend.key_id) in Manifold.

## Ground truth (verified 2026-07-22)
- Deployed employees pack imported at git sha `fbd40be944823a92d040d447a30101c3c0e72778`
  from github.com/gascity/gas-city-inc `//packs/gas-city-inc`; resolved in gc cache
  `/home/ubuntu/.gc/cache/repos/490f4f19…/packs/gas-city-inc/`.
- Deployed roster (13): alex clara diego eve francesca lawrence maya ollie penny
  priya riley sam sky. (emma/quinn deprecated — only in stale local checkout.)
- fbd40be templates = `prompt.template.md` + `overlay/per-provider/claude/.claude/settings.json`
  (riley also has skills/). NO agent.toml in the deployed pack.
- `provider=` is set in ZERO agent.toml anywhere → provider likely honored only at
  city level (`[[patches.agent]]`/`[providers]`/`[workspace]`). MUST verify pack-level.
- Attribution shim `/data/cities/gas-city-inc/bin/claude-edge-attributed` keys off
  `MANIFOLD_IDENTITY_ID` (fail-open). Provider `[providers.claude-attributed]` already
  defined in city.toml.
- Phase-2 city.toml patches (ollie clara lawrence penny francesca) already carry
  provider=claude-attributed + MANIFOLD_IDENTITY_ID + ENGINEERING_/PLANE_/WIKI_ env.
- Unkeyed (need mint): alex eve maya sam (no custody, no ledger row).
- Proven mint: `IDS="…" bash /data/projects/gascity-packs/.claude/mint-manifold-agent.driver.sh`
  (SP→grant→mint→bao→custody 0600→ledger; secret never in argv/stdout).
- Ledger: `/data/projects/gascity-packs/.claude/manifold-agent-keys.ledger.tsv`.
- Vendor precedent: cass (`/data/projects/gascity-packs/cass`), slack (worktree path).

## Phases
- **A** Vendor fbd40be → `/data/projects/gascity-packs/employees` (git archive|tar);
  diff vs cache (byte-identical); repoint `[imports.employees]` in
  `/data/cities/gas-city-inc/pack.toml` to the local path (drop version). Reload;
  confirm `gc agent list` unchanged + live ollie NOT disrupted. STOP+verify.
- **B** Canary diego: add `employees/agents/diego/agent.toml` with `provider=claude-attributed`
  + `[env] MANIFOLD_IDENTITY_ID="diego"`. Reload; wake `corp--diego` (asleep/safe).
  Check breadcrumb `.gc/tmp/attrib-diego.spawn` + ClickHouse key_id k_019f88dd-47a4.
  → decides whether pack-level provider works. STOP+decide.
- **C** Roll out agent.toml to the other 12 (winning mechanism), batched ≤5.
- **D** Mint alex eve maya sam via the driver. Verify custody 0600 + ledger + bao 2xx.
- **E** Dedup the 5 city.toml patches (remove provider/MANIFOLD now in pack; keep
  ENGINEERING_/PLANE_/WIKI_/PATH). Backup .bak-manifold-attrib-p3. Reload.
- **F** Canary a newly-minted agent (eve/maya, asleep) → fresh key_id first-ever.
  Spot-check priya/sky. Confirm live agents intact.
- **G** Update memory docs (manifold-per-agent-provisioning, slack-company-rooms) + tasks.

## Safety
- Never poke the live Slack gateway ollie; canary only asleep/runtime-missing agents.
- Never print/commit secrets; custody 0600; no /proc scraping.
- No push to shared repos. Controller fsnotify auto-reloads on config save.

## COMPLETE — all phases done + proven (2026-07-22 ~18:20)
- **A** DONE: vendored fbd40be byte-identical → local path; `[imports.employees]` repointed; `gc import install`.
- **B** DONE: diego canary — pack-level `provider=` proven at resolution AND runtime; 4 spend rows first-ever 18:03.
- **C** DONE: all 13 `agents/<name>/agent.toml` = provider=claude-attributed + MANIFOLD_IDENTITY_ID; reload 0 drift;
  every employee resolves claude-attributed + correct id (alex, a pure-pack agent, proves the pack path).
- **D** DONE: minted alex/eve/maya/sam (SP+grant+key 201, bao=200, custody 0600, ledger). New key_ids
  alex k_019f8b06-134d, eve …144c, maya …151a, sam …1666.
- **E** DONE: city.toml deduped (backup .bak-p3-dedup) — removed redundant provider+MANIFOLD from the 5 patches,
  kept ENGINEERING_/PLANE_/WIKI_/PATH; reload 0 drift ⇒ behavior-neutral, pack is now the single source.
- **F** DONE: eve canary (FRESH key) 4 rows first-ever 18:19:40, opus/claude-pool/200 — mirrors diego. Both
  pre-existing-key and fresh-key attribution proven. 8 employees wired+keyed, attribute on next natural activity.
- **G** DONE: memory (manifold-per-agent-provisioning PHASE 3 block + MEMORY.md), this plan, tasks updated.
- Pre-existing benign warnings (NOT regressions): pack `agent_defaults.scope` unsupported; city
  `workspace.install_agent_hooks` deprecated; `config show --validate` exit=1 from `mol-scoped-work` formula +
  control-dispatcher singleton (both untouched by this work). `gc reload` (the operational gate) succeeds.
