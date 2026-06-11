import { execSync, spawn } from 'child_process';
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

// ─── Database URL parsing ───────────────────────────────────────────────────
export function parseDatabaseUrl(url: string): { user: string; password: string; host: string; port: number; database: string } {
  const match = url.match(/^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
  if (!match) throw new Error('Failed to parse DATABASE_URL (format: postgresql://user:pass@host:port/db)');
  return { user: decodeURIComponent(match[1]), password: decodeURIComponent(match[2]), host: match[3], port: parseInt(match[4], 10), database: match[5] };
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
 * One tunnel per RDS host (auth/billing on the same instance share it).
 * Defaults to SSM (no public port 22); set OPTIMA_DB_TUNNEL=ssh for the
 * legacy SSH tunnel.
 */
export function ensureTunnel(dbHost: string): number {
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
  if ((process.env.OPTIMA_DB_TUNNEL || 'ssm').toLowerCase() === 'ssh') {
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
