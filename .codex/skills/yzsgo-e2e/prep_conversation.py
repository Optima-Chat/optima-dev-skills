#!/usr/bin/env python3
"""yzsgo-e2e 备料层：wire 侧备料稿（复用 pull_wire.render_conversation）+ 合并浏览器侧证据。
改编自 optima-gateway conversation-iq/prep_session.py（备料思路）与 pull_wire（渲染）。见 SYNC.md。"""
import json

def merge_browser_evidence(wire_md: str, browser_turns: list) -> str:
    lines = [wire_md.rstrip(), "",
             "## 前端所见（浏览器侧证据；与上面 wire 对照）",
             "> 判定要求：逐轮核对**前端渲染的**与**wire 里 agent 真实产出的**是否一致——"
             "前端丢内容/半截/报错但 wire 成功（或反之）即为缺陷。", ""]
    for i, t in enumerate(browser_turns):
        lines.append(f"### 轮 #{i}  发送: {t.get('sent','')!r}")
        lines.append(f"- state: {t.get('state','')}  timed_out: {t.get('timed_out', False)}")
        tt = t.get("tool_trace")
        if tt:
            lines.append(f"- tool_trace: {json.dumps(tt, ensure_ascii=False)[:1500]}")
        lines.append("- 前端整轮渲染:")
        lines.append("```")
        lines.append((t.get("transcript") or "(空)")[:6000])
        lines.append("```")
    return "\n".join(lines)
