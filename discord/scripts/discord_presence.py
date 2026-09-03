#!/usr/bin/env python3
"""Set, clear or read the Discord bot's presence (bead ga-okqd0).

WHY THIS EXISTS. Discord shows the bot online for as long as the GATEWAY
connection is up, and the gateway is a long-lived service that outlives the
session it speaks for. So the bot reads online while nobody can answer. Connor
asked for a status change precisely so that no message has to be sent:
presence costs a reader nothing, no notification, no unread, no line in their
list, while a broadcast interrupts everyone.

This writes the assertion; the gateway applies it. Nothing here talks to
Discord, so it works whether or not the gateway is running, and an assertion
made while the gateway is down is applied on its next connect.

AN ASSERTION EXPIRES. That is the safety property, not an oversight: if the
thing asserting "idle" stops running, the bot comes back to online on its own
rather than telling four people not to bother asking, forever. Re-assert while
the condition still holds, with a ttl comfortably longer than your interval.
"""

from __future__ import annotations

import argparse
import json
import sys

import discord_intake_common as common


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gc discord presence",
        description="Set, clear or read the Discord bot's presence.",
    )
    parser.add_argument(
        "--status",
        choices=list(common.GATEWAY_PRESENCE_STATUSES),
        help="the presence to assert; omit to read the current one",
    )
    parser.add_argument(
        "--ttl",
        type=int,
        default=common.GATEWAY_PRESENCE_DEFAULT_TTL_SECONDS,
        help=(
            "seconds the assertion is believed before the bot returns to online "
            f"(default {common.GATEWAY_PRESENCE_DEFAULT_TTL_SECONDS})"
        ),
    )
    parser.add_argument("--reason", default="", help="free text recorded with the assertion")
    parser.add_argument("--app", default="", help="named Discord app, omit for the default")
    parser.add_argument("--clear", action="store_true", help="drop the assertion, returning to online")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    args = parser.parse_args(argv)

    if args.clear and args.status:
        parser.error("--clear and --status are mutually exclusive")

    try:
        if args.clear:
            common.clear_gateway_presence(args.app)
        elif args.status:
            common.save_gateway_presence(
                args.status,
                ttl_seconds=args.ttl,
                app_name=args.app,
                reason=args.reason,
            )
    except ValueError as exc:
        print(f"gc discord presence: {exc}", file=sys.stderr)
        return 2

    assertion = common.load_gateway_presence(args.app)
    effective = common.effective_gateway_presence(args.app)
    payload = {
        "effective": effective,
        "asserted": assertion.get("status", ""),
        "expires_at_epoch": assertion.get("expires_at_epoch", 0),
        "reason": assertion.get("reason", ""),
        "app": args.app or "default",
    }
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return 0

    print(f"presence: {effective}")
    if payload["asserted"] and payload["asserted"] != effective:
        # The only way these differ is a lapsed assertion, and saying so beats
        # making someone work out why the bot is online with idle on record.
        print(f"  asserted {payload['asserted']}, but the assertion has expired")
    elif payload["asserted"]:
        print(f"  asserted, expires at epoch {payload['expires_at_epoch']}")
        if payload["reason"]:
            print(f"  reason: {payload['reason']}")
    else:
        print("  no assertion on record")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
