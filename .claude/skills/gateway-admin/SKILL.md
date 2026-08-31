---
name: gateway-admin
description: 当用户请求操作 gateway 管理面时使用——COO kill/软杀某用户的协调官、查看或调整 warm-pool、credits adjust、provider key 管理、gateway config/llm-rates/models 的读写，或任何 gateway-core /admin/* 端点调用。支持 cn-stage、cn-prod 两个环境。
---

# Gateway Admin — gateway-core /admin/* 操作

当用户要求「杀掉某用户的 COO / 软杀容器 / drain warm pool / 查 gateway 配置 / 调 llm 费率 / 管理 provider key」等 gateway 管理面操作时，使用 `optima-gateway-admin` CLI。

## 🔴🔴 warm-pool `drain?mode=hard` = 掐正在服务的用户会话（禁止用于发布验证）

`POST /admin/warm-pool/drain?mode=hard` 退的**不是**空闲 pod，是**连 ready + assigned + active 一起退**——即**正在服务用户的会话容器**。active 容器不在 60s 自退 → OrphanDetector `cleanup retire-stuck` → `deleteContainerGroup` 强删 → **在飞 turn 当场 abort（含 HITL 提问被打断）**，用户侧表现为「agent 停了」。
- 实证（gw#2357）：2026-08-31 cn-prod 6 次 hard drain 每次掐 **7–12 个真实用户会话**；另 07:26/07:28Z 的网关重启抖动亦冲掉真实在飞会话（本 skill 作者用 conversation-IQ 实锤，gw#1842/#1227）。
- ⇒ **hard drain 仅事故止血用，日常与发布验证一律禁用。** 真要 drain 也先 `mode=soft`（只退空闲、不碰在跑会话）。cn-prod 上 hard drain 前必须先 `GET /admin/warm-pool/tasks` 数一眼有多少 active（带 sessionId 的即真实会话），确认要掐几个用户再决定。

## ✅ 发布 skill 后如何验证「最新版已生效」——**不要 recycle / drain warm pool**

🔴 **skill 不是 warm pod 的属性**：marketplace skill 在会话 **claim 之后**（`task_connected`）由 gateway 现算 desired 下发，agent 按用户 NAS 里的 `.plugin-version` 比对、不同才重下；ready 状态的 warm pod 里**没有任何用户 skill**。
⇒ **publish 后下一次新建会话就会拉到新版，drain/recycle 完全无关**（且会误伤在跑用户）。验证走这三个只读入口：
- 镜像（烘死的 builtin pack）换代：`optima-gateway-admin GET /admin/runtime/images --env cn-prod`（看 `rotationComplete` / `@sha256`）
- 某会话实际派了哪版 skill：`optima-logs gateway-core --env cn-prod --grep "Skill sync dispatched"`（看 `plugins:[...]` 版本）
- 最直接：**新开一个会话**、load 目标 skill，看拿到的版本号。
- 长寿会话内热换代靠 `SKILL_SYNC_REFRESH_TTL_MS`（默认 0=关），不是靠 drain。

## 用法

```bash
optima-gateway-admin <METHOD> </admin/...> [jsonBody] [--env cn-stage|cn-prod] [--yes]
```

- 默认环境 `cn-stage`；`cn-prod` 是生产，谨慎。
- GET/HEAD 直通；**POST/PUT/PATCH/DELETE 会回显完整请求并要求输入 yes 确认**（所有环境，不只 prod）。脚本化传 `--yes`。
- path 必须以 `/admin/` 开头（硬约束，防 token 误用于其它面）。
- 凭证自动走 dev-skills OAuth client（client_credentials，scope=gateway:admin，#70 方向 1）；cn-stage 需要 `INFISICAL_CN_EMAIL/PASSWORD` 环境变量（与 query-db cn 同一前提）。

## 常用例子

```bash
# 查 llm 费率表
optima-gateway-admin GET /admin/llm-rates --env cn-stage

# 软杀某用户的 COO（#1681 止血这类场景——不再手写 DB UPDATE）
optima-gateway-admin POST /admin/coo/users/<userId>/kill --env cn-stage

# 改 gateway 动态配置
optima-gateway-admin PUT /admin/config/<KEY> '{"value":"..."}' --env cn-stage
```

## 注意

- 403 且提示 scope 为空 → 该环境 dev-skills client 的 `allowed_scopes` 缺 `gateway:admin`（见 optima-dev-skills#70）。
- 写操作打的是运行中的 gateway 管理面，stage 上也可能打断在跑会话——确认提示不要盲敲 yes。
- AWS stage 未接（AWS prod gateway 已关停）；需要时见 #70。
