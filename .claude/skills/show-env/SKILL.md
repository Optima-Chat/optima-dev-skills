---
name: "show-env"
description: "当用户请求查看环境变量、查看配置、查看服务配置、环境变量是什么、env 变量、服务环境变量、查看 Infisical 配置时，使用此技能。支持查看当前 shell 环境变量，以及 Stage、Prod 环境的服务配置。"
allowed-tools: ["Bash", "SlashCommand"]
---

# 查看环境变量

当你需要查看环境变量或服务配置时，使用这个场景。

## 适用情况

- 查看当前 shell 的环境变量
- 查看服务的环境变量配置（从 Infisical）
- 排查环境配置问题
- 确认某个环境变量是否设置正确
- 对比不同环境的配置差异

## 快速操作

### 1. 查看当前 shell 环境变量

```bash
# 查看所有环境变量
env

# 查看特定环境变量
echo $OPTIMA_TOKEN
echo $OPTIMA_ENV

# 搜索包含特定关键字的环境变量
env | grep -i optima
env | grep -i aws
env | grep -i database
```

### 2. 查看 Infisical 中的服务配置

使用 `optima-show-env` CLI 工具查看存储在 Infisical 中的服务配置：

```bash
# 查看 Stage 环境的 commerce-backend 配置
optima-show-env commerce-backend stage

# 查看 Prod 环境的 user-auth 配置
optima-show-env user-auth prod

# 查看 Stage 环境的 agentic-chat 配置
optima-show-env agentic-chat stage
```

**支持的服务**：
- `commerce-backend` - 电商后端 API
- `user-auth` - 用户认证服务
- `agentic-chat` - AI 聊天服务
- `bi` - BI 后端
- `session-gateway` - AI Shell 网关
- `optima-store` - 商城前端
- `optima-scout` - 产品研究工具
- `mcp-host` - MCP 主机

**支持的环境**：
- `stage` - Stage 预发布环境
- `prod` - Prod 生产环境

### 3. 使用过滤和选项

```bash
# 只查看数据库相关配置
optima-show-env commerce-backend stage --filter DATABASE

# 只查看 STRIPE 相关配置
optima-show-env commerce-backend stage --filter STRIPE

# 只显示变量名（不显示值）
optima-show-env user-auth prod --keys-only
```

## 常见场景

### 场景 1：确认环境变量是否设置

**用户请求**："帮我看看 OPTIMA_TOKEN 环境变量设置了没有"

**步骤**：
```bash
# 检查是否设置
if [ -n "$OPTIMA_TOKEN" ]; then
  echo "OPTIMA_TOKEN 已设置"
  echo "长度: ${#OPTIMA_TOKEN} 字符"
else
  echo "OPTIMA_TOKEN 未设置"
fi
```

### 场景 2：排查服务配置问题

**用户请求**："commerce-backend 连接不上数据库，帮我看看配置"

**步骤**：
1. 查看数据库相关配置：
   ```bash
   optima-show-env commerce-backend stage --filter DATABASE
   ```
2. 确认连接字符串格式
3. 检查密码是否包含特殊字符需要转义

### 场景 3：对比不同环境配置

**用户请求**："对比一下 Stage 和 Prod 环境的配置差异"

**步骤**：
```bash
# 导出两个环境的配置（只看变量名）
optima-show-env commerce-backend stage --keys-only > /tmp/env-stage.txt
optima-show-env commerce-backend prod --keys-only > /tmp/env-prod.txt

# 对比差异
diff /tmp/env-stage.txt /tmp/env-prod.txt
```

### 场景 4：查看特定类型配置

**用户请求**："帮我看看 Stripe 相关配置"

**步骤**：
```bash
optima-show-env commerce-backend stage --filter STRIPE
optima-show-env commerce-backend prod --filter STRIPE
```

## 环境变量分类

### 常见环境变量类型

| 类型 | 示例变量 | 说明 |
|------|----------|------|
| 数据库 | `DATABASE_URL`, `DB_HOST`, `DB_PASSWORD` | 数据库连接配置 |
| Redis | `REDIS_URL`, `REDIS_HOST`, `REDIS_DB` | 缓存配置 |
| AWS/S3 | `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` | 对象存储配置 |
| Auth | `JWT_SECRET_KEY`, `OAUTH_CLIENT_ID`, `SECRET_KEY` | 认证相关配置 |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | 支付配置 |
| 应用 | `DEBUG`, `LOG_LEVEL`, `NODE_ENV` | 应用运行配置 |

## CLI 选项说明

| 选项 | 说明 |
|------|------|
| `--filter <pattern>` | 按变量名过滤（不区分大小写） |
| `--keys-only` | 只显示变量名，不显示值 |
| `--help` | 显示帮助信息 |

## 故障排查

### 问题 1：optima-show-env 命令不存在

**解决方案**：
```bash
# 安装或更新工具
npm install -g @optima-chat/dev-skills@latest
```

### 问题 2：无法访问 Infisical

**可能原因**：
- GitHub CLI 未登录
- 无权访问 Optima-Chat/optima-dev-skills 仓库的 Variables

**解决方案**：
- 运行 `gh auth login` 登录 GitHub
- 确认有仓库访问权限

### 问题 3：服务不存在

**错误信息**: "Unknown service 'xxx'"

**解决方案**：
- 检查服务名称拼写
- 运行 `optima-show-env --help` 查看支持的服务列表

## 相关命令

- `/show-env` - 查看环境变量
- `/logs` - 查看服务日志
- `/query-db` - 查询数据库
