# The gateway reflects whether a session can answer

**Bead:** ga-okqd0. **Status:** implemented.

## The problem

Discord shows a bot as ONLINE for exactly as long as its gateway connection is
up. In this pack the gateway is a separate long-lived service, and it stays
connected while the session it speaks for is down. The two liveness signals are
decoupled and only the gateway's is visible to Discord, so the bot reads online
while nobody can answer.

Connor asked for the fix and named the constraint, 2026-09-03: *"I would like
you to set your online status to offline when you can't accept messages so that
you don't need to message me about it."*

The operative half is **so that you don't need to message me**. His constraint
is message volume, not message format. Presence is ambient: it costs the reader
no notification, no unread, and no line in their message list, while a broadcast
interrupts everyone who can see the channel to say something only some of them
care about. A quieter announcement is not what was asked for, and this change
adds no message anywhere. `test_nothing_in_this_feature_sends_a_message` pins
that, because "we agreed not to" is not a mechanism.

## What the gateway uses as its signal

**The signal is an assertion written to a file, not something the gateway
derives.** `data/gateway-presence.json` (per app: `gateway-presence-<app>.json`)
holds a status, a reason, and an expiry. `gc discord presence` writes it and the
gateway reads it.

The gateway does not judge whether a session can answer, and that is deliberate.
That judgement already exists in `bin/gc-stall-check` in the gascity repo, and it
is not simple: its own header records that the first version broadcast a FALSE
OFFLINE to four people, that receipt mtime is not arrival time (a receipt is
rewritten, so age comes from the message snowflake), and that a rate-limited
reaction lookup returns valid JSON with no `reactions` key and so parses as "no
reactions" unless you check the response is a message at all. Re-deriving that
inside the gateway would mean maintaining two copies of a predicate that has
already been wrong once, in a component that cannot see most of its inputs.

So the split is: the detector decides, the gateway reflects.

A file rather than a request to the running service, for three reasons. It
survives a gateway restart. An assertion made while the gateway happens to be
down is applied on its next connect instead of being lost, and a gateway
restarting is well correlated with the conditions worth reporting. And there is
exactly one place to look when presence and reality disagree.

## What happens when the signal is itself stale

**An assertion expires, and on expiry the bot returns to ONLINE.**

That direction is a choice between two wrong states, and it is the one the fleet
ruled for. A bot reading online while it cannot answer is the bug this document
is about: someone sends a message and waits. A bot stuck reading idle while
someone IS working is worse, because it tells four people not to bother asking
and nothing ever corrects it. The first failure wastes one person's patience;
the second silently removes the bot from everyone's options for as long as it
lasts.

So the failure mode is chosen rather than inherited: if the thing asserting
"idle" stops running, is uninstalled, or its box reboots, the assertion rots and
the bot comes back on its own.

The cost is that **the caller must re-assert while the condition still holds**,
with a TTL comfortably longer than its own interval so an assertion never lapses
between two ticks of a watcher that is still running. `gc-stall-check` currently
fires once per stall (it returns early when an OFFLINE is already on record), so
wiring it to this needs it to re-assert on every tick even when it does not
announce. That wiring lives in the gascity repo and is not part of this change.

Expiry is evaluated on the gateway's heartbeat tick, not only at connect time.
Without that, a lapsed assertion would go unnoticed until the next reconnect, so
a watcher that died at 09:00 could leave the bot reading idle for as long as the
connection happened to stay up.

## Where presence is applied, and why it is three places

1. **In the IDENTIFY payload (op 2).** A fresh IDENTIFY resets the session's
   presence to the default. A gateway that only ever sent op 3 would pop back to
   online on every reconnect and stay there until something noticed: the same
   bug, in a slower and harder to see form.
2. **As an op 3 on the heartbeat tick.** This is what makes a change take effect
   without waiting for a reconnect, and what lets an expiry undo itself. It
   rides the heartbeat rather than adding a timer because the heartbeat is the
   one tick guaranteed to keep running on an idle connection, which is exactly
   the case presence has to work in. Worst-case latency is one heartbeat
   interval, about 41 seconds, against a signal that reports a stall measured in
   quarter-hours.
3. **After RESUMED.** A resume restores the previous session's presence, so this
   is a no-op unless the desired status moved while disconnected. That window is
   exactly when a stall is likely to begin.

A send that fails is swallowed and recorded in `last_presence_error`. Presence is
cosmetic next to delivering messages, and it must never take down a connection
that is otherwise working.

An unknown status is refused when the assertion is written. Discord answers an
invalid status by ignoring the whole op 3 and leaving the bot as it was, so an
unchecked typo would be a silent no-op with nothing to read in any log.

## Verification

23 unit tests plus 2 that drive the real connect loop over a mocked websocket
and read what landed on the wire. The second pair exist because every other test
calls `identify()` or `apply_presence_if_changed()` directly and therefore
proves the method while saying nothing about whether anything calls it.

All 25 were observed failing against the unfixed tree before the change: 22 of
23 failed, and the one that passed (`test_identify_carries_no_presence_when_none
_is_asserted`) pins the unchanged default IDENTIFY shape, so it is expected to
pass on both sides.

Seven positive controls were run against the fixed tree, each reddening exactly
the predicted tests:

| Mutation | Reddens |
| --- | --- |
| delete the presence tick from the heartbeat loop | the mid-connection wire test, and only that (1) |
| IDENTIFY stops carrying presence | both identify tests (2) |
| trust an assertion forever, no expiry | every expiry test (5) |
| drop the no-op guard | the no-op test, per-app, and the wire test (3) |
| let a send failure escape | the failed-send test (1) |
| accept any status string | the unknown-status test (1) |
| make presence global rather than per app | both per-app tests (2) |

The first control is the one worth keeping: deleting the loop's call site
reddens **only** the wire test, which is the evidence that the wire test is the
only thing guarding the wiring and that the other 23 would have shipped a
feature nothing invoked.

One test was rewritten after a control refused to fire. `test_a_non_positive_ttl
_is_refused` originally wrapped its assertions in `subTest`, and against the
unfixed tree it printed PASSED with two SUBFAILED lines above it: the outer test
result does not inherit a subtest failure. It asserts directly now.

Full suite on this branch: 1307 passed, 29 skipped, 0 failed, plus
`validate_registry.py --require-git`.

## What is not covered

Nothing here has talked to Discord. The op 2 and op 3 payload shapes are built
from Discord's documented gateway protocol and asserted against a mocked socket;
a live connection would be needed to confirm Discord accepts them and that the
status actually changes in a client. The 41-second worst-case latency is derived
from the heartbeat interval Discord sends in HELLO, not measured.
