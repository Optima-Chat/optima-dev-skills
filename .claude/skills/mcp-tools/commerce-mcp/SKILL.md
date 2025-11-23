---
name: "Commerce MCP"
description: "电商 MCP 工具服务器 - 21个工具覆盖商品/订单/库存/物流/商家管理，FastMCP 框架，端口 8201/8270"
allowed-tools: ["Bash", "Read", "WebFetch"]
---

# Commerce MCP - 电商 MCP 工具

提供 21 个电商操作工具，通过 MCP 协议供 AI 对话调用。

## 📦 服务概述

**核心功能**：
- 商品管理（7 个工具）
- 订单管理（5 个工具）
- 库存管理（3 个工具）
- 物流管理（3 个工具）
- 商家管理（3 个工具）

## 🔗 基本信息

**仓库**: https://github.com/Optima-Chat/commerce-mcp

**技术栈**:
- Python 3.11+
- FastMCP 框架
- SSE (Server-Sent Events)
- HTTP Client (调用 Commerce Backend)

**部署地址**:
- **生产环境**: https://mcp-commerce.optima.shop (端口 8270)
- **本地开发**: http://localhost:8201

**MCP 端点**: `/sse` (Server-Sent Events)

**API 文档**: http://localhost:8201/docs

## 🛠️ 21 个 MCP 工具

### 商品管理（7 个）

- `create_product` - 创建商品
- `update_product` - 更新商品
- `list_products` - 商品列表
- `get_product` - 获取商品详情
- `delete_product` - 删除商品
- `add_product_images` - 添加商品图片
- `remove_product_images` - 删除商品图片

### 订单管理（5 个）

- `list_orders` - 订单列表
- `get_order` - 获取订单详情
- `ship_order` - 发货
- `complete_order` - 完成订单
- `cancel_order` - 取消订单

### 库存管理（3 个）

- `get_low_stock` - 获取低库存商品
- `update_stock` - 更新库存
- `get_stock_history` - 库存历史

### 物流管理（3 个）

- `calculate_shipping` - 计算运费
- `create_shipment` - 创建运单
- `track_shipment` - 物流跟踪

### 商家管理（3 个）

- `get_shop_info` - 获取店铺信息
- `update_merchant_profile` - 更新商家资料
- `setup_merchant_profile` - 设置商家资料

## 🚀 快速开始

### 本地开发

```bash
cd ~/optima/mcp-tools/commerce-mcp
pip install -r requirements.txt
python -m commerce_mcp.server
# 服务运行在 http://localhost:8201
```

### 测试工具调用

通过 MCP Host 调用：

```bash
curl -X POST http://localhost:8300/mcp/tools/call \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "list_products",
    "arguments": {"limit": 10}
  }'
```

## 🔑 配置

### 环境变量

- `COMMERCE_API_URL` - Commerce Backend 地址
- `COMMERCE_API_KEY` - Commerce Backend API Key
- `PORT` - 服务端口（默认 8201）

### 注册到 MCP Host

Commerce MCP 需要在 MCP Host 中注册：

```json
{
  "commerce-mcp": {
    "url": "http://localhost:8201/sse",
    "description": "电商操作工具"
  }
}
```

## 📚 相关文档

- **仓库 README**: https://github.com/Optima-Chat/commerce-mcp
- **FastMCP 文档**: https://github.com/jlowin/fastmcp
- **MCP 协议**: https://modelcontextprotocol.io/

## 🔗 相关服务

**调用方**: MCP Host
**依赖服务**: Commerce Backend
