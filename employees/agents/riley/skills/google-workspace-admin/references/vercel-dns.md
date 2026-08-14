# Vercel DNS Management Reference

## CLI Commands

```bash
# List all DNS records for a domain
vercel dns ls gascity.ai --token $VERCEL_TOKEN --scope $TEAM_ID

# Add records
vercel dns add gascity.ai '@' MX smtp.google.com 1 --token $VERCEL_TOKEN --scope $TEAM_ID
vercel dns add gascity.ai '@' TXT "v=spf1 include:_spf.google.com ~all" --token $VERCEL_TOKEN --scope $TEAM_ID
vercel dns add gascity.ai google._domainkey TXT "v=DKIM1; k=rsa; p=<key>" --token $VERCEL_TOKEN --scope $TEAM_ID
vercel dns add gascity.ai _dmarc TXT "v=DMARC1; p=none; pct=100; rua=mailto:reports@gascity.ai" --token $VERCEL_TOKEN --scope $TEAM_ID

# Remove a record by ID
vercel dns rm <record-id> --token $VERCEL_TOKEN --scope $TEAM_ID

# Import a BIND zonefile
vercel dns import gascity.ai ./zonefile.txt --token $VERCEL_TOKEN --scope $TEAM_ID
```

## REST API

Endpoint: `https://api.vercel.com/v2/domains/{domain}/records`

Auth: `Authorization: Bearer <TOKEN>` header. Include `teamId` query param for team-owned domains.

### Create record (POST)
```json
{
  "type": "MX",
  "name": "",
  "value": "smtp.google.com",
  "mxPriority": 1,
  "ttl": 60
}
```

Note: `name` is empty string `""` for apex domain (not `@` like the CLI).

### Response codes
| Code | Meaning |
|------|---------|
| 200 | Success (returns `uid` of new record) |
| 400 | Invalid payload (missing mxPriority for MX, bad format) |
| 401 | Bad or expired token |
| 403 | Token lacks permissions for this domain/team |
| 409 | Duplicate record already exists |

### Rate limits
Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. HTTP 429 on exceeded.

## TTL Notes

- Default: 60 seconds (good for initial setup/debugging)
- Max: 86400 seconds (24 hours)
- Keep at 60 during setup, increase once stable
