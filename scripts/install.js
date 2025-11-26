#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SKILLS_SOURCE = path.join(__dirname, '..', '.claude');
const COMMANDS_DEST = path.join(CLAUDE_DIR, 'commands');
const LOGS_SKILL_DEST = path.join(CLAUDE_DIR, 'skills', 'logs');
const QUERY_DB_SKILL_DEST = path.join(CLAUDE_DIR, 'skills', 'query-db');
const GENERATE_TOKEN_SKILL_DEST = path.join(CLAUDE_DIR, 'skills', 'generate-test-token');
const USE_COMMERCE_CLI_SKILL_DEST = path.join(CLAUDE_DIR, 'skills', 'use-commerce-cli');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }

  if (fs.statSync(src).isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const files = fs.readdirSync(src);
    files.forEach(file => {
      copyRecursive(path.join(src, file), path.join(dest, file));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function install() {
  log('\n🚀 Installing Optima Dev Skills...\n', 'blue');

  // 确保 .claude 目录存在
  if (!fs.existsSync(CLAUDE_DIR)) {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    log(`✓ Created ${CLAUDE_DIR}`, 'green');
  }

  // 安装命令
  if (!fs.existsSync(COMMANDS_DEST)) {
    fs.mkdirSync(COMMANDS_DEST, { recursive: true });
  }

  // 安装 /logs 命令
  const logsCommandSource = path.join(SKILLS_SOURCE, 'commands', 'logs.md');
  const logsCommandDest = path.join(COMMANDS_DEST, 'logs.md');
  if (fs.existsSync(logsCommandSource)) {
    fs.copyFileSync(logsCommandSource, logsCommandDest);
    log(`✓ Installed /logs command`, 'green');
  }

  // 安装 /query-db 命令
  const queryDbCommandSource = path.join(SKILLS_SOURCE, 'commands', 'query-db.md');
  const queryDbCommandDest = path.join(COMMANDS_DEST, 'query-db.md');
  if (fs.existsSync(queryDbCommandSource)) {
    fs.copyFileSync(queryDbCommandSource, queryDbCommandDest);
    log(`✓ Installed /query-db command`, 'green');
  }

  // 安装 /generate-test-token 命令
  const generateTokenCommandSource = path.join(SKILLS_SOURCE, 'commands', 'generate-test-token.md');
  const generateTokenCommandDest = path.join(COMMANDS_DEST, 'generate-test-token.md');
  if (fs.existsSync(generateTokenCommandSource)) {
    fs.copyFileSync(generateTokenCommandSource, generateTokenCommandDest);
    log(`✓ Installed /generate-test-token command`, 'green');
  }

  // 安装 logs skill
  const logsSkillSource = path.join(SKILLS_SOURCE, 'skills', 'logs');
  if (fs.existsSync(logsSkillSource)) {
    copyRecursive(logsSkillSource, LOGS_SKILL_DEST);
    log(`✓ Installed logs skill`, 'green');
  }

  // 安装 query-db skill
  const queryDbSkillSource = path.join(SKILLS_SOURCE, 'skills', 'query-db');
  if (fs.existsSync(queryDbSkillSource)) {
    copyRecursive(queryDbSkillSource, QUERY_DB_SKILL_DEST);
    log(`✓ Installed query-db skill`, 'green');
  }

  // 安装 generate-test-token skill
  const generateTokenSkillSource = path.join(SKILLS_SOURCE, 'skills', 'generate-test-token');
  if (fs.existsSync(generateTokenSkillSource)) {
    copyRecursive(generateTokenSkillSource, GENERATE_TOKEN_SKILL_DEST);
    log(`✓ Installed generate-test-token skill`, 'green');
  }

  // 安装 use-commerce-cli skill
  const useCommerceCliSkillSource = path.join(SKILLS_SOURCE, 'skills', 'use-commerce-cli');
  if (fs.existsSync(useCommerceCliSkillSource)) {
    copyRecursive(useCommerceCliSkillSource, USE_COMMERCE_CLI_SKILL_DEST);
    log(`✓ Installed use-commerce-cli skill`, 'green');
  }

  log('\n✨ Installation complete!\n', 'green');
  log('Available commands:', 'blue');
  log('  /logs <service> [lines] [environment]', 'yellow');
  log('  /query-db <service> <sql> [environment]', 'yellow');
  log('  /generate-test-token [options]', 'yellow');
  log('\nExamples:', 'blue');
  log('  /logs commerce-backend                                    # CI logs', 'yellow');
  log('  /query-db commerce-backend "SELECT COUNT(*) FROM orders"  # CI query', 'yellow');
  log('  optima-generate-test-token --env production              # Generate test token', 'yellow');
  log('\nDocumentation: https://github.com/Optima-Chat/optima-dev-skills\n', 'blue');
}

try {
  install();
} catch (error) {
  log(`\n✗ Installation failed: ${error.message}\n`, 'red');
  process.exit(1);
}
