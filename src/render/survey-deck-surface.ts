import * as THREE from 'three';
import type {CityData,Point2,Road} from '../types';
import type {TileBuildingGeometry} from '../simulation/tile-format.ts';
import {surveyDeckCarriageways,type DeckStation,type TracedDeck} from '../simulation/survey-deck-lanes.ts';
import type {DeckParapet} from '../simulation/survey-deck-parapets.ts';
import {deckEdge,sampleRoadElevation} from '../simulation/road-surfaces.ts';
import {PartBatches,TriangleWriter,box} from './geometry-writer.ts';
import {drain} from './pacing.ts';

const LINE=.15,DASH=3,GAP=9,MIN_LANE_WIDTH=3.4,PROFILE=5;
// A sourced road deck paves the survey where it runs from 1.5 cm under it (its
// asphalt, drawn 1.8 to 2.5 cm over the deck, still shows) to 1.5 m over it. A
// deck deeper under the survey is hidden by it and leaves it paved and painted.
const UNDER=.015,OVER=1.5;
// The overlay lies a few centimetres above the survey deck; a bias toward the
// camera keeps it, and the paint above it, from flickering with the deck at range.
const decked=new WeakMap<THREE.Material,THREE.Material>();
const biased=(material:THREE.Material,units:number)=>{
  let out=decked.get(material);if(!out){out=material.clone();out.polygonOffset=true;out.polygonOffsetFactor=-1;out.polygonOffsetUnits=units;decked.set(material,out);}
  return out;
};

type P3=[number,number,number];
/** Interstate pavement on a surveyed structure's carriageways (the Zakim and
 * the Charlestown I-93 viaduct): asphalt over every deck face a traced
 * carriageway crosses (so the pavement runs on through the splits, merges and
 * gores between traced stretches, out to the survey's own barriers), solid
 * edge lines inside the shoulders and dashed 3 m on 9 m lane lines. Each
 * station's deck profile is sampled once at five points across, and the paint
 * lies on those profiles. `traced` is the structure's carriageways, when the
 * caller has them. */
export function addSurveyDeckSurface(target:THREE.Object3D,city:CityData,data:TileBuildingGeometry,materials:{asphalt:THREE.Material;paint:THREE.Material},traced=surveyDeckCarriageways(data)){
  return drain(addSurveyDeckSurfaceSteps(target,city,data,materials,traced));
}
/** `addSurveyDeckSurface` in steps, pausing every few stations, lines or
 * pavement pieces, so a paced tile build spreads it across frames. */
export function* addSurveyDeckSurfaceSteps(target:THREE.Object3D,city:CityData,data:TileBuildingGeometry,materials:{asphalt:THREE.Material;paint:THREE.Material},traced:TracedDeck):Generator<void,THREE.Group>{
  const {carriageways,surface}=traced,batches=new PartBatches(400);
  const asphalt=biased(materials.asphalt,-2),paint=biased(materials.paint,-4);
  let lines=0,faces=0;
  const pieces=yield* surveyDeckPavementSteps(city,data,carriageways.map(c=>c.stations));
  for(const piece of pieces){
    if(faces%16===15)yield;
    const sink=batches.at(asphalt,piece[0][0],piece[0][2]);faces++;
    for(let k=2;k<piece.length;k++)upTriangle(sink,piece[0],piece[k-1],piece[k],[piece[0][0]/5,piece[0][2]/5],[piece[k-1][0]/5,piece[k-1][2]/5],[piece[k][0]/5,piece[k][2]/5]);
  }
  const runs=yield* uncoveredSteps(city,carriageways.map(c=>c.stations));
  for(const stations of runs){
    const at=(s:DeckStation,offset:number):Point2=>[s.x-s.tz*offset,s.z+s.tx*offset];
    // The deck nearest the station's own level and crossfall, so a ramp
    // passing over or under this one never captures the paint.
    const profiles:number[][]=[];
    for(const s of stations){
      if(profiles.length%16===15)yield;
      profiles.push(Array.from({length:PROFILE},(_,k)=>{
        const offset=s.half*(2*k/(PROFILE-1)-1),[x,z]=at(s,offset);
        return surface(x,z,s.y+(offset>0?s.yLeft-s.y:s.y-s.yRight)*offset/s.half);
      }));
    }
    const height=(i:number,offset:number)=>{
      const s=stations[i],f=Math.max(0,Math.min(PROFILE-1,(offset/s.half+1)*(PROFILE-1)/2)),k=Math.min(PROFILE-2,Math.floor(f));
      return profiles[i][k]+(profiles[i][k+1]-profiles[i][k])*(f-k);
    };
    const point=(i:number,offset:number,lift:number):P3=>{const [x,z]=at(stations[i],offset);return[x,height(i,offset)+lift,z];};
    // Line offsets across each station: the lanes centred between equal
    // shoulders, none where the deck is too narrow to be a lane (a gore strip).
    const offsets=stations.map(s=>{
      const lanes=s.lanes,width=s.half*2,shoulder=Math.max(.3,(width-lanes*3.65)/2),lane=(width-2*shoulder)/lanes;
      return lane<MIN_LANE_WIDTH?[]:Array.from({length:lanes+1},(_,k)=>-s.half+shoulder+k*lane);
    });
    // Lines run in stretches with one lane count; a merge or lane drop starts a new stretch.
    for(let start=0;start<stations.length;){
      let end=start+1;while(end<stations.length&&offsets[end].length===offsets[start].length)end++;
      const first=start,count=offsets[start].length;start=end;
      if(end-first<2||count<2)continue;
      for(let k=0;k<count;k++){
        yield;
        const line=Array.from({length:end-first},(_,j)=>point(first+j,offsets[first+j][k],.06));
        for(const part of k===0||k===count-1?[line]:dashes(line)){ribbon(batches.at(paint,part[0][0],part[0][2]),part,LINE);lines++;}
      }
    }
  }
  const group=new THREE.Group();group.name='Survey deck pavement and lanes';
  for(const mesh of batches.meshes()){mesh.receiveShadow=true;mesh.renderOrder=mesh.material===asphalt?-1:0;group.add(mesh);}
  group.userData={carriageways:carriageways.length,lines,faces};
  target.add(group);return group;
}

/** The generated parapets (`surveyDeckParapets`) as concrete boxes in the
 * survey's own shell finish. */
export function addSurveyDeckParapets(target:THREE.Object3D,parapets:readonly DeckParapet[],material:THREE.Material){
  const batches=new PartBatches(400),m=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),one=new THREE.Vector3(1,1,1),at=new THREE.Vector3();
  for(const p of parapets){
    // As a deck rail: pitched about its own width, then turned to its heading.
    m.compose(at.set(p.x,p.y,p.z),q.setFromEuler(e.set(-p.slope,p.yaw,0,'YXZ')),one);
    batches.at(material,p.x,p.z).box(box(p.width,p.height,p.length),m);
  }
  const group=new THREE.Group();group.name='Generated survey deck parapets';group.userData={parapets:parapets.length};
  for(const mesh of batches.meshes()){mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
  target.add(group);return group;
}

/** A quad a-b-c-d as two triangles, each wound to face up on its own (a
 * line jogging at a merge can twist the quad). */
function upward(sink:TriangleWriter,a:P3,b:P3,c:P3,d:P3,ua:Point2,ub:Point2,uc:Point2,ud:Point2){
  upTriangle(sink,a,b,c,ua,ub,uc);upTriangle(sink,a,c,d,ua,uc,ud);
}
/** A triangle p-q-r wound to face up. */
function upTriangle(sink:TriangleWriter,p:P3,q:P3,r:P3,up:Point2,uq:Point2,ur:Point2){
  if((q[2]-p[2])*(r[0]-p[0])-(q[0]-p[0])*(r[2]-p[2])<0)sink.triangle(...r,...q,...p,...ur,...uq,...up);else sink.triangle(...p,...q,...r,...up,...uq,...ur);
}

/** Twice the signed area of a plan polygon (x, z): positive when its inside
 * lies left of each edge. */
const area2=(poly:Point2[])=>{let s=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];s+=a[0]*b[1]-b[0]*a[1];}return s;};
/** The parts of a convex polygon left of (inside) and right of the line a-b. */
function cut(poly:Point2[],a:Point2,b:Point2):[Point2[],Point2[]]{
  const left:Point2[]=[],right:Point2[]=[],side=(p:Point2)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],sp=side(p),sq=side(q);
    if(sp>=0)left.push(p);if(sp<=0)right.push(p);
    if((sp>0&&sq<0)||(sp<0&&sq>0)){const t=sp/(sp-sq),m:Point2=[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];left.push(m);right.push(m);}
  }
  return[left,right];
}
/** The part of a convex polygon where the linear function `f` is not negative. */
function within(poly:Point2[],f:(p:Point2)=>number){
  const out:Point2[]=[];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],fp=f(p),fq=f(q);
    if(fp>=0)out.push(p);
    if((fp>0&&fq<0)||(fp<0&&fq>0)){const t=fp/(fp-fq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
  }
  return out;
}
/** A convex polygon less a convex polygon `hole`, as convex pieces. */
function subtract(poly:Point2[],hole:Point2[]){
  if(area2(hole)<0)hole=[...hole].reverse();
  const out:Point2[][]=[];let rest=poly;
  for(let i=0;i<hole.length&&rest.length>=3;i++){const [inside,outside]=cut(rest,hole[i],hole[(i+1)%hole.length]);if(Math.abs(area2(outside))>1e-4)out.push(outside);rest=inside;}
  return Math.abs(area2(rest))>1e-4?out:[poly];
}
/** Whether two convex plan polygons overlap by more than a sliver (separating axes). */
function overlaps(a:Point2[],b:Point2[],margin=1e-3){
  for(const poly of [a,b])for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],nx=q[1]-p[1],nz=p[0]-q[0],l=Math.hypot(nx,nz);if(l<1e-9)continue;
    let a0=Infinity,a1=-Infinity,b0=Infinity,b1=-Infinity;
    for(const v of a){const d=(v[0]*nx+v[1]*nz)/l;a0=Math.min(a0,d);a1=Math.max(a1,d);}
    for(const v of b){const d=(v[0]*nx+v[1]*nz)/l;b0=Math.min(b0,d);b1=Math.max(b1,d);}
    if(a1<b0+margin||b1<a0+margin)return false;
  }
  return true;
}

/** The survey deck the pavement covers, as convex pieces lifted 3 cm over it:
 * every flat upward face a traced carriageway (inset 15 cm from its barriers)
 * crosses at its own level, whole, so the asphalt reaches past the stations
 * where a walk stopped (a split, a merge, a gore) to the next traced stretch;
 * less the decks of sourced roads that pave the survey themselves (the Central
 * Artery bores, the Leverett and Storrow ramps, the new I-93 decks at City
 * Square and the Charlestown mouth), which draw their own asphalt and lanes
 * (`roadDeckGeometry`, for a tunnel's roadway too). */
export function surveyDeckPavement(city:CityData,data:TileBuildingGeometry,carriageways:DeckStation[][],lift=.03){return drain(surveyDeckPavementSteps(city,data,carriageways,lift));}
/** `surveyDeckPavement` in steps: a pause every 20,000 grid entries while
 * filing the deck faces, then every 16 station pairs, after each elevated road
 * (and every 500 roads) and every 16 paved faces. */
function* surveyDeckPavementSteps(city:CityData,data:TileBuildingGeometry,carriageways:DeckStation[][],lift=.03):Generator<void,P3[][]>{
  type Face={tri:Point2[];x0:number;y0:number;z0:number;gx:number;gz:number;minX:number;maxX:number;minZ:number;maxZ:number};
  const v=data.positions,faces:Face[]=[],CELL=8,cells=new Map<string,number[]>();let work=0;
  /** File `item` in every cell its bounds touch, returning how many. */
  const bucket=<T>(grid:Map<string,T[]>,item:T,minX:number,maxX:number,minZ:number,maxZ:number)=>{
    let n=0;for(let cx=Math.floor(minX/CELL);cx<=Math.floor(maxX/CELL);cx++)for(let cz=Math.floor(minZ/CELL);cz<=Math.floor(maxZ/CELL);cz++){n++;const k=`${cx},${cz}`,list=grid.get(k);if(list)list.push(item);else grid.set(k,[item]);}
    return n;
  };
  const near=<T>(grid:Map<string,T[]>,minX:number,maxX:number,minZ:number,maxZ:number)=>{
    const out=new Set<T>();for(let cx=Math.floor(minX/CELL);cx<=Math.floor(maxX/CELL);cx++)for(let cz=Math.floor(minZ/CELL);cz<=Math.floor(maxZ/CELL);cz++)for(const item of grid.get(`${cx},${cz}`)??[])out.add(item);return out;
  };
  for(let i=0;i<data.roof.length;i+=3){
    if(++work>=20000){work=0;yield;}
    const a=data.roof[i]*3,b=data.roof[i+1]*3,c=data.roof[i+2]*3;
    const dx1=v[b]-v[a],dy1=v[b+1]-v[a+1],dz1=v[b+2]-v[a+2],dx2=v[c]-v[a],dy2=v[c+1]-v[a+1],dz2=v[c+2]-v[a+2];
    // The same flat, upward faces the tracer drives on.
    const ny=dz1*dx2-dx1*dz2,nx=dy1*dz2-dz1*dy2,nz=dx1*dy2-dy1*dx2;if(ny<=1e-6||Math.hypot(nx,nz)/ny>.25)continue;
    const det=dx1*dz2-dz1*dx2,tri:Point2[]=[[v[a],v[a+2]],[v[b],v[b+2]],[v[c],v[c+2]]];
    const face:Face={tri,x0:v[a],y0:v[a+1],z0:v[a+2],gx:(dy1*dz2-dy2*dz1)/det,gz:(dy2*dx1-dy1*dx2)/det,minX:Math.min(v[a],v[b],v[c]),maxX:Math.max(v[a],v[b],v[c]),minZ:Math.min(v[a+2],v[b+2],v[c+2]),maxZ:Math.max(v[a+2],v[b+2],v[c+2])};
    work+=bucket(cells,faces.push(face)-1,face.minX,face.maxX,face.minZ,face.maxZ);
  }
  const height=(f:Face,x:number,z:number)=>f.y0+f.gx*(x-f.x0)+f.gz*(z-f.z0);
  const bounds=(poly:Point2[])=>{let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const [x,z] of poly){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}return[minX,maxX,minZ,maxZ] as const;};
  // Faces the traced stretches cross: each pair of stations, as two triangles.
  const paved=new Set<number>();
  for(const stations of carriageways)for(let i=1;i<stations.length;i++){
    if(i%16===0)yield;
    const a=stations[i-1],b=stations[i],at=(s:DeckStation,o:number):Point2=>[s.x-s.tz*o,s.z+s.tx*o],ha=Math.max(.1,a.half-.15),hb=Math.max(.1,b.half-.15);
    const la=at(a,ha),ra=at(a,-ha),lb=at(b,hb),rb=at(b,-hb),y=(a.y+b.y)/2,cx=(a.x+b.x)/2,cz=(a.z+b.z)/2;
    for(const part of [[la,lb,rb],[la,rb,ra]]){
      for(const f of near(cells,...bounds(part)))if(!paved.has(f)&&Math.abs(height(faces[f],cx,cz)-y)<.35&&overlaps(part,faces[f].tri))paved.add(f);
    }
  }
  // Sourced road decks over the survey, as the triangles roadDeckGeometry draws.
  const decks=new Map<string,{tri:Point2[];y:number[]}[]>(),[minX,maxX,minZ,maxZ]=bounds(faces.flatMap(f=>f.tri));
  let roads=0;
  for(const road of city.roads){
    if(++roads%500===0)yield;
    if(!road.elevations||!road.points.some(([x,z])=>x>minX-60&&x<maxX+60&&z>minZ-60&&z<maxZ+60))continue;
    const edge=(i:number,side:number)=>road.deckEdgeElevations?.[i]?.[side<0?0:1]??road.elevations![i];
    for(let i=1;i<road.points.length;i++){
      const l0=deckEdge(road,i-1,-1),r0=deckEdge(road,i-1,1),l1=deckEdge(road,i,-1),r1=deckEdge(road,i,1);
      for(const deck of [{tri:[l0,r0,l1],y:[edge(i-1,-1),edge(i-1,1),edge(i,-1)]},{tri:[r0,r1,l1],y:[edge(i-1,1),edge(i,1),edge(i,-1)]}]){const [minX,maxX,minZ,maxZ]=bounds(deck.tri);bucket(decks,deck,minX,maxX,minZ,maxZ);}
    }
    yield;
  }
  const out:P3[][]=[];
  let shaped=0;
  for(const f of [...paved].sort((a,b)=>a-b)){
    if(++shaped%16===0)yield;
    const face=faces[f];let pieces=[face.tri];
    for(const deck of near(decks,face.minX,face.maxX,face.minZ,face.maxZ)){
      const [minX,maxX,minZ,maxZ]=bounds(deck.tri);if(maxX<face.minX||minX>face.maxX||maxZ<face.minZ||minZ>face.maxZ||!overlaps(face.tri,deck.tri))continue;
      // Only where the road deck has reached this face (UNDER, OVER): a ramp
      // climbing out from under the survey paves it from the line where it
      // surfaces, one passing beneath leaves it paved.
      const gap=deck.tri.map(([x,z],k)=>deck.y[k]-height(face,x,z));
      let hole=deck.tri;
      if(gap.some(g=>g<-UNDER||g>=OVER)){
        const [a,b,c]=deck.tri,d1x=b[0]-a[0],d1z=b[1]-a[1],d2x=c[0]-a[0],d2z=c[1]-a[1],det=d1x*d2z-d1z*d2x;if(Math.abs(det)<1e-9)continue;
        const gx=((gap[1]-gap[0])*d2z-(gap[2]-gap[0])*d1z)/det,gz=((gap[2]-gap[0])*d1x-(gap[1]-gap[0])*d2x)/det,at=(p:Point2)=>gap[0]+gx*(p[0]-a[0])+gz*(p[1]-a[1]);
        hole=within(within(hole,p=>OVER-at(p)),p=>at(p)+UNDER);if(hole.length<3||Math.abs(area2(hole))<1e-3)continue;
      }
      pieces=pieces.flatMap(p=>overlaps(p,hole)?subtract(p,hole):[p]);
    }
    for(const p of pieces)if(Math.abs(area2(p))>.01)out.push(p.map(([x,z]):P3=>[x,height(face,x,z)+lift,z]));
  }
  return out;
}

/** A flat paint ribbon `width` wide along a 3D polyline. */
function ribbon(sink:TriangleWriter,line:P3[],width:number){
  const side=(i:number):Point2=>{const a=line[Math.max(0,i-1)],b=line[Math.min(line.length-1,i+1)],dx=b[0]-a[0],dz=b[2]-a[2],l=Math.hypot(dx,dz)||1;return[-dz/l*width/2,dx/l*width/2];};
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],sa=side(i-1),sb=side(i);
    upward(sink,[a[0]+sa[0],a[1],a[2]+sa[1]],[b[0]+sb[0],b[1],b[2]+sb[1]],[b[0]-sb[0],b[1],b[2]-sb[1]],[a[0]-sa[0],a[1],a[2]-sa[1]],[0,0],[0,1],[1,1],[1,0]);
  }
}

/** The stretches of each carriageway no sourced road deck already paves (one
 * from UNDER under the station to OVER over it): the Central Artery and
 * Leverett Connector ramps join the survey at its lips and draw their own
 * asphalt and lanes over the last 50 m of it. */
export function uncovered(city:CityData,carriageways:DeckStation[][]){return drain(uncoveredSteps(city,carriageways));}
/** `uncovered` in steps, a pause after each elevated road, every 500 roads
 * and every 16 stations. */
function* uncoveredSteps(city:CityData,carriageways:DeckStation[][]):Generator<void,DeckStation[][]>{
  // Segments of the elevated roads, bucketed in 25 m cells by their reach.
  const cells=new Map<string,{road:Road;a:Point2;b:Point2}[]>();let n=0;
  for(const road of city.roads){
    if(++n%500===0)yield;
    if(!road.elevations)continue;const r=road.width/2;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i];
      for(let cx=Math.floor((Math.min(a[0],b[0])-r)/25);cx<=Math.floor((Math.max(a[0],b[0])+r)/25);cx++)for(let cz=Math.floor((Math.min(a[1],b[1])-r)/25);cz<=Math.floor((Math.max(a[1],b[1])+r)/25);cz++){
        const k=`${cx},${cz}`,list=cells.get(k),entry={road,a,b};if(list)list.push(entry);else cells.set(k,[entry]);
      }
    }
    yield;
  }
  const covered=(s:DeckStation)=>(cells.get(`${Math.floor(s.x/25)},${Math.floor(s.z/25)}`)??[]).some(({road,a,b})=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((s.x-a[0])*dx+(s.z-a[1])*dz)/(dx*dx+dz*dz||1)));
    if(Math.hypot(s.x-a[0]-dx*t,s.z-a[1]-dz*t)>=road.width/2)return false;
    const over=sampleRoadElevation(city,road,s.x,s.z)-s.y;return over>=-UNDER&&over<OVER;
  });
  const out:DeckStation[][]=[];
  for(const stations of carriageways){let run:DeckStation[]=[];for(const [i,s] of stations.entries()){if(i%16===15)yield;if(covered(s)){if(run.length>1)out.push(run);run=[];}else run.push(s);}if(run.length>1)out.push(run);}
  return out;
}

/** 3 m dashes every 12 m along a polyline (measured in plan), cut at their exact stations. */
export function dashes(line:P3[]){
  const out:P3[][]=[];let travelled=0,current:P3[]|undefined;
  const inDash=(d:number)=>((d%(DASH+GAP))+DASH+GAP)%(DASH+GAP)<DASH;
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],length=Math.hypot(b[0]-a[0],b[2]-a[2]);if(length<1e-6)continue;
    const point=(d:number):P3=>{const t=(d-travelled)/length;return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];};
    // Every dash boundary inside this segment, then the segment's end.
    const cuts:number[]=[];for(let d=Math.floor(travelled/(DASH+GAP))*(DASH+GAP);d<travelled+length;d+=DASH+GAP)for(const c of [d,d+DASH])if(c>travelled&&c<travelled+length)cuts.push(c);
    let from=travelled;
    for(const c of [...cuts,travelled+length]){
      if(inDash((from+c)/2)){if(!current){current=[point(from)];out.push(current);}current.push(point(c));}else current=undefined;
      from=c;
    }
    travelled+=length;
  }
  return out;
}
