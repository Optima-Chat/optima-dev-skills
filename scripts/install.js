#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SKILLS_SOURCE = path.join(__dirname, '..', '.claude');
const COMMANDS_DEST = path.join(CLAUDE_DIR, 'commands', 'logs');
const SKILLS_DEST = path.join(CLAUDE_DIR, 'skills', 'scenarios', 'viewing-logs');

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
  const commandsSource = path.join(SKILLS_SOURCE, 'commands', 'logs');
  if (fs.existsSync(commandsSource)) {
    copyRecursive(commandsSource, COMMANDS_DEST);
    log(`✓ Installed /logs command to ${COMMANDS_DEST}`, 'green');
  } else {
    log(`✗ Commands not found at ${commandsSource}`, 'red');
  }

  // 安装 skills
  const skillsSource = path.join(SKILLS_SOURCE, 'skills', 'scenarios', 'viewing-logs');
  if (fs.existsSync(skillsSource)) {
    copyRecursive(skillsSource, SKILLS_DEST);
    log(`✓ Installed viewing-logs skill to ${SKILLS_DEST}`, 'green');
  } else {
    log(`✗ Skills not found at ${skillsSource}`, 'red');
  }

  log('\n✨ Installation complete!\n', 'green');
  log('Available commands:', 'blue');
  log('  /logs <service> [lines] [environment]', 'yellow');
  log('\nExamples:', 'blue');
  log('  /logs commerce-backend              # Stage, 50 lines', 'yellow');
  log('  /logs user-auth 100                 # Stage, 100 lines', 'yellow');
  log('  /logs mcp-host 200 prod             # Prod, 200 lines', 'yellow');
  log('\nDocumentation: https://github.com/Optima-Chat/optima-dev-skills\n', 'blue');
}

try {
  install();
} catch (error) {
  log(`\n✗ Installation failed: ${error.message}\n`, 'red');
  process.exit(1);
}
