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

**访问方式**: 通过 EC2 SSH 隧道访问 RDS（通过 Infisical 获取密钥）

**前置条件**:
1. 获取 `optima-ec2-key` SSH 密钥文件（联系 xbfool）
2. 保存到 `~/.ssh/optima-ec2-key` 并设置权限: `chmod 600 ~/.ssh/optima-ec2-key`

**步骤**:
```bash
# IMPORTANT: 使用单行命令

# 1. 获取 Infisical 配置
INFISICAL_URL=$(gh variable get INFISICAL_URL -R Optima-Chat/optima-dev-skills)
INFISICAL_CLIENT_ID=$(gh variable get INFISICAL_CLIENT_ID -R Optima-Chat/optima-dev-skills)
INFISICAL_CLIENT_SECRET=$(gh variable get INFISICAL_CLIENT_SECRET -R Optima-Chat/optima-dev-skills)
INFISICAL_PROJECT_ID=$(gh variable get INFISICAL_PROJECT_ID -R Optima-Chat/optima-dev-skills)

# 2. 获取 Infisical Access Token
INFISICAL_TOKEN=$(curl -s -X POST "${INFISICAL_URL}/api/v1/auth/universal-auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\": \"${INFISICAL_CLIENT_ID}\", \"clientSecret\": \"${INFISICAL_CLIENT_SECRET}\"}" \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['accessToken'])")

# 3. 从 Infisical 获取数据库配置（以 commerce-backend 为例）
curl -s "${INFISICAL_URL}/api/v3/secrets/raw?workspaceId=${INFISICAL_PROJECT_ID}&environment=staging&secretPath=/infrastructure" \
  -H "Authorization: Bearer ${INFISICAL_TOKEN}" | python3 -c "
import sys, json
secrets = {s['secretKey']: s['secretValue'] for s in json.load(sys.stdin)['secrets']}
print(f\"DATABASE_HOST={secrets['DATABASE_HOST']}\")
print(f\"COMMERCE_DB_USER={secrets['COMMERCE_DB_USER']}\")
print(f\"COMMERCE_DB_PASSWORD={secrets['COMMERCE_DB_PASSWORD']}\")
" > /tmp/stage_db_config.sh && source /tmp/stage_db_config.sh

# 4. 建立 SSH 隧道到 Stage EC2，通过隧道访问 RDS
ssh -i ~/.ssh/optima-ec2-key -f -N -L 15432:${DATABASE_HOST}:5432 ec2-user@54.179.132.102

# 5. 通过本地端口 15432 连接到 RDS
PGPASSWORD="${COMMERCE_DB_PASSWORD}" psql -h localhost -p 15432 -U "${COMMERCE_DB_USER}" -d optima_stage_commerce -c "SELECT COUNT(*) FROM products"

# 6. 关闭 SSH 隧道（可选）
pkill -f "ssh.*15432:${DATABASE_HOST}:5432"
```

**完整示例（四个服务）**:
```bash
# commerce-backend
# 使用 COMMERCE_DB_USER, COMMERCE_DB_PASSWORD, 数据库: optima_stage_commerce

# user-auth
# 使用 AUTH_DB_USER, AUTH_DB_PASSWORD, 数据库: optima_stage_auth

# mcp-host
# 使用 MCP_DB_USER, MCP_DB_PASSWORD, 数据库: optima_stage_mcp

# agentic-chat
# 使用 CHAT_DB_USER, CHAT_DB_PASSWORD, 数据库: optima_stage_chat
```

**数据库配置映射**：
- `commerce-backend`:
  - 数据库: `optima_stage_commerce`
  - 用户: Infisical `COMMERCE_DB_USER`
  - 密码: Infisical `COMMERCE_DB_PASSWORD`

- `user-auth`:
  - 数据库: `optima_stage_auth`
  - 用户: Infisical `AUTH_DB_USER`
  - 密码: Infisical `AUTH_DB_PASSWORD`

- `mcp-host`:
  - 数据库: `optima_stage_mcp`
  - 用户: Infisical `MCP_DB_USER`
  - 密码: Infisical `MCP_DB_PASSWORD`

- `agentic-chat`:
  - 数据库: `optima_stage_chat`
  - 用户: Infisical `CHAT_DB_USER`
  - 密码: Infisical `CHAT_DB_PASSWORD`

**说明**:
- Infisical 配置从 GitHub Variables 获取
- 数据库密钥从 Infisical 动态获取（项目: optima-secrets, 环境: staging, 路径: /infrastructure）
- DATABASE_HOST: `optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com`
- Stage EC2 IP: `54.179.132.102`
- SSH 隧道: 本地端口 `15432` → EC2 → RDS `5432`
- Stage 和 Prod 共享同一个 RDS 实例，通过不同的数据库名隔离

### 2. Prod 环境（environment = "prod"）

**访问方式**: 通过 EC2 SSH 隧道访问 RDS（通过 Infisical 获取密钥）

**前置条件**:
1. 获取 `optima-ec2-key` SSH 密钥文件（联系 xbfool）
2. 保存到 `~/.ssh/optima-ec2-key` 并设置权限: `chmod 600 ~/.ssh/optima-ec2-key`

**步骤**:
```bash
# IMPORTANT: 使用单行命令
# ⚠️ 生产环境谨慎操作

# 1. 获取 Infisical 配置
INFISICAL_URL=$(gh variable get INFISICAL_URL -R Optima-Chat/optima-dev-skills)
INFISICAL_CLIENT_ID=$(gh variable get INFISICAL_CLIENT_ID -R Optima-Chat/optima-dev-skills)
INFISICAL_CLIENT_SECRET=$(gh variable get INFISICAL_CLIENT_SECRET -R Optima-Chat/optima-dev-skills)
INFISICAL_PROJECT_ID=$(gh variable get INFISICAL_PROJECT_ID -R Optima-Chat/optima-dev-skills)

# 2. 获取 Infisical Access Token
INFISICAL_TOKEN=$(curl -s -X POST "${INFISICAL_URL}/api/v1/auth/universal-auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\": \"${INFISICAL_CLIENT_ID}\", \"clientSecret\": \"${INFISICAL_CLIENT_SECRET}\"}" \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['accessToken'])")

# 3. 从 Infisical 获取数据库配置（以 commerce-backend 为例）
curl -s "${INFISICAL_URL}/api/v3/secrets/raw?workspaceId=${INFISICAL_PROJECT_ID}&environment=prod&secretPath=/infrastructure" \
  -H "Authorization: Bearer ${INFISICAL_TOKEN}" | python3 -c "
import sys, json
secrets = {s['secretKey']: s['secretValue'] for s in json.load(sys.stdin)['secrets']}
print(f\"DATABASE_HOST={secrets['DATABASE_HOST']}\")
print(f\"COMMERCE_DB_USER={secrets['COMMERCE_DB_USER']}\")
print(f\"COMMERCE_DB_PASSWORD={secrets['COMMERCE_DB_PASSWORD']}\")
" > /tmp/prod_db_config.sh && source /tmp/prod_db_config.sh

# 4. 建立 SSH 隧道到 Prod EC2，通过隧道访问 RDS
ssh -i ~/.ssh/optima-ec2-key -f -N -L 15433:${DATABASE_HOST}:5432 ec2-user@18.136.25.239

# 5. 通过本地端口 15433 连接到 RDS
PGPASSWORD="${COMMERCE_DB_PASSWORD}" psql -h localhost -p 15433 -U "${COMMERCE_DB_USER}" -d optima_commerce -c "SELECT COUNT(*) FROM products"

# 6. 关闭 SSH 隧道（可选）
pkill -f "ssh.*15433:${DATABASE_HOST}:5432"
```

**完整示例（四个服务）**:
```bash
# commerce-backend
# 使用 COMMERCE_DB_USER, COMMERCE_DB_PASSWORD, 数据库: optima_commerce

# user-auth
# 使用 AUTH_DB_USER, AUTH_DB_PASSWORD, 数据库: optima_auth

# mcp-host
# 使用 MCP_DB_USER, MCP_DB_PASSWORD, 数据库: optima_mcp

# agentic-chat
# 使用 CHAT_DB_USER, CHAT_DB_PASSWORD, 数据库: optima_chat
```

**数据库配置映射**：
- `commerce-backend`:
  - 数据库: `optima_commerce`
  - 用户: Infisical `COMMERCE_DB_USER`
  - 密码: Infisical `COMMERCE_DB_PASSWORD`

- `user-auth`:
  - 数据库: `optima_auth`
  - 用户: Infisical `AUTH_DB_USER`
  - 密码: Infisical `AUTH_DB_PASSWORD`

- `mcp-host`:
  - 数据库: `optima_mcp`
  - 用户: Infisical `MCP_DB_USER`
  - 密码: Infisical `MCP_DB_PASSWORD`

- `agentic-chat`:
  - 数据库: `optima_chat`
  - 用户: Infisical `CHAT_DB_USER`
  - 密码: Infisical `CHAT_DB_PASSWORD`

**说明**:
- Infisical 配置从 GitHub Variables 获取
- 数据库密钥从 Infisical 动态获取（项目: optima-secrets, 环境: prod, 路径: /infrastructure）
- DATABASE_HOST: `optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com`
- Prod EC2 IP: `18.136.25.239`
- SSH 隧道: 本地端口 `15433` → EC2 → RDS `5432` (注意 Prod 用 15433，Stage 用 15432)
- Stage 和 Prod 共享同一个 RDS 实例，通过不同的数据库名隔离

**⚠️ 生产环境安全规则**：
1. **谨慎操作** - 生产数据库，避免误操作
2. **避免 DELETE/UPDATE** - 除非明确需要
3. **使用 LIMIT** - 防止查询过多数据
4. **不查敏感数据** - 避免查询密码、密钥等

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
