#!/usr/bin/env bash
# 假 gh：给 github-variable-fallback.test.js 钉真实 execFileSync 路径用。
# 行为由变量名决定（argv[2] = repos/.../actions/variables/<NAME>）；每次调用往 $FAKE_GH_CALLS 追加一行。
name="${2##*/}"
[ -n "$FAKE_GH_CALLS" ] && echo "$name $*" >> "$FAKE_GH_CALLS"
case "$name" in
  OK)        echo "value-from-fake-gh"; exit 0 ;;
  NOPE)      echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
  NOAUTH)    echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4 ;;
  FLAKY)     n=$(grep -c "^FLAKY " "$FAKE_GH_CALLS"); if [ "$n" -lt 3 ]; then echo "Get \"https://api.github.com/x\": dial tcp 20.205.243.168:443: i/o timeout" >&2; exit 1; fi; echo "flaky-ok"; exit 0 ;;
  SLOW)      exec sleep 30 ;; # exec：被 SIGTERM 时杀的就是 sleep 本身，不留孤儿
  LEAKY)     echo "authorization: Bearer ghp_secret123 --jq .value" >&2; exit 1 ;;
  *)         echo "unexpected variable $name" >&2; exit 2 ;;
esac
