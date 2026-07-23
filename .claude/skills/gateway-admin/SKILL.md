---
name: gateway-admin
description: 当用户请求操作 gateway 管理面时使用——COO kill/软杀某用户的协调官、查看或调整 warm-pool、credits adjust、provider key 管理、gateway config/llm-rates/models 的读写，或任何 gateway-core /admin/* 端点调用。支持 cn-stage、cn-prod 两个环境。
---

# Gateway Admin — gateway-core /admin/* 操作

当用户要求「杀掉某用户的 COO / 软杀容器 / drain warm pool / 查 gateway 配置 / 调 llm 费率 / 管理 provider key」等 gateway 管理面操作时，使用 `optima-gateway-admin` CLI。

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
