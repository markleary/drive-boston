import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSlice, createMotion, orderTiles, pickTile, LOOK_AHEAD_S, SYNC_RADIUS } from '../src/render/stream-order.ts';

const SIZE = 1000;
const tile = (tx, tz, distance) => ({ tx, tz, key: `${tx}_${tz}`, distance });
/** Distance from (x, z) to a tile's square, as the streamer's window gives it for a tile no road brings nearer. */
const square = (tx, tz, x, z) => Math.hypot(Math.max(tx * SIZE - x, 0, x - (tx + 1) * SIZE), Math.max(tz * SIZE - z, 0, z - (tz + 1) * SIZE));
const around = (x, z, radius) => { const list = []; for (let tx = -4; tx <= 4; tx++) for (let tz = -4; tz <= 4; tz++) { const d = square(tx, tz, x, z); if (d <= radius) list.push(tile(tx, tz, d)); } return list; };
/** Fly a straight line for `seconds` at `speed` m/s along (dx, dz), one update a frame. */
const fly = (motion, speed, dx, dz, seconds = 3, fps = 60) => { let x = 0, z = 0, now = 1000; for (let i = 0; i < seconds * fps; i++) { now += 1000 / fps; x += dx * speed / fps; z += dz * speed / fps; motion.track(x, z, now); } return { x, z, now }; };

test('the velocity estimate follows steady travel and says where the observer will be', () => {
  const motion = createMotion(), at = fly(motion, 53.6, Math.SQRT1_2, -Math.SQRT1_2);
  assert.ok(Math.abs(motion.speed - 53.6) < .1, `speed ${motion.speed}`);
  const p = motion.predict(at.x, at.z), reach = 53.6 * LOOK_AHEAD_S;
  assert.ok(Math.abs(Math.hypot(p.x - at.x, p.z - at.z) - reach) < 1, 'the predicted point is one look-ahead of travel away');
  assert.ok(p.x > at.x && p.z < at.z, 'in the direction of travel');
  assert.deepEqual(motion.ahead(at.x, at.z), p);
});

test('a first update, a teleport and a pause are not travel', () => {
  const motion = createMotion();
  motion.track(500, 500, 1000);
  assert.equal(motion.speed, 0, 'one position is no velocity');
  const at = fly(motion, 40, 1, 0);
  assert.ok(motion.speed > 39);
  motion.track(at.x + 2000, at.z, at.now + 16);
  assert.equal(motion.speed, 0, 'a jump across the city resets the estimate');
  assert.equal(motion.ahead(at.x + 2000, at.z), undefined, 'and the window stays where the observer is');
  const again = fly(motion, 40, 1, 0);
  motion.track(again.x + 5, again.z, again.now + 900);
  assert.equal(motion.speed, 0, 'a frame after a long stall says nothing about speed');
});

test('a slow observer keeps the window where it stands', () => {
  const motion = createMotion(), at = fly(motion, 4, 1, 0);
  assert.equal(motion.ahead(at.x, at.z), undefined);
  assert.ok(Math.abs(motion.speed - 4) < .05);
});

test('tiles ahead of travel build before tiles the same distance behind or beside', () => {
  // Flying east along z = 500 from x = 500: the middle of tile 0_0.
  const x = 500, z = 500, predicted = { x: x + 430, z }, reach = 1250;
  const order = orderTiles(around(x, z, reach), around(predicted.x, predicted.z, reach), predicted, SIZE, x, z), rank = key => order.findIndex(t => t.key === key);
  assert.equal(order[0].key, '0_0', 'the tile under the observer first');
  assert.ok(rank('1_0') < rank('-1_0'), 'east before west');
  assert.ok(rank('1_0') < rank('0_1') && rank('1_0') < rank('0_-1'), 'ahead before abeam');
  assert.ok(rank('2_0') >= 0, 'the look-ahead brings in a tile the window around the observer does not reach');
  assert.ok(!around(x, z, reach).some(t => t.key === '2_0'));
  assert.ok(rank('1_1') < rank('-1_1') && rank('1_-1') < rank('-1_-1'), 'ahead and to the side before behind and to the side');
  // Its distance is still the one from where the observer is now.
  assert.equal(order[rank('2_0')].distance, square(2, 0, x, z));
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1].score <= order[i].score, 'sorted by score');
  assert.equal(new Set(order.map(t => t.key)).size, order.length, 'each tile once');
});

test('at rest the order is plain distance, and a road that reaches the view keeps its owner tile early', () => {
  const x = 100, z = 500, near = around(x, z, 1250), order = orderTiles(near, [], { x, z }, SIZE, x, z);
  for (const t of order) assert.equal(t.score, t.distance);
  assert.deepEqual(order.map(t => t.key).slice(0, 2), ['0_0', '-1_0']);
  // Tile 2_0 lies 1900 m away, but one of its roads (a long bridge) comes within 60 m of the observer.
  const withRoad = orderTiles([...near, tile(2, 0, 60)], [], { x, z }, SIZE, x, z);
  assert.equal(withRoad[1].key, '2_0', 'right after the tile underfoot');
  assert.equal(withRoad[1].score, 60);
  // Travelling away from that bridge takes its bonus along: the score never goes below zero.
  const leaving = orderTiles([tile(0, 0, 0), tile(2, 0, 60)], [], { x: x - 400, z }, SIZE, x, z);
  assert.ok(leaving.every(t => t.score >= 0));
  assert.ok(leaving.find(t => t.key === '2_0').score > 60);
});

test('the build slice is the spare frame time at rest, grows with speed when a tile is due and with an unbuilt tile close by', () => {
  const FAR = Infinity;
  assert.equal(buildSlice(18, 0, FAR), .5, 'a frame with no time to spare leaves the floor');
  assert.equal(buildSlice(13, 0, FAR), 1000 / 60 - 13, 'what the frame leaves');
  assert.equal(buildSlice(2, 0, FAR), 4, 'never more than the cap at rest');
  // Travel: the floor rises with speed, as far as the most pressing tile needs it.
  assert.equal(buildSlice(18, 8, 2000, 600), .5, 'slow travel changes nothing');
  assert.equal(buildSlice(18, 53.6, 2000, 600), 4, 'at cruise with a tile due, the full cap whatever the frame cost');
  assert.ok(buildSlice(18, 24, 2000, 600) > 2 && buildSlice(18, 24, 2000, 600) < 2.5, 'half way up at half speed');
  assert.equal(buildSlice(18, 53.6, 2000, 1000), .5, 'nothing due within the look-ahead: the spare time only');
  assert.equal(buildSlice(18, 53.6, 2000, 850), 2.25, 'half the rise for a tile half way to due');
  assert.equal(buildSlice(18, 53.6, FAR), .5, 'no tile to build');
  // An unbuilt tile close by.
  assert.equal(buildSlice(18, 0, 400), .5, 'a tile at the urgent radius is not urgent yet');
  assert.equal(buildSlice(18, 0, 200), 7, 'half way in');
  assert.equal(buildSlice(18, 53.6, 0), 10, 'over an unbuilt tile');
  assert.equal(buildSlice(18, 53.6, 0, 0, true), 5, 'a phone takes half');
  assert.equal(buildSlice(18, 53.6, 2000, 600, true), 2);
  for (const speed of [0, 10, 20, 40, 80]) for (const d of [0, 100, 399, 400, 2000]) for (const due of [0, 700, 900, 5000]) { const slice = buildSlice(30, speed, d, due); assert.ok(slice >= .5 && slice <= 10, `${speed} ${d} ${due}: ${slice}`); }
});

/** A build queue over tiles given as `key: state`, where state is 'new' (downloaded), 'decks' (structures in) or absent (still downloading). */
const queue = (states, extra = {}) => ({ ready: key => key in states && !extra.resting?.includes(key), structured: key => states[key] === 'decks', distance: t => t.distance, grounded: false, ...extra });
const ordered = list => list.map(([key, score, distance = score]) => ({ tx: 0, tz: 0, key, distance, score }));

test('every tile in the window gets its terrain and decks before any tile gets its scenery', () => {
  const wanted = ordered([['a', 100], ['b', 400], ['c', 900]]);
  assert.equal(pickTile(wanted, queue({ a: 'decks', b: 'new', c: 'new' })).key, 'b', 'the nearest tile without its decks');
  assert.equal(pickTile(wanted, queue({ a: 'decks', b: 'decks', c: 'new' })).key, 'c');
  assert.equal(pickTile(wanted, queue({ a: 'decks', b: 'decks', c: 'decks' })).key, 'a', 'then scenery, most pressing first');
  assert.equal(pickTile(wanted, queue({ c: 'new' })).key, 'c', 'a tile still downloading is passed over');
  assert.equal(pickTile(wanted, queue({})), undefined, 'nothing to work on');
});

test('the tile being finished keeps its turn unless another is clearly more pressing, and lends the frame when it rests', () => {
  const states = { a: 'decks', b: 'decks', c: 'decks' };
  // The observer turned: b, half finished, is now 200 m less pressing than a.
  const wanted = ordered([['a', 300], ['b', 500], ['c', 900]]);
  assert.equal(pickTile(wanted, queue(states, { finishing: 'b' })).key, 'b', 'within the margin it is finished first');
  assert.equal(pickTile(ordered([['a', 300], ['b', 560], ['c', 900]]), queue(states, { finishing: 'b' })).key, 'a', 'beyond the margin the more pressing tile takes over');
  assert.equal(pickTile(wanted, queue(states, { finishing: 'b', resting: ['b'] })).key, 'a', 'while it waits for the next frame, the next tile works');
  assert.equal(pickTile(wanted, queue(states, { finishing: 'b', resting: ['a', 'b'] })).key, 'c');
  assert.equal(pickTile(wanted, queue(states, { finishing: 'gone' })).key, 'a', 'a tile that left the window holds nothing up');
  // Decks still come first, whatever is being finished.
  assert.equal(pickTile(wanted, queue({ ...states, c: 'new' }, { finishing: 'b' })).key, 'c');
});

test('on the ground a tile the observer is about to stand on comes before everything; in the air none does', () => {
  // Flying east fast: the tile underfoot (score 430: it is behind where the observer will be) and two ahead.
  const wanted = ordered([['ahead', 0, 430], ['next', 300, 730], ['under', 430, SYNC_RADIUS - 20]]), states = { ahead: 'new', next: 'new', under: 'decks' };
  assert.equal(pickTile(wanted, queue(states, { grounded: true })).key, 'under', 'its colliders first');
  assert.equal(pickTile(wanted, queue(states)).key, 'ahead', 'in flight the order of travel stands');
  assert.equal(pickTile(wanted, queue(states, { grounded: true, resting: ['under'] })).key, 'ahead');
  const far = ordered([['ahead', 0, 430], ['under', 430, SYNC_RADIUS + 1]]);
  assert.equal(pickTile(far, queue({ ahead: 'decks', under: 'decks' }, { grounded: true })).key, 'ahead', 'just outside the radius it waits its turn');
});
