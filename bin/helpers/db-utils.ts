import { execSync, execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

// ─── Types ──────────────────────────────────────────────────────────────────
export interface InfisicalConfig { url: string; clientId: string; clientSecret: string; projectId: string }

export interface DBConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────
export const RDS_HOSTS: Record<string, string> = {
  stage: 'optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com',
  prod:  'optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com',
};

// Shared bastion (optima-bi-data EC2, shared-services stack). Reached via SSM —
// no public port 22 dependency, so it is immune to the MaxStartups throttling that
// the open-to-world sshd suffers under internet scan load. SSH path kept as fallback.
const AWS_REGION = 'ap-southeast-1';
const BASTION_INSTANCE_ID = 'i-03286fb0a9ce7e6b1';
const EC2_HOST = '3.0.210.113';

// ─── cn-prod (阿里云) 常量 ────────────────────────────────────────────────────
// cn-prod 跑在阿里云 SAE，与海外 AWS 完全独立：独立 Infisical (secrets-cn.optima.chat)
// + 内网 RDS（无公网端点）经 buildbox ECS 跳板 SSH 隧道访问。设计见 optima-dev-skills#21。
const CN_INFISICAL_URL     = process.env.INFISICAL_CN_URL     || 'https://secrets-cn.optima.chat';
const CN_INFISICAL_ORG     = process.env.INFISICAL_CN_ORG     || 'f44012fa-0659-4f7e-b0ac-ed01244efc8a';
const CN_INFISICAL_PROJECT = process.env.INFISICAL_CN_PROJECT || '4deef229-11be-40a5-8f56-b61f0bce7240';
const CN_RDS_HOST          = 'pgm-2zexwx9eso9e4yla.pg.rds.aliyuncs.com';
const CN_BUILDBOX_HOST     = process.env.OPTIMA_CN_BUILDBOX_HOST || '47.94.105.163';

/** env 是否指向 cn-prod（阿里云）。接受 `cn` / `cn-prod`。 */
export function isCnEnv(env: string): boolean {
  return env === 'cn' || env === 'cn-prod';
}

// ─── SQL escaping ───────────────────────────────────────────────────────────
/** Escape a string value for safe inclusion in SQL single-quoted literals. */
export function escapeSQL(value: string): string {
  return value.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

// ─── GitHub Variables ───────────────────────────────────────────────────────
export function getGitHubVariable(name: string): string {
  // `gh variable` has no `get` subcommand (only list/set/delete); read the value via the REST variables endpoint.
  return execSync(`gh api repos/Optima-Chat/optima-dev-skills/actions/variables/${name} --jq .value`, { encoding: 'utf-8' }).trim();
}

// ─── Infisical ──────────────────────────────────────────────────────────────
export function getInfisicalConfig(): InfisicalConfig {
  return {
    url: getGitHubVariable('INFISICAL_URL'),
    clientId: getGitHubVariable('INFISICAL_CLIENT_ID'),
    clientSecret: getGitHubVariable('INFISICAL_CLIENT_SECRET'),
    projectId: getGitHubVariable('INFISICAL_PROJECT_ID'),
  };
}

export function getInfisicalToken(config: InfisicalConfig): string {
  const response = execSync(
    `curl -s -X POST "${config.url}/api/v1/auth/universal-auth/login" -H "Content-Type: application/json" -d '{"clientId": "${config.clientId}", "clientSecret": "${config.clientSecret}"}'`,
    { encoding: 'utf-8' }
  );
  return JSON.parse(response).accessToken;
}

export function getInfisicalSecrets(config: InfisicalConfig, token: string, environment: string, secretPath: string): Record<string, string> {
  const response = execSync(
    `curl -s "${config.url}/api/v3/secrets/raw?workspaceId=${config.projectId}&environment=${environment}&secretPath=${secretPath}" -H "Authorization: Bearer ${token}"`,
    { encoding: 'utf-8' }
  );
  const data = JSON.parse(response);
  const secrets: Record<string, string> = {};
  for (const secret of data.secrets || []) {
    secrets[secret.secretKey] = secret.secretValue;
  }
  return secrets;
}

// ─── cn Infisical（独立实例，admin email/password 认证）──────────────────────
/** curl → JSON，用 execFileSync 传参（避免 shell 引号坑，跨平台安全）。 */
function curlJson(args: string[]): any {
  const out = execFileSync('curl', ['-s', ...args], { encoding: 'utf-8' });
  try { return JSON.parse(out || '{}'); }
  catch { throw new Error(`cn Infisical: non-JSON response: ${String(out).slice(0, 200)}`); }
}

/**
 * 认证 cn Infisical（admin email/password → org-scoped token）。
 * ⚠️ 字段名坑：login 返回 `accessToken`（不是 token），select-organization 才返回 `token`。
 */
export function getCnInfisicalToken(): string {
  const email = process.env.INFISICAL_CN_EMAIL;
  const password = process.env.INFISICAL_CN_PASSWORD;
  if (!email || !password) {
    throw new Error('cn Infisical 需要 INFISICAL_CN_EMAIL + INFISICAL_CN_PASSWORD 环境变量（admin user，1P "Infisical cn-prod admin (secrets-cn.optima.chat)"）。见 optima-dev-skills#21。');
  }
  const login = curlJson([
    '-X', 'POST', `${CN_INFISICAL_URL}/api/v3/auth/login`,
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({ email, password }),
  ]);
  if (!login.accessToken) throw new Error(`cn Infisical login 失败: ${JSON.stringify(login).slice(0, 200)}`);
  const org = curlJson([
    '-X', 'POST', `${CN_INFISICAL_URL}/api/v3/auth/select-organization`,
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${login.accessToken}`,
    '-d', JSON.stringify({ organizationId: CN_INFISICAL_ORG }),
  ]);
  if (!org.token) throw new Error(`cn Infisical select-organization 失败: ${JSON.stringify(org).slice(0, 200)}`);
  return org.token;
}

/** 读 cn Infisical 某 folder（prod env）→ key→value map。expand=true 让服务端解析 `${...}` 引用。 */
export function getCnSecrets(token: string, secretPath: string, expand = false): Record<string, string> {
  const data = curlJson([
    `${CN_INFISICAL_URL}/api/v3/secrets/raw?workspaceId=${CN_INFISICAL_PROJECT}&environment=prod&secretPath=${encodeURIComponent(secretPath)}&expandSecretReferences=${expand}`,
    '-H', `Authorization: Bearer ${token}`,
  ]);
  const secrets: Record<string, string> = {};
  for (const s of data.secrets || []) secrets[s.secretKey] = s.secretValue;
  return secrets;
}

// ─── Database URL parsing ───────────────────────────────────────────────────
/** decodeURIComponent，但密码未做 URL 编码、含裸 % 时不炸：原样返回。 */
function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * 解析 DATABASE_URL。不用正则一把抓：userinfo 从 authority 的**最后一个 @** 右切，
 * 密码含 @ * + $ 等特殊字符也不会把密码段误并进 host（曾导致隧道目标变成
 * `密码片段@pgm-xxx` 且把密码打进 console）。容忍驱动后缀（postgresql+asyncpg://）。
 * ⚠️ 所有错误信息不回显 URL 本身 —— DATABASE_URL 含凭证，不能进日志。
 */
export function parseDatabaseUrl(url: string): { user: string; password: string; host: string; port: number; database: string } {
  const fail = (why: string): never => {
    throw new Error(`Failed to parse DATABASE_URL (${why}; format: postgresql://user:pass@host:port/db)`);
  };
  const scheme = url.match(/^postgres(?:ql)?(?:\+\w+)?:\/\//);
  if (!scheme) fail('unsupported scheme');
  const rest = url.slice(scheme![0].length);
  const slash = rest.indexOf('/');
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const at = authority.lastIndexOf('@');
  if (at === -1) fail('missing user:pass@');
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  if (colon === -1) fail('missing password in userinfo');
  // host 只允许域名字符 —— 解析错位时密码片段会落到这里，fail-closed 别让它流向隧道命令/日志
  const hostport = authority.slice(at + 1).match(/^([A-Za-z0-9.-]+)(?::(\d+))?$/);
  if (!hostport) fail('invalid host:port');
  const database = slash === -1 ? '' : rest.slice(slash + 1).split('?')[0];
  if (!database) fail('missing database name');
  return {
    user: safeDecode(userinfo.slice(0, colon)),
    password: safeDecode(userinfo.slice(colon + 1)),
    host: hostport![1],
    port: hostport![2] ? parseInt(hostport![2], 10) : 5432,
    database,
  };
}

// ─── SSH tunnel ─────────────────────────────────────────────────────────────
// 端口被占不等于 tunnel 还能转发：AWS bastion idle 断连后，本地 ssh 进程还活着、
// 端口还 LISTEN，但流量过不去，所有后续查询会 hang 到客户端 timeout。
// 用 pg_isready 真去 ping postgres，超时就当 zombie，杀掉重建。
function isTunnelHealthy(localPort: number): boolean {
  try {
    execSync(`pg_isready -h localhost -p ${localPort} -t 3 -q`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function portPids(localPort: number): string[] {
  try {
    return execSync(`lsof -ti:${localPort}`, { encoding: 'utf-8' }).trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

// lsof 只能看到「有进程 bind」的端口。Docker 发布端口走 iptables DNAT 时主机上
// 没有进程绑定（lsof 空），但流量照样被内核截给容器 —— 在这种端口上建隧道，
// psql 连的还是容器里的库。所以空闲判定必须用客户端视角：真去 connect，有人
// 应答（无论进程还是 DNAT）就算被占。
function isPortResponding(localPort: number): boolean {
  try {
    // 单条命令：connect 失败 bash 即 exit 非 0（再跟一条命令会把退出码盖掉）；
    // fd 随 bash 进程退出自动关闭。
    execSync(`bash -c 'exec 3<>/dev/tcp/127.0.0.1/${localPort}'`, { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// 端口被占 ≠ 是我们的隧道：本机 Docker PG 也会监听这些端口，且对 pg_isready
// 完全健康 —— 曾把 prod 凭证发给本机 15433 上的 Docker PG，报「密码错误」。
// 判别器 = 占用进程的 comm：ssh（legacy 隧道）或 session-manager-plugin（SSM）。
function isTunnelProcessOnPort(localPort: number): boolean {
  return portPids(localPort).some(pid => {
    try {
      const comm = execSync(`ps -o comm= -p ${pid}`, { encoding: 'utf-8' }).trim();
      return comm === 'ssh' || comm.includes('session-manager');
    } catch {
      return false;
    }
  });
}

function killOrphanTunnel(localPort: number): void {
  // 只杀我们的隧道进程 —— 端口上若是别人（docker-proxy/postgres），kill -9 是破坏性的。
  for (const pid of portPids(localPort)) {
    try {
      const comm = execSync(`ps -o comm= -p ${pid}`, { encoding: 'utf-8' }).trim();
      if (comm === 'ssh' || comm.includes('session-manager')) execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    } catch { /* already gone */ }
  }
}

function setupSSHTunnel(dbHost: string, localPort: number): void {
  const sshKeyPath = `${process.env.HOME}/.ssh/optima-ec2-key`;
  if (!fs.existsSync(sshKeyPath)) throw new Error(`SSH key not found: ${sshKeyPath}. Please obtain optima-ec2-key from xbfool.`);
  console.log(`Creating SSH tunnel: localhost:${localPort} -> ${EC2_HOST} -> ${dbHost}:5432`);
  // ServerAliveInterval/CountMax: 服务端 30s 没回应就让 ssh 自己退出（不留 zombie）
  // ExitOnForwardFailure: 端口绑定失败立刻退出（不会黑悄悄继续跑）
  // ConnectTimeout: 10s 不通就放弃（业界 ssh 默认 120s 太宽）
  execSync(
    `ssh -i ${sshKeyPath} -f -N -o StrictHostKeyChecking=no ` +
    `-o ServerAliveInterval=30 -o ServerAliveCountMax=3 ` +
    `-o ExitOnForwardFailure=yes -o ConnectTimeout=10 ` +
    `-L ${localPort}:${dbHost}:5432 ec2-user@${EC2_HOST}`,
    { stdio: 'inherit' }
  );
}

/** Block the current (sync) call for `ms` without spawning a subprocess. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function assertSSMPrereqs(): void {
  for (const [bin, hint] of [
    ['session-manager-plugin', 'https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html'],
    ['aws', 'AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html'],
  ] as const) {
    try { execSync(`command -v ${bin}`, { stdio: 'ignore' }); }
    catch { throw new Error(`${bin} not found — required for the SSM DB tunnel. Install: ${hint}\n(or set OPTIMA_DB_TUNNEL=ssh to fall back to the legacy SSH tunnel)`); }
  }
}

/**
 * Open a local→RDS tunnel through the shared bastion using SSM port forwarding.
 * No public SSH port is touched. A healthy existing tunnel on the port is reused
 * (the ~2s SSM cold start is paid once, then every query is just a round-trip).
 */
function setupSSMTunnel(dbHost: string, localPort: number): void {
  assertSSMPrereqs();
  console.log(`Creating SSM tunnel: localhost:${localPort} -> ${BASTION_INSTANCE_ID} -> ${dbHost}:5432`);

  const logFile = `${os.tmpdir()}/optima-ssm-tunnel-${localPort}.log`;
  const out = fs.openSync(logFile, 'w');
  const child = spawn('aws', [
    'ssm', 'start-session',
    '--region', AWS_REGION,
    '--target', BASTION_INSTANCE_ID,
    '--document-name', 'AWS-StartPortForwardingSessionToRemoteHost',
    '--parameters', `host=${dbHost},portNumber=5432,localPortNumber=${localPort}`,
  ], { detached: true, stdio: ['ignore', out, out] });
  child.unref();

  // Wait until the remote leg actually forwards (pg_isready probes RDS through the
  // tunnel). Local port binds instantly; the remote hop needs ~1-2s to come up.
  const deadlineMs = Date.now() + 20000;
  while (Date.now() < deadlineMs) {
    if (isTunnelHealthy(localPort)) { console.log(`✓ SSM tunnel ready on port ${localPort}`); return; }
    sleepSync(500);
  }

  let tail = '(no log)';
  try { tail = fs.readFileSync(logFile, 'utf-8').split('\n').slice(-8).join('\n'); } catch { /* ignore */ }
  throw new Error(`SSM tunnel on port ${localPort} did not become ready within 20s.\n--- ${logFile} ---\n${tail}`);
}

/**
 * 隧道 localhost:localPort → cn 内网 RDS，经 buildbox ECS 跳板（sshpass SSH）。
 * 密码经 SSHPASS 环境变量传给 `sshpass -e`：不进命令行（ps 不可见）、不经 shell 引号展开。
 */
function setupCnSSHTunnel(dbHost: string, localPort: number): void {
  const pw = process.env.OPTIMA_CN_BUILDBOX_PASSWORD;
  if (!pw) throw new Error('cn DB 隧道需要 OPTIMA_CN_BUILDBOX_PASSWORD 环境变量（buildbox root 密码，1P "Aliyun cn-prod buildbox ECS (root)"）。见 optima-dev-skills#21。');
  try { execSync('command -v sshpass', { stdio: 'ignore' }); }
  catch { throw new Error('sshpass not found — cn buildbox 隧道需要（apt install sshpass / brew install esolitos/ipa/sshpass）。Windows 用 WSL。'); }

  console.log(`Creating cn tunnel: localhost:${localPort} -> buildbox ${CN_BUILDBOX_HOST} -> ${dbHost}:5432`);
  execSync(
    `sshpass -e ssh -f -N -o StrictHostKeyChecking=no ` +
    `-o ServerAliveInterval=30 -o ServerAliveCountMax=3 ` +
    `-o ExitOnForwardFailure=yes -o ConnectTimeout=12 ` +
    `-L ${localPort}:${dbHost}:5432 root@${CN_BUILDBOX_HOST}`,
    { stdio: 'inherit', env: { ...process.env, SSHPASS: pw } }
  );

  const deadlineMs = Date.now() + 20000;
  while (Date.now() < deadlineMs) {
    if (isTunnelHealthy(localPort)) { console.log(`✓ cn tunnel ready on port ${localPort}`); return; }
    sleepSync(500);
  }
  throw new Error(`cn tunnel on port ${localPort} did not become ready within 20s`);
}

// ─── Tunnel port registry ───────────────────────────────────────────────────
// 端口动态分配：固定端口（旧 15432-15435）会撞本机服务（Docker PG 占 15433 →
// prod 凭证发给错误的库报「密码错误」）。每个 RDS host 一条隧道，实际端口记在
// 注册文件里，复用前验证「端口上确实是我们的隧道进程且健康」。
const TUNNEL_REGISTRY = `${os.homedir()}/.cache/optima-dev-skills/tunnel-ports.json`;
// 基址刻意避开 1543x/543x：本机 Docker PG 常映射在那一带，DNAT 端口即使我们的
// 隧道进程 bind 成功，OUTPUT 链的 DNAT 仍会把 127.0.0.1 流量截给容器（实测），
// 复用判定无法从外部区分 —— 离它远点是最便宜的防线。
const TUNNEL_PORT_SCAN_BASE = 25432;
const TUNNEL_PORT_SCAN_LIMIT = 100;

function readTunnelRegistry(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(TUNNEL_REGISTRY, 'utf-8'));
  } catch {
    return {};
  }
}

function writeTunnelRegistry(reg: Record<string, number>): void {
  // 注册文件非并发安全（全量覆盖、无锁）：并发 CLI 进程可能互相覆盖记录或抢同
  // 一空闲端口。后果 fail-closed（多建一条隧道 / 第二个 bind 失败报错重试），
  // 对单人运维 CLI 可接受，不为此引入锁。
  fs.mkdirSync(`${os.homedir()}/.cache/optima-dev-skills`, { recursive: true });
  fs.writeFileSync(TUNNEL_REGISTRY, JSON.stringify(reg, null, 2));
}

/** First free local port, preferring the registry's previous assignment. */
function pickTunnelPort(preferred?: number): number {
  const candidates = preferred ? [preferred] : [];
  for (let p = TUNNEL_PORT_SCAN_BASE; p < TUNNEL_PORT_SCAN_BASE + TUNNEL_PORT_SCAN_LIMIT; p++) {
    if (p !== preferred) candidates.push(p);
  }
  for (const p of candidates) {
    if (portPids(p).length === 0 && !isPortResponding(p)) return p;
  }
  throw new Error(`No free local port in ${TUNNEL_PORT_SCAN_BASE}-${TUNNEL_PORT_SCAN_BASE + TUNNEL_PORT_SCAN_LIMIT - 1} for the DB tunnel`);
}

/**
 * Ensure a local→RDS tunnel to `dbHost` exists and return its local port.
 * One tunnel per RDS host (auth/billing on the same instance share it) —
 * registry 按 dbHost 记端口，换库自然换隧道，不存在「端口被占就当同一条」的错配。
 * AWS defaults to SSM (no public port 22; set OPTIMA_DB_TUNNEL=ssh for legacy SSH);
 * `via: 'cn-buildbox'` 走阿里云 buildbox ECS 跳板（cn 内网 RDS 无公网端点）。
 */
export function ensureTunnel(dbHost: string, via: 'aws' | 'cn-buildbox' = 'aws'): number {
  // dbHost 可能来自解析的 DATABASE_URL，且会进 ssh 命令行/日志 —— 只放行域名字符。
  if (!/^[A-Za-z0-9.-]+$/.test(dbHost)) throw new Error('ensureTunnel: dbHost contains unexpected characters (refusing to build tunnel command)');
  const reg = readTunnelRegistry();
  const known = reg[dbHost];

  if (known !== undefined && isTunnelProcessOnPort(known)) {
    if (isTunnelHealthy(known)) return known; // warm reuse — no cold start
    console.log(`! Tunnel on port ${known} not responding (zombie), replacing...`);
    killOrphanTunnel(known);
  }

  // Foreign process on the recorded port (e.g. a local Docker PG) → pick a
  // different port instead of talking to whatever squats there.
  const port = pickTunnelPort(known);
  if (via === 'cn-buildbox') {
    setupCnSSHTunnel(dbHost, port);
  } else if ((process.env.OPTIMA_DB_TUNNEL || 'ssm').toLowerCase() === 'ssh') {
    setupSSHTunnel(dbHost, port);
  } else {
    setupSSMTunnel(dbHost, port);
  }
  reg[dbHost] = port;
  writeTunnelRegistry(reg);
  return port;
}

// ─── psql ───────────────────────────────────────────────────────────────────
function findPsqlPath(): string {
  try {
    const result = execSync('which psql', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (result.trim()) return result.trim();
  } catch { /* fallback */ }
  const paths = ['/usr/local/opt/postgresql@16/bin/psql', '/usr/local/opt/postgresql@15/bin/psql', '/opt/homebrew/bin/psql', '/usr/bin/psql', '/usr/local/bin/psql'];
  for (const p of paths) { if (fs.existsSync(p)) return p; }
  throw new Error('PostgreSQL client (psql) not found. Install with: brew install postgresql@16');
}

export function queryDB(conn: DBConnection, sql: string): string {
  const psql = findPsqlPath();
  return execSync(`"${psql}" -h ${conn.host} -p ${conn.port} -U ${conn.user} -d ${conn.database} -t -A --quiet -c "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf-8',
    env: { ...process.env, PGPASSWORD: conn.password },
  }).trim();
}

// ─── High-level connection helpers ──────────────────────────────────────────

/**
 * 连 cn-prod 某服务库：creds 取自 cn Infisical 的 /shared-secrets/database-users +
 * /database-names（按 prefix，如 AUTH/BILLING），经 buildbox 跳板隧道（动态端口）。
 */
export function connectCnDB(prefix: string): { query: (sql: string) => string } {
  const token = getCnInfisicalToken();
  const users = getCnSecrets(token, '/shared-secrets/database-users');
  const names = getCnSecrets(token, '/shared-secrets/database-names');
  const user = users[`${prefix}_DB_USER`];
  const password = users[`${prefix}_DB_PASSWORD`];
  const database = names[`${prefix}_DB_NAME`];
  if (!user || !password || !database) {
    throw new Error(`cn DB creds 不全 for ${prefix}（需 ${prefix}_DB_USER/PASSWORD@database-users + ${prefix}_DB_NAME@database-names）。该服务 cn 可能用字面 DATABASE_URL，见 optima-dev-skills#21。`);
  }
  const port = ensureTunnel(CN_RDS_HOST, 'cn-buildbox');
  const conn: DBConnection = { host: 'localhost', port, user, password, database };
  return { query: (sql: string) => queryDB(conn, sql) };
}

/**
 * 连 cn-prod 某服务库，creds 来自该服务 /services/<svc> 的字面/展开 DATABASE_URL。
 * 用于 cred 不在 shared-secrets/database-users 的服务（如 gateway-core）。
 * expandSecretReferences=true 让 cn Infisical 解析 `${...}` 引用为字面值。
 */
export function connectCnDBFromUrl(servicePath: string): { query: (sql: string) => string } {
  const token = getCnInfisicalToken();
  const secrets = getCnSecrets(token, servicePath, true);
  const dbUrl = secrets['DATABASE_URL'];
  if (!dbUrl) throw new Error(`cn DATABASE_URL 未找到 at ${servicePath}`);
  // 注意：DATABASE_URL 含凭证，报错只说事实，不回显值
  if (dbUrl.includes('${')) throw new Error(`cn DATABASE_URL 仍含未解析引用（expand 失败）at ${servicePath}`);
  const parsed = parseDatabaseUrl(dbUrl);   // host = cn 内网 RDS（经 buildbox 隧道到达）
  const port = ensureTunnel(parsed.host, 'cn-buildbox');
  const conn: DBConnection = { host: 'localhost', port, user: parsed.user, password: parsed.password, database: parsed.database };
  return { query: (sql: string) => queryDB(conn, sql) };
}

/** Connect to user-auth DB and return a query function. */
export async function connectAuthDB(env: string, infisicalConfig: InfisicalConfig, token: string): Promise<{ query: (sql: string) => string }> {
  const infisicalEnv = env === 'stage' ? 'staging' : 'prod';
  const secrets = getInfisicalSecrets(infisicalConfig, token, infisicalEnv, '/shared-secrets/database-users');
  const host = RDS_HOSTS[env as 'stage' | 'prod'];
  const port = ensureTunnel(host);

  const conn: DBConnection = { host: 'localhost', port, user: secrets['AUTH_DB_USER'], password: secrets['AUTH_DB_PASSWORD'], database: 'optima_auth' };
  return { query: (sql: string) => queryDB(conn, sql) };
}

/** Connect to billing DB and return a query function. */
export async function connectBillingDB(env: string, infisicalConfig: InfisicalConfig, token: string): Promise<{ query: (sql: string) => string }> {
  const infisicalEnv = env === 'stage' ? 'staging' : 'prod';
  const secrets = getInfisicalSecrets(infisicalConfig, token, infisicalEnv, '/services/billing');
  const dbUrl = secrets['DATABASE_URL'];
  if (!dbUrl) throw new Error('DATABASE_URL not found for billing service');

  const parsed = parseDatabaseUrl(dbUrl);
  const port = ensureTunnel(parsed.host);

  const conn: DBConnection = { host: 'localhost', port, user: parsed.user, password: parsed.password, database: parsed.database };
  return { query: (sql: string) => queryDB(conn, sql) };
}

/** Look up user_id by email from user-auth DB. Throws if not found. */
export async function resolveUserId(email: string, env: string, infisicalConfig: InfisicalConfig, token: string): Promise<string> {
  console.log(`Looking up user by email: ${email}`);
  const auth = await connectAuthDB(env, infisicalConfig, token);
  const userId = auth.query(`SELECT id FROM users WHERE email='${escapeSQL(email)}' LIMIT 1`);
  if (!userId) {
    console.error(`❌ User not found: ${email}`);
    process.exit(1);
  }
  console.log(`✓ Found user: ${userId}`);
  return userId;
}
