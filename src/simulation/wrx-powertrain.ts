/** US 2024 WRX Premium six-speed. See public/models/PLAYER_CARS.md for the
 * Subaru specifications and the instrumented road test used for calibration. */
export const WRX = {
  wheelRadius: .3266, // 245/40R18
  ratios: [3.455, 1.947, 1.367, 1.029, .825, .667],
  reverse: 3.636,
  finalDrive: 4.111,
  shiftRpm: 6050,
  redline: 6100,
  idle: 800,
  power: 271 * 745.7,
  peakTorque: 258 * 1.35582,
} as const;

/** Engine rpm per m/s of road speed with the clutch engaged. */
export function wrxGearing(gear: number) {
  const ratio = gear < 0 ? WRX.reverse : WRX.ratios[Math.max(1, Math.min(gear, 6)) - 1];
  return ratio * WRX.finalDrive * 60 / (2 * Math.PI * WRX.wheelRadius);
}

/** Clutch and shift assist for the game's throttle/brake controls. Light
 * throttle shifts early, a lift holds the gear, full throttle uses the redline. */
export function wrxGear(speed: number, previous: number, pedal: number) {
  let gear = Math.max(1, Math.min(6, previous));
  const upRpm = pedal > .05 ? 2500 + (WRX.shiftRpm - 2500) * pedal : WRX.shiftRpm;
  const downRpm = 1250 + 2200 * Math.max(0, pedal);
  while (gear < 6 && speed * wrxGearing(gear) > upRpm) gear++;
  while (gear > 1 && speed * wrxGearing(gear) < downRpm && speed * wrxGearing(gear - 1) < upRpm - 400) gear--;
  return gear;
}

export function wrxRpm(speed: number, gear: number, pedal: number) {
  const clutchRpm = WRX.idle + (gear <= 1 ? 2250 * Math.abs(pedal) : 0);
  return Math.min(WRX.redline, Math.max(clutchRpm, Math.abs(speed) * wrxGearing(gear)));
}

/** Fraction of full boost. Closed throttle or a declutched shift opens the
 * bypass valve. Boost builds over several physics steps when exhaust load returns. */
export function wrxBoost(previous: number, rpm: number, load: number, dt: number) {
  const spool = Math.max(0, Math.min(1, (rpm - 1100) / 900));
  const target = spool * Math.max(0, Math.min(1, (load - .15) / .85));
  return previous + (target - previous) * (1 - Math.exp(-dt / (target > previous ? .19 : .10)));
}

/** Nm at full pedal. The rated plateau runs from 2,000 to 5,200 rpm. Above
 * it the curve passes through 271 hp at 5,600 rpm and tapers to redline. */
export function wrxTorque(rpm: number, boost: number) {
  const torqueAtPeakPower = WRX.power / (5600 * Math.PI / 30);
  const highRpm = Math.max(0, Math.min(1, (rpm - 5200) / 400));
  const taper = Math.max(0, Math.min(1, (rpm - 5600) / (WRX.redline - 5600)));
  const fullBoostTorque = WRX.peakTorque + (torqueAtPeakPower - WRX.peakTorque) * highRpm - 48 * taper;
  return fullBoostTorque * (.56 + .44 * boost);
}
