# The inbound attachment allow-list holds on every hop

**Bead:** mc-k6jn2. **Status:** implemented.

## The gap

Inbound Discord attachments are fetched to disk so the receipt and the envelope
can name a local path instead of a signed CDN url that expires.
`_attachment_url_is_allowed` guards that fetch: https only, and the host must be
`cdn.discordapp.com` or `media.discordapp.net`. It is an allow-list precisely
because the url arrives inside an inbound payload, so fetching whatever it names
would let anyone who can message the bot point it at an arbitrary host,
including one on the machine's own network.

`urllib.request.urlopen` follows redirects, and the check ran only on the url
that came off the payload. **The allow-list was one 302 wide.**

Verified rather than reasoned, with a local server that answered `/redirect`
with a 302 to its own `/internal`: the internal body came back and `geturl()`
reported `127.0.0.1`. The probe carried a positive control, a direct fetch of
`/internal` that succeeded, so a failure to fetch could not have been misread as
"redirects are not followed".

## Severity, stated plainly

**Defence in depth, not a live exploit.** Reaching it requires a redirect *from*
`cdn.discordapp.com` or `media.discordapp.net`, so an attacker would need an
open redirect on, or control of, Discord's own CDN. Nobody who can merely
message the bot can trigger it.

It is fixed anyway for two reasons. The allow-list is the whole of the
protection on this path, and a control that holds only for the first hop is not
the control anyone reading `_attachment_url_is_allowed` would assume they have.
And this code is headed upstream, where a reviewer will ask.

## The fix, and the two alternatives rejected

`_AttachmentRedirectHandler` re-runs `_attachment_url_is_allowed` on every hop
and raises on the first that fails.

**Rejected: refuse all redirects.** Simpler, and it would have made the
"refused" test pass. It also breaks a CDN that legitimately redirects, which
`media.discordapp.net` exists to do. `test_a_redirect_that_stays_on_the_cdn_is
_still_followed` is the coverage control that keeps this honest: the over-broad
fix reddens it.

**Rejected: check `response.geturl()` after the fetch.** It would stop the bytes
being stored, and it would still have made the request to the internal host,
which is the part that matters in an SSRF.

## Why a dedicated opener, and what it cost

A redirect handler has to be attached to an opener, and installing one globally
would put a Discord-CDN allow-list in front of `discord_api_request`'s calls to
`discord.com`. So attachment fetches go through `attachment_urlopen`, a named
module-level function, and everything else keeps using `urllib.request.urlopen`.

The cost is a test seam change: 18 existing patch sites moved from
`common.urllib.request.urlopen` to `common.attachment_urlopen`. They are more
precise for it, because they now patch this fetch rather than every fetch in the
module. The discord suite runs 33.98s against a 34.11s baseline on the same
tree, so nothing quietly started reaching the network.

## Verification

Four tests, all observed failing against the unfixed tree first. The unfixed
tree was given a shim `attachment_urlopen` delegating to plain `urlopen`, so the
tests failed for the reason under test rather than on `AttributeError`.

Three positive controls, each reddening exactly one test:

| Mutation | Reddens |
| --- | --- |
| the handler allows every redirect | the refusal test |
| the handler refuses every redirect | the stays-on-the-CDN test |
| the opener is built without the handler | the wiring test |

The third exists because a security control that is written and never wired in
protects nothing.

The fix was then re-run against the original real-server probe, with two
controls in the same script: a direct fetch through `attachment_urlopen`
succeeds (the harness works), a plain `urlopen` on `/redirect` still returns the
internal body (the server really is redirecting, so the difference is the
handler), and the fixed fetcher refuses with "refusing a redirect off the
Discord CDN allow-list".

Full suite: 1311 passed, 29 skipped, 0 failed, plus `validate_registry.py`.
