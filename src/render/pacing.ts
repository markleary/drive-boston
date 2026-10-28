/** Frame pacing for builders that run as generators: a step checks `due()`
 * between units of work and yields when the frame's deadline has passed. The
 * tile streamer sets the deadline before each resume; outside it (the legacy
 * whole-city build, tests) the deadline is infinite and nothing yields. */
export interface Pace { deadline: number; }
export const UNPACED: Pace = { deadline: Infinity };
export const due = (pace?: Pace) => !!pace && performance.now() > pace.deadline;
/** Run a paced generator to completion. */
export function drain<T>(steps: Generator<void, T>): T { let r = steps.next(); while (!r.done) r = steps.next(); return r.value; }
