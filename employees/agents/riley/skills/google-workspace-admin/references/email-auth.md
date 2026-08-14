# Email Authentication Reference

## Required DNS Records for Google Workspace

### MX Record
| Field | Type | Value | Priority | TTL |
|-------|------|-------|----------|-----|
| @ | MX | smtp.google.com | 1 | 60 |

Google simplified to a single MX record in April 2023. Legacy multi-record configs still work but are unnecessary for new domains.

### SPF Record
| Field | Type | Value |
|-------|------|-------|
| @ | TXT | `v=spf1 include:_spf.google.com ~all` |

Rules:
- Only ONE SPF record per domain (multiple = instant fail)
- `~all` = soft fail (recommended by Google), `-all` = hard fail
- Add third-party senders with additional `include:` directives: `v=spf1 include:_spf.google.com include:sendgrid.net ~all`
- Max 10 DNS lookups in the chain or SPF times out and fails

### DKIM Record
| Field | Type | Value |
|-------|------|-------|
| google._domainkey | TXT | `v=DKIM1; k=rsa; p=<public-key>` |

Setup sequence:
1. Google Admin Console > Apps > Google Workspace > Gmail > Authenticate Email
2. Select domain, generate 2048-bit key (selector: `google`)
3. Copy the public key, add as TXT record in DNS
4. Wait for propagation (minutes with 60s TTL)
5. **Return to Admin Console and click "Start Authentication"** — this step is mandatory and frequently missed

### DMARC Record
| Field | Type | Value |
|-------|------|-------|
| _dmarc | TXT | `v=DMARC1; p=none; pct=100; rua=mailto:reports@<domain>` |

Policy rollout:
1. `p=none` for 7-14 days (monitor only, collect reports)
2. `p=quarantine` (failing mail goes to spam)
3. `p=reject` (failing mail bounced — target state)

Prerequisite: SPF and DKIM must be active for 48+ hours before enabling DMARC.

## Common Bounce Errors

| Error | Meaning | Fix |
|-------|---------|-----|
| 550 5.7.26 | SPF or DKIM authentication failed | Check SPF record, activate DKIM in Admin Console |
| 550 5.1.1 | Recipient doesn't exist | User not provisioned in Workspace |
| "Reached a limit" | Sending quota exceeded | Wait 24h; check if account flagged from prior bounces |
| 421 4.7.28 | Too many unauthenticated messages | Fix auth records, wait for rate limit to lift |

## New Domain Reputation

Brand new domains have zero sender reputation. Even with perfect DNS:
- Start with low volume (< 20 emails/day)
- Ramp up gradually over 2-4 weeks
- Monitor DMARC reports for failures
- Avoid bulk/cold outreach until reputation established

## Diagnostics

```bash
# Check all email auth records
dig <domain> MX +short
dig <domain> TXT +short | grep spf
dig google._domainkey.<domain> TXT +short
dig _dmarc.<domain> TXT +short

# Test email headers (send to personal Gmail, view original)
# Look for: SPF=pass, DKIM=pass, DMARC=pass
```
