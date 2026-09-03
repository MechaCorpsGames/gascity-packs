#!/usr/bin/env python3
"""Edit a Discord message this bot already sent.

Built 2026-09-03 at Julius's request. Until now every correction had to be a
NEW message, which leaves the wrong version standing above the right one --
the reader has to notice the later message to learn the earlier one was wrong.

DELIBERATELY A DUMB PRIMITIVE. It replaces the whole content and nothing more.
The convention for marking an edit -- strikethrough on what was removed, the
replacement clearly marked as added, and a date beside it -- is the author's
job, not this script's, because only the author knows which words changed.
See bd memory discord-edit-convention.

Discord only permits a bot to edit its OWN messages, so a wrong message id
fails with 403 rather than damaging someone else's post.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.parse

import discord_intake_common as common

DISCORD_MAX_CHARS = 2000


def _load_body(args: argparse.Namespace) -> str:
    if args.body:
        return args.body
    if args.body_file:
        return pathlib.Path(args.body_file).read_text(encoding="utf-8")
    raise SystemExit("either --body or --body-file is required")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Edit a Discord message previously sent through a saved chat binding"
    )
    parser.add_argument("--binding", required=True, help="Binding id such as dm:1234567890")
    parser.add_argument("--message-id", required=True, help="Discord id of the message to edit")
    parser.add_argument(
        "--conversation-id",
        default="",
        help="Channel or thread id holding the message, when it is not the binding's own",
    )
    parser.add_argument("--body", default="", help="Replacement body, inline")
    parser.add_argument("--body-file", default="", help="Read the replacement body from a file")
    args = parser.parse_args(argv)

    body = _load_body(args)
    if len(body) > DISCORD_MAX_CHARS:
        # Same failure as a publish, and worth catching here: an over-length
        # edit leaves the ORIGINAL text in place, so the message silently stays
        # wrong rather than obviously failing.
        raise SystemExit(
            f"edited body is {len(body)} characters, over Discord's {DISCORD_MAX_CHARS} limit; "
            "the message would be left unedited"
        )

    config = common.load_config()
    binding = common.resolve_publish_route(config, args.binding)
    if not binding:
        raise SystemExit(f"binding not found: {args.binding}")

    conversation_id = str(args.conversation_id or binding.get("conversation_id", "")).strip()
    if not conversation_id:
        raise SystemExit("binding is missing a destination conversation_id")

    try:
        payload = common.discord_api_request(
            "PATCH",
            "/channels/{}/messages/{}".format(
                urllib.parse.quote(conversation_id),
                urllib.parse.quote(str(args.message_id)),
            ),
            {"content": body, "allowed_mentions": {"parse": ["users"]}},
        )
    except common.DiscordAPIError as exc:
        raise SystemExit(str(exc)) from exc

    record = {
        "remote_message_id": str(payload.get("id", "")),
        "conversation_id": conversation_id,
        "edited_timestamp": payload.get("edited_timestamp"),
        "content_length": len(body),
    }
    print(json.dumps({"record": record}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
