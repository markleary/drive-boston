import type {Point2,Road} from '../types';

/** One name blade. `yaw` turns the blade's face normal (+Z) so the blade runs
 * parallel to the street it names; `height` is the blade center above the pole base. */
export interface StreetSignBlade{name:string;yaw:number;height:number}
/** A corner pole. `blades[0]` names the main street; a second, higher blade names the side street. */
export interface PlacedStreetSign{position:Point2;corner:Point2;blades:StreetSignBlade[]}

export const BLADE_HEIGHTS=[3.0,3.54],POLE_HEIGHT=3.85;
const key=(p:Point2)=>`${Math.round(p[0]*2)},${Math.round(p[1]*2)}`;
const unsigned=(road:Road)=>!road.name||!!road.elevations||/alley|unnamed|driveway|parking|private|ramp|tunnel|turnpike|expressway|highway|interstate|connector|^I-?\d/i.test(road.name)||/^(motorway|trunk)|_link$/.test(road.kind??'');
/** Stable [0,1) draw per intersection, so a corner is signed the same way whichever tile builds it. */
function draw(text:string){let n=2166136261;for(let i=0;i<text.length;i++)n=Math.imul(n^text.charCodeAt(i),16777619);n=Math.imul(n^n>>>15,2246822507);n=Math.imul(n^n>>>13,3266489909);return ((n^n>>>16)>>>0)/4294967296;}
const label=(name:string)=>name.replace(/\bStreet\b/,'ST').replace(/\bAvenue\b/,'AVE').toUpperCase();
/** Unit direction leaving vertex `i` along the road, or null for a degenerate piece. */
function away(road:Road,i:number):Point2|null{const p=road.points[i],q=road.points[i+1]??road.points[i-1];if(!q)return null;const dx=q[0]-p[0],dz=q[1]-p[1],l=Math.hypot(dx,dz);return l<.1?null:[dx/l,dz/l];}

/** Boston signs few of its corners. Intersections are road vertices shared by
 * differently named ground-level streets (centerlines are split where streets
 * meet). A corner is signed with a probability that grows with the main
 * street's width, and nearby signed corners of the same street are thinned,
 * so most side-street junctions carry nothing. Where there is a pole, the main
 * street's blade runs parallel to the main street and, at some corners, the
 * side street's blade sits above it, parallel to the side street.
 *
 * `roads` must include every road within ~150 m of the corners the caller
 * keeps; `owns` picks which corners this call places, `clear` rejects a pole
 * position inside a lane, building or rail corridor. */
export function planStreetSigns(roads:Road[],clear:(x:number,z:number)=>boolean,owns:(x:number,z:number)=>boolean=()=>true):PlacedStreetSign[]{
  const nodes=new Map<string,{road:Road;index:number}[]>();
  for(const road of roads){if(unsigned(road))continue;road.points.forEach((p,index)=>{const k=key(p),list=nodes.get(k);if(list)list.push({road,index});else nodes.set(k,[{road,index}]);});}
  // A road seen with an elevation profile anywhere at a vertex means that vertex is a grade-separated crossing.
  const elevated=new Set<string>();for(const road of roads)if(road.elevations)for(const p of road.points)elevated.add(key(p));
  type Corner={k:string;p:Point2;main:{road:Road;index:number};side:{road:Road;index:number};score:number};
  const corners:Corner[]=[];
  for(const [k,stops] of nodes){
    if(elevated.has(k))continue;
    const widest=new Map<string,{road:Road;index:number}>();
    for(const s of stops){const w=widest.get(s.road.name);if(!w||s.road.width>w.road.width)widest.set(s.road.name,s);}
    if(widest.size<2)continue;
    const [main,side]=[...widest.values()].sort((a,b)=>b.road.width-a.road.width||(a.road.name<b.road.name?-1:1));
    const score=draw(k),chance=main.road.width>=12?.42:main.road.width>=9?.3:.14;
    if(score<chance)corners.push({k,p:main.road.points[main.index],main,side,score});
  }
  // Thin out: a corner yields to any lower-scored signed corner within 45 m, or of the same main street within 130 m.
  const cell=130,grid=new Map<string,Corner[]>();
  for(const c of corners){const g=`${Math.floor(c.p[0]/cell)},${Math.floor(c.p[1]/cell)}`,list=grid.get(g);if(list)list.push(c);else grid.set(g,[c]);}
  const beats=(o:Corner,c:Corner)=>o.score<c.score||o.score===c.score&&o.k<c.k;
  const placed:PlacedStreetSign[]=[];
  for(const c of corners){
    if(!owns(...c.p))continue;
    const gx=Math.floor(c.p[0]/cell),gz=Math.floor(c.p[1]/cell);let yields=false;
    for(let x=gx-1;x<=gx+1&&!yields;x++)for(let z=gz-1;z<=gz+1&&!yields;z++)for(const o of grid.get(`${x},${z}`)??[]){
      if(o===c||!beats(o,c))continue;const d=Math.hypot(o.p[0]-c.p[0],o.p[1]-c.p[1]);
      if(d<45||d<130&&o.main.road.name===c.main.road.name){yields=true;break;}
    }
    if(yields)continue;
    const u=away(c.main.road,c.main.index),v=away(c.side.road,c.side.index);if(!u||!v)continue;
    // Corner of the two street strips: `a` off the main centerline, `b` off the side one.
    const n:Point2=[-u[1],u[0]],cross=v[0]*u[1]-v[1]*u[0],crossN=v[0]*n[1]-v[1]*n[0];
    let position:Point2|null=null;
    for(const margin of [1.35,2.1])for(const s1 of [1,-1])for(const s2 of [1,-1]){
      if(position)break;
      const a=c.main.road.width/2+margin,b=c.side.road.width/2+margin,t=Math.abs(cross)<.3?s2*(b+2):(s2*b-s1*a*crossN)/cross;
      if(Math.abs(t)>18)continue;
      const x=c.p[0]+n[0]*s1*a+u[0]*t,z=c.p[1]+n[1]*s1*a+u[1]*t;if(clear(x,z))position=[x,z];
    }
    if(!position)continue;
    const blades:StreetSignBlade[]=[{name:label(c.main.road.name),yaw:Math.atan2(u[0],u[1])+Math.PI/2,height:BLADE_HEIGHTS[0]}];
    // A straight name change (no real cross street) keeps only the main blade.
    if(Math.abs(cross)>.5&&draw(c.k+'|side')<(c.side.road.width>=10?.55:.3))blades.push({name:label(c.side.road.name),yaw:Math.atan2(v[0],v[1])+Math.PI/2,height:BLADE_HEIGHTS[1]});
    placed.push({position,corner:c.p,blades});
  }
  return placed;
}
