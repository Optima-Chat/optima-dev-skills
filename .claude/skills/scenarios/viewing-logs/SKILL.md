---
name: "Viewing Server Logs"
description: "查看服务器日志 - CI、Stage、Prod 环境的日志查看，快速定位问题"
allowed-tools: ["Bash", "SlashCommand"]
---

# 查看服务器日志

当你需要查看服务日志排查问题时，使用这个场景。

## 🎯 适用情况

- API 返回错误，需要查看详细错误信息
- 服务行为异常，需要查看运行日志
- 监控服务状态，实时查看日志输出
- 排查数据库查询问题

## 🚀 快速操作

### 1. 查看 CI 环境日志

```
/logs commerce-backend
```

**说明**：
- 自动识别 Docker 容器
- 默认显示最近 50 行
- 实时跟踪新日志

**常用服务**：
- `commerce-backend` - 电商 API
- `user-auth` - 用户认证
- `mcp-host` - MCP 协调器

### 2. 查看更多日志行数

```
/logs commerce-backend 200
```

查看最近 200 行日志，用于排查历史问题。

### 3. 查看 Stage 环境日志

```
/logs commerce-backend 100 stage
```

查看 Stage-ECS 环境的日志（通过 AWS CloudWatch）。

### 4. 查看 Prod 环境日志

```
/logs commerce-backend 100 prod
```

查看生产环境日志（需要 SSH 权限）。

## 📋 常见问题排查

### 问题 1：API 返回 500 错误

**步骤**：
1. 查看日志：`/logs commerce-backend 100`
2. 搜索 ERROR 关键字
3. 查看完整错误堆栈
4. 定位问题代码或数据

**示例日志**：
```
ERROR - 2024-11-23 10:30:45 - Exception in /products endpoint
Traceback:
  File "app/routes/products.py", line 45
    merchant = db.query(Merchant).filter(id == product.merchant_id).first()
  MerchantNotFound: Merchant with id 'xxx' not found
```

### 问题 2：服务启动失败

**步骤**：
1. 查看启动日志：`/logs commerce-backend 200`
2. 查找启动错误信息
3. 检查环境变量、数据库连接

**常见错误**：
- 数据库连接失败
- 端口被占用
- 环境变量缺失

### 问题 3：性能问题（响应慢）

**步骤**：
1. 查看日志：`/logs commerce-backend`
2. 查找 "response_time" 或 "query_time"
3. 识别慢查询或慢接口

**示例**：
```
INFO - GET /products - response_time: 3500ms (SLOW)
INFO - Database query took 3200ms: SELECT * FROM products WHERE...
```

## 🔍 日志分析技巧

### 过滤日志

查看日志后，使用 grep 过滤关键信息：

```bash
# 只看错误
docker compose logs commerce-backend | grep ERROR

# 只看特定 API
docker compose logs commerce-backend | grep "GET /products"

# 看最近的错误
docker compose logs commerce-backend --since 5m | grep ERROR
```

### 多服务日志

同时查看多个服务：

```bash
docker compose logs -f commerce-backend user-auth mcp-host
```

### 日志级别

日志级别说明：
- **ERROR** - 错误，需要立即处理
- **WARNING** - 警告，可能有问题
- **INFO** - 信息，正常运行日志
- **DEBUG** - 调试信息，详细输出

## 🌐 不同环境的日志查看

### CI 环境

```
/logs commerce-backend
```

使用 Docker Compose logs：
```bash
docker compose logs -f commerce-backend --tail 50
```

### Stage-ECS

```
/logs commerce-backend 100 stage
```

使用 AWS CloudWatch Logs：
```bash
aws logs tail /ecs/commerce-backend-stage --follow --since 5m
```

### Prod（通过 SSH）

```
/logs commerce-backend 100 prod
```

SSH 到 EC2 查看 Docker 日志：
```bash
ssh -i ~/.ssh/optima-ec2-key ec2-user@ec2-prod.optima.shop \
  "docker logs -f optima-commerce-backend-prod --tail 100"
```

## 💡 最佳实践

1. **先查日志，再动手修** - 不要猜测，看日志确认问题
2. **查足够多的行数** - 有时错误原因在更早的日志里
3. **关注时间戳** - 确认错误发生的时间点
4. **保留错误日志** - 复制错误信息，方便分享讨论
5. **对比环境差异** - CI 正常、Stage 出错？对比日志差异

## 🔗 相关命令

- `/health-check` - 检查服务是否运行
- `/service-status` - 查看所有服务状态
- `/restart-service` - 重启异常服务
- `/query-db` - 连接数据库查看数据

## 📚 相关文档

- AWS CloudWatch Logs: https://console.aws.amazon.com/cloudwatch/
- Docker Logs 文档: https://docs.docker.com/engine/reference/commandline/logs/
