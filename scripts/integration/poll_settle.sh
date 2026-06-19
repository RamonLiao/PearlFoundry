#!/bin/bash
RPC=https://fullnode.testnet.sui.io:443
ORACLE=0xd69e473b137334993fb25ed01e229c3f57fa2b9dfca0424593ec743ed65bfbea
for i in $(seq 1 90); do
  S=$(curl -s $RPC -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sui_getObject\",\"params\":[\"$ORACLE\",{\"showContent\":true}]}" | python3 -c 'import json,sys;f=json.load(sys.stdin)["result"]["data"]["content"]["fields"];print(f["settlement_price"] if f["settlement_price"] else "NONE")')
  if [ "$S" != "NONE" ]; then echo "SETTLED price=$S after iter $i"; exit 0; fi
  sleep 60
done
echo "TIMEOUT not settled after 90 min"; exit 1
