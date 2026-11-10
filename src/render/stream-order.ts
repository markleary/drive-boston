/** Where the tile streamer looks and how much of a frame it may build in: pure functions of the observer's motion,
 * so node tests can hold them (tests/stream-order.test.mjs). */
export interface WantedTile { tx: number; tz: number; key: string; distance: number }
/** `distance` is from the observer now; `score` orders the builds (lower first): metres from where the observer
 * will be `LOOK_AHEAD_S` from now, less whatever a road reaching the view takes off the tile's own distance. */
export interface OrderedTile extends WantedTile { score: number }

/** The helicopter cruises at 54 m/s: this far ahead is 430 m, about what a chase camera centres on. */
export const LOOK_AHEAD_S = 8;
/** A jump longer than this in one update is a teleport, not travel; below MIN_TRAVEL m/s the window stays put. */
const TELEPORT = 80, SMOOTHING_S = .4, MIN_TRAVEL = 8;
/** The build slice each frame is what the target frame time leaves after the rest of the last frame (simulation,
 * render, vsync wait), within these bounds. */
const TARGET_FRAME_MS = 1000 / 60, MIN_BUDGET_MS = .5, MAX_BUDGET_MS = 4;
/** Travel raises the slice's floor from MIN_BUDGET_MS at TRAVEL_SPEED[0] m/s to MAX_BUDGET_MS at TRAVEL_SPEED[1]
 * (a kilometre of flight brings three tiles into the window; a starved slice builds one), but only as far as the
 * most pressing unbuilt tile needs it: none of it while that tile's score is beyond NEED[1], all of it within
 * NEED[0], so the builds settle a little ahead of the fog instead of racing to the window's rim. An unbuilt tile
 * closer than URGENT_RADIUS raises the floor further, to URGENT_BUDGET_MS at the tile itself: a slower frame for a
 * second or two instead of the tile appearing under the observer. A phone takes half of either. */
const TRAVEL_SPEED = [8, 40], NEED = [700, 1000], URGENT_RADIUS = 400, URGENT_BUDGET_MS = 10;

/** The observer's smoothed ground velocity, from the positions the streamer is given each frame. */
export function createMotion() {
  let px = NaN, pz = NaN, at = 0, vx = 0, vz = 0;
  const predict = (x: number, z: number) => ({ x: x + vx * LOOK_AHEAD_S, z: z + vz * LOOK_AHEAD_S });
  return {
    /** Fold a new position in (metres, milliseconds). */
    track(x: number, z: number, now: number) {
      const dt = (now - at) / 1000, dx = x - px, dz = z - pz;
      // The first update, a pause (a hidden tab, a stalled frame) and a teleport say nothing about travel.
      if (!(dt > 0 && dt < .5) || !(Math.hypot(dx, dz) < TELEPORT)) vx = vz = 0;
      else { const k = 1 - Math.exp(-dt / SMOOTHING_S); vx += (dx / dt - vx) * k; vz += (dz / dt - vz) * k; }
      px = x; pz = z; at = now;
    },
    get speed() { return Math.hypot(vx, vz); },
    /** Where the observer will be `LOOK_AHEAD_S` from now. */
    predict,
    /** That point while the observer travels (the window then covers it too); undefined at rest. */
    ahead(x: number, z: number) { return Math.hypot(vx, vz) >= MIN_TRAVEL ? predict(x, z) : undefined; },
  };
}

/** The tiles to build, most pressing first. `near` are the wanted tiles around the observer at (x, z), `ahead`
 * those around `predicted`; each list carries its own distances, which a road reaching the view makes shorter than
 * the distance to the tile's square (its owner tile then gets an earlier turn). */
export function orderTiles(near: WantedTile[], ahead: WantedTile[], predicted: { x: number; z: number }, size: number, x: number, z: number): OrderedTile[] {
  const square = (t: WantedTile, px: number, pz: number) => Math.hypot(Math.max(t.tx * size - px, 0, px - (t.tx + 1) * size), Math.max(t.tz * size - pz, 0, pz - (t.tz + 1) * size));
  const tiles = new Map<string, OrderedTile>();
  for (const t of near) tiles.set(t.key, { ...t, score: Math.max(0, square(t, predicted.x, predicted.z) - Math.max(0, square(t, x, z) - t.distance)) });
  // A tile only the look-ahead reaches: its distance is the one from here, its turn the one it has from there.
  for (const t of ahead) if (!tiles.has(t.key)) tiles.set(t.key, { ...t, distance: square(t, x, z), score: t.distance });
  return [...tiles.values()].sort((a, b) => a.score - b.score || a.distance - b.distance || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Milliseconds of this frame the tile builds may take: `outsideMs` is what the last frame spent outside the
 * streamer, `speed` the observer's (m/s), `nearestUnbuilt` the distance to the closest wanted tile not built yet
 * and `pressing` the lowest score among those tiles (`orderTiles`). */
export function buildSlice(outsideMs: number, speed: number, nearestUnbuilt: number, pressing = nearestUnbuilt, mobile = false) {
  const spare = Math.min(MAX_BUDGET_MS, Math.max(MIN_BUDGET_MS, TARGET_FRAME_MS - outsideMs)), share = mobile ? .5 : 1;
  const travelling = Math.min(1, Math.max(0, (speed - TRAVEL_SPEED[0]) / (TRAVEL_SPEED[1] - TRAVEL_SPEED[0]))), need = Math.min(1, Math.max(0, (NEED[1] - pressing) / (NEED[1] - NEED[0])));
  const travel = MIN_BUDGET_MS + (MAX_BUDGET_MS * share - MIN_BUDGET_MS) * travelling * need;
  const urgent = nearestUnbuilt < URGENT_RADIUS ? (MAX_BUDGET_MS + (URGENT_BUDGET_MS - MAX_BUDGET_MS) * (1 - Math.max(0, nearestUnbuilt) / URGENT_RADIUS)) * share : 0;
  return Math.max(spare, travel, urgent);
}

/** A tile this close to an observer on the ground is finished in one frame: its colliders must be there first. */
export const SYNC_RADIUS = 170;
/** How far the tile being finished may trail the most pressing one before the streamer switches to that one. */
const SWITCH_MARGIN = 250;
/** What the streamer knows about its builds when it picks the next tile to work on. */
export interface BuildQueue {
  /** Downloaded or under construction, and not resting until the next frame. */
  ready(key: string): boolean;
  /** Under construction with its terrain and decks in. */
  structured(key: string): boolean;
  /** Metres from the observer to the tile's square, now. */
  distance(tile: WantedTile): number;
  /** The tile whose scenery is being built, while it is under construction. */
  finishing?: string;
  /** The observer is on the ground. */
  grounded: boolean;
}
/** The wanted tile (in `orderTiles` order) to work on next, if any can be. On the ground, a tile the observer is
 * about to stand on comes before everything. Otherwise terrain and decks for every tile in the window, then whole
 * tiles: the one already being finished keeps its turn until another is clearly more pressing (two half-built
 * tiles show less than one finished), and lends the frame to the next when it rests. */
export function pickTile(wanted: OrderedTile[], queue: BuildQueue): OrderedTile | undefined {
  if (queue.grounded) for (const t of wanted) if (queue.ready(t.key) && queue.distance(t) <= SYNC_RADIUS) return t;
  for (const t of wanted) if (queue.ready(t.key) && !queue.structured(t.key)) return t;
  const first = wanted.find(t => queue.ready(t.key)), current = queue.finishing === undefined ? undefined : wanted.find(t => t.key === queue.finishing);
  return first && current && queue.ready(current.key) && current.score - first.score < SWITCH_MARGIN ? current : first;
}
