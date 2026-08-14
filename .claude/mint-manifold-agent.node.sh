#!/usr/bin/env bash
# Runs ON the identity-ha node. Reads ACCOUNTS_ADMIN_TOKEN / ACCOUNTS_MINT_TOKEN
# node-local from the accounts pod (never leaves the node). For each id in $IDS:
# create SP -> grant role_manifold_member -> mint mn_live_ key.
#   stdout (fd1, redirected to a 0600 file on the caller): the SECRET line
#       <id>\t<sp_id>\t<grant_id>\t<key_id>\t<prefix>\t<secret>
#   stderr (fd2, visible to caller): NON-SECRET diagnostics only.
set -uo pipefail
: "${ORG:?}"; : "${IDS:?}"
err(){ printf '%s\n' "$*" >&2; }

POD=$(kubectl get pods -n accounts -o name 2>/dev/null | grep -E 'accounts-[0-9a-f]+-' | head -1 | cut -d/ -f2)
PODIP=$(kubectl get pod -n accounts "$POD" -o jsonpath='{.status.podIP}' 2>/dev/null)
ADMIN=$(kubectl exec -n accounts "$POD" -- sh -c 'printf %s "$ACCOUNTS_ADMIN_TOKEN"' 2>/dev/null)
MINT=$(kubectl exec -n accounts "$POD" -- sh -c 'printf %s "$ACCOUNTS_MINT_TOKEN"' 2>/dev/null)
BASE="http://$PODIP:8090"
[[ -n "$PODIP" && -n "$ADMIN" && -n "$MINT" ]] || { err "FATAL: could not resolve pod/tokens (POD=$POD PODIP=$PODIP admin=${#ADMIN} mint=${#MINT})"; exit 1; }
err "accounts base=$BASE org=$ORG"

api(){ # method path token json  -> body on stdout, http code on fd3
  local m="$1" p="$2" tok="$3" body="$4"
  curl -s -w '\n%{http_code}' --max-time 20 -X "$m" \
    -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' \
    ${body:+-d "$body"} "$BASE$p"
}

for id in $IDS; do
  err "── $id ───────────────────────────"
  # 1) service principal (omit created_by; FK-to-app_user like granted_by)
  resp=$(api POST /v0/admin/service-principals "$ADMIN" "{\"org_id\":\"$ORG\",\"name\":\"agent-$id-manifold\"}")
  code=$(tail -1 <<<"$resp"); j=$(sed '$d' <<<"$resp")
  sp=$(jq -r '.sp_id // .id // .service_principal.sp_id // empty' <<<"$j" 2>/dev/null)
  if [[ -z "$sp" ]]; then err "  SP create FAILED http=$code body=$(head -c 300 <<<"$j")"; continue; fi
  err "  SP=$sp (http=$code)"
  # 2) grant role_manifold_member (omit granted_by -> NULL)
  resp=$(api POST /v0/admin/grants "$ADMIN" "{\"org_id\":\"$ORG\",\"subject_kind\":\"service\",\"subject_id\":\"$sp\",\"role_id\":\"role_manifold_member\",\"resource_ref\":\"*\"}")
  code=$(tail -1 <<<"$resp"); j=$(sed '$d' <<<"$resp")
  grant=$(jq -r '.grant_id // .id // empty' <<<"$j" 2>/dev/null)
  if [[ -z "$grant" && "$code" != 2* && "$code" != 409 ]]; then err "  GRANT FAILED http=$code body=$(head -c 300 <<<"$j")"; continue; fi
  err "  GRANT=${grant:-<exists/none>} (http=$code)"
  # 3) mint mn_live_ key
  resp=$(api POST /v0/admin/keys "$MINT" "{\"sp_id\":\"$sp\",\"org_id\":\"$ORG\",\"product\":\"manifold\",\"scopes\":[\"manifold:proxy\",\"manifold:pool:claude-pool\"]}")
  code=$(tail -1 <<<"$resp"); j=$(sed '$d' <<<"$resp")
  key_id=$(jq -r '.key_id // .id // empty' <<<"$j" 2>/dev/null)
  secret=$(jq -r '.secret // .key // .api_key // empty' <<<"$j" 2>/dev/null)
  prefix=$(jq -r '.prefix // empty' <<<"$j" 2>/dev/null)
  if [[ -z "$key_id" || -z "$secret" ]]; then err "  MINT FAILED http=$code body=$(head -c 300 <<<"$j")"; continue; fi
  err "  MINT key_id=$key_id prefix=$prefix secretlen=${#secret} (http=$code)"
  # secret line -> stdout (redirected to 0600 file caller-side; never to fd2)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$sp" "${grant:-}" "$key_id" "$prefix" "$secret"
done
err "done."
