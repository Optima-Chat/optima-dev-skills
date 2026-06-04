#!/usr/bin/env node

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface RegisterResponse {
  email: string;
  user_id: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
}

interface MerchantSetupResponse {
  merchant_id: string;
  business_name: string;
  user_id: string;
}

type Environment = 'ci' | 'stage' | 'prod' | 'cn-prod';

interface EnvironmentConfig {
  authUrl: string;
  apiUrl: string;
  clientId: string;
  envName: string;
}

const ENV_CONFIG: Record<Environment, EnvironmentConfig> = {
  ci: {
    authUrl: 'https://auth.optima.chat',
    apiUrl: 'https://api.optima.chat',
    clientId: 'dev-skill-cli-he7fjmsp',
    envName: 'ci'
  },
  stage: {
    authUrl: 'https://auth.stage.optima.onl',
    apiUrl: 'https://api.stage.optima.onl',
    clientId: 'commerce-cli-stage-ihbbwplz',
    envName: 'stage'
  },
  prod: {
    authUrl: 'https://auth.optima.onl',
    apiUrl: 'https://api.optima.onl',
    clientId: 'commerce-cli-ecs-pro-i2r5of1h',
    envName: 'prod'
  },
  'cn-prod': {
    // 阿里云 cn-beijing 部署 (SAE),Infisical 引导
    // 注: commerce-backend 在 W4 才上线 (Optima-Chat/optima-terraform#52),
    // 在那之前 setupMerchantProfile 会因 commerce 不可达 graceful 跳过 (使用 --skip-merchant 显式)
    authUrl: 'https://auth-cn.optima.chat',
    apiUrl: 'https://commerce-backend-cn.optima.chat',
    clientId: 'dev-skill-cli-cn-pro-acvkmcuq',
    envName: 'cn-prod'
  }
};

async function httpRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

async function registerMerchant(
  email: string,
  password: string,
  businessName: string,
  config: EnvironmentConfig,
  phone?: string,
  address?: string
): Promise<RegisterResponse> {
  console.log(`\n📝 Registering merchant: ${email}...`);

  const payload: any = { email, password, business_name: businessName };
  if (phone) payload.phone = phone;
  if (address) payload.address = address;

  try {
    const result = await httpRequest<RegisterResponse>(`${config.authUrl}/api/v1/auth/register/merchant`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    console.log(`✓ Merchant registered successfully (ID: ${result.user_id})`);
    return result;
  } catch (error: any) {
    if (error.message.includes('409') || error.message.includes('already exists')) {
      console.log(`ℹ Merchant already exists, proceeding to login...`);
      return { email, user_id: '', role: 'merchant', is_active: true, created_at: '', updated_at: '' };
    }
    throw error;
  }
}

async function getToken(email: string, password: string, config: EnvironmentConfig): Promise<string> {
  console.log(`\n🔑 Obtaining access token...`);

  const formData = new URLSearchParams();
  formData.append('username', email);
  formData.append('password', password);
  formData.append('grant_type', 'password');
  formData.append('client_id', config.clientId);

  const result = await httpRequest<TokenResponse>(`${config.authUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  });

  console.log(`✓ Access token obtained`);
  return result.access_token;
}

async function setupMerchantProfile(token: string, businessName: string, config: EnvironmentConfig): Promise<MerchantSetupResponse> {
  console.log(`\n🏪 Setting up merchant profile in Commerce API...`);

  const payload = {
    name: businessName,
    origin_country_alpha2: 'CN',
    origin_city: '深圳',
    origin_state: '广东省',
    origin_line_1: '南山区科技园',
    contact_name: '测试用户',
    contact_phone: '+8613800138000',
    contact_email: 'test@example.com'
  };

  try {
    const result = await httpRequest<MerchantSetupResponse>(`${config.apiUrl}/api/merchants/me`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    console.log(`✓ Merchant profile setup complete (ID: ${result.merchant_id})`);
    return result;
  } catch (error: any) {
    if (error.message.includes('409') || error.message.includes('already exists')) {
      console.log(`ℹ Merchant profile already exists`);
      return { merchant_id: '', business_name: businessName, user_id: '' };
    }
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  // 生成随机测试账户
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const defaultEmail = `test_${timestamp}_${randomStr}@example.com`;
  const defaultPassword = 'TestPassword123!';
  const defaultBusinessName = `Test Merchant ${timestamp}`;

  let email = defaultEmail;
  let password = defaultPassword;
  let businessName = defaultBusinessName;
  let phone: string | undefined;
  let address: string | undefined;
  let environment: Environment = 'ci';
  let skipMerchant = false;

  // 解析命令行参数
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--email' && args[i + 1]) {
      email = args[++i];
    } else if (arg === '--password' && args[i + 1]) {
      password = args[++i];
    } else if (arg === '--business-name' && args[i + 1]) {
      businessName = args[++i];
    } else if (arg === '--phone' && args[i + 1]) {
      phone = args[++i];
    } else if (arg === '--address' && args[i + 1]) {
      address = args[++i];
    } else if (arg === '--env' && args[i + 1]) {
      const envArg = args[++i];
      if (envArg === 'ci' || envArg === 'stage' || envArg === 'prod' || envArg === 'cn-prod') {
        environment = envArg as Environment;
      } else {
        console.error(`❌ Invalid environment: ${envArg}. Must be 'ci', 'stage', 'prod', or 'cn-prod'.`);
        process.exit(1);
      }
    } else if (arg === '--skip-merchant') {
      skipMerchant = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: optima-generate-test-token [options]

Options:
  --email <email>              User email (default: auto-generated)
  --password <password>        User password (default: TestPassword123!)
  --business-name <name>       Merchant business name (default: auto-generated)
  --phone <phone>              Merchant phone number (optional)
  --address <address>          Merchant address (optional)
  --env <environment>          Environment: ci (default), stage, prod, or cn-prod
  --skip-merchant              Skip Commerce API merchant profile setup (auth + token only)
  --help, -h                   Show this help message

Environments:
  ci       CI 环境 (auth.optima.chat, api.optima.chat)
  stage    Stage 环境 (auth.stage.optima.onl, api.stage.optima.onl)
  prod     Prod 环境 (auth.optima.onl, api.optima.onl)
  cn-prod  阿里云 cn-prod (auth-cn.optima.chat, commerce-backend-cn.optima.chat)
           注: cn commerce-backend 计划 W4 上线,在那之前用 --skip-merchant

Example:
  optima-generate-test-token
  optima-generate-test-token --env stage
  optima-generate-test-token --env prod
  optima-generate-test-token --env cn-prod --skip-merchant
  optima-generate-test-token --business-name "My Test Shop" --env stage
      `);
      process.exit(0);
    }
  }

  const config = ENV_CONFIG[environment];

  try {
    console.log('🚀 Starting test token generation...\n');
    console.log(`Environment: ${config.envName}`);
    console.log(`Auth API: ${config.authUrl}`);
    console.log(`Commerce API: ${config.apiUrl}\n`);
    console.log(`Using credentials:`);
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${password}`);
    console.log(`  Business Name: ${businessName}`);

    // 1. 注册 merchant（直接注册为商家）
    const user = await registerMerchant(email, password, businessName, config, phone, address);

    // 2. 获取 token
    const token = await getToken(email, password, config);

    // 3. 设置 merchant profile（Commerce API）- 可 skip
    let merchantProfile: MerchantSetupResponse;
    if (skipMerchant) {
      console.log(`\n⏭  Skipping Commerce API merchant profile setup (--skip-merchant)`);
      merchantProfile = { merchant_id: '', business_name: businessName, user_id: '' };
    } else {
      merchantProfile = await setupMerchantProfile(token, businessName, config);
    }

    // 4. 保存 token 到临时文件
    const tmpDir = os.tmpdir();
    const tokenFileName = `optima-test-token-${Date.now()}.txt`;
    const tokenFilePath = path.join(tmpDir, tokenFileName);

    fs.writeFileSync(tokenFilePath, token, 'utf-8');
    console.log(`\n💾 Token saved to temporary file`);

    // 输出结果
    console.log('\n' + '='.repeat(80));
    console.log('✅ Test token generated successfully!\n');
    console.log('📋 Details:');
    console.log(`  Environment:   ${config.envName}`);
    console.log(`  Email:         ${email}`);
    console.log(`  Password:      ${password}`);
    console.log(`  User ID:       ${user.user_id || 'N/A'}`);
    console.log(`  Role:          ${user.role}`);
    console.log(`  Business Name: ${businessName}`);
    console.log(`  Merchant ID:   ${merchantProfile.merchant_id || 'N/A'}\n`);
    console.log('📁 Token File Path:');
    console.log(`  ${tokenFilePath}\n`);
    console.log('💡 Usage Examples:');
    console.log(`  # Read token from file:`);
    console.log(`  TOKEN=$(cat ${tokenFilePath})\n`);
    console.log(`  # Use with commerce CLI:`);
    console.log(`  OPTIMA_TOKEN=$(cat ${tokenFilePath}) OPTIMA_ENV=${config.envName} commerce product list\n`);
    console.log(`  # Use in curl:`);
    console.log(`  curl -H "Authorization: Bearer $(cat ${tokenFilePath})" ${config.apiUrl}/api/products\n`);
    console.log('='.repeat(80));

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
