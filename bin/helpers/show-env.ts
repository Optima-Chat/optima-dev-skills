#!/usr/bin/env node

import { execSync } from 'child_process';

interface InfisicalConfig {
  url: string;
  clientId: string;
  clientSecret: string;
  projectId: string;
}

// 支持的服务列表（Infisical 路径为 /services/<service-name>）
const SUPPORTED_SERVICES = [
  'commerce-backend',
  'user-auth',
  'agentic-chat',
  'bi',
  'session-gateway',
  'optima-store',
  'optima-scout',
  'mcp-host'
];

// 环境到 Infisical environment 的映射
const ENV_MAP: Record<string, string> = {
  stage: 'staging',
  prod: 'prod'
};

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
  environment  Environment (stage, prod)

Options:
  --filter     Filter by key pattern (e.g., --filter DATABASE)
  --keys-only  Show only key names, not values
  --help       Show this help message

Examples:
  optima-show-env commerce-backend stage
  optima-show-env user-auth prod --filter DATABASE
  optima-show-env bi stage --keys-only
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
  if (!ENV_MAP[environment]) {
    console.error(`Error: Unknown environment '${environment}'`);
    console.error('Available environments: stage, prod');
    process.exit(1);
  }

  // Infisical 路径为 /services/<service-name>
  const secretPath = `/services/${service}`;

  console.log(`\n🔍 Fetching environment variables for ${service} (${environment.toUpperCase()})...\n`);

  try {
    const infisicalConfig = getInfisicalConfig();
    console.log('✓ Loaded Infisical config from GitHub Variables');

    const token = getInfisicalToken(infisicalConfig);
    console.log('✓ Obtained Infisical access token');

    const infisicalEnv = ENV_MAP[environment];
    const secrets = getInfisicalSecrets(infisicalConfig, token, infisicalEnv, secretPath);
    console.log(`✓ Retrieved secrets from Infisical (path: ${secretPath})\n`);

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
