#!/usr/bin/env node
/**
 * optima-verify-health —— 服务上线健康探针(L1 DNS / L2 TLS / L3-L5 /health)。
 *
 * 逐层探、逐层报,逐层 pass 才算上线成功。零依赖(纯 Node 内置)。
 * 配套静态合规审计 audit-probe.py 在 optima-terraform 仓 docs/cn-prod/probes/(读 terraform 文件,绑仓不搬)。
 *
 *   L1 DNS  : FQDN 能解析到 IP
 *   L2 TLS  : 443 握手 + 证书链/有效期/SNI(SAN)匹配
 *   L3 /health : optima-core 风格 /health,顶层 status 健康
 *   L4 真部署  : 解析 gitCommit;传 --expect-commit <sha> 时比对(证明跑的是这次镜像)
 *   L5 依赖    : checks[*] 全绿(DB/Redis/上游由服务在 health handler 自注册)
 *
 * ⚠️ optima-core 的 JS 与 Py 两套 /health schema 不一致,都兼容:
 *   JS : gitCommit(camel) / status∈{healthy,unhealthy} / 不健康返 503 / 有 gitBranch
 *   Py : git_commit(snake) / status∈{healthy,degraded} / 永远 200 / check 可 timeout|error / 无 git_branch
 *
 * 用法:
 *   optima-verify-health user-auth                  # 默认 cn-prod
 *   optima-verify-health user-auth --env prod        # 环境 stage|prod|cn-prod|cn-stage|all
 *   optima-verify-health --all --env all             # stage/prod/cn-prod/cn-stage 四环境矩阵
 *   optima-verify-health gateway-core --expect-commit a1b2c3d
 *   optima-verify-health --url https://auth.yzsgo.com/health
 *   optima-verify-health --all --json                # 机器可读,接 CI
 *   optima-verify-health --all --strict              # warn 也算不通过
 * 退出码:fail → 非 0;warn 默认放行(0),--strict 让 warn 也非 0。
 */
import { promises as dns } from 'node:dns';
import * as tls from 'node:tls';
import * as https from 'node:https';

// 环境名与全仓保持一致（logs.ts 的 CN_ENVS、query-db.ts 的 VALID_ENVS、show-env、
// billing-http 的 validateEnvCnProd）：阿里云生产叫 cn-prod，不叫 cn。
// 🔴 名字对不上时 resolve() 会把每个 SvcCfg 键查成 undefined，于是走到「无目标」分支，
// 把「环境名打错」报成「该服务无部署」—— 与 #83 那批 301 被报成「疑似未部署」同一个病：
// 探针在不确定的时候撒了一个确定的谎。
type Env = 'stage' | 'prod' | 'cn-prod' | 'cn-stage';
interface SvcCfg { path: string; stage?: string; prod?: string; 'cn-prod'?: string; 'cn-prod_path'?: string; 'cn-stage'?: string; 'cn-stage_path'?: string; }

// 服务 × 环境 FQDN 表。某服务某环境没部署 → 该 env 键缺省,探时跳过。
// cn-prod 真实 subdomain 抄自 optima-terraform alicloud/stacks/cn-prod-ingress-sae/main.tf。
// #201 (2026-06-12): yzsgo.com 全量迁移完成,旧 *-cn.optima.chat 路由已下线。
// cn-stage（阿里云预发）域名 *.stage.optima.chat，抄自 cn-stage-ingress-sae services map。
// #83 (2026-08-13): AWS stage 是 *.stage.optima.onl（点号），旧的连字符形式 *-stage.optima.onl
// 已不再路由到服务——三项实测 301 → www.optima.onl，探测恒红并误报成「疑似未部署」。
// 🔴 别只看 stage 列：agentic-chat 的 prod 也踩同一个坑（见下面那行的注释）。
const SERVICES: Record<string, SvcCfg> = {
  'user-auth':        { path: '/health',     stage: 'auth.stage.optima.onl', prod: 'auth.optima.onl', 'cn-prod': 'auth.yzsgo.com', 'cn-stage': 'auth.stage.optima.chat' },
  // agentic-chat 的 prod 入口是 www 不是 ai：prod-ecs/variables.tf 里它的 subdomain = "www"，
  // 且 main.tf 有一条 ai_to_www_redirect(priority 309) 专门把 ai.optima.onl 301 到 www。
  // 实测 ai.optima.onl/api/health → 301；www.optima.onl/api/health → 200 service=agentic-chat。
  'agentic-chat':     { path: '/api/health', stage: 'ai.stage.optima.onl',   prod: 'www.optima.onl',  'cn-prod': 'app.yzsgo.com', 'cn-stage': 'app.stage.optima.chat' },
  'commerce-backend': { path: '/health',     stage: 'api.stage.optima.onl',  prod: 'api.optima.onl',  'cn-prod': 'commerce.yzsgo.com', 'cn-prod_path': '/health/live', 'cn-stage': 'commerce.stage.optima.chat', 'cn-stage_path': '/health/live' },
  // #83: mcp-host 已于 2025-12-18 下线,故不在表内 —— optima-terraform origin/main(f97adbb) 的
  // stage-ecs/variables.tf:146 与 prod-ecs/variables.tf:508 都写着「MCP 工具服务已移除」,
  // 两个 ecs stack 的 services map 里均无该条目;实测四个候选主机名全是壳(mcp.stage.optima.onl
  // 307 → /en-US/health 前端 locale 路由,mcp-stage.optima.onl 与 prod 的 mcp.optima.onl 均
  // 301 → www)。🔴 别再把它加回来:worstOk 是全局单标志(:221),留着它会让 `--all --env stage`
  // 与 `--all --env prod` 恒 exit 1,而那个退出码正是接 CI 卡口时唯一被读的东西。
  // 同一约束在 tests/service-matrix-alignment.test.js 里对 show-env 的清单也钉着。
  'gateway-core':     { path: '/health',     'cn-prod': 'gw.yzsgo.com', 'cn-stage': 'gw.stage.optima.chat' },
  'optima-scout':     { path: '/health',     'cn-prod': 'scout.yzsgo.com', 'cn-stage': 'scout.stage.optima.chat' },
  'optima-skills':    { path: '/health',     'cn-prod': 'skills.yzsgo.com', 'cn-stage': 'skills.stage.optima.chat' },
};
const ENVS: Env[] = ['stage', 'prod', 'cn-prod', 'cn-stage'];

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[34m', N = '\x1b[0m';
const MARK: Record<string, string> = { ok: `${G}✅${N}`, fail: `${R}❌${N}`, warn: `${Y}⚠️ ${N}`, na: `${B}··${N}` };
type Result = 'ok' | 'warn' | 'fail';
interface Layer { layer: string; result: Result; detail: string; }

const verdict = (ls: Layer[]): 'pass' | 'warn' | 'fail' =>
  ls.some((l) => l.result === 'fail') ? 'fail' : ls.some((l) => l.result === 'warn') ? 'warn' : 'pass';

const VTXT: Record<string, string> = {
  pass: `${G}上线成功(L1-L5 全绿)${N}`,
  warn: `${Y}存活但有告警(见上 ⚠️;非阻塞)${N}`,
  fail: `${R}未通过 — 见上 ❌${N}`,
};

function tlsCheck(host: string, timeout = 10000): Promise<{ ok: boolean; detail: string; result: Result }> {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout }, () => {
      const cert = sock.getPeerCertificate();
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
      const sans = (cert.subjectaltname || '').split(',').map((s) => s.trim().replace(/^DNS:/, '')).slice(0, 3);
      sock.end();
      resolve({ ok: true, result: days > 7 ? 'ok' : 'warn',
        detail: `证书 ${days}d 后过期, SAN=${sans.join(',')}` + (days > 7 ? '' : ` (剩 ${days}d!)`) });
    });
    sock.on('error', (e: Error) => resolve({ ok: false, result: 'fail', detail: `握手/证书失败: ${e.message}` }));
    sock.on('timeout', () => { sock.destroy(); resolve({ ok: false, result: 'fail', detail: '握手超时' }); });
  });
}

function httpGet(url: string, timeout = 10000): Promise<{ code: number; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'optima-verify-health' }, timeout }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ code: res.statusCode || 0, body, location: res.headers.location }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
  });
}

async function probe(host: string, path: string, expect?: string): Promise<Layer[]> {
  const layers: Layer[] = [];

  // L1 DNS
  try {
    const addrs = await dns.lookup(host, { all: true });
    const ips = [...new Set(addrs.map((a) => a.address))];
    layers.push({ layer: 'L1 DNS', result: 'ok', detail: `${host} → ${ips.join(', ')}` });
  } catch (e: any) {
    layers.push({ layer: 'L1 DNS', result: 'fail', detail: `${host} 无法解析: ${e.message}` });
    return layers;
  }

  // L2 TLS
  const t = await tlsCheck(host);
  layers.push({ layer: 'L2 TLS', result: t.result, detail: t.detail });
  if (!t.ok) return layers;

  // L3-L5 /health
  const url = `https://${host}${path}`;
  let r: { code: number; body: string; location?: string };
  try {
    r = await httpGet(url);
  } catch (e: any) {
    layers.push({ layer: 'L3 /health', result: 'fail', detail: `${url} 无法连接: ${e.message}` });
    return layers;
  }
  if (r.code >= 300 && r.code < 400) {
    layers.push({ layer: 'L3 /health', result: 'fail', detail: `HTTP ${r.code} 重定向到 ${r.location || '?'}(没路由到服务,疑似未部署/listener 缺失)` });
    return layers;
  }
  let d: any;
  try { d = JSON.parse(r.body || '{}'); } catch {
    layers.push({ layer: 'L3 /health', result: 'fail', detail: `HTTP ${r.code} 但非 JSON(可能不是 optima-core /health): ${JSON.stringify(r.body.slice(0, 80))}` });
    return layers;
  }

  const status = d.status ?? '?';
  if (status === 'healthy') layers.push({ layer: 'L3 /health', result: 'ok', detail: `HTTP ${r.code} status=healthy svc=${d.service ?? '?'} ver=${d.version ?? '?'}` });
  else if (['ok', 'up', 'pass'].includes(status)) layers.push({ layer: 'L3 /health', result: 'warn', detail: `HTTP ${r.code} status=${status}(存活,但非 optima-core 标准 health,L4/L5 无从验证)` });
  else if (status === 'degraded') layers.push({ layer: 'L3 /health', result: 'warn', detail: `HTTP ${r.code} status=degraded(Py:部分依赖挂但服务起着,见 L5)` });
  else layers.push({ layer: 'L3 /health', result: 'fail', detail: `HTTP ${r.code} status=${status}` });

  // L4 真部署 / 非裸起
  const commit: string = d.gitCommit || d.git_commit || '';
  const branch: string = d.gitBranch || '';
  const bt = `commit=${commit || '∅'}` + (branch ? ` branch=${branch}` : '');
  if (!commit) layers.push({ layer: 'L4 部署', result: 'warn', detail: '无 gitCommit(没用 optima-core health,或 build-info 没烘进去)' });
  else if (expect) {
    const short = expect.slice(0, commit.length);
    layers.push(commit === short
      ? { layer: 'L4 部署', result: 'ok', detail: `${bt} == 期望 ${short} ✓ 跑的是这次镜像` }
      : { layer: 'L4 部署', result: 'fail', detail: `${bt} != 期望 ${short} ✗ 旧镜像/部署没生效` });
  } else layers.push({ layer: 'L4 部署', result: 'ok', detail: `${bt}(未传 --expect-commit,仅展示)` });

  // L5 依赖 checks 全绿
  const checks: Record<string, any> = d.checks || {};
  const keys = Object.keys(checks);
  if (keys.length === 0) layers.push({ layer: 'L5 依赖', result: 'warn', detail: 'health 未注册任何 checks(服务没在 handler 里挂 DB/Redis/上游)' });
  else {
    const bad = keys.filter((k) => checks[k].status !== 'healthy');
    const summary = keys.map((k) => `${k}=${checks[k].status}(${checks[k].latencyMs ?? checks[k].latency_ms ?? '?'}ms)`).join(', ');
    layers.push(bad.length
      ? { layer: 'L5 依赖', result: 'fail', detail: `${bad.length} 个不健康: ${bad.map((k) => `${k}=${checks[k].status}`).join(',')} | 全部: ${summary}` }
      : { layer: 'L5 依赖', result: 'ok', detail: `${keys.length} 个依赖全绿: ${summary}` });
  }
  return layers;
}

function resolve(svc: string, e: Env): [string, string, string] | null {
  const cfg = SERVICES[svc];
  const host = cfg[e];
  if (!host) return null;
  const path = (cfg as any)[`${e}_path`] || cfg.path;
  return [`${svc} [${e}]`, host, path];
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f: string) => argv.includes(f);
  const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const asJson = has('--json'), strict = has('--strict');
  const expect = val('--expect-commit');
  // 🔴 必须先校验再转型：不校验的话任何不认识的 env 都会让 resolve() 把每个 SvcCfg 键查成
  // undefined，于是落到下面的「无目标」分支，把「环境名打错」报成「该服务无部署」——
  // 一个活着的服务被说成没上线，正是 #83 要根治的那类静默误报。
  let envArg = val('--env') || 'cn-prod';
  // 'cn' 是本文件的历史叫法，继续放行但不在 usage 里宣传（同 query-db.ts 的 ENV_ALIASES）。
  if (envArg === 'cn') envArg = 'cn-prod';
  if (envArg !== 'all' && !ENVS.includes(envArg as Env)) {
    console.error(`❌ 未知环境:${envArg}(可选:${ENVS.join(' | ')} | all)`);
    process.exit(2);
  }
  const env = envArg as Env | 'all';
  const envs: Env[] = env === 'all' ? ENVS : [env as Env];
  const positional = argv.filter((x, i) => !x.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && ['--env', '--expect-commit', '--url'].includes(argv[i - 1])));

  let targets: [string, string, string][] = [];
  if (has('--url')) {
    const u = new URL(val('--url')!);
    targets = [[u.hostname, u.hostname, u.pathname || '/health']];
  } else if (has('--all')) {
    for (const e of envs) for (const s of Object.keys(SERVICES)) { const t = resolve(s, e); if (t) targets.push(t); }
  } else if (positional[0] && SERVICES[positional[0]]) {
    for (const e of envs) { const t = resolve(positional[0], e); if (t) targets.push(t); }
  } else {
    console.log((require('fs').readFileSync(__filename, 'utf-8').match(/\/\*\*[\s\S]*?\*\//)?.[0] || '').replace(/^\s*\*?/gm, ''));
    process.exit(2);
  }
  if (targets.length === 0) { console.log(`(无目标:${env} 环境下该服务无部署)`); process.exit(2); }

  const results: any[] = [];
  let worstOk = true;
  for (const [name, host, path] of targets) {
    const layers = await probe(host, path, expect);
    const v = verdict(layers);
    if (v === 'fail' || (strict && v === 'warn')) worstOk = false;
    if (asJson) results.push({ service: name, url: `https://${host}${path}`, verdict: v, layers });
    else {
      console.log(`\n${'='.repeat(60)}\n  ${name}  https://${host}${path}\n${'='.repeat(60)}`);
      for (const l of layers) console.log(`  ${MARK[l.result] || '?'} ${l.layer.padEnd(11)} ${l.detail}`);
      console.log(`  ${'—'.repeat(56)}\n  ${'结论'.padEnd(10)} ${VTXT[v]}`);
    }
  }
  if (asJson) console.log(JSON.stringify(results, null, 2));
  // 用 exitCode 而非 process.exit():后者会在管道(--json | jq)未 flush 完就退出而截断输出
  process.exitCode = worstOk ? 0 : 1;
}

main();
