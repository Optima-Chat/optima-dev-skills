---
name: "Deploying Services"
description: "部署服务 - 部署到 Stage/Prod、查看部署状态、回滚"
allowed-tools: ["Bash", "SlashCommand"]
---

# 部署服务

当你需要部署代码到 Stage 或 Prod 环境时，使用这个场景。

## 🎯 适用情况

- 完成功能开发，部署到 Stage 测试
- Stage 测试通过，部署到 Prod
- 查看部署状态和历史
- 紧急回滚

## 🚀 快速部署流程

### Stage 部署（自动）

```bash
# 1. 确保代码已推送
git status
git push origin main

# 2. GitHub Actions 自动触发部署
# 推送到 main 分支 → 自动部署到 Stage

# 3. 等待部署完成（约 3-5 分钟）
gh run list --limit 5

# 4. 验证部署
/health-check stage
```

### Prod 部署（需要 Tag）

```bash
# 1. 确保 Stage 测试通过

# 2. 创建版本 Tag
git tag v1.2.0
git push origin v1.2.0

# 3. GitHub Actions 自动触发 Prod 部署

# 4. 验证部署
/health-check prod
```

## 📋 部署前检查清单

### 代码质量

- [ ] 所有测试通过
```bash
pytest
```

- [ ] 代码已 Review
```bash
gh pr view  # 查看 PR 状态
```

- [ ] 没有 TODO 或 FIXME
```bash
git grep -i "TODO\|FIXME"
```

### 数据库迁移

- [ ] 迁移文件已创建
```bash
ls alembic/versions/
```

- [ ] 迁移已在本地测试
```bash
alembic upgrade head
alembic downgrade -1
alembic upgrade head
```

- [ ] 迁移向后兼容（不会破坏旧代码）

### 环境变量

- [ ] 新环境变量已添加到 Infisical
```bash
infisical export --env=stage | grep NEW_VAR
infisical export --env=prod | grep NEW_VAR
```

- [ ] 环境变量文档已更新

### API 变更

- [ ] API 文档已更新（Swagger）
- [ ] 前端代码已同步更新
- [ ] 向后兼容（不会破坏现有客户端）

## 🔍 查看部署状态

### GitHub Actions

```bash
# 查看最近的 workflow 运行
gh run list --limit 5

# 查看特定 run 的详情
gh run view <run-id>

# 查看 run 的日志
gh run view <run-id> --log
```

### ECS 服务状态

```bash
# 查看 Stage ECS 服务
aws ecs describe-services \
  --cluster optima-stage \
  --services commerce-backend-stage

# 查看任务运行状态
aws ecs list-tasks \
  --cluster optima-stage \
  --service-name commerce-backend-stage
```

### 查看部署日志

```
# Stage 环境
/backend-logs commerce-backend stage

# Prod 环境
/backend-logs commerce-backend prod
```

## ✅ 部署后验证

### 1. 健康检查

```
/health-check stage
```

**预期输出**：
```
✅ commerce-backend: Running (200 OK)
✅ user-auth: Running (200 OK)
✅ mcp-host: Running (200 OK)
```

### 2. API 功能测试

```
# 获取 Stage Token
/get-token test@optima.ai stage

# 测试关键 API
/test-api /products GET stage
/test-api /orders/merchant GET stage
```

### 3. 检查日志

```
/backend-logs commerce-backend 50 stage
```

**查找**：
- ❌ ERROR 日志
- ✅ 启动成功日志
- ✅ 数据库连接成功

### 4. 数据库迁移验证

```
# 连接数据库检查
/db-connect commerce stage

# 查看迁移版本
\c optima_stage_commerce
SELECT * FROM alembic_version;

# 查看新表或新字段
\d products
```

## 🔄 回滚部署

### 场景 1：Stat失败，快速回滚

**症状**：
- 部署后服务不健康
- API 返回大量错误
- 关键功能无法使用

**回滚步骤**：

```bash
# 1. 查看当前任务定义
aws ecs describe-services \
  --cluster optima-stage \
  --services commerce-backend-stage \
  --query 'services[0].taskDefinition'

# 2. 回滚到上一个任务定义
aws ecs update-service \
  --cluster optima-stage \
  --service commerce-backend-stage \
  --task-definition commerce-backend-stage:<previous-revision>

# 3. 等待回滚完成
aws ecs wait services-stable \
  --cluster optima-stage \
  --services commerce-backend-stage

# 4. 验证
/health-check stage
```

### 场景 2：Prod 紧急回滚

**⚠️ 谨慎操作，需要团队确认**

```bash
# 1. 通知团队

# 2. 查看部署历史
gh run list --workflow=deploy-prod.yml --limit 10

# 3. 选择上一个成功的 Tag
git tag -l --sort=-v:refname | head -5

# 4. 重新部署上一个版本
git tag v1.1.0-rollback
git push origin v1.1.0-rollback

# 5. 等待部署完成并验证
/health-check prod
```

### 数据库迁移回滚

**⚠️ 非常危险，可能导致数据丢失**

```bash
# 1. 连接数据库
/db-connect commerce stage

# 2. 查看当前版本
SELECT * FROM alembic_version;

# 3. 回滚迁移（如果安全）
alembic downgrade -1

# 4. 重启服务
/restart-service commerce-backend stage
```

## 📊 部署监控

### 关键指标

- **部署成功率** - 目标 > 95%
- **部署时间** - 目标 < 5 分钟
- **回滚率** - 目标 < 5%
- **服务可用性** - 目标 > 99.9%

### 部署后观察期

**新部署后 30 分钟内**：

1. **监控日志**：
```
/backend-logs commerce-backend stage
```

2. **监控错误率**：
```bash
# 查看 ERROR 日志数量
docker compose logs commerce-backend | grep ERROR | wc -l
```

3. **监控响应时间**：
```bash
# 查看 response_time 日志
docker compose logs commerce-backend | grep response_time
```

4. **用户反馈**：
   - 查看 Sentry 错误报告
   - 查看用户反馈渠道

## 🚨 部署失败处理

### 常见失败原因

**1. 构建失败**

```
Error: Docker build failed
```

**排查**：
- 查看 GitHub Actions 日志
- 检查 Dockerfile 语法
- 检查依赖安装

**2. 部署超时**

```
Error: Deployment timeout after 10 minutes
```

**排查**：
- 服务启动失败，查看日志
- 健康检查失败
- 资源不足（CPU、内存）

**3. 迁移失败**

```
Error: Database migration failed
```

**排查**：
- 查看迁移日志
- 检查迁移文件语法
- 检查数据库权限

**4. 环境变量缺失**

```
Error: Required environment variable not set
```

**排查**：
- 检查 Infisical 配置
- 验证环境变量名称
- 确认服务配置

## 🌐 部署环境对比

| 环境 | 触发方式 | 部署时间 | 验证要求 | 回滚难度 |
|------|---------|---------|---------|---------|
| **Local** | 手动 | 立即 | 无 | 简单 |
| **Stage** | Push to main | 3-5 分钟 | 功能测试 | 简单 |
| **Prod** | Push tag | 5-10 分钟 | 完整测试 + 审批 | 中等 |

## 💡 部署最佳实践

### 1. 小步部署

- ✅ 每次部署一个小功能
- ✅ 容易测试和回滚
- ❌ 避免大规模改动一次部署

### 2. 先部署 Stage

- ✅ Stage 测试通过再部署 Prod
- ✅ 在 Stage 验证数据库迁移
- ✅ 在 Stage 验证环境变量

### 3. 数据库迁移分离

- ✅ 迁移和代码分开部署
- ✅ 先部署迁移，再部署代码
- ✅ 确保向后兼容

### 4. 金丝雀部署（未来）

- 先部署到一小部分实例
- 观察指标正常后全量部署
- 问题影响面最小

### 5. 蓝绿部署（未来）

- 新版本部署到新环境
- 切换流量到新环境
- 旧环境保留，方便快速回滚

## 🔗 相关命令

- `/health-check` - 检查服务健康
- `/backend-logs` - 查看部署日志
- `/service-status` - 查看服务状态
- `/test-api` - 测试 API 功能
- `/db-connect` - 验证数据库迁移

## 📚 相关文档

- GitHub Actions workflows: `.github/workflows/`
- ECS 服务配置: `terraform/`
- 部署文档: `docs/DEPLOYMENT.md`

## ⚠️ 禁止事项

### Prod 环境

- ❌ 不要直接 SSH 到 Prod 修改文件
- ❌ 不要在 Prod 直接运行 SQL 修改数据
- ❌ 不要跳过 Stage 直接部署 Prod
- ❌ 不要在工作时间部署 Prod（非紧急）
- ❌ 不要 force push 到 main 或 tag

### 最佳部署时间

- **Stage**: 随时
- **Prod**:
  - ✅ 周一到周四 10:00-16:00（问题可以当天解决）
  - ❌ 周五下午（周末无人值班）
  - ❌ 节假日前后
  - 例外：紧急安全补丁
