const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Test the compiled dist artifacts (package main/bin point at dist/), not the
// .ts source — run `npm run build` first.
const { classifyTunnelTarget } = require(
  path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'db-utils.js'),
);

const CN_PROD = 'pgm-2zexwx9eso9e4yla.pg.rds.aliyuncs.com';
const CN_STAGE = 'pgm-2zem1u9zdh06boim.pg.rds.aliyuncs.com';
const AWS_STAGE = 'optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com';
const AWS_PROD = 'optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com';

// ── 以下两条 cmdline 均为本机实测抓取（2026-07-24），非按文档臆造 ──────────────
// cn buildbox ssh 隧道（lsof -ti:25434 → ps -o args=）
const CN_SSH_ARGS =
  'ssh -f -N -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 ' +
  `-o ExitOnForwardFailure=yes -o ConnectTimeout=12 -L 25434:${CN_PROD}:5432 root@47.94.105.163`;

// AWS SSM 隧道：持端口的是 session-manager-plugin（不是 aws CLI），argv 携带
// StartSession 请求 JSON（lsof -ti:25433 → ps -o comm=,args=）
const SSM_PLUGIN_ARGS =
  'session-manager-plugin AWS_SSM_START_SESSION_RESPONSE ap-southeast-1 StartSession  ' +
  `{"Target": "i-03286fb0a9ce7e6b1", "DocumentName": "AWS-StartPortForwardingSessionToRemoteHost", ` +
  `"Parameters": {"host": ["${AWS_STAGE}"], "portNumber": ["5432"], "localPortNumber": ["25433"]}} ` +
  'https://ssm.ap-southeast-1.amazonaws.com';

test('ssh -L 转发目标与期望一致 → match', () => {
  assert.equal(classifyTunnelTarget(CN_SSH_ARGS, CN_PROD, 25434), 'match');
});

test('ssh -L 指向另一个 RDS → mismatch（#76 核心：连错库必须被拦下）', () => {
  assert.equal(classifyTunnelTarget(CN_SSH_ARGS, CN_STAGE, 25434), 'mismatch');
  assert.equal(classifyTunnelTarget(CN_SSH_ARGS, AWS_PROD, 25434), 'mismatch');
});

test('多 -L 进程按「本端口」判定，不因其它端口命中而假 match', () => {
  // 25432 通向 stage、25433 才通向 prod：问「25432 是不是 prod」必须是 mismatch，
  // 否则会复用一条实际通向 stage 的转发 —— 正是本 issue 要防的连错库。
  const args = `ssh -N -L 25432:${CN_STAGE}:5432 -L 25433:${CN_PROD}:5432 root@h`;
  assert.equal(classifyTunnelTarget(args, CN_PROD, 25432), 'mismatch');
  assert.equal(classifyTunnelTarget(args, CN_PROD, 25433), 'match');
  assert.equal(classifyTunnelTarget(args, CN_STAGE, 25432), 'match');
});

test('-L 无空格 / 带 bind_address 的合法写法都能解析', () => {
  assert.equal(classifyTunnelTarget(`ssh -N -L25432:${CN_PROD}:5432 root@h`, CN_PROD, 25432), 'match');
  assert.equal(classifyTunnelTarget(`ssh -N -L 127.0.0.1:25432:${CN_PROD}:5432 root@h`, CN_PROD, 25432), 'match');
});

test('SSM session-manager-plugin 实测 argv（JSON 参数形态）', () => {
  assert.equal(classifyTunnelTarget(SSM_PLUGIN_ARGS, AWS_STAGE, 25433), 'match');
  assert.equal(classifyTunnelTarget(SSM_PLUGIN_ARGS, AWS_PROD, 25433), 'mismatch');
  assert.equal(classifyTunnelTarget(SSM_PLUGIN_ARGS, CN_PROD, 25433), 'mismatch');
});

test('SSM：localPortNumber 与查询端口不符 → 不当作本端口的转发', () => {
  assert.equal(classifyTunnelTarget(SSM_PLUGIN_ARGS, AWS_STAGE, 25999), 'unknown');
});

test('cmdline 里读不到转发目标 → unknown（保守回退，不误杀 warm reuse）', () => {
  assert.equal(classifyTunnelTarget('session-manager-plugin', AWS_PROD, 25432), 'unknown');
  assert.equal(classifyTunnelTarget('', CN_PROD, 25432), 'unknown');
});

test('host 大小写不敏感（DNS 名不区分大小写）', () => {
  assert.equal(classifyTunnelTarget(CN_SSH_ARGS, CN_PROD.toUpperCase(), 25434), 'match');
});

test('不传 localPort 时退化为「任一转发命中即 match」（向后兼容）', () => {
  assert.equal(classifyTunnelTarget(CN_SSH_ARGS, CN_PROD), 'match');
  assert.equal(classifyTunnelTarget(SSM_PLUGIN_ARGS, AWS_STAGE), 'match');
});
