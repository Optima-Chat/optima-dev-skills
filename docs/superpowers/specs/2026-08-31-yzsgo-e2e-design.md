# yzsgo-e2e — 鸭嘴兽通用端到端测试 skill 设计

- 日期：2026-08-31
- 仓库：`optima-dev-skills`（`.claude/skills/yzsgo-e2e/` + `.codex/` 同名镜像）
- 状态：设计已与需求方对齐，待 review 后进入实现计划

## 1. 背景与目标

鸭嘴兽（Optima AI 电商运营助手，前端 www.yzsgo.com，后端 Optima Gateway）需要一种**通用**的端到端健康测试：用浏览器真机打开鸭嘴兽、操作对话界面完成一段对话，然后同时拿到**浏览器侧结果**与**服务端权威的 wire（完整 agent 上下文）**，据此整体判断这次端到端过程有没有问题；有问题就提 issue。

`optima-store-skills` 里已存在一套等价能力（`operating-yzsgo-chat` / `pulling-yzsgo-session-wire` / `running-yzsgo-skill-tests` / `setting-up-yzsgo-test-env`），但那套是**为验证 marketplace skill** 服务的（绑定某个已发布 skill 有没有被云端 Agent 正确发现/调用/跑通，读 `e2e/registry.yaml` 用例表，做三维启发式判定）。

**本 skill 的目标是把它泛化成通用端到端测试**：不绑定任何 marketplace skill、不维护用例表，接受**任意临时对话**，判**网关 + agent-runtime 的整体行为**对不对。`optima-gateway` 的 `conversation-iq` 提供了判定纪律（代码备料 → LLM 逐对话判 → skeptic 读源码对抗验证 → 三态裁决），本 skill 复用之。

因为 `optima-dev-skills` 是「命令驱动、随包脚本、npm 发布给全团队」的自包含范式，本 skill 采用 **vendor（自包含拷贝）** 策略复用上游组件（方案 A），代价用「钉明信源 + 漂移比对」兜底。

### 目标（In scope）
- 用户用自然语言给出「要测的对话内容 + 关注点」，由 Claude Code 加载本 skill 驱动完成整条链路，用户不接触任何命令行参数。
- playwright attach 调试端口 Chrome，在 www.yzsgo.com 真机驱动对话，抓整轮浏览器输出（最终回复 + 工具轨迹 + 截图）。
- 经 buildbox 拉本次会话的 wire，按 seq 复位切分、定位本次对话、渲染 transcript + 事实卡。
- 复用 conversation-iq 语义管线判定，并做**前端所见 vs wire 真实产出**的一致性对照（e2e 独有价值）。
- `confirmed` 缺陷自动提 issue（默认 optima-gateway）；`needs_review` 不自动提、进报告待人工。

### 非目标（Out of scope）
- 不做 marketplace skill 的发现/调用/跑通验证（那是 store-skills 那套的职责）。
- 不维护固定 casebook / registry 用例表（需求方明确选「每次临时传对话」）。
- 不新建跨 repo 共享发布物（方案 C，理想终态但当前过重）。
- 不负责准备测试环境的一次性动作（登录、充值、桌面设备流）——那些引用 `setting-up-yzsgo-test-env`，本 skill 只做 preflight 自检并给提示。

## 2. 术语与信源

| 术语 | 含义 |
|---|---|
| 鸭嘴兽 / yzsgo | Optima AI 电商运营助手；前端 www.yzsgo.com/zh-HK/chat；后端 Optima Gateway |
| Wire | 每个 runtime session 的完整 LLM 调用记录，落 buildbox NAS `/mnt/nas-cn-prod/workspaces/cn-prod/<userId>/.agent/llm-wire/<sessionId>/records.jsonl`（TTL 14 天）。见 optima-gateway #2261 |
| 浏览器侧输出 | `chat_driver.wait_reply()` 返回的 `{text, transcript, tail, state, tool_trace, timed_out}`——前端渲染出来的整轮内容 |
| 三态裁决 | conversation-iq 的 `confirmed` / `needs_review`（split-vote）/ `rejected` |

**上游权威信源**（本 skill 是它们的 vendored 快照/改编）：
- 驱动：`optima-store-skills/.claude/skills/operating-yzsgo-chat/chat_driver.py`
- 拉 wire：`optima-store-skills/.claude/skills/pulling-yzsgo-session-wire/pull_wire.py`
- 判定：`optima-gateway/.claude/skills/conversation-iq/{prep_session.py, workflow.js}`
- 环境前置：`optima-store-skills/.claude/skills/setting-up-yzsgo-test-env/SKILL.md`

## 3. 架构总览（目录结构）

```
.claude/skills/yzsgo-e2e/            # 同名镜像到 .codex/skills/yzsgo-e2e/
  SKILL.md              # 何时用 / 用户说人话如何映射成驱动 / 四段流程 / 诚实边界 / vendor 同步纪律
  run_e2e.py            # 编排入口（Claude 调）：驱动→抓浏览器输出→拉wire→备料→判→报告/提issue
  chat_driver.py        # [vendored ← operating-yzsgo-chat] playwright attach 9222 驱 www.yzsgo.com/chat
  pull_wire.py          # [vendored ← pulling-yzsgo-session-wire] buildbox 拉wire + seq切分 + 渲染
  prep_conversation.py  # [改编 ← conversation-iq/prep_session.py] 备料 + 把浏览器侧输出并进证据稿
  judge_workflow.js     # [改编 ← conversation-iq/workflow.js] Judge→Verify→三态
  preflight.py          # 环境自检：调试端口Chrome/登录态/buildbox口令/playwright
  SYNC.md               # 每个 vendored 文件同步自的上游 commit；可选 verify_drift 说明
  verify_drift.py       # 可选：本机若有 ~/optima-store-skills 则 diff 提示漂移，不在场跳过
```

随包 `.py`/`.js` 就在 skill 目录内，`scripts/install.js` 分发 `.claude`+`.codex` 时一并带走，**不进 bin/TS 体系**（与 read-code / generate-test-token 一致的纯随包路线）。

## 4. 输入与用户交互模型

**用户不敲任何 CLI。** 本 skill 是给 Claude Code 用的：

> 用户：说人话——「帮我端到端测一下鸭嘴兽，跟它说『我想做电商，帮我看看』，看整个流程有没有问题」
> Claude：加载 `yzsgo-e2e`，按 SKILL.md 自己去 attach Chrome 驱动对话、拉 wire、判定、提 issue，把结论报给用户。

SKILL.md 负责教 Claude 把用户的自然语言映射成驱动参数：
- **逐轮消息**：用户说的对话内容 → 一条或多条按序 `send`。
- **预设反问答案**：用户顺口提到「要测某个反问 / 遇到它问 X 就答 Y」→ `answers=[{match, answer}]`，喂给 `wait_reply`。
- **关注点**：用户说「重点看有没有 XXX」→ 作为 `expect` 文本喂给判定层。

`run_e2e.py` 的 `--message/--answer/--expect/--env` 参数是 **Claude 内部填的**，对用户透明。Claude 也可不走 `run_e2e.py`、直接分步用 `chat_driver` 驱动（例如需要交互式观察时），两种路径都由 SKILL.md 指引。

## 5. 数据流四段（核心）

### ① 驱动（浏览器侧）
1. `preflight.py` 自检：9222 调试端口 Chrome 在、已登测试账号、`~/.buildbox_pw` 在、playwright 可用。缺什么 → 指向 `setting-up-yzsgo-test-env` 的对应步骤，**不替用户做一次性登录/充值动作**。
2. `ChatDriver(port=9222).attach()` → `connect_over_cdp("http://localhost:9222")`。
3. `new_conversation()` 隔离本次对话。
4. 逐轮 `send_and_wait(msg, timeout, answers)`；`wait_reply` 状态驱动等回复，遇 `waiting_input` 用预设答案回答、无答案则停下交人工。
5. 收集每轮 `wait_reply` 返回 `{text, transcript, tail, state, tool_trace, timed_out}` + 截图 + 起止时间戳。记录 `state`：`done/timeout/service_error/waiting_input`。

### ② 拉真相（服务端 wire）
1. 跑完后 `pull_wire.py --user <测试账号userId> --since <覆盖本次的天数窗> --out <工作目录>`，经 buildbox（`47.94.105.163`，`~/.buildbox_pw`）拉 wire。
2. `pull_wire` 用 **seq 复位**切分（`seq==1`/`msgs==2` = 新对话起点），把一个 `records.jsonl`（warm-pool 可能聚多个 web 对话）切成多份对话。
3. **定位本次对话**：按对话内**时间戳 / prompt 内容**匹配（对齐①记录的起止时间戳与首条消息），**绝不用 `ls -t`**（沿用 store-skills 血泪纪律：`ls -t` 会拿到旧对话、误判）。

### ③ 备料（`prep_conversation.py`）
- 复用 conversation-iq `prep_session.py` 的备料层：分类调用类型（只对 main turn 分析，剔除 compaction/aux）、结构不变量（悬空 tool_use / req-resp 配对 / max_tokens / abort / error）、渲染干净 transcript + 事实卡。
- **e2e 增量**：把①收集的**浏览器侧整轮输出**（`transcript` + `tool_trace` + `state`）并进备料稿，作为「前端所见」证据段，供判定层做前后端对照。

### ④ 判定（`judge_workflow.js`，Claude 用 Workflow 跑）
复用 conversation-iq `workflow.js` 的编排：
- **Judge**：每对话一个 sub-agent 读备料稿 → 候选 findings。带**运行时实时拉的 gateway 已知 issue 清单**（`gh issue list --repo Optima-Chat/optima-gateway --state open ...`）做打标签，**不做过滤**（已发现未修的仍算当前问题）。内建「稳定正常现象」白名单（压缩/摘要调用、abort、max_tokens）。
- **Verify**：每条 novel finding 放 3 个 skeptic 读**真实 runtime 源码**尽力反驳、默认判假。三态：全票反驳 = `rejected`；过半但非全票反驳 = `needs_review`（split-vote，进人工复核，绝不静默毙）；多数不反驳 = `confirmed`。
- 输出按 sid 汇总 `confirmed / needsReview / rejected`。

## 6. e2e 独有价值：前端所见 vs wire 真实产出

本 skill 比纯 conversation-iq 多一层对照维度——判定 prompt 显式要求核对**浏览器前端渲染的**与 **wire 里 agent 真实产出的**是否一致。专属要抓的缺陷类：
- 前端只显示了半截 / 丢了工具卡 / 中途卡住，但 wire 里其实完整成功；
- 前端报 `service_error`，但 wire 里其实正常（或反之）；
- 前端 `waiting_input` 停住（反问）但 wire 显示 agent 本不该问 / 该问没问。

这类「前后端不一致」是纯读 wire 或纯看前端都发现不了的，是本 skill 的核心增量。

## 7. 报告 + 提 issue

- **run report**：主体 = 按严重度排序的「本次端到端问题」表（问题、命中证据、confirmed/needs_review、根因/危害），外加固定的 **§覆盖边界** + **§判断修正** 两节（照搬 conversation-iq 诚实纪律，防报告沦为「一切正常」的自我安慰）。落工作目录 / `reports/`。
- **提 issue（不设人工门）**：`confirmed` 缺陷**直接**用 `gh` 提，不给草稿、不等确认（提错可改可删）。默认目标 **optima-gateway**（agent-runtime / 网关缺陷）；判定为前端缺陷 → 前端 repo。issue 带证据：浏览器输出 + wire transcript + 可 repro 的那段对话 + `needs-triage` 标签。
- `needs_review`（split-vote）**不自动提**（真假未定，自动提是噪声）——报告里单列「待人工复核」段，坐实为真再补提。
- **环境类**（积分不足 / 超时 / 桌面没连 / session 泄漏 / weekly_limit）**不提 issue**，报告标 `blocked`，别当 skill/网关缺陷。

## 8. 环境前置与两环境

- 环境准备复用 `setting-up-yzsgo-test-env`：调试端口 Chrome 登测试账号（`open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/yzsgo-chrome https://www.yzsgo.com`）、桌面设备流、token 刷新、积分充值、`~/.buildbox_pw`、playwright。本 skill 只 `preflight.py` 自检 + 指路。
- **两环境参数化** `--env cn-prod|cn-stage`：切换前端 URL、测试账号 userId、wire NAS 路径。
- **实现期待核实（不阻塞设计）**：cn-stage 是否同样落 wire 到某 NAS、以及 www.yzsgo.com 能否指到 cn-stage。**先把 cn-prod 全链路打通**，cn-stage 留参数位、跑通时补齐取法。SKILL.md / preflight 对 cn-stage 未验证部分明确标注，不假装支持。

## 9. vendor 同步纪律（方案 A 的代价兜底）

- SKILL.md 顶部钉明：`chat_driver.py` / `pull_wire.py` 的**上游权威 = store-skills 对应 skill**，`prep_conversation.py` / `judge_workflow.js` 改编自 conversation-iq；本目录是 vendored 快照，DOM 选择器 / wire 切分逻辑以上游为准。
- `SYNC.md` 记录每个 vendored 文件同步自的上游 commit hash + 同步日期。
- `verify_drift.py`（可选）：本机若存在 `~/optima-store-skills` / `~/optima-gateway` 就 diff 对应源文件、提示漂移；不在场则跳过（不破坏 dev-skills 自包含性）。
- 最易腐烂的是 `chat_driver.py`（耦合前端 DOM），SKILL.md 特别提示「驱动异常先怀疑 DOM 漂移、去上游同步」。

## 10. 双端分发与测试

- `.claude/skills/yzsgo-e2e/` 与 `.codex/skills/yzsgo-e2e/` 同名镜像；`scripts/install.js` 负责分发（随包 `.py`/`.js` 在目录内，随之带走）。
- README 的 skill 清单 + `tests/service-matrix-alignment.test.js` 需把 `yzsgo-e2e` 加入，避免清单校验红。
- **测试策略**：
  - 纯函数单测：wire seq 切分、结构不变量、备料稿渲染、报告渲染、本次对话定位（时间戳/prompt 匹配）。
  - 真机 smoke：跑一句「你好」，打通 驱动→拉wire→备料→判定→报告 全链路，验证接线正确（不追求判定质量，只验管道通）。
  - 驱动 / judge 这类重环节不做 mock 单测，靠 smoke + 诚实边界纪律。

## 11. 组件复用来源映射

| 本 skill 文件 | 来源 | 关系 |
|---|---|---|
| `chat_driver.py` | store-skills `operating-yzsgo-chat/chat_driver.py` | vendored 拷贝（可裁掉 marketplace 装技能相关方法） |
| `pull_wire.py` | store-skills `pulling-yzsgo-session-wire/pull_wire.py` | vendored 拷贝 |
| `prep_conversation.py` | gateway `conversation-iq/prep_session.py` | 改编：+ 浏览器侧输出并入证据 |
| `judge_workflow.js` | gateway `conversation-iq/workflow.js` | 改编：+ 前后端一致性判定维度 |
| `preflight.py` | store-skills `setting-up-yzsgo-test-env` | 新写，逻辑参照其清单 |
| 环境准备 | store-skills `setting-up-yzsgo-test-env` | 引用，不重造 |

## 12. 开放 / 待核实项（进入实现计划时处理）

1. cn-stage 的 wire 落盘位置与取法（见 §8）——先 cn-prod 打通。
2. `run_e2e.py` 与「Claude 分步用 chat_driver 驱动」两条路径在 SKILL.md 里的边界（何时一把梭、何时分步）。
3. 前端是否暴露 sessionId（若暴露可精确定位 wire，省去时间戳匹配的模糊性）——实现时确认。
4. `chat_driver.py` 是否需裁剪 marketplace 相关方法（`ensure_installed` 等），保持本 skill 精简。
