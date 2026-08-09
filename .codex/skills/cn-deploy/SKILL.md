---
name: cn-deploy
description: 当用户请求把服务发布/部署/构建到 cn-stage、跑云效流水线、cn-stage 发版、部署某个分支到 cn-stage、触发 cn 构建、yunxiao 部署、"把 xx 发到 cn"时，使用此技能。覆盖 cn-stage 全部 21 个服务（构建→DB迁移→SAE 发布一条龙；含 build-only 的 agent-runtime）。
---

# cn-deploy - 云效 cn-stage 流水线发布

## 用途

把服务的 GitHub 代码经云效 Flow 流水线发布到阿里云 cn-stage（SAE）。一条命令完成：
Codeup mirror 同步 → 构建（含 NEXT_PUBLIC 自动烤/境内镜像源改写）→ DB 迁移 → SAE 滚动发布 → 部署 sha 校验。

## 命令

```bash
optima-cn-deploy <service>                    # main 全链发布
optima-cn-deploy <service> --branch feat/xxx  # 非 main 分支构建+部署
optima-cn-deploy <service> --no-wait          # 只触发不等待
optima-cn-deploy --list                       # 列出全部可发服务
```

## 使用要点

1. **先 `--list` 确认服务名**（21 个服务，含 commerce-backend / optima-scout / build-only 的 agent-runtime）。
2. 全链约 3-8 分钟（agentic-chat 最重）。触发后会输出云效 run 链接，可发给用户自行围观。
3. **凭证零配置**：构建凭证由云效变量组 `cn-stage-build-credentials`(41970) 供给，不需要注入任何 secret。
4. 分支构建会把该分支代码部署到 cn-stage（替换现运行版本）——用户明确要求部署分支时才用。
5. 失败排查：命令输出的 flow.aliyun.com 链接里看具体 step 日志；常见原因是该分支/仓的 Codeup mirror 凭证问题（命令会在 mirror 步就报错并中止，不会构建旧代码）。
6. 成功标准：最后一行 `✓ SAE ImageUrl tag=<sha>` —— 流水线绿且 SAE 真的钉到了目标 commit。只看流水线绿不算完成。
7. **build-only 服务（`agent-runtime`）**：非 SAE 常驻（gateway-core 按 session 拉起的镜像）。成功标准不是 SAE ImageUrl，而是流水线绿即可——release 段自动把 ACR digest 回写 Infisical `/services/gateway-core/ALIYUN_AGENT_RUNTIME_IMAGE`(#807) 并滚动重启 gateway-core（任一步失败即 exit 非 0）。工具最后一行为 `✓ 流水线 SUCCESS(build-only)…` —— CLI 以流水线终态为准，未独立校验 Infisical/gateway-core（digest 与重启变更单见 run『发版』段日志）。


## cn-prod vtag 发版（通路已跑通；清单外的服务仍算首发）

```bash
optima-cn-deploy <service> --vtag cn-v1.2.3               # 先 stage 同 tag 验证
optima-cn-deploy <service> --env prod --vtag cn-v1.2.3    # prod 发版
```

- prod 是 vtag 制：必须先 `git tag cn-vX.Y.Z && git push`，工具拒绝无 vtag / 裸 v* / 带 --branch 的 prod 请求
- 🔴 prod 流水线**没有人工卡点**：构建 → DB 迁移 → digest 钉死部署一路自动走完，不会停下来等谁审批。**敲下命令那一刻就是最终决策点**；触发后要中止只能去云效 run 页面手动取消（实测 2026-08-09，见 #89）
- 成功标准：prod SAE ImageUrl 为 `@sha256:` digest 寻址（工具最后一行校验）
- ⚠️ **老路径会盖掉 digest**：云效 prod 钉的是 `@sha256:` digest，buildbox `cn-deploy.sh` 发的是 `:<sha>` tag，后发的覆盖先发的。发版后隔天复查一次 SAE ImageUrl：已从 digest 变回 tag 形态即为被老路径覆盖，需重跑云效 prod 流水线（2026-07-31 一天内见 3 例，`cn-deploy.sh` 下线前一直存在）
- 用户请求发 cn-prod 时：确认已有 stage 验证过的 cn-v tag；没有则先引导走 stage
- **已发过 prod 的服务**（2026-07-14 起，截至 2026-07-31）：`commerce-backend`、`optima-scout`、`optima-generation`、`optima-generation-worker`、`browser-backend`（最近一次 2026-07-30 browser-backend cn-v1.0.0 全绿）。**不在此列的一律当首发处理**：避开业务高峰、**触发之前**找 xbfool/svenyang 人工确认（没有卡点可以事后补，见上条）、发完立刻校验 ImageUrl

## 前置依赖

- `aliyun` CLI 已配置（profile 默认 `aliyun-optima`，可用环境变量 `OPTIMA_ALIYUN_PROFILE` 覆盖为自己的 RAM 用户 profile）
- `gh` 已登录（mirror 同步需要 GitHub token）

## 边界

- cn-prod 仅走 vtag 制（见上）；**没有人工卡点闸门** —— 工具侧那道 vtag 校验（拒绝无 vtag / 裸 `v*` / 带 `--branch` 的 prod 请求）就是最后一道闸。日常无 vtag 的构建只发 cn-stage。
- 服务注册表是 optima-terraform `alicloud/stacks/cn-prod-buildbox/yunxiao/` 的快照；新增服务先在那边 gen-pipelines 建好流水线，再同步本工具的 SERVICES 表。
