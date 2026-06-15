# SPEC — dev-skills 运营 admin CLI 4-环境统一 + 账号禁用

> 状态：DRAFT v2（已过 fresh-agent review r1 + 用户 open 答复；待 review r2）
> 作者：本次 session · 日期：2026-06-16
> 目标来源（用户原话，2026-06-15）："4个环境（stage, prod, cn-stage, cn-prod）的 grant 和 entitlement 的授予和撤销，以及状态查询。另外加一个账号禁用和恢复。同时支持手机号和邮箱。"
> 用户锁定：subscription=授予+查询(无撤销)；entitlement=授予+撤销+查询；credits=授予(修手机号)；ban/unban=4环境(admin-用户凭证)。命令面=`optima-account status|ban|unban` 聚合。status 含 credits 余额。

## 1. 目标与范围（已锁定）

| 域 | 授予 | 撤销 | 状态查询 | 备注 |
|---|---|---|---|---|
| subscription | ✅ 已有 `grant-subscription` | ❌ 不做 | ✅ 并入 `account status` | billing 无 admin 撤销端点 |
| entitlement | ✅ 已有 | ✅ 已有 `refund-entitlement` | ✅ 已有 `admin/entitlements` | |
| credits | ✅ 已有 `grant-balance` | ❌ 无端点 | ✅ 并入 `account status` | **修缺陷：支持手机号** |
| account ban/unban | — | — | ✅ `account status` 显示 is_active/banned | ✅ 全新，4 环境 |

4 环境：`stage`/`prod`/`cn-stage`/`cn-prod`。标识符：cn 支持 `phone/email/userId`，AWS `email` only（SSH 隧道 + M2M scope 限制）。
不在范围：subscription 撤销、credits 撤销、AWS 手机号解析。

## 2. 命令面（已定）

- `optima-grant-subscription <email|phone|userId> --plan --months --env` —— 授予会员（已支持 4 环境，本次仅随 `resolveTargetUser` 抽取而调整）。
- `optima-grant-balance <email|phone|userId> --amount --env` —— 授予 credits。**改**：接 `resolveTargetUser`（支持手机号），位置参数 identifier，`--email` 兼容别名。
- `optima-entitlement grant|revoke|list <email|phone|userId> --env` —— **改**：cn-prod + cn-stage（基于 main 抽取的 resolver）。
- `optima-account status|ban|unban <email|phone|userId> --env` —— **新 bin**：
  - `status`（只读，聚合）：订阅(membership-status) + 权益(admin/entitlements) + 账号状态(is_active/banned) + **credits 余额**。
  - `ban --reason "..."`：user-auth `is_active=false`。prod/cn-prod confirm。**AWS 与 cn 都须在执行前打印解析到的目标账号（email/phone+userId）做反查回显**（见 R1）。
  - `unban`。

## 3. 每环境 鉴权 + 解析 矩阵

| 环境 | 身份 | userId 解析 | 解析 token | billing 写 | ban 写 |
|---|---|---|---|---|---|
| stage/prod (AWS) | email | RDS SSH 隧道 `resolveUserId(email)` | AWS Infisical | M2M client_credentials | **admin-用户 token（新）** |
| cn-prod/cn-stage (阿里云) | 手机号为主 | HTTP `/internal/users/lookup`(phone/email)+`getUserById`反查+`assertPhoneMatch` | M2M(cn, scope `internal:users:write`) | 同 M2M | **admin-用户 token（新）** |

**端点（已源码核实；impl T0 须逐环境真实请求复核，CLAUDE.md）**：
- 解析：user-auth `POST /api/v1/internal/users/lookup`、`GET /api/v1/internal/users/{id}`（M2M, verify_internal_service_token）。
- subscription 授予：billing `POST /api/billing/admin/grant-subscription`（requireAdminService/M2M）。
- subscription 状态：billing `GET /api/internal/users/{userId}/membership-status`（extractAnyServiceAuth/M2M）→ `{active, planId, status}`。**注意路径前缀 `/api/internal`，非 `/api/billing/admin`；用 callBilling(billing baseURL) 调（见 OPEN-4）**。
- entitlement：billing `POST /api/billing/admin/{grant,refund}-entitlement`、`GET /api/billing/admin/entitlements?userId=`。
- credits 授予：billing `POST /api/billing/admin/grant-credits`。
- credits 余额读取：**待 T0 确认 M2M 可读端点**（候选 billing internal/admin；若无则 status 的 credits 部分降级为"不可读"提示，不阻塞）。
- ban/unban：user-auth `POST /api/v1/admin/users/{id}/ban`(body `{reason}`)、`/unban`。鉴权 `get_current_admin_user`（role=ADMIN **用户** token，非 M2M）。

## 4. resolveTargetUser：从 main 抽取（**修正 r1-HIGH-1**）

**基线认知（已核实）**：当前 **main(0.8.0) 已完整支持 cn-stage**——`grant-subscription.ts` 的 cn 分支是 `if (env === 'cn-prod' || env === 'cn-stage')`（main grant-subscription.ts:127），billing-http 有 cn-stage URL/token 分支。**PR #33 是更旧、更窄的产物**：它抽出的 `resolveTargetUser` 只判 `env === 'cn-prod'`（#33 grant-subscription.ts:85），**会回归 cn-stage**。

**做法**：不要"移植 #33 的 resolver"。而是**从 main 现有的 inline cn-prod||cn-stage 逻辑抽出** `resolveTargetUser(env, identifier)`，保留 cn-stage；丢弃 #33 的 cn-prod-only 版本，只取它的 entitlement 接线思路。动代码前先 `diff` main 与 #33 的 cn 分支确认无遗漏。

```
kind = classifyIdentifier(identifier)        # email/phone/userId
assertAwsEmailOnly(env, kind)
if env in {cn-prod, cn-stage}:               # ← 必须含 cn-stage
    userId = resolveByPhone|Email|userId
    acct = getUserById(env, userId); 打印 🎯 目标账号
    if kind == phone: assertPhoneMatch(...)
else (stage/prod):
    userId = resolveUserId(email) via SSH 隧道
    打印 🎯 目标账号(email + userId)            # ← R1：AWS 也要回显
```
T2/T3/T5 全部依赖此函数（T1 先行）。

## 5. ban/unban 鉴权设计

- M2M token 无 user_id → 调 ban 404。须 **admin 用户**(role=ADMIN) **password grant**。
- **复用 generate-test-token 已验证的 per-env public ROPC client**（修正 r1-HIGH-2，原 spec 的 `agent-portal-bc0osnsd` 作废）：
  - stage `commerce-cli-stage-ihbbwplz` / prod `commerce-cli-ecs-pro-i2r5of1h` / cn-prod `dev-skill-cli-cn-pro-acvkmcuq` / cn-stage `dev-skill-cli-cn-sta-3dvsxzdo`。
- userId 解析仍走 §4 `resolveTargetUser`（M2M lookup）；**仅最后 ban/unban 调用换 admin-用户 token**（无 chicken-and-egg，r1 已确认）。
- 新增 `getAdminUserToken(env)`：读 admin email/password → password-grant → curl `oauth/token`。**独立缓存**，不复用 `billing-http.tokenCache`（M2M 缓存），避免冲突（R2）。
- 新增 `callUserAuthAsAdmin(env, method, path, body)`：base=`USER_AUTH_URLS[env]` + admin-用户 bearer。当前仅有 `callBilling`/`callSkills`，无 user-auth helper（R4）。

### admin 账号凭证（OPEN-1，部分解决）
- **cn-prod 已确认可取**：1P item `okshqmbbtu4oes6jhjiz6byojm`（"user-auth cn-prod admin (seed password)"）→ username `admin@optima.chat` + password，经 `op.exe`（已登录）。
- **分发性问题**：1P/op.exe 是个人凭证源，CLI 是团队共享工具 → 运行时应从 **Infisical** 读 admin password（与 M2M secret 同模式）：AWS 三环境 → AWS Infisical 对应 env；cn-stage → cn Infisical staging（访问路径已通，见 R3）；cn-prod 值可从上述 1P 灌入 Infisical。
- **剩余 OPEN-1**：stage/prod/cn-stage 是否已有 role=ADMIN 账号？只有 cn-prod 确认存在。需用户确认 / 发现 / 创建 + 定 Infisical key 落点。

## 6. 验收标准
- `npm run build`（tsc）绿；repo 既有 lint/test 通过。
- 单测：classify/assertPhoneMatch/assertAwsEmailOnly 保持；新增 `resolveTargetUser` 的 cn-stage 路由用例、`getAdminUserToken` 缓存隔离用例（mock）。
- 各命令 ×4 环境 `--help` 正确。
- T0 真实只读复核 6 类端点 ×相关环境（非 404/200）。
- `account status <真实用户>` 4 环境各跑一次（只读）；ban/unban 在 stage/cn-stage 用测试账号实跑闭环；prod/cn-prod 仅用户授权下。
- 向后兼容 `--email`。

## 7. 任务分解
- **T0**：逐环境真实请求复核 6 类端点（含 membership-status on AWS、credits 余额读取候选）。
- **T1**：从 main 抽 `resolveTargetUser`（含 cn-stage）+ 单测。（被 T2/T3/T5 依赖）
- **T2**：grant-balance 接 `resolveTargetUser`（identifier + 手机号）。依赖 T1。
- **T3**：entitlement grant/list/revoke 落地（cn-prod+cn-stage，基于 main 抽取）。依赖 T1。
- **T4**：`optima-account status`（membership-status + entitlements + 账号状态 + credits 余额聚合，只读）。依赖 T1。
- **T5**：`getAdminUserToken` + `callUserAuthAsAdmin` + `optima-account ban/unban`（含 AWS 反查回显）。依赖 T1 + OPEN-1。
- **T6**：SKILL.md/README/bin 注册/help 同步 4 环境。
- **T7**：final review + 真实环境验证 + 处理 PR #33（关闭或重定向并改正描述）。

## OPEN ITEMS
- **OPEN-1（部分）**：stage/prod/cn-stage 的 admin 账号是否存在 + admin password 落 Infisical 的 key 名。阻塞 T5。
- **OPEN-4（验证项）**：membership-status 经 callBilling+M2M 在 AWS 是否可读；credits 余额的 M2M 读取端点（T0 解决）。
- ~~OPEN-2~~ 已定：`optima-account` 聚合。
- ~~OPEN-3~~ 已定：status 含 credits 余额。
