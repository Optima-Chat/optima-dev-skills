---
name: "Comfy MCP"
description: "ComfyUI 图像生成 MCP 工具 - 文本生图、图生图、图生视频，FastMCP 框架，端口 8220/8261"
allowed-tools: ["Bash", "Read", "WebFetch"]
---

# Comfy MCP - ComfyUI 图像生成工具

基于 ComfyUI 的 AI 图像生成 MCP 工具，支持文本生图、图生图、图生视频。

## 📦 服务概述

**核心功能**：
- 文本生成图片（Text-to-Image）
- 图片生成图片（Image-to-Image）
- 图片生成视频（Image-to-Video）
- 3 个 MCP 工具供 AI 调用

## 🔗 基本信息

**仓库**: https://github.com/Optima-Chat/comfy-mcp

**技术栈**:
- Python 3.11+
- FastMCP 框架
- ComfyUI API
- Stable Diffusion

**部署地址**:
- **生产环境**: https://mcp-comfy.optima.shop (端口 8261)
- **本地开发**: http://localhost:8220

**MCP 端点**: `/sse`

**API 文档**: http://localhost:8220/docs

## 🛠️ 3 个 MCP 工具

### 1. create_image_from_prompt

文本生成图片，基于 Prompt 创建 AI 图像。

**参数**:
- `prompt` (string) - 描述文本，英文效果最佳
- `negative_prompt` (string, 可选) - 负面提示词，避免不想要的元素
- `width` (number, 可选) - 图片宽度（默认 512）
- `height` (number, 可选) - 图片高度（默认 512）
- `steps` (number, 可选) - 采样步数（默认 20，越高越精细）
- `cfg_scale` (number, 可选) - 提示词相关性（默认 7.0）
- `seed` (number, 可选) - 随机种子，固定种子可重现结果

**示例请求**:
```json
{
  "prompt": "a beautiful pearl earring on white background, product photography, professional lighting",
  "negative_prompt": "blurry, low quality, watermark",
  "width": 1024,
  "height": 1024,
  "steps": 30
}
```

**返回**:
```json
{
  "image_url": "https://storage.optima.shop/generated/abc123.png",
  "seed": 42,
  "generation_time": 8.5,
  "model_used": "sdxl_1.0"
}
```

### 2. create_image_to_image

图片生成图片，基于输入图片和 Prompt 进行变换。

**参数**:
- `image_url` (string) - 输入图片 URL
- `prompt` (string) - 变换描述
- `strength` (number, 可选) - 变换强度（0.0-1.0，默认 0.75）
- `negative_prompt` (string, 可选) - 负面提示词
- `steps` (number, 可选) - 采样步数（默认 20）

**示例请求**:
```json
{
  "image_url": "https://example.com/earring.jpg",
  "prompt": "make it gold color, luxury style",
  "strength": 0.6,
  "steps": 25
}
```

**使用场景**:
- 商品图片风格转换
- 背景替换
- 颜色调整
- 细节优化

### 3. create_video_from_image

图片生成视频，为静态图片添加动画效果。

**参数**:
- `image_url` (string) - 输入图片 URL
- `motion_prompt` (string) - 动作描述
- `duration` (number, 可选) - 视频时长（秒，默认 3）
- `fps` (number, 可选) - 帧率（默认 24）

**示例请求**:
```json
{
  "image_url": "https://example.com/earring.jpg",
  "motion_prompt": "rotate 360 degrees slowly",
  "duration": 5,
  "fps": 30
}
```

**返回**:
```json
{
  "video_url": "https://storage.optima.shop/generated/video_abc123.mp4",
  "thumbnail_url": "https://storage.optima.shop/generated/thumb_abc123.jpg",
  "duration": 5.0,
  "file_size": "2.3 MB",
  "generation_time": 45.2
}
```

**使用场景**:
- 商品展示视频
- 社交媒体内容
- 产品演示

## 🚀 快速开始

### 本地开发

```bash
# 克隆仓库
cd ~/optima/mcp-tools/comfy-mcp

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env

# 启动 ComfyUI（如果本地运行）
cd ~/comfyui
python main.py

# 启动 MCP 服务
python -m comfy_mcp.server
# 服务运行在 http://localhost:8220
```

### Docker 开发

```bash
docker compose up
# ComfyUI + MCP Server 一起启动
```

## 🔑 配置

### 环境变量

**ComfyUI 连接**:
- `COMFYUI_URL` - ComfyUI API 地址（默认 http://localhost:8188）
- `COMFYUI_API_KEY` - ComfyUI API 密钥（如果需要）

**存储配置**:
- `STORAGE_TYPE` - 存储类型（s3/local，默认 s3）
- `S3_BUCKET` - S3 bucket 名称
- `S3_REGION` - S3 区域

**服务配置**:
- `PORT` - MCP 服务端口（默认 8220）
- `MAX_CONCURRENT_JOBS` - 最大并发任务（默认 3）

### 注册到 MCP Host

Comfy MCP 需要在 MCP Host 中注册：

```json
{
  "comfy-mcp": {
    "url": "http://localhost:8220/sse",
    "description": "图像生成工具"
  }
}
```

## 📊 使用场景

### 场景 1：生成商品图片

**用户对话**:
```
用户: "帮我生成一张珍珠耳环的产品图"
```

**AI 调用流程**:
1. 调用 `create_image_from_prompt`
2. Prompt: "pearl earrings, white background, professional product photography"
3. 返回图片 URL

### 场景 2：图片风格转换

**用户对话**:
```
用户: "把这张耳环图改成金色的"
```

**AI 调用流程**:
1. 调用 `create_image_to_image`
2. 输入原图 + Prompt: "gold earrings, luxury style"
3. Strength: 0.6（保留原图结构）

### 场景 3：商品展示视频

**用户对话**:
```
用户: "为这个商品生成一个旋转展示视频"
```

**AI 调用流程**:
1. 调用 `create_video_from_image`
2. Motion Prompt: "360 degree rotation"
3. 返回视频 URL

## 🛠️ 常用操作

### 测试图像生成

通过 MCP Host 调用：

```bash
# 文本生图
curl -X POST http://localhost:8300/mcp/tools/call \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "create_image_from_prompt",
    "arguments": {
      "prompt": "a beautiful sunset over the ocean",
      "width": 1024,
      "height": 768
    }
  }'
```

### 查看生成队列

```bash
# 查看当前任务状态
curl http://localhost:8220/jobs/status
```

### 查看日志

```bash
# 生产环境
docker logs -f optima-comfy-mcp --tail 100

# 本地开发
python -m comfy_mcp.server --log-level debug
```

## 📁 项目结构

```
src/
├── mcp/                    # MCP 工具实现
│   ├── text_to_image.py    # 文本生图
│   ├── image_to_image.py   # 图生图
│   └── image_to_video.py   # 图生视频
├── services/
│   ├── comfyui_client.py   # ComfyUI API 客户端
│   ├── storage.py          # S3/本地存储
│   └── queue.py            # 任务队列
├── models/
│   └── workflows.py        # ComfyUI 工作流定义
└── server.py               # MCP 服务器入口
```

## 🐛 故障排查

### 常见错误

**1. ComfyUI 连接失败**
```
Error: Failed to connect to ComfyUI
```
- 检查 ComfyUI 是否运行：访问 http://localhost:8188
- 验证 `COMFYUI_URL` 配置
- 确认网络连接

**2. 图像生成超时**
```
Error: Generation timeout after 60s
```
- 检查 ComfyUI GPU 资源
- 降低 `steps` 参数（减少采样步数）
- 检查 ComfyUI 日志：`tail -f ~/comfyui/comfyui.log`

**3. 图片上传失败**
```
Error: S3 upload failed
```
- 检查 S3 凭证配置
- 验证 bucket 权限
- 查看存储空间是否充足

**4. 模型加载失败**
```
Error: Model 'sdxl_1.0' not found
```
- 下载模型文件到 `~/comfyui/models/`
- 检查模型文件名是否匹配
- 查看 ComfyUI 模型路径配置

## ⚡ 性能优化

### GPU 配置

**推荐配置**:
- NVIDIA RTX 3060 或更高
- 至少 12GB VRAM
- CUDA 11.8+

**性能指标**（RTX 4090）:
- 文本生图（512x512, 20 steps）：约 3-5 秒
- 文本生图（1024x1024, 30 steps）：约 8-12 秒
- 图生视频（3 秒，24fps）：约 30-45 秒

### 并发控制

```python
# .env 配置
MAX_CONCURRENT_JOBS=3  # 根据 GPU 内存调整
```

**建议**:
- 12GB VRAM：最多 2 个并发
- 24GB VRAM：最多 4 个并发

## 🔗 相关服务

**被调用方**:
- MCP Host - 通过 MCP 协议调用

**依赖服务**:
- ComfyUI - 图像生成引擎
- S3/MinIO - 图片存储

**集成位置**:
- 在 MCP Host 的 `visual-content` 技能中集成

## 📚 相关文档

- **仓库 README**: https://github.com/Optima-Chat/comfy-mcp/blob/main/README.md
- **ComfyUI 文档**: https://github.com/comfyanonymous/ComfyUI
- **Stable Diffusion**: https://stability.ai/
- **FastMCP 文档**: https://github.com/jlowin/fastmcp

## 💡 商业价值

**内容生产效率**:
- 传统摄影：数小时 + 专业设备
- AI 生成：3-10 秒，零成本

**使用场景**:
- 商品图片生成（占 60% 使用）
- 营销素材制作（占 30% 使用）
- 产品演示视频（占 10% 使用）

**成本节省**:
- 摄影成本：$50-200/次
- AI 生成成本：$0.01-0.05/张（GPU 折旧）
