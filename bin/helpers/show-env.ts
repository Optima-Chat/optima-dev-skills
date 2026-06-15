#!/usr/bin/env node

import { execSync } from 'child_process';
import { getInfisicalConfig, getInfisicalToken, InfisicalConfig, isCnEnv, cnInfisicalEnv, getCnInfisicalToken, getCnSecrets } from './db-utils';

// 支持的服务列表（Infisical 路径为 /services/<service-name>）
const SUPPORTED_SERVICES = [
  'ads-backend',
  'ads-worker',
  'ai-shell-web-ui',
  'amazon-backend',
  'bi-backend',
  'bi-dashboard',
  'billing',
  'browser-backend',
  'commerce-backend',
  'commerce-rq-scheduler',
  'commerce-rq-worker',
  'gateway-core',
  'gw-admin',
  'user-auth',
  'user-auth-admin',
  'agentic-chat',
  'session-gateway',
  'optima-channels',
  'optima-generation',
  'optima-logistics',
  'optima-store',
  'optima-scout',
  'optima-sentinel',
  'optima-sentinel-worker',
  'shopify-backend',
];

// 环境到 AWS Infisical environment 的映射（cn 走独立 cn Infisical，见下方分支）
const ENV_MAP: Record<string, string> = {
  stage: 'staging',
  prod: 'prod'
};

/** 该 environment 是否被支持（AWS stage/prod 或阿里云 cn-prod/cn-stage）。 */
function isSupportedEnv(env: string): boolean {
  return ENV_MAP[env] !== undefined || isCnEnv(env);
}

// NOTE: getInfisicalSecrets is kept local because it encodes secretPath (encodeURIComponent),
// unlike db-utils' raw-path variant; getGitHubVariable/getInfisicalConfig/getInfisicalToken are shared from db-utils.
function getInfisicalSecrets(config: InfisicalConfig, token: string, environment: string, secretPath: string): Record<string, string> {
  const response = execSync(
    `curl -s "${config.url}/api/v3/secrets/raw?workspaceId=${config.projectId}&environment=${environment}&secretPath=${encodeURIComponent(secretPath)}" -H "Authorization: Bearer ${token}"`,
    { encoding: 'utf-8' }
  );
  const data = JSON.parse(response);
  const secrets: Record<string, string> = {};
  for (const secret of data.secrets || []) {
    secrets[secret.secretKey] = secret.secretValue;
  }
  return secrets;
}


function printHelp() {
  console.log(`
Usage: optima-show-env <service> <environment> [options]

Arguments:
  service      Service name (${SUPPORTED_SERVICES.join(', ')})
  environment  Environment (stage, prod, cn-prod, cn-stage)

Options:
  --filter     Filter by key pattern (e.g., --filter DATABASE)
  --keys-only  Show only key names, not values
  --help       Show this help message

Note:
  cn-prod / cn-stage 读阿里云 cn Infisical（需 INFISICAL_CN_EMAIL/PASSWORD 环境变量，
  admin user，见 optima-dev-skills#21）。stage/prod 读 AWS Infisical（GitHub Variables）。

Examples:
  optima-show-env commerce-backend stage
  optima-show-env user-auth prod --filter DATABASE
  optima-show-env gateway-core cn-stage
  optima-show-env bi-backend stage --keys-only
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // 解析参数
  const positionalArgs: string[] = [];
  let filter = '';
  let keysOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--filter' && args[i + 1]) {
      filter = args[i + 1];
      i++;
    } else if (args[i] === '--keys-only') {
      keysOnly = true;
    } else if (!args[i].startsWith('-')) {
      positionalArgs.push(args[i]);
    }
  }

  if (positionalArgs.length < 2) {
    console.error('Error: Missing required arguments');
    printHelp();
    process.exit(1);
  }

  const [service, environment] = positionalArgs;

  // 验证服务
  if (!SUPPORTED_SERVICES.includes(service)) {
    console.error(`Error: Unknown service '${service}'`);
    console.error('Available services:', SUPPORTED_SERVICES.join(', '));
    process.exit(1);
  }

  // 验证环境
  if (!isSupportedEnv(environment)) {
    console.error(`Error: Unknown environment '${environment}'`);
    console.error('Available environments: stage, prod, cn-prod, cn-stage');
    process.exit(1);
  }

  // Infisical 路径为 /services/<service-name>
  const secretPath = `/services/${service}`;

  console.log(`\n🔍 Fetching environment variables for ${service} (${environment.toUpperCase()})...\n`);

  try {
    let secrets: Record<string, string>;
    if (isCnEnv(environment)) {
      // 阿里云 cn Infisical（独立实例，admin email/password 认证；prod / staging 双环境）
      const cnToken = getCnInfisicalToken();
      console.log('✓ Obtained cn Infisical access token');
      secrets = getCnSecrets(cnToken, secretPath, false, cnInfisicalEnv(environment));
      console.log(`✓ Retrieved secrets from cn Infisical (env: ${cnInfisicalEnv(environment)}, path: ${secretPath})\n`);
    } else {
      const infisicalConfig = getInfisicalConfig();
      console.log('✓ Loaded Infisical config from GitHub Variables');

      const token = getInfisicalToken(infisicalConfig);
      console.log('✓ Obtained Infisical access token');

      const infisicalEnv = ENV_MAP[environment];
      secrets = getInfisicalSecrets(infisicalConfig, token, infisicalEnv, secretPath);
      console.log(`✓ Retrieved secrets from Infisical (path: ${secretPath})\n`);
    }

    const keys = Object.keys(secrets).sort();

    if (keys.length === 0) {
      console.log('No environment variables found.');
      return;
    }

    // 过滤
    const filteredKeys = filter
      ? keys.filter(key => key.toUpperCase().includes(filter.toUpperCase()))
      : keys;

    if (filteredKeys.length === 0) {
      console.log(`No environment variables matching '${filter}' found.`);
      return;
    }

    console.log(`📋 Environment Variables (${filteredKeys.length} items):\n`);
    console.log('─'.repeat(60));

    for (const key of filteredKeys) {
      if (keysOnly) {
        console.log(key);
      } else {
        console.log(`${key}=${secrets[key]}`);
      }
    }

    console.log('─'.repeat(60));

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
