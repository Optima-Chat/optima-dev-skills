# /logs - 查看服务日志

快速查看服务日志，支持 CI/Stage/Prod 三个环境。

**版本**: v0.3.0

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
  - `commerce-backend` - 电商后端 API
  - `user-auth` - 用户认证服务
  - `user-auth-admin` - 用户认证管理后台
  - `agentic-chat` - AI 聊天服务
  - `bi-backend` - BI 后端
  - `bi-dashboard` - BI 仪表板
  - `session-gateway` - AI Shell 网关
  - `ai-shell-web-ui` - Shell Web UI
  - `optima-scout` - 产品研究工具
  - `optima-store` - 商城前端（仅 Stage）
  - `commerce-rq-worker` - RQ 后台任务
  - `commerce-rq-scheduler` - RQ 定时调度
- `lines` (可选): 显示行数，默认 50
- `environment` (可选): 环境，默认 ci
  - `ci` - CI 持续集成环境（开发环境，默认）
  - `stage` - Stage 预发布环境（ECS Fargate）
  - `prod` - 生产环境（ECS Fargate）

## 示例

```bash
/logs commerce-backend           # 查看 CI 环境最近 50 行（默认）
/logs user-auth 100              # 查看 CI 环境最近 100 行（默认）
/logs agentic-chat 200 stage     # 查看 Stage 环境最近 200 行
/logs user-auth 100 prod         # 查看 Prod 环境最近 100 行
/logs session-gateway 50 prod    # 查看 Prod AI Shell 网关日志
```

## 特殊参数处理

如果用户输入 `/logs` 或 `/logs --help` 或 `/logs help`，显示此帮助文档，不执行查询。

## Claude Code 执行步骤

**重要提示**：根据用户指定的 `environment` 参数选择执行方式：
- `ci` 或未指定 → 使用 SSH + Docker Compose（第 0 节，默认）
- `stage` → 使用 AWS CloudWatch Logs - ECS（第 1 节）
- `prod` → 使用 AWS CloudWatch Logs - ECS（第 2 节）

### 0. CI 环境（environment = "ci" 或默认）

**访问方式**: SSH + Docker Compose

**步骤**:
```bash
# IMPORTANT: 使用单行命令，使用 sshpass 进行密码认证

# 获取 CI 服务器配置（从 GitHub Variables）
CI_USER=$(gh variable get CI_SSH_USER -R Optima-Chat/optima-dev-skills)
CI_HOST=$(gh variable get CI_SSH_HOST -R Optima-Chat/optima-dev-skills)
CI_PASSWORD=$(gh variable get CI_SSH_PASSWORD -R Optima-Chat/optima-dev-skills)

# 查看日志（根据服务选择不同的 docker-compose.yml 路径）
sshpass -p "$CI_PASSWORD" ssh -o StrictHostKeyChecking=no ${CI_USER}@${CI_HOST} "cd /data/xuhao/commerce-backend && docker compose logs --tail 50 commerce-backend"
```

**服务映射**（路径 + docker compose 服务名）:
- `commerce-backend` → `/data/xuhao/commerce-backend` → `commerce-backend`
- `user-auth` → `/data/xuhao/user-auth` → `user-auth`
- `agentic-chat` → `/data/xuhao/agentic-chat` → `optima-ai-chat`

**完整命令示例**（先获取配置）:
```bash
# 获取配置
CI_USER=$(gh variable get CI_SSH_USER -R Optima-Chat/optima-dev-skills)
CI_HOST=$(gh variable get CI_SSH_HOST -R Optima-Chat/optima-dev-skills)
CI_PASSWORD=$(gh variable get CI_SSH_PASSWORD -R Optima-Chat/optima-dev-skills)

# commerce-backend
sshpass -p "$CI_PASSWORD" ssh -o StrictHostKeyChecking=no ${CI_USER}@${CI_HOST} "cd /data/xuhao/commerce-backend && docker compose logs --tail 50 commerce-backend"

# user-auth
sshpass -p "$CI_PASSWORD" ssh -o StrictHostKeyChecking=no ${CI_USER}@${CI_HOST} "cd /data/xuhao/user-auth && docker compose logs --tail 50 user-auth"

# agentic-chat
sshpass -p "$CI_PASSWORD" ssh -o StrictHostKeyChecking=no ${CI_USER}@${CI_HOST} "cd /data/xuhao/agentic-chat && docker compose logs --tail 50 optima-ai-chat"
```

### 1. Stage 环境（environment = "stage"）

**部署方式**: ECS Fargate（Fargate Spot 降低成本）
**日志路径格式**: `/ecs/{service}-stage`

**步骤**:
```bash
# IMPORTANT: 必须使用单行命令，不要使用反斜杠换行

# 1. 获取最新的 log stream
STREAM=$(aws logs describe-log-streams --log-group-name /ecs/commerce-backend-stage --order-by LastEventTime --descending --max-items 1 | jq -r '.logStreams[0].logStreamName')

# 2. 获取日志内容（纯文本）
aws logs get-log-events --log-group-name /ecs/commerce-backend-stage --log-stream-name "$STREAM" --limit 50 | jq -r '.events[] | .message'
```

**服务映射**:
- `commerce-backend` → `/ecs/commerce-backend-stage`
- `user-auth` → `/ecs/user-auth-stage`
- `user-auth-admin` → `/ecs/user-auth-admin-stage`
- `agentic-chat` → `/ecs/agentic-chat-stage`
- `bi-backend` → `/ecs/bi-backend-stage`
- `bi-dashboard` → `/ecs/bi-dashboard-stage`
- `session-gateway` → `/ecs/session-gateway-stage`
- `ai-shell-web-ui` → `/ecs/ai-shell-web-ui-stage`
- `optima-scout` → `/ecs/optima-scout-stage`
- `optima-store` → `/ecs/optima-store-stage`
- `commerce-rq-worker` → `/ecs/commerce-rq-worker-stage`
- `commerce-rq-scheduler` → `/ecs/commerce-rq-scheduler-stage`

### 2. Prod 环境（environment = "prod"）

**部署方式**: ECS Fargate（核心服务标准 Fargate，非核心服务 Fargate Spot）
**日志路径格式**: `/ecs/{service}-prod`

**IMPORTANT**: Prod 环境必须指定 `--region ap-southeast-1`

**推荐方式（使用 aws logs tail）**:
```bash
# 查看最近日志（实时跟踪）
aws logs tail /ecs/commerce-backend-prod --since 1h --region ap-southeast-1

# 过滤错误日志
aws logs tail /ecs/user-auth-prod --filter-pattern "ERROR" --region ap-southeast-1
```

**备用方式（使用 get-log-events）**:
```bash
# 1. 获取最新的 log stream（ECS Task ID 是动态的）
STREAM=$(aws logs describe-log-streams --log-group-name /ecs/commerce-backend-prod --order-by LastEventTime --descending --max-items 1 --region ap-southeast-1 | jq -r '.logStreams[0].logStreamName')

# 2. 获取日志内容（纯文本）
aws logs get-log-events --log-group-name /ecs/commerce-backend-prod --log-stream-name "$STREAM" --limit 50 --region ap-southeast-1 | jq -r '.events[] | .message'
```

**服务映射**:
- `commerce-backend` → `/ecs/commerce-backend-prod`
- `user-auth` → `/ecs/user-auth-prod`
- `user-auth-admin` → `/ecs/user-auth-admin-prod`
- `agentic-chat` → `/ecs/agentic-chat-prod`
- `bi-backend` → `/ecs/bi-backend-prod`
- `bi-dashboard` → `/ecs/bi-dashboard-prod`
- `session-gateway` → `/ecs/session-gateway-prod`
- `ai-shell-web-ui` → `/ecs/ai-shell-web-ui-prod`
- `optima-scout` → `/ecs/optima-scout-prod`
- `commerce-rq-worker` → `/ecs/commerce-rq-worker-prod`
- `commerce-rq-scheduler` → `/ecs/commerce-rq-scheduler-prod`

**注意**: `optima-store` 仅在 Stage 环境部署

## 完整示例脚本

### Stage 环境
```bash
# IMPORTANT: 使用单行命令
SERVICE="commerce-backend"
LINES=50

# 获取最新 stream 并显示日志
STREAM=$(aws logs describe-log-streams --log-group-name /ecs/${SERVICE}-stage --order-by LastEventTime --descending --max-items 1 | jq -r '.logStreams[0].logStreamName')
aws logs get-log-events --log-group-name /ecs/${SERVICE}-stage --log-stream-name "$STREAM" --limit $LINES | jq -r '.events[] | .message'
```

### Prod 环境
```bash
# 推荐方式：使用 aws logs tail
aws logs tail /ecs/commerce-backend-prod --since 1h --region ap-southeast-1

# 备用方式：使用 get-log-events（获取指定行数）
SERVICE="commerce-backend"
LINES=50
STREAM=$(aws logs describe-log-streams --log-group-name /ecs/${SERVICE}-prod --order-by LastEventTime --descending --max-items 1 --region ap-southeast-1 | jq -r '.logStreams[0].logStreamName')
aws logs get-log-events --log-group-name /ecs/${SERVICE}-prod --log-stream-name "$STREAM" --limit $LINES --region ap-southeast-1 | jq -r '.events[] | .message'
```

## 常见错误处理

### 错误：ResourceNotFoundException

**原因**: 日志组不存在

**解决**:
```bash
# 列出所有可用的日志组
aws logs describe-log-groups --log-group-name-prefix /ecs --region ap-southeast-1
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

1. **Stage/Prod 环境**: log stream 名称是动态的（ECS Task ID），需要先查询最新的 stream
2. **日志延迟**: CloudWatch Logs 可能有 1-2 秒延迟
3. **权限要求**: 需要 AWS CLI 配置了正确的凭证和权限
4. **日志保留**: Stage 和 Prod 环境日志保留 7 天

## 相关资源

- CloudWatch Logs 文档: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/
- AWS CLI logs 命令: https://docs.aws.amazon.com/cli/latest/reference/logs/
