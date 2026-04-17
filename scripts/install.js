#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SKILLS_SOURCE = path.join(__dirname, '..', '.claude');
const CODEX_DIR = process.env.CODEX_HOME
  ? path.resolve(process.env.CODEX_HOME)
  : path.join(os.homedir(), '.codex');
const CODEX_SOURCE = path.join(__dirname, '..', '.codex');
const COMMANDS_DEST = path.join(CLAUDE_DIR, 'commands');
const SKILLS_DEST = path.join(CLAUDE_DIR, 'skills');
const CODEX_SKILLS_DEST = path.join(CODEX_DIR, 'skills', 'optima-dev');

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

  // 确保目录存在
  if (!fs.existsSync(CLAUDE_DIR)) {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    log(`✓ Created ${CLAUDE_DIR}`, 'green');
  }
  if (!fs.existsSync(COMMANDS_DEST)) {
    fs.mkdirSync(COMMANDS_DEST, { recursive: true });
  }
  if (!fs.existsSync(SKILLS_DEST)) {
    fs.mkdirSync(SKILLS_DEST, { recursive: true });
  }

  // 动态安装所有 commands
  const commandsSource = path.join(SKILLS_SOURCE, 'commands');
  if (fs.existsSync(commandsSource)) {
    const commands = fs.readdirSync(commandsSource).filter(f => f.endsWith('.md'));
    commands.forEach(cmd => {
      const src = path.join(commandsSource, cmd);
      const dest = path.join(COMMANDS_DEST, cmd);
      fs.copyFileSync(src, dest);
      const cmdName = cmd.replace('.md', '');
      log(`✓ Installed /${cmdName} command`, 'green');
    });
  }

  // 动态安装所有 skills
  const skillsSource = path.join(SKILLS_SOURCE, 'skills');
  if (fs.existsSync(skillsSource)) {
    const skills = fs.readdirSync(skillsSource).filter(f => {
      return fs.statSync(path.join(skillsSource, f)).isDirectory();
    });
    skills.forEach(skill => {
      const src = path.join(skillsSource, skill);
      const dest = path.join(SKILLS_DEST, skill);
      copyRecursive(src, dest);
      log(`✓ Installed ${skill} skill`, 'green');
    });
  }

  // 动态安装所有 Codex skills
  const codexSkillsSource = path.join(CODEX_SOURCE, 'skills');
  if (fs.existsSync(codexSkillsSource)) {
    if (!fs.existsSync(CODEX_SKILLS_DEST)) {
      fs.mkdirSync(CODEX_SKILLS_DEST, { recursive: true });
    }
    const skills = fs.readdirSync(codexSkillsSource).filter(f => {
      return fs.statSync(path.join(codexSkillsSource, f)).isDirectory();
    });
    skills.forEach(skill => {
      const src = path.join(codexSkillsSource, skill);
      const dest = path.join(CODEX_SKILLS_DEST, skill);
      copyRecursive(src, dest);
      log(`✓ Installed Codex ${skill} skill`, 'green');
    });
  }

  log('\n✨ Installation complete!\n', 'green');
  log('Run /help in Claude Code to see available commands.\n', 'blue');
  log(`Codex skills installed to: ${CODEX_SKILLS_DEST}\n`, 'blue');
  log('Documentation: https://github.com/Optima-Chat/optima-dev-skills\n', 'blue');
}

try {
  install();
} catch (error) {
  log(`\n✗ Installation failed: ${error.message}\n`, 'red');
  process.exit(1);
}
