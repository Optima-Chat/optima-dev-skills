#!/usr/bin/env node

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

const command = process.argv[2];

switch (command) {
  case 'version':
  case '-v':
  case '--version':
    const pkg = require('../package.json');
    log(`v${pkg.version}`, 'green');
    break;

  case 'help':
  case '-h':
  case '--help':
  default:
    log('\n📦 Optima Dev Skills', 'blue');
    log('\nClaude Code skills for Optima development team\n', 'cyan');

    log('Installed Commands:', 'yellow');
    log('  /logs <service> [lines] [environment]    View service logs', 'cyan');
    log('\nExamples:', 'yellow');
    log('  /logs commerce-backend                   Stage, 50 lines', 'cyan');
    log('  /logs user-auth 100                      Stage, 100 lines', 'cyan');
    log('  /logs mcp-host 200 prod                  Prod, 200 lines', 'cyan');

    log('\nSupported Services:', 'yellow');
    log('  commerce-backend  user-auth  mcp-host  agentic-chat', 'cyan');

    log('\nEnvironments:', 'yellow');
    log('  stage (default)   prod', 'cyan');

    log('\nCLI Commands:', 'yellow');
    log('  optima-dev-skills --version              Show version', 'cyan');
    log('  optima-dev-skills --help                 Show this help', 'cyan');

    log('\nDocumentation:', 'yellow');
    log('  https://github.com/Optima-Chat/optima-dev-skills\n', 'cyan');
    break;
}
