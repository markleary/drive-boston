import type {CityData,Point2,Road} from '../types';
import type {MetroCity} from './city-tiles.ts';
import {drawnStreets,type DrawnStreets,type StreetTile} from './drawn-streets.ts';
import type {RoadCells} from './road-cells.ts';
import {closestRoad,pointInside} from './roads.ts';
import {postClear,roadwayEdge} from './street-furniture.ts';
import {inTransitCorridor,shareTransitCorridors} from './transit-corridors.ts';
import {inTunnelApproach} from './tunnels.ts';
import {roadWidthAt,sampleRoadElevation} from './road-surfaces.ts';
import {sampleElevation} from './terrain.ts';

export interface PlacedSignal{position:Point2;source:Point2;road:Road;roadPoint:Point2;yaw:number;armLength:number;armYaw:number;}
/** The ground of the tile a signal stands in, where a streamed tile is at hand: a mast then stands behind the kerb
 * as that tile draws it (drawn-streets.ts), not half the street's class width from its centre line, which put 693 of
 * 2,419 masts in the asphalt of roadways wider than their class (most avenues) and of junction mouths. */
export interface SignalGround{
  streets:DrawnStreets;
  /** Whether a point lies in the tile: a signal is planned by the tile its street is met in, which sees the kerbs there. */
  owns(x:number,z:number):boolean;
  /** The building hulls about a point, whichever tile holds them. */
  hulls(x:number,z:number):readonly {footprint:Point2[]}[];
  /** What the tile has planted already (tree places, lamps, name signs): a mast keeps POST_GAP from each. */
  posts?:readonly Point2[];
  /** Whether a point lies in a tunnel approach (an open cut, a portal, a ramp's landing), asked of the whole city,
   * whose tunnel index is built once. Left out, the planner asks the city it was given. */
  excavated?(x:number,z:number):boolean;
}
/** The room a mast keeps to every roadway its tile draws (its footing is half a metre across), and to a tree, lamp or sign. */
export const SIGNAL_ROOM=.5,POST_GAP=1.2;
/** Where the two signal heads hang on a mast's arm, back from its tip (traffic-signals.ts draws them there), the room
 * each keeps inside the kerbs of the roadway it hangs over, and the longest arm. */
export const SIGNAL_HEADS=[.35,1.25],HEAD_ROOM=.3,ARM=7;
/** Whether both heads of an arm `length` long, from a mast at `p` toward (ux, uz), hang over a roadway: street
 * pavement as the tile draws it, or a deck where `decked` says so. A head beyond the tile's border is over ground
 * the tile cannot see: `beyond` answers for it. */
function headsOver(streets:DrawnStreets,p:Point2,ux:number,uz:number,length:number,beyond:boolean,decked?:(x:number,z:number)=>boolean){
  return SIGNAL_HEADS.every(back=>{const x=p[0]+ux*(length-back),z=p[1]+uz*(length-back);return decked?.(x,z)||(streets.inset(x,z)<0?beyond:streets.paved(x,z));});
}
/** The arm of a mast at `p`, stood `margin` behind a kerb: it reaches back over that kerb along the line the kerb was
 * found on, (ux, uz) from the mast, to 1.2 m short of the middle of the roadway there (`width` across on that line),
 * no shorter than brings both heads over the roadway and no longer than keeps them there. Undefined where no arm
 * does (a sliver of pavement), or where the tile sees a head hang over anything else: a mast is stood where its
 * signal heads hang over a roadway, or not at all. (A head beyond the tile's border hangs over the pavement that
 * runs on there: the tiles' polygons are one surface cut at the border.) */
function armOver(streets:DrawnStreets,p:Point2,ux:number,uz:number,margin:number,width:number){
  const least=margin+SIGNAL_HEADS[1]+HEAD_ROOM,most=Math.min(ARM,margin+width+SIGNAL_HEADS[0]-HEAD_ROOM);if(most<least)return undefined;
  const length=Math.min(most,Math.max(least,margin+width/2-1.2));
  return headsOver(streets,p,ux,uz,length,true)?{length,yaw:Math.atan2(ux,uz)}:undefined;
}
/** Stations along the signal's street, from the junction out, at which a mast is tried: closer together where the
 * kerb is read from the tile, so that a mast finds the corner the kerb comes round. */
const ALONG=[0,-7,7,-13,13,-20,20,-27,27],ALONG_KERB=[0,-4,4,-7,7,-10,10,-13,13,-16,16,-20,20,-27,27];
const cellSize=48;
function distance(point:Point2,a:Point2,b:Point2){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dz*t);}
/** GIS points identify controlled intersections, not guaranteed curbside poles.
 * Choose the nearest clear sidewalk corner; never leave hardware in a lane. With `ground` (a streamed tile's, see
 * planTileSignals) the lane is the roadway as drawn: a candidate stands a margin beyond the kerb at its own station,
 * with SIGNAL_ROOM to every roadway the tile draws, in no stall and POST_GAP from what is planted; surface streets
 * are then judged by their pavement alone, raised roads keep their ribbons. */
export function planTrafficSignals(city:CityData,ground?:SignalGround){
  // Preserve the existing major-road ownership rule city-wide. Only the
  // repaired interchange's narrow slips need an additional eligible source.
  // All roads still participate in the mast/lane clearance checks below.
  const approaches={...city,roads:city.roads.filter(r=>r.elevations&&r.bridge?.id==='harvard-memorial-approach')};
  const roads=new Map<string,{a:Point2;b:Point2;width:number;road:Road}[]>(),buildings=new Map<string,CityData['buildings']>();
  function eachCell(minX:number,maxX:number,minZ:number,maxZ:number,fn:(key:string)=>void){for(let x=Math.floor(minX/cellSize);x<=Math.floor(maxX/cellSize);x++)for(let z=Math.floor(minZ/cellSize);z<=Math.floor(maxZ/cellSize);z++)fn(`${x},${z}`);}
  for(const r of city.roads)for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],width=Math.max(r.width,r.deckWidths?.[i-1]??r.width,r.deckWidths?.[i]??r.width)/2+.55;eachCell(Math.min(a[0],b[0])-width,Math.max(a[0],b[0])+width,Math.min(a[1],b[1])-width,Math.max(a[1],b[1])+width,key=>{const list=roads.get(key)??[];list.push({a,b,width,road:r});roads.set(key,list);});}
  for(const b of city.buildings){const xs=b.footprint.map(p=>p[0]),zs=b.footprint.map(p=>p[1]);eachCell(Math.min(...xs)-.5,Math.max(...xs)+.5,Math.min(...zs)-.5,Math.max(...zs)+.5,key=>{const list=buildings.get(key)??[];list.push(b);buildings.set(key,list);});}
  const clear=(p:Point2,roadHeight:number)=>{
    const key=`${Math.floor(p[0]/cellSize)},${Math.floor(p[1]/cellSize)}`,footing=sampleElevation(city,...p),top=Math.max(footing,roadHeight)+5.65;
    // An elevated junction's mast reaches down to the terrain outside its
    // deck. Keep that entire vertical support clear of lower and upper lanes.
    return !(roads.get(key)??[]).some(s=>{
      if(ground&&!s.road.elevations)return false;
      const d=distance(p,s.a,s.b);if(d>=s.width||d>=roadWidthAt(s.road,...p)/2+.55)return false;
      const y=sampleRoadElevation(city,s.road,...p);return y>=footing-.55&&y<=top+.55;
    })&&!(ground?ground.hulls(...p):buildings.get(key)??[]).some(b=>pointInside(p,b.footprint)||b.footprint.some((a,i)=>distance(p,a,b.footprint[(i+1)%b.footprint.length])<.5));
  };
  /** Whether a point lies over the deck of a raised road, which no tile draws as street pavement. */
  const decked=(x:number,z:number)=>(roads.get(`${Math.floor(x/cellSize)},${Math.floor(z/cellSize)}`)??[]).some(s=>!!s.road.elevations&&distance([x,z],s.a,s.b)<roadWidthAt(s.road,x,z)/2);
  // No mast in a tunnel approach, where every other post is kept out too (street-furniture.ts): the terrain grid is
  // whole across a highway's open cut, which the runtime cuts out of it, so by its heights the road in the cut lies
  // under the mast's footing and `clear` passes it. The mast of a signal on Summer Street's viaduct stood in the lane
  // of the Turnpike's entrance ramp beneath it, 2 m over the road in the open cut.
  const excavated=ground?.excavated??((x:number,z:number)=>inTunnelApproach(city,x,z));
  const placed:PlacedSignal[]=[];
  for(const source of city.signals){
    const major=closestRoad(city,...source,true,{maxDistance:35}),approach=closestRoad(approaches,...source,false,{maxDistance:35});
    const nearest=approach.distance<major.distance?approach:major;if(!nearest.road||nearest.distance>35)continue;
    if(ground&&!ground.owns(nearest.x,nearest.z))continue;
    const tx=Math.sin(nearest.yaw),tz=Math.cos(nearest.yaw),normal:Point2=[-tz,tx],candidates:{p:Point2;roadPoint:Point2;cost:number;arm?:{length:number;yaw:number}}[]=[];
    // A surface street's kerb is read from the tile; a raised road has no drawn roadway and keeps its own width.
    const kerbed=ground&&!nearest.road.elevations?ground:undefined,half=(nearest.road.pavedWidth??nearest.road.width)/2,planted=ground?.posts?.filter(q=>Math.hypot(q[0]-source[0],q[1]-source[1])<60)??[];
    const tryAt=(p:Point2,roadPoint:Point2,along:number,arm?:{length:number;yaw:number})=>{
      if(inTransitCorridor(city,...p)||excavated(...p)||!clear(p,sampleRoadElevation(city,nearest.road,...roadPoint))||placed.some(s=>Math.hypot(s.position[0]-p[0],s.position[1]-p[1])<7))return;
      if(ground&&(!postClear(ground.streets,p[0],p[1],SIGNAL_ROOM)||planted.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<POST_GAP)))return;
      candidates.push({p,roadPoint,cost:Math.hypot(p[0]-source[0],p[1]-source[1])+Math.abs(along)*.08,arm});
    };
    for(const along of kerbed?ALONG_KERB:ALONG)for(const side of [-1,1]){
      // (the kerb the pavement ends at, whichever street's it is: at a junction the corner belongs to both, and beyond a second carriageway stands the far-side mast)
      const roadPoint:Point2=[nearest.x+tx*along,nearest.z+tz*along],nx=normal[0]*side,nz=normal[1]*side,kerb=kerbed&&roadwayEdge(kerbed.streets,roadPoint,nx,nz,half);
      if(kerbed&&(!kerb||kerb==='border'))continue;   // no kerb at the station: the pavement runs on down a cross street, or beyond what the tile sees
      const edge=kerb&&kerb!=='border'?kerb.edge:roadWidthAt(nearest.road,...roadPoint)/2;
      // The arm reaches back over that kerb, the roadway as wide as it is on this line (the centre line can run along one kerb).
      const far=kerb&&kerb!=='border'?roadwayEdge(kerbed!.streets,roadPoint,-nx,-nz,half):undefined,width=edge+(far&&far!=='border'?far.edge:half);
      for(const margin of [1.25,2.0]){
        // (a raised road has no drawn roadway: its arm reaches toward its line as in the survey build, and its mast stands
        // only where the heads then hang over a deck or a street's pavement: a station can lie beyond the end of the road)
        const p:Point2=[roadPoint[0]+nx*(edge+margin),roadPoint[1]+nz*(edge+margin)],reach=Math.min(ARM,edge+margin-1.2);
        const arm=kerbed?armOver(kerbed.streets,p,-nx,-nz,margin,width):ground&&headsOver(ground.streets,p,-nx,-nz,reach,false,decked)?{length:reach,yaw:Math.atan2(-nx,-nz)}:undefined;
        if(!ground||arm)tryAt(p,roadPoint,along,arm);
      }
    }
    // No kerb beside the street within reach (its perpendiculars run on across a wide junction): the nearest kerb to
    // the signal itself, looked for on sixteen bearings. Its arm reaches across the signal's street, toward the
    // street's line, where the heads then hang over the roadway; that line can lie 20 m from the kerb, along the
    // kerb or beyond an island (such an arm hung its heads over the sidewalk), and the arm then reaches back along
    // the bearing the kerb was found on.
    if(kerbed&&!candidates.length)for(let k=0;k<16;k++){
      const dx=Math.sin(k*Math.PI/8),dz=Math.cos(k*Math.PI/8),kerb=roadwayEdge(kerbed.streets,source,dx,dz,half);if(!kerb||kerb==='border')continue;
      const far=roadwayEdge(kerbed.streets,source,-dx,-dz,half),width=kerb.edge+(far&&far!=='border'?far.edge:half);
      for(const margin of [1.25,2.0]){
        const p:Point2=[source[0]+dx*(kerb.edge+margin),source[1]+dz*(kerb.edge+margin)],along=(p[0]-nearest.x)*tx+(p[1]-nearest.z)*tz,roadPoint:Point2=[nearest.x+tx*along,nearest.z+tz*along];
        const reach=Math.hypot(roadPoint[0]-p[0],roadPoint[1]-p[1]),ux=(roadPoint[0]-p[0])/(reach||1),uz=(roadPoint[1]-p[1])/(reach||1),across=Math.min(ARM,reach-1.2);
        const arm=across>=margin+SIGNAL_HEADS[1]+HEAD_ROOM&&headsOver(kerbed.streets,p,ux,uz,across,false)?{length:across,yaw:Math.atan2(ux,uz)}:armOver(kerbed.streets,p,-dx,-dz,margin,width);
        if(arm)tryAt(p,roadPoint,0,arm);
      }
    }
    candidates.sort((a,b)=>a.cost-b.cost);const best=candidates[0];if(!best)continue;
    const dx=best.roadPoint[0]-best.p[0],dz=best.roadPoint[1]-best.p[1];
    placed.push({position:best.p,source,road:nearest.road,roadPoint:best.roadPoint,yaw:nearest.yaw,armLength:best.arm?.length??Math.min(ARM,Math.hypot(dx,dz)-1.2),armYaw:best.arm?.yaw??Math.atan2(dx,dz)});
  }
  return placed;
}

/** The signal masts of one tile as the tile builder plans them, so that a test or an audit plans the same. A signal
 * is planned by one tile: the one in which its street is met (the nearest point of that street to the signal, which
 * can lie 35 m from the signal and so across a border from it), since that tile draws the kerbs a mast is stood
 * behind. Before, every tile within 40 m of a signal planned it, and 338 masts were drawn twice. `posts`: what the
 * tile's furniture stage planted. A mast the tile cannot stand clear of its roadway is left out. */
export function planTileSignals(city:MetroCity,tile:StreetTile,roads:RoadCells,posts:readonly Point2[]=[]):PlacedSignal[]{
  const size=tile.size,minX=tile.tx*size,minZ=tile.tz*size,bounds={minX,maxX:minX+size,minZ,maxZ:minZ+size};
  const signals=city.signals.filter(s=>s[0]>=minX-40&&s[0]<bounds.maxX+40&&s[1]>=minZ-40&&s[1]<bounds.maxZ+40);if(!signals.length)return [];
  const about=roads.near({minX:minX-80,maxX:bounds.maxX+80,minZ:minZ-80,maxZ:bounds.maxZ+80}),view:CityData={...city,roads:about,signals,buildings:[]};
  shareTransitCorridors(view,city);
  return planTrafficSignals(view,{streets:drawnStreets(tile),owns:(x,z)=>x>=minX&&x<bounds.maxX&&z>=minZ&&z<bounds.maxZ,hulls:(x,z)=>city.index.query(x-.5,x+.5,z-.5,z+.5).filter(hull=>!hull.fragment),posts,excavated:(x,z)=>inTunnelApproach(city,x,z)});
}
