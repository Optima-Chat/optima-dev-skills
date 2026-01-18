---
name: "query-db"
description: "当用户请求查询数据库、执行SQL、查看数据、统计数据、检查数据库、查询表、数据库查询时，使用此技能。支持 CI、Stage、Prod 三个环境的 commerce-backend、user-auth、agentic-chat、bi-backend、session-gateway 服务的数据库查询。优先使用 optima-query-db CLI 工具。"
allowed-tools: ["Bash", "SlashCommand"]
---

# 查询数据库

当你需要执行 SQL 查询检查数据时，使用这个场景。

## 🎯 执行方式：统一使用 CLI 工具

**重要**：无论用户使用 `/query-db` 命令还是直接请求查询数据库，都应该使用 `optima-query-db` CLI 工具：

```bash
optima-query-db <service> "<sql>" [environment]
```

**为什么使用 CLI 工具**：
- ✅ 统一实现，避免重复代码
- ✅ 自动处理所有环境差异
- ✅ 自动获取 Infisical 配置和密钥
- ✅ 自动管理 SSH 隧道（Stage/Prod）
- ✅ 更简洁，一条命令搞定

**示例**：
```bash
# 用户说："查一下 CI 环境的 user-auth 数据库有多少用户"
# 执行:
optima-query-db user-auth "SELECT COUNT(*) FROM users"

# 用户说："查询 Stage 环境的商品数量"
# 执行:
optima-query-db commerce-backend "SELECT COUNT(*) FROM products" stage

# 用户输入: /query-db user-auth "SELECT COUNT(*) FROM users" prod
# 执行:
optima-query-db user-auth "SELECT COUNT(*) FROM users" prod
```

## 🎯 适用情况

- 验证数据是否正确插入/更新
- 统计数据（用户数、订单数等）
- 排查数据问题
- 检查数据库状态
- 开发调试时查看数据

## 🚀 快速操作

### 使用 CLI 工具（推荐）

```bash
# CI 环境（默认）
optima-query-db commerce-backend "SELECT COUNT(*) FROM products"
optima-query-db user-auth "SELECT email FROM users LIMIT 5"

# Stage 环境
optima-query-db commerce-backend "SELECT COUNT(*) FROM orders" stage

# Prod 环境
optima-query-db commerce-backend "SELECT status, COUNT(*) FROM orders GROUP BY status" prod
```

### 使用 Slash 命令（备用）

```
/query-db commerce-backend "SELECT COUNT(*) FROM products"
/query-db user-auth "SELECT COUNT(*) FROM users" stage
/query-db commerce-backend "SELECT * FROM products LIMIT 5" prod
```

**常用服务**：
- `commerce-backend` - 电商数据库
- `user-auth` - 用户认证数据库
- `agentic-chat` - AI 聊天数据库
- `bi-backend` - BI 后端数据库
- `session-gateway` - AI Shell 网关数据库

### 常用查询示例

```bash
# 统计查询
optima-query-db commerce-backend "SELECT COUNT(*) FROM products WHERE status='active'"

# 查看最新数据
optima-query-db user-auth "SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT 10"

# 聚合统计
optima-query-db commerce-backend "SELECT status, COUNT(*) as count FROM orders GROUP BY status"

# 检查特定记录
optima-query-db user-auth "SELECT * FROM users WHERE email='user@example.com'"
```

## 📋 常见使用场景

### 场景 1：验证新功能

**步骤**：
1. 创建数据后查询：`optima-query-db commerce-backend "SELECT * FROM products WHERE title='新商品'"`
2. 检查关联数据：`optima-query-db commerce-backend "SELECT * FROM product_variants WHERE product_id=123"`

### 场景 2：数据统计

**步骤**：
1. 统计总数：`optima-query-db user-auth "SELECT COUNT(*) FROM users"`
2. 分组统计：`optima-query-db commerce-backend "SELECT DATE(created_at), COUNT(*) FROM orders GROUP BY DATE(created_at)"`

### 场景 3：排查问题

**步骤**：
1. 查找异常数据：`optima-query-db commerce-backend "SELECT * FROM orders WHERE status IS NULL"`
2. 检查重复数据：`optima-query-db user-auth "SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1"`

## ⚠️ 安全提示

### 生产环境规则

1. **只读查询**: 只使用 SELECT，不能 INSERT/UPDATE/DELETE
2. **限制返回**: 使用 LIMIT 限制返回行数
3. **避免全表**: 使用 WHERE 条件
4. **不查敏感数据**: 避免查询密码、密钥等

### 安全查询示例

```bash
# ✅ 好的查询
optima-query-db commerce-backend "SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '1 day'" prod
optima-query-db user-auth "SELECT id, email FROM users LIMIT 10" prod

# ❌ 不好的查询
# optima-query-db commerce-backend "SELECT * FROM orders" prod  (全表扫描)
# optima-query-db user-auth "SELECT password_hash FROM users" prod  (敏感数据)
```

## 💡 最佳实践

1. **开发用 CI**: 调试和验证优先用 CI 环境
2. **生产只读**: Prod 环境只查看，不修改
3. **使用聚合**: COUNT/SUM/AVG 比 SELECT * 更好
4. **添加限制**: 总是使用 LIMIT
5. **指定列名**: 避免 SELECT *

## 🌐 环境对比

### CI 环境

```bash
optima-query-db commerce-backend "SELECT COUNT(*) FROM products"
```

**特点**：
- 开发环境，可以任意查询和修改
- 数据可以随时重置
- 通过 SSH + Docker 容器访问

### Stage 环境

```bash
optima-query-db commerce-backend "SELECT COUNT(*) FROM orders" stage
```

**特点**：
- 预发布环境
- 数据接近生产
- 通过 SSH 隧道访问 RDS

### Prod 环境

```bash
optima-query-db commerce-backend "SELECT status, COUNT(*) FROM orders GROUP BY status" prod
```

**特点**：
- 生产环境
- 真实用户数据
- 通过 SSH 隧道访问 RDS
- ⚠️ 谨慎使用

## 🔧 技术架构

### Infisical 配置（v0.7.0+）

数据库凭证从 Infisical 动态获取：
- **项目**: `optima-secrets-v2`
- **路径**: `/shared-secrets/database-users`
- **环境**: Stage 用 `staging`，Prod 用 `prod`

**凭证 Key 映射**：
| 服务 | 用户 Key | 密码 Key |
|------|----------|----------|
| commerce-backend | `COMMERCE_DB_USER` | `COMMERCE_DB_PASSWORD` |
| user-auth | `AUTH_DB_USER` | `AUTH_DB_PASSWORD` |
| agentic-chat | `CHAT_DB_USER` | `CHAT_DB_PASSWORD` |
| bi-backend | `BI_DB_USER` | `BI_DB_PASSWORD` |
| session-gateway | `AI_SHELL_DB_USER` | `AI_SHELL_DB_PASSWORD` |

### RDS 连接

| 环境 | RDS Host | 本地端口 |
|------|----------|----------|
| Stage | `optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com` | 15432 |
| Prod | `optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com` | 15433 |

**跳板机**: `13.251.46.219` (Shared EC2)

## 🔗 相关命令

- `optima-query-db` - CLI 查询工具（推荐）
- `/query-db` - Slash 命令（备用方式，详细使用方法请查看 `/query-db --help`）
