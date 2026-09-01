#!/usr/bin/env python3
"""yzsgo-e2e 环境自检。探测函数有副作用（读端口/文件），汇总用纯函数 summarize_preflight。
缺项只指路（不替用户做一次性登录/充值），准备步骤见 store-skills 的 setting-up-yzsgo-test-env。"""
import os, shutil, socket, sys

def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        return s.connect_ex(("127.0.0.1", port)) == 0

def probe(env: str = "cn-prod") -> list[dict]:
    return [
        {"name": "chrome-9222", "ok": _port_open(9222),
         "hint": '起调试端口 Chrome：open -na "Google Chrome" --args --remote-debugging-port=9222 '
                 '--user-data-dir=/tmp/yzsgo-chrome https://www.yzsgo.com（手动登测试账号）'},
        {"name": "buildbox-pw", "ok": os.path.exists(os.path.expanduser("~/.buildbox_pw")),
         "hint": "拉 wire 需 buildbox 口令文件 ~/.buildbox_pw（见 setting-up-yzsgo-test-env）"},
        {"name": "sshpass", "ok": shutil.which("sshpass") is not None,
         "hint": "brew install hudochenkov/sshpass/sshpass"},
        {"name": "playwright", "ok": _has_playwright(),
         "hint": "pip install playwright && playwright install chromium"},
    ]

def _has_playwright() -> bool:
    try:
        import playwright  # noqa: F401
        return True
    except Exception:
        return False

def summarize_preflight(checks: list) -> dict:
    ok = all(c["ok"] for c in checks)
    missing = [c["name"] for c in checks if not c["ok"]]
    rows = []
    for c in checks:
        mark = "✅" if c["ok"] else "❌"
        rows.append(f"{mark} {c['name']}" + ("" if c["ok"] else f"\n    → {c['hint']}"))
    return {"ok": ok, "missing": missing, "report": "\n".join(rows)}

if __name__ == "__main__":
    env = sys.argv[1] if len(sys.argv) > 1 else "cn-prod"
    r = summarize_preflight(probe(env))
    print(r["report"])
    sys.exit(0 if r["ok"] else 1)
