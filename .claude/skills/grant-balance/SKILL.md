---
name: "grant-balance"
description: "当用户请求赠送余额、充值 USD 余额、grant balance、加余额、奖励、补偿、推荐奖励、运营发放时，使用此技能。支持 Stage、Prod 两个环境。"
allowed-tools: ["Bash"]
---

# 赠送 USD 余额（Grant Balance）

当你需要为用户赠送 wallet USD 余额时，使用这个场景。金额会加到 `usd_wallets.granted_balance_micros`，billing 服务在扣费时会优先消费 granted balance。

## 执行方式：使用 CLI 工具

```bash
optima-grant-balance <email> --amount <usd> [options]
```

**为什么使用 CLI 工具**：
- 自动通过 email 查找 userId（跨 user-auth 数据库）
- 自动处理 SSH 隧道和数据库连接
- 不会影响现有订阅和已有余额（纯追加到 granted balance）
- 自动写入 audit trail（`usd_wallet_topups` source=admin_grant）

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
> 数据库底层用 micro-USD 精度（1 USD = 1,000,000 micros），CLI 自动换算。

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<email>` | 用户邮箱（必填） | - |
| `--amount <usd>` | USD 金额（必填，> 0） | - |
| `--description <text>` | 描述/原因（仅 console 输出） | - |
| `--env <env>` | 环境：stage, prod | stage |

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
4. **Audit trail**：每次赠送会插入一条 `usd_wallet_topups` 记录（source=`admin_grant`）

## 相关命令

- `optima-grant-balance` - 赠送 USD 余额（主要方式）
- `optima-grant-subscription` - 开通订阅计划
- `optima-query-db` - 查询数据库验证结果（`SELECT granted_balance_micros FROM usd_wallets WHERE user_id=...`）
