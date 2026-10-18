const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = process.env.CN_DEPLOY_TEST_CLI || path.resolve(__dirname, '../dist/bin/helpers/cn-deploy.js');
const appId = 'f18f4750-33f7-4e60-a3e5-2185e6efe89e';

function run(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-deploy-start-'));
  const log = path.join(dir, 'calls.jsonl');
  const stub = `#!${process.execPath}\n` + String.raw`
const fs = require('node:fs'), path = require('node:path');
const bin = path.basename(process.argv[1]), args = process.argv.slice(2);
const log = process.env.CALL_LOG, options = JSON.parse(process.env.STUB_OPTIONS);
const previous = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
fs.appendFileSync(log, JSON.stringify({ bin, args, time: Date.now() }) + '\n');
const action = args[1], nth = previous.filter(c => c.bin === bin && c.args[1] === action).length + 1;
const value = flag => args[args.indexOf('--' + flag) + 1];
const emit = data => console.log(JSON.stringify(data));
if (options.action) { console.log('broken'); process.exit(0); }
if (bin === 'gh') {
  console.log(args.join(' ').includes('/commits/') ? 'a'.repeat(40) : 'run: git push codeup HEAD:main');
} else if (args[0] === 'sae') {
  emit({ Data: { ImageUrl: 'registry/optima-auth:aaaaaaaaaa' } });
} else if (action === 'ListRepositories') {
  if (nth <= (options.readFailures || 0)) console.log('broken');
  else emit({ result: [{ name: 'optima-gateway', Id: 1 }, { name: 'optima-auth', Id: 2 }] });
} else if (['GetBranchInfo', 'GetRepositoryTag'].includes(action)) {
  if (options.mirrorFailures && nth >= 2 && nth <= 4) console.log('broken');
  else emit({ result: { commit: { id: options.mirrorFailures && nth === 1 ? 'old' : 'a'.repeat(40) } } });
} else if (action === 'ListPipelines') {
  emit({ pipelines: [{ pipelineName: (options.service || 'agent-runtime') + '-cn-stage', pipelineId: 123 }] });
} else if (action === 'StartPipelineRun') {
  if (options.start === 'valid' || nth > 1) emit({ pipelineRunId: 999 });
  else if (options.start === 'exit') process.exit(1);
  else if (options.start !== 'empty') console.log('broken');
} else if (action === 'ListPipelineRuns') {
  if (options.listBroken) { console.log('broken'); process.exit(0); }
  if (options.listError) { emit({ success: false }); process.exit(0); }
  const start = Number(value('startTime')), end = Number(value('endTime'));
  const all = [{ pipelineRunId: 90, startTime: start - 1 },
    ...Array.from({ length: options.matches ?? 1 }, (_, i) => ({ pipelineRunId: 112 + i, startTime: end })),
    { pipelineRunId: 91, startTime: end + 1 }];
  if (options.paginate) {
    emit({ success: true, pipelineRuns: value('nextToken') === '0' ? all.slice(0, 2) : all.slice(2),
      nextToken: value('nextToken') === '0' ? 'page2' : '' });
  } else emit({ success: true, pipelineRuns: all, nextToken: '' });
} else if (action === 'GetPipelineRun') {
  if (options.pollFailures && nth >= 2 && nth <= 4) console.log('broken');
  else emit({ pipelineRun: { status: options.pollFailures && nth === 1 ? 'RUNNING' : 'SUCCESS' } });
} else console.log('broken');
`;
  for (const bin of ['gh', 'aliyun']) fs.writeFileSync(path.join(dir, bin), stub, { mode: 0o755 });
  // Keep the real polling loops, but skip their 10s/45s delays in the child CLI.
  const fastTimers = path.join(dir, 'fast-timers.cjs');
  fs.writeFileSync(fastTimers, 'const timer = global.setTimeout; global.setTimeout = (fn, ms, ...args) => timer(fn, 0, ...args);');
  try {
    const args = options.action
      ? ['-e', 'console.log(JSON.stringify(require(process.argv[1]).devops(process.argv[2], {})))', cli, options.action]
      : ['--require', fastTimers, cli, options.service || 'agent-runtime', ...(options.wait ? [] : ['--no-wait']), ...(options.args || [])];
    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH,
        CALL_LOG: log, STUB_OPTIONS: JSON.stringify(options) },
    });
    assert.ifError(result.error);
    return { ...result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const callsFor = (result, action) => result.calls.filter(c => c.bin === 'aliyun' && c.args[1] === action);

for (const start of ['invalid', 'empty', 'exit']) {
  test(`Start ${start} response: one call, recover exactly one run and print its id`, () => {
    const result = run({ start, matches: 1 });
    assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /run#112 已启动/);
    assert.doesNotMatch(result.stdout, /run#999/);
    const query = callsFor(result, 'ListPipelineRuns')[0].args;
    const startTime = Number(query[query.indexOf('--startTime') + 1]);
    const endTime = Number(query[query.indexOf('--endTime') + 1]);
    assert.ok(startTime <= callsFor(result, 'StartPipelineRun')[0].time);
    assert.ok(endTime >= startTime);
    assert.equal(query[query.indexOf('--pipelineId') + 1], '123');
  });
}

test('Start parse failure with zero matches exits without resending Start', () => {
  const result = run({ matches: 0 });
  assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /0 条 run.*不会重试启动/);
  assert.doesNotMatch(result.stdout, /已启动/);
});

test('two matches across pages list every candidate and never cancel a run', () => {
  const result = run({ matches: 2, paginate: true });
  assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
  assert.equal(result.status, 1);
  assert.equal(callsFor(result, 'ListPipelineRuns').length, 2);
  assert.match(result.stderr, /runId: 112, 113.*人工处理/);
  assert.ok(!result.calls.some(c => /^(Stop|Cancel)/.test(c.args[1])));
});

test('valid Start response bypasses recovery', () => {
  const result = run({ start: 'valid' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
  assert.equal(callsFor(result, 'ListPipelineRuns').length, 0);
  assert.match(result.stdout, /run#999 已启动/);
});

test('read-only API still retries parse failures and succeeds on third attempt', () => {
  const result = run({ start: 'valid', readFailures: 2 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(callsFor(result, 'ListRepositories').length, 3);
});

test('polling continues after three malformed responses mid-run and reaches SUCCESS', () => {
  const result = run({ start: 'valid', wait: true, pollFailures: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(callsFor(result, 'GetPipelineRun').length, 5);
  assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
  assert.equal(callsFor(result, 'ListPipelineRuns').length, 0);
  assert.match(result.stdout, /run#999 已启动/);
  assert.match(result.stdout, /run#999: SUCCESS/);
});

for (const [action, args] of [['GetBranchInfo', []], ['GetRepositoryTag', ['--vtag', 'cn-v1.2.3']]]) {
  test(`mirror ${action} continues after three malformed responses and catches up`, () => {
    const result = run({ start: 'valid', mirrorFailures: true, args });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(callsFor(result, action).length, 5);
    assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
    const mirrorCalls = callsFor(result, action);
    assert.ok(mirrorCalls.at(-1).time <= callsFor(result, 'StartPipelineRun')[0].time);
    assert.match(result.stdout, /mirror 已追平/);
    assert.match(result.stdout, /run#999 已启动/);
  });
}

for (const action of ['StartPipelineRun', 'StopPipelineRun', 'CreatePipeline', 'UpdatePipeline']) {
  test(`${action} does not retry malformed responses`, () => {
    const result = run({ action });
    assert.equal(result.status, 1);
    assert.equal(callsFor(result, action).length, 1);
  });
}
for (const action of ['ListPipelines', 'GetPipelineRun']) {
  test(`${action} prefix retains three attempts on malformed responses`, () => {
    const result = run({ action });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {});
    assert.equal(callsFor(result, action).length, 3);
  });
}

test('unreadable recovery list exits after read retries without resending Start', () => {
  const result = run({ listBroken: true });
  assert.equal(result.status, 1);
  assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
  assert.equal(callsFor(result, 'ListPipelineRuns').length, 3);
  assert.match(result.stderr, /ListPipelineRuns 查询失败/);
});

test('failed recovery list cannot be interpreted as zero or one matches', () => {
  const result = run({ listError: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ListPipelineRuns 查询失败/);
  assert.doesNotMatch(result.stdout, /已启动/);
});

test('optima-auth stage resolves its repo and pipeline and checks its SAE app', () => {
  const result = run({ service: 'optima-auth', start: 'valid', wait: true });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls.some(c => c.bin === 'gh' && c.args.includes('repos/Optima-Chat/optima-auth/commits/main')));
  assert.equal(callsFor(result, 'StartPipelineRun').length, 1);
  assert.ok(result.calls.some(c => c.bin === 'aliyun' && c.args.includes(appId)));
});

for (const args of [['--env', 'prod'], ['--env', 'prod', '--vtag', 'cn-v1.2.3']]) {
  test(`optima-auth prod is explicitly rejected before external calls (${args.join(' ')})`, () => {
    const result = run({ service: 'optima-auth', args });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /prod 尚无 optima-auth 流水线/);
    assert.deepEqual(result.calls, []);
  });
}
