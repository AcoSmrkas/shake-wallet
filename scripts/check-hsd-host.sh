#!/usr/bin/env bash
# Verify an hsd host serves everything Shake Wallet and/or Rosen Bridge needs.
# Usage: ./check-hsd-host.sh https://your-host [api-key]
#
# Each check is tagged W (Shake Wallet), R (Rosen Bridge) or WR (both), and the
# two projects are scored separately — a wallet-only host is a pass for W even
# though the R rows fail.
HOST="${1%/}"; KEY="${2:-}"
[ -z "$HOST" ] && { echo "usage: $0 <https://host> [api-key]"; exit 2; }
A=(); [ -n "$KEY" ] && A=(-H "Authorization: Basic $(printf 'x:%s' "$KEY" | base64 | tr -d '\n')")
JSON='Content-Type: application/json'
WP=0; WF=0; RP=0; RF=0

# r <scope> <label> <code>
r(){
  if [ "$3" = 200 ]; then
    echo "PASS  [$1] $2"
    case $1 in *W*) WP=$((WP+1));; esac; case $1 in *R*) RP=$((RP+1));; esac
  else
    echo "FAIL  [$1] $2  ($3)"
    case $1 in *W*) WF=$((WF+1));; esac; case $1 in *R*) RF=$((RF+1));; esac
  fi
}
rpc(){ # scope, method
  body='{"method":"'"$2"'","params":[]}'
  r "$1" "rpc $2" "$(curl -s -o /dev/null -w '%{http_code}' -m 30 -X POST "$HOST" -H "$JSON" "${A[@]}" -d "$body")"
}

rpc WR getblockchaininfo
rpc WR sendrawtransaction
rpc W  estimatesmartfee
rpc W  getnameinfo
rpc W  getnameresource
rpc W  getnamebyhash
rpc W  verifymessage
rpc R  estimatefee
rpc R  getblockhash
rpc R  getblock
rpc R  getrawtransaction
rpc R  gettxout

body='{"method":"getblockchaininfo","params":[]}'
TIP=$(curl -s -m 30 -X POST "$HOST" -H "$JSON" "${A[@]}" -d "$body" | sed -n 's/.*"blocks":\([0-9]*\).*/\1/p')
H=$(( ${TIP:-0} - 10 ))

r W "GET  /header/:height" "$(curl -s -o /dev/null -w '%{http_code}' -m 60 "${A[@]}" "$HOST/header/$H")"
r W "GET  /block/:height"  "$(curl -s -o /dev/null -w '%{http_code}' -m 60 "${A[@]}" "$HOST/block/$H")"

# Sample a real tx + address from a recent block. Prefer the REST route; fall
# back to the getblock RPC so a Rosen-only host (no REST block route) can still
# be scored on its own endpoints.
S=$(curl -s -m 60 "${A[@]}" "$HOST/block/$H" | python3 -c 'import sys,json
t=(json.load(sys.stdin).get("txs") or []); x=t[1] if len(t)>1 else t[0]
print(x["hash"]); print(x["outputs"][0]["address"])' 2>/dev/null)

if [ -z "$S" ]; then
  body='{"method":"getblockhash","params":['"$H"']}'
  BH=$(curl -s -m 30 -X POST "$HOST" -H "$JSON" "${A[@]}" -d "$body" \
       | sed -n 's/.*"result":"\([a-f0-9]*\)".*/\1/p')
  if [ -n "$BH" ]; then
    body='{"method":"getblock","params":["'"$BH"'",true,true]}'
    S=$(curl -s -m 60 -X POST "$HOST" -H "$JSON" "${A[@]}" -d "$body" | python3 -c 'import sys,json
t=((json.load(sys.stdin).get("result") or {}).get("tx") or [])
x=t[1] if len(t)>1 else t[0]
print(x["txid"] if "txid" in x else x["hash"])
print(x["vout"][0]["address"]["string"] if "vout" in x else x["outputs"][0]["address"])' 2>/dev/null)
  fi
fi
TX=$(echo "$S" | sed -n 1p); AD=$(echo "$S" | sed -n 2p)

if [ -z "$TX" ]; then
  r W "GET  /tx/:hash" no-sample; r W "GET  /coin/:hash/:index" no-sample
  r W "POST /tx/address" no-sample; r R "GET  /coin/address/:addr" no-sample
else
  r W "GET  /tx/:hash" "$(curl -s -o /dev/null -w '%{http_code}' -m 60 "${A[@]}" "$HOST/tx/$TX")"

  # A spent output legitimately 404s, so one 404 proves nothing. Try a few
  # outpoints: if every one is refused, the route is blocked, not spent.
  code=404
  for i in 0 1 2; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 60 "${A[@]}" "$HOST/coin/$TX/$i")
    [ "$code" = 200 ] && break
    [ "$code" = 404 ] || break
  done
  r W "GET  /coin/:hash/:index" "$code"

  body='{"addresses":["'"$AD"'"]}'
  r W "POST /tx/address" "$(curl -s -o /dev/null -w '%{http_code}' -m 120 -X POST "$HOST/tx/address" -H "$JSON" "${A[@]}" -d "$body")"
  r R "GET  /coin/address/:addr" "$(curl -s -o /dev/null -w '%{http_code}' -m 60 "${A[@]}" "$HOST/coin/address/$AD")"
fi

# Probe a harmless method NEITHER project needs. If it answers, the RPC root is
# unfiltered and stop/reset/generate/setban are reachable too.
echo
body='{"method":"getpeerinfo","params":[]}'
u=$(curl -s -o /dev/null -w '%{http_code}' -m 20 -X POST "$HOST" -H "$JSON" "${A[@]}" -d "$body")
if [ "$u" = 200 ]; then
  echo "WARN  RPC root is unfiltered - stop/reset/generate/setban are reachable. Allowlist the 12 methods."
else
  echo "OK    method allowlist in place (getpeerinfo refused: $u)"
fi

echo
echo "Shake Wallet:  $WP/$((WP+WF))"
echo "Rosen Bridge:  $RP/$((RP+RF))"
[ "$WF" -eq 0 ] && echo "=> usable as a Shake Wallet default host." \
                || echo "=> NOT usable by Shake Wallet."
