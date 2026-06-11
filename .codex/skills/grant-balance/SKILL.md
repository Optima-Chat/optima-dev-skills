---
name: "grant-balance"
description: "Use when the user wants to grant credits (bonus, 30-day expiry) to an Optima user — for promotional grants, compensation, referral rewards, etc. $1 = 700 credits via billing API; does not affect subscriptions."
---

# 赠送 USD 余额（Grant Balance）

当你需要为用户赠送 wallet USD 余额时，使用这个场景。金额按 $1=700 积分换算，经 billing API 入 **bonus 积分桶（30 天有效期）**（P15 钱包退役后语义），billing 服务在扣费时会优先消费 granted balance。

## 执行方式：使用 CLI 工具

```bash
optima-grant-balance <email> --amount <usd> [options]
```

**为什么使用 CLI 工具**：
- 自动通过 email 查找 userId（跨 user-auth 数据库）
- 自动处理 SSH 隧道和数据库连接
- 不会影响现有订阅和已有余额（发放 bonus 积分（30 天有效期，重复执行会叠加发放））
- 自动留审计痕迹（credit_lot 行，幂等键前缀 `dev-skills-grant:`）

## 适用情况

- 奖励额外余额（推广、活动）
- 客户补偿（服务中断等）
- 推荐奖励
- 内部测试账户充值

## 快速操作

```bash
# 赠送 $5（Stage 环境，默认）
optima-grant-balance user@example.com --amount 5

# 赠送 $10 到 Prod
optima-grant-balance user@example.com --amount 10 --env prod

# 带描述（Reason 仅在 console 输出，不存 DB）
optima-grant-balance user@example.com --amount 20 --description "服务中断补偿" --env prod
```

> **单位是美元（USD）**。`--amount 5` 即赠送 $5.00 到 granted balance。
> 数据库底层用 micro-USD 精度（1 USD = 700 积分（P15 统一账本口径）

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<email>` | 用户邮箱（必填） | - |
| `--amount <usd>` | USD 金额（必填，> 0） | - |
| `--description <text>` | 描述/原因（仅 console 输出） | - |
| `--env <env>` | 环境：stage, prod, cn-prod | stage |

> **cn-prod**：走 HTTPS（auth-cn/billing-cn.optima.chat），email 查找经 user-auth internal lookup API（无 SSH 隧道）。金额输入仍是 USD（$1 = 700 积分 = ¥7 档积分口径一致）。

## 与 grant-subscription 的区别

| | grant-balance | grant-subscription |
|---|---|---|
| 作用 | 追加 USD granted balance | 开通/切换订阅计划 |
| 现有余额 | 不影响（纯累加） | 重置 granted balance |
| 现有订阅 | 不影响 | 取消旧的，创建新的 |
| Token quota | 不影响 | 按计划更新 |
| 适用场景 | 奖励、补偿、推广 | 开通会员、升级计划 |

## 常见使用场景

### 场景 1：客户补偿

**用户请求**："服务出了问题，给 xxx@gmail.com 补偿 $5"

```bash
optima-grant-balance xxx@gmail.com --amount 5 --description "Service outage compensation" --env prod
```

### 场景 2：推荐奖励

**用户请求**："xxx 推荐了新用户，奖励 $3"

```bash
optima-grant-balance xxx@gmail.com --amount 3 --description "Referral reward" --env prod
```

### 场景 3：运营发放

**用户请求**："给 xxx@gmail.com 充 $20 测试余额"

```bash
optima-grant-balance xxx@gmail.com --amount 20 --env stage
```

## 安全提醒

1. **Stage 优先**：默认操作 Stage 环境
2. **Prod 谨慎**：操作 Prod 前确认邮箱和金额
3. **纯追加**：不会影响现有余额和订阅（累加到 granted balance）
4. **Audit trail**：每次赠送对应一个 credit_lot（幂等键前缀 `dev-skills-grant:`，type=bonus）

## 相关命令

- `optima-grant-balance` - 赠送 USD 余额（主要方式）
- `optima-grant-subscription` - 开通订阅计划
- `optima-query-db` - 查询数据库验证结果（`GET /api/billing/balance（credits.byType.bonus）或 query-db credit_lot
