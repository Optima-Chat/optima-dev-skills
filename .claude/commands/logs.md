# /logs - 查看服务日志

快速查看服务日志，支持 CI/Stage/Prod/cn-prod/cn-stage 五个环境。

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
  - `ads-backend` - Google Ads API 代理服务
  - `ads-worker` - Ads 对账后台任务
  - `amazon-backend` - Amazon SP-API 集成服务
  - `shopify-backend` - Shopify 店铺管理服务
  - `commerce-rq-worker` - RQ 后台任务
  - `commerce-rq-scheduler` - RQ 定时调度
  - `gateway-core` - Gateway 核心服务
  - `gw-admin` - Gateway 管理后台
  - `optima-channels` - Channels 服务
  - `optima-logistics` - 物流服务（仅 Stage/Prod）
  - `billing` - 计费服务（仅 Stage/Prod）
  - `browser-backend` - 浏览器自动化服务（仅 Stage/Prod）
  - `optima-generation` - 内容生成服务（仅 Stage/Prod）
  - `optima-generation-worker` - 内容生成 Worker（仅 Stage/Prod）
  - `optima-sentinel` - Sentinel API（仅 Stage/Prod）
  - `optima-sentinel-worker` - Sentinel 后台任务（仅 Stage/Prod）
- `lines` (可选): 显示行数，默认 50
- `environment` (可选): 环境，默认 ci
  - `ci` - CI 持续集成环境（开发环境，默认）
  - `stage` - Stage 预发布环境（ECS Fargate）
  - `prod` - 生产环境（ECS Fargate）
  - `cn-prod`（别名 `cn`）- 阿里云 cn-prod 环境（SAE，cn-beijing，`optima-logs` 直连 SLS）
  - `cn-stage` - 阿里云 cn-stage 预发环境（SAE，cn-beijing，`optima-logs` 直连 SLS）

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
- `cn-prod` / `cn` / `cn-stage` → 阿里云 SLS，`optima-logs` 直连（第 3 节，免 buildbox）

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
- `ads-backend` → `/ecs/ads-backend-stage`
- `ads-worker` → `/ecs/ads-worker-stage`
- `amazon-backend` → `/ecs/amazon-backend-stage`
- `shopify-backend` → `/ecs/shopify-backend-stage`
- `commerce-rq-worker` → `/ecs/commerce-rq-worker-stage`
- `commerce-rq-scheduler` → `/ecs/commerce-rq-scheduler-stage`
- `gateway-core` → `/ecs/gateway-core-stage`
- `gw-admin` → `/ecs/gw-admin-stage`
- `optima-channels` → `/ecs/optima-channels-stage`
- `optima-logistics` → `/ecs/optima-logistics-stage`
- `billing` → `/ecs/billing-stage`
- `browser-backend` → `/ecs/browser-backend-stage`
- `optima-generation` → `/ecs/optima-generation-stage`
- `optima-generation-worker` → `/ecs/optima-generation-worker-stage`
- `optima-sentinel` → `/ecs/optima-sentinel-stage`
- `optima-sentinel-worker` → `/ecs/optima-sentinel-worker-stage`

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
- `ads-backend` → `/ecs/ads-backend-prod`
- `ads-worker` → `/ecs/ads-worker-prod`
- `amazon-backend` → `/ecs/amazon-backend-prod`
- `shopify-backend` → `/ecs/shopify-backend-prod`
- `commerce-rq-worker` → `/ecs/commerce-rq-worker-prod`
- `commerce-rq-scheduler` → `/ecs/commerce-rq-scheduler-prod`
- `gateway-core` → `/ecs/gateway-core-prod`
- `gw-admin` → `/ecs/gw-admin-prod`
- `optima-channels` → `/ecs/optima-channels-prod`
- `optima-logistics` → `/ecs/optima-logistics-prod`
- `billing` → `/ecs/billing-prod`
- `browser-backend` → `/ecs/browser-backend-prod`
- `optima-generation` → `/ecs/optima-generation-prod`
- `optima-generation-worker` → `/ecs/optima-generation-worker-prod`
- `optima-sentinel` → `/ecs/optima-sentinel-prod`
- `optima-sentinel-worker` → `/ecs/optima-sentinel-worker-prod`

**注意**: `optima-store` 仅在 Stage 环境部署

### 3. cn-prod / cn-stage 环境（environment = "cn-prod"/"cn" 或 "cn-stage"）

**部署方式**: 阿里云 **SAE**（cn-beijing），不是 ECS/CloudWatch。
**访问方式**: ✅ **用 `optima-logs` CLI 直连阿里云 SLS**，不再经 buildbox。

> ✅ 现状更新（2026-06-16）：cn-prod / cn-stage 全部服务**已接 SLS**（含 ECI 的 `agent-runtime`）。
> SLS `GetLogsV2` 是公网控制面 API，本机 `aliyun-optima` profile 直连即可，支持**历史检索 + 时间窗 + 关键词**——
> 旧的「SSH buildbox → SAE `DescribeInstanceLog` 取当前缓冲」流程已弃用（缓冲式、重启即丢、不能检索）。

**推荐用法（首选）**:
```bash
optima-logs gateway-core                       # 默认 cn-prod，最近 1h，100 行
optima-logs gateway-core --env cn-stage
optima-logs agent-runtime --env cn-prod --since 2h   # ECI 容器也直接可见
optima-logs user-auth --grep error -n 200
optima-logs gateway-core --since 30m --json | jq .   # 机器可读
```

参数：`--env stage|prod|cn-prod|cn-stage`、`--since 30m|2h|1d`、`--grep <kw>`、`--lines/-n <N>`、`--json`。
`service` == SLS logstore 名（同名）。列全部 logstore：
`aliyun sls ListLogStores --project optima-cn-prod-1911493506120573 --region cn-beijing --profile aliyun-optima`

#### 🔴 读数纪律（#75 / #57 两次误导生产级排障的直接病根）

前三条都属于「**看起来拿到了全部，其实只拿到一角**」——不是查错了，是**看不出被截断**；第 4 条是同一病根的另一面：查询被悄悄换了语义：

1. **`-n` 取满 ≠ 窗内只有这么多。** SLS 单次请求服务端硬顶 **100 条**（`GetLogs` / `GetLogsV2` 都是）（`--line 3000` 也只回 100）。`optima-logs` 已自动 `--offset` 翻页到 `-n` 要的条数，但**取满 `-n` 时会打 ⚠**：此时真实总数未知。
   **两个都返回上限的查询相除，比值是纯噪声**——实测拿 30d 的 `timed out` / `dispatching` 相除得「100/100」，看着像 100% 失败率，缩窄到两边都 <100 后真数是 7/60 与 16/70。要计数就缩窄 `--since` 直到不再报 ⚠。
2. **请求 `--since 24h` ≠ 覆盖了 24h。** 取满 `-n` 时窗口被截在最新那一段。cn 侧**只要取到了行**，stderr 就会打**实际覆盖窗**（由 `__time__` 反算，北京时间），以它为准，别以 `--since` 为准。（零结果时没有覆盖窗可算，只打「无日志」；AWS 侧无此概念。）
3. **`--grep` 走 SLS 索引，不是本地正则**——正文没进索引的 logstore 上，搜正文里的词会**静默少回**：零命中不代表「没有报错」，非零命中也不是真实出现次数。
   已知 **cn-stage 的 `agent-runtime`**：`content` 被建成 JSON 型索引且 `index_all: false`，只索引 26 个白名单键，**`message` 不在其中** ⇒ 正文里的词一个都搜不到。
   **⚠ 盲区只覆盖「词出现在正文里」这一种。** 白名单键的**值**是进了索引的（`userId` / `sessionId` / `turnId` / `level` 都在里面），搜这些值命中数是准的——**工具替你判断不了你搜的词属于哪一种**，所以它只告诉你盲区存在，不替你下结论。
   `optima-logs` 用了 `--grep` 会先查 `GetIndex`（权威直源，不靠试词猜），搜不到正文就**在结果之前**告警并列出索引键；**整条 query 只按索引键过滤时不告警**（那种查询与本盲区无关）。零命中**不会**被断言成「这个词不存在」——见下面「零命中能说明什么」。

   <details><summary>本条的实测取数（钉死窗口，可原样复跑）</summary>

   采样 2026-08-07，`cn-stage`/`agent-runtime`，窗口钉死 `from=1786029531 to=1786036731`（北京时间 08-06 23:18:51 ~ 08-07 01:18:51）。
   ```bash
   P="--project optima-cn-stage-1911493506120573 --logstore agent-runtime --region cn-beijing --profile aliyun-optima"
   W='"from":1786029531,"to":1786036731'
   # a) 窗内真实总行数（分析语句，权威）           → 166
   aliyun sls GetLogsV2 $P --body "{$W,\"line\":1,\"offset\":0,\"query\":\"* | select count(*) as c\"}"
   # b) --grep warm 命中                            → 4
   aliyun sls GetLogsV2 $P --body "{$W,\"line\":100,\"offset\":0,\"reverse\":true,\"query\":\"warm\"}"
   # c) 按未索引键查 message                        → 0（message 不在白名单里）
   aliyun sls GetLogsV2 $P --body "{$W,\"line\":100,\"offset\":0,\"reverse\":true,\"query\":\"content.message: warm\"}"
   # d) 索引键白名单（26 个，无 message）
   aliyun sls GetIndex $P | jq -r '.keys.content | .type, .index_all, (.json_keys|keys|join(","))'
   ```
   b 的 **4** 对上 a 的 **166**：仅取最新 100 行的样本里就已有 **27 行**含 `warm`（本地统计，非索引）。
   反向对照（**同一个钉死窗**，验证「按键查是准的」）——用 SQL 数以绕开单次 100 条上限：
   ```bash
   # e) 按索引键查 level: info    → 150；同窗 166 行本地统计 level=="info" 也是 150
   aliyun sls GetLogsV2 $P --body "{$W,\"line\":1,\"offset\":0,\"query\":\"content.level: info | select count(*) as c\"}"
   # f) 裸搜一个 userId(在白名单里) → 24；content.userId: <U> 也是 24；本地统计也是 24
   U=54afca02-cb4c-4022-9e5b-b8dc3cda17d0
   aliyun sls GetLogsV2 $P --body "{$W,\"line\":1,\"offset\":0,\"query\":\"$U | select count(*) as c\"}"
   ```

   > **别把这组数抄进别处。** 同一组数曾在三份文件里手抄、已经漂成四个版本（24/22、28/26、27/16，以及 PR 正文那版 28——它数的是**不区分大小写**，多出的一行是 `Warm pool: session initialized`）。差异来自「窗内 100 行」其实只是 166 行里最新的 100 行，以及「只出现在 message」有好几种数法。**这里是唯一权威**；`SKILL.md`、`trace-user.md`、`--help` 只引用不复制，`logs.ts` 与测试里的注释可以引用具体数字，但必须与这里同源（同一钉死窗）。
   </details>

   **零命中能说明什么**（工具的措辞就到这一步，不再往前一步）：索引正常时它只说「正文已进全文索引 ⇒ 不是『索引搜不到』那一类」，并提醒 SLS 按**完整 token** 匹配（分词表不含 `-` `_` `.`）——实测 `gateway-core`：`reconciler` **0 条**、`session-reconciler` **100+ 条**。要断定「真没有」请换完整 token，或去掉 `--grep` 拉原始行本地过滤复核。`GetIndex` 调不通时判 `unknown`，**既不告警也不背书**。

   其它 logstore：cn-prod 的 `agent-runtime` 只有全文索引，正文可搜；cn-stage 的 `gateway-core` 是 `text` 型，也可搜。

4. **`--grep` 里的 `|` 不是「或」。** SLS 拿 `|` 分隔「检索 | 分析(SQL)」两段，`--grep 'timeout|error'` 会被 SLS 判成 SQL 并报错（工具会在 SLS 原文之下补一句人话说明；它**只给陈述、不生成可照抄的命令**——生成式处方要同时满足 bash 与 SLS 两套语法，试过两次都在「命令跑得通、查的却是另一条 query」上翻车）。要「或」写 `--grep 'timeout or error'`；要把整串当一个短语写 `--grep '"timeout|error"'`（带引号是合法检索，`meta.hasSQL=false`）；要真跑 SQL 写 `--grep '… | select …'`，此时 SLS 规定 `line`/`offset` 失效 ⇒ `-n` 不起作用，翻页要用 SQL 自己的 `LIMIT`。

**数记录数不要用 `wc -l`**：`--json` 是 pretty-print 数组，一条记录就是十几到二十行（实测 `gateway-core` 100 条 = 1502 行，`agent-runtime` 约 18 行/条）。用 `grep -c '__time__'`。

**已知未覆盖**：SLS 全文索引有 `max_text_len` 截断，超长单行超出部分不进索引 ⇒ 超长日志行尾部的词仍可能搜不到，本工具不检测这一种。该值在 `GetIndex` 的**顶层**（不在 `.line` 里），可直接复核：
```bash
aliyun sls GetIndex --project optima-cn-stage-1911493506120573 --logstore gateway-core \
  --region cn-beijing --profile aliyun-optima | jq .max_text_len    # → 16384（2026-08-07 采样）
```
（`progress: Incomplete`「查询未扫完」已覆盖：改用 `GetLogsV2` 后 `meta.progress` 可读，非 `Complete` 会打 ⚠；**响应里读不到这个字段时判 unknown 并单独打 ⚠**，不当成「扫完了」。）

**底层（仅参考，正常用 `optima-logs` 即可）**:
- SLS project：`optima-cn-prod-1911493506120573` / `optima-cn-stage-1911493506120573`（`optima-<env>-<accountId>`）。
- logstore = service 名；日志正文在 `content` 字段。
- **直连要用 `GetLogsV2`**：只有它返回 `meta.progress` / `meta.count`。V1 的 `GetLogs` 拿不到「本次查询扫完没有」，`Incomplete` 与「窗内就这么多」在 V1 下完全无法区分。
```bash
NOW=$(date +%s); FROM=$((NOW-3600))
aliyun sls GetLogsV2 --project optima-cn-prod-1911493506120573 --logstore gateway-core \
  --body "{\"from\":$FROM,\"to\":$NOW,\"line\":100,\"offset\":0,\"reverse\":true,\"query\":\"error\"}" \
  --region cn-beijing --profile aliyun-optima
# 单次仍硬顶 100 条 → 要更多就 offset 递增翻页；每次都看一眼 meta.progress 是不是 Complete
```

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
