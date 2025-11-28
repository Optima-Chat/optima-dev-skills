# /read-code - 阅读 Optima 代码库

通过 GitHub CLI 查看 Optima-Chat 组织下任意仓库的代码。

**版本**: v0.1.0

## 使用场景

**开发者**: 查看其他服务的实现细节，了解 API 调用方式
**新成员**: 快速了解项目结构和代码组织
**跨团队协作**: 查找特定功能的代码位置

## 用法

```
/read-code <repo> [path]
```

## 参数

- `repo` (必需): 仓库名称（不需要 Optima-Chat/ 前缀）
  - `commerce-backend` - 电商后端
  - `user-auth` - 用户认证
  - `mcp-host` - MCP 协调器
  - `agentic-chat` - AI 聊天
  - `commerce-cli` - 电商 CLI
  - `optima-store` - 店铺前端
  - 等等...
- `path` (可选): 文件或目录路径，默认为根目录

## 示例

```bash
/read-code commerce-backend                    # 查看根目录结构
/read-code commerce-backend app                # 查看 app 目录
/read-code commerce-backend app/main.py        # 查看具体文件
/read-code user-auth CLAUDE.md                 # 查看项目文档
```

## Claude Code 执行步骤

### 1. 查看目录结构

```bash
# 查看根目录
gh api repos/Optima-Chat/{repo}/contents | jq -r '.[] | "\(.type)\t\(.name)"'

# 查看子目录
gh api repos/Optima-Chat/{repo}/contents/{path} | jq -r '.[] | "\(.type)\t\(.name)"'
```

### 2. 查看文件内容

```bash
# 查看文件（自动解码 base64）
gh api repos/Optima-Chat/{repo}/contents/{path} | jq -r '.content' | base64 -d
```

### 3. 搜索代码

```bash
# 在仓库中搜索
gh search code "{keyword}" --repo Optima-Chat/{repo}

# 跨仓库搜索
gh search code "{keyword}" --owner Optima-Chat
```

### 4. 查看完整目录树

```bash
gh api repos/Optima-Chat/{repo}/git/trees/main?recursive=1 | jq -r '.tree[] | select(.type=="blob") | .path' | head -50
```

## 可用仓库列表

### 核心服务
- `commerce-backend` - 电商后端 API
- `user-auth` - 用户认证服务
- `mcp-host` - MCP 协调器
- `agentic-chat` - AI 聊天应用

### MCP 服务
- `commerce-mcp` - 电商管理 MCP
- `shopify-mcp` - Shopify API MCP
- `google-ads-mcp` - Google Ads MCP
- `comfy-mcp` - ComfyUI MCP
- `perplexity-mcp` - Perplexity MCP
- `fetch-mcp` - 网页抓取 MCP

### 前端 & CLI
- `optima-store` - 电商店铺前端
- `commerce-cli` - 电商管理 CLI
- `optima-ops-cli` - 运维 CLI

### 其他
- `optima-terraform` - AWS Terraform 配置
- `optima-workspace` - 多仓库工作区管理
- `optima-eval` - AI Agent 评测系统
- `optima-bi` - 商业智能模块

## 实用技巧

### 查看大文件

```bash
# 获取 raw 内容（避免 base64 截断）
curl -s "$(gh api repos/Optima-Chat/{repo}/contents/{path} | jq -r '.download_url')"
```

### 查看最近修改

```bash
# 最近 commit 修改的文件
gh api repos/Optima-Chat/{repo}/commits/main | jq -r '.files[].filename'
```

### 查看特定分支

```bash
gh api repos/Optima-Chat/{repo}/contents/{path}?ref=develop | jq -r '.content' | base64 -d
```

## 注意事项

1. 需要 GitHub CLI 已登录且有仓库访问权限
2. 大部分仓库是私有的
3. 超过 1MB 的文件需要使用 raw URL
