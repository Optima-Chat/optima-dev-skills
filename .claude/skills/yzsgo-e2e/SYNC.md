# vendored 文件上游台账

| 本文件 | 上游 repo · 路径 | commit | 同步日期 |
|---|---|---|---|
| chat_driver.py | optima-store-skills · .claude/skills/operating-yzsgo-chat/chat_driver.py | 010c578a（PR #1852，含 #1635） | 2026-09-17 |
| pull_wire.py | optima-store-skills · .claude/skills/pulling-yzsgo-session-wire/pull_wire.py | 3cfc2d6 | 2026-09-09 |
| prep_conversation.py | optima-gateway · .claude/skills/conversation-iq/prep_session.py（改编：+浏览器证据合并） | b75f575c | 2026-08-31 |
| judge_workflow.js | optima-gateway · .claude/skills/conversation-iq/workflow.js（改编：+前后端一致性维度） | b75f575c | 2026-08-31 |

> 注：judge_workflow.js 内联的 decideOutcome 是 judge_outcome.js（有 node 单测）的副本，改逻辑需同步两处。

## ⏳ 待办：全量同步到上游 `a5eadfbe` 或之后（dev-skills#111）

**触发条件：optima-store-skills#2558（#2557 登录闸的真机验收）通过。** 在那之前不做。

2026-09-24 起 www.yzsgo.com / 裸域 301 到唯一规范域名 app.yzsgo.com（optima-terraform#467/#468）。上游在
store-skills#2567（merge `a5eadfbe`）改了驱动缺省。本仓**这次没有同步驱动**（`chat_driver.py` 仍是上方台账里的
`010c578a`，逐字未动），只在调用方覆盖了缺省：`run_e2e.py` 在 import 驱动前执行
`os.environ.setdefault("YZSGO_CHAT_URL", "https://app.yzsgo.com/zh-HK/chat")`；`bootstrap.py launch-chrome` 与 `SKILL.md` 改为 app。
所以 `verify_drift.py` 会报 `chat_driver.py` 漂移，这是预期内的，等上面的触发条件满足后处理。

之所以不全量同步：`010c578a..a5eadfbe` 的 8 次提交（+720/-11）里含 #2557 登录闸（`attach()` 在没有登录态时抛 `NeedsHumanLogin`、
留 tab 给人），上游 09-24 才合入，真机验收单 #2558 还开着。做全量同步时要注意（已在关闭的 dev-skills#112 里实做并审过一轮）：

- `run_e2e.py` 要接住 `NeedsHumanLogin` / `TabGoneDuringClaim`。驱动给的 todo 写着「登好回来说一声会接着跑」，
  脚本如果选择退出就要说清楚；`unknown` 状态下不要催人登录；留下的 tab 要提示登完关掉（free 档只有 1 个并发名额）。
- #2091 适配了 09-19 的平台改版，新形态 `使用技能：<slug>` 从**整页**文本抓 ⇒ 一次跑多条 `--message` 时，
  后面几轮的 `tool_trace` 会带上前几轮加载过的 skill，逐轮做前后端核对时可能误判。与此同时，**现在这版（`010c578a`）在 09-19 改版后读不到新形态的 `load_skill`**。
- 届时去掉 `run_e2e.py` 里的 `setdefault` 覆盖（驱动缺省已是 app），并把 `test_canonical_host.py` 改为直接断言驱动缺省。

## 2026-09-17 这次同步带了什么

`chat_driver.py` 逐字取自上游 `010c578a`（optima-store-skills#1852 合入 main 的那个 merge commit；
同步时上游 main 上该文件与它逐字节一致）。`3cfc2d6..010c578a` 之间上游动了这个文件 25 次，对本仓有影响的三组：

- **#1635 多张 question-card**：活卡按「有 確認/下一題/補充回答 按钮」认，不再取第一张可见卡；
  `wait_reply` 回执带卡片原文与来源。这是本次同步的直接动机。
- **#611 / #666 紫鸟 profile 声明闸**：`attach(*, ziniao, reason=None, ...)` 的 `ziniao` 变成**必填**，
  漏传 `TypeError`；`ziniao=None` 无理由 `ValueError`。`send()` / `send_and_wait()` 多了可选的
  `ziniao=` 按条声明，并对账正文点名的 profile，不符抛 `ZiniaoDeclarationConflict`。
  互斥锁本身 2026-09-14 已撤，只剩声明 + 对账；每次放行/拦截追加到 `~/.optima-locks/ziniao-gate.jsonl`（写失败不抛）。
- **#870 本轮开的 tab 本轮关**：新增 `keep_tab_for_human(reason)`（停手交人时保留 tab）和 `with` 用法
  （`__enter__` / `__exit__`）。`close()` 只关自己开的 tab 是 09-09 那版就有的行为，不是这次新增。

**没接的**：`wait_reply` 新增的 `question` 回执（#1635，用来区分「读不到卡片」和「根本没问」）没有写进
`run_e2e.py` 的 turns / `meta.json`，判定层看不到它；要用得另改。`tool_trace` 末尾追加的十来个字段不影响现有读取。

**新增副作用**：每次 `attach()` 都会建 `~/.optima-locks/` 并往 `ziniao-gate.jsonl` 追加一行（写失败不抛）。
驱动报错提示里的 `scripts/ziniao-gate-report.py` 在 store-skills 仓库，本仓没有。

**本仓为此做的适配**（驱动本身仍逐字，不改）：

1. `run_e2e.py` 改传 `attach(ziniao=None, reason=…)`。🔴 **不改会在第一步就崩**——2026-09-16 曾有人只把新驱动手工拷进
   `~/.claude/skills/yzsgo-e2e/` 而没改调用方，结果本机这个 skill 一直是坏的。
2. 新增 `tests/yzsgo-e2e/test_attach_declaration.py`：从驱动的 ast 重建 `attach()` 的参数表，
   把本 skill 每处 `attach()` 调用用 `inspect.Signature.bind` 绑一遍 ⇒ 缺必填参数、传了驱动不收的关键字、
   位置参数不对，都会红。不需要 playwright。
   原有的 `test_imports.py` 只在装了 playwright 时才导入驱动，而且只查 `ChatDriver` 类存在，挡不住签名变化。
3. `test.yml` 加一步 `python3 -m unittest discover -s tests/yzsgo-e2e`。🔴 **此前 CI 只跑 `npm test`，
   `tests/yzsgo-e2e/*.py` 一条都不跑**，这些测试只在有人手动跑时才生效。runner 与 optima-store-skills
   的 `publish-plugin.yml` 同一个标签，那边直接用 `python3`。
4. ⚠️ **装好后已知 profile 表恒为空**：`known_profile_ids()` 读的是「驱动所在目录再往上三层」的
   `e2e/registry*.yaml`，那是 store-skills 仓库的布局；装到 `~/.claude/skills/yzsgo-e2e` 算出来是 `~`，
   装到 `~/.codex/skills/optima-dev/yzsgo-e2e` 算出来是 `~/.codex`，都读不到 ⇒ 对账只认
   `--ziniao-profile <id>` 这种显式写法，裸 14 位 profile id 认不出来。不影响本 skill（本来就声明 `None`）。

`pull_wire.py`：核过上游 `3cfc2d6..origin/main` 该文件无新提交，不用动。

## 2026-09-09 这次同步带了什么

上游把 e2e 改成**并发跑**（鸭嘴兽支持并发任务：一个 tab = 一个独立 gateway session）。
`chat_driver.py` 逐字取自上游 `3cfc2d6`（optima-store-skills#206，已合入 main），本次变更点：

- `attach()` **默认自己开 tab** 独占 session（`own_tab="auto"`；拿不到独立 session 就降级复用
  已有 tab 并置 `tab_isolated=False`）。`own_tab=True` 是严格档，并行必用——auto 档多 worker
  一起降级会都落到同一个 tab 上 = 静默串台。
- `session_id` / `close()` 只关自己开的 tab / `concurrency_status()` 读并发名额。
- send 拒绝分流从三码扩到五码（新增 `concurrency_limit` / `busy_elsewhere`）。

`pull_wire.py` 是**改编**（不逐字）。这次做了两件事：

1. **补回漏掉的上游修复 #102**（`bfa103c`「末 response 缺失显式标注,不再静默截断」）——
   vendored 副本从 2026-08-31 起就没跟上，一直在静默截断。上游的 4 条回归也一并移植到
   `tests/yzsgo-e2e/test_pull_wire_render.py`（另加一条锁 `render_conversation` 的 6 元 arity，
   因为 `run_e2e.py` 按 6 元解包，少一个会在出报告前一步崩）。
   ⚠️ 教训：`verify_drift.py` 对改编文件只标「⚠️(改编·预期)」，**看到这个标记要真的去读上游有什么新提交**，
   不能当成「预期差异」放过——这次就是那么漏掉半个月的。
2. 自行加了 `locate_conversation(..., session_id=...)`：
按 gateway sessionId **确定性**定位本轮对话，取代 (时间, 首句) 启发式 —— 并发跑时多个会话
时间戳交叠，启发式会挑错。传了 sid 却命不中就返回 None，**不静默回退**全局启发式
（回退会安静地定位到别的 session 的对话）。上游没有这个函数，是本仓独有的腿。
