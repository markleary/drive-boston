import * as THREE from 'three';
import type {CityData,Point2,Road} from '../types';
import type {TileBuildingGeometry} from '../simulation/tile-format.ts';
import {surveyDeckCarriageways,type DeckStation} from '../simulation/survey-deck-lanes.ts';
import {sampleRoadElevation} from '../simulation/road-surfaces.ts';
import {PartBatches,TriangleWriter} from './geometry-writer.ts';

const LINE=.15,DASH=3,GAP=9,MIN_LANE_WIDTH=3.4,PROFILE=5;
// The overlay lies a few centimetres above the survey deck; a bias toward the
// camera keeps it, and the paint above it, from flickering with the deck at range.
const decked=new WeakMap<THREE.Material,THREE.Material>();
const biased=(material:THREE.Material,units:number)=>{
  let out=decked.get(material);if(!out){out=material.clone();out.polygonOffset=true;out.polygonOffsetFactor=-1;out.polygonOffsetUnits=units;decked.set(material,out);}
  return out;
};

type P3=[number,number,number];
/** Interstate pavement on a surveyed structure's carriageways (the Zakim and
 * the Charlestown I-93 viaduct): asphalt between the measured barriers, solid
 * edge lines inside the shoulders and dashed 3 m on 9 m lane lines. Each
 * station's deck profile is sampled once at five points across, and the
 * pavement and paint lie on those profiles. */
export function addSurveyDeckSurface(target:THREE.Object3D,city:CityData,data:TileBuildingGeometry,materials:{asphalt:THREE.Material;paint:THREE.Material}){
  const {carriageways,surface}=surveyDeckCarriageways(data),batches=new PartBatches(400);
  const asphalt=biased(materials.asphalt,-2),paint=biased(materials.paint,-4);
  let lines=0;
  for(const stations of uncovered(city,carriageways.map(c=>c.stations))){
    const at=(s:DeckStation,offset:number):Point2=>[s.x-s.tz*offset,s.z+s.tx*offset];
    // The deck nearest the station's own level and crossfall, so a ramp
    // passing over or under this one never captures the pavement.
    const profiles=stations.map(s=>Array.from({length:PROFILE},(_,k)=>{
      const offset=s.half*(2*k/(PROFILE-1)-1),[x,z]=at(s,offset);
      return surface(x,z,s.y+(offset>0?s.yLeft-s.y:s.y-s.yRight)*offset/s.half);
    }));
    const height=(i:number,offset:number)=>{
      const s=stations[i],f=Math.max(0,Math.min(PROFILE-1,(offset/s.half+1)*(PROFILE-1)/2)),k=Math.min(PROFILE-2,Math.floor(f));
      return profiles[i][k]+(profiles[i][k+1]-profiles[i][k])*(f-k);
    };
    const point=(i:number,offset:number,lift:number):P3=>{const [x,z]=at(stations[i],offset);return[x,height(i,offset)+lift,z];};
    const sink=batches.at(asphalt,stations[0].x,stations[0].z);let along=0;
    for(let i=1;i<stations.length;i++){
      const a=stations[i-1],b=stations[i],step=Math.hypot(b.x-a.x,b.z-a.z);
      for(let k=0;k<PROFILE-1;k++){
        const oa=(f:number,s:DeckStation)=>s.half*(2*f/(PROFILE-1)-1);
        upward(sink,point(i-1,oa(k,a),.03),point(i,oa(k,b),.03),point(i,oa(k+1,b),.03),point(i-1,oa(k+1,a),.03),[oa(k,a)/5,along/5],[oa(k,b)/5,(along+step)/5],[oa(k+1,b)/5,(along+step)/5],[oa(k+1,a)/5,along/5]);
      }
      along+=step;
    }
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
        const line=Array.from({length:end-first},(_,j)=>point(first+j,offsets[first+j][k],.06));
        for(const part of k===0||k===count-1?[line]:dashes(line)){ribbon(batches.at(paint,part[0][0],part[0][2]),part,LINE);lines++;}
      }
    }
  }
  const group=new THREE.Group();group.name='Survey deck pavement and lanes';
  for(const mesh of batches.meshes()){mesh.receiveShadow=true;mesh.renderOrder=mesh.material===asphalt?-1:0;group.add(mesh);}
  group.userData={carriageways:carriageways.length,lines};
  target.add(group);return group;
}

/** A quad a-b-c-d as two triangles, each wound to face up on its own (a
 * line jogging at a merge can twist the quad). */
function upward(sink:TriangleWriter,a:P3,b:P3,c:P3,d:P3,ua:Point2,ub:Point2,uc:Point2,ud:Point2){
  const tri=(p:P3,q:P3,r:P3,up:Point2,uq:Point2,ur:Point2)=>(q[2]-p[2])*(r[0]-p[0])-(q[0]-p[0])*(r[2]-p[2])<0?sink.triangle(...r,...q,...p,...ur,...uq,...up):sink.triangle(...p,...q,...r,...up,...uq,...ur);
  tri(a,b,c,ua,ub,uc);tri(a,c,d,ua,uc,ud);
}

/** A flat paint ribbon `width` wide along a 3D polyline. */
function ribbon(sink:TriangleWriter,line:P3[],width:number){
  const side=(i:number):Point2=>{const a=line[Math.max(0,i-1)],b=line[Math.min(line.length-1,i+1)],dx=b[0]-a[0],dz=b[2]-a[2],l=Math.hypot(dx,dz)||1;return[-dz/l*width/2,dx/l*width/2];};
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],sa=side(i-1),sb=side(i);
    upward(sink,[a[0]+sa[0],a[1],a[2]+sa[1]],[b[0]+sb[0],b[1],b[2]+sb[1]],[b[0]-sb[0],b[1],b[2]-sb[1]],[a[0]-sa[0],a[1],a[2]-sa[1]],[0,0],[0,1],[1,1],[1,0]);
  }
}

/** The stretches of each carriageway no sourced road deck already paves: the
 * Central Artery and Leverett Connector ramps join the survey at its lips and
 * draw their own asphalt and lanes over the last 50 m of it. */
export function uncovered(city:CityData,carriageways:DeckStation[][]){
  // Segments of the elevated roads, bucketed in 25 m cells by their reach.
  const cells=new Map<string,{road:Road;a:Point2;b:Point2}[]>();
  for(const road of city.roads){
    if(!road.elevations)continue;const r=road.width/2;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i];
      for(let cx=Math.floor((Math.min(a[0],b[0])-r)/25);cx<=Math.floor((Math.max(a[0],b[0])+r)/25);cx++)for(let cz=Math.floor((Math.min(a[1],b[1])-r)/25);cz<=Math.floor((Math.max(a[1],b[1])+r)/25);cz++){
        const k=`${cx},${cz}`,list=cells.get(k),entry={road,a,b};if(list)list.push(entry);else cells.set(k,[entry]);
      }
    }
  }
  const covered=(s:DeckStation)=>(cells.get(`${Math.floor(s.x/25)},${Math.floor(s.z/25)}`)??[]).some(({road,a,b})=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((s.x-a[0])*dx+(s.z-a[1])*dz)/(dx*dx+dz*dz||1)));
    return Math.hypot(s.x-a[0]-dx*t,s.z-a[1]-dz*t)<road.width/2&&Math.abs(sampleRoadElevation(city,road,s.x,s.z)-s.y)<1.5;
  });
  const out:DeckStation[][]=[];
  for(const stations of carriageways){let run:DeckStation[]=[];for(const s of stations){if(covered(s)){if(run.length>1)out.push(run);run=[];}else run.push(s);}if(run.length>1)out.push(run);}
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
