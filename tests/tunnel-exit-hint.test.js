const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { tunnelExitHint } = require(path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'db-utils.js'));

test('新建隧道的退出提示带 pid、端口、目标和可直接复制的 kill 命令', () => {
  const s = tunnelExitHint(['1140872'], 25435, 'pgm-x.pg.rds.aliyuncs.com');
  assert.match(s, /pid 1140872/);
  assert.match(s, /localhost:25435 → pgm-x\.pg\.rds\.aliyuncs\.com/);
  assert.match(s, /`kill 1140872`/);
  assert.match(s, /不会替你关/);
});
test('lsof 查不到 pid 时给按端口关的命令，而不是空的 kill', () => {
  const s = tunnelExitHint([], 25432, 'h');
  assert.match(s, /pid 未知/);
  assert.match(s, /`lsof -ti:25432 \| xargs kill`/);
  assert.doesNotMatch(s, /`kill `/);
});
test('多个 pid 都列出来', () => {
  assert.match(tunnelExitHint(['1', '2'], 1, 'h'), /pid 1,2.*`kill 1 2`/);
});

const { spawn } = require('node:child_process');
const DB_UTILS = path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'db-utils.js');
function runAndSignal(signal) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', `
      require(${JSON.stringify(DB_UTILS)}).announceTunnelOnExit(['4242'], 25435, 'h');
      process.stdout.write('ready\\n');
      setInterval(() => {}, 1000);
    `]);
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', (d) => { if (String(d).includes('ready')) child.kill(signal); });
    child.on('close', (code, sig) => resolve({ code, sig, err }));
  });
}
for (const [signal, want] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`🔴 ${signal}（Ctrl-C / kill）时也打印隧道提示，且按 128+signo 退出`, async () => {
    const r = await runAndSignal(signal);
    assert.equal(r.code, want);
    assert.match(r.err, /pid 4242/);
    assert.equal((r.err.match(/本次新开了 DB 隧道/g) || []).length, 1, '只打一次');
  });
}
test('正常退出时照样打印一次（对照）', async () => {
  const r = await new Promise((resolve) => {
    const c = spawn(process.execPath, ['-e', `require(${JSON.stringify(DB_UTILS)}).announceTunnelOnExit(['7'], 1, 'h');`]);
    let err = ''; c.stderr.on('data', (d) => { err += d; }); c.on('close', (code) => resolve({ code, err }));
  });
  assert.equal(r.code, 0);
  assert.equal((r.err.match(/本次新开了 DB 隧道/g) || []).length, 1);
});
