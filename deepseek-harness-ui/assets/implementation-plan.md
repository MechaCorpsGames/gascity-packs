# `deepseek-harness-ui` implementation plan

Status: implemented production-ready release candidate for the documented v1 boundary. The isolated stock-DSH certificate passed against real Claude and Codex sessions on the audited Gas City baseline. Production telemetry and release publication remain follow-ups.

Research baseline: Gas City `1807cf018045e9f225993d97cf6daea37e2ce6e9`, Gasworks GUI `44812f2e656fc880a986b03a418a93348a8dc1ad`, DeepSeek Harness `dsh-v0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, and `gascity-packs` `aab8030d397c211be6a4d460e9ce8de39e867a09`.

## Implemented checkpoint

The pack now contains the two-sided stock-DSH plugin, fixed same-origin REST/SSE gateway, strict context and secret boundary, structured feed reducer, bounded reconnection, per-city asynchronous operation watcher, React workspace, lifecycle controls, pack commands, doctors, tests, and checksum-pinned tarball described by the core plan.

The adversarial-review corrections are implemented: unique list-slot IDs; `./package.json` export; no Supervisor-wide stream; master `sessions?state=all` inventory grouped in the browser; implicit default submit intent; **Close permanently** terminology and fail-closed lifecycle matrix; transcript-first buffered handoff; authoritative pending replacement; same-ID semantic ledger; uint64 city event IDs kept as decimal strings/`BigInt`; bounded EOF/network/contract recovery; deterministic access-profile selection; redirect refusal; strict request schemas; loopback-only DSH; and credential/TLS/grant handling confined to the host.

The release candidate is verified by 138 plugin tests, 28 pack/install tests, TypeScript checking, production builds, ShellCheck, `gc lint`, deterministic artifact byte comparison, and checked-in headless-Chrome contract/uncertainty/soak runs against an isolated exact stock `dsh web` profile and random-port Supervisor fixture. The separate isolated live certificate also passed with two real, distinct providers after normal `gc init` started the disposable Supervisor and city.

## 1. Decision summary

Build a schema-v2 Gas City pack named `deepseek-harness-ui` that installs a two-sided plugin into the stock DSH `web` profile:

1. A **browser module** renders a Gas City session workspace in DSH.
2. A **host module** is a same-origin, typed Supervisor gateway. It discovers GC connections, owns authentication and TLS, forwards an allowlisted REST surface, and relays structured SSE without buffering.

The data flow is:

```text
DSH browser module
  -> /api/gas-city/v1/... on the same DSH host
  -> pack host module
  -> Gas City Supervisor /v0/... REST and SSE
  -> existing or newly-created Gas City session
  -> the provider configured for that GC session
```

This direction is final. DSH does not perform the GC agent's work. Gas City remains authoritative for the session, lifecycle, transcript, tool execution, interactions, and provider choice.

### Discarded architecture

Do not add any of the following:

- a DSH-as-GC provider or GC-as-DSH model provider;
- a pack runtime, RPP, per-session tmux wrapper, or supervised private service;
- mappings between GC sessions and DSH execution sessions;
- Claude-shaped JSONL mirrors or observed transcript paths;
- consumption of DSH `/api/events.mux`;
- prompt forwarding into DSH inference sessions;
- DSH models, tools, or loops that perform the selected agent's work.

## 2. Goals and non-goals

### Goals

- Run against an unmodified, stock `dsh web` process.
- Reuse local Supervisor configuration and all current remote `gc context` connection modes.
- Discover Supervisors, cities, rigs, configured agents, and sessions.
- Attach to any existing GC session without changing it.
- Create an agent-backed session on the first prompt through the normal asynchronous Supervisor lifecycle.
- Render provider-neutral `session.structured.v1` content: incremental text, reasoning, tool calls, tool results, interaction blocks, errors, and activity.
- Submit messages using Supervisor-advertised submission capabilities.
- Render and answer pending interactions through `/respond`.
- Support appropriate session controls, including stop, kill, suspend, wake, close, rename, and schema-backed permission mode.
- Recover streams exactly from Supervisor cursors and reset frames.
- Keep Supervisor endpoints, bearer tokens, helper output, grants, and TLS material out of the browser bundle and logs.
- Ship explicit installation, removal, launch, status, doctor, test, and release mechanics.

### Non-goals for v1

- Replacing any built-in DSH screen or root slot.
- A connection, credential, city, rig, agent, or provider administration UI.
- Raw-provider session creation.
- Attachment upload, file staging, or arbitrary local-path proxying.
- Synthesizing transcript content absent from `session.structured.v1`.
- Direct browser-to-Supervisor requests.
- Exposing a DSH web host bound to all interfaces as a supported deployment.
- Supporting direct `X-GC-City-Read` hardening before Gas City publishes a client mint source.

## 3. Verified extension architecture

### 3.1 Browser module

The plugin package exports `./client` and declares `dsh.client.platform: web`. At runtime it injects the public client services it needs and registers:

- one keyed `sidebar.footer.action` entry labeled **Gas City**;
- one keyed `shell.overlay` entry containing the workspace while its hash route is active.

The sidebar action navigates to a pack-owned hash route such as `#/gas-city`. Closing the overlay returns to the previous DSH hash/location. The pack must not register `shell.root`: DSH explicitly reserves additive surfaces such as `shell.overlay` for this use.

There is no documented public application-router or primary-navigation registry in the audited DSH release. Hash state plus the two documented slots is therefore the smallest supported integration. The browser module owns all GC rendering; neither Gas City nor the host gateway produces HTML.

The slot contracts and render sites are public in the audited release: [overlay declaration](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-layout/src/client/index.ts#L73-L84), [overlay render site](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-layout/src/client/AppFrame.tsx#L179-L195), and [sidebar footer declaration](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-sidebar/src/client/index.ts#L42-L56).

### 3.2 Host module

The host module registers a `kind: prefix` web route at `/api/gas-city`. DSH's route handler owns the full response lifecycle and may keep SSE responses open, so no WebSocket bridge or second daemon is necessary: [route contract](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/host/webserver/src/index.ts#L38-L48), [registration](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/host/webserver/src/index.ts#L102-L115), and [dispatch](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/host/webserver/src/index.ts#L162-L180).

The host module is a narrow Backend-for-Frontend, not a general proxy. It has four interfaces:

1. **Connection inventory**: reads GC configuration and returns secret-free connection/city descriptors.
2. **Supervisor REST adapter**: maps a fixed set of browser operations to exact Supervisor method/path templates.
3. **Supervisor SSE relay**: opens one authenticated upstream stream per browser subscription and relays status, framing, and event IDs unchanged.
4. **GC authentication adapter**: ports the current GC credential-provider, credential-command, and write-grant helper contracts.

These interfaces isolate unstable DSH composition details, GC auth helper protocols, and Supervisor wire evolution from the browser state model.

### 3.3 Package shape

One prebuilt npm package contains both halves:

- `exports["."]` points at the host module;
- `exports["./client"]` points at the browser artifact;
- `exports["./package.json"]` lets DSH inspect package metadata through the public export map;
- `dsh.bundle.patch` names `cordis.patch.yml`;
- `dsh.client` declares the web client export and required injected packages;
- `cordis.patch.yml` inserts the host plugin into the profile composition.

This is the documented out-of-tree package shape; mounting it serves the browser half without rebuilding DSH: [two-sided plugin cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cookbook/adding-a-settings-card.md#L1-L70), [client packaging](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cookbook/adding-a-settings-card.md#L78-L100), and [bundle installation](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/user/develop/basic/publish.md#L9-L110).

The DSH shared browser-bundle preset is not published. The pack build reproduces the audited lazy-CJS client artifact format, prohibits cross-plugin value imports, and verifies the result in a stock installed DSH profile.

## 4. Connection discovery and identity

### 4.1 Sources

At host startup and on an explicit refresh:

- Resolve `GC_HOME`, defaulting to `~/.gc`.
- Always derive a local Supervisor candidate with GC's missing-file defaults (loopback, port 8372), applying `supervisor.toml` overrides when that file exists. Keep the candidate visible only after a successful probe, or show it as an actionable unavailable-local entry.
- Parse `contexts.toml` with a strict TOML parser and validate the same fields and constraints as `clientcontext.Context`: URL, city, bearer mode, write-grant command, CA file, TLS server name, skip-verify flag, and REST timeout.
- Never shell out to scrape human-readable `gc context` output. Contract tests should use fixtures emitted by the current GC context implementation.

GC's local configuration paths and defaults are defined in [Supervisor configuration](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/supervisor/config.go#L26-L60) and [path resolution](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/supervisor/config.go#L216-L284). The remote context model and validation are in [client context](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/clientcontext/clientcontext.go#L31-L58) and [remote validation](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/clientcontext/clientcontext.go#L122-L181).

### 4.2 Grouping

- Canonicalize endpoint scheme, host, effective port, and path.
- Group contexts with the same canonical Supervisor URL into one displayed Supervisor.
- Preserve every context as an access profile inside the group; never merge credential or TLS fields.
- The configured city on the active/default context is initially selected.
- For a city operation, an exact context whose `city` matches wins. If none matches, use the group's single unambiguous access profile. If multiple incompatible profiles remain, fail closed with an actionable doctor/UI message asking the user to disambiguate their GC contexts.
- A stable opaque `connectionId` is derived from canonical endpoint identity. The browser uses `(connectionId, cityName, sessionId)` as session identity and never receives a credential command or secret.

On refresh, `GET /health` verifies the process, and `GET /v0/cities` supplies the authoritative current city inventory. Per-city requests are enabled only when `running` is true; the Supervisor docs make that the readiness boundary: [health and cities](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_handlers_supervisor.go#L207-L255) and [city readiness](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/docs/reference/api.md#L275-L286).

## 5. Pack-owned browser API

All routes live under `/api/gas-city/v1`. Dynamic segments are parsed as individual identifiers and re-encoded; the browser cannot supply an upstream URL or arbitrary path.

| Browser route | Supervisor operation | Purpose |
|---|---|---|
| `GET /connections` | local config only | Secret-free Supervisor/access-profile inventory |
| `POST /refresh` | local config only | Re-read GC config; mutation affects only host memory |
| `GET /connections/{c}/health` | `GET /health` | Version and capability entry point |
| `GET /connections/{c}/cities` | `GET /v0/cities` | City discovery/readiness |
| `GET /connections/{c}/city/{city}/events/stream` | `GET /v0/city/{city}/events/stream` | Async create/submit result correlation |
| `GET /connections/{c}/city/{city}/config` | `GET /v0/city/{city}/config` | Expanded configured-agent inventory, including cold pools |
| `GET /connections/{c}/city/{city}/rigs` | `GET /v0/city/{city}/rigs` | Rig discovery |
| `GET /connections/{c}/city/{city}/agents` | `GET /v0/city/{city}/agents?rig=...` | Configured-agent discovery |
| `GET /connections/{c}/city/{city}/providers/public` | `GET /v0/city/{city}/providers/public` | Browser-safe option schemas/defaults |
| `GET /connections/{c}/city/{city}/sessions` | `GET /v0/city/{city}/sessions?...` | Paginated session discovery |
| `POST /connections/{c}/city/{city}/sessions` | `POST /v0/city/{city}/sessions` | Agent session creation |
| `GET/PATCH /connections/{c}/city/{city}/session/{id}` | matching GC session route | Session state, title, and alias |
| `GET /connections/{c}/city/{city}/session/{id}/transcript` | same GC suffix | Structured bootstrap snapshot |
| `GET /connections/{c}/city/{city}/session/{id}/pending` | same GC suffix | Pending bootstrap snapshot |
| `GET /connections/{c}/city/{city}/session/{id}/stream` | same GC suffix | Structured SSE |
| `POST /connections/{c}/city/{city}/session/{id}/{submit,respond,stop,kill,suspend,close,wake,rename,permission-mode}` | exact matching operation | Messaging, interactions, and lifecycle |

The implementation must enumerate method/path/query/body schemas rather than generically accepting every suffix shown in the table. Unknown methods, paths, query keys, content types, and JSON fields return a pack-owned Problem Details response.

For ordinary REST, preserve the Supervisor status, `application/problem+json` body, `Retry-After`, and `X-GC-Request-Id`. For SSE, preserve status, `Content-Type: text/event-stream`, event names, `id`, `data`, comments, blank-line framing, `GC-Session-State`, `GC-Session-Status`, and request ID; disable compression and buffering.

## 6. Exact Supervisor behavior

The current per-city route registration includes expanded config, agents, rigs, the browser-safe provider projection, all required session endpoints, and the structured session stream: [expanded config projection](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_handlers_config.go#L14-L76), [agent, provider, and rig routes](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/supervisor_city_routes.go#L55-L124), and [session routes](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/supervisor_city_routes.go#L361-L428). `providers/public` intentionally omits provider commands, arguments, environment, and prompt-delivery details while retaining option schemas/defaults: [public provider DTO](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_types_providers.go#L16-L47). At build time, generate or validate TypeScript wire types from the pinned `/openapi.json`; at runtime, capability-probe required routes and schema discriminants.

### 6.1 Discovery

- Load `GET .../sessions?state=all` as the master inventory and fetch later pages on demand with the opaque `next_cursor`; never pull an unbounded history just to build the hierarchy.
- Load both `GET .../agents` and `GET .../config`. The live agent list can omit an unlimited pool while it has no running instance; synthesize an available configured target from each non-suspended config agent whose qualified identity is not already represented by a live agent name or `pool`. Reconstruct rig-qualified identities as `<dir>/<name>` exactly as Gasworks does. A synthesized target is a launch choice, not a claim that its provider command is ready; session creation remains authoritative.
- Fetch agents by `rig` where useful, but do not rely on a server-side session-template filter. Group the master session inventory beneath the merged configured/live agent projection in the browser.
- Project each loaded session beneath its matching configured agent. Put provider-created sessions, removed-agent sessions, and any other unmatched session in an explicit **Other sessions** group under the city so every discovered session remains attachable.
- Treat the hierarchy as a presentation projection, not a new GC object model.
- Fetch `providers/public` per selected city, cache it by the response's GC index/refresh generation, and match `session.provider` to its browser-safe option schema. If the provider or `permission_mode` choice schema is absent, hide/disable that control. Never expose the admin `/providers` or `/provider/{name}` DTOs, which include command and environment details.
- Preserve unknown states and provider names for diagnostics, but fail closed on unknown action capabilities.

### 6.2 Draft and create-on-first-send

Selecting a configured agent creates only a local draft. The first non-whitespace send performs one request that the client must not retry automatically:

```json
{
  "kind": "agent",
  "name": "<qualified configured-agent name>",
  "message": "<initial prompt>",
  "async": true,
  "project_id": "<rig/project identity when applicable>"
}
```

A successful HTTP response is `202` with `request_id` and `event_cursor`, not a created session. The current create-session contract has no `Idempotency-Key`, so a lost response is ambiguous and an automatic retry could create a duplicate. Send exactly one HTTP attempt. After receiving `202`, subscribe to the city event stream with `after_seq=<event_cursor>` and show **Starting…**. Match only the accepted `request_id` until:

- `request.result.session.create`: resolve the returned session ID, select it, then bootstrap its feed;
- `request.failed`: conservatively show **Create outcome unknown**, include the typed Supervisor detail, preserve the draft, refresh authoritative session inventory, and block retry until the user acknowledges that inspection is required; the accepted create worker can report failure before or after observable side effects, and the event does not disambiguate them;
- city stops or readiness is lost: show a recoverable lifecycle error;
- the server's bounded create window expires: show the emitted failure, not a locally invented timeout success.

If transport fails before the client receives the `202`, show **Create outcome unknown**, preserve the draft, refresh the session list, and let the user inspect plausible new sessions. A received pre-acceptance HTTP rejection is a known failure. Do not guess a match or resubmit on the user's behalf. A later explicit retry is a new user decision and may duplicate a session. True exactly-once first-send behavior is blocked on upstream create-session idempotency.

Gas City resolves the configured agent, creates in the background, waits up to 120 seconds for commandability, and then emits the result: [create resolution and readiness](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_handlers_sessions_command.go#L39-L74), [completion](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_handlers_sessions_command.go#L127-L229), and [event contract](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/docs/reference/api.md#L288-L300).

### 6.3 Submit

Send subsequent prompts to `POST .../session/{id}/submit`. Keep the default behavior implicit:

```json
{ "message": "<prompt>" }
```

Only the alternative actions add an explicit `"intent": "follow_up"` or `"intent": "interrupt_now"`, and only when listed by `session.submission_capabilities`. Track the accepted `request_id` on the city event stream through `request.result.session.submit` or `request.failed`. Do not duplicate the user's message optimistically in the authoritative transcript; show a separate transient submission state until the session stream projects it.

Submit also lacks an idempotency key. Send one HTTP attempt. A transport failure before `202` is **Submit outcome unknown**; a received pre-acceptance HTTP rejection is known. After `202`, `request.failed` with `error_code: resolve_failed` is a known pre-delivery failure, but any other reported failure is conservatively **Submit outcome unknown** because delivery may already have occurred. In every unknown case, keep the transcript, retain and disable the prompt, display the exact Supervisor diagnostic, refresh authoritative session state/transcript, require user acknowledgement before retry, and never resend or inject an optimistic user message.

### 6.4 Interactions

Bootstrap `GET .../pending` independently of transcript history. In live SSE:

- `pending` replaces the entry with the same `request_id`;
- `pending_cleared` removes it;
- reconnect/rebootstrap reseeds the complete pending snapshot.

Normalize known interaction kinds before posting `{request_id, action, text?, metadata?}` to `/respond`:

- `approval`, `tool-approval`, and `tool_approval` are one tool-approval kind. V1 emits only the current Gasworks actions (`approve`, `approve_accept_edits`, `deny`).
- `question` emits `action: "answer"` with exactly one non-empty free-text value.
- `choice` requires a non-empty option list and an exact selected member. It emits `action: "answer"` with that member as `text`.

Provider `options` are display/selection data, not trusted action identifiers. Render unknown or malformed kinds read-only with an unsupported-interaction diagnostic; never forward a provider-supplied string as an action. After submit, disable the control but leave it visible until `pending_cleared`; an accepted HTTP response alone is not authoritative clearance. Gasworks's normalized kind projection is the parity reference: [pending interaction mapping](https://github.com/gascity/gasworks-gui/blob/44812f2e656fc880a986b03a418a93348a8dc1ad/server/src/ws/session_feed/intake_state.rs#L486-L515).

The Supervisor pending and response contracts are defined in [pending handler](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_handlers_sessions_query.go#L349-L382) and [`/respond`](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_handlers_sessions_command.go#L907-L935).

### 6.5 Lifecycle controls

Map UI language to Supervisor semantics exactly:

| UI action | Supervisor endpoint | Meaning |
|---|---|---|
| Interrupt turn | `POST .../stop` | Interrupt current turn; keep session/runtime semantics |
| Kill runtime | `POST .../kill` | Terminate runtime; a controller may later restart it |
| Suspend | `POST .../suspend` | Enter suspended lifecycle state |
| Wake | `POST .../wake` | Resume/relaunch through normal lifecycle |
| Close permanently | `POST .../close?delete=true` | Close the session and permanently delete its session bead |
| Rename/title | `POST .../rename` | Send one nonempty `title`; apply the returned session without an optimistic rename |
| Permission mode | `POST .../permission-mode` | Only while legal; values come from the provider option schema |

The permission control is visible only when `providers/public` declares nonempty `permission_mode` choices. It is enabled fail-closed for idle `asleep`, `drained`, or `failed-create` sessions and idle/hold `suspended` sessions; all active, transitional, archived, and unknown states remain disabled. Gas City still performs the authoritative runtime/wake-in-flight check.

Confirm destructive or runtime-ending actions. Refresh session state after mutation; stream state is authoritative when available. The stop/kill distinction and lifecycle handlers are in [stop/kill](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_handlers_sessions_command.go#L851-L903), [suspend/close](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_handlers_sessions_command.go#L939-L1005), and [wake](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_handlers_sessions_command.go#L1010-L1037).

### 6.6 Async city-operation watcher

Create and submit completion use the city event stream, whose sequence is independent of the structured transcript cursor. Implement this as a separate module and state machine. V1 opens one watcher per accepted operation; this keeps the accepted pre-operation cursor and request ID inseparable and closes the fast-completion race without a shared unmatched-event buffer.

1. Construct the watcher from the accepted `{operation, request_id, event_cursor}` before doing any other asynchronous work.
2. Connect to `.../events/stream?after_seq=<event_cursor>`. Validate that every `event` frame has a numeric, monotonically advancing SSE ID and a well-formed envelope.
3. Accept the Supervisor's named `event: heartbeat` frames and ignore them for cursor advancement. For a data event, first commit any matching terminal result/failure, then commit its sequence ID.
4. Match both `request_id` and expected operation family. Ignore unrelated events; they never complete this request.
5. On disconnect, keep the operation visibly pending and reconnect with `Last-Event-ID: <last committed event sequence>` using the same 500 ms-to-15 second jittered backoff policy. If no data event was committed, reconnect from the original `after_seq`.
6. Reject a malformed/nonmonotonic stream and perform one reconnect from the last committed sequence. If replay is unavailable, the stream repeatedly closes before reaching a terminal event, the city is unregistered, or the contract failure recurs, mark the operation **Outcome unknown**. There is no request-status endpoint from which to reconstruct a missed terminal event.
7. For an unknown create outcome, refresh sessions and show plausible new sessions without selecting one automatically. For an unknown submit outcome, retain the transcript and refresh session state, but do not insert or resend the prompt.
8. A terminal result, explicit user dismissal, or plugin teardown aborts that watcher's stream. A city selection change does not silently discard a create already in flight; keep its operation card available until it reaches a terminal or unknown outcome.

Never interpret elapsed time, a transcript message, or a newly listed session as proof that a specific request succeeded. The city stream's `after_seq`/`Last-Event-ID` contract and terminal matching rule are documented in [the API reference](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/docs/reference/api.md#L288-L305) and [event stream input](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_types_events.go#L83-L113).

## 7. Structured feed state machine

Implement the feed as a deep browser module with a small command interface (`select`, `retry`, `setThinking`) and immutable snapshots for React. Do not spread cursor and reducer rules across components.

### 7.1 Bootstrap

For selected `(connectionId, cityName, sessionId)`:

1. Cancel every request and stream belonging to the previous selection.
2. Fetch and validate `GET .../transcript?format=structured&include_thinking=<bool>&tail=<bounded>` to obtain the authoritative stream identity and handoff cursor.
3. Immediately open `GET .../stream?format=structured&include_thinking=<same>&after_cursor=<history.cursor.resume_token>` and buffer its events.
4. Fetch `GET .../pending` and `GET .../session/{id}` while the stream is buffered.
5. Install the transcript, authoritative pending set, session state, and activity atomically, then drain buffered events through the normal reducer. This closes the transcript-to-SSE race without letting stale pending state overwrite a live event.

The REST transcript is authoritative and supplies the opaque stream handoff cursor: [structured types](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/session_structured_types.go#L11-L75) and [transcript handler](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_handlers_sessions_query.go#L135-L210).

### 7.2 Event reduction

- `structured/snapshot`: replace the entire projection, including with an empty list.
- `structured/reset`: replace the entire projection and record a visible, nonfatal reset notice using the server's reset reason.
- `structured/upsert`: require the same stream identity. Replace a message with the same stable ID in place; otherwise append it. For a same-ID replacement, require stable role and tool identity and accept the complete Gasworks status matrix: `unknown -> unknown|partial|final|superseded`, `partial -> partial|final|superseded`, `final -> final|superseded`, and `superseded -> superseded`. Repeated `partial -> partial` is normal incremental streaming.
- `activity`: update only known activity state; render an unknown value diagnostically without enabling actions.
- `pending`: replace by `request_id`.
- `pending_cleared`: remove by `request_id`.
- `heartbeat`: update connection liveness only.

Advance the accepted resume cursor only after the corresponding reducer commit. Upserts intentionally replay the mutable tail and may update the same message ID many times; reset frames are the defined response to invalid or rewritten history: [Supervisor transition algorithm](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/session_structured_stream.go#L13-L102). Gasworks's full same-ID transition and identity checks are the parity reference: [transition table](https://github.com/gascity/gasworks-gui/blob/44812f2e656fc880a986b03a418a93348a8dc1ad/src/features/session-feed/reducer.ts#L48-L94) and [reducer](https://github.com/gascity/gasworks-gui/blob/44812f2e656fc880a986b03a418a93348a8dc1ad/src/features/session-feed/reducer.ts#L539-L682).

### 7.3 Reconnect and recovery

Use streaming `fetch`, not `EventSource`, so the browser can set `Last-Event-ID`, inspect non-200 Problem Details, and cancel with `AbortController`.

1. Retain the visible transcript and show a reconnecting indicator.
2. Reconnect with `Last-Event-ID: <last accepted structured SSE id>` and the same `include_thinking`; omit `after_cursor`, because the header takes precedence.
3. Back off from 500 ms exponentially to 15 seconds with bounded jitter. Reset backoff after a stable connection/event.
4. Refresh credentials at the host for each new upstream connection. A pre-header 401 permits one forced bearer refresh and retry.
5. On resume rejection, malformed SSE, schema/identity/cursor violation, or contract failure, perform exactly one authoritative REST rebootstrap.
6. If the same contract/recovery failure recurs before a stable stream, stop and show a terminal, actionable error rather than looping.
7. Treat clean EOF as ambiguous. Re-read session state/rebootstrap; closed sessions may legitimately end after a final snapshot and idle state.

The query/header precedence is part of the Supervisor contract: [stream input](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_types_sessions.go#L84-L102). Gasworks is the behavioral reference for [bootstrap and handoff](https://github.com/gascity/gasworks-gui/blob/44812f2e656fc880a986b03a418a93348a8dc1ad/server/src/ws/session_feed/intake.rs#L164-L227), [bounded rebootstrap](https://github.com/gascity/gasworks-gui/blob/44812f2e656fc880a986b03a418a93348a8dc1ad/server/src/ws/session_feed/intake.rs#L255-L303), and [backoff reconnect](https://github.com/gascity/gasworks-gui/blob/44812f2e656fc880a986b03a418a93348a8dc1ad/server/src/ws/session_feed/intake.rs#L313-L364).

### 7.4 Thinking preference

Default `include_thinking` to `false` as a privacy-conscious display choice. A per-browser preference may opt in. Changing it cancels the stream and performs a complete bootstrap; never splice projections created with different thinking modes. The preference contains no secret and may live in namespaced browser storage.

## 8. Rendering model

The browser module uses React 18 and DSH's public UI primitives/theme tokens, while owning its application chrome and state. The full-screen workspace contains:

- a collapsible connection/city/rig/agent/session browser with search and paginated session loading;
- a session header showing city, rig, configured agent, provider, lifecycle/activity, stream health, and allowed controls;
- an ordered transcript timeline;
- pending interaction cards anchored both in the timeline and in a visible pending area;
- a capability-driven composer and submission intent selector;
- recoverable and terminal error surfaces using Problem Details `type`/`code`, never brittle text matching.

Render all structured block discriminants currently defined by GC:

- user, assistant, system, and tool messages;
- partial/final/superseded status;
- text and reasoning/thinking;
- tool use with name, state, and safely formatted input;
- tool result with success/error state and safely formatted output;
- interaction/approval/question blocks;
- structured errors and diagnostics;
- attachment/image metadata with an inaccessible-content fallback;
- unknown blocks as an escaped **Unsupported content** card containing type and safe metadata, not raw HTML.

Do not fetch `file:`, arbitrary local paths, or arbitrary remote URLs through the gateway. A structured image may render only when its URL is already browser-safe under an explicit scheme/origin policy; otherwise show metadata. GC defines provider-neutral messages, attachments, and blocks in [the structured schema](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/session_structured_types.go#L84-L167).

## 9. Authentication, configuration, and secrets

### 9.1 Transport bearer modes

For each access profile, support the mutually exclusive current GC modes:

- **Credential command**: port `gascity.dev/client-auth/v1`. Preserve GC's configured-command semantics (`sh -c`) and pass request JSON only through `GC_EXEC_INFO`, after stripping inherited `GC_*_INFO` values. Bound execution; cap captured output; require token and expiry; cache until refresh skew; redact output from browser responses and logs; force-mint once after 401.
- **Credential provider tuple**: port `gascity.dev/credential-provider/v1`. Use the exact audience, required scopes, and org from the context. Resolve provider argv from `GC_CREDENTIAL_PROVIDER`, defaulting to `gasworks credential-provider`; execute directly with minimal environment; validate audience/scopes/expiry; coalesce and cache mints; force refresh once after 401.
- **No bearer**: valid for loopback or an otherwise unfronted Supervisor.

GC's bearer behavior is documented in [client auth](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/clientauth/clientauth.go#L1-L31), including its exact [shell and environment contract](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/clientauth/clientauth.go#L207-L242). Provider-mode behavior must be contract-tested against GC's v1 protocol, not imported from an internal Go package.

### 9.2 Write grants

Every mutation gets:

- a non-empty pack-generated `X-GC-Request` CSRF value;
- a stable `Idempotency-Key` where the operation supports it;
- a fresh `X-GC-City-Write` minted by `grant_command` when configured.

Port `gascity.dev/city-write-grant/v1`. Preserve GC's configured-command semantics (`sh -c`), carry the binding only in `GC_GRANT_INFO`, and strip inherited `GC_*_INFO` values. Bind each grant to city, method, normalized path, body SHA-256, and request digest exactly as GC does. Despite its field name, `canonical_query` must contain the request's raw URL query bytes; GC's digest function performs canonicalization. A grant is single-use: never cache it and never automatically retry a mutation with the same grant. Mint a new grant for an explicitly safe idempotent retry. See [write-grant contract](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/clientgrant/clientgrant.go#L1-L15), [fresh request binding](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/clientgrant/clientgrant.go#L72-L115), and [helper execution](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/clientgrant/clientgrant.go#L145-L173).

### 9.3 Read-grant hardening

A direct read-grant-hardened Supervisor requires a fresh, exact-request `X-GC-City-Read` grant on every city-scoped GET/HEAD, including every SSE reconnect. GC contexts currently have no read-grant command/source, and current GC clients do not mint one. V1 must detect the 401/Problem Details response and explain that this deployment needs an upstream GC client contract before it can be supported. Bearer-fronted Supervisors remain supported. Evidence: [read-auth boundary](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/readauth.go#L15-L38), [SSE reconnect requirement](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/readauth.go#L40-L67), and [context fields](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/clientcontext/clientcontext.go#L31-L50).

### 9.4 DSH configuration

Do not store GC credentials in DSH settings. Host configuration is limited to non-secret operational settings such as an optional `gcHome` override and bounded request limits. Browser settings expose only UI preferences. DSH's credential service is suitable for DSH-owned secret references, but reusing GC's existing credential helper contracts avoids copying or migrating secrets.

## 10. Security and trust boundaries

The browser trusts only its same-origin DSH host. The gateway trusts only validated connections loaded from GC configuration. The Supervisor remains authoritative.

Required controls:

- Reimplement DSH's `/api` request trust checks on the more-specific pack route: validate `Host`, `Origin`, and `Sec-Fetch-Site`; accept loopback or the configured DSH host only; reject DNS rebinding and cross-site requests. The audited logic is [here](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/connection/src/api-request-trust.ts#L90-L123).
- Refuse supported startup when DSH is configured for `0.0.0.0`, unless a future version adds an authenticated/TLS front door and a deliberate opt-in. Stock DSH documents no TLS or authentication: [web server boundary](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/web-server.md#L41-L47).
- Accept only known connection IDs and exact operation templates. No arbitrary destination, redirect, method, path, query, or headers.
- Retry safe reads after transport/auth recovery. Never automatically retry a mutation unless that exact Supervisor operation declares idempotency and the client retained its key; create, submit, and respond do not currently qualify.
- Reject upstream redirects. Defend against DNS rebinding/TOCTOU for remote resolution; apply GC's rule that cleartext HTTP is loopback-only.
- Treat commands loaded from owner-only GC context files as trusted local code, matching `gc` itself. Never accept a helper command from the browser or Supervisor, and reject context files with unsafe ownership/permissions.
- Enforce body, header, event-line, event-size, and concurrent-stream bounds chosen from observed API contracts and documented as implementation safety limits.
- Strip browser `Authorization`, cookies, `X-GC-*`, forwarding headers, hop-by-hop headers, and content-length. Construct upstream headers from trusted state.
- Do not log prompts, transcript payloads, query text, bearer/grant values, helper stdout/stderr, TLS key material, or full Problem Details when it may contain provider text.
- Redact helper failures to stable code/class; include a correlation ID for local diagnostics.
- Abort upstream fetch/stream promptly when the browser disconnects or the DSH plugin unloads.
- Never inject transcript content as HTML. Escape text, JSON, tool names, URLs, and error detail.

## 11. Implemented pack tree

The implementation follows this shape (individual doctor files are abbreviated):

```text
deepseek-harness-ui/
├── README.md
├── pack.toml
├── assets/
│   ├── implementation-plan.md
│   ├── versions.env
│   ├── supervisor-contract.json # minimized required OpenAPI literals
│   ├── dsh-plugin/
│   │   ├── package.json
│   │   ├── cordis.patch.yml
│   │   ├── src/
│   │   │   ├── host/            # gateway, discovery, auth, TLS, relay
│   │   │   ├── client/          # slots, workspace, feed, rendering
│   │   ├── tests/
│   │   │   └── e2e/            # deterministic stock-DSH gate + live certificate
│   │   ├── playwright.config.mjs
│   │   └── build configuration
│   └── dist/
│       └── gastownhall-deepseek-harness-ui-<version>.tgz
├── commands/
│   ├── install.sh
│   ├── install/{command.toml,help.md}
│   ├── uninstall.sh
│   ├── uninstall/{command.toml,help.md}
│   ├── web.sh
│   ├── web/{command.toml,help.md}
│   ├── status.sh
│   └── status/{command.toml,help.md}
├── doctor/
│   ├── check-dsh.sh
│   ├── dsh/doctor.toml
│   ├── check-gc-contexts.sh
│   ├── gc-contexts/doctor.toml
│   ├── check-supervisor.sh
│   └── supervisor/doctor.toml
└── tests/
    ├── pack/
    ├── install/
    └── e2e/
```

Do not add `[[service]]` to `pack.toml`. Reuse `slack-full` only for schema-v2 identity, sibling command wrapper/metadata/help layout, doctors, explicit install/status behavior, and release packaging: [manifest](https://github.com/gastownhall/gascity-packs/blob/aab8030d397c211be6a4d460e9ce8de39e867a09/slack-full/pack.toml#L19-L22), [command convention](https://github.com/gastownhall/gascity-packs/blob/aab8030d397c211be6a4d460e9ce8de39e867a09/slack-full/commands/status/command.toml#L1-L2), and [doctor convention](https://github.com/gastownhall/gascity-packs/blob/aab8030d397c211be6a4d460e9ce8de39e867a09/slack-full/doctor/check-binaries.sh#L1-L19).

## 12. Installation and lifecycle

### Build/release

- Build and test the npm artifact in CI against the exact DSH release.
- Pack it as a deterministic `.tgz`; record its SHA-256 and dependency lock.
- Ship the prebuilt artifact so installation does not depend on the DSH monorepo's unpublished bundle preset or arbitrary `prepare` scripts.
- Run license, provenance, package-content, secret, and dependency audits before release.

### Install

`gc <binding> install`:

1. Run doctors.
2. Verify the artifact checksum.
3. Execute `dsh plugin --profile web add --save-exact <pack-owned-tgz>`.
4. Verify `dsh --profile web --dump-config` contains exactly one pack layer and no route collision.
5. Print the explicit `gc <binding> web` launch command.

`gc <binding> web` execs the pinned compatible `dsh web`/profile invocation and defaults to loopback. `status` is read-only: by default it reports local plugin/profile/version/config facts without invoking credential helpers; an explicit `--check` boots the real pack route, rejects unavailable configured connections, and adds authenticated health plus minimized OpenAPI route/schema probes for the direct `GC_SUPERVISOR_URL` target (or loopback default). Neither mode mints a write grant. `uninstall` uses `dsh plugin --profile web remove <package>` and removes only this bundle from the DSH profile; it does not touch GC contexts or cities.

## 13. Compatibility and version gates

### DSH

- Initial exact support: `@deepseek-ai/dsh` `0.1.1-rc.2`, commit `b150a...`.
- Require Node `22.19+` or `>=24`, matching the audited DSH release; use its expected pnpm toolchain only at build time.
- Exact-pin all DSH peer packages. RC internals and the client artifact format are not semver-stable.
- Gate on successful host-route registration, browser module load, slot presence, React compatibility, request-trust behavior, and stock-profile E2E—not version text alone.
- The DSH docs' external `turtle-ui` example was unavailable during the audit; do not depend on it.

### Gas City

- Record `1807cf...` as the first tested baseline, but gate at runtime by `/health`, `/openapi.json`, the checked-in minimized compatibility contract, and parsers at every browser-facing JSON/SSE trust boundary.
- Require the exact routes used in section 5; `session.structured.v1`; `snapshot|upsert|reset`; reset reasons; stable message IDs/statuses; structured/activity/pending/pending_cleared/heartbeat SSE events; submit intents; Problem Details; and async request result events.
- Unknown additive fields are tolerated and preserved only where safe. Missing or changed required discriminants disable the affected capability with an upgrade diagnostic.
- Treat generated OpenAPI v0 as authoritative, as the API reference specifies: [versioning](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/docs/reference/api.md#L337-L341).

## 14. Observability and doctors

### Host metrics/logs

Emit structured, secret-safe events for:

- plugin version and compatible DSH/GC capability result;
- connection inventory refresh count/outcome;
- REST operation name, status class, latency, correlation ID, and retry class;
- stream connect/reconnect/backoff/reset/rebootstrap/terminal counts;
- current open streams and bytes relayed, without event bodies;
- credential source class and refresh outcome, never token/helper output;
- reducer contract failures by stable error code.

### Doctors

Doctors return actionable success/warning/failure results for:

1. `node`, `dsh`, and required versions.
2. DSH `web` profile existence, exact plugin install, bundle checksum, composition load, slot dependencies, and route collision.
3. DSH bind host; fail supported readiness for `0.0.0.0`.
4. GC home/config permissions and parse validity.
5. Duplicate/incompatible contexts grouped at one URL.
6. TLS CA files, server-name configuration, and remote-HTTP rejection.
7. Credential helper/provider executable presence and noninteractive protocol shape. A local-only status check does not invoke it; an explicit live connectivity check may mint through the normal protocol but never prints the token or helper output.
8. Write-grant helper presence/protocol.
9. Supervisor health, cities, OpenAPI capability matrix, and selected city readiness.
10. Detection of direct read-grant hardening with the explicit unsupported-v1 explanation.

## 15. Test strategy

### Unit tests

- URL/context canonicalization, grouping, deterministic access-profile selection, and ambiguity errors.
- Strict TOML parsing and GC-equivalent validation fixtures.
- Origin/Host/Sec-Fetch-Site trust matrix and header stripping.
- Allowlisted route/method/query/body validation and path encoding.
- Credential-command, credential-provider, expiry/cache/single-flight/401 refresh, output limits, timeout, cancellation, and redaction.
- Fresh write-grant canonical binding and no-reuse behavior.
- SSE parser across chunk boundaries, CRLF, comments, multiline data, IDs, EOF, cancellation, and limits.
- Structured reducer snapshots, empty resets, same-ID upserts, the complete repeated/advancing status matrix, stable role/tool identity, stream identity, pending replacement/clear, and cursor-commit ordering.
- Async city-operation watcher request/operation matching, numeric sequence validation, commit ordering, reconnect, unknown outcome, and teardown.
- Pending interaction normalization for all three approval aliases, free-text question, validated choice, malformed options, and unknown read-only fallback.
- Hash navigation, selection cancellation, draft persistence, capability-driven controls, and safe rendering.

### Contract tests

- Generate fixtures/types from the pinned GC OpenAPI and fail on breaking required-contract changes.
- Exercise a real Supervisor for every endpoint in section 5 and every SSE event type.
- Test REST snapshot-to-SSE `after_cursor`, `Last-Event-ID` precedence, inclusive mutable-tail replay, cursor expiry, all reset reasons, fallback history promotion, and closed-session EOF.
- Test all async terminal result/failure events from accepted request ID/cursor.
- Break the city event stream before and after a committed event, verify `after_seq`/`Last-Event-ID` recovery, and verify a lost/unrecoverable result becomes **Outcome unknown** rather than success or an automatic retry.
- Run helper-protocol conformance tests against fixtures shared or copied verbatim from the current GC contracts.
- Load the packaged npm `.tgz` in a clean stock DSH `web` profile; never count a source-monorepo run as packaging proof.

### Integration tests

- Local Supervisor with no auth.
- HTTPS bearer front using credential command.
- Credential-provider tuple using a fake provider.
- Write-grant-hardened mutations with a fake grant helper.
- 401 refresh, revoked credentials, invalid TLS, Supervisor restart, city stop/start, and DSH shutdown during SSE.
- Lost session-create response and lost city-result stream, proving that the pack never automatically repeats create or submit.
- Verify direct read-grant hardening fails with the intended diagnostic.
- Verify browser requests cannot reach an unconfigured host, arbitrary path, or mutation.

### End-to-end tests

The PR-blocking deterministic browser contract uses a stateful mock only to prove packaging, BFF routing, UI behavior, and stream semantics. It rebuilds and byte-compares the artifact, installs it through the pack command into isolated GC/DSH homes, launches exact stock DSH on a random loopback port, drives Chrome through the public UI, merges a cold configured pool without duplicating its running member, creates from that cold pool, proves created-session identity and its own stream, forces EOF/resume/reset, exercises all interaction shapes and submit intents, injects ambiguous mutation outcomes, runs reconnect soak, uninstalls, and verifies owned-state cleanup plus GC/profile preservation. It is never described as multi-provider certification.

The credentialed release certificate then exercises the shared stock-DSH UI path for at least two different real GC session providers:

1. Create a disposable city through `gc init` without `--no-start`; wait for Supervisor health and prove that exact city is `running: true` before DSH starts.
2. Import two pack-owned on-demand agents backed by distinct real providers, reload, and verify their authoritative provider identities.
3. Install the tarball with the pack command into a clean DSH home and start stock loopback `dsh web`.
4. Open Gas City from the sidebar, discover each agent, and create its session on first send through the correlated city-event lifecycle.
5. For each provider, verify a final nonce in the authoritative structured transcript, submit a second prompt requiring a harmless read-only tool, and prove a new matching tool-use/tool-result pair both authoritatively and in the UI.
6. Close each run-owned session permanently, uninstall the plugin, restore the DSH profile, stop the disposable city, uninstall the isolated Supervisor service, and remove only the run-owned temporary root.
7. On failure, preserve browser errors/responses, visible DOM, screenshot, Supervisor health, city/session/agent state, recent city events, and `gc status` before cleanup.

## 16. Phased implementation and release gates

### Phase 0 — DSH packaging spike

**Baseline status: complete, including isolated live cross-provider evidence.**

- Build the smallest two-sided package.
- Prove sidebar action, overlay, same-origin REST, and relayed SSE in stock `0.1.1-rc.2`.
- Reproduce the external lazy-CJS artifact format with no DSH source checkout at install time.

**Gate:** packaged `.tgz` installs, boots, renders, streams, and uninstalls in a clean profile.

### Phase 1 — secure gateway and discovery

**Baseline status: complete.**

- Implement trust checks, allowlist, config discovery/grouping, TLS, bearer modes, write grants, health/capability checks, redaction, and cancellation.

**Gate:** security/unit/contract suites pass; browser cannot obtain secrets or proxy arbitrary traffic.

### Phase 2 — read-only workspace and feed

**Baseline status: complete.**

- Implement hierarchy, session list/state, structured bootstrap, SSE reducer, reconnection/rebootstrap, transcript renderer, activity/errors, and thinking preference.

**Deterministic gate:** structured parity fixtures and stock-DSH browser recovery render correctly through reset and reconnect paths. **Release gate:** passed with live Claude and Codex sessions through the same stock-DSH browser path.

### Phase 3 — mutations and interactions

**Baseline status: complete, including live create, submit, structured tool evidence, and permanent close for two providers.**

- Add draft/create-on-first-send, submit intents, pending interactions, `/respond`, and lifecycle controls.

**Deterministic gate:** async request correlation/recovery, no-automatic-mutation-retry behavior, approval aliases, questions, choices, submit intents, and interruption pass in contract/browser coverage. **Release gate:** live create/default-submit/tool-stream/permanent-close behavior passed for Claude and Codex; failure injection retains broader deterministic coverage.

### Phase 4 — pack delivery and release candidate

**Baseline status: implementation and all local release gates complete; release publication remains.**

- Add schema-v2 manifest, commands/help, doctors, deterministic artifact, checksums, status/uninstall, compatibility matrix, and operator docs.

**Gate:** clean-machine install/upgrade/uninstall, security review, accessibility pass, failure injection, and no-source-change verification.

## 17. Known limitations and upstream dependencies

- **DSH RC extension stability:** the needed host route and UI slots are public in source/docs, but the release is an RC and its external browser build preset is unpublished. Exact pinning is mandatory initially.
- **No direct read grants:** support requires Gas City to publish a read-grant source in its client-context/helper contract. Do not invent an incompatible pack-only mint format.
- **Attachments:** Gasworks upload/cache is Gasworks-owned, while GC create/submit is text-only. V1 renders safe attachment/image metadata but neither uploads, links, fetches, nor proxies attachment paths/URLs. See [Gasworks upload](https://github.com/gascity/gasworks-gui/blob/44812f2e656fc880a986b03a418a93348a8dc1ad/src/api/upload.ts#L39-L83) and [GC submit schema](https://github.com/gastownhall/gascity/blob/1807cf018045e9f225993d97cf6daea37e2ce6e9/internal/api/huma_types_sessions.go#L152-L180).
- **Provider-specific content:** the UI can display only content projected into `session.structured.v1`. Unknown blocks get a safe fallback; the pack does not read provider logs to fill gaps.
- **DSH network exposure:** supported v1 operation is loopback only because stock DSH has no TLS/auth boundary.
- **No connection editor:** users manage endpoints and credentials with `gc context`; the workspace refreshes that authoritative configuration.
- **Configured agents only:** raw provider create is intentionally excluded until there is a product need and a capability-safe UX.
- **No create/submit/respond idempotency:** the current Supervisor create, submit, and interaction-response operations have no idempotency header. The pack sends one attempt, distinguishes received HTTP rejection from transport uncertainty, disables an uncertain pending response through authoritative refresh, and reports a lost response/result as an unknown outcome. A strict exactly-once guarantee depends on an upstream GC API addition.
- **Isolated storage exception:** the live release fixture currently selects `GC_BEADS=file` because default managed-Dolt `gc init` is blocked on the audited machine by its installed `bd`/Dolt compatibility. The fixture still uses `gc init`, lets it start the isolated Supervisor/city, and proves `running: true`; it does not certify the default storage path.
- **Live provider scope:** the isolated certificate passed for Claude and Codex through the same stock-DSH/pack path. That proves the provider-neutral boundary for two real providers on the audited baseline, not every current or future Gas City provider.
- **macOS live-fixture path:** the certificate creates its disposable city under `~/Library/Caches`, avoiding the audited GC Codex rollout lookup's lexical `/tmp` versus `/private/tmp` `cwd` mismatch. This affects only the disposable release fixture and does not rewrite user city paths.
- **Multi-browser fan-out:** one upstream SSE per active browser/session is an intentional v1 scope and scaling tradeoff. A shared host-side fan-out cache is a later optimization only if measurements justify its complexity; it is not an upstream dependency.

## 18. Acceptance criteria

The pack is ready for a v1 release only when all of these statements are demonstrably true:

- It installs into and runs inside an unmodified stock DSH web profile.
- The browser module—not GC and not the gateway—renders the workspace.
- Every displayed session and transcript item comes from Supervisor REST/SSE.
- A session backed by at least two different providers behaves through the same UI path.
- First send makes one non-retried configured-agent create attempt; after `202` it waits for the matching terminal city event, and any irrecoverable/lost result becomes an explicit unknown outcome.
- Partial text, same-ID updates, reset, pending, activity, errors, EOF, reconnect, and cursor expiry pass contract/E2E tests.
- All supported mutations use GC CSRF/auth/grant contracts; no secret reaches browser state or logs.
- The gateway cannot be used as a general HTTP proxy.
- Loopback exposure and unsupported read-grant hardening are diagnosed honestly.
- Attachment limitations and unknown provider content degrade safely.
- Install, status, doctor, launch, upgrade, and uninstall work from the pack without source changes to any audited repository.

## 19. Canonical behavioral references

Gasworks is the implementation reference for client semantics, not a library dependency. Its server owns Supervisor traffic and its browser owns presentation: [browser broker](https://github.com/gascity/gasworks-gui/blob/44812f2e656fc880a986b03a418a93348a8dc1ad/src/api/clientBroker.ts#L23-L79), [server dispatch](https://github.com/gascity/gasworks-gui/blob/44812f2e656fc880a986b03a418a93348a8dc1ad/server/src/ws/gc_dispatch.rs#L1-L29), and [concurrent transcript/pending/session bootstrap](https://github.com/gascity/gasworks-gui/blob/44812f2e656fc880a986b03a418a93348a8dc1ad/server/src/ws/session_feed/upstream.rs#L136-L249).

The authoritative public API reference is [Supervisor REST API](https://docs.gascity.com/reference/api#supervisor-rest-api). When prose and implementation differ, the current generated OpenAPI and handlers govern this plan.
