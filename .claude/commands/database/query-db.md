# /query-db - 查询数据库

查询 PostgreSQL 数据库中的数据，支持 CI、Stage、Prod 环境。

## 使用场景

**前端开发者**: 查看商品、订单等数据，调试 API 返回结果
**后端开发者**: 执行 SQL 查询，验证数据迁移，调试业务逻辑
**DevOps**: 查看生产数据，排查数据异常

## 用法

/query-db [database] [environment]

## 参数

- `database` (可选): 数据库名称
  - `commerce` - Commerce Backend 数据库（默认）
  - `auth` - User Auth 数据库
  - `mcp` - MCP Host 数据库
- `environment` (可选): 环境（local/stage/prod），默认 local

## 安全提示

⚠️ **生产数据库访问需谨慎**:
- Prod 数据库是只读访问（使用只读用户）
- 禁止在生产环境执行 DELETE、UPDATE、DROP 等危险操作
- 所有生产数据查询应该添加 LIMIT 限制

## 执行逻辑

1. 识别目标数据库和环境
2. 选择对应的连接方式
3. 本地: 直接连接 Docker PostgreSQL
4. Stage: 通过 VPN 或 Bastion 连接 RDS
5. Prod: 通过 SSH 隧道连接 RDS（使用只读用户）
6. 启动 psql 交互式会话

## 命令示例

### 本地环境 - Commerce Database

```bash
# 直接连接本地 PostgreSQL (端口 8282)
psql postgresql://commerce_user:commerce_pass@localhost:8282/optima_commerce
```

进入 psql 后常用操作:
```sql
-- 查看所有表
\dt

-- 查看表结构
\d products

-- 查询商品
SELECT id, title, price, status FROM products LIMIT 10;

-- 查询订单
SELECT id, user_id, total_amount, status FROM orders LIMIT 10;

-- 退出
\q
```

### 本地环境 - Auth Database

```bash
psql postgresql://auth_user:auth_pass@localhost:8282/optima_auth
```

常用查询:
```sql
-- 查看用户
SELECT id, email, role, created_at FROM users LIMIT 10;

-- 查看 OAuth 配置
SELECT provider, client_id FROM oauth_providers;
```

### 本地环境 - MCP Database

```bash
psql postgresql://mcp_user:mcp_pass@localhost:8282/optima_mcp
```

### Stage-ECS - Commerce Database

```bash
# 通过 Bastion 或 VPN 连接
psql postgresql://commerce_stage_user:STAGE_PASSWORD@optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_stage_commerce
```

**注意**: STAGE_PASSWORD 从 Infisical 获取:
```bash
infisical export --env=stage | grep DB_PASSWORD
```

### Prod - Commerce Database (只读)

```bash
# 步骤 1: 建立 SSH 隧道
ssh -i ~/.ssh/optima-ec2-key \
  -L 5433:optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432 \
  ec2-user@ec2-prod.optima.shop \
  -N -f

# 步骤 2: 通过隧道连接（使用只读用户）
psql postgresql://commerce_readonly:READONLY_PASSWORD@localhost:5433/optima_commerce
```

**只读用户限制**:
- 只能执行 SELECT 查询
- 无法 INSERT、UPDATE、DELETE
- 无法 DROP、CREATE、ALTER

常用只读查询:
```sql
-- 查看今日订单统计
SELECT
  COUNT(*) as total_orders,
  SUM(total_amount) as total_revenue
FROM orders
WHERE created_at >= CURRENT_DATE;

-- 查看热销商品
SELECT
  p.id, p.title, COUNT(oi.id) as order_count
FROM products p
JOIN order_items oi ON oi.product_id = p.id
GROUP BY p.id, p.title
ORDER BY order_count DESC
LIMIT 10;

-- 查看低库存商品
SELECT
  id, title, stock_quantity
FROM products
WHERE stock_quantity < 10 AND status = 'active'
ORDER BY stock_quantity ASC;
```

## 数据库连接信息速查

### 本地环境

| 数据库 | 主机 | 端口 | 用户 | 数据库名 |
|--------|------|------|------|----------|
| Commerce | localhost | 8282 | commerce_user | optima_commerce |
| Auth | localhost | 8282 | auth_user | optima_auth |
| MCP | localhost | 8282 | mcp_user | optima_mcp |

### Stage-ECS

| 数据库 | 主机 | 端口 | 数据库名 |
|--------|------|------|----------|
| Commerce | optima-stage-postgres.rds.amazonaws.com | 5432 | optima_stage_commerce |
| Auth | optima-stage-postgres.rds.amazonaws.com | 5432 | optima_stage_auth |

### Prod (只读)

| 数据库 | 主机 | 端口 | 用户 | 数据库名 |
|--------|------|------|------|----------|
| Commerce | optima-prod-postgres.rds.amazonaws.com | 5432 | commerce_readonly | optima_commerce |
| Auth | optima-prod-postgres.rds.amazonaws.com | 5432 | auth_readonly | optima_auth |

## 故障排查

### 连接被拒绝

```
Error: connection refused
```

**本地环境**:
- 检查 PostgreSQL 容器是否运行: `docker compose ps postgres`
- 重启 PostgreSQL: `docker compose restart postgres`

**Stage/Prod**:
- 检查 VPN 连接
- 验证安全组规则（需要开放 5432 端口）
- 确认 RDS 实例是否运行

### 认证失败

```
Error: password authentication failed
```

- 检查密码是否正确
- 从 Infisical 获取最新密码
- 确认用户名是否正确（readonly vs 普通用户）

### SSH 隧道失败

```
Error: Permission denied (publickey)
```

- 检查 SSH 密钥权限: `chmod 600 ~/.ssh/optima-ec2-key`
- 验证 EC2 主机地址是否正确
- 确认 SSH 密钥是否配置正确

## 相关命令

- /db-migrate - 运行数据库迁移
- /db-query - 快速执行 SQL 查询（无需进入 psql）
- /logs - 查看数据库相关日志
