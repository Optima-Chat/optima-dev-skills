---
name: publish-coo-windows
description: 发布 Optima COO Windows 安装包到 desktop.yzsgo.com 的实际下载页，复用已选定产物、核对来源与校验和、定向上传 OSS 并验证公网下载。仅在用户明确要求重新构建时触发 Windows 构建；不用于店铺业务操作。
---

# COO Windows 安装包发布

## 发布目标与授权

- 实际下载页固定为 https://desktop.yzsgo.com/optima-coo/index.html 。GitHub Releases 只是可选构建产物/备用分发来源；创建 Release 不代表这个页面已更新。
- 唯一 OSS 写入范围：`oss://optima-cn-prod-desktop-dist-1911493506120573/optima-coo/`；region `cn-beijing`，endpoint `oss-cn-beijing.aliyuncs.com`。保留其它助手目录（包括 `optima-connect/`）、桶配置、Mac 卡片与 App 自动更新渠道。
- 使用已有获授权的 Aliyun CLI profile `aliyun-optima` 正常认证；不读取、复制或输出凭据，不导出 key、不拼装手工签名。认证失败时报告阻塞。
- 构建与发布分别处理：优先直接复用用户已选定的构建产物，只有用户明确要求重新构建才触发对应构建。仅要求构建不包含 OSS 发布授权。
- 用户明确授权发布未签名内测包时，继承该授权并标注验证范围，不反复要求确认。发布授权不扩大为重装、关闭或卸载 owner 旧 App、停止共享 TSB、交接账号、读取账号文件/钥匙串/紫鸟资料，或 discover/真实店铺命令的授权。

## 先定位当前源码和产物

1. 用 `gh` 查看 `Optima-Chat/optima-coo` 当前发布文档、所选构建的 Actions run/artifact 和下载页 PR 状态；读取有效的 `download-page/build.mjs`、`publish.mjs`、`releases.json`、`src/index.html`。不要假设 main 已有这些文件。
   - 2026-11-06 的已知入口是草稿 PR [#9404](https://github.com/Optima-Chat/optima-coo/pull/9404)，分支 `feat/coo-download-page`，当时 head 为 `0869fdd7ee24900103f190b1d74e95da7e624b33`。每次重新查询当前状态，不永久固定该提交。
   - 在用户授权的本次工作区处理源码。其它工作区或 `/tmp` 中的参考副本可只读核对，不能把历史路径当默认工作区，也不修改他人工作区。
2. 读取线上 `releases.json` 和真实页面，与源码比较，防止从旧分支部署回退已发布版本。各平台独立更新；Windows 更新必须保留线上 Mac 的元数据和卡片。源码与线上有冲突时先查清发布记录，不用旧源码覆盖。
3. 记录此次产物的版本、source commit、build commit（两者可不同）、Actions run URL/ID、artifact/Release 来源、真正的 `.exe` 文件名、本地路径、字节数及 SHA256。解开 artifact 后校验 EXE 本体，不把 ZIP、blockmap、更新清单或日志当安装包。将本地完整文件的字节数和哈希与构建/发布记录交叉核对；不一致即停止，不靠改元数据掩盖不一致。
4. 核对这份包的真实应用名和快捷方式名（构建记录、打包配置及已有安装证据），不能由待合入源码中的新名字推断旧包已改名。未明确的信息如实标为未验证。

如需重新构建，先读所选提交的 Windows workflow/打包说明，使用现有构建流程；不在发布任务中顺手修改构建流程。新构建完成后重新核对上述产物证据。

## 准备页面

- 只修改本次 Windows 必要内容：`releases.json.windows` 的 `version`、`file`、`bytes`、`sha256`，以及 `src/index.html` 中确需更新的 Windows 安装说明、应用名及验证状态。同步实际维护的源码/PR，不能只改生成的 `dist`，否则后续部署会回退旧链接。
- 复用现有页面构建器：在有效 COO 源码根目录运行 `node download-page/build.mjs`，以及现有的 `node --test download-page/build.test.mjs`。这是静态下载页构建，不是重新编译 App。构建器还会读取 `website/assets/icon.svg`，不要只复制四个文件到不完整目录后执行。
- 检查 `dist/index.html` 与 `dist/releases.json`：Windows 链接、版本、大小、SHA256 与 EXE 一致，无未替换模板；大小沿用构建器的显示口径（当前为 bytes / 1024 / 1024，保留一位小数）。Mac 卡片、链接和元数据不变。
- 当前 `publish.mjs` 会先校验并上传 Mac 和 Windows 两个平台的完整安装包。仅更新 Windows 时无需为了该脚本重新下载/上传不变的 Mac 包；使用下面的三项定向上传即可。若本次确实获授权同时更新两平台，可在核对当前脚本后复用 `node download-page/publish.mjs <installer-directory> aliyun-optima`。

## 定向发布 Windows

必须按顺序执行：**版本化 EXE → releases.json → index.html**。每一步成功后才继续；失败时停止，报告已上传对象和线上状态，核实后再续传，不盲目重跑整个发布。不要覆盖内容不同的同名 immutable 安装包；发现冲突先查产物与版本。

以下是获授权后的命令示例，在已核对的 COO 源码根目录运行。`installer` 必须设为此次已完整校验的 EXE 绝对路径；其它变量从本次元数据取得，不套用历史版本：

```bash
installer='/absolute/path/to/selected-installer.exe'
file=$(node -p 'require("./download-page/releases.json").windows.file')
sha256=$(node -p 'require("./download-page/releases.json").windows.sha256')
destination='oss://optima-cn-prod-desktop-dist-1911493506120573/optima-coo/'

aliyun oss cp "$installer" "${destination}${file}" \
  --profile aliyun-optima --region cn-beijing -e oss-cn-beijing.aliyuncs.com \
  -f --cli-non-interactive \
  --meta "Content-Type:application/octet-stream#Content-Disposition:attachment; filename=\"${file}\"#Cache-Control:public, max-age=31536000, immutable#x-oss-meta-sha256:${sha256}"

aliyun oss cp download-page/dist/releases.json "${destination}releases.json" \
  --profile aliyun-optima --region cn-beijing -e oss-cn-beijing.aliyuncs.com \
  -f --cli-non-interactive \
  --meta 'Content-Type:application/json; charset=utf-8#Cache-Control:no-cache#Content-Disposition:inline'

aliyun oss cp download-page/dist/index.html "${destination}index.html" \
  --profile aliyun-optima --region cn-beijing -e oss-cn-beijing.aliyuncs.com \
  -f --cli-non-interactive \
  --meta 'Content-Type:text/html; charset=utf-8#Cache-Control:no-cache#Content-Disposition:inline'
```

命令逐条检查退出码，不把整个代码块当作失败后仍继续的脚本。定向三项的前提是线上已有所需静态资源且本次没有资源变更；确需更新的页面资源在元数据/HTML 前上传并设 `no-cache`，仍只写 COO 前缀。不改桶策略或自动更新配置。

## 发布验收与报告

1. 从真实页面读取 Windows 按钮实际链接，确认版本、显示大小、文件名、SHA256、安装说明与线上 `releases.json` 一致，Mac 卡片不变。检查响应头：EXE 为 attachment、immutable 长缓存且 `x-oss-meta-sha256` 正确；HTML/元数据为 `no-cache`。
2. 使用不带认证的请求（无 Cookie、Authorization 或签名 URL），从按钮链接完整下载 EXE 到临时文件；例如 `curl -q -fL --output "$downloaded_exe" "$button_url"`，变量分别为临时文件路径和从页面解析出的完整链接。比较实际文件字节数与 SHA256（可用 `wc -c`、`shasum -a 256`），要求与本地产物、线上元数据及 OSS 哈希头全部一致。HEAD 或部分 Range 下载不足以证明完整下载成功。
3. 确认源码元数据/Windows 说明已同步到维护中的分支或 PR；未完成合入时明确报告 PR 状态，不宣称已进入 main。
4. 报告下载页、包版本/名称、source/build commit、run、字节数、SHA256、公网完整下载结果和剩余验证项。分别说明 typecheck、NSIS 打包、校验和、packaged E2E、安装 smoke 的通过/失败/未执行，不能互相替代。

已知历史示例（不是永久默认）：`0.2.44-windows.20261106110025`，source `88e2d0dc2efa630fb2c62d0c528bad4be2430343`，build `b542feaf0438e3bf62696d548f2d67c3d5230b57`，run `42206959735`；EXE `216480482` bytes，SHA256 `d9331bc124a8c70debed02b8e2fdcaaea8857e2fa5bb8c51f6909b94d5fd6efd`，完整公网下载已验证。该包的 typecheck、NSIS、校验和、packaged E2E 通过，但安装 smoke 因机器已有演练进程/安装而主动停止，不能写成安装验收通过，也不能擅自关闭旧 App 来重试。它的实际应用/快捷方式名仍为「Optima COO Windows 演练」。当时紫鸟真实登录仍返回 `-10003`；安装包或诊断修复不等于紫鸟连接已全部修复。
