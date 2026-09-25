# vendored 文件上游台账

| 本文件 | 上游 repo · 路径 | commit | 同步日期 |
|---|---|---|---|
| chat_driver.py | optima-store-skills · .claude/skills/operating-yzsgo-chat/chat_driver.py | a5eadfbe（PR #2567 的 merge commit，含 #2557 / #2223） | 2026-09-25 |
| pull_wire.py | optima-store-skills · .claude/skills/pulling-yzsgo-session-wire/pull_wire.py | 3cfc2d6 | 2026-09-09 |
| prep_conversation.py | optima-gateway · .claude/skills/conversation-iq/prep_session.py（改编：+浏览器证据合并） | b75f575c | 2026-08-31 |
| judge_workflow.js | optima-gateway · .claude/skills/conversation-iq/workflow.js（改编：+前后端一致性维度） | b75f575c | 2026-08-31 |

> 注：judge_workflow.js 内联的 decideOutcome 是 judge_outcome.js（有 node 单测）的副本，改逻辑需同步两处。

## 2026-09-25 这次同步带了什么（dev-skills#111）

`chat_driver.py` 逐字取自上游 `a5eadfbe`（optima-store-skills#2567 合入 main 的 merge commit；
同步时上游 main 就是这个提交）。直接动机：2026-09-24 起 www.yzsgo.com / 裸域 301 到唯一规范域名
**app.yzsgo.com**（optima-terraform#467/#468），登录态存在 localStorage、按 origin 隔离 ⇒ 缺省还写 www 时，
调试 Chrome 落在 app 上是未登录，本 skill 每次都起不来。

`010c578a..a5eadfbe` 之间上游动了这个文件 8 次（+720/-11），`attach()` 签名没变：

- **#2223 / #2567 规范域名**：缺省 `CHAT_URL` 改为 `https://app.yzsgo.com/zh-HK/chat`（只换 host，`/zh-HK` 保留——
  技能市场按繁体文案认控件，落到别的语种会假报 `notfound`）；`login_todo` 里的缺省地址提示从 `CHAT_URL` 取 host。
- **#2557 登录闸**：`login_state()` 三态纯函数（按 hostname **相等**比）；`attach()` 在这个源上没有登录态
  （或判不出）时**先把那个 tab 标成「留给人」再抛 `NeedsHumanLogin`**（`str(e)` 就是给人看的 todo，带 `driver`）；
  认领途中 tab 被关抛 `TabGoneDuringClaim`。两者都**不继承** `TabSessionUnavailable`。另有 `wait_for_login()`、
  `release_tab_for_human()`，以及 `validate_chat_url()`——**设了 `YZSGO_CHAT_URL` 却指到站点根会当场 `ValueError`**
  （必须指到聊天页，如 `https://app.stage.optima.chat/zh-HK/chat`）。
- **#1095 传文件**：`upload_file()` / `clear_attachments()`。本 skill 不用。
- **#2091 must_call**：`build_must_call()` / `parse_skill_loads()`（给 store-skills 的 skill 测试用）。本 skill 不用。

新副作用：无新增（仍只有 09-17 那版就有的 `~/.optima-locks/ziniao-gate.jsonl`，写失败不抛）。

**本仓为此做的适配**（驱动本身仍逐字，不改）：

1. `run_e2e.py`：`attach()` 包进 try，接住 `NeedsHumanLogin`（打印 `e.todo`，`e.driver.close()`——tab 已被标成
   「留给人」所以只断开不关，人在那个 tab 里登录后重跑）和 `TabGoneDuringClaim`，都以退出码 2 结束，不再是 traceback。
   🔴 不接的话 `NeedsHumanLogin` 会以未捕获异常退出（`str(e)` 虽然可读，但会被 traceback 淹没）。
2. `bootstrap.py` 的 `launch-chrome` 改开 `https://app.yzsgo.com`；`SKILL.md` 的 description 与前置里的 www 改为 app，
   并提醒「以前在 www 上登录过的 `/tmp/yzsgo-chrome` 要在 app 上重登一次」。`docs/superpowers/` 下的历史设计文档不改。
3. 新增 `tests/yzsgo-e2e/test_canonical_host.py`（ast，不需要 playwright）：缺省 `CHAT_URL` 的 host 是 app 且保留
   `/zh-HK/`（对应上游 A34）、`bootstrap` 起 Chrome 用 app、`run_e2e.py` 在 `attach()` 外接住两个新异常（且驱动里确有
   这两个类）、`.claude` 与 `.codex` 两份逐字节一致。上游 A34 本身要 import 驱动，本仓 CI 没有 playwright 跑不了；
   同步时在装了 playwright 的 venv 里实跑过：缺省 `CHAT_URL` 下落地 `app.yzsgo.com/zh-HK/chat` ⇒ `logged_in`、
   被踢回 `app.yzsgo.com/` ⇒ `logged_out`、落在 www ⇒ `unknown`。

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
