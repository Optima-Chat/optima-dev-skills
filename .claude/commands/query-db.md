# /query-db - 查询数据库

执行 SQL 查询，支持 CI/Stage/Prod 三个环境。

**版本**: v0.7.0

## 使用场景

**开发者**: 快速查询数据验证功能
**调试**: 检查数据库状态、排查数据问题
**运维**: 查看生产数据、统计分析

## 🎯 推荐方式：使用 CLI 工具

**最简单的方式**是使用 `optima-query-db` CLI 工具，它会自动处理所有连接细节：

```bash
# 查询 CI 环境（默认）
optima-query-db commerce-backend "SELECT COUNT(*) FROM products"

# 查询 Stage 环境
optima-query-db user-auth "SELECT COUNT(*) FROM users" stage

# 查询 Prod 环境
optima-query-db commerce-backend "SELECT * FROM products LIMIT 5" prod
```

**优点**：
- ✅ 自动管理 SSH 隧道
- ✅ 自动从 Infisical 获取密钥
- ✅ 无需手动执行多个步骤
- ✅ 支持所有环境

如果 CLI 工具不可用，可以使用下面的手动方式。

## 用法

```
/query-db <service> <sql> [environment]
```

## 参数

- `service` (必需): 服务名称
  - `commerce-backend` - 电商后端数据库
  - `user-auth` - 用户认证数据库
  - `agentic-chat` - AI 聊天服务数据库
  - `bi-backend` - BI 后端数据库
  - `session-gateway` - AI Shell 网关数据库
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

**统一实现**：直接调用 `optima-query-db` CLI 工具

```bash
optima-query-db <service> "<sql>" [environment]
```

**示例**：
```bash
# 用户输入: /query-db user-auth "SELECT COUNT(*) FROM users"
# 执行:
optima-query-db user-auth "SELECT COUNT(*) FROM users"

# 用户输入: /query-db commerce-backend "SELECT * FROM products LIMIT 5" stage
# 执行:
optima-query-db commerce-backend "SELECT * FROM products LIMIT 5" stage

# 用户输入: /query-db user-auth "SELECT COUNT(*) FROM users" prod
# 执行:
optima-query-db user-auth "SELECT COUNT(*) FROM users" prod
```

**说明**：
- CLI 工具会自动处理所有环境差异（CI/Stage/Prod）
- 自动获取 Infisical 密钥
- 自动管理 SSH 隧道

---

## 备用方法（仅当 CLI 工具不可用时）

如果 `optima-query-db` 命令不存在，根据用户指定的 `environment` 参数选择执行方式：
- `ci` 或未指定 → 通过 SSH 连接 Docker Postgres（第 0 节，默认）
- `stage` → 通过 SSH 隧道访问 RDS（第 1 节）
- `prod` → 通过 SSH 隧道访问 RDS（第 2 节）

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
# 项目: optima-secrets-v2, 路径: /shared-secrets/database-users
curl -s "${INFISICAL_URL}/api/v3/secrets/raw?workspaceId=${INFISICAL_PROJECT_ID}&environment=staging&secretPath=/shared-secrets/database-users" \
  -H "Authorization: Bearer ${INFISICAL_TOKEN}" | python3 -c "
import sys, json
secrets = {s['secretKey']: s['secretValue'] for s in json.load(sys.stdin)['secrets']}
print(f\"COMMERCE_DB_USER={secrets['COMMERCE_DB_USER']}\")
print(f\"COMMERCE_DB_PASSWORD={secrets['COMMERCE_DB_PASSWORD']}\")
" > /tmp/stage_db_config.sh && source /tmp/stage_db_config.sh

# 4. 建立 SSH 隧道到 Shared EC2，通过隧道访问 Stage RDS
ssh -i ~/.ssh/optima-ec2-key -f -N -L 15432:optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432 ec2-user@3.0.210.113

# 5. 通过本地端口 15432 连接到 RDS
PGPASSWORD="${COMMERCE_DB_PASSWORD}" psql -h localhost -p 15432 -U "${COMMERCE_DB_USER}" -d optima_commerce -c "SELECT COUNT(*) FROM products"

# 6. 关闭 SSH 隧道（可选）
pkill -f "ssh.*15432:${DATABASE_HOST}:5432"
```

**完整示例（五个服务）**:
```bash
# commerce-backend
# 使用 COMMERCE_DB_USER, COMMERCE_DB_PASSWORD, 数据库: optima_commerce

# user-auth
# 使用 AUTH_DB_USER, AUTH_DB_PASSWORD, 数据库: optima_auth

# agentic-chat
# 使用 CHAT_DB_USER, CHAT_DB_PASSWORD, 数据库: optima_chat

# bi-backend
# 使用 BI_DB_USER, BI_DB_PASSWORD, 数据库: optima_bi

# session-gateway (注意: Stage 数据库名是 optima_shell)
# 使用 AI_SHELL_DB_USER, AI_SHELL_DB_PASSWORD, 数据库: optima_shell
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

- `agentic-chat`:
  - 数据库: `optima_chat`
  - 用户: Infisical `CHAT_DB_USER`
  - 密码: Infisical `CHAT_DB_PASSWORD`

- `bi-backend`:
  - 数据库: `optima_bi`
  - 用户: Infisical `BI_DB_USER`
  - 密码: Infisical `BI_DB_PASSWORD`

- `session-gateway`:
  - 数据库: `optima_shell` ⚠️ (Stage 与 Prod 不同)
  - 用户: Infisical `AI_SHELL_DB_USER`
  - 密码: Infisical `AI_SHELL_DB_PASSWORD`

**说明**:
- Infisical 配置从 GitHub Variables 获取
- 数据库密钥从 Infisical 动态获取（项目: optima-secrets-v2, 环境: staging, 路径: /shared-secrets/database-users）
- Stage RDS: `optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com`
- Shared EC2 IP: `3.0.210.113`
- SSH 隧道: 本地端口 `15432` → Shared EC2 → Stage RDS `5432`
- Stage 和 Prod 有独立的 RDS 实例
- ⚠️ session-gateway 数据库名: Stage 用 `optima_shell`, Prod 用 `optima_ai_shell`

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
# 项目: optima-secrets-v2, 路径: /shared-secrets/database-users
curl -s "${INFISICAL_URL}/api/v3/secrets/raw?workspaceId=${INFISICAL_PROJECT_ID}&environment=prod&secretPath=/shared-secrets/database-users" \
  -H "Authorization: Bearer ${INFISICAL_TOKEN}" | python3 -c "
import sys, json
secrets = {s['secretKey']: s['secretValue'] for s in json.load(sys.stdin)['secrets']}
print(f\"COMMERCE_DB_USER={secrets['COMMERCE_DB_USER']}\")
print(f\"COMMERCE_DB_PASSWORD={secrets['COMMERCE_DB_PASSWORD']}\")
" > /tmp/prod_db_config.sh && source /tmp/prod_db_config.sh

# 4. 建立 SSH 隧道到 Shared EC2，通过隧道访问 Prod RDS
ssh -i ~/.ssh/optima-ec2-key -f -N -L 15433:optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432 ec2-user@3.0.210.113

# 5. 通过本地端口 15433 连接到 RDS
PGPASSWORD="${COMMERCE_DB_PASSWORD}" psql -h localhost -p 15433 -U "${COMMERCE_DB_USER}" -d optima_commerce -c "SELECT COUNT(*) FROM products"

# 6. 关闭 SSH 隧道（可选）
pkill -f "ssh.*15433:${DATABASE_HOST}:5432"
```

**完整示例（五个服务）**:
```bash
# commerce-backend
# 使用 COMMERCE_DB_USER, COMMERCE_DB_PASSWORD, 数据库: optima_commerce

# user-auth
# 使用 AUTH_DB_USER, AUTH_DB_PASSWORD, 数据库: optima_auth

# agentic-chat
# 使用 CHAT_DB_USER, CHAT_DB_PASSWORD, 数据库: optima_chat

# bi-backend
# 使用 BI_DB_USER, BI_DB_PASSWORD, 数据库: optima_bi

# session-gateway (注意: Prod 数据库名是 optima_ai_shell)
# 使用 AI_SHELL_DB_USER, AI_SHELL_DB_PASSWORD, 数据库: optima_ai_shell
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

- `agentic-chat`:
  - 数据库: `optima_chat`
  - 用户: Infisical `CHAT_DB_USER`
  - 密码: Infisical `CHAT_DB_PASSWORD`

- `bi-backend`:
  - 数据库: `optima_bi`
  - 用户: Infisical `BI_DB_USER`
  - 密码: Infisical `BI_DB_PASSWORD`

- `session-gateway`:
  - 数据库: `optima_ai_shell` ⚠️ (Prod 与 Stage 不同)
  - 用户: Infisical `AI_SHELL_DB_USER`
  - 密码: Infisical `AI_SHELL_DB_PASSWORD`

**说明**:
- Infisical 配置从 GitHub Variables 获取
- 数据库密钥从 Infisical 动态获取（项目: optima-secrets-v2, 环境: prod, 路径: /shared-secrets/database-users）
- Prod RDS: `optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com`
- Shared EC2 IP: `3.0.210.113`
- SSH 隧道: 本地端口 `15433` → Shared EC2 → Prod RDS `5432`
- Stage 用端口 `15432`，Prod 用端口 `15433`
- Stage 和 Prod 有独立的 RDS 实例
- ⚠️ session-gateway 数据库名: Stage 用 `optima_shell`, Prod 用 `optima_ai_shell`

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
