#!/usr/bin/env python3
"""yzsgo-e2e 环境体检（医生）。诊断每项依赖，分两类：
- auto：可由 bootstrap.py 在**征得用户同意后**自动装（托管 venv+playwright、sshpass）；
- manual：凭据/登录类，装不了、只能引导（buildbox 口令、登了测试账号的调试 Chrome、userId）。
本脚本只诊断、不装东西。装由 bootstrap.py 做（同意由 SKILL.md/Claude 负责问）。"""
import json, os, shutil, socket, subprocess, sys

VENV = os.path.expanduser("~/.cache/yzsgo-e2e/venv")


def venv_python(base: str = VENV) -> str:
    return os.path.join(base, "bin", "python")


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _venv_has_playwright() -> bool:
    py = venv_python()
    if not os.path.exists(py):
        return False
    return subprocess.run([py, "-c", "import playwright"], capture_output=True).returncode == 0


def _token_user() -> str | None:
    try:
        d = json.load(open(os.path.expanduser("~/.optima/token.json")))
        return (d.get("user") or {}).get("userId")
    except Exception:
        return None


def probe(env: str = "cn-prod") -> list:
    return [
        {"name": "venv+playwright", "ok": _venv_has_playwright(), "category": "auto",
         "fix": "python3 bootstrap.py setup   # 建托管 venv(~/.cache/yzsgo-e2e/venv) + 装 playwright/chromium"},
        {"name": "sshpass", "ok": shutil.which("sshpass") is not None, "category": "auto",
         "fix": "python3 bootstrap.py install-sshpass   # 或 brew install hudochenkov/sshpass/sshpass"},
        {"name": "chrome-9222", "ok": _port_open(9222), "category": "manual",
         "fix": "python3 bootstrap.py launch-chrome，然后在弹出的 Chrome 里手动登录测试账号"},
        {"name": "buildbox-pw", "ok": os.path.exists(os.path.expanduser("~/.buildbox_pw")), "category": "manual",
         "fix": "把 buildbox 口令写进 ~/.buildbox_pw（内部拉 wire 用；向团队要）"},
        {"name": "test-user-id", "ok": _token_user() is not None, "category": "manual",
         "fix": "登录 Optima 生成 ~/.optima/token.json（run_e2e 会自动读 user.userId）"},
    ]


def summarize_preflight(checks: list) -> dict:
    ok = all(c["ok"] for c in checks)
    missing = [{"name": c["name"], "category": c["category"], "fix": c["fix"]}
               for c in checks if not c["ok"]]
    rows = []
    for c in checks:
        mark = "✅" if c["ok"] else ("🅰️ ❌" if c["category"] == "auto" else "✋ ❌")
        rows.append(f"{mark} {c['name']}" + ("" if c["ok"] else f"\n    → {c['fix']}"))
    return {"ok": ok, "missing": missing, "report": "\n".join(rows)}


if __name__ == "__main__":
    env = sys.argv[1] if len(sys.argv) > 1 else "cn-prod"
    r = summarize_preflight(probe(env))
    print(r["report"])
    if not r["ok"]:
        auto = [m["name"] for m in r["missing"] if m["category"] == "auto"]
        man = [m["name"] for m in r["missing"] if m["category"] == "manual"]
        print()
        if auto:
            print(f"🅰️  可自动装（Claude 会先征得你同意再跑 bootstrap）：{', '.join(auto)}")
        if man:
            print(f"✋  需你人工准备（凭据/登录，装不了）：{', '.join(man)}")
    sys.exit(0 if r["ok"] else 1)
