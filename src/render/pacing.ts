/** Frame pacing for builders that run as generators: a step checks `due()`
 * between units of work and yields when the frame's deadline has passed. The
 * tile streamer sets the deadline before each resume; outside it (the legacy
 * whole-city build, tests) the deadline is infinite and nothing yields. A step
 * may set the deadline to -Infinity to end the frame's slice early (`nextFrame`). */
export interface Pace { deadline: number; }
export const UNPACED: Pace = { deadline: Infinity };
export const due = (pace?: Pace) => !!pace && performance.now() > pace.deadline;
/** Run a paced generator to completion. */
export function drain<T>(steps: Generator<void, T>): T { let r = steps.next(); while (!r.done) r = steps.next(); return r.value; }
/** End this frame's slice of a paced build; the streamer resumes it next frame. An unpaced run carries on. */
export function* nextFrame(pace?: Pace): Generator<void, void> { if (pace && pace.deadline !== Infinity) { pace.deadline = -Infinity; yield; } }
/** Wait a frame at a time until `ready()` holds or `limit` ms have passed. An
 * unpaced run, or one the streamer finishes synchronously, does not wait. */
export function* until(ready: () => boolean, pace?: Pace, limit = 1500): Generator<void, void> {
  const end = performance.now() + limit;
  while (pace && pace.deadline !== Infinity && performance.now() < end && !ready()) yield* nextFrame(pace);
}
