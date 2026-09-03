Edit a Discord message this bot already sent.

Discord only lets a bot edit its OWN messages, so a wrong message id fails with
403 rather than touching anyone else's post.

Examples:
  gc discord edit --binding dm:1544791821736083619 --message-id 1544920431943884821 --body-file ./fixed.txt

The message id is the `remote_message_id` printed by `gc discord publish` or
`gc discord reply-current`.

`--conversation-id` overrides the channel or thread holding the message, for the
case where the message lives in a thread rather than the binding's own channel.

THIS REPLACES THE WHOLE BODY. Marking up what changed -- strikethrough on the
removed text, the replacement clearly marked as added, and a date beside it --
is the author's job, because only the author knows which words changed. Send the
complete new body, already marked up.

An over-length body is refused here rather than at Discord, because a rejected
edit leaves the ORIGINAL text in place: the message would silently stay wrong.
Leave headroom under 2000 for the markup an edit adds.
