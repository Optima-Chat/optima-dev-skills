/**
 * tf#452(Optima-Chat/optima-terraform#452):Codeup 镜像同步用的 GitHub 凭证 = 只读 GitHub App 现换的 installation token。
 *
 * 以前 cn-deploy 每次 `gh auth token` 把运行人本机 gh 的登录令牌(全权限 gho_)交给 Codeup,违反「个人登录令牌不交给第三方存储」。
 * 现在:App 私钥 → JWT(RS256)→ POST /app/installations/{id}/access_tokens,令牌只含 contents:read、只含目标仓、1 小时过期。
 * ⛔ 取不到就报错退出,绝不回落到 `gh auth token`。
 *
 * 凭证来源(按优先级):
 *   - 私钥:CODEUP_MIRROR_APP_PRIVATE_KEY(PEM 内容)/ CODEUP_MIRROR_APP_PRIVATE_KEY_FILE(路径)/ 1P 文档 github-app-codeup-mirror.pem
 *   - App ID:CODEUP_MIRROR_APP_ID / 1P 条目「GitHub App optima-chat-codeup-mirror (tf#452)」的 APP_ID
 *   - 1P 走 `op`(可用 OP 覆盖路径,WSL 下指向 op.exe;桌面授权框要点),vault 默认 Optima(OP_VAULT 覆盖)
 */
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';

export const APP_ITEM = 'GitHub App optima-chat-codeup-mirror (tf#452)';
export const PEM_DOC = 'github-app-codeup-mirror.pem';
const ORG = 'Optima-Chat';

export type HttpCall = (method: string, path: string, bearer: string, body?: string) => Promise<{ status: number; json: any }>;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** GitHub App JWT:iat 回拨 60s 防时钟漂移,exp 9 分钟(上限 10)。 */
export function appJwt(appId: string, pem: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: appId }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(pem);
  return `${head}.${body}.${b64url(sig)}`;
}

const githubApi: HttpCall = (method, path, bearer, body) => new Promise((resolve, reject) => {
  const req = httpsRequest({
    host: 'api.github.com', path, method,
    headers: {
      Authorization: `Bearer ${bearer}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'optima-cn-deploy', ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
  }, (res) => {
    let raw = '';
    res.on('data', (c) => { raw += c; });
    res.on('end', () => { let json: any = null; try { json = JSON.parse(raw); } catch { /* 非 JSON */ } resolve({ status: res.statusCode || 0, json }); });
  });
  req.on('error', reject);
  req.setTimeout(30_000, () => req.destroy(new Error('GitHub API 超时')));
  if (body) req.write(body);
  req.end();
});

function op(args: string[]): string {
  const bin = process.env.OP || 'op';
  try {
    return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r/g, '').trim();
  } catch {
    return '';
  }
}

export interface CredSource { appId: string; pem: string; }

export function loadAppCred(env: NodeJS.ProcessEnv = process.env, opRead: (args: string[]) => string = op): CredSource {
  const vault = env.OP_VAULT || 'Optima';
  const pem = env.CODEUP_MIRROR_APP_PRIVATE_KEY
    || (env.CODEUP_MIRROR_APP_PRIVATE_KEY_FILE ? readFileSync(env.CODEUP_MIRROR_APP_PRIVATE_KEY_FILE, 'utf8') : '')
    || opRead(['document', 'get', PEM_DOC, '--vault', vault]);
  const appId = env.CODEUP_MIRROR_APP_ID || opRead(['item', 'get', APP_ITEM, '--vault', vault, '--fields', 'label=APP_ID']);
  if (!pem.includes('PRIVATE KEY-----') || !/^\d+$/.test(appId)) {
    throw new Error('拿不到 Codeup 镜像 App 的私钥 / APP_ID(tf#452):设 CODEUP_MIRROR_APP_PRIVATE_KEY(_FILE) + CODEUP_MIRROR_APP_ID,'
      + '或装好 1Password CLI(op)并点掉授权框。⛔ 不会回落到 gh auth token');
  }
  return { appId, pem };
}

/** 换一枚只含 repo、只读、1 小时过期的 installation token(ghs_)。 */
export async function mintCodeupMirrorToken(repo: string, cred: CredSource = loadAppCred(), call: HttpCall = githubApi): Promise<string> {
  const jwt = appJwt(cred.appId, cred.pem);
  const inst = await call('GET', `/orgs/${ORG}/installation`, jwt);
  if (inst.status !== 200 || !inst.json?.id) throw new Error(`查 App 在 ${ORG} 的安装失败(HTTP ${inst.status});App 装了吗?`);
  const tok = await call('POST', `/app/installations/${inst.json.id}/access_tokens`, jwt,
    JSON.stringify({ repositories: [repo], permissions: { contents: 'read', metadata: 'read' } }));
  const t = tok.json?.token;
  if (tok.status !== 201 || typeof t !== 'string' || !t.startsWith('ghs_')) {
    throw new Error(`换 installation token 失败(HTTP ${tok.status});App 装在 ${repo} 上了吗?`);
  }
  return t;
}
