---
name: "use-commerce-cli"
description: "当用户需要管理电商店铺（商品、订单、库存、运费、集合、首页、国际化）时，使用此技能。"
allowed-tools: ["Bash"]
---

# 使用 Commerce CLI

## 何时使用

用户需要管理电商功能：商品、订单、库存、运费、集合、首页、国际化。

## 前提

用户已有 access token（通过 `optima-generate-test-token` 生成）。

## Token 传递方式

**必须**同时设置 `OPTIMA_TOKEN` 和 `OPTIMA_ENV`：

```bash
OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
OPTIMA_ENV=development \
commerce <command>
```

## 示例

```bash
# 创建商品
OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
OPTIMA_ENV=development \
commerce product create --title "测试商品" --price 99.99 --stock 100

# 查询商品
OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
OPTIMA_ENV=development \
commerce product list

# 查询订单
OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
OPTIMA_ENV=development \
commerce order list
```

## 安装项目 Skills（可选）

```bash
commerce init
```

在 `.claude/skills/` 安装完整 Skills，之后可用自然语言管理店铺。

## 环境说明

`optima-generate-test-token` 支持两个环境：

**Development**（默认）：
- API: `api.optima.chat`
- 环境变量：`OPTIMA_ENV=development`

**Production**（使用 `--env production`）：
- API: `api.optima.shop`
- 环境变量：`OPTIMA_ENV=production`
