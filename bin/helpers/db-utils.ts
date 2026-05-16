import { execSync } from 'child_process';
import * as fs from 'fs';

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

const EC2_HOST = '3.0.210.113';

// ─── SQL escaping ───────────────────────────────────────────────────────────
/** Escape a string value for safe inclusion in SQL single-quoted literals. */
export function escapeSQL(value: string): string {
  return value.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

// ─── GitHub Variables ───────────────────────────────────────────────────────
export function getGitHubVariable(name: string): string {
  return execSync(`gh variable get ${name} -R Optima-Chat/optima-dev-skills`, { encoding: 'utf-8' }).trim();
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

function killOrphanTunnel(localPort: number): void {
  try {
    const pids = execSync(`lsof -ti:${localPort}`, { encoding: 'utf-8' }).trim();
    if (pids) execSync(`kill -9 ${pids.split(/\s+/).join(' ')}`, { stdio: 'ignore' });
  } catch { /* nothing to kill */ }
}

export function setupSSHTunnel(dbHost: string, localPort: number): void {
  let portInUse = false;
  try { execSync(`lsof -ti:${localPort}`, { stdio: 'ignore' }); portInUse = true; } catch { /* free */ }

  if (portInUse) {
    if (isTunnelHealthy(localPort)) return;
    console.log(`! SSH tunnel on port ${localPort} not responding (zombie), replacing...`);
    killOrphanTunnel(localPort);
  }

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
  const port = env === 'stage' ? 15432 : 15433;

  setupSSHTunnel(host, port);
  await new Promise(r => setTimeout(r, 1000));

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
  const port = env === 'stage' ? 15434 : 15435;
  setupSSHTunnel(parsed.host, port);
  await new Promise(r => setTimeout(r, 1000));

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
