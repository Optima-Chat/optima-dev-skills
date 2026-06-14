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

    log('Available Commands:', 'yellow');
    log('  optima-query-db <service> "<sql>" [env]              Query database', 'cyan');
    log('  optima-show-env <service> [env]                      Show service env vars', 'cyan');
    log('  optima-verify-health <service> [--env cn|prod|all]   Probe L1-L5 上线健康', 'cyan');
    log('  optima-generate-test-token [--env production]        Generate test token', 'cyan');
    log('  optima-grant-balance <email> --amount <usd> [--env]  Grant USD wallet balance', 'cyan');
    log('  optima-grant-subscription <email|phone|userId> --plan <p> [--env] Grant subscription', 'cyan');
    log('  /logs <service> [lines] [env]                        View service logs (skill)', 'cyan');
    log('  /restart-ecs <service> [env]                         Restart ECS service (skill)', 'cyan');

    log('\nSupported Services:', 'yellow');
    log('  commerce-backend  user-auth  mcp-host  agentic-chat  optima-logistics', 'cyan');
    log('  session-gateway  optima-scout  billing  browser-backend  optima-generation', 'cyan');

    log('\nEnvironments:', 'yellow');
    log('  stage (default)   prod', 'cyan');

    log('\nExamples:', 'yellow');
    log('  /logs commerce-backend 100 prod', 'cyan');
    log('  optima-query-db user-auth "SELECT COUNT(*) FROM users" prod', 'cyan');
    log('  optima-grant-balance user@example.com --amount 5 --env prod', 'cyan');

    log('\nMore Info:', 'yellow');
    log('  optima-dev-skills --version              Show version', 'cyan');
    log('  <command> --help                         Show command help', 'cyan');
    log('  https://github.com/Optima-Chat/optima-dev-skills\n', 'cyan');
    break;
}
