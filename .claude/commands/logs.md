# /logs - 查看服务日志

快速查看服务日志，支持 Stage/Prod 两个环境。

**版本**: v0.1.1

## 使用场景

**前端开发者**: 当 API 调用返回 500 错误时，查看后端日志排查问题
**后端开发者**: 实时监控服务运行状态，调试代码逻辑
**DevOps**: 排查生产环境问题，查看错误堆栈

## 用法

```
/logs <service> [lines] [environment]
```

## 参数

- `service` (必需): 服务名称
  - `commerce-backend` - 电商后端
  - `user-auth` - 用户认证
  - `mcp-host` - MCP 协调器
  - `agentic-chat` - AI 聊天服务
- `lines` (可选): 显示行数，默认 50
- `environment` (可选): 环境，默认 stage
  - `stage` - Stage 预发布环境
  - `prod` - 生产环境

## 示例

```bash
/logs commerce-backend           # 查看 Stage 环境最近 50 行
/logs user-auth 100              # 查看 Stage 环境最近 100 行
/logs mcp-host 200 prod          # 查看 Prod 环境最近 200 行
```

## Claude Code 执行步骤

### 1. Stage 环境

**日志路径格式**: `/ecs/{service}-stage`

**步骤**:
```bash
# 1. 获取最新的 log stream
STREAM=$(aws logs describe-log-streams \
  --log-group-name /ecs/commerce-backend-stage \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  | jq -r '.logStreams[0].logStreamName')

# 2. 获取日志内容（纯文本）
aws logs get-log-events \
  --log-group-name /ecs/commerce-backend-stage \
  --log-stream-name "$STREAM" \
  --limit 50 \
  | jq -r '.events[] | .message'
```

**服务映射**:
- `commerce-backend` → `/ecs/commerce-backend-stage`
- `user-auth` → `/ecs/user-auth-stage`
- `mcp-host` → `/ecs/mcp-host-stage`
- `agentic-chat` → `/ecs/agentic-chat-stage`

### 2. Prod 环境

**日志路径格式**: `/optima/prod/{service}`

**步骤**:
```bash
# 获取日志内容（纯文本）
# 注意：Prod 环境的 log stream 通常是固定的 "backend"
aws logs get-log-events \
  --log-group-name /optima/prod/commerce-backend \
  --log-stream-name backend \
  --limit 50 \
  --start-from-head false \
  | jq -r '.events[] | .message'
```

**服务映射**:
- `commerce-backend` → `/optima/prod/commerce-backend`
- `user-auth` → `/optima/prod/user-auth`
- `mcp-host` → `/optima/prod/mcp-host`
- `agentic-chat` → `/optima/prod/agentic-chat`

**Log Stream 名称**:
- `backend` - 主服务日志
- `rq-worker` - 后台任务日志
- `rq-scheduler` - 调度器日志

## 完整示例脚本

### Stage 环境
```bash
SERVICE="commerce-backend"
LINES=50

# 获取最新 stream
STREAM=$(aws logs describe-log-streams \
  --log-group-name /ecs/${SERVICE}-stage \
  --order-by LastEventTime --descending --max-items 1 \
  | jq -r '.logStreams[0].logStreamName')

# 显示日志
aws logs get-log-events \
  --log-group-name /ecs/${SERVICE}-stage \
  --log-stream-name "$STREAM" \
  --limit $LINES \
  | jq -r '.events[] | .message'
```

### Prod 环境
```bash
SERVICE="commerce-backend"
LINES=50

# 显示主服务日志
aws logs get-log-events \
  --log-group-name /optima/prod/${SERVICE} \
  --log-stream-name backend \
  --limit $LINES \
  --start-from-head false \
  | jq -r '.events[] | .message'
```

## 常见错误处理

### 错误：ResourceNotFoundException

**原因**: 日志组不存在

**解决**:
```bash
# 列出所有可用的日志组
aws logs describe-log-groups --log-group-name-prefix /ecs
aws logs describe-log-groups --log-group-name-prefix /optima/prod
```

### 错误：No log streams found

**原因**: 服务可能未运行或刚启动

**解决**:
```bash
# 检查日志组是否有 streams
aws logs describe-log-streams \
  --log-group-name /ecs/commerce-backend-stage \
  --max-items 5
```

## 注意事项

1. **Stage 环境**: log stream 名称是动态的（ECS Task ID），需要先查询最新的 stream
2. **Prod 环境**: log stream 通常是固定的 `backend`、`rq-worker` 等
3. **日志延迟**: CloudWatch Logs 可能有 1-2 秒延迟
4. **权限要求**: 需要 AWS CLI 配置了正确的凭证和权限

## 相关资源

- CloudWatch Logs 文档: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/
- AWS CLI logs 命令: https://docs.aws.amazon.com/cli/latest/reference/logs/
