---
name: "entitlement"
description: "当用户请求授予产品权益、发放 entitlement、发 scout-gift、给用户开某个 product、撤销权益、退权益、refund entitlement、查看某用户的权益列表时，使用此技能。支持 stage、prod、cn-prod、cn-stage 四个环境；标识符支持邮箱/手机号/userId。"
allowed-tools: ["Bash"]
---

# 产品权益（Entitlement：grant / revoke / list）

管理 billing 的产品权益（如 `scout-gift` 这类 `ONE_SHOT_SKILL` product）。CLI：`optima-entitlement`。

标识符 `<email|phone|userId>`：**cn-prod / cn-stage 用户多为手机号**，三种都支持；AWS stage/prod 仅 email。授予/撤销前打印 `🎯 目标账号` 反查回显。

## 执行方式

```bash
optima-entitlement grant  <email|phone|userId> --product-key <slug> --justification "..." --env <env> [--yes]
optima-entitlement revoke <email|phone|userId> --product-key <slug> --reason "..."        --env <env> [--yes]
optima-entitlement list   <email|phone|userId> --env <env>
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `<email\|phone\|userId>` | 用户标识（必填；`--email` 为向后兼容别名） | - |
| `--product-key <slug>` | 产品 key，如 `scout-gift`（grant/revoke 必填） | - |
| `--justification "..."` | 授予理由（grant 必填，billing 否则 400） | - |
| `--reason "..."` | 撤销理由（revoke 必填） | - |
| `--env <env>` | stage / prod / cn-prod / cn-stage | stage |
| `--yes` | 跳过 prod / cn-prod 确认 | - |

服务端硬编码：`source=ADMIN_GRANT, priceCents=0, currency=USD, grantedBy=<dev-skills client>`。revoke 拒绝非 ADMIN_GRANT 来源（PAYMENT/PARTNER）。

## 快速操作

```bash
# 给 cn-prod 手机号用户发 scout-gift
optima-entitlement grant 18898654855 --product-key scout-gift --justification "运营赠送" --env cn-prod

# 查权益
optima-entitlement list 18898654855 --env cn-prod

# 撤销
optima-entitlement revoke user@example.com --product-key scout-gift --reason "误发" --env prod
```

## 环境说明

- **stage / prod（AWS）**：仅 email；经 RDS SSH 隧道解析 userId。
- **cn-prod / cn-stage（阿里云）**：email/手机号/userId；经 user-auth internal lookup（M2M，无 SSH 隧道）。走 HTTPS billing API（billing-api.yzsgo.com / billing-api.stage.optima.chat）。

> prod / cn-prod 为生产环境，grant/revoke 执行前要求 `yes` 确认（`--yes` 跳过）。

## 相关命令

- `optima-account status` - 查看用户订阅+权益汇总
- `optima-grant-subscription` / `optima-grant-balance` - 开通会员 / 赠送 credits
