# Shared Agent Guide

This file is the canonical shared project instructions for Codex, Claude Code, and Gemini CLI.

Keep project-wide guidance here. Keep tool-specific leftovers in `CLAUDE.md` or `GEMINI.md` only when they should not apply to the other agents.

`CLAUDE.md` and `GEMINI.md` are thin import shims. Keep the shared project truth in this file.

## What This Repo Is

Gas City, Inc. company operations repo — not a code project. No build, lint, or test commands. All content is markdown: company docs, legal drafts, meeting notes, and AI agent definitions.

**This repo and all its contents are proprietary and confidential.** OSS products live in separate repos.

## Company Context

- **Entity:** Delaware C-Corp (bootstrapped), domain gascityhall.com
- **Product:** Gasworks — managed hosting for AI coding agents. BYOK, zero token markup, bare metal (OVH VPS).
- **Lineage:** Gas City is the OSS successor to Steve Yegge's Gas Town. Steve is advisor (5% option grant).
- **North star metric:** WAU-with-action (weekly active users with ≥1 agent run in trailing 7 days)

## The Team

Two humans, thirteen AI agents. Chris (CEO) is the decision-maker — agents advise, Chris decides.

- **Chris Sells** — CEO. Owns Mission Control, business, product direction.
- **Julian** — CTO. Owns Gas City, Gasworks, Wasteland integration.
- Consensus decision-making between Chris and Julian. Both semi-retired, no salaries until revenue.

AI employee definitions live in the imported employee pack's `agents/` directories. Each agent directory contains the canonical `prompt.template.md`, optional local skills, and provider overlays.

| Agent | Name | Role | Plugin |
|-------|------|------|--------|
| `penny` | Penny Park | Chief of Staff | productivity |
| `sam` | Sam Stratton | VP of Sales | sales |
| `clara` | Clara Chen | Head of Customer Success | customer-support |
| `priya` | Priya Patel | VP of Product | product-management |
| `maya` | Maya Moreno | CMO | marketing |
| `lawrence` | Lawrence Lam | General Counsel | legal |
| `francesca` | Francesca Figueroa | CFO | finance |
| `diego` | Diego Delgado | Head of Data & Analytics | data |
| `eve` | Eve Esperanza | Knowledge Manager | enterprise-search |
| `alex` | Alex Archer | VP of Engineering | feature-dev |
| `ollie` | Ollie Ortega | Technical Lead | feature-dev, pr-review-toolkit |
| `sky` | Sky | Head of Design | frontend-design |
| `riley` | Riley Reeves | Head of IT & Ops | google-workspace-admin, enterprise-search, productivity |

## Repo Structure

- `packs/gas-city-inc/` — Canonical v2 internal operations pack (`pack.toml`, `agents/`, `overlays/`)
- `packs/gas-city-inc/agents/penny/skills/meeting-notes/` — Custom skill for meeting note capture (use `/meeting-notes`)
- `packs/gas-city-inc/agents/riley/skills/google-workspace-admin/` — Custom skill for Google Workspace and DNS administration
- `packs/gas-city-inc/overlays/per-provider/claude/.claude/settings.json` — Shared Claude marketplace overlay for the pack
- `notes/` — Meeting notes and decision log. See `notes/README.md` for conventions.
- `content/` — Evergreen company content, owned by the responsible agent:
  - `content/product/` — Product decisions and references (Priya)
  - `content/legal/` — Draft legal documents (Lawrence). All drafts — none finalized without outside counsel review.
  - `content/marketing/` — Marketing content, landing pages, copy (Maya)
  - `content/ops/` — Infrastructure runbooks, DNS configs, vendor docs (Riley)

## Notes Conventions

Notes live in `notes/` with naming pattern `YYYY-MM-DD-<type>-<slug>.md`. Types: `meeting`, `decision`, `checkin`, `planning`, `retro`, `note`.

Every note uses the template from `notes/README.md` with sections: Summary, Discussion, Decisions (tagged `**[DECISION]**`), Action Items (tagged `**[TODO]**` with owner and due date), Open Questions.

To find things: search `**[DECISION]**` for all decisions, `**[TODO]**` for action items, `- [ ]` for open items.

## Gasworks — Technical Details

- **Infrastructure:** OVH Cloud VPS ($330/mo/machine), no Kubernetes
- **Auth:** WorkOS (GitHub auth, $125/mo)
- **Observability:** OpenTelemetry for logging/metrics, Plausible for web analytics
- **DNS:** CloudFlare
- **Data policy:** Full visibility into user requests/responses for service delivery only. No PII mingling between users. No PII shared with 3rd parties.
- **Pricing:** Placeholder ($20/mo and $79/mo) pending beta data
- **Status:** Single-user. Enterprise features (RBAC, org support) wait for enterprise customers.

## Working Conventions

- **Scratch files** go in `tmp/` at the repo root (gitignored).
- **All legal drafts are drafts** — none are finalized without outside counsel review.
- **Domains:** gascityhall.com (Google Workspace, website), gascity.ai (email aliases).

## Internal Tooling

Discord (Gas Town Hall server), GitHub Issues, Google Workspace on gascityhall.com, Google Sheets for CRM, Plausible for analytics.
