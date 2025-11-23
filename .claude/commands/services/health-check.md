# /health-check - 健康检查

检查服务健康状态，支持单个服务或所有服务。

## 使用场景

**前端开发者**: 调试前先确认后端服务是否正常运行
**后端开发者**: 快速诊断服务间依赖问题
**DevOps**: 监控生产环境服务状态

## 用法

/health-check [target]

## 参数

- `target` (可选): 检查目标
  - `all` - 检查所有服务（默认）
  - `commerce-backend` - 仅检查 Commerce Backend
  - `user-auth` - 仅检查 User Auth
  - `mcp-host` - 仅检查 MCP Host
  - `database` - 仅检查数据库
  - `redis` - 仅检查 Redis

## 执行逻辑

1. 根据当前环境选择检查地址（local/stage/prod）
2. 并发检查所有目标服务
3. 测试 HTTP 健康端点（/health）
4. 测试数据库连接
5. 测试 Redis 连接
6. 返回表格形式的状态报告

## 命令示例

### 本地环境 - 检查所有服务

```bash
# Commerce Backend
curl -f http://localhost:8280/health

# User Auth
curl -f http://localhost:8290/health

# MCP Host
curl -f http://localhost:8300/health

# PostgreSQL
pg_isready -h localhost -p 8282 -U commerce_user

# Redis
redis-cli -h localhost -p 8285 ping
```

### Stage-ECS - 检查所有服务

```bash
# Commerce Backend
curl -f https://api.stage.optima.onl/health

# User Auth
curl -f https://auth.stage.optima.onl/health

# MCP Host
curl -f https://mcp.stage.optima.onl/health

# Database (通过 VPN 或 Bastion)
pg_isready -h optima-stage-postgres.rds.amazonaws.com -p 5432
```

### Prod - 检查所有服务

```bash
# Commerce Backend
curl -f https://api.optima.shop/health

# User Auth
curl -f https://auth.optima.shop/health

# MCP Host
curl -f https://mcp.optima.shop/health

# Database (通过 SSH 隧道)
ssh -i ~/.ssh/optima-ec2-key ec2-user@ec2-prod.optima.shop \
  "pg_isready -h optima-prod-postgres.rds.amazonaws.com -p 5432"
```

## 预期输出

```
🏥 服务健康检查报告 (本地环境)

✅ commerce-backend: Running (200 OK) - 响应时间: 12ms
✅ user-auth: Running (200 OK) - 响应时间: 8ms
✅ mcp-host: Running (200 OK) - 响应时间: 15ms
✅ postgres: Connected - 延迟: 2ms
✅ redis: Connected - 延迟: 1ms

📊 总览: 5/5 服务正常运行
```

### 异常情况输出

```
🏥 服务健康检查报告 (本地环境)

✅ commerce-backend: Running (200 OK) - 响应时间: 12ms
❌ user-auth: Connection refused (端口 8290)
⚠️ mcp-host: Slow response (200 OK) - 响应时间: 3500ms
✅ postgres: Connected - 延迟: 2ms
❌ redis: Connection timeout

📊 总览: 2/5 服务正常, 1/5 警告, 2/5 异常

💡 建议:
- 检查 user-auth 容器是否运行: docker compose ps user-auth
- 重启 redis: docker compose restart redis
- 查看 mcp-host 日志排查性能问题: /backend-logs mcp-host
```

## 健康端点详情

### Commerce Backend

**端点**: `GET /health`

**正常响应**:
```json
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "s3": "accessible",
  "version": "1.2.0"
}
```

### User Auth

**端点**: `GET /health`

**正常响应**:
```json
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "version": "1.0.5"
}
```

### MCP Host

**端点**: `GET /health`

**正常响应**:
```json
{
  "status": "healthy",
  "mcp_servers": 4,
  "total_tools": 43,
  "version": "0.8.2"
}
```

## 相关命令

- /service-status - 查看详细服务状态
- /backend-logs - 查看错误日志
- /restart-service - 重启异常服务
