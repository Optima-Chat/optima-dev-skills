---
name: "Scout MCP"
description: "Optima Scout 智能选品 MCP 工具 - 亚马逊数据集成、Opportunity Score 算法、对话式选品，TypeScript + Redis 缓存，端口 7291"
allowed-tools: ["Bash", "Read", "WebFetch"]
---

# Scout MCP - 智能选品 MCP 工具

Optima Scout 是智能选品助手，基于亚马逊市场数据，通过对话式交互帮助商家在 3 分钟内找到高潜力产品。

## 📦 服务概述

**核心功能**：
- 商品搜索（亚马逊数据）
- Opportunity Score 计算（需求强度 + 竞争强度 + 质量缺陷）
- 市场细分分析
- Redis 缓存（70% 命中率）
- 3 个 MCP 工具供 AI 调用

## 🔗 基本信息

**仓库**: https://github.com/Optima-Chat/optima-scout

**技术栈**:
- TypeScript
- Node.js 18+
- FastMCP 框架
- Rainforest API（亚马逊数据）
- Redis（缓存）

**部署地址**:
- **开发环境**: http://dev.optima.chat:7290 (Backend API)
- **MCP 服务**: http://dev.optima.chat:7291/sse
- **本地开发**: http://localhost:7290

**API 文档**: http://dev.optima.chat:7290/docs

## 🛠️ 3 个 MCP 工具

### 1. search_products

搜索亚马逊商品，支持关键词、分类、价格区间过滤。

**参数**:
- `query` (string) - 搜索关键词
- `category` (string, 可选) - 商品分类
- `min_price` (number, 可选) - 最低价格
- `max_price` (number, 可选) - 最高价格
- `limit` (number, 可选) - 结果数量（默认 10）

**返回**:
```json
{
  "products": [
    {
      "asin": "B08N5WRWNW",
      "title": "Apple AirPods Pro",
      "price": 249.00,
      "rating": 4.7,
      "reviews_count": 89234,
      "image_url": "https://...",
      "category": "Electronics"
    }
  ],
  "total": 1523,
  "cached": true
}
```

### 2. get_opportunity_score

计算商品的 Opportunity Score（机会分数），评估商品潜力。

**参数**:
- `asin` (string) - 亚马逊商品 ASIN
- `include_analysis` (boolean, 可选) - 是否包含详细分析

**Opportunity Score 算法**:
```
总分 = 需求强度 (40%) + 竞争强度 (30%) + 质量缺陷 (30%)

需求强度 = f(销量, 评论数, 增长趋势)
竞争强度 = f(卖家数量, 价格竞争, 品牌集中度)
质量缺陷 = f(差评率, 退货率, 客户投诉)
```

**返回**:
```json
{
  "asin": "B08N5WRWNW",
  "opportunity_score": 78,
  "breakdown": {
    "demand_strength": 85,
    "competition_intensity": 65,
    "quality_gap": 82
  },
  "analysis": {
    "demand": "高需求，月均销量 15K+",
    "competition": "中等竞争，前3品牌占 60% 市场",
    "quality": "差评主要集中在电池续航，有改进空间"
  },
  "recommendation": "建议进入，关注电池改进"
}
```

### 3. analyze_niche

分析特定市场细分，识别机会空间。

**参数**:
- `niche` (string) - 细分市场关键词
- `depth` (string, 可选) - 分析深度（quick/detailed，默认 quick）

**返回**:
```json
{
  "niche": "wireless earbuds under $50",
  "market_size": "estimated $2.3B annually",
  "top_products": [...],
  "average_opportunity_score": 72,
  "insights": [
    "市场增长率 23% YoY",
    "价格敏感型消费者占 68%",
    "主要痛点：音质 (45%), 舒适度 (32%), 续航 (23%)"
  ],
  "recommendations": [
    "关注 $30-40 价格带，竞争较小",
    "强调音质和性价比",
    "提供多尺寸耳塞"
  ]
}
```

## 🚀 快速开始

### 本地开发

```bash
# 克隆仓库
cd ~/optima/ai-tools/optima-scout

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，设置 RAINFOREST_API_KEY

# 启动 Redis（缓存）
docker compose up -d redis

# 启动服务
npm run dev
# Backend API: http://localhost:7290
# MCP Server: http://localhost:7291
```

### Docker 开发

```bash
docker compose up
# 所有服务自动启动
```

## 🔑 配置

### 环境变量

**Rainforest API**:
- `RAINFOREST_API_KEY` - Rainforest API 密钥（亚马逊数据）
- 获取方式：https://www.rainforestapi.com/

**Redis 缓存**:
- `REDIS_URL` - Redis 连接 URL（默认 redis://localhost:6379）
- `CACHE_TTL` - 缓存过期时间（默认 3600 秒）

**服务端口**:
- `BACKEND_PORT` - Backend API 端口（默认 7290）
- `MCP_PORT` - MCP 服务端口（默认 7291）

### 注册到 MCP Host

Scout MCP 需要在 MCP Host 中注册：

```json
{
  "scout-mcp": {
    "url": "http://localhost:7291/sse",
    "description": "智能选品工具"
  }
}
```

## 📊 使用场景

### 场景 1：快速选品

**用户对话**:
```
用户: "帮我找一些适合亚马逊新手的产品，预算 $1000"
```

**AI 调用流程**:
1. `search_products({query: "best sellers", price: "<30"})`
2. 对每个商品调用 `get_opportunity_score({asin})`
3. 筛选 Opportunity Score > 70 的商品
4. 推荐给用户

### 场景 2：细分市场分析

**用户对话**:
```
用户: "无线耳机市场还有机会吗？"
```

**AI 调用流程**:
1. `analyze_niche({niche: "wireless earbuds"})`
2. 分析市场规模、竞争态势、消费者痛点
3. 提供进入建议

### 场景 3：竞品分析

**用户对话**:
```
用户: "这个 AirPods Pro 的竞争激烈吗？"
```

**AI 调用流程**:
1. `get_opportunity_score({asin: "B08N5WRWNW", include_analysis: true})`
2. 返回详细的竞争分析
3. 识别改进空间

## 🗄️ 数据缓存

Scout MCP 使用 Redis 缓存亚马逊数据，提升性能和降低 API 成本：

**缓存策略**:
- 商品搜索结果：缓存 1 小时
- Opportunity Score：缓存 6 小时
- 市场分析：缓存 24 小时

**缓存命中率**: 约 70%（基于测试数据）

**成本优化**:
- Rainforest API 单次查询：$0.10
- 月均成本（100 用户）：约 $22（缓存前：$75）

## 🛠️ 常用操作

### 测试 MCP 工具

通过 MCP Host 调用：

```bash
# 搜索商品
curl -X POST http://localhost:8300/mcp/tools/call \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "search_products",
    "arguments": {
      "query": "pearl earrings",
      "max_price": 100,
      "limit": 5
    }
  }'

# 计算 Opportunity Score
curl -X POST http://localhost:8300/mcp/tools/call \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "get_opportunity_score",
    "arguments": {
      "asin": "B08N5WRWNW",
      "include_analysis": true
    }
  }'
```

### 查看缓存状态

```bash
# 连接 Redis
redis-cli

# 查看缓存键
KEYS scout:*

# 查看缓存命中率
INFO stats
```

### 查看日志

```bash
# 本地开发
npm run dev
# 日志输出到控制台

# Docker
docker compose logs -f scout-mcp
```

## 📁 项目结构

```
src/
├── api/                    # REST API 端点
│   └── products.ts         # 商品搜索 API
├── mcp/                    # MCP 工具实现
│   ├── search_products.ts  # 搜索工具
│   ├── opportunity_score.ts # 评分工具
│   └── analyze_niche.ts    # 分析工具
├── services/
│   ├── rainforest.ts       # Rainforest API 客户端
│   ├── cache.ts            # Redis 缓存
│   └── scoring.ts          # Opportunity Score 算法
├── types/
│   └── index.ts            # TypeScript 类型定义
└── server.ts               # 服务器入口
```

## 🐛 故障排查

### 常见错误

**1. Rainforest API 调用失败**
```
Error: Rainforest API key invalid
```
- 检查环境变量 `RAINFOREST_API_KEY`
- 验证 API 配额：https://www.rainforestapi.com/dashboard
- 检查网络连接

**2. Redis 连接失败**
```
Error: Redis connection refused
```
- 确保 Redis 运行：`docker ps | grep redis`
- 检查 `REDIS_URL` 配置
- 启动 Redis：`docker compose up -d redis`

**3. 缓存数据过期**
```
返回过时的商品数据
```
- 清除缓存：`redis-cli FLUSHDB`
- 调整 `CACHE_TTL` 时间
- 强制刷新：在请求中添加 `force_refresh=true`

**4. MCP 工具未注册**
```
Error: Tool 'search_products' not found
```
- 检查 MCP Host 配置：`.mcp_servers.json`
- 确认 Scout MCP 服务运行
- 重启 MCP Host

## 🔗 相关服务

**被调用方**:
- MCP Host - 通过 MCP 协议调用

**依赖服务**:
- Rainforest API - 亚马逊数据源
- Redis - 缓存

**集成位置**:
- 在 MCP Host 的 `product-sourcing` 技能中集成

## 📚 相关文档

- **仓库 README**: https://github.com/Optima-Chat/optima-scout/blob/main/README.md
- **Rainforest API**: https://www.rainforestapi.com/docs
- **FastMCP 文档**: https://github.com/jlowin/fastmcp
- **Opportunity Score 算法**: 见仓库 `docs/algorithm.md`

## 💡 商业价值

**选品效率提升**:
- 传统选品：数小时研究
- Scout 辅助：3 分钟获得建议

**成本优化**:
- API 成本：$0.22/用户/月（缓存优化）
- 人力成本：节省 80% 选品时间

**准确率**:
- Opportunity Score 准确率：82%（基于 500+ 样本测试）
- 推荐商品成功率：68% 卖家验证有效
