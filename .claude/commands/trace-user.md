# /trace-user - 用户链路追踪（一条龙）

按账号把一个用户在 agentic-chat → gateway-core → agent-runtime 全链路的行为**从结构化日志**拼成一条时间线：每次 LLM 调用（模型 / token / 延迟 / 缓存命中 / stop reason）、每个工具执行、子代理 spawn、报错，按 `userId → session → conversation → turn` 聚合。

**版本**: v0.3.0

> **v0.3 新增**：**反向追踪**（一段内容 → 是谁 → 手机号，§6），cn-prod 真实账号双向实测通过。
>
> **v0.2 做了什么**（相对 v0.1）：
> - **数据源 = 结构化日志**（不是 OTel trace）。一条龙所需的全部字段（model / inputTokens / outputTokens / cacheHitRate / stopReason / toolCount / durationMs / 子代理 spawn / 报错）本就逐条落在 agent-runtime 的结构化日志里，并可靠流入日志后端；按关联键拼装即可。
> - **新增 cn-stage / cn-prod 分支**（阿里云 SLS，`optima-logs` 直连），与 AWS（CloudWatch）并列。
> - **关联键标准化**：`userId`(=enduser) → `sessionId`(`ses_*`) → `conversationId` → `turnId`。
>
> **双向**：
> - **正向**（手机/userId → 一条龙时间线）—— §1–§5，结构化日志 + messages 表。
> - **反向**（一段内容 → 是谁 → 手机号）—— §6，`messages` 表 `content ILIKE` 检索 → user_id → user-auth 解手机号。**已实测可用**（cn-prod 真实账号双向验证）。
>
> **不在本工具范围（已知、刻意不做）**：
> - OTel **原生跨服务 trace 树**（browser→gateway→agent 一个 traceId 的可视化）—— 那条线在 cn 仍有未通的缺陷（业务 span 采样/context 抑制 + SLS ingest 限流），单独跟踪（gateway#1219），不阻塞本工具。本工具用日志/DB 关联键做"逻辑一条龙"，覆盖同样的信息维度。
> - **可扩展的中文全文索引**（zhparser/分词，给高 QPS 内容搜索用）—— cn RDS 装不了扩展，单独排（#1201）。一次性反查用 `ILIKE` 已够，不依赖它。

## 用法

```
/trace-user <user-id-or-email> [environment] [time-range] [options]
```

## 参数

- `user-id-or-email` (必需): 用户标识
  - 包含 `@` → email（AWS 用 `userEmail` 字段；cn 多数日志只带 `userId`，email 需先换 userId）
  - UUID 格式 → `userId`（= span 里的 enduser.id）
- `environment` (可选): `stage` | `prod` | `cn-stage` | `cn-prod`，默认 `stage`
- `time-range` (可选): `10m` `30m` `1h` `2h` `1d`，默认 `30m`
- 选项:
  - `--errors` — 只看 error/warn 级别
  - `--session SESSION_ID` — 限定某个 session（`ses_*`）
  - `--turn TURN_ID` — 限定某个 turn
  - `--raw` — 显示原始 JSON 日志行
  - `--summary` — 只输出统计聚合（不逐条打时间线）

## 示例

```bash
/trace-user 9781cf19-3d9a-451f-af5b-0a4f8b3397d9 cn-stage 1h   # cn-stage，最近 1 小时
/trace-user alice@example.com prod 2h                          # AWS prod
/trace-user 9781cf19-... cn-prod --session ses_azwDo9estPhg17Axb8q7q
/trace-user 9781cf19-... cn-stage --errors                     # 只看错误
```

如果用户输入 `/trace-user` 或 `/trace-user --help`，显示此帮助文档，不执行查询。

ARGUMENTS: $ARGUMENTS

---

## 核心概念：关联键 + 数据源

**一条龙不依赖 OTel trace，靠日志里的关联键自然串起来：**

```
userId (账号 UUID, = enduser.id)
  └─ sessionId         ses_xxxxxxxxxxxx       一次 WS 会话 / 一个 agent 容器生命周期
       └─ conversationId  cmqxxxx / <sess>-conv  一段对话
            └─ turnId       turn-xxxx-xxxx        一个 agentic turn（= 一轮用户消息触发的
                                                  LLM↔tool 循环，通常含多次 LLM 调用）
```

每条结构化日志都带 `userId / sessionId / conversationId / turnId`，所以按这些键 group 即可重建任意层级的时间线。

**各服务承载的信息（哪层查哪个 logstore）：**

| 层 | 服务 (logstore/log group) | 这条龙里给什么 |
|----|--------------------------|---------------|
| L1 | agentic-chat | 前端/BFF（SSR）。聊天链路主要走浏览器 WS 直连 gateway，前端日志辅助看连接/报错 |
| L2 | gateway-core | WS 连接、鉴权(OIDC)、session 创建、消息转发、`traceId`、`duration_ms` |
| L3 | **agent-runtime** | **一条龙核心**：每次 LLM 调用(model/token/延迟/cache/stopReason)、工具执行、子代理 spawn、turn 生命周期 |

> 经验：L3 (agent-runtime) 承载一条龙 90% 的价值。L2 补会话/连接/鉴权上下文。

---

## 执行步骤

### A. 选择执行方式（按 environment）

| environment | 部署 | 取日志方式 |
|---|---|---|
| `stage` / `prod` | AWS ECS Fargate | AWS CloudWatch Logs（第 1 节） |
| `cn-stage` / `cn-prod` | 阿里云 SAE / ECI | `optima-logs` 直连阿里云 SLS（第 2 节，**首选**） |

### 1. AWS（environment = stage / prod）

日志组：`/ecs/<service>-<env>`（区域 `ap-southeast-1`，prod 必须带 `--region ap-southeast-1`）。

```bash
# 第一步：在 agent-runtime 找该用户的所有 turn（一条龙核心数据都在这）
aws logs filter-log-events \
  --log-group-name /ecs/gw-agent-runtime-{ENV} \
  --filter-pattern '{ $.userId = "USER_ID" }' \
  --start-time $(date -d 'TIME_RANGE ago' +%s)000 \
  --region ap-southeast-1 --output json | jq -r '.events[].message'

# 第二步：跨服务关联（Logs Insights，gateway-core + agent-runtime）
aws logs start-query \
  --log-group-names /ecs/gateway-core-{ENV} /ecs/gw-agent-runtime-{ENV} \
  --start-time $(date -d 'TIME_RANGE ago' +%s) --end-time $(date +%s) \
  --query-string 'fields @timestamp, @logStream, message, userId, sessionId, conversationId, turnId, model, inputTokens, outputTokens, elapsedMs, stopReason, duration_ms
    | filter userId = "USER_ID" or userEmail = "USER_EMAIL"
    | sort @timestamp asc | limit 1000' \
  --region ap-southeast-1
# 等几秒：aws logs get-query-results --query-id QUERY_ID --region ap-southeast-1
```

服务映射（AWS）：`agentic-chat`→`/ecs/agentic-chat-<env>`，`gateway-core`→`/ecs/gateway-core-<env>`，`agent-runtime`→`/ecs/gw-agent-runtime-<env>`。

### 2. cn-stage / cn-prod（阿里云 SLS，首选 `optima-logs`）

> SLS `GetLogs` 是公网控制面 API，本机 `aliyun-optima` profile 直连即可，支持历史检索+时间窗+关键词。
> SLS project：`optima-cn-stage-1911493506120573` / `optima-cn-prod-1911493506120573`；logstore == service 名；正文在 `content`。

```bash
# 第一步（核心）：agent-runtime —— 拉该用户全部 LLM/tool/turn 结构化日志
optima-logs agent-runtime --env {cn-stage|cn-prod} --since {TIME_RANGE} --grep "USER_ID" -n 500 --json

# 第二步：gateway-core —— 会话/连接/鉴权上下文
optima-logs gateway-core --env {cn-stage|cn-prod} --since {TIME_RANGE} --grep "USER_ID" -n 200 --json

# 限定某个 session / turn（缩小范围）
optima-logs agent-runtime --env cn-stage --since 1h --grep "ses_xxxxx" -n 500 --json
optima-logs agent-runtime --env cn-stage --since 1h --grep "turn-xxxx-xxxx" -n 200 --json

# 只看错误
optima-logs agent-runtime --env cn-stage --since 1h --grep "USER_ID" -n 500 --json \
  | jq '.[] | (.content|fromjson?) | select(.level=="error" or .level=="warn")'

# 底层（一般不用）：aliyun sls GetLogs --project optima-cn-stage-1911493506120573 \
#   --logstore agent-runtime --from $FROM --to $NOW --line 500 --query "USER_ID" \
#   --region cn-beijing --profile aliyun-optima
```

> **解析 `--json` 输出（重要）**：`optima-logs ... --json` 返回**一个 JSON 数组**，每个元素是 SLS 记录（带 `__source__`/`eci_id`/`_image_name_` 等元字段），**结构化日志正文是 `.content` 字段里的 JSON 字符串**。所以解析模式固定是 `.[] | (.content|fromjson?)`，再 select 业务字段。元字段 `_image_name_` 还能顺带看是哪个镜像 digest 的容器在服务。

**一条龙拼装 + 统计的 canonical 配方（已实测可用）：**
```bash
U=<USER_ID>
# 时间线：每次 LLM 调用一行（model / token / 延迟 / cache / stopReason），按 turn
optima-logs agent-runtime --env cn-stage --since 1h --grep "$U" -n 1200 --json \
| jq -r '[.[] | (.content|fromjson?)] | map(select(.message=="LLM stream completed"))
    | sort_by(.timestamp) | .[]
    | "\(.timestamp[11:19])  sess=\(.sessionId[-6:]) turn=\(.turnId[-8:])  \(.model)  in\(.inputTokens)/out\(.outputTokens)  \(.elapsedMs)ms  cache\((.cacheHitRate*1000|floor)/10)%  →\(.stopReason)"'

# 统计：调用次数 / token 合计 / 延迟 / stop 分布 / 子代理 spawn
optima-logs agent-runtime --env cn-stage --since 1h --grep "$U" -n 2000 --json \
| jq '[.[] | (.content|fromjson?)] as $all | ($all|map(select(.message=="LLM stream completed"))) as $llm
  | { "LLM调用次数":($llm|length), "不同session":([$llm[].sessionId]|unique|length), "不同turn":([$llm[].turnId]|unique|length),
      "输入token":($llm|map(.inputTokens)|add), "输出token":($llm|map(.outputTokens)|add),
      "平均延迟ms":(($llm|map(.elapsedMs)|add)/($llm|length)|floor), "最慢ms":($llm|map(.elapsedMs)|max),
      "慢调用>5s":($llm|map(select(.elapsedMs>5000))|length),
      "stop分布":($llm|group_by(.stopReason)|map({(.[0].stopReason//"?"):length})|add),
      "子代理spawn":($all|map(select(.event_key=="spawn.lifecycle" and .phase=="completed"))|length),
      "模型":([$llm[].model]|unique) }'
```

> ⚠️ cn 多数 agent-runtime 日志只带 `userId` 不带 `userEmail`。若输入 email，先去 user-auth 换 userId（见 query-db / account 技能），再用 userId 查。
> ⚠️ `--grep` 是 SLS 全文检索；userId/sessionId/turnId 都是高区分度 token，直接 grep 即可精确命中。

---

## 3. 结构化日志字段参考（真实 schema）

**LLM 调用**（`service` = `openai-compat-provider` 或具体 provider，message = `LLM request sending` / `LLM response headers received` / `LLM first chunk received` / `LLM stream completed`）：

```json
{ "userId","sessionId","conversationId","turnId",
  "model":"deepseek-v4-pro", "baseUrl":"https://api.deepseek.com/v1",
  "messageCount":320, "toolCount":14, "status":200,
  "ttfbMs":408, "firstChunkMs":8, "chunksReceived":384, "elapsedMs":6753,
  "inputTokens":653, "outputTokens":422, "cacheReadTokens":105344, "cacheHitRate":0.994,
  "stopReason":"tool_use" }
```
> 一个 `turnId` 下通常有**多次** `LLM stream completed`（agentic 循环：LLM→tool_use→LLM→…）。把它们按时间排好就是这个 turn 的"思考过程"。

**子代理 spawn**（`service` = `agent-runtime:spawn`，`event_key` = `spawn.lifecycle`）：
```json
{ "message":"spawn completed", "agentId":"subagent-3-9cni", "agentType":"general-purpose",
  "phase":"completed", "durationMs":4883, "tokensIn":338, "tokensOut":398,
  "success":true, "runInBackground":false }
```

**turn / session 生命周期**（`service` = `agent-runtime:optima-runtime`）：`sendMessage handleMessage done` / `Destroying Optima session`。

**工具执行**：grep `tool` / `execute` / tool 名；tool 相关行带同样的 `turnId` 关联键。

**gateway-core**：`userId / userEmail / sessionId / traceId / duration_ms / message`（WS 连接、OIDC、session 状态）。

**关键关联字段**：`userId`(账号) · `sessionId`(`ses_*`) · `conversationId` · `turnId` · `model` · `inputTokens`/`outputTokens` · `elapsedMs`/`ttfbMs` · `stopReason` · `duration_ms` · `level`。

---

## 4. 输出格式（一条龙）

### A. 概览
```
用户: 9781cf19-3d9a-451f-af5b-0a4f8b3397d9   环境: cn-stage   时间范围: 最近 1h
找到 session: 2 ｜ conversation: 3 ｜ turn: 14 ｜ LLM 调用: 51 ｜ 工具: 23 ｜ 错误: 1
```

### B. 一条龙时间线（按 session → conversation → turn）
```
session ses_azwDo9estPhg17Axb8q7q  (conv cmqrg6dua…)
└ turn …o0b78la3   06:34:33 → 06:34:50  (17s, 5 LLM calls, 4 tools)
   ├ 06:34:33  LLM deepseek-v4-pro  in195/out125   1915ms  cache99.8%  →tool_use
   ├ 06:34:35  LLM deepseek-v4-pro  in653/out422   6753ms  cache99.4%  →tool_use   (14 tools avail)
   ├ 06:34:42  LLM deepseek-v4-pro  in116/out78    1727ms  cache99.9%  →tool_use
   ├ 06:34:44  LLM deepseek-v4-pro  in126/out92    1930ms  cache99.9%  →tool_use
   └ 06:34:47  LLM deepseek-v4-pro  in150/out147   2257ms  cache99.9%  →stop
```

### C. 耗时 / token 统计
```
本窗口合计:  LLM 调用 51 次 ｜ 平均延迟 2.6s ｜ P95 6.8s ｜ 慢调用(>5s) 4 次
token:  输入 12,840  输出 4,210  缓存命中率 99.3%
工具:   bash×9  read×6  web_search×3 …
子代理: spawn 2 (general-purpose, 平均 4.9s, 全 success)
```

### D. 错误 / 告警（`--errors`）
```
06:41:12 [openai-compat-provider] WARN LLM request retry  turnId=turn-… reason=429
  → CircuitBreaker half-open，已重试
```

---

## 5. 常用诊断场景

| 用户报告 | 策略 |
|---------|------|
| "没反应/卡住" | agent-runtime 查该 turn 是否有 `LLM request sending` 却无 `stream completed`（卡在 LLM）；或有 `tool_use` 却无后续工具完成 |
| "回复慢" | 看 `elapsedMs`/`ttfbMs`/`firstChunkMs`；`slow:true` 标记；P95 |
| "出错" | `--errors`，看 LLM `status!=200` / retry / CircuitBreaker |
| "连不上" | gateway-core 的 WS 连接 + OIDC 日志 |
| "token 烧太快/账单" | 按 turn 汇总 `inputTokens`/`outputTokens`，看 `cacheHitRate` 是否异常低 |
| "子代理炸了" | grep `spawn.lifecycle`，看 `success:false` / `durationMs` |

---

## 6. 反向追踪：一段内容 → 是谁 → 手机号（content → person）

与正向（手机→一条龙）对称的另一方向：拿到一段聊天内容/截图文字，反查是哪个用户、解出手机号。**对话正文存在 gateway-core 的 `messages` 表（Postgres），直接 `content ILIKE` 检索即可——不需要中文分词**（分词只为大规模高效索引，一次性查找用不上）。

**前置：cn DB 访问凭证（query-db 走 buildbox 隧道）**
```bash
# cn Infisical admin（本地缓存）
CREDS=~/.config/optima/cn-infisical-creds.json
export INFISICAL_CN_EMAIL="$(python3 -c "import json;print(json.load(open('$CREDS'))['email'])")"
export INFISICAL_CN_PASSWORD="$(python3 -c "import json;print(json.load(open('$CREDS'))['password'])")"
# buildbox root 密码（1P "Aliyun cn-prod buildbox ECS (root)"）
OP='/mnt/c/Users/xbfoo/AppData/Local/Microsoft/WinGet/Links/op.exe'
export OPTIMA_CN_BUILDBOX_PASSWORD="$("$OP" item get gdmixcizjci5bvuu3nuvgg4ooe --reveal --field password)"
```

**步骤 1：内容 → user_id（messages 表，role='user' 只看用户发言）**
```bash
optima-query-db gateway-core "SELECT user_id, conversation_id, to_char(created_at,'MM-DD HH24:MI') t, left(content,80) c
  FROM messages WHERE role='user' AND content ILIKE '%你那句话%' ORDER BY created_at DESC LIMIT 20" cn-prod
```
- 命中唯一 user_id → 直接定位到人。
- 命中多个（如 `hi` 这种 194 人都说过的高频词）→ 不唯一；用「说得最多」排名缩小：
  `... GROUP BY user_id ORDER BY count(*) DESC`，或要求更有特征的片段。

**步骤 2：user_id → 手机号（user-auth 表）**
```bash
optima-query-db user-auth "SELECT id, phone, email, created_at FROM users WHERE id='<USER_ID>'" cn-prod
```

**反过来 手机→userId（正向第一跳）也在这张表**：`WHERE phone='<手机号>'`。

> `messages` 表关键列：`id / conversation_id / user_id / role / content / content_parts(jsonb) / tool_calls(jsonb) / model / input_tokens / output_tokens / created_at`。
> ⚠️ 反查到人后只用于运营/排障，遵守数据合规；正文含用户隐私，别外泄。

---

## 注意事项

1. **数据源是结构化日志**，不是 OTel trace。一条龙的准确性取决于这些字段，已验证 cn-stage/cn-prod + AWS 均稳定输出。
2. **cn 日志走 stdout→SLS**，不受 OTel traces logstore 的 ingest 限流影响。
3. **关联键优先 userId/sessionId/turnId**（高区分度，全文 grep 精确命中）。email 在 cn 需先换 userId。
4. **日志延迟**：CloudWatch 1-2s；SLS 数秒。最新几秒的可能要等。
5. **保留期**：CloudWatch 7-14d；cn SLS 各 logstore 按配置（agent-runtime stdout 通常数天起）。
6. 如果查不到：时间窗内无活动 / 标识写错 / 用了 email 但 cn 日志只认 userId / 该容器已回收（warm 池轮换后旧容器日志仍在 SLS，按时间窗能查到）。
7. **OTel 原生 trace 树**是独立增强项（见顶部说明），不在本工具；需要 span 级火焰图时另走 trace 后端，且 cn 侧待修复后才有业务 span。
