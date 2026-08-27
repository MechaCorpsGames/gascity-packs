# DeepSeek Harness UI for Gas City

> Status: implemented schema-v2 pack with a pinned, prebuilt DSH plugin artifact.

`deepseek-harness-ui` adds a Gas City workspace to the stock DeepSeek Harness (`dsh web`) interface. From that workspace, a user can discover cities, rigs, configured agents, and sessions; start or attach to a session; stream its structured transcript; answer pending interactions; submit prompts; and control its lifecycle.

The central invariant is:

> DeepSeek Harness is the UI. Gas City is the control plane, session owner, and transcript source.

The provider behind a selected Gas City session can be Claude, Codex, Gemini, or any other provider understood by Gas City. DeepSeek Harness does not run that agent loop and the pack does not adapt Gas City into DeepSeek Harness's model-provider API.

## Product shape

```text
DeepSeek Harness browser
  └─ pack browser plugin: renders the Gas City workspace
       └─ same-origin pack gateway in the DSH host
            └─ Gas City Supervisor REST and SSE API
                 └─ arbitrary Gas City sessions and their configured providers
```

The pack contains a two-sided DeepSeek Harness plugin:

- The browser module contributes a **Gas City** action to DSH's sidebar and renders a full-screen workspace through DSH's additive `shell.overlay` slot.
- The host module owns Supervisor discovery, TLS, credentials, grants, REST calls, and transparent SSE relay. The browser never receives Supervisor secrets.

This is the smallest public stock-DSH extension shape that can preserve Gas City's full provider-neutral stream. DSH route plugins can own long-lived responses such as SSE, while the web client exposes additive sidebar and overlay slots. No changes to DeepSeek Harness, Gas City, or Gasworks GUI are required.

## Intended experience

The workspace presents this hierarchy:

```text
Supervisor
  └─ City
      ├─ Rig
      │   └─ Configured agent
      │       └─ Sessions
      └─ City-level or unmatched configured agent
          └─ Sessions
```

- Selecting an existing session attaches to it without mutating it.
- Selecting an agent opens a draft. The first send creates the GC session with that initial message through the normal asynchronous Supervisor lifecycle.
- The transcript updates incrementally with assistant text, reasoning, tool calls, tool results, interactions, errors, and activity.
- Ordinary **Send** leaves the Supervisor's default intent implicit. The composer adds `follow_up` and `interrupt_now` only when the session advertises them.
- Pending approval aliases, free-text questions, and validated choices are answered through the Supervisor's `/respond` endpoint. An uncertain response is disabled while the client refreshes authoritative pending state; it is never resent automatically.
- Interrupt, kill, suspend, wake, and **Close permanently** are shown only when the verified session state/activity matrix permits them. Kill and close require confirmation.
- Reconnects use the Supervisor's opaque cursor and reset semantics. The UI never invents a parallel transcript.
- Session discovery follows opaque pagination cursors, reports partial inventories, and filters the sessions already loaded.
- A browser-only **Show reasoning** preference reboots the feed when changed, so redacted and unredacted cursor domains never mix.
- Rename and provider-schema permission-mode settings use their dedicated Supervisor operations; permission mode stays disabled unless the session is clearly dormant.
- Provider-neutral prompt, system-event, usage, diagnostic, image, and attachment metadata render without fetching untrusted paths or URLs.

Local discovery reuses `~/.gc/supervisor.toml`. Remote discovery reuses `~/.gc/contexts.toml`, grouping contexts that address the same Supervisor while retaining their city-specific access profiles. There is no second connection or credential editor in v1.

## V1 boundaries

V1 deliberately does not include:

- a DeepSeek Harness model/provider adapter;
- a Gas City provider, runtime, RPP, or supervised pack service;
- tmux wrappers or DSH execution sessions;
- transcript mirroring or conversion to provider-specific JSONL;
- raw provider session creation—the create surface is limited to configured GC agents;
- attachment upload or local-file proxying (safe transcript metadata is displayed);
- support for a direct read-grant-hardened Supervisor, because the current GC context contract has no read-grant client source;
- a connection editor, city/rig/agent administration, or replacement of DSH's own screens.

The default supported deployment is a loopback-bound `dsh web`. Stock DSH currently provides neither TLS nor authentication for its web server, so exposing this gateway on `0.0.0.0` is outside the supported v1 trust boundary.

## Delivery

The schema-v2 pack ships a prebuilt, checksum-pinned DSH plugin artifact plus explicit install, uninstall, web, status, and doctor commands. It reuses `slack-full`'s pack delivery conventions, not its connector architecture. There is no `[[service]]` block: the DSH host process itself supplies the pack-owned gateway.

The audited runtime pins are in [`assets/versions.env`](assets/versions.env). Installation fails when the local Node/DSH/pnpm versions, artifact checksum, profile composition, or loopback pack route do not match. `status --check` separately validates GC contexts, reports unavailable pack connections, and probes the explicitly selected direct Supervisor target (or the loopback default) against the minimized route/schema contract in [`assets/supervisor-contract.json`](assets/supervisor-contract.json).

## Verification

The implementation was developed through red-green TDD and currently passes:

- 129 plugin unit, contract, host-boundary, feed-recovery, E2E-infrastructure, and React workspace tests;
- 23 black-box pack/install/uninstall tests;
- TypeScript no-emit checking and production host/client builds;
- ShellCheck, `gc lint`, and the checksum doctor;
- a checked-in, isolated stock `dsh web` browser contract in headless Chrome, including real pack install/uninstall, random-port Supervisor fixture, topology pagination, structured SSE EOF/resume/reset recovery, reasoning rebootstrap, all interaction shapes and submission intents, rename, permission mode, lifecycle control, and create-on-first-send attached to the created session's own stream;
- a deterministic rebuild that byte-compares the produced `.tgz` with the checksum-pinned artifact.

Live multi-provider certification is deliberately separate from the deterministic fixture gate. The `pnpm test:e2e:live` operator gate fails as **UNPROVEN** unless explicitly authorized credentials identify at least two configured agents backed by distinct provider identities. Machine-specific provider readiness belongs in the generated certificate/run log, not in this README.

See [the implementation plan](assets/implementation-plan.md) for the verified APIs, state machines, security model, proposed pack tree, tests, phases, and immutable source citations.

## Verified baseline

This specification was audited against:

- Gas City commit `1807cf018045e9f225993d97cf6daea37e2ce6e9` (`edge`);
- Gasworks GUI commit `44812f2e656fc880a986b03a418a93348a8dc1ad`;
- DeepSeek Harness `dsh-v0.1.1-rc.2`, commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`;
- `gascity-packs` commit `aab8030d397c211be6a4d460e9ce8de39e867a09` for schema-v2 delivery conventions.

These are research baselines, not a promise of broad semver compatibility. The pack requires exact DSH pinning and Supervisor capability probes.
