Set, clear or read the Discord bot's presence, without messaging anyone.

Discord shows the bot online for as long as the GATEWAY connection is up, and
the gateway is a long-lived service that outlives the session it speaks for. So
the bot reads online while nobody can answer. This is the fix for that, and it
is deliberately a status change rather than an announcement: presence costs a
reader nothing, no notification, no unread, no line in their message list, while
a broadcast interrupts everyone who can see the channel.

Examples:
  gc discord presence                                   # read the current one
  gc discord presence --status idle --ttl 1800
  gc discord presence --status idle --reason "session stalled 20 min"
  gc discord presence --status invisible --app ollie
  gc discord presence --clear                           # back to online now
  gc discord presence --json

Statuses: online, idle, dnd, invisible.

AN ASSERTION EXPIRES, AND THAT IS THE POINT. `--ttl` seconds after it is made,
the bot returns to online on its own. A bot that reads online while it cannot
answer is the bug this fixes; a bot stuck reading idle while someone IS working
is worse, because it tells people not to bother asking and nothing ever corrects
it. So a watcher that dies cannot leave the bot silently unavailable.

That means the caller must RE-ASSERT while the condition still holds. Pick a ttl
comfortably longer than your check interval, so an assertion never lapses
between two ticks of a watcher that is still running.

This command writes the assertion; the gateway applies it. Nothing here talks to
Discord, so it works whether or not the gateway is running, and an assertion
made while the gateway is down is applied on its next connect. A running gateway
picks up a change within one heartbeat interval, about 41 seconds.

`--app <name>` selects a named app; presence is per app, like the token.
