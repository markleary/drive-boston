export type Point2 = [number, number];
/** `kind` is the OpenStreetMap highway class of a town street (Cambridge, Somerville, Brookline); Boston centerlines carry a surveyed width instead. */
export interface Road { id: string; name: string; points: Point2[]; width: number; oneway: number; kind?: string; /** False for drivable survey patches whose continuation has no traffic graph. */ traffic?:boolean; elevations?:number[]; deckWidths?:number[]; deckTangents?:{start?:Point2;end?:Point2}; startLevel?:number; endLevel?:number; bridge?:{id:string;thickness:number;clearanceEstimated:boolean;sourceLayer?:number;/** Metre stations where surveyed lower structures must remain free of generated piers. */supportExclusions?:[number,number][]}; }
/** `kind` is the OpenStreetMap building tag of a town extrusion (house, apartments, retail...). */
export interface Building { id: string; name: string; center: Point2; height: number; /** Generated wall height above base, excluding the pitched roof. */ eaveHeight?: number; footprint: Point2[]; landmark?: string; baseElevation?: number; kind?: string; amenity?: string; sourceName?: string; /** Preserve surveyed openings where the convex footprint crosses a road. */ collision?: 'mesh'; }
export interface Landmark { id: string; name: string; position: Point2; description: string; driveStart?: {x:number;z:number;yaw:number;roadId?:string}; }
export interface WaterSurface { source:string; name:string; rings:Point2[][]; level:number; }
export interface CityArea { id: string; name: string; rings: Point2[][]; kind?: string; /** Constant-height source basins/reaches inside a merged hydro outline. */ surfaces?:WaterSurface[]; }
export interface ParkPath { id: string; points: Point2[]; width: number; bridge?: boolean; /** Complete pre-tile-clipped bridge centerline; fragments share its height profile. */ bridgePoints?:Point2[]; }
export interface CityData {
  origin: { xFeet: number; yFeet: number; longitude: number; latitude: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  roads: Road[]; buildings: Building[]; landmarks: Landmark[];
  curbs: Point2[][]; signals: Point2[];
  spawn: { x: number; z: number; yaw: number };
  sources: { name: string; url: string; license: string }[];
  /** Metro builds store the grid in a gzip int16 sidecar (`file`, `scale`) and
   * may ship it already road-graded (`graded`). */
  elevation?: { width:number; height:number; cellSize:number; originX:number; originZ:number; heights:ArrayLike<number>; file?:string; scale?:number; encoding?:string; graded?:boolean; grading?:Record<string,unknown> };
  coverage?: Point2[][];
  neighborhoods?: CityArea[];
  parks?: CityArea[];
  water?: CityArea[];
  parkPaths?: ParkPath[];
  /** Present on metro builds: buildings stream from 1 km tiles (see simulation/city-tiles.ts). */
  tiles?: { size:number; directory:string; keys:string[]; far:string; buildingCount:number };
  landmarkBuildings?: Building[];
}
export interface DriveInput { throttle: number; brake: number; steer: number; handbrake: boolean; wheelie?: boolean; }
export interface VehicleState { x: number; y: number; z: number; yaw: number; speed: number; steering: number; }
export type LightingMode = 'golden' | 'day' | 'night';
export type CameraMode = 'chase' | 'hood' | 'aerial';
export type TravelMode = 'drive' | 'helicopter' | 'bike';
