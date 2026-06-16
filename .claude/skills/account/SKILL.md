---
name: "account"
description: "当用户请求查看账号状态、查询某用户的订阅/权益、禁用账号、封禁用户、ban、停用账号、解封、恢复账号、unban 时，使用此技能。支持 stage、prod、cn-prod、cn-stage 四个环境；标识符支持邮箱/手机号/userId。"
allowed-tools: ["Bash"]
---

# 账号运营（status / ban / unban）

以用户为中心的运营 admin 操作：查状态、禁用、恢复。CLI：`optima-account`。

标识符 `<email|phone|userId>`：**cn-prod / cn-stage 用户多为手机号注册**，三种都支持；AWS stage/prod 仅 email（经 RDS SSH 隧道解析）。执行前都会打印 `🎯 目标账号` 反查回显，防止发错账号。

## 执行方式

```bash
optima-account status <email|phone|userId> --env <env>
optima-account ban   <email|phone|userId> --reason "..." --env <env> [--yes]
optima-account unban <email|phone|userId> --env <env> [--yes]
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `<email\|phone\|userId>` | 用户标识（必填）；cn 支持手机号/userId | - |
| `--reason "..."` | 禁用原因（**ban 必填**） | - |
| `--env <env>` | stage / prod / cn-prod / cn-stage | stage |
| `--yes` | 跳过 prod / cn-prod 的确认提示 | - |

## status（只读聚合）

显示：订阅（membership-status）+ 权益（entitlements）。纯 M2M，无需 admin 凭证。

```bash
optima-account status 18898654855 --env cn-prod
```
> ⚠️ 账号禁用状态（banned_at/原因）与 credits 余额**暂不显示**——无 M2M 读取端点，见 optima-dev-skills#36。

## ban / unban（需 admin-用户 token）

走 user-auth `/api/v1/admin/users/{id}/{ban,unban}`，鉴权用 **admin 用户 token**（ROPC password grant，凭证读 Infisical `/shared-secrets/credentials`）。

- **cn-prod / cn-stage** 需运行时设 `INFISICAL_CN_EMAIL` / `INFISICAL_CN_PASSWORD`（读 cn Infisical）。
- **prod / cn-prod**（两个生产环境）执行前要求输入 `yes` 确认；`--yes` 可跳过。

```bash
optima-account ban user@example.com --reason "abuse" --env prod
optima-account unban 18898654855 --env cn-prod
```

> ⚠️ **ban 不是即时踢会话**：仅置 `is_active=false`，挡新登录/刷新，但**已签发的 access token 仍有效到过期**。需要立即失效在线会话的能力是 user-auth 后续支持项。

## 安全提醒

1. ban/unban 前看清打印的 `🎯 目标账号`（手机/email/userId）。
2. prod / cn-prod 是生产，确认无误再 `yes`。
3. ban 是名义禁用，活跃会话不会立刻断——别误以为已立即封死。

## 相关命令

- `optima-grant-subscription` / `optima-grant-balance` - 开通会员 / 赠送 credits
- `optima-entitlement` - 产品权益授予/撤销/查询
- `optima-query-db` - 直查数据库核对（如 `is_active` / `banned_at`）
