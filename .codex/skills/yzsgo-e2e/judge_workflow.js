// .claude/skills/yzsgo-e2e/judge_workflow.js
// 改编自 optima-gateway conversation-iq/workflow.js（见 SYNC.md）。
// 输入 args: { base, sids, knownIssues }（备料稿目录 / 待判对话文件名列表 / gh 实时拉的开着 issue 文本）。

export const meta = {
  name: "yzsgo-e2e-judge",
  description: "读 e2e 备料稿（wire + 前端证据）逐对话判缺陷，对抗验证出三态",
  phases: [
    { title: "Judge", detail: "每对话一个 agent 读备料稿判缺陷（含前后端一致性）" },
    { title: "Verify", detail: "每条 novel finding 3 个 skeptic 读 runtime 源码反驳，三态裁决" },
  ],
};

// decideOutcome 与 judge_outcome.js 同步（后者有 node 单测）
function decideOutcome(votes) {
  const good = (votes || []).filter(Boolean);
  const n = good.length;
  const refuted = good.filter((v) => v.refuted).length;
  if (n === 0) return "needs_review";
  if (refuted === n) return "rejected";
  if (refuted > n / 2) return "needs_review";
  return "confirmed";
}

const A = typeof args === "string" ? JSON.parse(args) : args || {};

const STABLE_NORMAL = `## 正常现象（不是缺陷，别报）：
- compaction 摘要调用、abort、max_tokens 截断本身；
- 前端 new_conversation 后主区只有本轮（预期）。`;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    impression: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          what: { type: "string" },
          evidence: { type: "string" },
          knownIssue: { type: "string" },
        },
        required: ["what", "evidence"],
      },
    },
  },
  required: ["impression", "findings"],
};

const VERDICT_SCHEMA = {
  type: "object",
  properties: { refuted: { type: "boolean" }, reason: { type: "string" } },
  required: ["refuted", "reason"],
};

function judgePrompt(path) {
  return `读备料稿 ${path}（含 wire transcript + 「前端所见」证据）。判这次端到端对话有没有网关/agent 缺陷。
重点核对：① wire 里 agent 真实产出 vs 前端渲染是否一致（丢内容/半截/前端报错但 wire 成功、或反之）；
② 悬空 tool_use / max_tokens 截断 / error / abort 是否造成用户可感问题；③ 回答是否编数据/答非所问/活没干完。
${STABLE_NORMAL}
已知开着的 issue（命中就在 knownIssue 里标 #号，仅打标签、不要因此不报）：
${A.knownIssues || "(无)"}
默认健康：证据不足别硬报。输出 impression + findings。`;
}

function verifyPrompt(f, path) {
  return `有人在 ${path} 报了缺陷：「${f.what}」，证据：${f.evidence}。
你是 skeptic：读**真实 runtime 源码**（optima-gateway / agent-runtime）核对机制，尽力反驳。默认判假（refuted=true），
只有确凿证明该缺陷真实存在才 refuted=false。输出 refuted + reason。`;
}

const results = await pipeline(
  A.sids,
  (sid) =>
    agent(judgePrompt(`${A.base}/${sid}.md`), {
      label: `judge:${sid}`,
      phase: "Judge",
      schema: JUDGE_SCHEMA,
    }).then((judge) => ({ sid, judge })),
  async (prev) => {
    if (!prev || !prev.judge) return { sid: prev?.sid, confirmed: [], needsReview: [], rejected: [] };
    const path = `${A.base}/${prev.sid}.md`;
    const novel = prev.judge.findings || [];
    if (novel.length === 0)
      return { sid: prev.sid, impression: prev.judge.impression, confirmed: [], needsReview: [], rejected: [] };
    const verified = await parallel(
      novel.map((f) => async () => {
        const votes = await parallel(
          [0, 1, 2].map(() => () => agent(verifyPrompt(f, path), { label: `verify:${prev.sid}`, phase: "Verify", schema: VERDICT_SCHEMA }))
        );
        return { finding: f, outcome: decideOutcome(votes) };
      })
    );
    const by = (o) => verified.filter(Boolean).filter((v) => v.outcome === o);
    return { sid: prev.sid, impression: prev.judge.impression, confirmed: by("confirmed"), needsReview: by("needs_review"), rejected: by("rejected") };
  }
);

return { results: results.filter(Boolean) };
