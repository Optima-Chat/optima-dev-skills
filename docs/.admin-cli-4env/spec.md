# SPEC — dev-skills 运营 admin CLI 4-环境统一 + 账号禁用

> 状态：DRAFT（待 fresh-agent review ×2 + 用户确认 open items）
> 作者：本次 session · 日期：2026-06-16
> 目标来源（用户原话，2026-06-15）："4个环境（stage, prod, cn-stage, cn-prod）的 grant 和 entitlement 的授予和撤销，以及状态查询。另外加一个账号禁用和恢复。同时支持手机号和邮箱。"

## 1. 目标与范围（已与用户锁定）

| 域 | 授予 | 撤销 | 状态查询 | 备注 |
|---|---|---|---|---|
| **subscription（会员）** | ✅ 已有 `grant-subscription` | ❌ **不做** | ✅ **新增** | billing 无 admin 撤销端点；撤销作为后续 |
| **entitlement（产品权益）** | ✅ 已有 | ✅ 已有 `refund-entitlement` | ✅ 已有 `admin/entitlements` | PR #33 已接 cn-prod，但漏 cn-stage |
| **credits（USD 余额）** | ✅ 已有 `grant-balance` | ❌ 无端点 | （并入状态查询？见 open） | **修缺陷：统一支持手机号**（现仅 email） |
| **account ban/unban（禁用/恢复）** | — | — | — | ✅ **全新**，4 环境 |

全部覆盖 4 环境：`stage` / `prod` / `cn-stage` / `cn-prod`。标识符：cn 环境支持 `phone/email/userId`，AWS 环境 `email` only（受 SSH 隧道 + M2M scope 限制，见 §3）。

**明确不在范围**：subscription 撤销、credits 撤销、AWS 环境的手机号解析。

## 2. 命令面（提案 — 待 review）

保留并扩展现有 bin；新增 account 域。

- `optima-grant-subscription <email|phone|userId> --plan --months --env` —— 授予会员。**改动**：`resolveTargetUser` 补 cn-stage。
- `optima-grant-balance <email|phone|userId> --amount --env` —— 授予 credits。**改动**：接 `resolveTargetUser`（真正支持手机号），位置参数从 `email` 改为通用 identifier（`--email` 兼容别名）。
- `optima-entitlement grant|revoke|list <email|phone|userId> --env` —— **改动**：PR #33 基础上补 cn-stage。
- `optima-account status|ban|unban <email|phone|userId> --env` —— **新增 bin**。
  - `status`：聚合视图 = 订阅(membership-status) + 权益(admin/entitlements) + 账号状态(is_active/banned)。只读。
  - `ban --reason "..."`：禁用账号（user-auth `is_active=false` + 记录原因）。prod/cn-prod 需 confirm。
  - `unban`：恢复账号。

> 备选：ban/unban/status 是否该并进 `optima-grant-subscription` 或独立 `optima-ban`/`optima-unban`？提案用 `optima-account` 子命令聚合「以用户为中心的运营 admin 操作」，与「按域授予」的 grant-*/entitlement 区分。**待 review 定。**

## 3. 每环境 鉴权 + 解析 矩阵（核心）

| 环境 | 用户身份 | userId 解析 | 解析用 token | 写操作 token |
|---|---|---|---|---|
| stage / prod (AWS) | email | RDS SSH 隧道 `resolveUserId(email)` | Infisical（AWS）| billing: M2M client_credentials（已有）；ban: **admin-用户 token（新）** |
| cn-prod / cn-stage (阿里云) | 手机号为主 | HTTP `/api/v1/internal/users/lookup`（phone/email）+ `getUserById` 反查 + `assertPhoneMatch` | M2M（cn，scope `internal:users:write`，已有）| billing: 同 M2M；ban: **admin-用户 token（新）** |

**`resolveTargetUser(env, identifier)`**（PR #33 已抽出，**必须补 cn-stage**）：
```
kind = classify(identifier)          # email / phone / userId
assertAwsEmailOnly(env, kind)        # stage/prod 拒非 email
if env in {cn-prod, cn-stage}:       # ← PR #33 只写了 cn-prod，BUG
    resolve via HTTP lookup → getUserById 反查打印 → phone 输入则 assertPhoneMatch
else (stage/prod):
    resolve via SSH 隧道 email-only
```

**端点（已在源码核实，impl 阶段须按 CLAUDE.md 用真实请求复核每环境）**：
- 解析：user-auth `POST /api/v1/internal/users/lookup` `{email|phone}`（精确匹配，scalar_one_or_none）；`GET /api/v1/internal/users/{id}`（反查）。
- subscription 授予：billing `POST /api/billing/admin/grant-subscription`（requireAdminService / M2M）。
- subscription 状态：billing `GET /api/internal/users/{userId}/membership-status`（任意 Service Client JWT / M2M）→ `{active, planId, status}`。
- entitlement 授予/撤销/列表：billing `POST /api/billing/admin/grant-entitlement`、`POST /api/billing/admin/refund-entitlement`、`GET /api/billing/admin/entitlements?userId=`。
- credits 授予：billing `POST /api/billing/admin/grant-credits`。
- **ban/unban：user-auth `POST /api/v1/admin/users/{id}/ban`（body `{reason}`）、`/unban`。鉴权 `get_current_admin_user`（role=ADMIN 的用户 token）——非 M2M。**

## 4. ban/unban 鉴权设计（最大新增点）

- M2M client_credentials token **无 user_id** → 调 ban 会 404（`get_current_admin_user` 取 token.user_id 查 user）。
- 必须用 **admin 用户**（role=ADMIN）走 **password grant** 拿 token（dev-skills 已有此模式：`generate-test-token` 的 `getToken`）。
- userId 解析仍用 §3 的 `resolveTargetUser`（M2M lookup）；**仅最后的 ban/unban 调用换 admin-用户 token**。
- 新增 token 获取函数（类比 `getServiceToken`）：`getAdminUserToken(env)` —— 从凭证源读 admin email/password + password-grant client_id，curl `oauth/token`，process 内缓存。

### OPEN-1（阻塞 ban，需用户/发现）：admin 用户凭证位置
| 环境 | admin email | 凭证位置 | password-grant client_id |
|---|---|---|---|
| cn-prod | admin@optima.chat | 1P `okshqmbbtu4oes6jhjiz6byojm`（runbook 已知） | `agent-portal-bc0osnsd` |
| cn-stage | ? | ?（cn Infisical staging?） | ? |
| stage | ? | ?（AWS Infisical staging?） | ? |
| prod | ? | ? | ? |
> 倾向：与 dev-skills 现有凭证模式一致——把 4 环境 admin 凭证统一放 Infisical（AWS 三环境放 AWS Infisical 对应 env；cn-stage 放 cn Infisical staging），CLI 按 env 读。**待用户确认凭证落点 / 是否新建 admin 账号。**

## 5. PR #33 复用与修正

PR #33（`feat/entitlement-cn-prod-phone-userId`）是好基础（entitlement 接 cn-prod + 抽 `resolveTargetUser`），但：
1. 从 0.8.0 前分支拉出 → CONFLICTING；`resolveTargetUser` 只判 cn-prod 漏 cn-stage。
2. PR 描述谎称 grant-balance 已支持手机号（实测 email-only）。

**处理**：本分支 `feat/admin-cli-4env` 从 main(0.8.0) 起，重新落地 #33 的 entitlement 改动 + `resolveTargetUser`（含 cn-stage）+ grant-balance 接入 + 新增 account 命令。完成后关闭 #33 或将其重定向到本分支，并改正描述。

## 6. 验收标准

- `npm run build`（tsc）+ black/ruff 不适用（TS 项目，按 repo 既有 lint）。
- 单测：classify/assertPhoneMatch/assertAwsEmailOnly 保持通过；新增 resolveTargetUser cn-stage 路由测试、ban token 路径测试（mock）。
- 每命令 × 4 环境的 `--help` 正确显示 identifier 形态与 env 列表。
- 真实只读验证（impl 阶段）：4 环境各跑一次 `account status <真实用户>`，确认解析+读取正确；ban/unban 在 stage/cn-stage 用测试账号实跑闭环（prod/cn-prod 仅在用户授权下）。
- 向后兼容：`--email` 别名仍可用。

## 7. 任务分解（plan 阶段细化）

- T1：`resolveTargetUser` 补 cn-stage（修 #33 走偏）+ 单测。
- T2：grant-balance 接 `resolveTargetUser`（位置 identifier + 手机号）。
- T3：entitlement grant/list/revoke 落地（#33 的改动，基于 0.8.0）。
- T4：`optima-account status`（membership-status + entitlements 聚合，只读）。
- T5：`getAdminUserToken` + `optima-account ban/unban`（依赖 OPEN-1）。
- T6：skill SKILL.md / README / bin 注册 / help 文案同步 4 环境。
- T7：final review + 真实环境验证。

## OPEN ITEMS 汇总
- **OPEN-1**：stage/prod/cn-stage 的 admin 用户凭证位置（阻塞 T5）。
- **OPEN-2**：命令面——account 子命令聚合 vs 独立 bin（§2 备选）。
- **OPEN-3**：credits 是否纳入 `account status` 余额展示（grant-balance 只授予，状态查询要不要顺带显示 credits 余额）。
