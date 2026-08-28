# DeepSeek Harness UI for Gas City

> Status: release-ready for the documented v1 boundary. Deterministic, stock-browser, SSH, soak, and isolated real-Claude/real-Codex gates pass for the checksum-pinned final artifact. Publication remains a separate release action.

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
- Selecting an agent opens a draft. This includes cold on-demand pools declared by the city's expanded configuration even when `/agents` has no running instance to list. The first send creates the GC session with that initial message through the normal asynchronous Supervisor lifecycle.
- The transcript updates incrementally with assistant text, reasoning, tool calls, tool results, interactions, errors, and activity.
- Ordinary **Send** leaves the Supervisor's default intent implicit. The composer adds `follow_up` and `interrupt_now` only when the session advertises them.
- Pending approval aliases, free-text questions, and validated choices are answered through the Supervisor's `/respond` endpoint. An uncertain response is disabled while the client refreshes authoritative pending state; it is never resent automatically.
- Interrupt, kill, suspend, wake, and **Close permanently** are shown only when the verified session state/activity matrix permits them. Kill and close require confirmation; permanent close uses the Supervisor's explicit `delete=true` semantics.
- Reconnects use the Supervisor's opaque cursor and reset semantics. The UI never invents a parallel transcript.
- Session discovery follows opaque pagination cursors, reports partial inventories, and filters the sessions already loaded.
- A browser-only **Show reasoning** preference reboots the feed when changed, so redacted and unredacted cursor domains never mix.
- Rename and provider-schema permission-mode settings use their dedicated Supervisor operations; permission mode stays disabled unless the session is clearly dormant.
- Provider-neutral prompt, system-event, usage, diagnostic, image, and attachment metadata render without fetching untrusted paths or URLs.
- After an asynchronous operation is accepted, the UI treats a create `request.failed` and any submit failure other than the pre-delivery `resolve_failed` code as outcome-unknown. It preserves the prompt, displays the Supervisor's exact diagnostic, refreshes authoritative state, and blocks automatic retry.

Local discovery reuses `~/.gc/supervisor.toml`. Remote discovery reuses `~/.gc/contexts.toml`, grouping contexts that address the same Supervisor while retaining their city-specific access profiles. There is no second connection or credential editor in v1.

## V1 boundaries

V1 deliberately does not include:

- a DeepSeek Harness model/provider adapter;
- a Gas City provider, runtime, RPP, or supervised pack service;
- tmux wrappers or DSH execution sessions;
- transcript mirroring or conversion to provider-specific JSONL;
- raw provider session creation—the create surface is limited to configured GC agents;
- attachment upload or local-file proxying (safe transcript metadata is displayed);
- direct read-grant minting without an authority/minter integration, because the current GC context contract has no read-grant client source;
- a connection editor, city/rig/agent administration, or replacement of DSH's own screens.

Both local and SSH-forwarded remote use are supported with a loopback-bound `dsh web`. Stock DSH currently provides neither TLS nor authentication for its web server, so exposing this gateway on `0.0.0.0` is outside the supported v1 trust boundary.

An authority-fronted Supervisor is supported through the transport bearer configuration already present in GC contexts. The authority authenticates the DSH host and supplies request-bound read grants upstream. A DSH credential or static token alone cannot create Gas City's single-use `X-GC-City-Read` grants; a direct hardened Supervisor therefore needs a concrete host-only minter/helper contract before the pack can support it.

## Remote use over SSH

SSH-forwarded remote use is supported without publishing DSH or the Supervisor on a network interface. Forward a local port to the remote DSH loopback listener:

```sh
ssh -L 43080:127.0.0.1:3080 user@remote-host
```

Then, on the remote host, launch the pack normally:

```sh
gc <binding> web --port 3080
```

DSH detects the SSH environment, prints the remote loopback URL, and leaves browser handoff to the SSH client or editor, as documented by the [stock DSH Web bundle](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md). Open `http://127.0.0.1:43080` in the local browser. VS Code Remote SSH's [**Forward a Port**](https://code.visualstudio.com/docs/remote/ssh#_forwarding-a-port-creating-ssh-tunnel) action is equivalent and may choose a different available local port. The complete browser/host/Supervisor flow stays on one forwarded DSH origin, so Supervisor credentials never enter the browser bundle.

## Delivery

The schema-v2 pack ships a prebuilt, checksum-pinned DSH plugin artifact plus explicit install, uninstall, web, status, and doctor commands. It reuses `slack-full`'s pack delivery conventions, not its connector architecture. There is no `[[service]]` block: the DSH host process itself supplies the pack-owned gateway.

The exact artifact build toolchain is pinned in [`assets/versions.env`](assets/versions.env), while runtime DSH support is maintained independently in [`assets/dsh-compatibility.json`](assets/dsh-compatibility.json). Each pack release certifies the exact DSH runtime exercised by its local and SSH-forwarded stock-browser gates. A newer untested DSH release may still install and run with an explicit provisional warning; profile composition and the host route are checked, but its browser loader and UI-slot compatibility remain unverified until a pack release certifies that DSH version. An older-than-minimum or known-incompatible release fails with a specific diagnostic. Installation still fails when Node or usable plugin-management tooling is missing, the artifact checksum is wrong, profile composition fails, or the loopback pack route does not load. Read-only `status` does not require pnpm. `status --check` separately validates GC contexts, reports unavailable pack connections, and probes the explicitly selected direct Supervisor target (or the loopback default) against the minimized route/schema contract in [`assets/supervisor-contract.json`](assets/supervisor-contract.json), including the expanded `/config` inventory required for cold pools.

## Verification

The implementation was developed through red-green TDD and currently passes:

- 147 plugin unit, contract, host-boundary, feed-recovery, E2E-infrastructure, and React workspace tests;
- 40 black-box pack/install/uninstall tests;
- TypeScript no-emit checking and production host/client builds;
- ShellCheck, `gc lint`, and the checksum doctor;
- checked-in stock `dsh web` browser contracts in headless Chrome, including real pack install/uninstall, local and SSH-forwarded origins on different ports, a random-port Supervisor fixture, topology pagination, cold-pool create-on-first-send, structured SSE EOF/resume/reset recovery, reasoning rebootstrap, all interaction shapes and submission intents, rename, permission mode, lifecycle control, ambiguous-mutation recovery, and reconnect soak;
- a deterministic rebuild that byte-compares the produced `.tgz` with the checksum-pinned artifact.

Live multi-provider certification is deliberately separate from the deterministic fixture gate. `pnpm test:e2e:live:isolated` creates a disposable city with normal `gc init` and allows that command to start its isolated Supervisor; it then requires `/health` and that exact city to report `running: true` before stock DSH is launched. The gate fails as **UNPROVEN** unless two configured agents backed by distinct real provider identities complete authoritative nonce and tool-use evidence through the browser. On August 27, 2026, artifact `6449a835d5d8a79ccc61e5b48d556afd3173c1f1a6b0c050abaf8a56c0973d1d` passed in stock DSH `0.1.1-rc.2`, Chrome `151.0.7922.174`, and Gas City `1.4.0` (`a7297c511d637a3609947386f3389d76ddb2f23b`). Real Claude and Codex sessions each produced a final nonce plus a newly completed tool call/result in an authoritative `session.structured.v1` transcript, rendered through the stock DSH browser path, accepted a follow-up submit, and were permanently deleted. No run-owned session or fixture process, tmux server, cache root, or Supervisor service remained.

The recertification investigation corrected two misleading “provider stall” diagnoses. Codex had completed in about eight seconds, but a later event already buffered in the same SSE read overwrote the terminal create snapshot; terminal operation states are now absorbing and the stock-browser contract sends a matching terminal plus a trailing event in one response. Separately, Claude Code `2.1.250` changed its fresh-workspace trust dialog so **No, exit** is selected by default, while Gas City `1.4.0` assumes the safe choice is preselected and sends Enter. The passing gate therefore recreated a fresh city at an exact, previously trusted disposable path. `GC_LIVE_ROOT_NAME` and `GC_LIVE_CITY` support that audited setup only through narrow `dsh-gc-live-*` and `dsh-live-*` names under the fixture cache root; an existing target is rejected. Normal existing trusted cities are unaffected, but creating a Claude session in a brand-new untrusted directory remains an upstream Gas City/Claude compatibility limitation rather than something this UI pack can safely bypass.

The final fixture fails immediately when the UI renders a known create failure instead of waiting out the provider allowance. It also uninstalls the isolated Supervisor before force-stopping the city, uses an exact run-owned tmux fallback, and verifies that no fixture process or cache root remains on pass, failure, or interruption.

The isolated release fixture currently sets `GC_BEADS=file`. This is a narrowly documented test-environment exception: the audited machine's default managed-Dolt initialization is blocked by its installed `bd`/Dolt compatibility. It does not bypass city creation or startup, and it is not evidence that the default storage path works on this machine.

On macOS the disposable city lives under `~/Library/Caches`, not `/tmp`. This keeps the city work directory and the Codex rollout `cwd` lexically identical despite macOS's `/tmp` to `/private/tmp` alias; it does not alter a user's Gas City paths.

See [the implementation plan](assets/implementation-plan.md) for the verified APIs, state machines, security model, proposed pack tree, tests, phases, and immutable source citations.

## Verified baseline

This specification was audited against:

- Gas City commit `1807cf018045e9f225993d97cf6daea37e2ce6e9` (`edge`);
- Gasworks GUI commit `44812f2e656fc880a986b03a418a93348a8dc1ad`;
- DeepSeek Harness `dsh-v0.1.1-rc.2`, commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`;
- `gascity-packs` commit `aab8030d397c211be6a4d460e9ce8de39e867a09` for schema-v2 delivery conventions.

These are the artifact-build and first certified runtime baselines, not a claim that every future preview is automatically compatible. Newer DSH versions are usable provisionally instead of being artificially blocked, but only the runtime named in the compatibility manifest has the release's stock-browser evidence.
