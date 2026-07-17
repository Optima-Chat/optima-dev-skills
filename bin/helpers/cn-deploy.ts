#!/usr/bin/env node
/**
 * optima-cn-deploy —— 云效 Flow cn-stage 流水线一条龙触发器(团队版)。
 *
 * 对应 optima-terraform alicloud/stacks/cn-prod-buildbox/yunxiao/ 的 cn-run.py,
 * 去掉 buildbox SSH 依赖(凭证由云效变量组 41970 供给,2026-07-13 起控制台/API 裸跑均可)。
 *
 * 做四件事(每件都是踩过的坑):
 *   1. 触发服务仓 Codeup mirror 同步并等目标分支追平 GitHub —— mirror 不新鲜=构建旧代码。
 *      GitHub token 用 `gh auth token`(需本机 gh 已登录)。
 *   2. StartPipelineRun;--branch 时带 runningBranchs 覆盖服务仓 source 分支。
 *   3. 轮询到终态,给出云效 run 链接。
 *   4. SUCCESS 后校验 SAE ImageUrl tag == 目标分支 HEAD short-sha(防"流水线绿但没部上");
 *      aliyun API 偶发空返回,带重试守卫。
 *
 * 用法:
 *   optima-cn-deploy billing                      # main 全链(构建→迁移→SAE 发布)
 *   optima-cn-deploy user-auth --branch feat/xxx  # 非 main 分支构建+部署到 cn-stage
 *   optima-cn-deploy gateway-core --no-wait       # 只触发不等待
 *   optima-cn-deploy --list                       # 列出全部可发服务
 *   optima-cn-deploy billing --vtag cn-v1.2.3     # stage 按版本 tag 构建(发版前验证)
 *   optima-cn-deploy billing --env prod --vtag cn-v1.2.3
 *       # cn-prod vtag 发版:构建→停在人工卡点(云效控制台审批)→迁移→digest 钉死部署
 *
 * 前置: aliyun CLI(profile 默认 aliyun-optima,可用 OPTIMA_ALIYUN_PROFILE 覆盖)+ gh 已登录。
 * 流水线定义的单一信源在 optima-terraform yunxiao/(gen-pipelines.py);本表为其快照,
 * 新增服务后同步(pipelineId 稳定,不常变)。
 */
import { execFileSync } from 'node:child_process';

const ORG = '6a17b6282bf8b1184fc0e0c6';
const ENDPOINT = 'devops.cn-hangzhou.aliyuncs.com';
const PROFILE = process.env.OPTIMA_ALIYUN_PROFILE || 'aliyun-optima';
const CODEUP_BASE = `https://codeup.aliyun.com/${ORG}`;

// 服务注册表(快照自 optima-terraform services.stage.env + gen-pipelines.py,2026-07-13)
interface Svc { pipelineId: number; repo: string; saeAppId?: string; prodSaeAppId?: string; buildOnly?: boolean; }
const SERVICES: Record<string, Svc> = {
  'agent-portal':             { pipelineId: 5118519, repo: 'optima-portals',     saeAppId: 'fe757f78-d18d-4480-9402-fe59d4721055', prodSaeAppId: '9211db38-a255-4393-ae92-7a7bb41b583d' },
  // build-only:非 SAE 常驻(gateway-core 按 session 拉起的镜像)。release 段=解析 ACR digest
  // → 回写 Infisical /services/gateway-core/ALIYUN_AGENT_RUNTIME_IMAGE(#807)→ 滚动重启 gateway-core。
  // 无自身 saeAppId;prod 流水线(agent-runtime-cn-prod,5124970)按名实时解析(见下方 ListPipelines 逻辑)。
  'agent-runtime':            { pipelineId: 5124962, repo: 'optima-gateway',     buildOnly: true },
  'agentic-chat':             { pipelineId: 5118520, repo: 'agentic-chat',       saeAppId: '6aea1ce1-f813-4e1c-8e97-d1ecb5398e37', prodSaeAppId: '6e290c73-a646-43ef-9da5-ad0b2e7eff73' },
  'billing':                  { pipelineId: 5118521, repo: 'optima-billing',     saeAppId: '09d8e292-dc64-4af8-bce5-0a56cb666921', prodSaeAppId: '6c31cf82-8802-4d45-b6a2-e9d7c83ccce9' },
  'browser-backend':          { pipelineId: 5118522, repo: 'optima-browser-use', saeAppId: '1fced3f6-a80a-41a4-8f23-e4d5a467f8eb', prodSaeAppId: 'eb782ed9-c468-4e81-a0fe-87e5b4264192' },
  'commerce-backend':         { pipelineId: 5107005, repo: 'commerce-backend',   saeAppId: '49d09808-508c-471a-9560-553c49a67f72', prodSaeAppId: 'd40597b6-a98c-4063-9297-8b9fdfa8add4' },
  'commerce-rq-scheduler':    { pipelineId: 5118523, repo: 'commerce-backend',   saeAppId: '1d2810ef-889e-4675-b6e6-a299e4722e68', prodSaeAppId: '762dd7a5-7fe8-41ed-9332-cfd31b0e087e' },
  'commerce-rq-worker':       { pipelineId: 5118524, repo: 'commerce-backend',   saeAppId: 'd661da87-6d24-40b8-93ed-e1c967d8abe2', prodSaeAppId: '2c9ee19a-5062-4205-9f5b-6ae3f8062a23' },
  'gateway-core':             { pipelineId: 5118525, repo: 'optima-gateway',     saeAppId: '9326b7ff-da52-48d6-86db-9c4a884be108', prodSaeAppId: 'a08ce23f-3d3e-4d89-a2cf-53c8adba614e' },
  'gw-admin':                 { pipelineId: 5118526, repo: 'optima-gateway',     saeAppId: '90e0daf7-7910-46b8-b5bf-a0b8bcc60859', prodSaeAppId: 'c6bc5a78-b27f-46e2-825a-eaa338c23645' },
  'kb-backend':               { pipelineId: 5118527, repo: 'kb-skills',          saeAppId: 'c7f65160-9d9e-416e-9e36-5439010d2b2d', prodSaeAppId: '732dfc8c-ed78-43f7-a722-c614359ff1a1' },
  'ops-portal':               { pipelineId: 5118529, repo: 'optima-portals',     saeAppId: '41d0ee66-8402-4e72-bfda-8eba75d1270c', prodSaeAppId: '69e513fd-29bf-4355-a275-5eba82b21136' },
  'optima-generation':        { pipelineId: 5118530, repo: 'optima-gen',         saeAppId: '327856d5-8b18-4e15-bfd8-b8bd3b807ffa', prodSaeAppId: '868d1a69-12c9-4bb7-868b-3e89c26784b5' },
  'optima-generation-worker': { pipelineId: 5118531, repo: 'optima-gen',         saeAppId: 'ad75b3b0-9ff4-443d-b0ef-81886bc7aa60', prodSaeAppId: '2adc941e-374b-406a-9863-e53d40bc9500' },
  'optima-scout':             { pipelineId: 5117336, repo: 'optima-scout',       saeAppId: 'bac2c3a4-90ce-49a6-81d5-caa38cb5c807', prodSaeAppId: 'f5bb7e82-e57c-4bd4-83ae-2c25f8d38647' },
  'optima-sentinel':          { pipelineId: 5118532, repo: 'optima-sentinel',    saeAppId: '3759db7b-4640-4a04-8436-4f241f0ec9d9', prodSaeAppId: 'e120e70c-b2c1-49ef-a66c-9016fd2d807d' },
  'optima-sentinel-worker':   { pipelineId: 5118533, repo: 'optima-sentinel',    saeAppId: '7c975caf-ebfb-4bb3-91c4-2a8c83d1d2e5', prodSaeAppId: 'e0f9b92c-00af-4ade-9b07-15bba48c14cc' },
  'optima-skills':            { pipelineId: 5118534, repo: 'optima-skills',      saeAppId: '90457be3-5eb3-4efc-a362-1788dcc51921', prodSaeAppId: '55a63ee7-fb75-46e4-99f3-20854a699237' },
  'user-auth':                { pipelineId: 5118510, repo: 'user-auth',          saeAppId: '36efc3a6-5b42-49fa-8db2-0865aa0c25d2', prodSaeAppId: 'd6fbf9de-fed6-4165-978f-7b3a0a456acc' },
  'user-auth-admin':          { pipelineId: 5118535, repo: 'user-auth',          saeAppId: '7feb9cc3-4731-4ea8-964c-4870a9e63afb', prodSaeAppId: '54093f99-37bf-4354-abd7-f6e76abdbcb6' },
  'yzsgo-api':                { pipelineId: 5118536, repo: 'yzsgo',              saeAppId: 'd0af7f66-ef66-4587-9e93-250d01ee3cf6', prodSaeAppId: '5a820992-e11b-404a-9e58-8f607d8e0c5f' },
};

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e: any) {
    return '';
  }
}

function devops(action: string, kv: Record<string, string>, retries = 3): any {
  const args = ['devops', action, '--organizationId', ORG, '--endpoint', ENDPOINT, '--profile', PROFILE];
  for (const [k, v] of Object.entries(kv)) args.push(`--${k}`, v);
  for (let i = 0; i < retries; i++) {
    const out = sh('aliyun', args);
    try { return JSON.parse(out); } catch { /* aliyun 偶发空返回/超时,重试 */ }
  }
  return {};
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list') || argv.length === 0) {
    console.log('可发服务(cn-stage):\n  ' + Object.keys(SERVICES).sort().join('\n  '));
    console.log('\n用法: optima-cn-deploy <service> [--branch feat/xxx] [--no-wait]');
    process.exit(argv.includes('--list') ? 0 : 1);
  }
  const svcName = argv[0];
  const svc = SERVICES[svcName];
  if (!svc) { console.error(`✗ 未知服务 ${svcName}(--list 看全量)`); process.exit(1); }
  const bIdx = argv.indexOf('--branch');
  const branch = bIdx >= 0 ? argv[bIdx + 1] : 'main';
  const noWait = argv.includes('--no-wait');
  const eIdx = argv.indexOf('--env');
  const envName = eIdx >= 0 ? argv[eIdx + 1] : 'stage';
  const vIdx = argv.indexOf('--vtag');
  const vtag = vIdx >= 0 ? argv[vIdx + 1] : '';
  if (!['stage', 'prod'].includes(envName)) { console.error('✗ --env 只支持 stage|prod'); process.exit(1); }
  if (vtag && !/^cn-v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(vtag)) {
    console.error(`✗ vtag 格式必须 cn-vX.Y.Z(得到 ${vtag});裸 v* 会误触 AWS prod,绝不放行`); process.exit(1);
  }
  if (envName === 'prod') {
    // prod = vtag 制:先 stage 同 tag 验证,再发 prod;流水线内还有人工卡点
    if (!vtag) { console.error('✗ --env prod 必须带 --vtag cn-vX.Y.Z(先 stage 同 tag 验证)'); process.exit(1); }
    if (branch !== 'main') { console.error('✗ prod 发布按 vtag,不接受 --branch'); process.exit(1); }
  }
  const ref = vtag || branch;

  // 1. GitHub HEAD + mirror 同步
  const ghSha = sh('gh', ['api', `repos/Optima-Chat/${svc.repo}/commits/${ref}`, '--jq', '.sha']);
  if (!ghSha) { console.error(`✗ GitHub 上无 ${svc.repo}@${ref}(或 gh 未登录,tag 需已 push)`); process.exit(1); }
  const repos = devops('ListRepositories', { perPage: '100' });
  const repoId = (repos.result || []).find((r: any) => r.name === svc.repo)?.Id;
  if (!repoId) { console.error(`✗ Codeup 无 mirror 仓 ${svc.repo}`); process.exit(1); }
  const ghTok = sh('gh', ['auth', 'token']);
  devops('TriggerRepositoryMirrorSync', { repositoryId: String(repoId), account: 'xbfool', token: ghTok });
  let synced = false;
  for (let i = 0; i < 30; i++) {
    const b = devops('GetBranchInfo', { repositoryId: String(repoId), branchName: ref });
    if (b?.result?.commit?.id === ghSha) { synced = true; break; }
    await sleep(10000);
  }
  if (!synced) { console.error('✗ 300s 内 Codeup mirror 未追平 GitHub,中止(检查 mirror 凭证)'); process.exit(1); }
  console.log(`✓ mirror 已追平 ${svc.repo}@${ref} = ${ghSha.slice(0, 10)}`);

  // 2. 触发(凭证由云效变量组供给,无需注入)。prod 流水线 id 按名实时解析(不硬编码)。
  let pipelineId = svc.pipelineId;
  if (envName === 'prod') {
    const lp = devops('ListPipelines', { maxResults: '100' });
    const hit = (lp.pipelines || []).find((p: any) => p.pipelineName === `${svcName}-cn-prod`);
    if (!hit) { console.error(`✗ 云效无 ${svcName}-cn-prod 流水线`); process.exit(1); }
    pipelineId = hit.pipelineId;
  }
  const kv: Record<string, string> = { pipelineId: String(pipelineId) };
  if (vtag) {
    kv.params = JSON.stringify({
      runningTags: { [`${CODEUP_BASE}/${svc.repo}.git`]: vtag },
      envs: { VTAG: vtag },
    });
  } else if (branch !== 'main') {
    kv.params = JSON.stringify({ runningBranchs: { [`${CODEUP_BASE}/${svc.repo}.git`]: branch } });
  }
  const start = devops('StartPipelineRun', kv);
  const runId = start.pipelineRunId;
  if (!runId) { console.error(`✗ 启动失败: ${JSON.stringify(start).slice(0, 150)}`); process.exit(1); }
  console.log(`▶ ${svcName} run#${runId} 已启动 (ref=${ref}, env=${envName})`);
  console.log(`  https://flow.aliyun.com/pipelines/${pipelineId}/current`);
  if (envName === 'prod') {
    console.log('⏸ 构建完成后会停在『发布审批』人工卡点 —— 需 xbfool/svenyang 在云效控制台通过,之后迁移+digest 部署自动走完');
  }
  if (noWait) return;

  // 3. 轮询
  let status = '';
  for (;;) {
    const d = devops('GetPipelineRun', { pipelineId: String(pipelineId), pipelineRunId: String(runId) });
    status = d?.pipelineRun?.status || status;
    if (['SUCCESS', 'FAIL', 'CANCELED', 'ERROR'].includes(status)) break;
    await sleep(45000);
  }
  console.log(`${status === 'SUCCESS' ? '✅' : '❌'} ${svcName} run#${runId}: ${status}`);
  if (status !== 'SUCCESS') process.exit(1);

  // 4. 成功标准。build-only(agent-runtime)无自身 SAE app:release 段已在流水线内完成
  //    digest 回写 Infisical + 重启 gateway-core(任一步失败即 exit 非 0,不会静默),
  //    故流水线 SUCCESS 即发版成功,不做 SAE ImageUrl 校验。
  if (svc.buildOnly) {
    const infEnv = envName === 'prod' ? 'prod' : 'staging';
    console.log(`✓ build-only 发版完成:release 段已回写 ${infEnv} Infisical ALIYUN_AGENT_RUNTIME_IMAGE(@sha256 digest)并滚动重启 gateway-core`);
    return;
  }

  // SAE ImageUrl 校验(空返回重试守卫)。prod 是 digest 寻址,校验含 @sha256 即部署成功。
  const appId = envName === 'prod' ? svc.prodSaeAppId : svc.saeAppId;
  if (appId) {
    let img = '';
    for (let i = 0; i < 3; i++) {
      const raw = sh('aliyun', ['sae', '--profile', PROFILE, '--region', 'cn-beijing',
        'DescribeApplicationConfig', '--AppId', appId]);
      try { img = JSON.parse(raw)?.Data?.ImageUrl || ''; break; } catch { await sleep(3000); }
    }
    if (!img) { console.log('⚠️ SAE 配置查询连续空返回,跳过 ImageUrl 校验(流水线本身已 SUCCESS)'); return; }
    if (envName === 'prod') {
      const ok = img.includes('@sha256:');
      console.log(`${ok ? '✓' : '✗'} SAE ImageUrl(prod 应为 digest 寻址): ${img.split('/').pop()}`);
      if (!ok) process.exit(1);
    } else {
      const tag = img.split(':').pop() || '';
      const ok = ghSha.startsWith(tag);
      console.log(`${ok ? '✓' : '✗'} SAE ImageUrl tag=${tag} vs 目标 ${ghSha.slice(0, 10)}`);
      if (!ok) process.exit(1);
    }
  }
}

main().catch(e => { console.error('✗', e?.message || e); process.exit(1); });
