#!/usr/bin/env python3
"""比对 vendored 文件与上游是否漂移。上游 repo 不在本机则跳过（不破坏自包含）。"""
import os, subprocess

# adapted=True 的文件在上游基础上有本地改动/追加，diff 必然 ≠0 → ⚠️ 是「去看上游有无新变更」而非缺陷；
# adapted=False 是逐字 vendored，应与上游一致，⚠️ 才是真漂移。
VENDORED = [
    {"file": "chat_driver.py", "repo": "store-skills", "adapted": False,
     "upstream": "~/optima-store-skills/.claude/skills/operating-yzsgo-chat/chat_driver.py"},
    {"file": "pull_wire.py", "repo": "store-skills", "adapted": True,   # 追加了 emit_conversation_index/locate_conversation
     "upstream": "~/optima-store-skills/.claude/skills/pulling-yzsgo-session-wire/pull_wire.py"},
    {"file": "prep_conversation.py", "repo": "gateway", "adapted": True,
     "upstream": "~/optima-gateway/.claude/skills/conversation-iq/prep_session.py"},
    {"file": "judge_workflow.js", "repo": "gateway", "adapted": True,
     "upstream": "~/optima-gateway/.claude/skills/conversation-iq/workflow.js"},
]

def plan_drift_checks(present: dict) -> list:
    out = []
    for v in VENDORED:
        out.append({"file": v["file"], "upstream": v["upstream"],
                    "adapted": v.get("adapted", False),
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
        if r.returncode == 0:
            print(f"✅ {c['file']} 与上游一致")
        elif c.get("adapted"):
            print(f"⚠️(改编·预期) {c['file']}：与上游有差异属正常，去看上游有无值得同步的新变更")
        else:
            print(f"⚠️ 漂移 {c['file']} vs {c['upstream']}（逐字 vendored，应一致 → 去同步）")
