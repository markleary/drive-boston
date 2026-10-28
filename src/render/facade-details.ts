import * as THREE from 'three';
import { PartBatches, box, type Part } from './geometry-writer';
import { drain, due, type Pace } from './pacing';
import type { Building, CityData } from '../types';
import { closestRoad } from '../simulation/roads';
import { facadeStyleFor, hash, seeded } from './materials';
import { architectureFor } from './neighborhood-profiles';
import { isFenwayBuilding } from './fenway-park';
import {isStateHouse} from './state-house';
import { streetCharacter } from './street-character';
import { sampleElevation } from '../simulation/terrain.ts';
import { pointInside } from '../simulation/roads.ts';
import { otherBuildingHulls } from '../simulation/city-tiles.ts';
import { planMasonryStoop } from './porch-stairs.ts';

interface WallTriangle { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; normal: THREE.Vector3; minY: number; maxY: number; u:[number,number,number]; }
interface WallHit { depth: number; normal: THREE.Vector3; u:number; }
export interface SourceWallSampler { sample: (x:number,z:number,nx:number,nz:number,y:number) => WallHit | undefined; triangleCount:number; samples:number; }
const wallCache = new WeakMap<THREE.Scene,SourceWallSampler>();
/** Index source wall triangles once. Local facade probes never scan the whole city.
 * With `meshes` given (a streamed tile's shells) the index covers just those and is not cached. */
export function sourceWallSampler(scene:THREE.Scene,meshes?:THREE.Mesh[]):SourceWallSampler {
  const cached=meshes?undefined:wallCache.get(scene); if(cached)return cached;
  const cell=16,grid=new Map<string,WallTriangle[]>();let triangleCount=0;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  if(!meshes)scene.updateMatrixWorld(true);
  const visit=(object:THREE.Object3D)=>{
    if(!(object instanceof THREE.Mesh)||object.name!=='Boston surveyed buildings')return;
    const p=object.geometry.getAttribute('position'),uv=object.geometry.getAttribute('uv'),index=object.geometry.index;
    const count=index?index.count:p.count;
    for(let i=0;i<count;i+=3){
      a.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(object.matrixWorld);
      c.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(object.matrixWorld);
      normal.crossVectors(new THREE.Vector3().subVectors(b,a),new THREE.Vector3().subVectors(c,a)).normalize();
      if(Math.abs(normal.y)>.28)continue;
      const tri:WallTriangle={a:a.clone(),b:b.clone(),c:c.clone(),normal:normal.clone(),minY:Math.min(a.y,b.y,c.y),maxY:Math.max(a.y,b.y,c.y),u:[0,1,2].map(j=>uv?uv.getX(index?index.getX(i+j):i+j)*6:0) as [number,number,number]};
      if(tri.maxY<1)continue;triangleCount++;
      for(let x=Math.floor(Math.min(a.x,b.x,c.x)/cell);x<=Math.floor(Math.max(a.x,b.x,c.x)/cell);x++)for(let z=Math.floor(Math.min(a.z,b.z,c.z)/cell);z<=Math.floor(Math.max(a.z,b.z,c.z)/cell);z++){
        const key=`${x},${z}`,list=grid.get(key)??[];list.push(tri);grid.set(key,list);
      }
    }
  };
  if(meshes)meshes.forEach(visit);else scene.traverse(visit);
  const ray=new THREE.Ray(),target=new THREE.Vector3(),bary=new THREE.Vector3(),candidates=new Set<WallTriangle>();
  const sampler:SourceWallSampler={triangleCount,samples:0,sample(x,z,nx,nz,y){
    sampler.samples++;candidates.clear();
    for(let xx=Math.floor((x-4)/cell);xx<=Math.floor((x+4)/cell);xx++)for(let zz=Math.floor((z-4)/cell);zz<=Math.floor((z+4)/cell);zz++)for(const tri of grid.get(`${xx},${zz}`)??[])candidates.add(tri);
    ray.origin.set(x+nx*2,y,z+nz*2);ray.direction.set(-nx,0,-nz);
    let nearest=Infinity,result:WallHit|undefined;
    for(const tri of candidates){
      if(y<tri.minY-.01||y>tri.maxY+.01||tri.normal.x*nx+tri.normal.z*nz<.94)continue;
      const hit=ray.intersectTriangle(tri.a,tri.b,tri.c,false,target);if(!hit)continue;
      const distance=target.distanceTo(ray.origin);
      if(distance<nearest&&distance<5){
        nearest=distance;THREE.Triangle.getBarycoord(target,tri.a,tri.b,tri.c,bary);
        result={depth:2-distance,normal:tri.normal,u:tri.u[0]*bary.x+tri.u[1]*bary.y+tri.u[2]*bary.z};
      }
    }
    return result;
  }};
  if(!meshes)wallCache.set(scene,sampler);return sampler;
}

export interface DetailOptions { buildings?:Building[]; sampler?:SourceWallSampler; budget?:number; target?:THREE.Object3D; /** Frame pacing: the generator form pauses between buildings once the deadline has passed. */ pace?:Pace; }
let facadeMaterials:Record<'limestone'|'brownstone'|'terracotta'|'shadowStone'|'iron'|'wood'|'glass'|'aluminum',THREE.MeshStandardMaterial>|undefined;

/** Original three-dimensional architectural trim over authentic building geometry.
 * Window centers follow the current six-metre facade texture UV pattern.
 * Existing surveyed bay projections are detailed rather than replaced by box houses.
 */
export function addFacadeDetails(scene:THREE.Scene,city:CityData,options:DetailOptions={}):THREE.Group { return drain(facadeDetailSteps(scene,city,options)); }
export function* facadeDetailSteps(scene:THREE.Scene,city:CityData,options:DetailOptions={}):Generator<void,THREE.Group> {
  const group=new THREE.Group();group.name='Boston facade depth';
  const started=performance.now(),sampler=options.sampler??sourceWallSampler(scene),startSamples=sampler.samples,budget=options.budget??10000,pace=options.pace;
  const batches=new PartBatches();
  facadeMaterials??={limestone:new THREE.MeshStandardMaterial({color:'#c4b99e',roughness:.87}),brownstone:new THREE.MeshStandardMaterial({color:'#92765f',roughness:.91}),terracotta:new THREE.MeshStandardMaterial({color:'#b39a7c',roughness:.87}),shadowStone:new THREE.MeshStandardMaterial({color:'#786e5e',roughness:.94}),iron:new THREE.MeshStandardMaterial({color:'#252d2a',metalness:.4,roughness:.7}),wood:new THREE.MeshStandardMaterial({color:'#3a3930',roughness:.68}),glass:new THREE.MeshStandardMaterial({color:'#29414a',metalness:.35,roughness:.28}),aluminum:new THREE.MeshStandardMaterial({color:'#7f8b89',roughness:.48,metalness:.55})};
  const {limestone,brownstone,terracotta,shadowStone,iron,wood,glass,aluminum}=facadeMaterials;
  const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),one=new THREE.Vector3(1,1,1),position=new THREE.Vector3(),euler=new THREE.Euler();
  function add(g:Part,m:THREE.Material,x:number,y:number,z:number,yaw:number,rx=0,rz=0){
    q.setFromEuler(euler.set(rx,yaw,rz,'YXZ'));matrix.compose(position.set(x,y,z),q,one);batches.part(g,m,matrix);
  }
  let windows=0,cornices=0,stoops=0,bayFacets=0,facades=0,arches=0,pediments=0,loftWindows=0,pilasters=0;
  const styles:Record<string,number>={},used=new Set<string>();
  function archBand(width:number,pointed=false){
    const inner=width/2+.025,outer=inner+.12,shape=new THREE.Shape();
    shape.moveTo(inner,0);shape.lineTo(outer,0);
    if(pointed){
      const head=width*.82;
      shape.quadraticCurveTo(outer,head*.65,0,head+.15);shape.quadraticCurveTo(-outer,head*.65,-outer,0);shape.lineTo(-inner,0);
      shape.quadraticCurveTo(-inner,head*.65,0,head);shape.quadraticCurveTo(inner,head*.65,inner,0);
    }else{shape.absarc(0,0,outer,0,Math.PI,false);shape.lineTo(-inner,0);shape.absarc(0,0,inner,Math.PI,0,true);}
    return new THREE.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:false,steps:1,curveSegments:8}).translate(0,0,-.09);
  }
  function decorate(building:Building,a:[number,number],b:[number,number]){
    const base=building.baseElevation??0;
    const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<1.4)return;
    const nx=dz/length,nz=-dx/length,yaw=Math.atan2(nx,nz),tx=nz,tz=-nx;
    const x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
    const road=closestRoad(city,x,z,true);
    if(road.distance<road.road.width/2+1.1||road.distance>road.road.width/2+22)return;
    if(((road.x-x)*nx+(road.z-z)*nz)/road.distance<.48)return;
    const character=streetCharacter(road.road.name,road.road.width,road.road.kind),commercial=character==='commercial',residential=character==='residential';
    if(!commercial&&!residential)return;
    const style=facadeStyleFor(building),modern=style.detail==='modern',office=style.detail==='office';
    // Probe each 6m frontage bay once, then repeat its physical window trim vertically.
    const spans=Math.max(1,Math.ceil(length/6)),span=length/spans;
    for(let s=0;s<spans;s++){
      const along=(s+.5)*span,mx=a[0]+dx*along/length,mz=a[1]+dz*along/length;
      const half=Math.max(.3,span/2-.22);
      const probes=[-half,0,half].map(offset=>sampler.sample(mx+tx*offset,mz+tz*offset,nx,nz,base+6.8));
      if(probes.some(h=>!h||Math.abs(h.depth)>.4))continue;
      const depth=probes[1]!.depth,uScale=(probes[2]!.u-probes[0]!.u)/(half*2);
      if(uScale<.95||uScale>1.05)continue;
      const draw=(g:Part,m:THREE.Material,xx:number,yy:number,d=.14,rx=0,rz=0)=>add(g,m,mx+tx*xx+nx*(depth+d),base+yy,mz+tz*xx+nz*(depth+d),yaw,rx,rz);
      const random=seeded(hash(building.id)+s*139+Math.round(mx)*37);
      const stone=modern?aluminum:style.detail==='classical'||style.detail==='gothic'?limestone:style.detail==='terracotta'?terracotta:office?shadowStone:brownstone;
      // Determine the continuous front-wall height with a few center probes, rather
      // than raycasting every window or assuming a tall roof belongs to every wing.
      let top=5;
      for(let y=7.56;y<Math.min(31,building.height-1.4);y+=3){
        const h=sampler.sample(mx,mz,nx,nz,base+y+1.3);if(!h||Math.abs(h.depth-depth)>.24)break;top=y+1.3;
      }
      if(top<8)continue;
      facades++;if(length<5)bayFacets++;
      const u=probes[1]!.u,spacing=6/style.columns,hw=style.windowWidth/2,hh=style.windowHeight/2,margin=hw+.14;
      const first=Math.ceil((u-half*uScale+margin-spacing/2)/spacing);
      const last=Math.floor((u+half*uScale-margin-spacing/2)/spacing);
      for(let k=first;k<=last;k++){
        const xx=(spacing/2+spacing*k-u)/uScale;
        const key=`${Math.round((mx+tx*xx)*4)},${Math.round((mz+tz*xx)*4)}`;
        if(used.has(key))continue;used.add(key);
        for(let y=commercial?7.56:4.56;y<top-.4;y+=3){
          if(y+hh+.22>(building.eaveHeight??building.height))break;
          const head=sampler.sample(mx+tx*xx,mz+tz*xx,nx,nz,base+y+hh+.3);if(!head||Math.abs(head.depth-depth)>.24)break;
          if(windows>=budget)break;windows++;
          styles[style.id]=(styles[style.id]??0)+1;
          // Recessed glazing remains the base texture. Jambs project far enough
          // to cast real shadows; the sill has a distinct dark underside and lip.
          if(modern||office){
            for(const side of [-1,1])draw(box(.055,style.windowHeight+.06,.13),aluminum,xx+side*(hw+.025),y,.09);
            for(const side of [-1,1])draw(box(style.windowWidth+.1,.06,.15),aluminum,xx,y+side*(hh+.02),.1);
          }else if(style.detail==='arched'||style.detail==='gothic'){
            const pointed=style.detail==='gothic',head=pointed?style.windowWidth*.82:hw;
            const spring=y+hh-head,jambHeight=style.windowHeight-head;arches++;
            for(const side of [-1,1])draw(box(.12,jambHeight,.19),stone,xx+side*(hw+.085),y-hh+jambHeight/2,.14);
            draw(archBand(style.windowWidth,pointed),stone,xx,spring,.15);
            draw(box(.15,.23,.23),limestone,xx,y+hh+.025,.18);
          }else{
            for(const side of [-1,1])draw(box(.105,style.windowHeight+.09,.18),stone,xx+side*(hw+.065),y,.125);
            draw(box(style.windowWidth+.34,.19,.3),stone,xx,y+hh+.11,.18);
          }
          if(!modern){
            draw(box(style.windowWidth+.36,.14,office?.25:.46),stone,xx,y-hh-.1,.25);
            draw(box(style.windowWidth+.21,.07,.28),shadowStone,xx,y-hh-.205,.15);
          }
          if(style.detail==='loft'){
            loftWindows++;
            for(const side of [-1,1])draw(box(.035,style.windowHeight,.08),iron,xx+side*style.windowWidth/6,y,.065);
            for(const side of [-1,1])draw(box(style.windowWidth,.035,.08),iron,xx,y+side*style.windowHeight/6,.065);
          }
          if(style.detail==='classical'&&y<11&&random()>.55){
            const shape=new THREE.Shape([new THREE.Vector2(-hw-.2,0),new THREE.Vector2(hw+.2,0),new THREE.Vector2(0,.32)]);
            draw(new THREE.ExtrudeGeometry(shape,{depth:.21,bevelEnabled:false}),stone,xx,y+hh+.19,.08);pediments++;
          }
          if((style.detail==='brownstone'||style.detail==='terracotta')&&y<11){
            draw(box(.14,.24,.24),stone,xx-hw+.1,y-hh-.27,.15);
            draw(box(.14,.24,.24),stone,xx+hw-.1,y-hh-.27,.15);
          }
        }
      }
      // Roof cornices belong near the real roof, never at the detail-distance
      // cutoff in the middle of a tower facade.
      if(building.height-top<6&&!modern){
        // The cornice sits under the surveyed wall top across the whole bay,
        // never above a hip roof or past a lower wing at the end of the bay.
        let wallTop=top;for(let y=top+.25;y<top+3.1;y+=.25){const hit=sampler.sample(mx,mz,nx,nz,base+y);if(!hit||Math.abs(hit.depth-depth)>.24)break;wallTop=y;}
        const eave=Math.min(top+.35,wallTop-.3),solid=[-half+.15,half-.15].every(xx=>{const hit=sampler.sample(mx+tx*xx,mz+tz*xx,nx,nz,base+eave+.25);return !!hit&&Math.abs(hit.depth-depth)<.24;});
        if(solid){
          cornices++;
          draw(box(span-.08,.16,.26),shadowStone,0,eave-.24,.12);
          draw(box(span+.05,.24,.42),stone,0,eave,.23);
          draw(box(span+.14,.12,.55),stone,0,eave+.2,.3);
          if(!office&&style.detail!=='loft')for(let xx=-half+.25;xx<half-.1;xx+=.56)draw(box(.16,.19,.22),stone,xx,eave-.24,.21);
        }
      }
      draw(box(span-.08,.2,.18),stone,0,commercial?4.55:3.2,.13);
      if(style.detail==='terracotta'&&span>4){
        for(const side of [-1,1]){
          draw(box(.25,top-4.8,.22),terracotta,side*(half-.1),(top+4.8)/2,.13);
          draw(box(.45,.28,.35),limestone,side*(half-.1),top-.1,.2);pilasters++;
        }
      }
      if(office)for(let y=7.56;y<top;y+=3)draw(box(span-.08,.13,.18),stone,0,y-1.22,.12);
      // Raised brownstone entrances are restricted to residential faces with room
      // between the source wall and the mapped curb, outside intersection corners.
      if(residential&&!commercial&&!office&&!modern&&span>4.5&&building.height<30&&random()<.34&&road.distance>road.road.width/2+5.5){
        if(road.road.points.some((p,i)=>(i===0||i===road.road.points.length-1)&&Math.hypot(p[0]-mx,p[1]-mz)<14))continue;
        const lower=sampler.sample(mx,mz,nx,nz,base+1.7);if(!lower||Math.abs(lower.depth-depth)>.25)continue;
        const ground=(x:number,z:number)=>sampleElevation(city,x,z);
        const neighbors=otherBuildingHulls(city,building,mx,mz,35);
        const stairs=planMasonryStoop({origin:[mx,mz],tangent:[tx,tz],normal:[nx,nz],frontDepth:depth,width:1.82,depth:1.5,frontage:length,along:length/2-along,setback:road.distance-road.road.width/2,landingY:base+1.12},ground,p=>!neighbors.some(other=>pointInside(p,other.footprint)));
        if(!stairs)continue;
        stoops++;
        draw(box(1.48,2.75,.12),wood,0,2.48,.09);
        draw(new THREE.PlaneGeometry(1.15,.5),glass,0,3.46,.16);
        for(const side of [-1,1])draw(box(.19,2.94,.26),stone,side*.85,2.53,.22);
        draw(box(2.02,.25,.48),stone,0,4.09,.27);
        const stairYaw=Math.atan2(stairs.direction[0],stairs.direction[1]);
        for(const block of [stairs.platform,...stairs.steps,stairs.landing]){
          add(box(block.width,block.top-block.bottom,block.depth),stone,block.center[0],(block.top+block.bottom)/2,block.center[1],block===stairs.platform?yaw:stairYaw);
        }
        // Posts and handrails follow the solved flight, rather than a fixed
        // five-step ornament suspended at the survey's raised base elevation.
        const run=stairs.run+stairs.landing.depth/2,drop=base+1.12-stairs.landing.top;
        for(const side of [-1,1]){
          const acrossX=stairs.direction[1]*side*(stairs.width/2+.025),acrossZ=-stairs.direction[0]*side*(stairs.width/2+.025);
          add(box(.045,.88,.045),iron,stairs.start[0]+acrossX,base+1.56,stairs.start[1]+acrossZ,stairYaw);
          for(const block of [...stairs.steps,stairs.landing]){
            add(box(.045,.88,.045),iron,block.center[0]+acrossX,block.top+.44,block.center[1]+acrossZ,stairYaw);
          }
          add(box(.06,.06,Math.hypot(run,drop)),iron,stairs.start[0]+stairs.direction[0]*run/2+acrossX,base+1.12-drop/2+.88,stairs.start[1]+stairs.direction[1]*run/2+acrossZ,stairYaw,Math.atan2(drop,run));
        }
        // Low frontage fences are seated on the local yard as well.
        for(let xx=-half+.3;xx<half;xx+=.28){if(Math.abs(xx)<1.2)continue;const y=ground(mx+tx*xx+nx*(depth+1.05),mz+tz*xx+nz*(depth+1.05))-base;draw(box(.035,.8,.035),iron,xx,y+.4,1.05);}
      }
    }
  }
  // Share detail between the original district and Mission Hill, with a fixed
  // budget per 240m area so the first blocks cannot consume every window.
  const areaWindows=new Map<string,number>();
  const buildings=[...(options.buildings??city.buildings)].sort((a,b)=>hash(a.id)-hash(b.id));
  for(const building of buildings){
    if(due(pace))yield;
    if(architectureFor(building)||isFenwayBuilding(building)||isStateHouse(building))continue;
    if(building.landmark||building.height<9||building.height>80)continue;
    const area=`${Math.floor(building.center[0]/240)},${Math.floor(building.center[1]/240)}`;
    if((areaWindows.get(area)??0)>=250)continue;const before=windows;
    for(let i=0;i<building.footprint.length;i++)decorate(building,building.footprint[i],building.footprint[(i+1)%building.footprint.length]);
    areaWindows.set(area,(areaWindows.get(area)??0)+windows-before);
  }
  for(const mesh of batches.meshes()){mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
  group.userData={windows,cornices,stoops,bayFacets,facades,arches,pediments,loftWindows,pilasters,styles,drawCalls:group.children.length,wallProbes:sampler.samples-startSamples,buildMs:Math.round(performance.now()-started)};
  (options.target??scene).add(group);return group;
}
