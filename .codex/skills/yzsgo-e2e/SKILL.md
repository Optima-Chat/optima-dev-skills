---
name: "yzsgo-e2e"
description: "当用户请求端到端测试鸭嘴兽、e2e 测 yzsgo 对话、用浏览器真机测鸭嘴兽整个流程、驱动对话再拉 wire 核对前后端、测网关/agent 端到端有没有问题时，使用此技能。playwright attach 调试端口 Chrome 驱 www.yzsgo.com 对话 → 拉 gateway wire → conversation-iq 语义管线判定 → confirmed 自动提 issue。"
allowed-tools: ["Bash", "Read", "Write", "Agent", "Workflow"]
---

# yzsgo-e2e — 鸭嘴兽通用端到端测试

用浏览器真机驱动鸭嘴兽完成一段对话，同时拿浏览器侧结果 + 拉 gateway wire，判前后端一致性与网关缺陷，confirmed 自动提 issue。

## 何时用
- 「端到端测一下鸭嘴兽」「e2e 测这段对话」「用浏览器真机测整个流程有没有问题」

## 用户说人话 → 我怎么映射（用户不敲 CLI）
- 用户给的对话内容 → 逐轮 `--message`（按序）。
- 用户提到「遇到它问 X 就答 Y / 测某个反问」→ `--answer "X=Y"`。
- 用户说「重点看有没有 Z」→ `--expect "Z"`。

## 四段流程
1. **preflight**：`python3 preflight.py <env>`；缺项按提示准备（一次性登录/充值见 store-skills `setting-up-yzsgo-test-env`，我不替做）。
2. **驱动 + 拉 wire + 备料**：`python3 run_e2e.py --env <env> --user <测试账号userId> --message ... [--answer k=v] [--expect ...] --out <dir>` → 出 `prepped.md` + `meta.json`。
3. **判定**：`gh issue list --repo Optima-Chat/optima-gateway --state open --json number,title` 拉已知 issue 文本，`Workflow({scriptPath:"<skill>/judge_workflow.js", args:{base:"<dir>", sids:["prepped"], knownIssues:"<文本>"}})`。
4. **报告 + 提 issue**：出报告（`render_report`）。**confirmed 直接 `gh issue create --repo Optima-Chat/optima-gateway --label needs-triage`**（证据=前端输出+wire transcript+repro 对话），提错可改可删；**needs_review 不自动提**，报告单列待人工；**环境类标 blocked 不提**。

## 诚实边界（照搬 conversation-iq）
- 「0 confirmed」≠「没问题」；needs_review 绝不静默毙。
- 对抗验证必须让 skeptic 读**真实 runtime 源码**，默认判假。
- 报告固定含「覆盖边界」+「判断修正」两节。

## 前后端对照（本 skill 独有）
判定要核对**前端渲染的** vs **wire 里 agent 真实产出的**：前端丢内容/半截/报错但 wire 成功（或反之）= 缺陷。

## vendor 同步纪律
`chat_driver.py`/`pull_wire.py` 上游权威 = optima-store-skills；`prep_conversation.py`/`judge_workflow.js` 改编自 optima-gateway conversation-iq。见 `SYNC.md`。驱动异常先怀疑前端 DOM 漂移 → 去上游同步。可跑 `python3 verify_drift.py` 比对。

## 两环境
`--env cn-prod`（已打通）/ `cn-stage`（wire 取法待核实，脚本会告警）。
