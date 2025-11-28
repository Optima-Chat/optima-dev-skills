---
name: "read-code"
description: "当用户请求阅读代码、查看源码、看看代码、代码在哪、找代码、查看实现、看看怎么实现的、代码结构、项目结构时，使用此技能。支持查看 Optima-Chat 组织下所有仓库的代码。"
allowed-tools: ["Bash"]
---

# 阅读 Optima 代码库

当你需要查看 Optima-Chat 组织下任何仓库的代码时，使用这个技能。

## 🎯 适用情况

- 查看某个服务的实现细节
- 了解项目结构
- 查找特定功能的代码
- 学习代码实现方式
- 跨仓库代码对比

## 🏢 可用仓库

### 核心服务

| 仓库 | 说明 |
|------|------|
| `commerce-backend` | 电商后端 API |
| `user-auth` | 用户认证服务 |
| `mcp-host` | MCP 协调器服务 |
| `agentic-chat` | AI 聊天应用 |

### MCP 服务

| 仓库 | 说明 |
|------|------|
| `commerce-mcp` | 电商管理 MCP |
| `shopify-mcp` | Shopify API MCP |
| `google-ads-mcp` | Google Ads MCP |
| `comfy-mcp` | ComfyUI MCP |
| `perplexity-mcp` | Perplexity MCP |
| `fetch-mcp` | 网页抓取 MCP |

### 前端 & CLI

| 仓库 | 说明 |
|------|------|
| `optima-store` | 电商店铺前端 |
| `commerce-cli` | 电商管理 CLI |
| `optima-ops-cli` | 运维 CLI |

### 其他

| 仓库 | 说明 |
|------|------|
| `optima-terraform` | AWS Terraform 配置 |
| `optima-workspace` | 多仓库工作区管理 |
| `optima-eval` | AI Agent 评测系统 |
| `optima-bi` | 商业智能模块 |
| `optima-scout` | 智能选品助手 |

## 🚀 快速操作

### 1. 查看仓库结构

```bash
# 查看仓库文件列表
gh repo view Optima-Chat/commerce-backend --json name,description

# 查看根目录结构
gh api repos/Optima-Chat/commerce-backend/contents | jq -r '.[].name'

# 查看特定目录
gh api repos/Optima-Chat/commerce-backend/contents/app | jq -r '.[].name'
```

### 2. 查看文件内容

```bash
# 查看单个文件（自动解码 base64）
gh api repos/Optima-Chat/commerce-backend/contents/README.md | jq -r '.content' | base64 -d

# 查看 Python 文件
gh api repos/Optima-Chat/commerce-backend/contents/app/main.py | jq -r '.content' | base64 -d

# 查看 CLAUDE.md（如果存在）
gh api repos/Optima-Chat/commerce-backend/contents/CLAUDE.md | jq -r '.content' | base64 -d
```

### 3. 搜索代码

```bash
# 在仓库中搜索代码
gh search code "def create_product" --repo Optima-Chat/commerce-backend

# 搜索特定文件类型
gh search code "class Product" --repo Optima-Chat/commerce-backend --filename "*.py"

# 跨仓库搜索
gh search code "MerchantProfile" --owner Optima-Chat
```

### 4. 查看特定分支或 commit

```bash
# 查看特定分支的文件
gh api repos/Optima-Chat/commerce-backend/contents/app/main.py?ref=develop | jq -r '.content' | base64 -d

# 查看最近的 commits
gh api repos/Optima-Chat/commerce-backend/commits --jq '.[0:5] | .[] | "\(.sha[0:7]) \(.commit.message | split("\n")[0])"'
```

## 📋 常见使用场景

### 场景 1：了解服务架构

**用户请求**："帮我看看 commerce-backend 的项目结构"

**步骤**：
```bash
# 1. 查看根目录
gh api repos/Optima-Chat/commerce-backend/contents | jq -r '.[] | "\(.type)\t\(.name)"'

# 2. 查看 app 目录结构
gh api repos/Optima-Chat/commerce-backend/contents/app | jq -r '.[] | "\(.type)\t\(.name)"'

# 3. 查看 CLAUDE.md 了解架构
gh api repos/Optima-Chat/commerce-backend/contents/CLAUDE.md | jq -r '.content' | base64 -d
```

### 场景 2：查找功能实现

**用户请求**："商品创建的代码在哪？"

**步骤**：
```bash
# 1. 搜索相关代码
gh search code "create_product" --repo Optima-Chat/commerce-backend

# 2. 查看搜索到的文件
gh api repos/Optima-Chat/commerce-backend/contents/app/services/product_service.py | jq -r '.content' | base64 -d
```

### 场景 3：跨仓库对比

**用户请求**："commerce-mcp 和 commerce-cli 有什么区别？"

**步骤**：
```bash
# 1. 查看两个仓库的 README
gh api repos/Optima-Chat/commerce-mcp/contents/README.md | jq -r '.content' | base64 -d
gh api repos/Optima-Chat/commerce-cli/contents/README.md | jq -r '.content' | base64 -d

# 2. 对比项目结构
gh api repos/Optima-Chat/commerce-mcp/contents | jq -r '.[].name'
gh api repos/Optima-Chat/commerce-cli/contents | jq -r '.[].name'
```

### 场景 4：查看 API 定义

**用户请求**："user-auth 有哪些 API？"

**步骤**：
```bash
# 1. 查看路由文件
gh api repos/Optima-Chat/user-auth/contents/app/api | jq -r '.[].name'

# 2. 查看具体路由
gh api repos/Optima-Chat/user-auth/contents/app/api/routes/auth.py | jq -r '.content' | base64 -d
```

## 💡 实用技巧

### 查看大文件

对于大文件，GitHub API 可能返回 truncated 内容，使用 raw URL：

```bash
# 获取 raw 内容 URL
gh api repos/Optima-Chat/commerce-backend/contents/app/main.py | jq -r '.download_url'

# 直接获取 raw 内容
curl -s "$(gh api repos/Optima-Chat/commerce-backend/contents/app/main.py | jq -r '.download_url')"
```

### 递归查看目录

```bash
# 获取整个目录树
gh api repos/Optima-Chat/commerce-backend/git/trees/main?recursive=1 | jq -r '.tree[] | select(.type=="blob") | .path' | head -50
```

### 查看最近修改的文件

```bash
# 查看最近的 commit 修改了哪些文件
gh api repos/Optima-Chat/commerce-backend/commits/main | jq -r '.files[].filename'
```

## ⚠️ 注意事项

1. **权限**：需要 GitHub CLI 已登录且有仓库访问权限
2. **私有仓库**：大部分 Optima-Chat 仓库是私有的，确保有访问权限
3. **API 限制**：GitHub API 有速率限制，避免频繁请求
4. **大文件**：超过 1MB 的文件需要使用 raw URL 获取

## 🔗 相关资源

- GitHub CLI 文档：https://cli.github.com/manual/
- GitHub REST API：https://docs.github.com/en/rest
