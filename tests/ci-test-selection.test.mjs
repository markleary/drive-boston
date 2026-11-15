import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {CI_EXCLUSIONS, REPO_ROOT, discoverTestFiles, parseArguments, runTests, selectTestShards} from '../scripts/run-ci-tests.mjs';

test('CI shards include every test exactly once except the four reviewed visual suites', () => {
  const files = discoverTestFiles(), excluded = [
    'building-identities.test.mjs', 'facade-uv.test.mjs',
    'neighborhood-landmarks.test.mjs', 'state-house.test.mjs',
  ];
  assert.deepEqual(Object.keys(CI_EXCLUSIONS).sort(), excluded);
  assert.ok(excluded.every(file => files.includes(file)), 'stale exclusions need review');
  const expected = files.filter(file => !excluded.includes(file)).sort();
  for (const count of [1, 3, 4]) {
    const shards = selectTestShards(files, count), selected = shards.flatMap(shard => shard.files);
    assert.equal(new Set(selected).size, selected.length, 'shards must be disjoint');
    assert.deepEqual(selected.sort(), expected, 'no allowlist gaps');
  }
  for (const file of ['collisions', 'vehicle', 'bike-recovery', 'helicopter', 'boston-highways', 'highway-ramp-connections',
    'central-artery', 'i93-runtime', 'soldiers-field-clearance', 'tunnel-passages', 'tunnel-shell-locations',
    'building-passages', 'building-undersides', 'building-clearance', 'crosswalks', 'stream-order', 'scene-memory', 'tile-resources', 'upload-release']) {
    assert.ok(expected.includes(`${file}.test.mjs`), `${file} is critical CI coverage`);
  }
});

test('discovery automatically includes new test files without weights or a manifest', t => {
  const root = mkdtempSync(join(tmpdir(), 'drive-boston-ci-selection-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'tests'));
  for (const name of ['future-driving-regression.test.mjs', 'crosswalks-extra.test.mjs', 'facade-uv.test.mjs', 'helper.mjs', 'browser.spec.ts']) {
    writeFileSync(join(root, 'tests', name), '');
  }
  mkdirSync(join(root, 'tests', 'not-a-file.test.mjs'));
  const files = discoverTestFiles(root);
  assert.deepEqual(files, ['crosswalks-extra.test.mjs', 'facade-uv.test.mjs', 'future-driving-regression.test.mjs']);
  assert.deepEqual(selectTestShards(files, 1)[0].files, ['crosswalks-extra.test.mjs', 'future-driving-regression.test.mjs']);
});

test('cost balancing is deterministic regardless of discovery order and retains each heavy file', () => {
  const files = discoverTestFiles(), shards = selectTestShards(files, 4);
  assert.deepEqual(selectTestShards([...files].reverse(), 4), shards);
  const totals = shards.map(shard => shard.seconds);
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 2, `estimated shard costs: ${totals}`);
  const firstHeavy = ['vehicle.test.mjs', 'collisions.test.mjs', 'transit.test.mjs', 'central-artery.test.mjs'];
  assert.equal(new Set(firstHeavy.map(file => shards.findIndex(shard => shard.files.includes(file)))).size, 4);
  assert.ok(shards.every(shard => shard.files.length && shard.files.join() === [...shard.files].sort().join()));
});

test('invalid shard arguments and empty selections fail instead of silently dropping tests', () => {
  assert.deepEqual(parseArguments(['--shard', '3/4', '--list']), {index: 3, count: 4, list: true, help: false});
  for (const args of [['--shard'], ['--shard', '0/4'], ['--shard', '5/4'], ['--shard', '1/0'], ['--shard', '1.5/4'],
    ['--shard', '1/2;echo'], ['--shard', '1/99999999999999999999'], ['--unknown'], ['--shard', '1/4', '--shard', '2/4']]) {
    assert.throws(() => parseArguments(args), Error, args.join(' '));
  }
  assert.throws(() => selectTestShards([], 4), /Cannot fill/);
  assert.throws(() => selectTestShards(['a.test.mjs'], 0), /positive integer/);
  assert.throws(() => selectTestShards(['a.test.mjs', 'a.test.mjs'], 1), /Duplicate/);
  assert.throws(() => runTests([]), /empty test shard/);
});

test('runner passes literal file arguments without a shell and propagates child exit status', async () => {
  for (const [code, signal, expected] of [[0, null, 0], [7, null, 7], [null, 'SIGTERM', 143], [null, null, 1]]) {
    let invocation;
    const result = await runTests(['space and $() name.test.mjs'], {spawnProcess: (...args) => {
      invocation = args;
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', code, signal));
      return child;
    }});
    assert.deepEqual(invocation, [process.execPath, ['--test', '--test-concurrency=2', join(REPO_ROOT, 'tests', 'space and $() name.test.mjs')],
      {cwd: REPO_ROOT, stdio: 'inherit', shell: false}]);
    assert.equal(result, expected);
  }
  await assert.rejects(runTests(['a.test.mjs'], {spawnProcess: () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('spawn failed')));
    return child;
  }}), /spawn failed/);
});

test('CLI dry run works outside the repository and rejects malformed shard input', () => {
  const script = join(REPO_ROOT, 'scripts', 'run-ci-tests.mjs');
  const listed = spawnSync(process.execPath, [script, '--shard', '2/4', '--list'], {cwd: tmpdir(), encoding: 'utf8'});
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).files, selectTestShards(discoverTestFiles(), 4)[1].files);
  const bad = spawnSync(process.execPath, [script, '--shard', '5/4'], {encoding: 'utf8'});
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Shard index/);
});
