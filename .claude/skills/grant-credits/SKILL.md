---
name: "grant-credits"
description: "当用户请求赠送 credits、充值积分、grant credits、加 credits、奖励积分、补偿 credits、推荐奖励时，使用此技能。支持 Stage、Prod 两个环境。"
allowed-tools: ["Bash"]
---

# 赠送 Credits

当你需要为用户赠送额外 credits 时，使用这个场景。

## 执行方式：使用 CLI 工具

**重要**：使用 `optima-grant-credits` CLI 工具：

```bash
optima-grant-credits <email> --amount <n> [options]
```

**为什么使用 CLI 工具**：
- 自动通过 email 查找 userId（跨 user-auth 数据库）
- 自动处理 SSH 隧道和数据库连接
- 不会影响现有订阅和 credits（纯追加）
- 一条命令完成操作

## 适用情况

- 赠送额外 credits（奖励、补偿、推广等）
- 推荐奖励 credits
- 运营活动发放 credits
- 客户补偿

## 快速操作

```bash
# 赠送 100 bonus credits，Stage 环境（默认）
optima-grant-credits user@example.com --amount 100

# 赠送 500 bonus credits，Prod 环境
optima-grant-credits user@example.com --amount 500 --env prod

# 推荐奖励 credits
optima-grant-credits user@example.com --amount 200 --type referral --env prod

# 自定义描述
optima-grant-credits user@example.com --amount 300 --description "客户补偿 - 服务中断" --env prod
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<email>` | 用户邮箱（必填） | - |
| `--amount <n>` | Credits 数量（必填，>=1） | - |
| `--type <type>` | 类型：bonus, referral | bonus |
| `--description <text>` | 描述（可选） | Auto-generated |
| `--env <env>` | 环境：stage, prod | stage |

## 与 grant-subscription 的区别

| | grant-credits | grant-subscription |
|---|---|---|
| 作用 | 追加 credits | 开通/切换订阅计划 |
| 现有 credits | 不影响 | 清零后重新授予 |
| 现有订阅 | 不影响 | 取消旧的，创建新的 |
| Token quota | 不影响 | 按计划更新 |
| 适用场景 | 奖励、补偿、推广 | 开通会员、升级计划 |

## 常见使用场景

### 场景 1：奖励 credits

**用户请求**："给 xxx@gmail.com 加 200 credits"

```bash
optima-grant-credits xxx@gmail.com --amount 200 --env prod
```

### 场景 2：推荐奖励

**用户请求**："xxx 推荐了新用户，给他 referral 奖励 300"

```bash
optima-grant-credits xxx@gmail.com --amount 300 --type referral --env prod
```

### 场景 3：客户补偿

**用户请求**："服务出了问题，补偿 xxx 500 credits"

```bash
optima-grant-credits xxx@gmail.com --amount 500 --description "服务中断补偿" --env prod
```

## 安全提醒

1. **Stage 优先**：默认操作 Stage 环境
2. **Prod 谨慎**：操作 Prod 前确认邮箱和数量
3. **纯追加**：不会影响现有 credits 和订阅
4. **无过期**：bonus/referral credits 默认不设过期时间

## 相关命令

- `optima-grant-credits` - 赠送 credits（主要方式）
- `optima-grant-subscription` - 开通订阅计划
- `optima-query-db` - 查询数据库验证结果
