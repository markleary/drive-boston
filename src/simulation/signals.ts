/** Two non-conflicting approach phases with amber and a two-second all-red gap.
 * This is an original game signal plan, not Boston's live traffic timing. */
export function signalAxis(yaw:number):0|1 { return Math.abs(Math.sin(yaw))>Math.abs(Math.cos(yaw))?1:0; }
export function signalPhase(elapsed:number,approachYaw:number):'red'|'amber'|'green' {
  const phase=((elapsed-signalAxis(approachYaw)*16)%32+32)%32;
  return phase<11?'green':phase<14?'amber':'red';
}
