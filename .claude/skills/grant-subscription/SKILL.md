---
name: "grant-subscription"
description: "当用户请求开通会员、赠送订阅、grant subscription、开通 Pro/Starter/Enterprise、升级计划、给用户开会员时，使用此技能。支持 Stage、Prod 两个环境。"
allowed-tools: ["Bash"]
---

# 开通/赠送订阅

当你需要为用户开通会员计划时，使用这个场景。

## 执行方式：使用 CLI 工具

**重要**：无论用户使用 `/grant-subscription` 命令还是直接请求开通会员，都应该使用 `optima-grant-subscription` CLI 工具：

```bash
optima-grant-subscription <email> [options]
```

**为什么使用 CLI 工具**：
- 自动通过 email 查找 userId（跨 user-auth 数据库）
- 自动处理 SSH 隧道和数据库连接
- 自动取消旧订阅、经 billing API supersede 旧授予（void 旧 subscription lot + 发新）
- 自动按 plan 配置发放 subscription 积分（期末过期）和 token quota
- 一条命令完成所有操作

## 适用情况

- 给用户开通/赠送 Pro、Starter、Enterprise 等会员
- 升级用户的计划
- 为企业客户定制订阅
- 处理用户会员相关请求

## 快速操作

### 基本使用

```bash
# 开通 Pro（默认），Stage 环境（默认）
optima-grant-subscription user@example.com

# 开通 Pro，Prod 环境
optima-grant-subscription user@example.com --env prod

# 开通 Starter，3 个月
optima-grant-subscription user@example.com --plan starter --months 3

# 开通 Enterprise，Prod 环境
optima-grant-subscription user@example.com --plan enterprise --env prod
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<email>` | 用户邮箱（必填） | - |
| `--plan <id>` | 计划：trial, starter, pro, enterprise | pro |
| `--months <n>` | 时长（月） | 1 |
| `--env <env>` | 环境：stage, prod | stage |

### 计划配置

| Plan | 月授予额 (USD) | Credits 等价 | Session Token | Weekly Token |
|------|---------------|-------------|---------------|--------------|
| trial | $0.20 | 20 | 400K | 1M |
| starter | $5.00 | 500 | 2M | 10M |
| pro | $20.00 | 2,000 | 8M | 40M |
| enterprise | $100.00 | 10,000 | 16M | 80M |

> 积分经 billing API 发放（subscription 桶，期末过期；P15 后无 wallet）

## 常见使用场景

### 场景 1：给用户开通 Pro 会员

**用户请求**："帮 xxx@gmail.com 开通 Pro"

```bash
optima-grant-subscription xxx@gmail.com --plan pro --env prod
```

### 场景 2：企业客户定制

**用户请求**："给企业客户开 Enterprise，6 个月"

```bash
optima-grant-subscription client@company.com --plan enterprise --months 6 --env prod
```

### 场景 3：升级到 Starter

**用户请求**："把这个用户升级到 Starter"

```bash
optima-grant-subscription user@example.com --plan starter --env prod
```

## 执行流程

工具会自动完成以下步骤：

1. 通过 email 在 user-auth 数据库查找 userId
2. 加载对应 plan 的配置（月授予额、token 限额等）
3. 取消该用户的所有活跃订阅
4. 创建新订阅（设置到期时间）
5. 经 billing API supersede 旧授予（void 旧 subscription lot + 发新） 并授予新额度
6. 记录 topup 审计记录（source: subscription_grant）
7. 更新 token quota 限额

## 安全提醒

1. **Stage 优先**：默认操作 Stage 环境
2. **Prod 谨慎**：操作 Prod 前确认用户邮箱正确
3. **不可逆**：旧订阅会被取消，granted balance 会被重置
4. **确认 email**：执行前务必确认邮箱地址无误

## 相关命令

- `optima-grant-subscription` - 开通订阅（主要方式）
- `optima-grant-balance` - 单独赠送 wallet 余额
- `optima-query-db` - 查询数据库验证结果
