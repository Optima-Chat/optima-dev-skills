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
