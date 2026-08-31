#!/usr/bin/env python3
"""拉取 + 渲染 yzsgo 会话的 Wire（Optima Gateway #2261 落盘的完整 LLM 上下文）。

Wire = 每个 runtime session 的完整 LLM 调用记录，存境内 buildbox 的 NAS：
  /mnt/nas-cn-prod/workspaces/cn-prod/<userId>/.agent/llm-wire/<sessionId>/
    records.jsonl   —— 每行一条 {kind:request/response/error, callId, seq, ts, body{system,tools,messages}, finalMessage...}
    blobs/          —— 大内容按 {"$blob": "<hash>"} 引用，deref 时读这里
TTL 14 天。经 buildbox（47.94.105.163，口令 ~/.buildbox_pw）拉。

⚠️ warm-pool 会把**同一账号顺序跑的多个 web 对话聚在一个 runtime session** 里 —— 一个
records.jsonl 常含几十个对话。切分靠 seq 复位：agent 每轮 req 的 messages 递增(2,4,6…)、
seq 递增(1,3,5…)，**seq==1（msgs==2）= 新对话开始**。本脚本据此切分，每个对话取「末 req 的
全历史 + 末 response」= 该对话的完整 transcript（含推理/工具调用/工具结果/最终回复）。

用法：
  # 拉 + 渲染（默认测试账号，近 1 天）
  pull_wire.py --user <userId> --since 1 --out e2e/wire
  # 已拉过、只重渲染本地数据（迭代用，不再 SSH）
  pull_wire.py --local e2e/wire/raw/llm-wire --out e2e/wire

参考 optima-gateway 的 conversation-iq/prep_session.py（同一 Wire 数据源）。
"""
import argparse
import json
import os
import subprocess
import sys

BUILDBOX = os.environ.get("OPTIMA_BUILDBOX_HOST", "root@47.94.105.163")
PW_FILE = os.path.expanduser(os.environ.get("OPTIMA_BUILDBOX_PW", "~/.buildbox_pw"))
NAS = os.environ.get("OPTIMA_NAS_CN", "/mnt/nas-cn-prod/workspaces/cn-prod")


def ssh(cmd):
    return subprocess.run(
        ["sshpass", "-f", PW_FILE, "ssh", "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=25", BUILDBOX, cmd],
        capture_output=True, text=True)


def pull(user, since_days, out):
    """SSH buildbox：打包该 user 近 since_days 天有更新的 wire session，scp 回 out/raw/。"""
    raw = os.path.join(out, "raw")
    os.makedirs(raw, exist_ok=True)
    base = f"{NAS}/{user}/.agent/llm-wire"
    # 只打包近 since_days 天有更新的 session（records.jsonl mtime）
    remote_tar = "/tmp/optima_wire_pull.tgz"
    pack = (f"cd {NAS}/{user}/.agent 2>/dev/null && "
            f"sids=$(find {base}/*/records.jsonl -mtime -{since_days} 2>/dev/null "
            f"| sed 's#/records.jsonl##' | sed 's#.*/##') && "
            f"[ -z \"$sids\" ] && echo NO_SESSIONS && exit 0; "
            f"tar czf {remote_tar} $(for s in $sids; do echo llm-wire/$s; done) && "
            f"echo PACKED $(echo \"$sids\" | wc -w)")
    r = ssh(pack)
    if "NO_SESSIONS" in r.stdout:
        print(f"[pull] {user} 近 {since_days} 天无 wire session（TTL 14 天，或该账号没跑过）")
        return None
    if "PACKED" not in r.stdout:
        print("[pull] 打包失败：", r.stdout, r.stderr, file=sys.stderr)
        return None
    print(f"[pull] 远端打包 {r.stdout.strip().splitlines()[-1]} session")
    local_tar = os.path.join(raw, "wire.tgz")
    subprocess.run(["sshpass", "-f", PW_FILE, "scp", "-o", "StrictHostKeyChecking=no",
                    f"{BUILDBOX}:{remote_tar}", local_tar], check=True)
    subprocess.run(["tar", "xzf", local_tar, "-C", raw], check=True)
    ssh(f"rm -f {remote_tar}")
    return os.path.join(raw, "llm-wire")


# ── 渲染（源自 conversation-iq/prep_session.py，扩展为「一个 session 切多个对话」）──

def make_deref(session_dir):
    def deref(v):
        if isinstance(v, dict) and "$blob" in v:
            try:
                return json.load(open(os.path.join(session_dir, "blobs", v["$blob"])))
            except Exception:
                return v
        return v
    return deref


def first_user_text(req, deref):
    for m in (deref(req.get("body", {}).get("messages")) or []):
        m = deref(m)
        if m.get("role") == "user":
            c = m.get("content")
            if isinstance(c, str):
                return c
            if isinstance(c, list):
                for b in c:
                    b = deref(b)
                    if isinstance(b, dict) and b.get("type") == "text":
                        return b.get("text", "")
    return "(无 user 消息)"


# 渲染截断上限（审查要逐格核数字 → tool_result 尽量全；截断处标真实长度，别让审查以为"就这些"）
CAP_TEXT = 6000
CAP_THINK = 3000
CAP_TOOL_IN = 6000
CAP_TOOL_OUT = 16000


def _clip(s, cap):
    s = str(s)
    return s if len(s) <= cap else s[:cap] + f" …[截断，共 {len(s)} 字]"


def render_block(b, deref):
    b = deref(b)
    if not isinstance(b, dict):
        return "    " + _clip(b, CAP_TOOL_OUT)
    t = b.get("type")
    if t == "text":
        return "    [text] " + _clip(b.get("text") or "", CAP_TEXT)
    if t == "thinking":
        return "    [thinking] " + _clip(b.get("thinking") or "", CAP_THINK)
    if t == "tool_use":
        return f"    [tool_use {b.get('name')}] " + _clip(json.dumps(deref(b.get("input")), ensure_ascii=False), CAP_TOOL_IN)
    if t == "tool_result":
        c = deref(b.get("content"))
        if isinstance(c, list):
            c = " ".join(json.dumps(deref(x), ensure_ascii=False) for x in c)
        return f"    [tool_result err={b.get('is_error')}] " + _clip(c, CAP_TOOL_OUT)
    if t == "image":
        return "    [image]"
    return "    [?] " + _clip(json.dumps(b, ensure_ascii=False), CAP_TOOL_OUT)


def segment(reqs, deref):
    """按 seq==1（新对话起点）把 requests 切成多段对话。返回 [[req,...], ...]（各段按 ts 有序）。"""
    reqs = sorted(reqs, key=lambda r: r.get("ts", ""))
    convs, cur = [], []
    for r in reqs:
        if r.get("seq", 1) == 1 and cur:
            convs.append(cur)
            cur = []
        cur.append(r)
    if cur:
        convs.append(cur)
    return convs


def render_conversation(conv, resps, deref, idx):
    """一个对话 = 一串 req（末 req 含全历史）。渲染事实卡 + 完整 transcript。"""
    last = conv[-1]
    prompt = first_user_text(conv[0], deref)
    ts0 = conv[0].get("ts", "")
    # 事实卡
    n_turns = len(conv)
    errs = [resps.get(r["callId"]) for r in conv
            if resps.get(r["callId"]) and resps[r["callId"]].get("kind") == "error"]
    maxtok = sum(1 for r in conv
                 if (resps.get(r["callId"]) or {}).get("kind") == "response"
                 and ((resps[r["callId"]].get("finalMessage") or {}).get("stopReason") == "max_tokens"))
    # 悬空 tool_use（末 req 全历史）
    msgs = [deref(m) for m in (deref(last["body"].get("messages")) or [])]
    use_ids, res_ids = {}, set()
    for m in msgs:
        c = m.get("content")
        if isinstance(c, list):
            for b in c:
                b = deref(b)
                if isinstance(b, dict):
                    if b.get("type") == "tool_use":
                        use_ids[b.get("id")] = b.get("name")
                    if b.get("type") == "tool_result":
                        res_ids.add(b.get("tool_use_id"))
    dangling = [(u, n) for u, n in use_ids.items() if u not in res_ids]

    L = [f"# 对话 #{idx}  {ts0}",
         "", f"**prompt**: {prompt[:200]}", "",
         "## 事实卡（代码算的确定信息）",
         f"- LLM 轮数(req) {n_turns}",
         f"- error 响应 {len(errs)}" + (f"：{[json.dumps(deref(e.get('error') or {}),ensure_ascii=False)[:120] for e in errs]}" if errs else ""),
         f"- stop_reason=max_tokens 的响应 {maxtok}",
         f"- 悬空 tool_use（无匹配 result）{len(dangling)}: {dangling[:5]}",
         "", "## 完整 transcript（末 req 全历史 + 末 response）", ""]
    # 末 response 拼到历史尾
    lastresp = resps.get(last["callId"])
    if lastresp and lastresp.get("kind") == "response":
        fm = lastresp.get("finalMessage") or {}
        msgs.append({"role": "assistant", "content": fm.get("content", [])})
    for i, m in enumerate(msgs):
        role = m.get("role")
        c = m.get("content")
        L.append(f"\n--- #{i} [{role}] ---")
        if isinstance(c, str):
            L.append("    " + _clip(c, CAP_TEXT))
        elif isinstance(c, list):
            for b in c:
                L.append(render_block(b, deref))
    return prompt, ts0, len(errs), len(dangling), "\n".join(L)


def render_all(wire_root, out):
    conv_dir = os.path.join(out, "conversations")
    os.makedirs(conv_dir, exist_ok=True)
    index = ["# Wire 会话索引", ""]
    sessions = sorted(d for d in os.listdir(wire_root)
                      if os.path.isdir(os.path.join(wire_root, d)))
    gidx = 0
    for sid in sessions:
        sdir = os.path.join(wire_root, sid)
        recf = os.path.join(sdir, "records.jsonl")
        if not os.path.exists(recf):
            continue
        deref = make_deref(sdir)
        recs = [json.loads(l) for l in open(recf, encoding="utf-8") if l.strip()]
        reqs = [r for r in recs if r.get("kind") == "request"]
        resps = {r.get("callId"): r for r in recs if r.get("kind") in ("response", "error")}
        convs = segment(reqs, deref)
        index.append(f"\n## session `{sid}` — {len(convs)} 对话 / {len(reqs)} req\n")
        for conv in convs:
            gidx += 1
            prompt, ts0, n_err, n_dang, md = render_conversation(conv, resps, deref, gidx)
            fn = f"{gidx:03d}.md"
            open(os.path.join(conv_dir, fn), "w", encoding="utf-8").write(md)
            flag = (" ⚠️err" if n_err else "") + (" ⚠️dangling" if n_dang else "")
            index.append(f"- [{fn}](conversations/{fn}) [{len(conv):>2} req] {prompt[:64]}{flag}")
    idxpath = os.path.join(out, "index.md")
    open(idxpath, "w", encoding="utf-8").write("\n".join(index))
    print(f"[render] {gidx} 个对话 → {conv_dir}/  索引 → {idxpath}")
    return idxpath


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", help="userId（拉该账号的 wire）")
    ap.add_argument("--since", type=int, default=1, help="拉近 N 天有更新的 session（默认 1）")
    ap.add_argument("--out", default="e2e/wire", help="输出目录（默认 e2e/wire）")
    ap.add_argument("--local", help="跳过 SSH，直接渲染这个本地 llm-wire 目录（迭代用）")
    a = ap.parse_args()

    if a.local:
        render_all(a.local, a.out)
        return
    if not a.user:
        ap.error("需 --user <userId>（或 --local <dir> 只渲染已拉数据）")
    wire_root = pull(a.user, a.since, a.out)
    if wire_root:
        render_all(wire_root, a.out)


# ── yzsgo-e2e 增补：结构化对话索引 + 本次对话定位 ──

def emit_conversation_index(wire_root):
    """遍历 wire_root 下各 session，切分对话，产出与 render_all 同序的结构化索引。"""
    out = []
    gidx = 0
    sessions = sorted(d for d in os.listdir(wire_root)
                      if os.path.isdir(os.path.join(wire_root, d)))
    for sid in sessions:
        sdir = os.path.join(wire_root, sid)
        recf = os.path.join(sdir, "records.jsonl")
        if not os.path.exists(recf):
            continue
        deref = make_deref(sdir)
        recs = [json.loads(l) for l in open(recf, encoding="utf-8") if l.strip()]
        reqs = [r for r in recs if r.get("kind") == "request"]
        for conv in segment(reqs, deref):
            gidx += 1
            out.append({"gidx": gidx, "sid": sid,
                        "ts": conv[0].get("ts", ""),
                        "prompt": first_user_text(conv[0], deref)})
    return out


def locate_conversation(index, started_ts, first_message):
    """按 (started_ts, first_message) 定位本次对话；禁用 ls -t。规则见 plan Task 3 Interfaces。"""
    key = (first_message or "").strip()[:40]
    cands = []
    for it in index:
        p = (it.get("prompt") or "").strip()
        if not p:
            continue
        if not key:
            continue
        if p[:40].startswith(key) or key.startswith(p[:40]):
            cands.append(it)
    if not cands:
        return None
    cands.sort(key=lambda x: x.get("ts", ""))
    after = [c for c in cands if c.get("ts", "") >= started_ts]
    if after:
        return after[0]
    return cands[-1]


if __name__ == "__main__":
    main()
