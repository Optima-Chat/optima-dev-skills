---
name: "grant-credits"
description: "当用户请求赠送积分、发放积分、加积分、grant credits、充值积分、赠送余额（旧称）、奖励、补偿、推荐奖励、运营发放时，使用此技能。支持 Stage、Prod、cn-prod、cn-stage 四个环境；标识符支持邮箱/手机号/userId。"
allowed-tools: ["Bash"]
---

# 发放积分（Grant Credits）

为用户赠送积分（**bonus 积分桶，30 天有效期**）。经 billing 服务态端点 `POST /api/billing/admin/grant-credits` 入账，扣费时优先消费。

> **命名历史**：本命令原名 `grant-credits`（按积分）→ 余额时代曾改名 `grant-balance` + 改吃 USD → P15 钱包退役回归积分后改回 `grant-credits` + `--credits` 原生按积分。`optima-grant-balance` 仍作**废弃别名**保留（会打弃用提示）。

## 执行方式：使用 CLI 工具

```bash
optima-grant-credits <email|phone|userId> --credits <n> [options]
```

**为什么用 CLI**：自动通过 email/手机号/userId 查 userId（cn 走 HTTP lookup、AWS 走 SSH 隧道）+ 执行前打印 `🎯 目标账号` 反查 + 留审计痕迹（credit_lot，幂等键前缀 `dev-skills-grant:`）+ 不影响订阅和已有积分（纯累加 bonus 桶）。

### 参数

| 参数 | 说明 | 默认 |
|------|------|------|
| `<email\|phone\|userId>` | 用户标识（必填；cn 支持手机号/userId） | - |
| `--credits <n>` | **赠送积分数（整数 ≥1，主单位）** | - |
| `--amount <usd>` | 备选：按 USD 赠送（$1 = 700 积分）。`--credits` / `--amount` **二选一** | - |
| `--description <text>` | 描述/原因（仅 console 输出，不存 DB） | - |
| `--env <env>` | stage, prod, cn-prod, cn-stage | stage |

## 快速操作

```bash
# 送 10000 积分（Prod）
optima-grant-credits user@example.com --credits 10000 --env prod

# cn-prod 手机号用户送 5000 积分
optima-grant-credits 18898654855 --credits 5000 --env cn-prod

# 按 USD 送（= 3500 积分），补偿场景
optima-grant-credits user@example.com --amount 5 --description "服务中断补偿" --env prod
```

> 单位默认是**积分**。要按美元用 `--amount`（$1=700 积分）。两者只能给一个。

## 适用场景
奖励/活动、客户补偿、推荐奖励、内部测试账户充值。

## 与 grant-subscription 的区别

| | grant-credits | grant-subscription |
|---|---|---|
| 作用 | 追加 bonus 积分（30 天） | 开通/切换订阅计划 |
| 现有积分 | 不影响（纯累加） | 重置 granted |
| 现有订阅 | 不影响 | 取消旧的、建新的 |
| 适用 | 奖励、补偿、推广 | 开会员、升级计划 |

## 安全提醒
1. **Prod / cn-prod 谨慎**：执行前确认打印的 `🎯 目标账号`（手机/email/userId）与积分数。
2. **纯追加**：不影响现有积分和订阅；重复执行会叠加。
3. **30 天有效期**：bonus 桶到期作废。

## 相关命令
- `optima-grant-subscription` - 开通订阅
- `optima-account status` - 查用户订阅+权益
- `optima-query-db` / billing `GET /api/billing/balance` - 核对积分余额
