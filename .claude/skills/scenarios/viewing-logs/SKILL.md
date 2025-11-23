---
name: "Viewing Server Logs"
description: "查看服务器日志 - Stage、Prod 环境的日志查看，快速定位问题"
allowed-tools: ["Bash", "SlashCommand"]
---

# 查看服务器日志

当你需要查看服务日志排查问题时，使用这个场景。

## 🎯 适用情况

- API 返回错误，需要查看详细错误信息
- 服务行为异常，需要查看运行日志
- 监控服务状态，查看日志输出
- 排查数据库连接、配置问题

## 🚀 快速操作

### 1. 查看 Stage 环境日志（默认）

```
/logs commerce-backend
```

**说明**：
- 自动查看 Stage-ECS 环境
- 默认显示最近 50 行
- 使用 AWS CloudWatch Logs

**常用服务**：
- `commerce-backend` - 电商 API
- `user-auth` - 用户认证
- `mcp-host` - MCP 协调器
- `agentic-chat` - AI 聊天服务

### 2. 查看更多日志行数

```
/logs commerce-backend 200
```

查看最近 200 行日志，用于排查历史问题。

### 3. 查看 Prod 环境日志

```
/logs commerce-backend 100 prod
```

查看生产环境日志（通过 AWS CloudWatch）。

## 📋 常见问题排查

### 问题 1：API 返回 500 错误

**步骤**：
1. 查看日志：`/logs commerce-backend 100`
2. 搜索 ERROR 关键字
3. 查看完整错误堆栈
4. 定位问题代码或数据

**示例日志**：
```
ERROR - 2025-01-23 10:30:45 - Exception in /products endpoint
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
- Redis 连接失败
- 环境变量缺失

**示例日志**：
```
redis.exceptions.ConnectionError: Error connecting to localhost:8285.
Multiple exceptions: [Errno 111] Connection refused
ERROR:    Application startup failed. Exiting.
```

### 问题 3：性能问题（响应慢）

**步骤**：
1. 查看日志：`/logs commerce-backend`
2. 查找 "response_time" 或包含毫秒数的日志
3. 识别慢查询或慢接口

**示例**：
```
INFO - GET /products - response_time: 3500ms (SLOW)
INFO - Database query took 3200ms: SELECT * FROM products WHERE...
```

## 🔍 日志分析技巧

### 过滤关键信息

查看日志后，可以使用 grep 过滤：

```bash
# 只看错误
/logs commerce-backend 200 | grep -i error

# 只看特定 API
/logs commerce-backend 200 | grep "GET /products"

# 查看 Redis 相关日志
/logs commerce-backend 200 | grep -i redis
```

### 日志级别

日志级别说明：
- **ERROR** - 错误，需要立即处理
- **WARNING** - 警告，可能有问题
- **INFO** - 信息，正常运行日志
- **DEBUG** - 调试信息，详细输出

## 🌐 环境对比

### Stage-ECS 环境

```
/logs commerce-backend 100 stage
```

**特点**：
- ECS 容器运行
- CloudWatch Logs 自动收集
- log stream 名称动态变化（ECS Task ID）
- 日志路径：`/ecs/{service}-stage`

**实现方式**：
```bash
# 1. 获取最新 log stream
STREAM=$(aws logs describe-log-streams \
  --log-group-name /ecs/commerce-backend-stage \
  --order-by LastEventTime --descending --max-items 1 \
  | jq -r '.logStreams[0].logStreamName')

# 2. 获取日志
aws logs get-log-events \
  --log-group-name /ecs/commerce-backend-stage \
  --log-stream-name "$STREAM" \
  --limit 100 \
  | jq -r '.events[] | .message'
```

### Prod 环境

```
/logs commerce-backend 100 prod
```

**特点**：
- Docker Compose 运行在 EC2
- CloudWatch Logs Agent 收集
- log stream 固定名称（backend, rq-worker, rq-scheduler）
- 日志路径：`/optima/prod/{service}`

**实现方式**：
```bash
# 获取主服务日志
aws logs get-log-events \
  --log-group-name /optima/prod/commerce-backend \
  --log-stream-name backend \
  --limit 100 \
  --start-from-head false \
  | jq -r '.events[] | .message'
```

**可用的 log streams**：
- `backend` - 主服务日志（推荐）
- `rq-worker` - 后台任务日志
- `rq-scheduler` - 调度器日志

## 💡 最佳实践

1. **先查日志，再动手修** - 不要猜测，看日志确认问题
2. **查足够多的行数** - 有时错误原因在更早的日志里
3. **关注启动日志** - 服务启动时的错误最关键
4. **保留错误日志** - 复制错误信息，方便分享讨论
5. **对比环境差异** - Stage 出错、Prod 正常？对比日志差异

## 🔗 相关命令

- `/logs` - 查看服务日志

## 📚 技术细节

### CloudWatch Logs 结构

**Stage-ECS**:
```
Log Group: /ecs/commerce-backend-stage
└── Log Stream: ecs/commerce-backend/d8e079f0b4fb47e398c61ee5d610ed9c (动态)
    └── Events: 日志条目
```

**Prod**:
```
Log Group: /optima/prod/commerce-backend
├── Log Stream: backend (固定)
├── Log Stream: rq-worker (固定)
└── Log Stream: rq-scheduler (固定)
    └── Events: 日志条目
```

### 日志格式

所有日志通过 CloudWatch Logs 返回 JSON 格式：

```json
{
  "events": [
    {
      "timestamp": 1763904521976,
      "message": "INFO: 10.0.2.199:64952 - \"GET /health HTTP/1.1\" 200 OK",
      "ingestionTime": 1763904526810
    }
  ]
}
```

使用 `jq -r '.events[] | .message'` 提取纯文本：

```
INFO: 10.0.2.199:64952 - "GET /health HTTP/1.1" 200 OK
```

## ⚠️ 注意事项

### 权限要求

需要 AWS CLI 配置了以下权限：
- `logs:DescribeLogStreams`
- `logs:GetLogEvents`

### 日志延迟

CloudWatch Logs 可能有 1-2 秒延迟，实时调试时需注意。

### 日志保留

- **Stage**: 7 天
- **Prod**: 30 天（建议配置）

### 常见错误

**ResourceNotFoundException**:
```
An error occurred (ResourceNotFoundException) when calling the GetLogEvents operation
```

**解决**：检查服务名称和环境是否正确：
```bash
# 列出所有 Stage 日志组
aws logs describe-log-groups --log-group-name-prefix /ecs

# 列出所有 Prod 日志组
aws logs describe-log-groups --log-group-name-prefix /optima/prod
```
