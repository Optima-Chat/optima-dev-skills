---
name: "logs"
description: "当用户请求查看日志、查看服务日志、排查问题、看看日志、检查日志、商品服务日志、后端日志、API日志、正式环境日志、生产环境日志、CI环境日志、开发环境日志、阿里云日志、cn-prod 日志、SAE 日志时，使用此技能。支持 CI、Stage、Prod（AWS ECS/CloudWatch）以及 cn-prod（阿里云 SAE/SLS）四个环境的 commerce-backend、user-auth、agentic-chat、gateway-core、optima-scout、optima-skills 等服务。"
allowed-tools: ["Bash", "SlashCommand"]
---

# 查看服务器日志

当你需要查看服务日志排查问题时，使用这个场景。

## 适用情况

- API 返回错误，需要查看详细错误信息
- 服务行为异常，需要查看运行日志
- 监控服务状态，查看日志输出
- 排查数据库连接、配置问题

## 快速操作

### 1. 查看 CI 环境日志（默认）

```
/logs commerce-backend
/logs user-auth 100
```

**说明**：
- 查看 CI 开发环境（dev.optima.chat）
- 默认环境，不需要指定 `ci` 参数
- 通过 SSH + Docker Compose 访问
- 从 GitHub Variables 获取认证信息

### 2. 查看 Stage 环境日志

```
/logs commerce-backend 50 stage
```

**说明**：
- 查看 Stage 预发布环境
- 使用 AWS CloudWatch Logs（ECS Fargate）

**常用服务**：
- `commerce-backend` - 电商 API
- `user-auth` - 用户认证
- `agentic-chat` - AI 聊天服务
- `bi-backend` - BI 后端
- `session-gateway` - AI Shell 网关

### 3. 查看更多日志行数

```
/logs commerce-backend 200
```

查看最近 200 行日志，用于排查历史问题。

### 4. 查看 Prod 环境日志

```
/logs commerce-backend 100 prod
```

查看生产环境日志（通过 AWS CloudWatch，ECS Fargate）。

## 常见问题排查

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

## 日志分析技巧

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

## 环境对比

### CI 环境

```
/logs user-auth 100 ci
```

**特点**：
- CI 开发环境，适合开发调试
- 实时性最好
- 查看 Docker Compose 日志

### Stage 环境

```
/logs commerce-backend 100 stage
```

**特点**：
- 预发布环境
- AWS ECS Fargate 运行（Fargate Spot）
- 通过 CloudWatch Logs 查看

### Prod 环境

```
/logs commerce-backend 100 prod
```

**特点**：
- 生产环境
- AWS ECS Fargate 运行
- 通过 CloudWatch Logs 查看
- 日志保留 7 天

### cn-prod 环境（阿里云）

```
/logs gateway-core 100 cn-prod
/logs agentic-chat 80 cn
```

**特点**：
- 阿里云 **SLS**（日志服务，cn-beijing），不是 AWS CloudWatch
- ✅ 用 `optima-logs <svc> --env cn-prod` **直连 SLS**（`aliyun sls GetLogsV2`，公网控制面 API）——免 buildbox 跳板，支持历史检索 + 时间窗（`--since`）+ 关键词（`--grep`）
- 前置：本机需装 `aliyun` CLI + `aliyun-optima` profile（cn-beijing）
- 旧的「buildbox → SAE `DescribeInstanceLog` 取当前缓冲」已弃用（缓冲式、重启即丢、不能检索）；技术细节见 `.claude/commands/logs.md`（即 `/logs` 命令文档）第 3 节

**🔴 cn 侧读数纪律（下结论前必看，详见 `.claude/commands/logs.md` 第 3 节；`--help` 里只有摘要）**：

- **`-n` 取满 ≠ 窗内只有这么多**：SLS 单次请求硬顶 100 条，工具已自动翻页，但取满 `-n` 时会打 ⚠——此时真实总数未知，**别拿这批数做计数或算比值**（两个都触顶的查询相除，比值是纯噪声）。要计数就缩窄 `--since` 到不再报 ⚠。
- **请求 `--since 24h` ≠ 覆盖了 24h**：以 stderr 打出的**实际覆盖窗**为准，不是以 `--since` 为准。
- **`--grep` 走 SLS 索引、不是本地正则**：正文没进索引的 logstore 上搜正文里的词会**静默少回**——零命中不代表「没有报错」，非零命中也不是真实次数（已知 **cn-stage 的 `agent-runtime`**：`content` 是 JSON 型索引、只覆盖 26 个白名单键，`message` 搜不到）。**但盲区只覆盖「词出现在正文里」这一种**：白名单键的值（`userId` / `sessionId` / `turnId` / `level`）搜起来是准的。工具用 `GetIndex` 直查后会在结果前告警，**看它给的结论**；纯按键查（`--grep 'content.level: error'`）不受影响、也不告警。实测取数与复跑命令**只维护在** `.claude/commands/logs.md` 第 3 节「读数纪律」第 3 条（即 `/logs` 命令文档，不是 `--help` 输出），本页不复制（同一组数曾三处手抄、漂成多个版本）。
- **`--grep` 里的 `|` 不是「或」**：SLS 拿它分隔「检索 | 分析(SQL)」。要或写 `'a or b'`，要整串当短语写 `'"a|b"'`，要 SQL 写 `'… | select …'`（此时 `-n` 失效，用 SQL `LIMIT`）。
- **数记录数用 `grep -c '__time__'`，不要用 `wc -l`**（`--json` 是 pretty-print，一条记录十几到二十行）。

## 支持的服务列表

| 服务 | 说明 | CI | Stage | Prod |
|------|------|:--:|:-----:|:----:|
| `commerce-backend` | 电商后端 API | ✓ | ✓ | ✓ |
| `user-auth` | 用户认证服务 | ✓ | ✓ | ✓ |
| `user-auth-admin` | 认证管理后台 | - | ✓ | ✓ |
| `agentic-chat` | AI 聊天服务 | ✓ | ✓ | ✓ |
| `bi-backend` | BI 后端 | - | ✓ | ✓ |
| `bi-dashboard` | BI 仪表板 | - | ✓ | ✓ |
| `session-gateway` | AI Shell 网关 | - | ✓ | ✓ |
| `ai-shell-web-ui` | Shell Web UI | - | ✓ | ✓ |
| `optima-scout` | 产品研究工具 | - | ✓ | ✓ |
| `optima-store` | 商城前端 | - | ✓ | - |
| `commerce-rq-worker` | RQ 后台任务 | - | ✓ | ✓ |
| `commerce-rq-scheduler` | RQ 定时调度 | - | ✓ | ✓ |
| `optima-logistics` | 物流服务 | - | ✓ | ✓ |

## 最佳实践

1. **先查日志，再动手修** - 不要猜测，看日志确认问题
2. **查足够多的行数** - 有时错误原因在更早的日志里
3. **关注启动日志** - 服务启动时的错误最关键
4. **保留错误日志** - 复制错误信息，方便分享讨论
5. **对比环境差异** - Stage 出错、Prod 正常？对比日志差异

## 相关命令

- `/logs` - 查看服务日志（详细使用方法和技术细节请查看 `/logs --help`）
