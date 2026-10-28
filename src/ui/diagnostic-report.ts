import type {CameraMode,LightingMode,TravelMode,VehicleState} from '../types';
import type {QualityMode} from '../render/graphics';

export interface HUDPerformanceData {
  fps:number;
  /** Mean wall-clock frame interval, not a GPU timer measurement. */
  frameMs:number;
  /** Renderer totals include shadows, reflections, and postprocessing passes. */
  drawCalls:number;
  triangles:number;
  geometries:number;
  textures:number;
  traffic:number;
  transit:number;
  pedestrians:number;
}

export interface HUDDiagnosticData {
  /** Position and heading of the active vehicle, including the helicopter. */
  state:VehicleState;
  groundHeight:number;
  road:{name:string;id:string};
  neighborhood:string;
  camera:CameraMode;
  lighting:LightingMode;
  quality:QualityMode;
  travelMode:TravelMode;
  performance:HUDPerformanceData;
  /** Optional capture timestamp supplied by the caller when copying a report. */
  timestamp?:string;
}

/** The game uses east +X and south +Z. Compass bearings run clockwise from north. */
export function compassHeading(yaw:number){
  return ((Math.atan2(Math.sin(yaw),-Math.cos(yaw))*180/Math.PI)%360+360)%360;
}

const number=(value:number,places:number)=>Number.isFinite(value)?value.toFixed(places):'unavailable';
const count=(value:number)=>Number.isFinite(value)?Math.round(value).toLocaleString('en-US'):'unavailable';

/** A deterministic, plain-text location snapshot suitable for pasting into an issue. */
export function formatLocationReport(data:HUDDiagnosticData){
  const {state,performance:p}=data;
  return [
    'Drive Boston debug report',
    ...(data.timestamp?[`Captured: ${data.timestamp}`]:[]),
    `Place: ${data.neighborhood} / ${data.road.name}`,
    `Road ID: ${data.road.id}`,
    `Active vehicle: ${data.travelMode}`,
    `World meters: X=${number(state.x,3)}, Y=${number(state.y,3)}, Z=${number(state.z,3)}`,
    'Axes: +X east, +Y up (local datum), +Z south',
    `Heading: ${number(compassHeading(state.yaw),1)} deg / yaw=${number(state.yaw,6)} rad`,
    `Ground Y: ${number(data.groundHeight,3)} m / above terrain: ${number(state.y-data.groundHeight,2)} m`,
    `Speed: ${number(state.speed,2)} m/s (${number(state.speed*2.236936,1)} mph)`,
    `View: ${data.camera} / ${data.lighting} / ${data.quality}`,
    `Performance: ${number(p.fps,0)} FPS / ${number(p.frameMs,2)} ms mean frame interval`,
    `Render totals: ${count(p.drawCalls)} draw calls / ${count(p.triangles)} triangles (all passes)`,
    `Resources: ${count(p.geometries)} geometries / ${count(p.textures)} textures`,
    `Population: ${count(p.traffic)} traffic cars / ${count(p.transit)} transit vehicles / ${count(p.pedestrians)} pedestrians`,
  ].join('\n');
}
