/** Fast CI selection; `npm run test:physics` still runs every Node test file.
 * New tests are included automatically. Only these reviewed visual suites are
 * omitted, rather than maintaining an allowlist that can miss new regressions.
 */
import {spawn} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {constants} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CI_EXCLUSIONS = Object.freeze({
  'building-identities.test.mjs': 'Facade style and building-name classification; retained in the full local suite.',
  'facade-uv.test.mjs': 'Exhaustive facade texture alignment across the surveyed city.',
  'neighborhood-landmarks.test.mjs': 'Architectural styling and decorative Fenway layout.',
  'state-house.test.mjs': 'Landmark material selection and source-triangle preservation.',
});

// Approximate aggregate test seconds from GitHub job 132849346384 (2026-11-15).
// These weights affect scheduling only, never inclusion. Round the expensive
// files, including their parameterized cases, and give unmeasured/new files a
// small nonzero weight. They are hints, not runtime limits or test assertions.
const TEST_WEIGHTS = Object.freeze({
  'vehicle.test.mjs': 117,
  'collisions.test.mjs': 106,
  'transit.test.mjs': 56,
  'i93-runtime.test.mjs': 50,
  'central-artery.test.mjs': 50,
  'bike-recovery.test.mjs': 46,
  'bridges.test.mjs': 45,
  'boston-highways.test.mjs': 41,
  'helicopter.test.mjs': 39,
  'crosswalks.test.mjs': 37,
  'overpass-routes.test.mjs': 36,
  'terrain-actors.test.mjs': 25,
  'pedestrian-locality.test.mjs': 24,
  'bike.test.mjs': 24,
  'signal-placement.test.mjs': 22,
  'npc-vehicles.test.mjs': 22,
  'highway-ramp-connections.test.mjs': 20,
  'traffic-density.test.mjs': 18,
  'traffic-conflicts.test.mjs': 17,
  'park-walks.test.mjs': 16,
  'road-grading.test.mjs': 16,
  'construction-traffic.test.mjs': 14,
  'tunnel-parapets.test.mjs': 14,
  'i93.test.mjs': 14,
  'tobin-profile.test.mjs': 14,
  'leverett-connections.test.mjs': 13,
  'median-barriers.test.mjs': 12,
  'street-surfaces.test.mjs': 11,
  'rutherford-connections.test.mjs': 10,
  'ramp-street-junctions.test.mjs': 10,
  'stream-order.test.mjs': 10,
  'street-furniture.test.mjs': 9,
  'traffic-continuity.test.mjs': 9,
  'roads-index.test.mjs': 9,
  'street-signs.test.mjs': 9,
  'water-shores.test.mjs': 9,
  'highway-cut-walls.test.mjs': 8,
  'transit-bridge-clearance.test.mjs': 8,
  'terrain-render.test.mjs': 7,
  'draped-surface.test.mjs': 7,
  'elevated-signals.test.mjs': 7,
  'median-cuts.test.mjs': 6,
  'source-footings.test.mjs': 6,
  'detected-building-clearance.test.mjs': 6,
  'road-grade-coverage.test.mjs': 6,
  'navigation.test.mjs': 6,
  'survey-deck-lanes.test.mjs': 6,
  'tunnel-render.test.mjs': 6,
});
const compareNames = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const estimatedSeconds = file => TEST_WEIGHTS[file] ?? 2;

export function discoverTestFiles(root = REPO_ROOT) {
  return readdirSync(join(root, 'tests'), {withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map(entry => entry.name).sort(compareNames);
}

export function selectTestShards(files, count = 4) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Shard count must be a positive integer.');
  if (new Set(files).size !== files.length) throw new Error('Duplicate test file in discovery.');
  const included = files.filter(file => !Object.hasOwn(CI_EXCLUSIONS, file));
  if (included.length < count) throw new Error(`Cannot fill ${count} shards with ${included.length} selected test files.`);
  const shards = Array.from({length: count}, () => ({files: [], seconds: 0}));
  // Longest first, then lowest total; filename and shard index break ties.
  // Directory order and the host's locale cannot change the assignment.
  for (const file of included.sort((a, b) => estimatedSeconds(b) - estimatedSeconds(a) || compareNames(a, b))) {
    const shard = shards.reduce((best, next) => next.seconds < best.seconds ? next : best);
    shard.files.push(file);
    shard.seconds += estimatedSeconds(file);
  }
  return shards.map(shard => ({...shard, files: shard.files.sort(compareNames)}));
}

export function parseArguments(args) {
  const options = {index: 1, count: 1, list: false, help: false};
  let hasShard = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list') options.list = true;
    else if (args[i] === '--help') options.help = true;
    else if (args[i] === '--shard' && !hasShard) {
      const match = /^(\d+)\/(\d+)$/.exec(args[++i] ?? '');
      if (!match) throw new Error('Use --shard INDEX/COUNT, for example --shard 1/4.');
      options.index = Number(match[1]);
      options.count = Number(match[2]);
      if (!Number.isSafeInteger(options.index) || !Number.isSafeInteger(options.count) || options.index < 1 || options.index > options.count) {
        throw new Error('Shard index must be between 1 and COUNT.');
      }
      hasShard = true;
    } else throw new Error(`Unknown or repeated argument: ${args[i]}`);
  }
  return options;
}

export function runTests(files, {root = REPO_ROOT, spawnProcess = spawn} = {}) {
  // An empty `node --test` invocation would rediscover all tests, so fail closed.
  if (!files.length) throw new Error('Refusing to run an empty test shard.');
  return new Promise((resolveExit, reject) => {
    const child = spawnProcess(process.execPath, ['--test', '--test-concurrency=2', ...files.map(file => join(root, 'tests', file))], {
      cwd: root, stdio: 'inherit', shell: false,
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit(signal ? 128 + (constants.signals[signal] ?? 1) : code ?? 1));
  });
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    console.log('Usage: node scripts/run-ci-tests.mjs [--shard INDEX/COUNT] [--list]\nWithout --shard, run every selected CI test. Full suite: npm run test:physics');
    return 0;
  }
  const files = discoverTestFiles(), shard = selectTestShards(files, options.count)[options.index - 1];
  const excluded = files.filter(file => Object.hasOwn(CI_EXCLUSIONS, file));
  if (options.list) {
    console.log(JSON.stringify({shard: `${options.index}/${options.count}`, estimatedSeconds: shard.seconds, files: shard.files, excluded}, null, 2));
    return 0;
  }
  console.log(`CI shard ${options.index}/${options.count}: ${shard.files.length} files; ${excluded.length} visual suites reserved for npm run test:physics.`);
  return runTests(shard.files);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
