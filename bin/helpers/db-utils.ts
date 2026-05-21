import { execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

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

// Use execFileSync (no shell) so single-quoted JSON bodies survive on Windows
// cmd.exe, where ' is literal rather than a string delimiter. Passing curl
// args as an array bypasses shell parsing on every platform.
export function getInfisicalToken(config: InfisicalConfig): string {
  const body = JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret });
  const response = execFileSync('curl', [
    '-s',
    '-X', 'POST',
    `${config.url}/api/v1/auth/universal-auth/login`,
    '-H', 'Content-Type: application/json',
    '-d', body,
  ], { encoding: 'utf-8' });
  return JSON.parse(response).accessToken;
}

export function getInfisicalSecrets(config: InfisicalConfig, token: string, environment: string, secretPath: string): Record<string, string> {
  const url = `${config.url}/api/v3/secrets/raw?workspaceId=${config.projectId}&environment=${environment}&secretPath=${encodeURIComponent(secretPath)}`;
  const response = execFileSync('curl', [
    '-s',
    url,
    '-H', `Authorization: Bearer ${token}`,
  ], { encoding: 'utf-8' });
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
export function setupSSHTunnel(dbHost: string, localPort: number): void {
  try { execSync(`lsof -ti:${localPort}`, { stdio: 'ignore' }); return; } catch { /* need tunnel */ }
  const sshKeyPath = `${process.env.HOME}/.ssh/optima-ec2-key`;
  if (!fs.existsSync(sshKeyPath)) throw new Error(`SSH key not found: ${sshKeyPath}. Please obtain optima-ec2-key from xbfool.`);
  console.log(`Creating SSH tunnel: localhost:${localPort} -> ${EC2_HOST} -> ${dbHost}:5432`);
  execSync(`ssh -i ${sshKeyPath} -f -N -o StrictHostKeyChecking=no -L ${localPort}:${dbHost}:5432 ec2-user@${EC2_HOST}`, { stdio: 'inherit' });
}

// ─── psql ───────────────────────────────────────────────────────────────────
function findPsqlPath(): string {
  if (process.platform === 'win32') {
    // `which psql` under Git Bash returns an MSYS path (e.g. `/c/Program Files/...`)
    // that Node's execSync (running cmd.exe) cannot resolve. Probe known install
    // locations and fall back to `where psql` which returns native Windows paths.
    const winPaths = [
      'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
      'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
      'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
      'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
      'C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe',
    ];
    for (const p of winPaths) { if (fs.existsSync(p)) return p; }
    try {
      const result = execSync('where psql', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
      const first = result.split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0);
      if (first) return first;
    } catch { /* fallthrough */ }
    throw new Error('PostgreSQL client (psql) not found. Install from https://www.postgresql.org/download/windows/');
  }
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
  // Write SQL to a temp file and use `psql -f` rather than `psql -c "<sql>"`.
  // On Windows, cmd.exe truncates embedded newlines inside a quoted -c argument,
  // so multi-statement transactions silently execute only their first line and
  // psql still exits 0 — caller thinks the grant/update committed when nothing changed.
  // ON_ERROR_STOP=1 makes any failing statement abort the script with non-zero exit.
  const tmpFile = path.join(os.tmpdir(), `optima-psql-${crypto.randomBytes(8).toString('hex')}.sql`);
  fs.writeFileSync(tmpFile, sql, { encoding: 'utf-8' });
  try {
    return execFileSync(psql, [
      '-h', conn.host,
      '-p', String(conn.port),
      '-U', conn.user,
      '-d', conn.database,
      '-t', '-A', '--quiet',
      '-v', 'ON_ERROR_STOP=1',
      '-f', tmpFile,
    ], {
      encoding: 'utf-8',
      env: { ...process.env, PGPASSWORD: conn.password },
    }).trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
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
