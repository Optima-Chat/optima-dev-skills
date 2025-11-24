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

type Environment = 'development' | 'production';

interface EnvironmentConfig {
  authUrl: string;
  apiUrl: string;
  clientId: string;
  envName: string;
}

const ENV_CONFIG: Record<Environment, EnvironmentConfig> = {
  development: {
    authUrl: 'https://auth.optima.chat',
    apiUrl: 'https://api.optima.chat',
    clientId: 'dev-skill-cli-he7fjmsp',
    envName: 'development'
  },
  production: {
    authUrl: 'https://auth.optima.shop',
    apiUrl: 'https://api.optima.shop',
    clientId: 'dev-skill-cli-0cyyqxox',
    envName: 'production'
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
  let environment: Environment = 'development';

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
      if (envArg === 'development' || envArg === 'production') {
        environment = envArg;
      } else {
        console.error(`❌ Invalid environment: ${envArg}. Must be 'development' or 'production'.`);
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: generate-test-token [options]

Options:
  --email <email>              User email (default: auto-generated)
  --password <password>        User password (default: TestPassword123!)
  --business-name <name>       Merchant business name (default: auto-generated)
  --phone <phone>              Merchant phone number (optional)
  --address <address>          Merchant address (optional)
  --env <environment>          Environment: development (default) or production
  --help, -h                   Show this help message

Example:
  generate-test-token
  generate-test-token --env production
  generate-test-token --business-name "My Test Shop" --phone "+1234567890"
  generate-test-token --email "custom@example.com" --password "MyPass123" --env production
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

    // 3. 设置 merchant profile（Commerce API）
    const merchantProfile = await setupMerchantProfile(token, businessName, config);

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
