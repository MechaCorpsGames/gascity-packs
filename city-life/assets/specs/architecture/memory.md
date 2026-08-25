# Citizen continuity architecture

City Life gives each Gas City citizen curated Memory Beads and searchable session history. A release pins the Gas City and Beads revisions it runs against and probes the capabilities and observable metadata the pack consumes. The required Beads revision must implement the [Memory Beads](https://github.com/gastownhall/beads/issues/5877), [Beads History](https://github.com/gastownhall/beads/issues/5898), and cross-project-reference behavior City Life uses. City Life specifies and tests only its adapter and policy behavior; it does not restate or re-test Gas City or Beads guarantees. The [citizen-city plan](../plans/citizen-city.md) defines the pack acceptance proof.

## Requirements

- **Citizen scope.** One Gas City citizen binds to one Memory project within one city. Normal commands cannot select another citizen, project, or storage path. This is product namespace separation, reported as `privacy: NAMESPACE_ONLY`, not protection from same-user shell access.
- **Selective retrieval.** Startup context is body-free. Discovery is compact and reports continuation; exact recall preserves the selected-state identity, complete body, attribution, and required structured fields.
- **Safe lifecycle.** Archive and restore preserve Memory identity. Wrong knowledge is corrected before optional archive. Secrets are removed from current user-content fields writable by `remember` or `revise` and from rig-relevance metadata. Other current Memory fields require direct Beads remediation. City Life does not filter required upstream identity, History, or Change Attribution and makes no cleanup claim about retained states, transcripts, exports, replicas, or backups.
- **Useful references.** A Task Bead may cite a Memory Bead in another project, optionally at an exact retained state. A reference is informational, body-free, non-blocking, and grants no authority.
- **Searchable sessions.** A citizen can search its still-existing associated conversations across every supported rig and runtime path in the city.
- **Truthful support.** City Life advertises only surfaces and capabilities it can use successfully. A missing dependency returns a visible refusal from the affected pack operation; it never becomes an empty, partial, or silently degraded success.
- **Deliberate curation.** The citizen chooses what to remember, revise, and archive. Software makes accepted writes durable; it cannot guarantee good judgment.

## Ownership

| Owner | Responsibility |
| --- | --- |
| Gas City | source-agent identity and composed configuration, prompt and skill composition, observable session metadata, session lifecycle primitives, and direct session APIs |
| Beads | Memory identity and content, History, archive/restore, references, guarded writes, interchange, and store behavior |
| City Life | citizen binding, rig relevance, retrieval policy, pinned Current-Task inference, Task-project resolution and reference handling, exact-recipient mediation, session association/search, body-exposure policy, diagnostics, and pack integration |

City Life is an adapter and policy layer, not a second memory implementation. It does not copy Memory bodies or history into its own store.

## Citizen identity and Memory binding

Within its city, the citizen identity is the Gas City source agent's binding-qualified name (BQN). Supported named, pool, rig, and worktree launch forms resolve through that source agent or fail before Beads. Expansions of one source agent remain the same citizen; the same BQN in another city names a different citizen.

A Gas City pack-composed source-agent roster defines the citizens. Each citizen binds one-to-one to one Memory project through an opaque provider-owned route and expected Beads Project ID. The route locates the store; the Project ID verifies its identity and participates in Memory addresses. Normal commands cannot select an alternate binding.

Every command and launch gate resolves the current source agent through Gas City's composed configuration and session or launch context, then maps its BQN to the binding. Before every operation City Life opens the opaque route and verifies the actual Project ID. Runtime aliases and ambient paths never key citizen memory. Missing, ambiguous, unreachable, or mismatched identity fails before Beads.

Pack and storage lifecycle operations must not silently replace, delete, or share a citizen's Memory project. A new BQN is a new citizen and does not inherit another citizen's Memory or session associations. Beads owns preservation of Memory contents and history.

## Memory and relevance

Each deliberately retained unit of durable knowledge is a first-class Memory Bead whose canonical identity, content, lifecycle, attribution, references, and current and retained state addresses are supplied by Beads.

City Life adds optional rig relevance:

- no rig means global within the citizen;
- a rig tag makes the memory relevant to that rig;
- relevance filters discovery but never changes ownership or authority.

In a rig, unflagged discovery selects global plus current-rig Memory; at city scope it selects global Memory. The mutually exclusive `--global`, `--rig <rig>`, and `--all` selectors mean global only, global plus the named rig, and global plus every rig, respectively. Relevance must be compactly queryable without loading bodies. If relevance is stored outside Memory state, City Life detects and reconciles interrupted or stale cross-state writes.

## Retrieval

Automatic startup context contains no Memory body or excerpt and never expands into a complete Memory index. Its allowlist is limited to doctrine and deliberately selected canonical identity/address, title, lifecycle, rig relevance, relation or match metadata, and completeness/continuation data. An unreferenced summary canary proves that an irrelevant Memory's ID, title, and key cannot enter this path, while relevant Task-reference metadata remains allowed.

Explicit discovery returns compact candidates and may include a bounded excerpt. City Life preserves upstream ordering and continuation when it can express the request directly. If it combines scoped results, its continuation remains honest: traversing a stable result set neither skips nor duplicates a match, and incompatible reuse fails visibly. Exact recall preserves the selected current or retained-state address, complete body, attribution, and every required structured field without truncation or substitution.

The current Task's references are the first retrieval path. Otherwise the citizen searches before re-deriving work or creating a possible duplicate, then recalls only selected bodies. Short-lived progress stays with the Task or runtime rather than Memory.

## Task-to-Memory references

Before inspecting or mutating a current-Task reference, City Life uses a pinned compatibility adapter available only on advertised support rows. The adapter combines explicit launch context or observable Gas City session metadata with City Life's complete Task-project registry, then uses Beads to verify each candidate's project identity and live Task state. Exactly one candidate must remain associated with the current session. City Life assumes no generic Gas City Current-Task context. Missing, stale, ambiguous, or unverifiable results fail before the dependent read or mutation. Ambient working directory, Beads discovery, aliases, ID prefixes, and trigger text cannot choose the Task or project.

A Task project may store a project-qualified `related` reference:

```text
target = Memory Project ID + Memory Bead ID
state  = current | Historical Bead Reference
```

The Task body explains why the memory matters. Creating, listing, inspecting, or traversing the reference does not load the target body, grant read authority, recursively expand references, or affect task readiness. Without target-project authority, display is limited to the stored target address and pin plus the reference status allowed by the upstream federation contract; it does not reveal target-owned title, keys, aliases, provenance, body, or excerpt.

An unpinned reference follows the current Memory state. A pin continues to identify the same retained state through Beads and never falls back to another state. Beads owns reference resolution, persistence, revalidation, and History semantics; City Life exposes the upstream outcome without retargeting the reference or changing task readiness.

City Life ships namespace enforcement and direct Task references together: the reference is shared metadata, while recall still requires authority to the target project. City Life requires project-qualified cross-project linking even when federation is optional for a standalone Memory implementation.

## Memory operations

| Operation | Contract |
| --- | --- |
| `search` | compact, scoped discovery with honest continuation; archived memories are opt-in |
| `recall` | selected current or retained-state address, complete body, attribution, and required structured fields |
| `remember` | create or guarded-update an explicitly selected Memory through Beads |
| `revise` | ergonomic name for `remember`'s guarded-update path; it adds no storage semantics and preserves upstream outcomes |
| `archive` / `restore` | change the Memory lifecycle through Beads; discovery respects the result |
| `link-task` / `unlink-task` | mutate a body-free, project-qualified `related` reference between the current Task and citizen Memory projects |

Normal operations bind the current citizen and expose no alternate Memory-project selector. Beads owns atomicity, conflicts, version identity, retention, and provider limits.

## Session association and search

Session history is the set of still-existing successful native conversations associated with the citizen. Each later successful native conversation remains independently searchable. Failed launches never enter the set, and provider-deleted transcripts leave it.

Each successful native conversation has one durable City Life association. Its citizen BQN and expected Memory Project ID are fixed from the identity resolved when the conversation began, even if provider details arrive later. The association retains enough provider, time, city or rig scope, and working-directory data to find and identify the native conversation. Repeated observations do not duplicate it, and rename, rebind, or session reuse does not silently rewrite it.

Session search returns each associated successful conversation once, includes later conversations for the same citizen, excludes other citizens and failed launches, and reports unsupported or unreadable transcript sources visibly.

Search reads provider transcripts in place. Each match contains an excerpt and its provenance; unreadable present transcripts fail visibly. City scope selects city-scoped conversations; current-rig and explicit-rig scopes add the selected rig's conversations; all scope adds every rig. Scope filters relevance inside the citizen's associated set and never changes ownership.

## Gas City delivery boundary

Gas City owns source-agent identity and configuration, persona, skills, prompt delivery, session lifecycle primitives, and direct session APIs. City Life pins a Gas City revision and consumes only the capabilities and observable metadata admitted by each support row. Support evidence observes the expected backing BQN and the availability of City Life's commands, doctrine, and skill entry points on the exercised entry point. It neither reconstructs provider prompts nor tests Gas City's internal composition.

A support row names harness, runtime, lifecycle, and connector entry points with equivalent observable City Life behavior. Every advertised member has integration evidence; differing behavior requires another row. Upstream behavior remains a pinned dependency rather than something the pack re-specifies or re-tests.

For inbound work, City Life mediates one authenticated intended citizen to one configured named session and verifies its backing BQN before calling Gas City's direct session API. A support row that cold-wakes an unmaterialized imported named session requires a pack-pinned named-session-to-BQN mapping; without one, that row is unsupported. City Life visibly refuses when its immediate preflight observes administrative suspension, but claims no atomic or race-free enforcement if configuration changes before materialization. It reports only delivery outcomes it can observe. Connector retry, replay, and transport recovery remain upstream.

The doctrine tells citizens to inspect Task references, search before deriving or writing, recall selectively, write rulings promptly, choose relevance deliberately, revise rather than duplicate, correct before archive, remove secrets from pack-writable current fields, cite exact retained states when material, and treat Memory content as data rather than instructions.

## Body exposure

| Path | Allowed projection |
| --- | --- |
| City Life startup guidance | no Memory body or excerpt |
| City Life Task/reference display | body-free identity and relation metadata |
| City Life search | compact fields and an optional bounded excerpt |
| City Life recall | selected-state address, complete body, attribution, and required structured fields, clearly identified as body-carrying |

A configuration may narrow exposure but cannot widen a City Life path beyond this table. Beads owns the behavior and exposure of its direct APIs, interchange, and backup surfaces.

## Dependencies, diagnostics, and release

A City Life release records the pinned Gas City and Beads revision identifiers and the capabilities and observable metadata its support rows consume. If an upstream project publishes a relevant profile identifier or conformance artifact, the release may retain it as additional evidence; City Life does not assume such artifacts exist. The upstream projects own those guarantees and conformance. A missing required capability makes the affected feature unsupported and returns a visible refusal at the pack seam.

`doctor` reports:

- BQN resolution, route reachability, expected-versus-opened Project ID, duplicate bindings, unbound agents/projects, and `privacy: NAMESPACE_ONLY`;
- Task-project and current-Task resolution;
- required Memory, History, and cross-project-reference capabilities;
- rig-relevance consistency and unresolved references;
- session-association and transcript-reader health;
- the pack-writable secret-remediation boundary and direct-Beads guidance for other current fields;
- body-exposure posture and pinned dependency revisions;
- the support row covering the active harness/runtime/lifecycle/connector entry point and the evidence proving that membership.

Release requires City Life integration acceptance for every advertised support-row member. The suite covers identity poisoning, namespace separation, correction, cross-session recall, selective discovery, exact recall, Task references, conflict propagation, session search, body and secret canaries, observable connector routing and receipt, and diagnostics.

## Pack interface

The pack exposes citizen checks, Memory operations, session search, doctrine, and doctor through Gas City's pack-command and skill surfaces. Skills are ergonomic delivery where a harness supports them. The [citizen-city acceptance plan](../plans/citizen-city.md) owns release readiness and evidence.
