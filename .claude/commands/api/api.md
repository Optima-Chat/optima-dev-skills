# /api - 查看 API 定义

查看后端服务的 API 定义（OpenAPI/Swagger 规范），了解接口参数、响应格式。

## 使用方法

```
/api <service-name> [environment]
```

**参数**：
- `service-name`：服务名称（必需）
  - `commerce-backend` - 电商后端 API
  - `user-auth` - 用户认证 API
  - `mcp-host` - MCP 协调器 API
- `environment`：环境（可选，默认 CI）
  - `ci` - CI 测试环境
  - `stage` - Stage 预发布环境
  - `prod` - 生产环境

**示例**：
```
/api commerce-backend          # 查看 CI 环境的商品 API
/api user-auth stage           # 查看 Stage 环境的认证 API
/api mcp-host prod             # 查看 Prod 环境的 MCP API
```

## OpenAPI 规范地址

### CI 环境

- **Commerce Backend**: https://api.optima.chat/openapi.json
- **User Auth**: https://auth.optima.chat/openapi.json
- **MCP Host**: https://mcp.optima.chat/openapi.json

### Stage 环境

- **Commerce Backend**: https://api.stage.optima.onl/openapi.json
- **User Auth**: https://auth.stage.optima.onl/openapi.json
- **MCP Host**: https://mcp.stage.optima.onl/openapi.json

### Prod 环境

- **Commerce Backend**: https://api.optima.shop/openapi.json
- **User Auth**: https://auth.optima.shop/openapi.json
- **MCP Host**: https://mcp.optima.shop/openapi.json

## 说明

**Claude Code 会自动**：
- 使用 WebFetch 读取 openapi.json
- 分析 API 端点和参数
- 回答你关于 API 的问题

**你可以问**：
- "商品列表 API 的参数是什么？"
- "创建订单需要哪些字段？"
- "认证 API 返回什么格式？"

## 相关命令

- `/get-token` - 获取认证 Token
- `/backend-logs` - 查看 API 错误日志
- `/health-check` - 检查 API 服务状态
