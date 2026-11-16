import * as THREE from 'three';
import data from '../data/castle-island.json' with { type: 'json' };
import type { CityData, Point2 } from '../types.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import { finish, LandmarkModel, landmarkTexture } from './landmark-model.ts';
import { seeded } from './materials.ts';
import { parkSurfaceSteps } from './area-surfaces.ts';
import { drain, due, type Pace } from './pacing.ts';

import { points, FORT_ID, fortOutline, fortCourt, FORT_FLOOR, FORT_TOP, fortEntrance, gatePoint } from '../simulation/castle-island.ts';
const T: Point2 = [.261,.965], N: Point2 = [.965,-.261];

/** Source star plan, with authored masonry, public entrance and park details.
 * Wall/earthwork heights and furnishings are estimates from the reference views. */
export function buildCastleIsland(city: CityData) {
  const model = new LandmarkModel('Castle Island · Fort Independence',FORT_ID,0,0,0,0);
  const granite=finish('#aaa99c'), coping=finish('#ccc9b8'), lawn=finish('#788a4a'), earth=finish('#687545');
  const stone=finish('#b6afa0'), dark=finish('#30362f'), brick=finish('#a99b80'), iron=finish('#38423d',.7,.25), white=finish('#ddd8c9');
  const timber=finish('#8a7759'), flagRed=finish('#aa443a'), flagBlue=finish('#344e6c');
  if(typeof document!=='undefined') {
    granite.map=landmarkTexture(256,256,ctx=>{
      const random=seeded(1634);ctx.fillStyle='#797d74';ctx.fillRect(0,0,256,256);
      for(let row=0;row<8;row++)for(let col=-1;col<5;col++){
        const x=col*64+(row%2)*32,y=row*32,n=Math.floor(random()*31);
        ctx.fillStyle=`rgb(${153+n},${154+n},${142+n})`;ctx.fillRect(x+1,y+1,62,30);
        for(let k=0;k<90;k++){ctx.fillStyle=random()<.5?'rgba(40,46,39,.12)':'rgba(246,241,218,.22)';ctx.fillRect(x+random()*62+1,y+random()*29+1,1+random()*2,1);}
      }
    },true);granite.color.set('#ffffff');
  }
  const cap=(material:THREE.Material,rings:Point2[][],y:number,solid=false)=>{
    const shape=new THREE.Shape(rings[0].map(([x,z])=>new THREE.Vector2(x,-z)));
    for(const ring of rings.slice(1))shape.holes.push(new THREE.Path(ring.map(([x,z])=>new THREE.Vector2(x,-z))));
    model.append(material,new THREE.ShapeGeometry(shape).rotateX(-Math.PI/2).translate(0,y,0),solid);
  };
  const beam=(material:THREE.Material,a:Point2,b:Point2,y:number,height:number,width:number,solid=false)=>{
    const dx=b[0]-a[0],dz=b[1]-a[1];model.box(material,(a[0]+b[0])/2,y,(a[1]+b[1])/2,Math.hypot(dx,dz),height,width,solid,-Math.atan2(dz,dx));
  };
  const at=(a:Point2,b:Point2,t:number):Point2=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  const gateCoordinate=(p:Point2)=>({u:(p[0]-fortEntrance[0])*T[0]+(p[1]-fortEntrance[1])*T[1],v:(p[0]-fortEntrance[0])*N[0]+(p[1]-fortEntrance[1])*N[1]});
  // Both the outer curtain and inner casemate facade have the same clear portal.
  for(const [which,ring] of [fortOutline,points(data.fort.rings[1])].entries())for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const ga=gateCoordinate(a),gb=gateCoordinate(b);
    const portal=Math.min(ga.u,gb.u)<-2.3&&Math.max(ga.u,gb.u)>2.3&&Math.abs((ga.v+gb.v)/2)<18;
    if(portal){
      const t0=(-2.3-ga.u)/(gb.u-ga.u),t1=(2.3-ga.u)/(gb.u-ga.u),p=at(a,b,Math.min(t0,t1)),q=at(a,b,Math.max(t0,t1));
      model.wall(granite,a,p,-2,FORT_TOP,true);model.wall(granite,q,b,-2,FORT_TOP,true);
      model.wall(granite,p,q,FORT_FLOOR+4.3,FORT_TOP,true);
      // Pale voussoirs around the round-headed entrance; the open arch has
      // actual collision on its underside, not a black doorway painted on a wall.
      const center=at(p,q,.5),direction:Point2=[(q[0]-p[0])/4.6,(q[1]-p[1])/4.6];
      for(let k=0;k<14;k++){
        const a0=k/14*Math.PI,a1=(k+1)/14*Math.PI;
        const v=(angle:number,r:number):[number,number,number]=>[center[0]+direction[0]*Math.cos(angle)*r,FORT_FLOOR+2+Math.sin(angle)*r,center[1]+direction[1]*Math.cos(angle)*r];
        const outward=(p:[number,number,number]):[number,number,number]=>[p[0]+(b[1]-a[1])/len*.055,p[1],p[2]-(b[0]-a[0])/len*.055];
        model.quad(coping,outward(v(a0,2.3)),outward(v(a1,2.3)),outward(v(a1,2.8)),outward(v(a0,2.8)));
        // Fill between the arch curve and the straight lintel above it.
        const l=v(a0,2.3),r=v(a1,2.3);model.quad(granite,l,r,[r[0],FORT_FLOOR+4.3,r[2]],[l[0],FORT_FLOOR+4.3,l[2]],true);
      }
    }else model.wall(granite,a,b,-2,FORT_TOP,true);
    beam(coping,a,b,FORT_TOP+.14,.28,.65);
    const normal:Point2=[(b[1]-a[1])/len,-(b[0]-a[0])/len];
    // Narrow exterior embrasures; larger casemate doors face the parade ground.
    if(len>13)for(let d=7;d<len-4;d+=which?8:13){
      const p=at(a,b,d/len),g=gateCoordinate(p);if(Math.abs(g.u)<4&&Math.abs(g.v)<18)continue;
      const w=which?1.45:.72,h=which?2.6:.58,y=which?FORT_FLOOR+1.3:FORT_TOP-3;
      const u:Point2=[(b[0]-a[0])/len*w/2,(b[1]-a[1])/len*w/2],q:Point2=[p[0]+normal[0]*.035,p[1]+normal[1]*.035];
      model.quad(dark,[q[0]+u[0],y-h/2,q[1]+u[1]],[q[0]-u[0],y-h/2,q[1]-u[1]],[q[0]-u[0],y+h/2,q[1]-u[1]],[q[0]+u[0],y+h/2,q[1]+u[1]]);
      beam(coping,[q[0]-u[0],q[1]-u[1]],[q[0]+u[0],q[1]+u[1]],y+h/2+.12,.2,.18);
    }
  }
  cap(lawn,[fortOutline,fortCourt],FORT_TOP-.05,true);
  cap(lawn,[fortCourt],FORT_FLOOR,true);
  // Parade-ground perimeter walk and the upper walkway follow the source court.
  const center:Point2=[5257,1291];
  const scaled=(ring:Point2[],scale:number)=>ring.map(([x,z]):Point2=>[center[0]+(x-center[0])*scale,center[1]+(z-center[1])*scale]);
  cap(stone,[fortCourt,scaled(fortCourt,.94)],FORT_FLOOR+.015);
  cap(stone,[scaled(fortCourt,1.075),fortCourt],FORT_TOP+.025);
  // Follow the real hill all the way to the doorway. One planar approach
  // would disappear below the convex DEM between the park walk and the gate.
  const approachRing=[gatePoint(-2.3,-24),gatePoint(2.3,-24),gatePoint(2.3,0),gatePoint(-2.3,0)];
  model.append(stone,drain(parkSurfaceSteps(city,[approachRing],{heightAt:p=>{
    const depth=(p[0]-fortEntrance[0])*N[0]+(p[1]-fortEntrance[1])*N[1];
    return Math.max(sampleElevation(city,...p)+.065,FORT_FLOOR+.04+depth*.07);
  }})),true);
  // The passage floor stays level through the granite curtain.
  cap(stone,[[gatePoint(-2.3,-1),gatePoint(2.3,-1),gatePoint(2.3,19),gatePoint(-2.3,19)]],FORT_FLOOR+.04,true);
  for(const side of [-2.3,2.3])model.wall(granite,gatePoint(side,0),gatePoint(side,13),FORT_FLOOR,FORT_FLOOR+4.3,true);
  // A sloping masonry ramp links the parade ground to the upper walk, as in
  // the visitor route. Rendering and walking collision share the same planes.
  const rampA:Point2=[5216,1271],rampB:Point2=[5257,1237],rw:Point2=[1.28,1.54];
  const ra: [number,number,number]=[rampA[0]-rw[0],FORT_FLOOR+.04,rampA[1]-rw[1]],rb: [number,number,number]=[rampA[0]+rw[0],FORT_FLOOR+.04,rampA[1]+rw[1]],
    rc: [number,number,number]=[rampB[0]+rw[0],FORT_TOP+.04,rampB[1]+rw[1]],rd: [number,number,number]=[rampB[0]-rw[0],FORT_TOP+.04,rampB[1]-rw[1]];
  model.quad(stone,ra,rb,rc,rd,true);
  model.quad(granite,ra,rd,[rd[0],FORT_FLOOR,rd[2]],[ra[0],FORT_FLOOR,ra[2]],true);
  model.quad(granite,rc,rb,[rb[0],FORT_FLOOR,rb[2]],[rc[0],FORT_FLOOR,rc[2]],true);
  const rail=(a:THREE.Vector3,b:THREE.Vector3)=>{
    const delta=b.clone().sub(a),g=new THREE.CylinderGeometry(.045,.045,delta.length(),5);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);model.append(iron,g);
  };
  for(const [a,b] of [[ra,rd],[rb,rc]]){
    rail(new THREE.Vector3(a[0],a[1]+1,a[2]),new THREE.Vector3(b[0],b[1]+1,b[2]));
    for(let j=0;j<=18;j++){const t=j/18;model.box(iron,a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t+.5,a[2]+(b[2]-a[2])*t,.065,1,.065);}
  }
  for(let i=0;i<fortCourt.length;i++){
    const a=fortCourt[i],b=fortCourt[(i+1)%fortCourt.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const start=Math.hypot(a[0]-rampB[0],a[1]-rampB[1])<5?Math.min(5/length,1):0,end=Math.hypot(b[0]-rampB[0],b[1]-rampB[1])<5?Math.max(0,1-5/length):1;
    if(end>start)beam(iron,at(a,b,start),at(a,b,end),FORT_TOP+1.05,.06,.06);
    for(let d=0;d<length;d+=3){const p=at(a,b,d/length);if(Math.hypot(p[0]-rampB[0],p[1]-rampB[1])<5)continue;model.box(iron,p[0],FORT_TOP+.53,p[1],.055,1.05,.055);}
  }
  // Turf-covered earth traverses on the five bastions, with circular gun beds.
  const bastions:Point2[]=[[5186,1255],[5257,1224],[5327,1273],[5299,1343],[5207,1334]];
  for(const [i,p] of bastions.entries()){
    const dx=p[0]-center[0],dz=p[1]-center[1],yaw=Math.atan2(dx,dz);
    const mound=new THREE.SphereGeometry(1,12,6,0,Math.PI*2,0,Math.PI/2).scale(9,2.2,4.5).rotateY(yaw).translate(p[0]-Math.sin(yaw)*9,FORT_TOP-.03,p[1]-Math.cos(yaw)*9);
    model.append(earth,mound,true);
    model.append(stone,new THREE.CylinderGeometry(4.1,4.2,.35,24).translate(p[0],FORT_TOP+.14,p[1]));
    model.append(dark,new THREE.CylinderGeometry(2.9,2.9,.06,24).translate(p[0],FORT_TOP+.34,p[1]));
    // A few display guns, leaving the remaining historic circular emplacements empty.
    if(i===2||i===3){
      model.box(iron,p[0],FORT_TOP+.85,p[1],1.5,1,2.6,false,yaw);
      model.append(dark,new THREE.CylinderGeometry(.38,.62,4.6,12).rotateX(Math.PI/2-.08).rotateY(yaw).translate(p[0]+Math.sin(yaw)*1.1,FORT_TOP+1.6,p[1]+Math.cos(yaw)*1.1));
    }
  }
  // Small interior gabled magazine, kept on the north side of the parade lawn.
  model.box(brick,5245,8.1,1251,9,2.8,7,true,-.47);
  model.append(dark,new THREE.CylinderGeometry(0,6.6,2.5,4).rotateY(Math.PI/4-.47).scale(1,1,.7).translate(5245,10.75,1251));
  // American flag above the ramparts: restrained cloth, no emissive ornament.
  const flag=(x:number,z:number,y:number)=>{
    model.append(white,new THREE.CylinderGeometry(.07,.12,12,8).translate(x,y+6,z));
    for(let i=0;i<13;i++)model.box(i%2?white:flagRed,x+1.6,y+10.7-i*.15,z,3.2,.15,.035);
    model.box(flagBlue,x+.65,y+10.25,z-.025,1.3,1,.04);
  };flag(5288,1342,FORT_TOP);
  // Donald McKay obelisk, between the northeastern seawall and the fort.
  const mx=5334,mz=1195,my=sampleElevation(city,mx,mz);
  model.box(stone,mx,my+.35,mz,5.8,.7,5.8,true);
  model.box(coping,mx,my+1,mz,3.5,.6,3.5,true);
  model.append(coping,new THREE.CylinderGeometry(.7,1.2,13.8,4).rotateY(Math.PI/4).translate(mx,my+8.2,mz),true);
  model.append(coping,new THREE.ConeGeometry(.7,1.9,4).rotateY(Math.PI/4).translate(mx,my+16.05,mz),true);
  model.box(dark,mx,my+2.3,mz-1.04,.7,1.1,.04);
  // Fishing pier at the mapped northeastern projection: an angled deck on piles.
  const pierY=Math.max(sampleElevation(city,5339,1181),.3),pierA:Point2=[5339,1181],pierB:Point2=[5352,1168],pierC:Point2=[5380,1206];
  beam(stone,pierA,pierB,pierY-.25,.5,5.6,true);beam(stone,pierB,pierC,pierY-.25,.5,5.6,true);
  for(const [a,b] of [[pierA,pierB],[pierB,pierC]]){
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/length,nz=(b[0]-a[0])/length;
    for(const side of [-1,1]){
      const u:Point2=[a[0]+nx*2.65*side,a[1]+nz*2.65*side],v:Point2=[b[0]+nx*2.65*side,b[1]+nz*2.65*side];
      beam(iron,u,v,pierY+1.1,.075,.075);beam(iron,u,v,pierY+.5,.05,.05);
      for(let d=0;d<=length;d+=2){const p=at(u,v,d/length);model.box(iron,p[0],pierY+.55,p[1],.065,1.1,.065);}
      for(let d=1;d<length;d+=7){const p=at(u,v,d/length);model.append(timber,new THREE.CylinderGeometry(.25,.32,pierY+5.8,7).translate(p[0],(pierY-5.8)/2,p[1]));}
    }
  }
  // Sugar Bowl shade shelter on Head Island, with open sides and a low roof.
  const sx=4899,sz=2139,sy=sampleElevation(city,sx,sz);
  model.append(stone,new THREE.CylinderGeometry(6.5,6.5,.25,8).translate(sx,sy+.12,sz),true);
  for(let i=0;i<8;i++){const a=i*Math.PI/4;model.box(white,sx+Math.sin(a)*5.4,sy+1.8,sz+Math.cos(a)*5.4,.23,3.6,.23,true);}
  model.append(earth,new THREE.ConeGeometry(7,2,8).translate(sx,sy+4.5,sz),true);
  const result=model.build();result.group.userData={...result.group.userData,bastions:5,openCourtyard:true,publicEntrance:true,bayLevel:data.bay.level,accuracy:'Survey plan; estimated heights, masonry, earthworks, pier, monument and shelter details'};
  return result;
}

/** Tile-owned beach and low stone shore defenses retain the existing paths. */
export function* castleIslandLandscapeSteps(city:CityData,group:THREE.Group,options:{bounds?:{minX:number;maxX:number;minZ:number;maxZ:number};pace?:Pace}) {
  const {bounds,pace}=options;
  if(bounds&&(bounds.maxX<4250||bounds.minX>5420||bounds.maxZ<1150||bounds.minZ>2170))return;
  const sand=finish('#c5b994');
  for(const rings of data.beach){
    const geometry=yield* parkSurfaceSteps(city,rings.map(points),{bounds,offset:.036,pace});
    if(!geometry.attributes.position.count){geometry.dispose();continue;}
    const mesh=new THREE.Mesh(geometry,sand);mesh.name='Pleasure Bay sand beach';mesh.receiveShadow=true;group.add(mesh);
  }
  const model=new LandmarkModel('Castle Island seawalls','castle-island-seawalls',0,0,0,0),stone=finish('#99998b'),cap=finish('#c3bba6');
  for(const line of data.coast)for(let i=1;i<line.length;i++){
    if(due(pace))yield;
    const a=line[i-1] as Point2,b=line[i] as Point2,x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
    if(bounds&&(x<bounds.minX||x>=bounds.maxX||z<bounds.minZ||z>=bounds.maxZ))continue;
    const ya=sampleElevation(city,...a)+.12,yb=sampleElevation(city,...b)+.12;
    model.quad(stone,[a[0],-5.3,a[1]],[b[0],-5.3,b[1]],[b[0],yb,b[1]],[a[0],ya,a[1]]);
    model.quad(stone,[b[0],-5.3,b[1]],[a[0],-5.3,a[1]],[a[0],ya,a[1]],[b[0],yb,b[1]]);
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    model.box(cap,x,(ya+yb)/2,z,len,.23,.65,false,-Math.atan2(b[1]-a[1],b[0]-a[0]));
  }
  const result=model.build();group.add(result.group);
}
