const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// 测编译产物（package bin 指向 dist/）——`npm test` 的 pretest 会先 build。
const CLI = path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'verify-health.js');
const { parseArgs } = require(CLI);

// 下面这几种写法此前都会被静默无视、回落默认 cn-prod：想探 stage，实际探的是阿里云生产，还 exit 0。

test('--env=stage 等号写法生效（同 query-db.ts）', () => {
  assert.equal(parseArgs(['user-auth', '--env=stage']).env, 'stage');
  assert.equal(parseArgs(['user-auth', '--env', 'stage']).env, 'stage');
});

// --expect-commit 同病：等号写法丢了，L4 就只「展示」commit 不比对，发布卡口形同虚设。
test('--expect-commit=<sha> 等号写法生效', () => {
  assert.equal(parseArgs(['user-auth', '--expect-commit=a1b2c3d']).expect, 'a1b2c3d');
});

test('--env 漏写取值报错，而不是回落 cn-prod', () => {
  assert.throws(() => parseArgs(['user-auth', '--env']), /--env 缺少取值/);
  assert.throws(() => parseArgs(['user-auth', '--env=']), /--env 缺少取值/);
  // 此前这条报的是「未知环境:--json」——把下一个旗标当成了环境名。
  assert.throws(() => parseArgs(['user-auth', '--env', '--json']), /--env 缺少取值/);
});

test('拼错的旗标报错，而不是被静默无视', () => {
  assert.throws(() => parseArgs(['user-auth', '--evn', 'stage']), /未知参数:--evn/);
});

// 兄弟命令 optima-query-db / optima-show-env 的环境是位置参数，照那个习惯敲很自然。
test('多余位置参数报错（`user-auth stage` 不能静默探 cn-prod）', () => {
  assert.throws(() => parseArgs(['user-auth', 'stage']), /多余参数:stage/);
});

test('未知服务报错，而不是甩一屏 usage', () => {
  assert.throws(() => parseArgs(['mcp-host', '--env', 'stage']), /未知服务:mcp-host/);
});

test('不回归：默认 cn-prod、cn 是 cn-prod 的别名、拼错的环境名报错', () => {
  assert.equal(parseArgs(['user-auth']).env, 'cn-prod');
  assert.equal(parseArgs(['user-auth', '--env', 'cn']).env, 'cn-prod');
  assert.throws(() => parseArgs(['user-auth', '--env', 'cnprod']), /未知环境:cnprod/);
});

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// 只挑修前修后都不会发出真实探测的调用（修前这两条都落到 usage 分支）。
test('cli: 参数错误打 ❌ 到 stderr 并 exit 2，不甩 usage', () => {
  for (const [args, re] of [
    [['mcp-host', '--env', 'stage'], /❌ 未知服务:mcp-host/],
    [['--env'], /❌ --env 缺少取值/],
  ]) {
    const r = runCli(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, re);
    assert.equal(r.stdout, '', `${args.join(' ')} 不该打 usage`);
  }
});
