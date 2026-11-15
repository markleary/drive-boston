/** Metres, kilograms, newtons and watts. Manufacturer dimensions/performance
 * and calibrated game approximations are documented in public/models/PLAYER_CARS.md. */
export type PlayerCarId = 'harbor-s4' | 'mclaren-gt' | 'mclaren-720s' | 'supra-mk4' | 'tesla-model-3-performance' | 'moving-truck';
export const DEFAULT_CAR: PlayerCarId = 'harbor-s4';
export const isElectricCar = (id:PlayerCarId):id is 'tesla-model-3-performance' => id==='tesla-model-3-performance';
/** Original, loaded medium-duty moving truck. Model coordinates use the same
 * chassis origin as the raycast suspension; the tire contact plane is −.94 m.
 * These shared dimensions keep the visible aluminum box and collision exact. */
export const MOVING_TRUCK = {
  groundY:-.94, roofHeight:3.66,
  cargo:{center:{x:0,y:1.425,z:-1.205},halfExtents:{x:1.21,y:1.295,z:2.445}},
  cab:{center:{x:0,y:.68,z:2.45},halfExtents:{x:1.06,y:1.02,z:1.25}},
  chassis:{center:{x:0,y:-.10,z:0},halfExtents:{x:1.08,y:.22,z:3.78}},
} as const;
export const PLAYER_CARS = {
  'harbor-s4': {
    name:'Harbor S4', description:'Everyday coupe · 60 mph',
    mass:1240, wheelRadius:.34, rearWheelRadius:.34, wheelbase:2.66, track:1.72, rearTrack:1.72,
    suspensionRest:.31, spawnHeight:.78, maxForwardSpeed:60*.44704, maxReverseSpeed:8,
    maxSteering:.52, maxLateralAcceleration:8.5, halfWidth:.85, halfLength:2.02,
    stiffness:32, compression:4.4, relaxation:5.2, travel:.16, friction:1.5,
    linearDamping:.13, brakeForce:12500, power:125000, traction:8400,
  },
  'mclaren-gt': {
    name:'McLaren GT', description:'Twin-turbo V8 · 203 mph · 0–60 in 3.1 s',
    mass:1530, wheelRadius:.33275, rearWheelRadius:.3552, wheelbase:2.675, track:1.671, rearTrack:1.663,
    suspensionRest:.20, spawnHeight:.66, maxForwardSpeed:326/3.6, maxReverseSpeed:10,
    maxSteering:.48, maxLateralAcceleration:11.6, halfWidth:.945, halfLength:2.3415,
    stiffness:58, compression:5.4, relaxation:7.4, travel:.10, friction:2.5,
    linearDamping:0, brakeForce:17900, power:456000, traction:13800,
  },
  'mclaren-720s': {
    name:'McLaren 720S', description:'Twin-turbo V8 · 212 mph · 0–60 in 2.8 s',
    mass:1419, wheelRadius:.3238, rearWheelRadius:.3455, wheelbase:2.67, track:1.674, rearTrack:1.629,
    suspensionRest:.19, spawnHeight:.64, maxForwardSpeed:341/3.6, maxReverseSpeed:10,
    maxSteering:.49, maxLateralAcceleration:12.2, halfWidth:.965, halfLength:2.2715,
    stiffness:63, compression:5.8, relaxation:7.8, travel:.10, friction:2.6,
    linearDamping:0, brakeForce:17700, power:530000, traction:14300,
  },
  'supra-mk4': {
    name:'Toyota Supra Mk4', description:'Twin-turbo straight-six · 155 mph · 0–60 in 4.6 s',
    mass:1563, wheelRadius:.32165, rearWheelRadius:.3179, wheelbase:2.55, track:1.52, rearTrack:1.525,
    suspensionRest:.25, spawnHeight:.70, maxForwardSpeed:155*.44704, maxReverseSpeed:9,
    maxSteering:.51, maxLateralAcceleration:9.3, halfWidth:.905, halfLength:2.2575,
    stiffness:41, compression:4.9, relaxation:6.1, travel:.14, friction:2.1,
    linearDamping:0, brakeForce:16500, power:239000, traction:10400,
  },
  'tesla-model-3-performance': {
    name:'Tesla Model 3 Performance', description:'Dual-motor AWD · 163 mph · 0–60 in 2.9 s (rollout)',
    mass:1839, wheelRadius:.33625, rearWheelRadius:.3365, wheelbase:2.875, track:1.582, rearTrack:1.560,
    suspensionRest:.23, spawnHeight:.69, maxForwardSpeed:163*.44704, maxReverseSpeed:7,
    maxSteering:.49, maxLateralAcceleration:10.3, halfWidth:.925, halfLength:2.416,
    stiffness:53, compression:5.2, relaxation:6.8, travel:.12, friction:2.4,
    linearDamping:0, brakeForce:18500, power:510*745.7, traction:16350,
  },
  'moving-truck': {
    name:'Moving Truck', description:'Storrow Movers · loaded diesel · 12 ft high',
    mass:8200, wheelRadius:.47, rearWheelRadius:.47, wheelbase:4.40, track:2.02, rearTrack:2.04,
    suspensionRest:.39, spawnHeight:.98, maxForwardSpeed:65*.44704, maxReverseSpeed:5,
    maxSteering:.51, maxLateralAcceleration:3.5, halfWidth:1.21, halfLength:3.8,
    stiffness:40, compression:5.4, relaxation:6.8, travel:.22, friction:1.55,
    linearDamping:0, brakeForce:37000, power:170000, traction:17500,
  },
} as const;
export const isPlayerCarId = (value:unknown):value is PlayerCarId => typeof value==='string'&&Object.hasOwn(PLAYER_CARS,value);

/** Sports-car outputs follow their references; the original moving truck uses
 * representative medium-duty diesel values. Efficiencies, traction, drag and
 * shift timing are game calibrations. Supra uses auto clutch/shift assist for
 * its stock six-speed manual, not the slower four-speed automatic. */
export const CAR_POWERTRAINS = {
  'mclaren-gt': {efficiency:.81, dragArea:.77, rolling:180, shiftSeconds:.065, redline:8500, shiftRpm:7800, midRpm:4000, highRpm:7000, shifts:[0,22,34,47,60,72,84,104], cgZ:-.18},
  'mclaren-720s': {efficiency:.74, dragArea:.724, rolling:170, shiftSeconds:.06, redline:8500, shiftRpm:8100, midRpm:4300, highRpm:7500, shifts:[0,22.5,35,48,61,74,87,108], cgZ:-.24},
  'supra-mk4': {efficiency:.84, dragArea:.64, rolling:185, shiftSeconds:.22, redline:6800, shiftRpm:6500, midRpm:3300, highRpm:5800, shifts:[0,17.5,29.5,41,52.5,64,81], cgZ:.0765},
  // Single-speed EV with the manual's 9.03:1 reduction ratio in carRpm;
  // no combustion idle, clutch interruption, or fictitious forward gear shifts.
  'tesla-model-3-performance': {efficiency:.9, dragArea:.51, rolling:180, shiftSeconds:0, redline:20000, shiftRpm:18700, midRpm:6500, highRpm:15000, shifts:[0,163*.44704], cgZ:-.07},
  'moving-truck': {efficiency:.80, dragArea:5.8, rolling:1050, shiftSeconds:.42, redline:3400, shiftRpm:2900, midRpm:1800, highRpm:2800, shifts:[0,5.0,9.5,15.5,22,31], cgZ:-.55},
} as const;
export type PerformanceCarId = keyof typeof CAR_POWERTRAINS;
export const isPerformanceCar = (id:PlayerCarId):id is PerformanceCarId => id !== DEFAULT_CAR;
export function carGear(id:PerformanceCarId,speed:number,previous:number){
  const shifts=CAR_POWERTRAINS[id].shifts,last=shifts.length-1;
  let gear=Math.max(1,Math.min(last,previous));
  while(gear<last&&speed>shifts[gear])gear++;
  while(gear>1&&speed<shifts[gear-1]-3)gear--;
  return gear;
}
export function carRpm(id:PerformanceCarId,speed:number,gear:number,pedal:number){
  const spec=CAR_POWERTRAINS[id];
  if(isElectricCar(id))return Math.min(spec.redline,Math.abs(speed)/PLAYER_CARS[id].wheelRadius*60/(2*Math.PI)*9.03);
  return Math.min(spec.redline,Math.max((id==='moving-truck'?650:850)+Math.abs(pedal)*(id==='moving-truck'?400:550),Math.abs(speed)/spec.shifts[gear<0?1:gear]*spec.shiftRpm));
}
