const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { tunnelExitHint } = require(path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'db-utils.js'));

test('新建隧道的退出提示带 pid、端口、目标，并说明它常驻', () => {
  const s = tunnelExitHint(['1140872'], 25435, 'pgm-x.pg.rds.aliyuncs.com');
  assert.match(s, /pid 1140872/);
  assert.match(s, /localhost:25435 → pgm-x\.pg\.rds\.aliyuncs\.com/);
  assert.match(s, /不会替你关/);
});

// 🔴 #139 / global-review：隧道跨会话共享（注册表所有会话共用、ensureTunnel 健康就复用、
// 不看是谁开的）⇒ 这行提示只有新开的会话收得到、复用的收不到 ⇒ 给 kill 命令会让 A 关掉
// B 正在复用的隧道、打断 B 的查询（2026-10-30 实撞两次）。下面三格钉住「不再教关」：
// 谁把 kill / lsof 兜底加回来，它们就红。
test('🔴 提示里不给任何 kill 命令（有 pid 时）', () => {
  const s = tunnelExitHint(['1140872'], 25435, 'h');
  assert.doesNotMatch(s, /kill/);
  assert.doesNotMatch(s, /lsof/);
});
test('🔴 pid 查不到时也不给按端口 kill 的兜底', () => {
  const s = tunnelExitHint([], 25432, 'h');
  assert.match(s, /pid 未知/);
  assert.doesNotMatch(s, /kill/);
  assert.doesNotMatch(s, /lsof -ti/);
});
test('🔴 提示要说明「可能被别的会话复用」且叫人别关，并指向 SKILL.md', () => {
  const s = tunnelExitHint(['1'], 1, 'h');
  assert.match(s, /可能被别的会话复用/);
  assert.match(s, /不要顺手关掉/);
  assert.match(s, /SKILL\.md/);
});
test('多个 pid 都列出来', () => {
  assert.match(tunnelExitHint(['1', '2'], 1, 'h'), /pid 1,2/);
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
