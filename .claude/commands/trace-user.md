# /trace-user - 用户链路追踪

查看指定用户在 agentic-chat -> optima-gateway -> agent-runtime 全链路的日志，分析耗时、成功/失败、返回值等。

**版本**: v0.1.0

## 使用场景

**前端开发者**: 用户反馈 "聊天没反应"，快速定位是前端、网关还是 Agent 的问题
**后端开发者**: 追踪特定用户的请求链路，分析 LLM 调用耗时和工具执行
**DevOps**: 排查线上用户问题，查看完整的跨服务日志关联

## 用法

```
/trace-user <user-id-or-email> [environment] [time-range] [options]
```

## 参数

- `user-id-or-email` (必需): 用户标识
  - 包含 `@` → email（用 `userEmail` 字段过滤）
  - UUID 格式 → userId（用 `userId` 字段过滤）
- `environment` (可选): `stage` 或 `prod`，默认 `stage`
- `time-range` (可选): 如 `10m`, `30m`, `1h`, `2h`, `1d`，默认 `30m`
- 选项:
  - `--errors` — 只看 error/warn 级别
  - `--session SESSION_ID` — 限定某个 session
  - `--trace TRACE_ID` — 限定某个 traceId
  - `--raw` — 显示原始 JSON

## 示例

```bash
/trace-user alice@example.com                    # Stage，最近 30 分钟
/trace-user 37c03a9f-0b47-409c-81a3-5634eaab1a6c prod 2h  # Prod，最近 2 小时
/trace-user alice@example.com --errors           # 只看错误
/trace-user alice@example.com --session sess-xxx # 指定 session
```

如果用户输入 `/trace-user` 或 `/trace-user --help`，显示此帮助文档，不执行查询。

ARGUMENTS: $ARGUMENTS

## Claude Code 执行步骤

### 1. 解析参数

从 `$ARGUMENTS` 中解析用户标识、环境、时间范围和选项。

**用户标识判断**:
- 包含 `@` → email → 使用 `userEmail` 字段
- UUID 格式（`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`）→ 使用 `userId` 字段
- 其他 → 当作 userId 尝试

### 2. 日志组映射

三层服务对应的 CloudWatch Log Group：

| 层 | 服务 | Stage 日志组 | Prod 日志组 |
|----|------|-------------|------------|
| L1 | agentic-chat | `/ecs/agentic-chat-stage` | `/ecs/agentic-chat-prod` |
| L2 | gateway-core | `/ecs/gateway-core-stage` | `/ecs/gateway-core-prod` |
| L3 | agent-runtime | `/ecs/gw-agent-runtime-stage` | `/ecs/gw-agent-runtime-prod` |

**AWS 区域**: `ap-southeast-1`

### 3. 搜索策略

#### 第一步：在 gateway-core 找到用户的 session

```bash
# 按 email 搜索
aws logs filter-log-events \
  --log-group-name /ecs/gateway-core-{ENV} \
  --filter-pattern '{ $.userEmail = "USER_EMAIL" }' \
  --start-time $(date -d 'TIME_RANGE ago' +%s)000 \
  --region ap-southeast-1 \
  --output json | head -100

# 按 userId 搜索
aws logs filter-log-events \
  --log-group-name /ecs/gateway-core-{ENV} \
  --filter-pattern '{ $.userId = "USER_ID" }' \
  --start-time $(date -d 'TIME_RANGE ago' +%s)000 \
  --region ap-southeast-1 \
  --output json | head -100
```

从结果中提取 `sessionId` 和 `traceId`。

#### 第二步：跨服务关联查询（Logs Insights）

优先使用 CloudWatch Logs Insights 跨多个 log group 查询：

```bash
# 按 userId/email 跨服务查询
aws logs start-query \
  --log-group-names \
    /ecs/gateway-core-{ENV} \
    /ecs/gw-agent-runtime-{ENV} \
  --start-time $(date -d 'TIME_RANGE ago' +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @logStream, @message
    | filter userId = "USER_ID" or userEmail = "USER_EMAIL"
    | sort @timestamp asc
    | limit 500
  ' \
  --region ap-southeast-1

# 等几秒后获取结果
aws logs get-query-results --query-id QUERY_ID --region ap-southeast-1
```

如果已知 sessionId：

```bash
aws logs start-query \
  --log-group-names \
    /ecs/gateway-core-{ENV} \
    /ecs/gw-agent-runtime-{ENV} \
  --start-time $(date -d 'TIME_RANGE ago' +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @logStream, level, message, sessionId, traceId, duration_ms
    | filter sessionId = "SESSION_ID"
    | sort @timestamp asc
    | limit 500
  ' \
  --region ap-southeast-1
```

#### 第三步：agentic-chat 日志（补充）

agentic-chat 前端日志可能不含 userId/sessionId 字段，用时间窗口 + 关键词辅助：

```bash
aws logs tail /ecs/agentic-chat-{ENV} --since {TIME_RANGE} \
  --region ap-southeast-1 | grep -i "USER_EMAIL_OR_ID"
```

#### 第四步：只看错误（--errors）

```bash
aws logs start-query \
  --log-group-names \
    /ecs/gateway-core-{ENV} \
    /ecs/gw-agent-runtime-{ENV} \
  --start-time $(date -d 'TIME_RANGE ago' +%s) \
  --end-time $(date +%s) \
  --query-string '
    fields @timestamp, @logStream, level, message, sessionId, error
    | filter (userId = "USER_ID" or userEmail = "USER_EMAIL")
      and (level = "error" or level = "warn")
    | sort @timestamp asc
    | limit 200
  ' \
  --region ap-southeast-1
```

### 4. 结构化日志字段参考

optima-gateway 的日志通过 AsyncLocalStorage 自动注入：

```json
{
  "timestamp": "2026-04-16T10:30:00.000Z",
  "level": "info",
  "service": "gateway-core",
  "userId": "37c03a9f-...",
  "userEmail": "alice@example.com",
  "sessionId": "sess-xxx",
  "traceId": "gw-abc123",
  "message": "Session created",
  "duration_ms": 123
}
```

**关键字段**:
- `userId` / `userEmail` — 用户标识
- `sessionId` — 会话 ID
- `traceId` — 跨服务链路 ID
- `duration_ms` — 操作耗时
- `level` — 日志级别（info/warn/error）

### 5. 输出格式

#### A. 概览信息

```
用户: alice@example.com (37c03a9f-...)
环境: Stage
时间范围: 最近 30 分钟
找到 session 数: 3
```

#### B. Session 列表

| Session ID | 创建时间 | 状态 | 持续时间 | 消息数 | 错误数 |
|-----------|---------|------|---------|-------|-------|
| sess-001 | 10:30:00 | running | 5m | 12 | 0 |
| sess-002 | 10:20:00 | terminated | 8m | 24 | 1 |

#### C. 请求链路时间线

```
Session: sess-001
TraceId: gw-abc123

时间线：
┌──────────────────────────────────────────────────────────────────────┐
│ 10:30:00.000 [gateway-core]   WS connected, authenticating...       │
│ 10:30:00.150 [gateway-core]   OIDC verified, userId=37c03a9f       │ +150ms
│ 10:30:00.200 [gateway-core]   Session creating                      │ +50ms
│ 10:30:00.800 [gateway-core]   Agent task started (ECS RunTask)      │ +600ms
│ 10:30:03.200 [agent-runtime]  Container ready, WS connected         │ +2400ms
│ 10:30:03.250 [gateway-core]   Session running                       │ +50ms
│ 10:30:05.000 [gateway-core]   Client message received               │
│ 10:30:05.100 [agent-runtime]  LLM request started (openai)          │ +100ms
│ 10:30:08.500 [agent-runtime]  LLM response complete                 │ +3400ms
│ 10:30:08.600 [agent-runtime]  Tool call: read_file                  │
│ 10:30:08.800 [agent-runtime]  Tool result returned                  │ +200ms
│ 10:30:09.000 [gateway-core]   Message forwarded to client           │
└──────────────────────────────────────────────────────────────────────┘
```

#### D. 耗时分析

```
关键耗时:
  OIDC 认证:         150ms
  Session 创建:       50ms
  ECS 容器启动:     2400ms  (>2s 时标记 warning)
  WS 回连:            50ms
  首次 LLM 调用:    3400ms
  工具执行:          200ms

统计:
  总消息数: 12 (user: 5, assistant: 7)
  LLM 调用次数: 7
  平均 LLM 延迟: 2800ms
  工具调用次数: 3
```

#### E. 错误/告警

```
发现 1 个错误:
  10:35:12 [agent-runtime] ERROR: LLM request failed
    provider: openai
    error: "rate_limit_exceeded"
    sessionId: sess-002
    → 已自动重试（CircuitBreaker half-open）
```

### 6. 常用诊断场景

| 用户报告 | 推荐策略 |
|---------|---------|
| "连不上" / "打不开" | 查 gateway-core 连接日志 + OIDC 认证 |
| "没反应" / "卡住了" | 查 agent-runtime 是否收到消息 + LLM 是否响应 |
| "回复慢" | 查 duration_ms 字段，分析 ECS 启动 + LLM 延迟 |
| "出错了" / "报错" | `--errors` 模式，重点看 error 级别 |
| "用了一半断了" | 查 WS 断连事件 + session 状态变化 |
| "总是失败" | 查 CircuitBreaker 状态 + provider 切换日志 |

### 7. 快捷跟进命令

```bash
# 查看服务健康状态
curl -s https://gw.stage.optima.onl/health | jq .
curl -s https://ai.stage.optima.onl/api/health | jq .

# 查看服务 debug 信息
curl -s -H "X-Debug-Key: 7eede5747b6c50f1c8f2358b98462f74696cdef9bfeab85eaf7ea41166788b5c" \
  https://gw.stage.optima.onl/debug/info | jq .

# 查看 ECS 服务状态
aws ecs describe-services --cluster optima-stage-cluster \
  --services gateway-core-stage --region ap-southeast-1 \
  --query 'services[0].{status:status,running:runningCount,desired:desiredCount}'
```

## 注意事项

1. **CloudWatch 延迟**: 最新日志可能需要等 10-30 秒才出现
2. **速率限制**: `filter-log-events` 有限流，大范围查询优先用 `start-query` (Logs Insights)
3. **日志保留**: CloudWatch 保留 14 天
4. **结构化日志**: JSON 日志输出到 stderr，在 CloudWatch 中显示为普通文本行
5. **Insights 限制**: 最多返回 10000 条，一般够用
6. **权限要求**: 需要 AWS CLI 配置了正确的凭证（`ap-southeast-1` 区域）
7. 如果用户没有任何日志，可能是该用户在指定时间范围内没有活动、标识输入有误、或服务未部署
