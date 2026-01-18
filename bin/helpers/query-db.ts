#!/usr/bin/env node

import { execSync } from 'child_process';
import * as fs from 'fs';

interface InfisicalConfig {
  url: string;
  clientId: string;
  clientSecret: string;
  projectId: string;
}

interface DatabaseConfig {
  host: string;
  user: string;
  password: string;
  database: string;
}

const SERVICE_DB_MAP = {
  'commerce-backend': {
    ci: { container: 'commerce-postgres', user: 'commerce', password: 'commerce123', database: 'commerce' },
    stage: { userKey: 'COMMERCE_DB_USER', passwordKey: 'COMMERCE_DB_PASSWORD', database: 'optima_commerce' },
    prod: { userKey: 'COMMERCE_DB_USER', passwordKey: 'COMMERCE_DB_PASSWORD', database: 'optima_commerce' }
  },
  'user-auth': {
    ci: { container: 'user-auth-postgres-1', user: 'userauth', password: 'password123', database: 'userauth' },
    stage: { userKey: 'AUTH_DB_USER', passwordKey: 'AUTH_DB_PASSWORD', database: 'optima_auth' },
    prod: { userKey: 'AUTH_DB_USER', passwordKey: 'AUTH_DB_PASSWORD', database: 'optima_auth' }
  },
  'agentic-chat': {
    ci: { container: 'optima-postgres', user: 'postgres', password: 'postgres123', database: 'optima_chat' },
    stage: { userKey: 'CHAT_DB_USER', passwordKey: 'CHAT_DB_PASSWORD', database: 'optima_chat' },
    prod: { userKey: 'CHAT_DB_USER', passwordKey: 'CHAT_DB_PASSWORD', database: 'optima_chat' }
  },
  'bi-backend': {
    ci: null, // CI 环境暂无 BI 数据库
    stage: { userKey: 'BI_DB_USER', passwordKey: 'BI_DB_PASSWORD', database: 'optima_bi' },
    prod: { userKey: 'BI_DB_USER', passwordKey: 'BI_DB_PASSWORD', database: 'optima_bi' }
  },
  'session-gateway': {
    ci: null, // CI 环境暂无 session-gateway 数据库
    stage: { userKey: 'SHELL_DB_USER', passwordKey: 'SHELL_DB_PASSWORD', database: 'optima_shell' },
    prod: { userKey: 'AI_SHELL_DB_USER', passwordKey: 'AI_SHELL_DB_PASSWORD', database: 'optima_ai_shell' }
  }
};

// Stage 和 Prod 独立的 RDS 实例
const RDS_HOSTS = {
  stage: 'optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com',
  prod: 'optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com'
};

// 统一使用 Shared EC2 作为跳板机
const EC2_HOST = '13.251.46.219';

function getGitHubVariable(name: string): string {
  return execSync(`gh variable get ${name} -R Optima-Chat/optima-dev-skills`, { encoding: 'utf-8' }).trim();
}

function getInfisicalConfig(): InfisicalConfig {
  return {
    url: getGitHubVariable('INFISICAL_URL'),
    clientId: getGitHubVariable('INFISICAL_CLIENT_ID'),
    clientSecret: getGitHubVariable('INFISICAL_CLIENT_SECRET'),
    projectId: getGitHubVariable('INFISICAL_PROJECT_ID')
  };
}

function getInfisicalToken(config: InfisicalConfig): string {
  const response = execSync(
    `curl -s -X POST "${config.url}/api/v1/auth/universal-auth/login" -H "Content-Type: application/json" -d '{"clientId": "${config.clientId}", "clientSecret": "${config.clientSecret}"}'`,
    { encoding: 'utf-8' }
  );
  return JSON.parse(response).accessToken;
}

function getInfisicalSecrets(config: InfisicalConfig, token: string, environment: string): Record<string, string> {
  const response = execSync(
    `curl -s "${config.url}/api/v3/secrets/raw?workspaceId=${config.projectId}&environment=${environment}&secretPath=/infrastructure" -H "Authorization: Bearer ${token}"`,
    { encoding: 'utf-8' }
  );
  const data = JSON.parse(response);
  const secrets: Record<string, string> = {};
  for (const secret of data.secrets) {
    secrets[secret.secretKey] = secret.secretValue;
  }
  return secrets;
}

function setupSSHTunnel(ec2Host: string, dbHost: string, localPort: number): void {
  // 检查是否已有隧道
  try {
    execSync(`lsof -ti:${localPort}`, { stdio: 'ignore' });
    console.log(`✓ SSH tunnel already exists on port ${localPort}`);
    return;
  } catch {
    // 端口未占用，创建隧道
  }

  const sshKeyPath = `${process.env.HOME}/.ssh/optima-ec2-key`;
  if (!fs.existsSync(sshKeyPath)) {
    throw new Error(`SSH key not found: ${sshKeyPath}. Please obtain optima-ec2-key from xbfool.`);
  }

  console.log(`Creating SSH tunnel: localhost:${localPort} -> ${ec2Host} -> ${dbHost}:5432`);
  execSync(
    `ssh -i ${sshKeyPath} -f -N -o StrictHostKeyChecking=no -L ${localPort}:${dbHost}:5432 ec2-user@${ec2Host}`,
    { stdio: 'inherit' }
  );
  console.log(`✓ SSH tunnel established on port ${localPort}`);
}

function findPsqlPath(): string {
  // 1. 优先从 PATH 中查找
  const whichCmd = process.platform === 'win32' ? 'where psql' : 'which psql';
  try {
    const result = execSync(whichCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const foundPath = result.trim().split(/\r?\n/)[0]; // Windows where 可能返回 \r\n
    if (foundPath && fs.existsSync(foundPath)) {
      return foundPath;
    }
  } catch {
    // which/where 失败，继续尝试常见路径
  }

  // 2. 回退到常见安装路径
  const fallbackPaths = process.platform === 'win32'
    ? [
        'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
        'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
        'C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe',
      ]
    : [
        '/usr/local/opt/postgresql@16/bin/psql',  // macOS Homebrew
        '/usr/local/opt/postgresql@15/bin/psql',
        '/opt/homebrew/bin/psql',                 // macOS ARM Homebrew
        '/usr/bin/psql',                          // Linux
        '/usr/local/bin/psql',
      ];

  for (const p of fallbackPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // 3. 未找到
  const installHint = process.platform === 'darwin'
    ? 'brew install postgresql@16'
    : process.platform === 'win32'
    ? 'Download from https://www.postgresql.org/download/windows/'
    : 'sudo apt install postgresql-client';

  throw new Error(`PostgreSQL client (psql) not found. Install with: ${installHint}`);
}

function queryDatabase(host: string, port: number, user: string, password: string, database: string, sql: string): string {
  const psqlPath = findPsqlPath();

  const result = execSync(
    `"${psqlPath}" -h ${host} -p ${port} -U ${user} -d ${database} -c "${sql}"`,
    {
      encoding: 'utf-8',
      env: { ...process.env, PGPASSWORD: password }
    }
  );
  return result;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: query-db.ts <service> <sql> [environment]');
    console.error('');
    console.error('Services: commerce-backend, user-auth, agentic-chat, bi-backend, session-gateway');
    console.error('Environments: ci (default), stage, prod');
    console.error('');
    console.error('Example: query-db.ts user-auth "SELECT COUNT(*) FROM users" prod');
    process.exit(1);
  }

  const [service, sql, environment = 'ci'] = args;

  if (!SERVICE_DB_MAP[service as keyof typeof SERVICE_DB_MAP]) {
    console.error(`Unknown service: ${service}`);
    console.error('Available services:', Object.keys(SERVICE_DB_MAP).join(', '));
    process.exit(1);
  }

  const serviceConfig = SERVICE_DB_MAP[service as keyof typeof SERVICE_DB_MAP][environment as 'ci' | 'stage' | 'prod'];

  if (!serviceConfig) {
    console.error(`Service ${service} is not available in ${environment.toUpperCase()} environment.`);
    if (environment === 'ci') {
      console.error('Try using stage or prod environment instead.');
    }
    process.exit(1);
  }

  console.log(`\n🔍 Querying ${service} (${environment.toUpperCase()})...`);

  if (environment === 'ci') {
    // CI 环境：通过 SSH + Docker Exec
    const ciUser = getGitHubVariable('CI_SSH_USER');
    const ciHost = getGitHubVariable('CI_SSH_HOST');
    const ciPassword = getGitHubVariable('CI_SSH_PASSWORD');

    const { container, user, database } = serviceConfig as any;

    const result = execSync(
      `sshpass -p "${ciPassword}" ssh -o StrictHostKeyChecking=no ${ciUser}@${ciHost} "docker exec ${container} psql -U ${user} -d ${database} -c \\"${sql}\\""`,
      { encoding: 'utf-8' }
    );

    console.log('\n' + result);
  } else if (environment === 'stage') {
    // Stage 环境：直连 RDS（Stage RDS 在公有子网，可以本地直连）
    const infisicalConfig = getInfisicalConfig();
    console.log('✓ Loaded Infisical config from GitHub Variables');

    const token = getInfisicalToken(infisicalConfig);
    console.log('✓ Obtained Infisical access token');

    const secrets = getInfisicalSecrets(infisicalConfig, token, 'staging');
    console.log('✓ Retrieved database credentials from Infisical');

    const { userKey, passwordKey, database } = serviceConfig as any;
    const dbHost = RDS_HOSTS.stage;
    const dbUser = secrets[userKey];
    const dbPassword = secrets[passwordKey];

    if (!dbUser || !dbPassword) {
      throw new Error(`Database credentials not found in Infisical for ${service}. Keys: ${userKey}, ${passwordKey}`);
    }

    const result = queryDatabase(dbHost, 5432, dbUser, dbPassword, database, sql);
    console.log('\n' + result);
  } else {
    // Prod 环境：通过 SSH 隧道访问 RDS（Prod RDS 在私有子网）
    const infisicalConfig = getInfisicalConfig();
    console.log('✓ Loaded Infisical config from GitHub Variables');

    const token = getInfisicalToken(infisicalConfig);
    console.log('✓ Obtained Infisical access token');

    const secrets = getInfisicalSecrets(infisicalConfig, token, 'prod');
    console.log('✓ Retrieved database credentials from Infisical');

    const { userKey, passwordKey, database } = serviceConfig as any;
    const dbHost = RDS_HOSTS.prod;
    const dbUser = secrets[userKey];
    const dbPassword = secrets[passwordKey];

    if (!dbUser || !dbPassword) {
      throw new Error(`Database credentials not found in Infisical for ${service}. Keys: ${userKey}, ${passwordKey}`);
    }

    const localPort = 15433;

    setupSSHTunnel(EC2_HOST, dbHost, localPort);

    // 等待隧道建立
    await new Promise(resolve => setTimeout(resolve, 1000));

    const result = queryDatabase('localhost', localPort, dbUser, dbPassword, database, sql);
    console.log('\n' + result);
  }
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
