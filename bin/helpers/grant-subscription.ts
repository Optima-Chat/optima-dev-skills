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
function parseArgs(args: string[]): { email: string; plan: string; months: number; env: string } {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage: optima-grant-subscription <email> [options]

Options:
  --plan <id>       Plan: free, pro, enterprise (default: enterprise)
  --months <n>      Duration in months (default: 1)
  --env <env>       Environment: stage, prod (default: stage)
  -h, --help        Show this help`);
    process.exit(0);
  }

  const email = args[0];
  let plan = 'enterprise';
  let months = 1;
  let env = 'stage';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--plan' && args[i + 1]) { plan = args[++i]; }
    else if (args[i] === '--months' && args[i + 1]) { months = parseInt(args[++i]); }
    else if (args[i] === '--env' && args[i + 1]) { env = args[++i]; }
  }

  if (!['free', 'pro', 'enterprise'].includes(plan)) {
    console.error(`Unknown plan: ${plan}. Available: free, pro, enterprise`);
    process.exit(1);
  }
  if (months < 1) { console.error('Months must be >= 1'); process.exit(1); }
  if (!['stage', 'prod'].includes(env)) { console.error('Env must be stage or prod (billing DB not available in CI)'); process.exit(1); }

  return { email, plan, months, env };
}

async function main() {
  const { email, plan, months, env } = parseArgs(process.argv.slice(2));
  const infisicalConfig = getInfisicalConfig();
  const token = getInfisicalToken(infisicalConfig);
  const infisicalEnv = env === 'stage' ? 'staging' : 'prod';

  console.log(`\n🎁 Granting ${plan} subscription to ${email} for ${months} month(s) [${env.toUpperCase()}]\n`);

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

  // ── Step 3: Read plan config from DB ──
  console.log(`Loading plan config: ${plan}`);
  const planRow = bq(`SELECT name, monthly_credits, session_token_limit, weekly_token_limit FROM plans WHERE id='${plan}'`);
  if (!planRow) { console.error(`❌ Plan not found in DB: ${plan}`); process.exit(1); }

  const [planName, monthlyCreditsStr, sessionTokenLimitStr, weeklyTokenLimitStr] = planRow.split('|');
  const monthlyCredits = parseInt(monthlyCreditsStr);
  const sessionTokenLimit = parseInt(sessionTokenLimitStr);
  const weeklyTokenLimit = parseInt(weeklyTokenLimitStr);
  console.log(`✓ Plan: ${planName} (credits: ${monthlyCredits}, session: ${sessionTokenLimit.toLocaleString()}, weekly: ${weeklyTokenLimit.toLocaleString()})`);

  // ── Step 4: Cancel active subscriptions ──
  const now = new Date().toISOString();
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + months);
  const periodEndISO = periodEnd.toISOString();

  console.log('Canceling existing active subscriptions...');
  bq(`UPDATE subscriptions SET status='canceled', canceled_at='${now}' WHERE user_id='${userId}' AND status IN ('active','trialing')`);
  console.log('✓ Old subscriptions canceled');

  // ── Step 5: Zero out old monthly_grant/subscription credits ──
  console.log('Clearing old subscription credits...');
  bq(`UPDATE credit_ledger SET remaining=0 WHERE user_id='${userId}' AND type IN ('monthly_grant','subscription') AND remaining > 0`);
  console.log('✓ Old credits cleared');

  // ── Step 6: Create new subscription ──
  console.log(`Creating ${planName} subscription...`);
  const subId = bq(`INSERT INTO subscriptions (id, user_id, plan_id, status, billing_interval, current_period_start, current_period_end, created_at, updated_at) VALUES (concat('sub_gift_', substr(md5(random()::text), 1, 16)), '${userId}', '${plan}', 'active', 'monthly', '${now}', '${periodEndISO}', '${now}', '${now}') RETURNING id`);
  console.log(`✓ Subscription created: ${subId}`);

  // ── Step 7: Grant monthly credits ──
  if (monthlyCredits > 0) {
    console.log(`Granting ${monthlyCredits} credits...`);
    bq(`INSERT INTO credit_ledger (id, user_id, type, description, initial_amount, remaining, expires_at, created_at) VALUES (concat('crd_gift_', substr(md5(random()::text), 1, 16)), '${userId}', 'subscription', '${planName} plan gift (${months} month)', ${monthlyCredits}, ${monthlyCredits}, '${periodEndISO}', '${now}')`);
    console.log(`✓ ${monthlyCredits} credits granted (expires: ${periodEndISO})`);
  }

  // ── Step 8: Update token quotas (session + weekly) ──
  console.log('Updating token quotas...');
  const sessionEnd = new Date(new Date().getTime() + 5 * 60 * 60 * 1000).toISOString();
  bq(`INSERT INTO token_quotas (id, user_id, plan_id, period_type, monthly_limit, monthly_used, period_start, period_end, created_at, updated_at) VALUES (concat('tq_sess_', substr(md5(random()::text), 1, 16)), '${userId}', '${plan}', 'session', ${sessionTokenLimit}, 0, '${now}', '${sessionEnd}', '${now}', '${now}') ON CONFLICT (user_id, period_type, period_start) DO UPDATE SET plan_id='${plan}', monthly_limit=${sessionTokenLimit}, updated_at='${now}'`);

  const weekEnd = new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  bq(`INSERT INTO token_quotas (id, user_id, plan_id, period_type, monthly_limit, monthly_used, period_start, period_end, created_at, updated_at) VALUES (concat('tq_week_', substr(md5(random()::text), 1, 16)), '${userId}', '${plan}', 'weekly', ${weeklyTokenLimit}, 0, '${now}', '${weekEnd}', '${now}', '${now}') ON CONFLICT (user_id, period_type, period_start) DO UPDATE SET plan_id='${plan}', monthly_limit=${weeklyTokenLimit}, updated_at='${now}'`);
  console.log(`✓ Token quotas updated (session: ${sessionTokenLimit.toLocaleString()}, weekly: ${weeklyTokenLimit.toLocaleString()})`);

  console.log(`\n✅ Done! ${email} now has ${planName} plan until ${periodEnd.toLocaleDateString()}\n`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
