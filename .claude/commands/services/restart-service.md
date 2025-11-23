# /restart-service - 重启服务

重启指定的后端服务，支持本地、Stage、Prod 环境。

## 使用场景

**前端开发者**: 本地服务崩溃或无响应时快速重启
**后端开发者**: 更新代码后重启服务应用更改
**DevOps**: 处理生产环境服务异常

## 用法

/restart-service [service] [environment]

## 参数

- `service` (必需): 服务名称（commerce-backend/user-auth/mcp-host）
- `environment` (可选): 环境（local/stage/prod），默认 local

## 安全检查

Claude 应该执行以下安全检查：

1. **Prod 环境二次确认**:
   - 如果目标环境是 prod，必须向用户确认
   - 提示: "⚠️ 即将重启生产环境的 [service]，这可能影响线上用户。是否继续？"
   - 等待用户明确确认后才执行

2. **权限检查**:
   - Stage/Prod 需要 AWS 凭证或 SSH 密钥
   - 如果缺少凭证，提示用户配置

3. **健康检查**:
   - 重启后自动执行 health-check
   - 确认服务成功启动

## 执行逻辑

1. 识别环境
2. 执行对应的重启命令
3. 等待服务启动（约 10-30 秒）
4. 自动执行健康检查
5. 返回服务状态

## 命令示例

### 本地环境 - Commerce Backend

```bash
# 重启单个服务
docker compose restart commerce-backend

# 等待 15 秒
sleep 15

# 健康检查
curl -f http://localhost:8280/health || echo "❌ Service not healthy"
```

### 本地环境 - User Auth

```bash
docker compose restart user-auth
sleep 10
curl -f http://localhost:8290/health || echo "❌ Service not healthy"
```

### 本地环境 - MCP Host

```bash
docker compose restart mcp-host
sleep 10
curl -f http://localhost:8300/health || echo "❌ Service not healthy"
```

### Stage-ECS - Commerce Backend

```bash
# 强制新部署（ECS 会自动重启）
aws ecs update-service \
  --cluster optima-stage \
  --service commerce-backend-stage \
  --force-new-deployment

# 等待部署完成
aws ecs wait services-stable \
  --cluster optima-stage \
  --services commerce-backend-stage

# 健康检查
curl -f https://api.stage.optima.onl/health
```

### Prod - Commerce Backend (需要 SSH + 确认)

```bash
# ⚠️ 需要用户二次确认

# SSH 重启
ssh -i ~/.ssh/optima-ec2-key ec2-user@ec2-prod.optima.shop \
  "docker restart optima-commerce-backend-prod"

# 等待 20 秒
sleep 20

# 健康检查
curl -f https://api.optima.shop/health
```

## 预期输出

```
🔄 正在重启 commerce-backend (local)...
⏳ 等待服务启动 (15秒)...
✅ commerce-backend 已成功重启
✅ 健康检查通过: HTTP 200 OK
📊 响应时间: 45ms
```

## 相关命令

- /health-check - 检查服务健康状态
- /logs - 查看重启日志
- /service-status - 查看服务状态
