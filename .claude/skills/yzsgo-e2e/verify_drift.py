#!/usr/bin/env python3
"""比对 vendored 文件与上游是否漂移。上游 repo 不在本机则跳过（不破坏自包含）。"""
import os, subprocess

VENDORED = [
    {"file": "chat_driver.py", "repo": "store-skills",
     "upstream": "~/optima-store-skills/.claude/skills/operating-yzsgo-chat/chat_driver.py"},
    {"file": "pull_wire.py", "repo": "store-skills",
     "upstream": "~/optima-store-skills/.claude/skills/pulling-yzsgo-session-wire/pull_wire.py"},
    {"file": "prep_conversation.py", "repo": "gateway",
     "upstream": "~/optima-gateway/.claude/skills/conversation-iq/prep_session.py"},
    {"file": "judge_workflow.js", "repo": "gateway",
     "upstream": "~/optima-gateway/.claude/skills/conversation-iq/workflow.js"},
]

def plan_drift_checks(present: dict) -> list:
    out = []
    for v in VENDORED:
        out.append({"file": v["file"], "upstream": v["upstream"],
                    "checkable": bool(present.get(v["repo"], False))})
    return out

def _present() -> dict:
    return {"store-skills": os.path.isdir(os.path.expanduser("~/optima-store-skills")),
            "gateway": os.path.isdir(os.path.expanduser("~/optima-gateway"))}

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    for c in plan_drift_checks(_present()):
        if not c["checkable"]:
            print(f"⏭  {c['file']}：上游不在本机，跳过"); continue
        up = os.path.expanduser(c["upstream"])
        r = subprocess.run(["diff", "-q", os.path.join(here, c["file"]), up], capture_output=True, text=True)
        print(("✅ " if r.returncode == 0 else "⚠️  漂移 ") + f"{c['file']} vs {c['upstream']}")
