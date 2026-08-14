#!/usr/bin/env bash
# DNS email authentication checker for a domain
# Usage: dns-check.sh <domain>

DOMAIN="${1:?Usage: dns-check.sh <domain>}"

echo "=== DNS Email Auth Check: $DOMAIN ==="
echo ""

echo "--- Nameservers ---"
dig "$DOMAIN" NS +short
echo ""

echo "--- MX Records ---"
MX=$(dig "$DOMAIN" MX +short)
if [ -z "$MX" ]; then
  echo "MISSING: No MX records found"
else
  echo "$MX"
fi
echo ""

echo "--- SPF (TXT) ---"
SPF=$(dig "$DOMAIN" TXT +short | grep "v=spf1")
if [ -z "$SPF" ]; then
  echo "MISSING: No SPF record found"
else
  echo "$SPF"
fi
echo ""

echo "--- DKIM (google._domainkey) ---"
DKIM=$(dig "google._domainkey.$DOMAIN" TXT +short)
if [ -z "$DKIM" ]; then
  echo "MISSING: No DKIM record at google._domainkey.$DOMAIN"
else
  echo "$DKIM"
fi
echo ""

echo "--- DMARC ---"
DMARC=$(dig "_dmarc.$DOMAIN" TXT +short)
if [ -z "$DMARC" ]; then
  echo "MISSING: No DMARC record found"
else
  echo "$DMARC"
fi
echo ""

echo "--- Summary ---"
ISSUES=0
[ -z "$MX" ] && echo "FIX: Add MX record pointing to smtp.google.com" && ISSUES=$((ISSUES+1))
[ -z "$SPF" ] && echo "FIX: Add SPF TXT record: v=spf1 include:_spf.google.com ~all" && ISSUES=$((ISSUES+1))
[ -z "$DKIM" ] && echo "FIX: Generate DKIM key in Google Admin Console and add TXT record" && ISSUES=$((ISSUES+1))
[ -z "$DMARC" ] && echo "FIX: Add DMARC TXT record at _dmarc subdomain" && ISSUES=$((ISSUES+1))
[ $ISSUES -eq 0 ] && echo "All DNS records present. Verify DKIM is activated in Google Admin Console."
