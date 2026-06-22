#!/usr/bin/env node
/**
 * optima-logs —— 一条命令直取服务日志,四环境统一,用 --env 区分。
 *
 *   stage / prod     : AWS CloudWatch(`aws logs tail /ecs/<svc>-<env>`)
 *   cn-prod / cn-stage: 阿里云 SLS 直连(`aliyun sls GetLogs`)
 *
 * cn 的关键改进:旧流程要 SSH 进 buildbox 再调 SAE `DescribeInstanceLog`,
 * 只能看实例**当前缓冲**(重启即丢、不能检索)。现在 cn-prod/cn-stage 全部
 * 服务已接 SLS,GetLogs 是公网控制面 API,本机 aliyun CLI 凭证直连即可:
 *   - 免 buildbox 跳板
 *   - 支持时间窗(--since)+ 关键词检索(--grep)+ 历史(重启不丢)
 *
 * 前置:
 *   AWS  → 已配 aws CLI 凭证(ap-southeast-1)
 *   cn   → 已配 aliyun CLI 凭证(cn-beijing)。默认用本机当前 profile(与 AWS 侧
 *          不指定 profile 对称);要指定别的 profile 设 OPTIMA_ALIYUN_PROFILE=<名>。
 *
 * 用法:
 *   optima-logs gateway-core                       # 默认 cn-prod,最近 1h,100 行
 *   optima-logs gateway-core --env cn-stage
 *   optima-logs user-auth --env prod --since 2h
 *   optima-logs commerce-backend --grep error -n 200
 *   optima-logs gateway-core --since 30m --json     # 机器可读
 *
 * service == SLS logstore == AWS 日志组 `/ecs/<svc>-<env>` 的 <svc>(同名)。
 */
import { execFileSync } from 'child_process';

const ALIYUN_ACCOUNT = '1911493506120573';
// 不硬编码 profile 名:默认空 → 不传 --profile,用本机 aliyun CLI 当前 profile
// (与 AWS 侧 fetchAws 不指定 profile 对称)。设 OPTIMA_ALIYUN_PROFILE 可显式指定。
const ALIYUN_PROFILE = process.env.OPTIMA_ALIYUN_PROFILE ?? '';
const ALIYUN_REGION = 'cn-beijing';
const AWS_REGION = 'ap-southeast-1';

const AWS_ENVS = ['stage', 'prod'] as const;
const CN_ENVS = ['cn-prod', 'cn-stage'] as const;
type Env = (typeof AWS_ENVS)[number] | (typeof CN_ENVS)[number];
const ALL_ENVS: Env[] = [...AWS_ENVS, ...CN_ENVS];

const C = { g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m', d: '\x1b[2m', n: '\x1b[0m' };

interface Args {
  service: string;
  env: Env;
  lines: number;
  since: string; // 原样字符串,如 1h / 30m / 2d
  grep?: string;
  json: boolean;
}

const HELP = `Usage: optima-logs <service> [options]

四环境统一查日志,cn 直连阿里云 SLS(免 buildbox),AWS 走 CloudWatch。

Required:
  <service>                服务名(== SLS logstore == /ecs/<svc>-<env> 的 <svc>)

Optional:
  --env <e>                stage | prod | cn-prod | cn-stage   (default: cn-prod)
  --lines, -n <N>          返回行数                            (default: 100)
  --since <dur>            时间窗,如 30m / 2h / 1d / 3600(秒)  (default: 1h)
  --grep <kw>              关键词检索(cn=SLS query / aws=filter-pattern)
  --json                   原始 JSON 输出(接管道)
  --help, -h               显示本帮助

Examples:
  optima-logs gateway-core
  optima-logs user-auth --env prod --since 2h
  optima-logs commerce-backend --env cn-prod --grep error -n 200`;

/** 把 30m / 2h / 1d / 纯秒 解析成秒数;同时回填给 aws 用的带单位字符串。 */
function parseSince(raw: string): { sec: number; awsStr: string } {
  const m = raw.match(/^(\d+)([smhdw]?)$/);
  if (!m) throw new Error(`--since 格式非法: ${raw}(用 30m / 2h / 1d / 纯秒)`);
  const n = parseInt(m[1], 10);
  const unit = m[2] || 's';
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return { sec: n * mult[unit], awsStr: `${n}${unit}` };
}

function parseArgs(argv: string[]): Args {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(HELP);
    process.exit(0);
  }
  const out: Partial<Args> = { env: 'cn-prod', lines: 100, since: '1h', json: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--env': out.env = next as Env; i++; break;
      case '--lines': case '-n': {
        const v = parseInt(next, 10);
        if (isNaN(v) || v <= 0) throw new Error('--lines 需要正整数');
        out.lines = v; i++; break;
      }
      case '--since': out.since = next; i++; break;
      case '--grep': out.grep = next; i++; break;
      case '--json': out.json = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`未知参数: ${a}`);
        positional.push(a);
    }
  }
  if (positional.length === 0) throw new Error('缺少 <service>(见 --help)');
  if (positional.length > 1) throw new Error(`多余参数: ${positional.slice(1).join(' ')}`);
  out.service = positional[0];
  if (!ALL_ENVS.includes(out.env as Env)) {
    throw new Error(`--env 非法: ${out.env}(可选 ${ALL_ENVS.join(' | ')})`);
  }
  return out as Args;
}

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024 });
}

/** AWS CloudWatch:aws logs tail /ecs/<svc>-<env>。 */
function fetchAws(args: Args): void {
  const group = `/ecs/${args.service}-${args.env}`;
  const { awsStr } = parseSince(args.since);
  const cmd = ['logs', 'tail', group, '--since', awsStr, '--region', AWS_REGION, '--format', args.json ? 'json' : 'short'];
  if (args.grep) cmd.push('--filter-pattern', args.grep);
  process.stderr.write(`${C.d}# AWS CloudWatch ${group} (since ${awsStr}${args.grep ? `, grep "${args.grep}"` : ''})${C.n}\n`);
  try {
    process.stdout.write(run('aws', cmd));
  } catch (e: any) {
    if (/ResourceNotFoundException/.test(e.stderr || e.message || '')) {
      throw new Error(`日志组不存在: ${group}\n  确认服务名/环境对,或该服务未部署在 ${args.env}。`);
    }
    throw new Error(e.stderr || e.message);
  }
}

/** 阿里云 SLS:aliyun sls GetLogs,project=optima-<env>-<account>,logstore=service。 */
function fetchCn(args: Args): void {
  const project = `optima-${args.env}-${ALIYUN_ACCOUNT}`;
  const { sec } = parseSince(args.since);
  const now = Math.floor(Date.now() / 1000);
  const from = now - sec;
  const cmd = [
    'sls', 'GetLogs',
    '--project', project,
    '--logstore', args.service,
    '--from', String(from),
    '--to', String(now),
    '--line', String(args.lines),
    '--reverse', 'true', // 先拿最新 N 条
    '--region', ALIYUN_REGION,
  ];
  if (ALIYUN_PROFILE) cmd.push('--profile', ALIYUN_PROFILE); // 未设则用本机当前 profile
  if (args.grep) { cmd.push('--query', args.grep); }
  process.stderr.write(`${C.d}# 阿里云 SLS ${project}/${args.service} (since ${args.since}${args.grep ? `, query "${args.grep}"` : ''})${C.n}\n`);

  let raw: string;
  try {
    raw = run('aliyun', cmd);
  } catch (e: any) {
    const msg = e.stderr || e.message || '';
    const profileFlag = ALIYUN_PROFILE ? ` --profile ${ALIYUN_PROFILE}` : '';
    if (/unknown profile|Configuration failed|InvalidAccessKeyId|Forbidden|Unauthorized|Signature/i.test(msg)) {
      throw new Error(`aliyun 凭证不可用: ${msg.split('\n')[0]}\n  cn 日志需本机配好 cn-beijing 的 aliyun CLI 凭证(账号需有 SLS 读权限)。\n  默认用当前 profile;或设 OPTIMA_ALIYUN_PROFILE=<你的profile>。`);
    }
    if (/LogStoreNotExist|ProjectNotExist/.test(msg)) {
      throw new Error(`SLS logstore 不存在: ${project}/${args.service}\n  确认服务名对,或该服务未接 SLS。列全部:\n  aliyun sls ListLogStores --project ${project} --region ${ALIYUN_REGION}${profileFlag}`);
    }
    throw new Error(msg);
  }

  const rows: Array<Record<string, string>> = JSON.parse(raw || '[]');
  // reverse=true 取到的是新→旧,翻回旧→新便于阅读
  rows.reverse();
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    process.stderr.write(`${C.y}(无日志:该时间窗内 ${args.service} 无输出,或 --grep 没命中)${C.n}\n`);
    return;
  }
  for (const r of rows) {
    // SLS 存的 content 已含容器时间戳 + stream(stdout/stderr)前缀,直接打印即可
    process.stdout.write((r.content ?? JSON.stringify(r)) + '\n');
  }
}

function main(): void {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e: any) {
    console.error(`${C.y}✗ ${e.message}${C.n}`);
    process.exit(1);
  }
  try {
    if (CN_ENVS.includes(args.env as any)) fetchCn(args);
    else fetchAws(args);
  } catch (e: any) {
    console.error(`${C.y}✗ ${e.message}${C.n}`);
    process.exit(1);
  }
}

main();
