# /query-db - 查询数据库

执行 SQL 查询，支持 CI/Stage/Prod 三个环境。

**版本**: v0.3.0

## 使用场景

**开发者**: 快速查询数据验证功能
**调试**: 检查数据库状态、排查数据问题
**运维**: 查看生产数据、统计分析

## 用法

```
/query-db <service> <sql> [environment]
```

## 参数

- `service` (必需): 服务名称
  - `commerce-backend` - 电商后端数据库
  - `user-auth` - 用户认证数据库
  - `mcp-host` - MCP 协调器数据库
  - `agentic-chat` - AI 聊天服务数据库
- `sql` (必需): SQL 查询语句（用引号包裹）
- `environment` (可选): 环境，默认 ci
  - `ci` - CI 持续集成环境（开发环境，默认）
  - `stage` - Stage 预发布环境
  - `prod` - Prod 生产环境（⚠️ 谨慎使用）

## 示例

```bash
/query-db commerce-backend "SELECT COUNT(*) FROM products"                    # CI 环境（默认）
/query-db user-auth "SELECT email FROM users LIMIT 5"                        # CI 环境
/query-db commerce-backend "SELECT * FROM orders WHERE status='pending'" ci  # CI 环境
/query-db user-auth "SELECT COUNT(*) FROM users" stage                       # Stage 环境
/query-db commerce-backend "SELECT * FROM products LIMIT 10" prod            # Prod 环境（只读）
```

## 特殊参数处理

如果用户输入 `/query-db` 或 `/query-db --help`，显示此帮助文档，不执行查询。

## Claude Code 执行步骤

**重要提示**：根据用户指定的 `environment` 参数选择执行方式：
- `ci` 或未指定 → 通过 SSH 连接 Docker Postgres（第 0 节，默认）
- `stage` → 通过 AWS RDS 端点连接（第 1 节）
- `prod` → 通过 AWS RDS 端点连接（第 2 节，⚠️ 只读）

### 0. CI 环境（environment = "ci" 或默认）

**访问方式**: SSH + Docker Exec

**步骤**:
```bash
# IMPORTANT: 使用单行命令

# 获取 CI 服务器配置
CI_USER=$(gh variable get CI_SSH_USER -R Optima-Chat/optima-dev-skills)
CI_HOST=$(gh variable get CI_SSH_HOST -R Optima-Chat/optima-dev-skills)
CI_PASSWORD=$(gh variable get CI_SSH_PASSWORD -R Optima-Chat/optima-dev-skills)

# 执行查询（根据服务选择不同的数据库）
sshpass -p "$CI_PASSWORD" ssh -o StrictHostKeyChecking=no ${CI_USER}@${CI_HOST} "docker exec commerce-postgres psql -U commerce -d commerce -c \"SELECT COUNT(*) FROM products\""
```

**数据库配置映射**：
- `commerce-backend`:
  - 容器: `commerce-postgres`
  - 用户: `commerce`
  - 密码: `commerce123`
  - 数据库: `commerce`

- `user-auth`:
  - 容器: `user-auth-postgres-1`
  - 用户: `userauth`
  - 密码: `password123`
  - 数据库: `userauth`

- `mcp-host`:
  - 容器: `mcp-host-db-1`
  - 用户: `mcp_user`
  - 密码: `mcp_password`
  - 数据库: `mcp_host`

- `agentic-chat`:
  - 容器: `optima-postgres`
  - 用户: `postgres`
  - 密码: `postgres123`
  - 数据库: `optima_chat`

**完整命令示例**:
```bash
# 获取配置
CI_USER=$(gh variable get CI_SSH_USER -R Optima-Chat/optima-dev-skills)
CI_HOST=$(gh variable get CI_SSH_HOST -R Optima-Chat/optima-dev-skills)
CI_PASSWORD=$(gh variable get CI_SSH_PASSWORD -R Optima-Chat/optima-dev-skills)

# commerce-backend
sshpass -p "$CI_PASSWORD" ssh -o StrictHostKeyChecking=no ${CI_USER}@${CI_HOST} "docker exec commerce-postgres psql -U commerce -d commerce -c \"SELECT COUNT(*) FROM products\""

# user-auth
sshpass -p "$CI_PASSWORD" ssh -o StrictHostKeyChecking=no ${CI_USER}@${CI_HOST} "docker exec user-auth-postgres-1 psql -U userauth -d userauth -c \"SELECT COUNT(*) FROM users\""

# mcp-host
sshpass -p "$CI_PASSWORD" ssh -o StrictHostKeyChecking=no ${CI_USER}@${CI_HOST} "docker exec mcp-host-db-1 psql -U mcp_user -d mcp_host -c \"SELECT COUNT(*) FROM sessions\""

# agentic-chat
sshpass -p "$CI_PASSWORD" ssh -o StrictHostKeyChecking=no ${CI_USER}@${CI_HOST} "docker exec optima-postgres psql -U postgres -d optima_chat -c \"SELECT COUNT(*) FROM conversations\""
```

### 1. Stage 环境（environment = "stage"）

**访问方式**: AWS RDS 直连（需要配置）

**步骤**:
```bash
# IMPORTANT: 使用单行命令

# 从 GitHub Variables 获取 RDS 配置
STAGE_DB_HOST=$(gh variable get STAGE_DB_HOST -R Optima-Chat/optima-dev-skills)
STAGE_DB_PASSWORD=$(gh variable get STAGE_DB_PASSWORD -R Optima-Chat/optima-dev-skills)

# 执行查询
PGPASSWORD="$STAGE_DB_PASSWORD" psql -h "$STAGE_DB_HOST" -U commerce -d commerce -c "SELECT COUNT(*) FROM products"
```

**数据库配置**（需要设置 GitHub Variables）：
- `STAGE_DB_HOST` - RDS 端点
- `STAGE_DB_PASSWORD` - 数据库密码
- 每个服务可能有独立的数据库

### 2. Prod 环境（environment = "prod"）

**访问方式**: AWS RDS 直连（⚠️ 只读用户）

**步骤**:
```bash
# IMPORTANT: 使用单行命令
# ⚠️ 生产环境只允许只读查询

# 从 GitHub Variables 获取 RDS 配置
PROD_DB_HOST=$(gh variable get PROD_DB_HOST -R Optima-Chat/optima-dev-skills)
PROD_DB_PASSWORD=$(gh variable get PROD_DB_PASSWORD -R Optima-Chat/optima-dev-skills)

# 执行查询（只读）
PGPASSWORD="$PROD_DB_PASSWORD" psql -h "$PROD_DB_HOST" -U commerce_readonly -d commerce -c "SELECT COUNT(*) FROM products"
```

**⚠️ 生产环境安全规则**：
1. **只使用只读用户** (`commerce_readonly`, `userauth_readonly`)
2. **禁止 INSERT/UPDATE/DELETE**
3. **谨慎使用 SELECT***，优先指定列名
4. **添加 LIMIT** 防止查询过多数据

## 安全注意事项

### SQL 注入防护

**❌ 危险示例**:
```bash
# 不要直接拼接用户输入
/query-db commerce-backend "SELECT * FROM products WHERE id=$USER_INPUT"
```

**✅ 安全示例**:
```bash
# 使用参数化查询或明确的值
/query-db commerce-backend "SELECT * FROM products WHERE id=123"
```

### 生产环境规则

1. **只读查询**: 生产环境只允许 SELECT
2. **限制返回行数**: 使用 LIMIT
3. **避免全表扫描**: 使用 WHERE 条件
4. **敏感数据**: 不查询密码、密钥等敏感字段

### 常见安全查询

```bash
# ✅ 统计查询
/query-db commerce-backend "SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '1 day'" prod

# ✅ 限制行数
/query-db user-auth "SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT 10" prod

# ✅ 聚合查询
/query-db commerce-backend "SELECT status, COUNT(*) FROM orders GROUP BY status" prod

# ❌ 危险：全表查询
# /query-db commerce-backend "SELECT * FROM orders" prod

# ❌ 危险：敏感字段
# /query-db user-auth "SELECT password_hash FROM users" prod
```

## 常见错误处理

### 错误：Connection refused

**原因**: 数据库未运行或网络不通

**解决**:
```bash
# CI: 检查容器状态
sshpass -p "$CI_PASSWORD" ssh ${CI_USER}@${CI_HOST} "docker ps | grep postgres"

# Stage/Prod: 检查安全组和网络配置
```

### 错误：Authentication failed

**原因**: 用户名或密码错误

**解决**: 检查 GitHub Variables 配置是否正确

### 错误：Permission denied

**原因**: 生产环境使用了写操作

**解决**: 使用只读查询，移除 INSERT/UPDATE/DELETE

## 最佳实践

1. **默认使用 CI**: 开发调试优先用 CI 环境
2. **生产只读**: Prod 环境只用于查看数据，不修改
3. **添加 LIMIT**: 避免返回过多数据
4. **使用聚合**: COUNT/SUM/AVG 比 SELECT * 更安全
5. **索引查询**: 使用主键或索引字段提高性能

## 相关资源

- PostgreSQL 文档: https://www.postgresql.org/docs/
- AWS RDS 最佳实践: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/
