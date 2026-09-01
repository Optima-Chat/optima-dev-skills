#!/usr/bin/env python3
"""yzsgo-e2e 编排：驱动对话 → 拉 wire → 定位本次对话 → 备料（含浏览器证据）→ 出备料稿+元数据。
judge 由 Claude 用 judge_workflow.js 跑；提 issue 由 Claude 依 SKILL.md 用 gh 做。用户不敲本脚本。"""
import argparse, json, os, sys
from datetime import datetime, timezone

def render_report(result: dict) -> str:
    L = [f"# yzsgo-e2e 报告 · {result['env']} · {result['started_ts']}", ""]
    if result.get("blocked"):
        L.append(f"> ⚠️ blocked: {result['blocked']}（环境问题，非缺陷，未提 issue）")
        L.append("")
    L += ["## 本次端到端问题（按严重度）", "", "| 状态 | 问题 | 证据 |", "|---|---|---|"]
    for f in result.get("confirmed", []):
        L.append(f"| confirmed | {f['what']} | {f['evidence']} |")
    for f in result.get("needs_review", []):
        L.append(f"| needs_review | {f['what']} | {f['evidence']} |")
    if not result.get("confirmed") and not result.get("needs_review"):
        L.append("| — | 无 confirmed/needs_review | — |")
    L += ["", "## 覆盖边界", result.get("coverage", "-"),
          "", "## 判断修正", "（如判定过程中修正过结论，如实记此；无则写'无'）"]
    return "\n".join(L)

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _read_user_from_token(path: str = None) -> str:
    path = path or os.path.expanduser("~/.optima/token.json")
    try:
        d = json.load(open(path))
        return (d.get("user") or {}).get("userId")
    except Exception:
        return None

def _parse_answers(pairs):
    out = []
    for p in pairs or []:
        if "=" in p:
            k, v = p.split("=", 1)
            out.append({"match": k, "answer": v})
        else:
            print(f"[warn] 忽略格式不对的 --answer {p!r}（应为 关键词=答案）", file=sys.stderr)
    return out

def select_conversation_in_session(convs, deref, hit):
    """在同一 session 的 convs 里按 (ts, prompt) 重新定位本次对话；找不到回退末个。
    不能用跨 session 的全局 gidx 去索引 session-local 列表。"""
    import pull_wire
    for c in convs:
        if not c:
            continue
        if c[0].get("ts", "") == hit.get("ts") and pull_wire.first_user_text(c[0], deref) == hit.get("prompt"):
            return c
    return convs[-1] if convs else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", default="cn-prod", choices=["cn-prod", "cn-stage"])
    ap.add_argument("--message", action="append", required=True, help="逐轮发送的消息（可多次）")
    ap.add_argument("--answer", action="append", help="反问预设答案 关键词=答案（可多次）")
    ap.add_argument("--expect", default="", help="关注点，喂给判定层")
    ap.add_argument("--user", default=None,
                    help="测试账号 userId（拉 wire 用）；不给则从 ~/.optima/token.json 自动读")
    ap.add_argument("--out", default="e2e-out")
    ap.add_argument("--timeout", type=int, default=180,
                    help="每轮等回复超时秒；长任务（简报/多工具）调大到 500+")
    ap.add_argument("--since", type=int, default=1, help="拉 wire 的天数窗口（默认 1）")
    ap.add_argument("--issue-repo", default="Optima-Chat/optima-gateway")
    args = ap.parse_args()

    if not args.user:
        args.user = _read_user_from_token()
    if not args.user:
        print("[error] 没给 --user 且 ~/.optima/token.json 读不到 userId；先登录 Optima 或显式传 --user。",
              file=sys.stderr)
        sys.exit(2)

    if args.env == "cn-stage":
        print("[warn] cn-stage 的 wire 取法未验证（spec §8 待核实）；仅 cn-prod 全链路已打通。", file=sys.stderr)

    os.makedirs(args.out, exist_ok=True)
    import preflight, chat_driver, pull_wire, prep_conversation
    pf = preflight.summarize_preflight(preflight.probe(args.env))
    if not pf["ok"]:
        print(pf["report"]); print("\n[preflight 未通过，先按提示准备环境]"); sys.exit(2)

    started_ts = _utc_now()
    answers = _parse_answers(args.answer)
    d = chat_driver.ChatDriver().attach()
    try:
        d.new_conversation()
        turns = []
        for msg in args.message:
            r = d.send_and_wait(msg, answers=answers, timeout=args.timeout)
            turns.append({"sent": msg, "state": r.get("state"), "transcript": r.get("transcript", ""),
                          "tool_trace": r.get("tool_trace"), "timed_out": r.get("timed_out", False)})
    finally:
        d.close()

    wire_root = pull_wire.pull(args.user, since_days=args.since, out=args.out)
    meta = {"env": args.env, "started_ts": started_ts, "first_message": args.message[0],
            "expect": args.expect, "issue_repo": args.issue_repo, "turns": turns,
            "located": None, "located_reason": None}
    wrote_prepped = False
    if not wire_root:
        meta["located_reason"] = "no_wire_session"
    if wire_root:
        index = pull_wire.emit_conversation_index(wire_root)
        hit = pull_wire.locate_conversation(index, started_ts, args.message[0])
        meta["located"] = hit
        if hit:
            sdir = os.path.join(wire_root, hit["sid"])
            deref = pull_wire.make_deref(sdir)
            with open(os.path.join(sdir, "records.jsonl"), encoding="utf-8") as f:
                recs = [json.loads(l) for l in f if l.strip()]
            reqs = [x for x in recs if x.get("kind") == "request"]
            resps = {x.get("callId"): x for x in recs if x.get("kind") in ("response", "error")}
            convs = pull_wire.segment(reqs, deref)
            conv = select_conversation_in_session(convs, deref, hit)
            if conv is not None:
                _, _, _, _, wire_md = pull_wire.render_conversation(conv, resps, deref, hit["gidx"])
                prepped = prep_conversation.merge_browser_evidence(wire_md, turns)
                with open(os.path.join(args.out, "prepped.md"), "w", encoding="utf-8") as f:
                    f.write(prepped)
                wrote_prepped = True
        else:
            meta["located_reason"] = "no_match"
    with open(os.path.join(args.out, "meta.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(meta, ensure_ascii=False, indent=2))
    if wrote_prepped:
        print(f"[done] 备料稿 → {args.out}/prepped.md  元数据 → {args.out}/meta.json")
        print("下一步：Claude 用 judge_workflow.js 判定，confirmed 提 issue 到", args.issue_repo)
    else:
        reason = "未拉到本账号 wire session（TTL/该窗口没跑过）" if not wire_root else "未能在 wire 里定位到本次对话（ts/prompt 未匹配）"
        print(f"[warn] 只写了 {args.out}/meta.json，未生成 prepped.md：{reason}")
        print("       检查测试账号 userId / --since 窗口 / 前端是否真落 wire。")

if __name__ == "__main__":
    main()
