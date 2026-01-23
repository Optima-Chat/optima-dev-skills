---
name: "restartEcs"
description: "当用户请求重启 ECS 服务、重启服务、restart service、重新部署服务、重启 session-gateway、重启 user-auth、重启后端服务时，使用此技能。支持 Stage、Prod 两个环境的 ECS 服务重启。"
allowed-tools: ["Bash"]
---

# 重启 ECS 服务

当你需要重启 ECS 集群中的服务时，使用这个场景。

## 适用情况

- 代码更新后需要使配置生效
- 服务异常需要快速恢复
- 服务状态异常，需要清理缓存或连接
- 内存泄漏等问题需要重启服务

## 快速操作

### 1. 重启 Stage 环境服务（默认，更安全）

```
/restart-ecs session-gateway
/restart-ecs user-auth
/restart-ecs commerce-backend
```

**说明**：
- 默认重启 Stage 环境，避免误操作生产环境
- 使用 ECS `force-new-deployment` 实现零停机重启
- Task Definition 版本号不变

### 2. 重启 Prod 环境服务

```
/restart-ecs session-gateway prod
/restart-ecs user-auth prod
```

**说明**：
- 重启生产环境服务
- Claude 会主动确认是否继续
- 同样是零停机滚动更新

### 3. 列出可用服务

```
/restart-ecs list          # 列出 Stage 环境服务
/restart-ecs list prod     # 列出 Prod 环境服务
```

## 环境信息

### Stage 环境

**集群名**: `optima-stage-cluster`

**可用服务**:
| 服务简称 | 完整服务名 | 说明 |
|---------|-----------|------|
| user-auth | user-auth-stage | 用户认证服务 |
| user-auth-admin | user-auth-admin-stage | 认证管理后台 |
| commerce-backend | commerce-backend-stage | 电商后端 API |
| commerce-rq-worker | commerce-rq-worker-stage | RQ 后台任务 |
| commerce-rq-scheduler | commerce-rq-scheduler-stage | RQ 定时调度 |
| agentic-chat | agentic-chat-stage | AI 聊天服务 |
| session-gateway | session-gateway-stage | AI Shell 网关 |
| bi-backend | bi-backend-stage | BI 后端 |
| bi-dashboard | bi-dashboard-stage | BI 仪表板 |
| optima-scout | optima-scout-stage | 产品研究工具 |
| ai-shell-web-ui | ai-shell-web-ui-stage | Shell Web UI |
| optima-store | optima-store-stage | 商城前端 |
| pgbouncer | pgbouncer-stage | 数据库连接池 |

### Prod 环境

**集群名**: `optima-prod-cluster`

**可用服务**:
| 服务简称 | 完整服务名 | 说明 |
|---------|-----------|------|
| user-auth | user-auth-prod | 用户认证服务 |
| user-auth-admin | user-auth-admin-prod | 认证管理后台 |
| commerce-backend | commerce-backend-prod | 电商后端 API |
| commerce-rq-worker | commerce-rq-worker-prod | RQ 后台任务 |
| commerce-rq-scheduler | commerce-rq-scheduler-prod | RQ 定时调度 |
| agentic-chat | agentic-chat-prod | AI 聊天服务 |
| session-gateway | session-gateway-prod | AI Shell 网关 |
| bi-backend | bi-backend-prod | BI 后端 |
| bi-dashboard | bi-dashboard-prod | BI 仪表板 |
| optima-scout | optima-scout-prod | 产品研究工具 |
| ai-shell-web-ui | ai-shell-web-ui-prod | Shell Web UI |

**注意**: `optima-store` 和 `pgbouncer` 仅在 Stage 环境部署

## 重启原理

ECS `--force-new-deployment` 的工作流程：

1. **启动新 Task** - 使用当前 Task Definition 创建新实例
2. **健康检查** - 新 Task 通过 ALB 健康检查
3. **注册到 ALB** - 新 Task 开始接收流量
4. **停止旧 Task** - 旧 Task 优雅停止

这是一个**零停机**的滚动更新过程，用户请求不会中断。

## 常见使用场景

### 场景 1：服务配置更新后重启

当修改了 Infisical 中的环境变量后，需要重启服务使配置生效：

```
/restart-ecs commerce-backend stage
```

### 场景 2：服务异常恢复

服务出现内存泄漏或连接池耗尽等问题：

```
/restart-ecs session-gateway prod
```

### 场景 3：批量重启多个服务

需要重启多个相关服务：

```
# 依次重启
/restart-ecs user-auth stage
/restart-ecs commerce-backend stage
/restart-ecs agentic-chat stage
```

## 查看重启进度

重启触发后，可以查看部署状态：

```bash
# 查看服务部署状态
aws ecs describe-services \
  --cluster optima-stage-cluster \
  --services session-gateway-stage \
  --region ap-southeast-1 \
  --query 'services[0].deployments' \
  --output table
```

## 安全提醒

1. **Stage 优先**: 默认重启 Stage 环境，降低误操作风险
2. **Prod 确认**: 重启 Prod 服务前会主动确认
3. **版本不变**: 重启不会改变 Task Definition 版本号
4. **可恢复**: 如果新 Task 启动失败，旧 Task 会继续运行

## 相关命令

- `/restart-ecs` - 重启 ECS 服务（详细使用方法请查看 `/restart-ecs --help`）
- `/logs` - 查看服务日志，可用于确认重启后服务状态
