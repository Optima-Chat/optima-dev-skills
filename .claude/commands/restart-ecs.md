# /restart-ecs - 重启 ECS 服务

快速重启 ECS 集群中的服务，支持 Stage/Prod 两个环境。

**版本**: v0.1.0

## 使用场景

**后端开发者**: 代码更新后需要重启服务使配置生效
**DevOps**: 服务异常需要快速恢复
**排查问题**: 服务状态异常，需要重启清理缓存或连接

## 用法

```
/restart-ecs <service> [environment]
```

## 参数

- `service` (必需): 服务简称
  - `user-auth` - 用户认证服务
  - `user-auth-admin` - 用户认证管理后台
  - `commerce-backend` - 电商后端 API
  - `commerce-rq-worker` - RQ 后台任务
  - `commerce-rq-scheduler` - RQ 定时调度
  - `agentic-chat` - AI 聊天服务
  - `session-gateway` - AI Shell 网关
  - `bi-backend` - BI 后端
  - `bi-dashboard` - BI 仪表板
  - `optima-scout` - 产品研究工具
  - `ai-shell-web-ui` - Shell Web UI
  - `optima-store` - 商城前端（仅 Stage）
  - `pgbouncer` - 连接池（仅 Stage）
- `environment` (可选): 环境，默认 stage
  - `stage` - Stage 预发布环境（默认，更安全）
  - `prod` - 生产环境（需确认）

## 示例

```bash
/restart-ecs session-gateway           # 重启 Stage 环境的 session-gateway（默认）
/restart-ecs session-gateway prod      # 重启 Prod 环境的 session-gateway
/restart-ecs user-auth stage           # 重启 Stage 环境的 user-auth
/restart-ecs list                      # 列出 Stage 环境所有可用服务
/restart-ecs list prod                 # 列出 Prod 环境所有可用服务
```

## 特殊参数处理

- 如果用户输入 `/restart-ecs` 或 `/restart-ecs --help` 或 `/restart-ecs help`，显示此帮助文档
- 如果用户输入 `/restart-ecs list [env]`，列出指定环境的所有服务

## Claude Code 执行步骤

### 0. 列出服务（service = "list"）

```bash
# 列出 Stage 环境服务
aws ecs list-services --cluster optima-stage-cluster --region ap-southeast-1 --query 'serviceArns[*]' --output text | tr '\t' '\n' | sed 's/.*service\/optima-stage-cluster\///'

# 列出 Prod 环境服务
aws ecs list-services --cluster optima-prod-cluster --region ap-southeast-1 --query 'serviceArns[*]' --output text | tr '\t' '\n' | sed 's/.*service\/optima-prod-cluster\///'
```

### 1. Stage 环境重启（environment = "stage" 或默认）

**集群名**: `optima-stage-cluster`
**服务名格式**: `{service}-stage`

**步骤**:
```bash
# 重启服务（强制重新部署）
aws ecs update-service \
  --cluster optima-stage-cluster \
  --service {service}-stage \
  --force-new-deployment \
  --region ap-southeast-1 \
  --query 'service.{serviceName:serviceName,desiredCount:desiredCount,runningCount:runningCount,status:status}' \
  --output table
```

**可用服务**:
- `user-auth-stage`
- `user-auth-admin-stage`
- `commerce-backend-stage`
- `commerce-rq-worker-stage`
- `commerce-rq-scheduler-stage`
- `agentic-chat-stage`
- `session-gateway-stage`
- `bi-backend-stage`
- `bi-dashboard-stage`
- `optima-scout-stage`
- `ai-shell-web-ui-stage`
- `optima-store-stage`
- `pgbouncer-stage`

### 2. Prod 环境重启（environment = "prod"）

**集群名**: `optima-prod-cluster`
**服务名格式**: `{service}-prod`

**⚠️ 安全提醒**: 重启 Prod 服务前，Claude 应主动向用户确认是否继续。

**步骤**:
```bash
# 重启服务（强制重新部署）
aws ecs update-service \
  --cluster optima-prod-cluster \
  --service {service}-prod \
  --force-new-deployment \
  --region ap-southeast-1 \
  --query 'service.{serviceName:serviceName,desiredCount:desiredCount,runningCount:runningCount,status:status}' \
  --output table
```

**可用服务**:
- `user-auth-prod`
- `user-auth-admin-prod`
- `commerce-backend-prod`
- `commerce-rq-worker-prod`
- `commerce-rq-scheduler-prod`
- `agentic-chat-prod`
- `session-gateway-prod`
- `bi-backend-prod`
- `bi-dashboard-prod`
- `optima-scout-prod`
- `ai-shell-web-ui-prod`

**注意**: `optima-store` 和 `pgbouncer` 仅在 Stage 环境部署

## 查看重启进度

重启触发后，可以查看部署进度：

```bash
# 查看服务部署状态
aws ecs describe-services \
  --cluster optima-{env}-cluster \
  --services {service}-{env} \
  --region ap-southeast-1 \
  --query 'services[0].{serviceName:serviceName,status:status,runningCount:runningCount,desiredCount:desiredCount,deployments:deployments[*].{status:status,runningCount:runningCount,desiredCount:desiredCount}}' \
  --output yaml

# 查看服务事件（最近的部署事件）
aws ecs describe-services \
  --cluster optima-{env}-cluster \
  --services {service}-{env} \
  --region ap-southeast-1 \
  --query 'services[0].events[:5]' \
  --output table
```

## 常见错误处理

### 错误：ServiceNotFoundException

**原因**: 服务名不存在

**解决**:
```bash
# 列出所有服务
aws ecs list-services --cluster optima-stage-cluster --region ap-southeast-1
```

### 错误：ClusterNotFoundException

**原因**: 集群名错误

**解决**: 确认使用正确的集群名：
- Stage: `optima-stage-cluster`
- Prod: `optima-prod-cluster`

### 错误：AccessDeniedException

**原因**: AWS 凭证无权限

**解决**: 确认 AWS CLI 配置了正确的凭证，且有 ECS 操作权限

## 重启原理

`--force-new-deployment` 参数会：
1. 使用**当前**的 Task Definition（版本号不变）
2. 启动新的 Task 实例
3. 新 Task 健康检查通过后注册到 ALB
4. 旧 Task 优雅停止

这是一个零停机的滚动更新过程。

## 注意事项

1. **默认 Stage 环境**: 为避免误操作生产环境，默认重启 Stage
2. **Prod 需确认**: 重启 Prod 服务时 Claude 会主动确认
3. **版本不变**: 重启不会改变 Task Definition 版本号
4. **零停机**: ECS 会确保新 Task 健康后才停止旧 Task
5. **权限要求**: 需要 AWS CLI 配置了正确的凭证和 ECS 操作权限
