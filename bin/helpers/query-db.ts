#!/usr/bin/env node

import { execSync } from 'child_process';
import * as fs from 'fs';
import { ensureTunnel, getGitHubVariable, getInfisicalConfig, getInfisicalToken, getInfisicalSecrets, parseDatabaseUrl, isCnEnv, connectCnDB, connectCnDBFromUrl } from './db-utils';

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
    stage: { userKey: 'AI_SHELL_DB_USER', passwordKey: 'AI_SHELL_DB_PASSWORD', database: 'optima_shell' },
    prod: { userKey: 'AI_SHELL_DB_USER', passwordKey: 'AI_SHELL_DB_PASSWORD', database: 'optima_ai_shell' }
  },
  'gateway-core': {
    ci: null, // CI 环境 gateway-core 不带 DB（本地 JSONL-only 模式）
    stage: { databaseUrlPath: '/services/gateway-core', databaseUrlKey: 'DATABASE_URL' },
    prod: { databaseUrlPath: '/services/gateway-core', databaseUrlKey: 'DATABASE_URL' }
  },
  'optima-logistics': {
    ci: null,
    stage: { userKey: 'LOGISTICS_DB_USER', passwordKey: 'LOGISTICS_DB_PASSWORD', database: 'optima_stage_logistics' },
    prod: { userKey: 'LOGISTICS_DB_USER', passwordKey: 'LOGISTICS_DB_PASSWORD', database: 'optima_logistics' }
  },
  'billing': {
    ci: null,
    stage: { databaseUrlPath: '/services/billing', databaseUrlKey: 'DATABASE_URL' },
    prod: { databaseUrlPath: '/services/billing', databaseUrlKey: 'DATABASE_URL' }
  },
  'ads-backend': {
    ci: null,
    stage: { databaseUrlPath: '/services/optima-ads', databaseUrlKey: 'DATABASE_URL' },
    prod: { databaseUrlPath: '/services/optima-ads', databaseUrlKey: 'DATABASE_URL' }
  },
  'amazon-backend': {
    ci: null,
    stage: { databaseUrlPath: '/services/optima-amazon', databaseUrlKey: 'DATABASE_URL' },
    prod: { databaseUrlPath: '/services/optima-amazon', databaseUrlKey: 'DATABASE_URL' }
  },
  'browser-backend': {
    ci: null,
    stage: { databaseUrlPath: '/services/browser-backend', databaseUrlKey: 'DATABASE_URL' },
    prod: { databaseUrlPath: '/services/browser-backend', databaseUrlKey: 'DATABASE_URL' }
  },
  'shopify-backend': {
    ci: null,
    stage: { databaseUrlPath: '/services/shopify-backend', databaseUrlKey: 'DATABASE_URL' },
    prod: { databaseUrlPath: '/services/shopify-backend', databaseUrlKey: 'DATABASE_URL' }
  },
  'optima-generation': {
    ci: null,
    stage: { databaseUrlPath: '/services/optima-generation', databaseUrlKey: 'DATABASE_URL' },
    prod: { databaseUrlPath: '/services/optima-generation', databaseUrlKey: 'DATABASE_URL' }
  },
  'optima-sentinel': {
    ci: null,
    stage: { databaseUrlPath: '/services/optima-sentinel', databaseUrlKey: 'DATABASE_URL' },
    prod: { databaseUrlPath: '/services/optima-sentinel', databaseUrlKey: 'DATABASE_URL' }
  }
};

// Stage 和 Prod 独立的 RDS 实例
const RDS_HOSTS = {
  stage: 'optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com',
  prod: 'optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com'
};

// parseDatabaseUrl 统一用 db-utils 的实现：右切 userinfo 容忍密码特殊字符，
// 且报错不回显 URL（这里曾把含密码的完整 URL 打进错误信息）。

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

const USAGE = `Usage: optima-query-db <service> "<sql>" [environment]
   or: optima-query-db <service> "<sql>" --env <environment>

Services: commerce-backend, user-auth, agentic-chat, bi-backend, session-gateway, gateway-core, optima-logistics, billing, ads-backend, amazon-backend, browser-backend, shopify-backend, optima-generation, optima-sentinel
Environments: ci (default), stage, prod, cn-prod (阿里云生产), cn-stage (阿里云预发)

Example: optima-query-db user-auth "SELECT COUNT(*) FROM users" prod`;

/** 参数用法错误（入口打印 message + usage 后退非零，区别于运行期错误）。 */
export class QueryDbUsageError extends Error {}

const VALID_ENVS = ['ci', 'stage', 'prod', 'cn-prod', 'cn-stage'];
// 'cn' 是历史别名（isCnEnv 认作 cn-prod），继续放行但不在 usage 里宣传。
const ENV_ALIASES = ['cn'];

// 单 token 旗标形态，含 --flag=value / 下划线（--env=cn-stage、--dry_run）。
// 带空白的 SQL 文本不会匹配；整段是注释的 SQL 由下方空语句检查兜住。
const FLAG_RE = /^--?[A-Za-z][-A-Za-z0-9_]*(=.*)?$/;

/** SQL 去掉块注释、行注释、分号与空白后是否不剩任何语句（psql 对纯注释静默 no-op + exit 0）。 */
function isEffectivelyEmptySql(sql: string): boolean {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/--.*/, '')).join('\n')
    .replace(/[;\s]+/g, '');
  return stripped.length === 0;
}

/**
 * 解析 `<service> <sql> [environment]`，environment 也可经 --env/-e 旗标给
 * （对齐 optima-logs 惯例）。历史 footgun（#60）：`--env cn-stage` 曾被吞成
 * sql='--env'（SQL 注释 = no-op）+ 真 SQL 静默丢弃，空输出 + exit 0 被误判成
 * 「环境读不到」。故未知旗标、多余参数、未知环境、纯注释 SQL 一律硬报错。
 */
export function parseQueryDbArgs(
  args: string[],
): { service: string; sql: string; environment: string } {
  const positionals: string[] = [];
  let envFromFlag: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--env' || arg === '-e' || arg.startsWith('--env=') || arg.startsWith('-e=')) {
      let value: string | undefined;
      if (arg.includes('=')) {
        value = arg.slice(arg.indexOf('=') + 1);
      } else {
        value = args[i + 1];
        i++;
      }
      if (!value || FLAG_RE.test(value)) {
        throw new QueryDbUsageError('--env 需要环境名，如 --env cn-stage');
      }
      if (envFromFlag !== undefined) {
        throw new QueryDbUsageError('--env 重复指定');
      }
      envFromFlag = value;
      continue;
    }
    if (FLAG_RE.test(arg)) {
      throw new QueryDbUsageError(`未知旗标 ${arg}（仅支持 --env <环境>，其余都是位置参数）`);
    }
    positionals.push(arg);
  }

  if (positionals.length < 2) {
    throw new QueryDbUsageError('缺少参数：需要 <service> <sql>');
  }
  const maxPositionals = envFromFlag !== undefined ? 2 : 3;
  if (positionals.length > maxPositionals) {
    throw new QueryDbUsageError(
      envFromFlag !== undefined && positionals.length === 3
        ? `environment 同时以 --env 和位置参数给出：${envFromFlag} vs ${positionals[2]}`
        : `多余参数已拒绝（绝不静默丢弃）：${positionals.slice(maxPositionals).join(' ')}。SQL 含空格时记得整体加引号`,
    );
  }

  const [service, sql] = positionals;
  const environment = envFromFlag ?? positionals[2] ?? 'ci';

  if (!VALID_ENVS.includes(environment) && !ENV_ALIASES.includes(environment)) {
    throw new QueryDbUsageError(`未知环境 ${environment}（可选 ${VALID_ENVS.join(' | ')}）`);
  }

  if (isEffectivelyEmptySql(sql)) {
    throw new QueryDbUsageError(
      'SQL 为空或全是注释/分号（psql 会静默 no-op）——检查参数顺序：<service> <sql> [environment]',
    );
  }

  return { service, sql, environment };
}

async function main() {
  const argv = process.argv.slice(2);
  // help 只认第 1 个参数位：尾部混入的 -h 走未知旗标报错（exit 1），
  // 不给「打 usage 后 exit 0 但没跑 SQL」的静默通道。
  if (argv[0] === '--help' || argv[0] === '-h') {
    console.log(USAGE);
    return;
  }

  const { service, sql, environment } = parseQueryDbArgs(argv);

  if (!SERVICE_DB_MAP[service as keyof typeof SERVICE_DB_MAP]) {
    console.error(`Unknown service: ${service}`);
    console.error('Available services:', Object.keys(SERVICE_DB_MAP).join(', '));
    process.exit(1);
  }

  // cn-prod（阿里云）：独立 Infisical + 经 buildbox 跳板连内网 RDS（动态端口隧道）。
  // 两类 cred：① shared-secrets/database-users（按 prefix）② 服务自己的 DATABASE_URL（展开引用）。
  if (isCnEnv(environment)) {
    // cn-prod / cn-stage 共用 SERVICE_DB_MAP[*].prod 的 userKey/databaseUrlPath（prefix、
    // /services/<svc> 路径两环境一致）；connectCn* 按 env 切 cn Infisical 环境 + RDS 实例。
    const label = environment === 'cn-stage' ? 'CN-STAGE' : 'CN-PROD';
    const prodCfg = SERVICE_DB_MAP[service as keyof typeof SERVICE_DB_MAP].prod as any;
    let db: { query: (sql: string) => string };
    if (prodCfg?.userKey) {
      const prefix = prodCfg.userKey.replace(/_DB_USER$/, '');
      console.log(`\n🔍 Querying ${service} (${label}, prefix ${prefix})...`);
      db = connectCnDB(prefix, environment);
    } else if (prodCfg?.databaseUrlPath) {
      console.log(`\n🔍 Querying ${service} (${label}, DATABASE_URL @ ${prodCfg.databaseUrlPath})...`);
      db = connectCnDBFromUrl(prodCfg.databaseUrlPath, environment);
    } else {
      console.error(`${label} query 暂不支持 ${service}（既无 userKey 也无 databaseUrlPath）。见 optima-dev-skills#21。`);
      process.exit(1);
    }
    console.log('\n' + db.query(sql));
    return;
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
  } else {
    // Stage/Prod 环境：通过 SSH 隧道访问 RDS
    const infisicalConfig = getInfisicalConfig();
    console.log('✓ Loaded Infisical config from GitHub Variables');

    const token = getInfisicalToken(infisicalConfig);
    console.log('✓ Obtained Infisical access token');

    const infisicalEnv = environment === 'stage' ? 'staging' : 'prod';
    let dbUser: string;
    let dbPassword: string;
    let dbHost: string;
    let database: string;

    if ('databaseUrlPath' in (serviceConfig as any)) {
      // 从服务路径获取 DATABASE_URL 并解析
      const { databaseUrlPath, databaseUrlKey } = serviceConfig as any;
      const secrets = getInfisicalSecrets(infisicalConfig, token, infisicalEnv, databaseUrlPath);
      console.log(`✓ Retrieved DATABASE_URL from Infisical (path: ${databaseUrlPath})`);

      const databaseUrl = secrets[databaseUrlKey];
      if (!databaseUrl) {
        throw new Error(`DATABASE_URL not found in Infisical at ${databaseUrlPath}`);
      }

      const parsed = parseDatabaseUrl(databaseUrl);
      dbUser = parsed.user;
      dbPassword = parsed.password;
      dbHost = parsed.host;
      database = parsed.database;
    } else {
      // 从 shared-secrets/database-users 获取凭证
      const secrets = getInfisicalSecrets(infisicalConfig, token, infisicalEnv, '/shared-secrets/database-users');
      console.log('✓ Retrieved database credentials from Infisical');

      const { userKey, passwordKey } = serviceConfig as any;
      database = (serviceConfig as any).database;
      dbHost = RDS_HOSTS[environment as 'stage' | 'prod'];
      dbUser = secrets[userKey];
      dbPassword = secrets[passwordKey];

      if (!dbUser || !dbPassword) {
        throw new Error(`Database credentials not found in Infisical for ${service}. Keys: ${userKey}, ${passwordKey}`);
      }
    }

    const localPort = ensureTunnel(dbHost);

    const result = queryDatabase('localhost', localPort, dbUser, dbPassword, database, sql);
    console.log('\n' + result);
  }
}

// Only run the CLI flow when invoked directly — being require()'d (e.g. by the
// unit tests for parseQueryDbArgs) must not trigger main().
if (require.main === module) {
  main().catch(error => {
    if (error instanceof QueryDbUsageError) {
      console.error(`❌ ${error.message}\n`);
      console.error(USAGE);
    } else {
      console.error('\n❌ Error:', error.message);
    }
    process.exit(1);
  });
}
