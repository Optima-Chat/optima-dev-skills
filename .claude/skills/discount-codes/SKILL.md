---
name: "discount-codes"
description: "当用户请求创建优惠码、发优惠码、生成折扣码、promo code、discount code、批量生成优惠码、停用优惠码、查看优惠码时，使用此技能。支持 Stage、Prod 两个环境。"
allowed-tools: ["Bash"]
---

# 优惠码管理

为 billing 结账（技能包 / 会员）创建和管理百分比优惠码。

## 执行方式：使用 CLI 工具

无论用户用 `/discount-codes` 还是直接请求，都使用 `optima-discount` CLI（thin HTTP client，调 billing admin 端点）：

```bash
optima-discount <subcommand> [options]
```

## 子命令

```bash
# 建共享码：LAUNCH20 = 8 折，限 scout，6/30 截止，最多核销 100 次
optima-discount create   --code LAUNCH20 --percent 20 --products scout --ends 2026-06-30 --max 100 --env prod

# 批量唯一码（每码用一次）—— 码写入本地文件，不打屏
optima-discount generate --count 100 --percent 50 --campaign partner-q3 --products scout --env prod
#   → ./discount-codes-partner-q3-<ts>.txt

# 查看（按 campaign / code 过滤）
optima-discount list     --campaign partner-q3 --env prod

# 停用
optima-discount disable  --code LAUNCH20 --env prod
```

## 参数

| 参数 | 说明 |
|------|------|
| `--code` | 优惠码（存为大写） |
| `--percent` | 折扣百分比 1-100 |
| `--products` | 逗号分隔的 productKey；省略 = 所有商品 |
| `--starts` / `--ends` | 有效期（`YYYY-MM-DD` 或 ISO datetime） |
| `--max` | 总核销上限（省略 = 不限；`1` = 一次性） |
| `--campaign` | 分组标签（generate 时也是码前缀） |
| `--count` | generate 生成数量 1-1000 |
| `--limit` | list 返回上限（默认 500，最大 1000） |
| `--env` | `stage` / `prod`（默认 `stage`） |
| `--yes` | 跳过 prod 二次确认 |

## 安全提醒

1. **Stage 优先**：默认 `stage`。
2. **Prod 谨慎**：`create` / `generate` / `disable` 在 prod 会要求输入 "yes" 确认（`--yes` 跳过）。
3. **唯一码写文件**：`generate` 的码写入当前目录文件（`mode 0600`），不打屏——避免复制时被终端 padding 破坏。
4. 依赖 billing 已部署对应环境（admin 端点存在）。越界值（如 `--percent 0`）由 billing 服务端校验返 400。

## 相关

- `optima-product` — 管理付费商品（优惠码作用于其结账）
- `optima-query-db` — 查 `discount_codes` / `discount_redemptions` 表核对
