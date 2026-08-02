---
name: "reset-onboarding"
description: "当用户请求重置某账号的 onboarding 资格、让账号重新体验新手引导/问卷、再触发一次 onboarding、重开引导运行（guided run）、重置 guided_run_grant 时，使用此技能。支持 cn-prod、cn-stage 两个环境；标识符支持手机号/邮箱/userId。"
allowed-tools: ["Bash"]
---

# 重置 onboarding 资格（让账号重新触发新手引导问卷）

让某账号「进入页面再次自动弹出 onboarding 问卷」。cn-prod 与 cn-stage 机制相同，只换环境参数与前端域名（cn-prod = `https://app.yzsgo.com`，cn-stage = `https://app.stage.optima.chat`）。

## 门控机制（缺一不弹）

前端 `useShowOnboardingTree`（agentic-chat）要求**全部**满足：

1. 服务端资格：billing 库 `guided_run_grant` 判出 `sponsorshipAvailable === true`，公式 `(granted - used) > 0 && spent_credits < cap_credits`（cap 默认 2000）
2. 有 userId
3. **当前打开的会话无 user 消息**——开个新会话即满足，无需删旧会话
4. 客户端浏览器 localStorage 无「已提交/已跳过」锁

所以重置分**两层**：服务端 SQL（我方执行）+ 客户端 localStorage（只能操作浏览器的人自清）。

## 执行步骤（服务端）

全程用 `optima-query-db`，`<env>` 取 `cn-stage` / `cn-prod`，作为第 3 个位置参数（如 `optima-query-db billing "..." cn-stage`）。

**凭证按 `query-db` skill 的方式准备即可，本技能不需要额外 `source` / `export`**：本机若有 `~/.infisical_cn_creds` 和 `~/.buildbox_pw`，工具会自己读取（`bin/helpers/db-utils.ts` 的 `loadCredsFileIntoEnv()` / `readBuildboxPwFile()`，文件不存在即无操作）；没有则从 1Password 取 `INFISICAL_CN_EMAIL`、`INFISICAL_CN_PASSWORD`、`OPTIMA_CN_BUILDBOX_PASSWORD` 三个值 `export` 到当前 session（推荐，不落盘）。缺哪个命令会自己报错并提示来源。

**① 标识符 → uid，同时拿到可供人工核对的身份**（手机号/邮箱查 user-auth）。注意 cn-prod 与 cn-stage 是独立库，同一手机号两边 uid 不同：

```bash
optima-query-db user-auth "SELECT id, phone, email FROM users WHERE phone='<手机号>'" <env>
```

> **用户直接给了 uid 也不要跳过 ①**，改成按 uid 反查、把手机号/邮箱拿到手——②（`guided_run_grant`）的回显只有 `user_id`，自己证明不了自己是谁：
>
> ```bash
> optima-query-db user-auth "SELECT id, phone, email FROM users WHERE id='<uid>'" <env>
> ```

**② 查 grant 现状**（确认目标账号，防止重置错人）：

```bash
optima-query-db billing "SELECT user_id, granted, used, cap_credits, spent_credits, updated_at FROM guided_run_grant WHERE user_id='<uid>'" <env>
```

> 回显里同时确认 `granted > 0`——若 `granted=0`，重置本身就是无效的（资格公式 `(granted-used)>0` 仍不成立），③ 的 `AND granted > 0` 会让 UPDATE 影响 0 行。若查不到行或 `granted=0`：该账号从未被授予引导资格，不属「重置」范畴——发放 grant 走 billing 侧逻辑，找 billing owner 确认。

**③ 重置——`used` 和 `spent_credits` 两个字段都要清、缺一不可**（只清 `used`、若 `spent_credits` 已烧到 cap 则资格仍是 false）。

> 🔴 **跑这条 UPDATE 前必须完成的两条硬性前置**（`cn-prod` 是生产库写操作，跑完不可撤销）：
>
> 1. 已跑 ① 拿到该 uid 的手机号/邮箱，**并念给用户、拿到明确确认「就是这个账号」**——用户直接给 uid 时同样要做。
> 2. 已跑 ② 看到该 uid 确有行且 `granted > 0`。
>
> 缺任何一条就停下来问，不要先跑 UPDATE。

```bash
optima-query-db billing "UPDATE guided_run_grant SET used=0, spent_credits=0, updated_at=now() WHERE user_id='<uid>' AND granted > 0 RETURNING user_id, granted, used, cap_credits, spent_credits" <env>
```

> `AND granted > 0` 是机械自保：打到从未被授予引导资格的账号时影响 0 行、回显为空，而不是静默写一个无效重置。**已知不足**：它挡不住「uid 打错、恰好打到另一个真有 grant 的账号」——那种情况唯一的防线是上面第 1 条的人工核对，没有第二道。本技能不包 CLI 反查确认（对比 `optima-account ban` 的 `🎯 目标账号` 回显 + `--yes`），要补属另一个 issue 的量级。

**④ 复核 `sponsored_window`**：`CLOSED_*` 状态无需处理（下次进 onboarding 时 lazy-open 自动新开）；仅异常残留的 `OPEN` 窗需要关注——等 reaper 约 30 分钟自动收即可，别手动改它的 status（未验证过的写路径）。该表**无 `created_at` 列**，按 `opened_at` 排序：

```bash
optima-query-db billing "SELECT id, status, window_spent_credits, opened_at, closed_at FROM sponsored_window WHERE user_id='<uid>' ORDER BY opened_at DESC LIMIT 5" <env>
```

## 客户端一层（服务端做不了，转告操作浏览器的人）

把 ① 查到的 uid 一并告知对方（拼下面的键名要用），然后：

1. 清 localStorage 锁——在对应环境前端域名下删三个键（DevTools → Application → Local Storage），或直接用**无痕窗口/换浏览器**登录（天然无锁）：
   - `onboarding_intake_submitted:<uid>`
   - `onboarding_intake_dismissed:<uid>`
   - `onboarding_intake_draft:<uid>`
2. 登录后点「开始新对话」落到空会话，问卷即自动弹出。

## 别白清的东西（不是 gate）

- gateway 库 `user_configs.intake_dismissed`：「我是老手跳过整树」的持久化，不是"已体验过"标记。
- agentic-chat 库 `onboarding_results` / `user_preferences.onboardingCompletedAt`：cn 环境无写入方，查了是空。

## 安全提醒

1. `cn-prod` 是生产库写操作，真正的护栏写在 **③ 正文的两条硬性前置**里（人工核对身份 + `granted > 0`），不在本节——别只扫这节就动手。
2. 清 `spent_credits` **不会退回真实花费**——真扣费永久留在 `usage_records`（`metadata->>'actorUserId'` = uid）与 CLOSED 窗的 `window_spent_credits`，清零只是把 lifetime 计数器归零、重开满 cap 预算。
3. onboarding 门控在高频演进（COO epic 等）：若按本流程重置后仍不弹，先对 agentic-chat `origin/main` 的 `useShowOnboardingTree` / `intakeLocal` 重验门控是否有变，再排查。

## 相关命令

- `optima-query-db` - 本技能全部查询/更新的载体
- `optima-grant-credits` / `optima-grant-subscription` - 积分/订阅发放（与 onboarding 赞助额度是两回事）
- `optima-account` - 账号状态查询
