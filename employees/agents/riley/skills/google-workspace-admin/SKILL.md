---
name: google-workspace-admin
description: "Google Workspace administration — email setup, DNS configuration (MX/SPF/DKIM/DMARC), user provisioning, GAM CLI automation, and email deliverability troubleshooting. Use when: (1) setting up or troubleshooting Google Workspace email, (2) configuring DNS records for email authentication, (3) provisioning or managing Workspace users/groups, (4) diagnosing email bounce errors or deliverability issues, (5) automating Workspace admin tasks via GAM CLI, (6) managing Vercel DNS records for email."
---

# Google Workspace Administration

## Diagnostic Workflow

When troubleshooting email issues, start here:

1. Run `scripts/dns-check.sh <domain>` to check all email auth DNS records
2. Interpret results against [references/email-auth.md](references/email-auth.md) for required values and common errors
3. If DNS is correct but email still fails, check Google Admin Console:
   - DKIM activation status (must click "Start Authentication")
   - Account suspension or rate limiting
   - Subscription/billing status

## Email Setup Checklist (New Domain)

1. **MX** — Add `smtp.google.com` at priority 1
2. **SPF** — Add TXT: `v=spf1 include:_spf.google.com ~all`
3. **DKIM** — Generate key in Admin Console, add TXT record, **activate**
4. **DMARC** — Add TXT at `_dmarc`: `v=DMARC1; p=none; rua=mailto:reports@<domain>`
5. **Verify** — Send test email, check headers for SPF=pass, DKIM=pass, DMARC=pass
6. **Ramp** — Start with low volume, escalate DMARC to `p=reject` after 2 weeks

For record formats, common errors, and bounce code meanings: [references/email-auth.md](references/email-auth.md)

## GAM CLI

GAM is the standard CLI for Workspace administration — users, groups, DKIM, aliases, reports.

Install: `bash <(curl -s -S -L https://raw.githubusercontent.com/taers232c/GAMADV-XTD3/master/src/gam-install.sh)`

For setup flow and command reference: [references/gam-cli.md](references/gam-cli.md)

Key commands:
- `gam create dkimkey <domain>` + `gam update dkimkey <domain> activate`
- `gam create user <email> firstname <F> lastname <L>`
- `gam print users` / `gam info user <email>`

## Vercel DNS Management

For CLI commands, REST API payloads, and TTL management: [references/vercel-dns.md](references/vercel-dns.md)

Key: Use `vercel dns ls <domain>` to audit current records, `vercel dns add` to provision, `vercel dns rm <id>` to clean up.

## Gas City Context

- **Primary domain:** gascity.ai (Vercel DNS: ns1/ns2.vercel-dns.com)
- **Secondary domain:** gascityhall.com (CloudFlare DNS)
- **Workspace plan:** $27/mo Google Workspace
- **DNS provider for email:** Vercel (gascity.ai)
