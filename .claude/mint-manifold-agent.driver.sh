#!/usr/bin/env bash
# VPS-side driver. Runs the node minter over ssh, captures the secret lines to a
# 0600 tempfile (never to visible stdout), then writes each agent's bao leaf +
# 0600 custody file + ledger row. Secret is injected via jq --arg (never argv,
# never echoed). Env: IDS (space-sep identities), ORG, NODE (ssh target).
set -uo pipefail
umask 077
: "${IDS:?}"
ORG="${ORG:-org_019f350a-e456-7d5f-8426-38efe20490f0}"
NODE="${NODE:-root@100.126.130.105}"
LEDGER=/data/projects/gascity-packs/.claude/manifold-agent-keys.ledger.tsv
CUSTODY_DIR=/home/ubuntu/.config/gascity/openbao
SCRIPT="$(dirname "$0")/mint-manifold-agent.node.sh"
set -a; . /home/ubuntu/.config/gascity/openbao/session.env; set +a
: "${BAO_ADDR:?}" "${BAO_TOKEN:?}"

TMPF=$(mktemp); chmod 600 "$TMPF"
trap 'shred -u "$TMPF" 2>/dev/null || rm -f "$TMPF"' EXIT

echo ">> minting on node: IDS=[$IDS]"
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$NODE" "IDS='$IDS' ORG='$ORG' bash -s" < "$SCRIPT" > "$TMPF"
echo ">> node returned $(wc -l < "$TMPF") secret line(s)"

issued_at=$(date -u +%FT%TZ)
ok=0
while IFS=$'\t' read -r id sp grant key_id prefix secret; do
  [[ -n "${id:-}" && -n "${secret:-}" ]] || { echo "  !! skip malformed line for '${id:-?}'"; continue; }
  leaf=$(jq -cn --arg api_key "$secret" --arg identity_id "$id" \
     --arg issued_for "per-agent-attribution" --arg key_id "$key_id" \
     --arg pool "claude-pool" --arg prefix "$prefix" --arg product "manifold" \
     --arg scopes "manifold:proxy,manifold:pool:claude-pool" --arg sp_id "$sp" \
     '{api_key:$api_key,identity_id:$identity_id,issued_for:$issued_for,key_id:$key_id,pool:$pool,prefix:$prefix,product:$product,scopes:$scopes,sp_id:$sp_id}')
  # bao write (body via stdin, secret never in argv)
  code=$(printf '{"data":%s}' "$leaf" | curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
      -X PUT -H "X-Vault-Token: $BAO_TOKEN" -H "X-Vault-Namespace: internal" \
      -H 'Content-Type: application/json' --data-binary @- \
      "$BAO_ADDR/v1/kv/data/gas-city-inc/agents/$id/manifold")
  # custody 0600
  printf '%s' "$leaf" | jq . > "$CUSTODY_DIR/$id.manifold.secret.json"
  chmod 600 "$CUSTODY_DIR/$id.manifold.secret.json"
  # ledger (idempotent)
  if ! grep -q "^$id	" "$LEDGER" 2>/dev/null; then
    printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$sp" "$key_id" "$prefix" "$issued_at" >> "$LEDGER"
  fi
  echo "  ✓ $id  key_id=$key_id  bao=$code  custody+ledger written"
  ok=$((ok+1))
done < "$TMPF"
echo ">> completed $ok agent(s)"
