#!/usr/bin/env node

import { execSync } from 'child_process';
import * as fs from 'fs';

// ─── Infisical / DB helpers (shared pattern from query-db.ts) ───────────────
interface InfisicalConfig { url: string; clientId: string; clientSecret: string; projectId: string }

const RDS_HOSTS: Record<string, string> = {
  stage: 'optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com',
  prod:  'optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com',
};
const EC2_HOST = '3.0.210.113';

function getGitHubVariable(name: string): string {
  return execSync(`gh variable get ${name} -R Optima-Chat/optima-dev-skills`, { encoding: 'utf-8' }).trim();
}

function getInfisicalConfig(): InfisicalConfig {
  return {
    url: getGitHubVariable('INFISICAL_URL'),
    clientId: getGitHubVariable('INFISICAL_CLIENT_ID'),
    clientSecret: getGitHubVariable('INFISICAL_CLIENT_SECRET'),
    projectId: getGitHubVariable('INFISICAL_PROJECT_ID'),
  };
}

function getInfisicalToken(config: InfisicalConfig): string {
  const response = execSync(
    `curl -s -X POST "${config.url}/api/v1/auth/universal-auth/login" -H "Content-Type: application/json" -d '{"clientId": "${config.clientId}", "clientSecret": "${config.clientSecret}"}'`,
    { encoding: 'utf-8' }
  );
  return JSON.parse(response).accessToken;
}

function getInfisicalSecrets(config: InfisicalConfig, token: string, environment: string, secretPath: string): Record<string, string> {
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

function parseDatabaseUrl(url: string): { user: string; password: string; host: string; port: number; database: string } {
  const match = url.match(/^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
  if (!match) throw new Error(`Failed to parse DATABASE_URL: ${url}`);
  return { user: decodeURIComponent(match[1]), password: decodeURIComponent(match[2]), host: match[3], port: parseInt(match[4]), database: match[5] };
}

function setupSSHTunnel(dbHost: string, localPort: number): void {
  try { execSync(`lsof -ti:${localPort}`, { stdio: 'ignore' }); return; } catch { /* need tunnel */ }
  const sshKeyPath = `${process.env.HOME}/.ssh/optima-ec2-key`;
  if (!fs.existsSync(sshKeyPath)) throw new Error(`SSH key not found: ${sshKeyPath}. Please obtain optima-ec2-key from xbfool.`);
  console.log(`Creating SSH tunnel: localhost:${localPort} -> ${EC2_HOST} -> ${dbHost}:5432`);
  execSync(`ssh -i ${sshKeyPath} -f -N -o StrictHostKeyChecking=no -L ${localPort}:${dbHost}:5432 ec2-user@${EC2_HOST}`, { stdio: 'inherit' });
}

function findPsqlPath(): string {
  try {
    const result = execSync('which psql', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (result.trim()) return result.trim();
  } catch { /* fallback */ }
  const paths = ['/usr/local/opt/postgresql@16/bin/psql', '/usr/local/opt/postgresql@15/bin/psql', '/opt/homebrew/bin/psql', '/usr/bin/psql', '/usr/local/bin/psql'];
  for (const p of paths) { if (fs.existsSync(p)) return p; }
  throw new Error('PostgreSQL client (psql) not found. Install with: brew install postgresql@16');
}

function queryDB(host: string, port: number, user: string, password: string, database: string, sql: string): string {
  const psql = findPsqlPath();
  return execSync(`"${psql}" -h ${host} -p ${port} -U ${user} -d ${database} -t -A -c "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf-8',
    env: { ...process.env, PGPASSWORD: password },
  }).trim();
}

// ─── Main ───────────────────────────────────────────────────────────────────
function parseArgs(args: string[]): { email: string; amount: number; type: string; description: string | null; env: string } {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage: optima-grant-credits <email> --amount <n> [options]

Options:
  --amount <n>          Credits to grant (required)
  --type <type>         Credit type: bonus, referral (default: bonus)
  --description <text>  Description (optional)
  --env <env>           Environment: stage, prod (default: stage)
  -h, --help            Show this help`);
    process.exit(0);
  }

  const email = args[0];
  let amount = 0;
  let type = 'bonus';
  let description: string | null = null;
  let env = 'stage';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--amount' && args[i + 1]) { amount = parseInt(args[++i]); }
    else if (args[i] === '--type' && args[i + 1]) { type = args[++i]; }
    else if (args[i] === '--description' && args[i + 1]) { description = args[++i]; }
    else if (args[i] === '--env' && args[i + 1]) { env = args[++i]; }
  }

  if (amount < 1) { console.error('--amount is required and must be >= 1'); process.exit(1); }
  if (!['bonus', 'referral'].includes(type)) { console.error(`Unknown type: ${type}. Available: bonus, referral`); process.exit(1); }
  if (!['stage', 'prod'].includes(env)) { console.error('Env must be stage or prod (billing DB not available in CI)'); process.exit(1); }

  return { email, amount, type, description, env };
}

async function main() {
  const { email, amount, type, description, env } = parseArgs(process.argv.slice(2));
  const infisicalConfig = getInfisicalConfig();
  const token = getInfisicalToken(infisicalConfig);
  const infisicalEnv = env === 'stage' ? 'staging' : 'prod';

  console.log(`\n🎁 Granting ${amount} ${type} credits to ${email} [${env.toUpperCase()}]\n`);

  // ── Step 1: Resolve user_id from email via user-auth DB ──
  console.log(`Looking up user by email: ${email}`);

  const authSecrets = getInfisicalSecrets(infisicalConfig, token, infisicalEnv, '/shared-secrets/database-users');
  const authHost = RDS_HOSTS[env as 'stage' | 'prod'];
  const authPort = env === 'stage' ? 15432 : 15433;

  setupSSHTunnel(authHost, authPort);
  await new Promise(r => setTimeout(r, 1000));

  const userId = queryDB('localhost', authPort, authSecrets['AUTH_DB_USER'], authSecrets['AUTH_DB_PASSWORD'], 'optima_auth',
    `SELECT id FROM users WHERE email='${email}' LIMIT 1`);

  if (!userId) { console.error(`❌ User not found: ${email}`); process.exit(1); }
  console.log(`✓ Found user: ${userId}`);

  // ── Step 2: Connect to billing DB ──
  const billingSecrets = getInfisicalSecrets(infisicalConfig, token, infisicalEnv, '/services/billing');
  const billingDbUrl = billingSecrets['DATABASE_URL'];
  if (!billingDbUrl) throw new Error('DATABASE_URL not found for billing service');

  const billingParsed = parseDatabaseUrl(billingDbUrl);
  const billingPort = env === 'stage' ? 15434 : 15435;
  setupSSHTunnel(billingParsed.host, billingPort);
  await new Promise(r => setTimeout(r, 1000));

  const bq = (sql: string) => queryDB('localhost', billingPort, billingParsed.user, billingParsed.password, billingParsed.database, sql);

  // ── Step 3: Insert credit_ledger record ──
  const now = new Date().toISOString();
  const desc = description || `Admin ${type} credit grant`;

  console.log(`Inserting ${amount} ${type} credits...`);
  const ledgerId = bq(`INSERT INTO credit_ledger (id, user_id, type, description, initial_amount, remaining, created_at) VALUES (concat('crd_${type}_', substr(md5(random()::text), 1, 16)), '${userId}', '${type}', '${desc.replace(/'/g, "''")}', ${amount}, ${amount}, '${now}') RETURNING id`);
  console.log(`✓ Credits granted (ledger ID: ${ledgerId})`);

  // ── Step 4: Show updated balance ──
  const balance = bq(`SELECT COALESCE(SUM(remaining), 0) FROM credit_ledger WHERE user_id='${userId}' AND remaining > 0 AND (expires_at IS NULL OR expires_at > NOW())`);
  console.log(`\n✅ Done! ${email} now has ${balance} total credits\n`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
