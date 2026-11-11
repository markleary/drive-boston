export type Point2 = [number, number];
/** `kind` is the OpenStreetMap highway class of a town street (Cambridge, Somerville, Brookline, Chelsea); Boston centerlines carry a surveyed width instead. */
export interface Road { id: string; name: string; points: Point2[]; /** The source centerline where scripts/street_surfaces.py moved `points` out of a curbed park edge onto the roadway; the installer restores and remeasures it on every run. */ sourcePoints?: Point2[]; /** Prototype width by name and class; the roadway drawn between the curbs may differ. */ width: number; /** Median curb-to-curb width measured by scripts/street_surfaces.py, when at least five stations were measured. */ pavedWidth?: number; oneway: number; kind?: string; /** False for drivable survey patches whose continuation has no traffic graph. */ traffic?:boolean; elevations?:number[]; /** Heights of the two ribbon edges, in deck side order [-1, +1], for banked merges. */ deckEdgeElevations?:[number,number][]; deckWidths?:number[]; deckTangents?:{start?:Point2;end?:Point2}; startLevel?:number; endLevel?:number; /** Covered intervals in metres along the road; omitted means fully covered. */ tunnel?:{clearance:number;covered?:[number,number][];/** Intact, wall-free street junction intervals in metres along the ramp. */surfaceLandings?:[number,number][];capStart?:boolean;capEnd?:boolean}; bridge?:{id:string;thickness:number;clearanceEstimated:boolean;sourceLayer?:number;/** Metre stations where surveyed lower structures must remain free of generated piers. */supportExclusions?:[number,number][]}; /** Travel lanes of a motorway deck, centred on the centreline 3.65 m apart; the deck width adds shoulders. */ lanes?:number; /** That end of the record is closed by a row of concrete barriers: traffic sinks into an end and emerges from a start. */ closed?:'start'|'end'; /** Survey building whose drivable mesh this record traces (the Zakim viaduct): resolveCity moves it to `CityData.surveyRoads`, which only traffic, GPS and the street-name displays read. */ surveyDeck?:string; /** The highway a tunnel record belongs to ('i90', 'storrow', 'route1a'); a deck says it in `bridge.id`. */ highway?:string; }
/** A sign the highway stage placed beside or over a road: `station` metres along `road`, facing its traffic. `clearance` is a posted low clearance (Storrow Drive), feet and inches as posted. */
/** A posted warning of the highway sidecar (Storrow Drive): `station` metres along record `road`. `clearance` is the height a LOW CLEARANCE sign posts. */
export interface HighwaySign { kind:'clearance'|'cars-only'; road:string; station:number; clearance?:string; }
/** `kind` is the OpenStreetMap building tag of a town extrusion (house, apartments, retail...). */
export interface Building { id: string; name: string; center: Point2; height: number; /** Generated wall height above base, excluding the pitched roof. */ eaveHeight?: number; footprint: Point2[]; landmark?: string; baseElevation?: number; kind?: string; amenity?: string; sourceName?: string; /** Preserve surveyed openings where the convex footprint crosses a road. */ collision?: 'mesh'; /** Generated northern house: assessor typology (victorian, mansard, old-style, colonial, cape, garage...), its roof form, year built and storeys. */ houseStyle?: string; roofShape?: string; yearBuilt?: number; stories?: number; /** Turrets the generated shell already carries. */ turrets?: number; }
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
  /** Source-aligned underground roads are loaded before any terrain or actor indexes: every sidecar in `files` (or the one `file`). */
  tunnels?: {file:string;files?:string[]};
  /** Signs listed by the tunnel sidecars (posted clearances). */
  highwaySigns?: HighwaySign[];
  /** Traces of drivable survey meshes (`Road.surveyDeck`), split from `roads` by resolveCity: traffic graph, GPS and street names only, never drawn, collided or sampled as a surface. */
  surveyRoads?: Road[];
  /** Tobin landmarks use metre stations on the northbound lower-deck spine. */
  tobinBridge?: { lowerRoadId:string; upperRoadId:string; mainSpan:[number,number]; mainPiers:[number,number]; littleSpan:[number,number]; };
}
export interface DriveInput { throttle: number; brake: number; steer: number; handbrake: boolean; wheelie?: boolean; }
export interface VehicleState { x: number; y: number; z: number; yaw: number; speed: number; steering: number; }
export type LightingMode = 'golden' | 'day' | 'night';
export type CameraMode = 'chase' | 'hood' | 'aerial';
export type TravelMode = 'drive' | 'helicopter' | 'bike' | 'walk';
