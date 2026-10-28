import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {CityData,Point2} from '../types';
import {sampleElevation} from '../simulation/terrain.ts';

/** The Embrace (Hank Willis Thomas, 2023) on Boston Common. Position is OSM
 * node 10552518542; plaza, paving ring and retaining wall are OSM ways
 * 1132661865, 1131759734 and 1334814996, converted with the city's State Plane
 * transform. The bronze is an original procedural interpretation of the
 * published photographs: no scan or third-party model is bundled. Its height
 * (20 ft) and width (25 ft) follow the OSM tag and published dimensions. The
 * yaw, which points the sleeve side toward the Parkman Bandstand, is an estimate. */
export const EMBRACE={x:858.64,z:-538.98,yaw:Math.atan2(-93.89,66.65),height:6.1,width:7.6};
const PLAZA:Point2[]=[[867.2,-528.62],[869.24,-530.64],[870.22,-531.97],[870.84,-533.34],[871.8,-535.42],[872.39,-539.21],[871.91,-543.04],[870.38,-546.63],[867.88,-549.66],[864.64,-551.88],[863.52,-552.38],[860.89,-553.12],[859.5,-553.29],[858.12,-553.33],[853.46,-552.42],[851.23,-551.34],[849.23,-549.88],[846.41,-546.49],[844.76,-542.22],[844.56,-537.92],[845.61,-533.95],[847.07,-531.36],[848.92,-529.27],[852.21,-526.98],[855.75,-525.78],[859.74,-525.59],[864,-526.68]];
const RING:Point2[]=[[846.54,-539.17],[847.13,-535.61],[848.72,-532.5],[851.15,-529.98],[854.22,-528.31],[857.66,-527.6],[861.14,-527.93],[863.49,-528.79],[865.5,-530.02],[866.75,-531.14],[867.82,-532.58],[868.63,-534.14],[869.18,-535.49],[869.6,-537.19],[869.79,-538.94],[869.67,-540.78],[869.21,-542.81],[867.78,-546.15],[865.03,-548.84],[861.54,-550.51],[857.95,-550.97],[854.38,-550.31],[851.19,-548.59],[848.67,-545.99],[847.07,-542.75]];
const WALL:Point2[]=[[865.98,-544.4],[866.82,-542.95],[867.44,-541.46],[867.89,-539.28],[867.82,-537.39],[867.24,-535.35],[866.07,-533.14],[864.45,-531.36],[862.37,-530],[860.15,-529.26],[857.86,-529.11],[855.89,-529.39],[853.9,-530.25],[851.76,-531.59]];
const PLAZA_CENTER:Point2=[PLAZA.reduce((s,p)=>s+p[0],0)/PLAZA.length,PLAZA.reduce((s,p)=>s+p[1],0)/PLAZA.length];

/** Park planting and grass tufts stay off the paved plaza. */
export const insideEmbracePlaza=(x:number,z:number,margin=0)=>Math.hypot(x-PLAZA_CENTER[0],z-PLAZA_CENTER[1])<15.3+margin;

type V3=[number,number,number];
type Arm={points:V3[];radius:number[][];sleeve:boolean;hand:{dir:V3;palm:V3;thumb:1|-1;curl:number[];size:number;thumbCurl?:number};bracelet?:number};
// Local frame: u (x) across the 25 ft face, y up, v (z) toward the Bandstand.
// Martin's suit sleeves wrap over the Bandstand face; Coretta's bare arms,
// one with her bracelet, hold the opposite face. Elbows and shoulders bear on
// the plaza at four corners, leaving the walk-through vault beneath.
const ARMS:Arm[]=[
  {// Martin: elbow high on the left, forearm across the crown, hand gripping down the right.
    points:[[-2.55,-.6,1.05],[-2.8,.7,.95],[-3.15,2.1,.6],[-3.2,3.4,.1],[-2.8,4.55,-.4],[-1.9,5.35,-.15],[-.65,5.75,.3],[.55,5.72,.72]],
    radius:[[0,1.25],[.3,1.14],[.5,1.02],[.62,.96],[.86,.76],[.9,.77],[.915,.6],[1,.52]],sleeve:true,
    hand:{dir:[.75,-.55,.42],palm:[-.15,-.75,-.55],thumb:1,curl:[.55,.6,.42],size:1.36}},
  {// Martin: forearm rising from the right corner, open hand laid across the face.
    points:[[2.75,-.6,1.0],[2.95,.6,1.2],[3.05,1.8,1.5],[2.85,2.75,1.95],[2.35,3.3,2.2]],
    radius:[[0,1.25],[.45,1.0],[.78,.78],[.82,.79],[.86,.62],[1,.54]],sleeve:true,
    hand:{dir:[-1,.1,.05],palm:[0,-.1,-1],thumb:1,curl:[.12,.16,.1],size:1.42}},
  {// Coretta: upper arm climbing from the rear-left, elbow behind Martin's hand,
    // forearm over the crown, bracelet hand clasping her other arm.
    points:[[-2.6,-.6,-1.1],[-2.85,.8,-.5],[-2.6,2.1,.3],[-1.6,3.2,1.0],[-.3,3.75,1.45],[.8,4.7,1.0],[1.3,5.4,-.1],[1.1,5.65,-.8]],
    radius:[[0,1.2],[.4,1.04],[.58,.92],[.82,.68],[1,.48]],sleeve:false,bracelet:.95,
    hand:{dir:[0,-.45,-.9],palm:[0,-.85,.4],thumb:-1,curl:[.5,.5,.38],size:1.26}},
  {// Coretta: rising from the rear-right, forearm across the back of the crown.
    points:[[2.6,-.6,-1.15],[2.85,.6,-1.15],[3.15,2,-1],[3.2,3.3,-.85],[2.85,4.4,-.75],[2.0,5.1,-1.2],[.6,5.45,-1.4],[-.6,5.38,-1.5]],
    radius:[[0,1.22],[.4,1.04],[.6,.9],[.85,.66],[1,.48]],sleeve:false,
    hand:{dir:[-.85,-.4,.3],palm:[.1,-.55,.85],thumb:1,curl:[.5,.55,.4],size:1.26}},
];

const v=(a:V3|THREE.Vector3)=>a instanceof THREE.Vector3?a.clone():new THREE.Vector3(...a);
function profile(stops:number[][]){
  return(t:number)=>{let i=0;while(i<stops.length-2&&t>stops[i+1][0])i++;const [t0,r0]=stops[i],[t1,r1]=stops[i+1],k=THREE.MathUtils.clamp((t-t0)/(t1-t0),0,1);return r0+(r1-r0)*k*k*(3-2*k);};
}
/** Variable-radius tube with analytic normals. Optional fabric folds ripple
 * the sleeve surface toward the middle of the run. */
function sweep(curve:THREE.Curve<THREE.Vector3>,radius:(t:number)=>number,segments:number,radial:number,folds=0){
  const frames=curve.computeFrenetFrames(segments,false),positions:number[]=[],normals:number[]=[],indices:number[]=[],p=new THREE.Vector3();
  for(let i=0;i<=segments;i++){
    const t=i/segments;curve.getPointAt(t,p);const N=frames.normals[i],B=frames.binormals[i];
    for(let j=0;j<=radial;j++){
      const a=j/radial*Math.PI*2,c=Math.cos(a),s=Math.sin(a),r=radius(t)*(1+folds*Math.sin(a*3+t*31)*Math.sin(Math.min(1,t/.86)*Math.PI));
      const nx=N.x*c+B.x*s,ny=N.y*c+B.y*s,nz=N.z*c+B.z*s;positions.push(p.x+nx*r,p.y+ny*r,p.z+nz*r);normals.push(nx,ny,nz);
    }
  }
  for(let i=0;i<segments;i++)for(let j=0;j<radial;j++){const a=i*(radial+1)+j,b=a+radial+1;indices.push(a,a+1,b,b,a+1,b+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(indices);return g;
}
const ball=(p:THREE.Vector3,r:number,detail=12)=>new THREE.SphereGeometry(r,detail*2,detail).translate(p.x,p.y,p.z);

/** Palm plus four jointed fingers and thumb. Fingers bend toward the palm
 * normal, so curl wraps them around whatever the hand is holding. */
function hand(out:THREE.BufferGeometry[],wrist:THREE.Vector3,o:Arm['hand']){
  const d=v(o.dir).normalize(),n=v(o.palm),size=o.size;n.addScaledVector(d,-n.dot(d)).normalize();
  const side=new THREE.Vector3().crossVectors(d,n),thumbSide=side.clone().multiplyScalar(o.thumb);
  const L=1.25*size,W=1.12*size,T=.36*size;
  // Rounded-rectangle outline with a gently domed back, not an egg.
  const palm=new THREE.SphereGeometry(1,28,18),pp=palm.getAttribute('position');
  for(let i=0;i<pp.count;i++){const sq=(x:number,k:number)=>Math.sign(x)*Math.abs(x)**k;pp.setXYZ(i,sq(pp.getX(i),.5)*W/2,sq(pp.getY(i),.6)*L/2,pp.getZ(i)*T/2);}
  palm.computeVertexNormals();palm.applyMatrix4(new THREE.Matrix4().makeBasis(side,d,n).setPosition(wrist.clone().addScaledVector(d,L*.42)));out.push(palm);
  const lengths=[.93,1,.95,.76],offsets=[.37,.12,-.13,-.36];
  lengths.forEach((f,i)=>{
    const length=f*1.05*size,base=wrist.clone().addScaledVector(d,L*.86).addScaledVector(thumbSide,offsets[i]*W).addScaledVector(n,-T*.05);
    let dir=d.clone().applyAxisAngle(n,(i-1.5)*-.05*o.thumb);const points=[base.clone().addScaledVector(dir,-L*.3),base.clone()];
    [.46,.3,.24].forEach((part,k)=>{dir=dir.applyAxisAngle(side,o.curl[k]);points.push(points[points.length-1].clone().addScaledVector(dir,length*part));});
    const r0=.14*size,r1=.105*size;out.push(sweep(new THREE.CatmullRomCurve3(points),t=>r0+(r1-r0)*t,20,12),ball(points[points.length-1],r1,8));
  });
  const thumbCurl=o.thumbCurl??.35;let dir=d.clone().multiplyScalar(Math.cos(.62)).addScaledVector(thumbSide,Math.sin(.62)).normalize();
  const base=wrist.clone().addScaledVector(d,L*.22).addScaledVector(thumbSide,W*.4).addScaledVector(n,T*.12),points=[base.clone().addScaledVector(dir,-L*.15),base.clone()];
  const axis=new THREE.Vector3().crossVectors(dir,n).normalize();
  for(const part of [.52,.4]){dir=dir.applyAxisAngle(axis,thumbCurl);points.push(points[points.length-1].clone().addScaledVector(dir,.85*size*part));}
  out.push(sweep(new THREE.CatmullRomCurve3(points),t=>.16*size-.04*size*t,18,12),ball(points[points.length-1],.12*size,8));
}

/** Bronze geometry in sculpture-local metres (origin at plaza level, centre of
 * the vault). Pure: usable without a DOM. Returns visual and collision meshes. */
export function buildEmbraceGeometry(){
  const parts:THREE.BufferGeometry[]=[],collision:THREE.BufferGeometry[]=[];
  for(const arm of ARMS){
    const curve=new THREE.CatmullRomCurve3(arm.points.map(p=>v(p)),false,'centripetal'),radius=profile(arm.radius);
    const tube=sweep(curve,radius,72,26,arm.sleeve?.022:.012);parts.push(tube);collision.push(sweep(curve,radius,24,10));
    const wrist=curve.getPointAt(1),tangent=curve.getTangentAt(1);
    if(arm.sleeve){
      // Jacket cuff lip and three buttons on the outer face of the sleeve.
      const t0=.875,t1=.905,lip=new THREE.CatmullRomCurve3([0,1,2,3].map(k=>curve.getPointAt(t0+(t1-t0)*k/3)));parts.push(sweep(lip,t=>radius(t0+(t1-t0)*t)+.035,6,26));
      for(const t of [.8,.828,.856]){const p=curve.getPointAt(t),out=new THREE.Vector3(p.x,0,p.z).normalize();out.addScaledVector(curve.getTangentAt(t),-out.dot(curve.getTangentAt(t))).normalize();parts.push(ball(p.clone().addScaledVector(out,radius(t)*.98),.075,6));}
    }
    if(arm.bracelet){const p=curve.getPointAt(arm.bracelet),ring=new THREE.TorusGeometry(radius(arm.bracelet)+.02,.08,8,32);ring.lookAt(curve.getTangentAt(arm.bracelet));ring.translate(p.x,p.y,p.z);parts.push(ring);}
    hand(parts,wrist.clone().addScaledVector(tangent,.05),arm.hand);
    const palm=new THREE.SphereGeometry(1,8,6),d=v(arm.hand.dir).normalize(),n=v(arm.hand.palm);n.addScaledVector(d,-n.dot(d)).normalize();
    palm.scale(.62*arm.hand.size,.95*arm.hand.size,.3*arm.hand.size);palm.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(d,n),d,n).setPosition(wrist.clone().addScaledVector(d,.75*arm.hand.size)));collision.push(palm);
  }
  // Untextured bronze: drop primitive UVs so every part shares position+normal.
  parts.forEach(g=>g.deleteAttribute('uv'));
  const geometry=mergeGeometries(parts,false)!,hull=mergeGeometries(collision.map(g=>{const c=new THREE.BufferGeometry();c.setAttribute('position',g.getAttribute('position'));c.setIndex(g.index);return c;}),false)!;
  parts.forEach(g=>g.dispose());collision.forEach(g=>g.dispose());
  // Fit the published 20 ft height and 25 ft width; the base stays at plaza level.
  geometry.computeBoundingBox();const box=geometry.boundingBox!,scale=EMBRACE.height/box.max.y,width=(box.max.x-box.min.x)*scale,spread=EMBRACE.width/width;
  const fit=new THREE.Matrix4().makeScale(scale*spread,scale,scale*spread);geometry.applyMatrix4(fit);hull.applyMatrix4(fit);
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return{geometry,collision:hull};
}

function paverTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d')!;
  c.fillStyle='#8d8a84';c.fillRect(0,0,256,256);
  for(let row=0;row<4;row++)for(let col=0;col<2;col++){const shade=168+((row*7+col*3)%5)*6;c.fillStyle=`rgb(${shade},${shade-2},${shade-6})`;c.fillRect(col*128+(row%2)*64+2,row*64+2,124,60);c.fillRect(col*128+(row%2)*64-126,row*64+2,124,60);}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;return texture;
}

/** Plaza surface draped on the DEM as concentric rings of the mapped outline. */
function plazaSurface(city:CityData,outline:Point2[],offset:number){
  const [cx,cz]=PLAZA_CENTER,rings=7,positions:number[]=[],uv:number[]=[],indices:number[]=[],count=outline.length;
  // Wind every triangle to face up whichever way the source outline runs.
  const reversed=outline.reduce((sum,p,i)=>{const q=outline[(i+1)%count];return sum+(p[0]*q[1]-q[0]*p[1]);},0)<0;
  positions.push(cx,sampleElevation(city,cx,cz)+offset,cz);uv.push(cx/3.2,cz/3.2);
  for(let r=1;r<=rings;r++)for(const p of outline){const x=cx+(p[0]-cx)*r/rings,z=cz+(p[1]-cz)*r/rings;positions.push(x,sampleElevation(city,x,z)+offset,z);uv.push(x/3.2,z/3.2);}
  const tri=(a:number,b:number,c:number)=>reversed?indices.push(a,c,b):indices.push(a,b,c);
  for(let i=0;i<count;i++)tri(0,1+(i+1)%count,1+i);
  for(let r=1;r<rings;r++)for(let i=0;i<count;i++){const a=1+(r-1)*count+i,b=1+(r-1)*count+(i+1)%count,c=a+count,d=b+count;tri(a,b,c);tri(b,d,c);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}

/** Adds the sculpture and 1965 Freedom Plaza. Returns the group and a
 * world-space collision mesh for the bronze. */
export function addTheEmbrace(scene:THREE.Scene,city:CityData){
  const group=new THREE.Group();group.name='The Embrace and 1965 Freedom Plaza';
  const ground=sampleElevation(city,EMBRACE.x,EMBRACE.z);
  const bronze=new THREE.MeshStandardMaterial({color:'#dc9a5c',metalness:.5,roughness:.26,envMapIntensity:4.5});
  const {geometry,collision}=buildEmbraceGeometry();
  const place=new THREE.Matrix4().makeRotationY(EMBRACE.yaw).setPosition(EMBRACE.x,ground,EMBRACE.z);
  const sculpture=new THREE.Mesh(geometry,bronze);sculpture.name='The Embrace bronze';sculpture.applyMatrix4(place);sculpture.castShadow=true;sculpture.receiveShadow=true;group.add(sculpture);
  const paving=new THREE.MeshStandardMaterial({color:'#b4b2ad',map:paverTexture(),roughness:.86});
  const plaza=new THREE.Mesh(plazaSurface(city,PLAZA,.075),paving);plaza.name='1965 Freedom Plaza';plaza.receiveShadow=true;group.add(plaza);
  const granite=new THREE.MeshStandardMaterial({color:'#c9c3b6',roughness:.78});
  // The mapped inner paving ring, drawn as a pale granite band.
  const band:number[]=[],bandIndex:number[]=[];
  RING.forEach((p,i)=>{const q=RING[(i+1)%RING.length],dx=q[0]-p[0],dz=q[1]-p[1],l=Math.hypot(dx,dz),nx=-dz/l*.32,nz=dx/l*.32,k=band.length/3;
    for(const [x,z] of [[p[0]+nx,p[1]+nz],[p[0]-nx,p[1]-nz],[q[0]+nx,q[1]+nz],[q[0]-nx,q[1]-nz]])band.push(x,sampleElevation(city,x,z)+.09,z);bandIndex.push(k,k+2,k+1,k+1,k+2,k+3);});
  const ring=new THREE.BufferGeometry();ring.setAttribute('position',new THREE.Float32BufferAttribute(band,3));ring.setIndex(bandIndex);ring.computeVertexNormals();
  const ringMesh=new THREE.Mesh(ring,granite);ringMesh.receiveShadow=true;group.add(ringMesh);
  // Low granite retaining wall on the uphill east and south edge.
  const walls:THREE.BufferGeometry[]=[];
  for(let i=1;i<WALL.length;i++){
    const a=WALL[i-1],b=WALL[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2,base=Math.min(sampleElevation(city,...a),sampleElevation(city,...b)),top=sampleElevation(city,mx,mz)+.62;
    walls.push(new THREE.BoxGeometry(.5,top-base+.4,length+.12).rotateY(Math.atan2(dx,dz)).translate(mx,(top+base-.4)/2,mz));
  }
  const wall=new THREE.Mesh(mergeGeometries(walls,false)!,granite);wall.castShadow=true;wall.receiveShadow=true;group.add(wall);
  // One world-space collision mesh: the bronze hull plus the wall, so cars stop at both.
  const solid=[collision.applyMatrix4(place),...walls].map(g=>{const c=new THREE.BufferGeometry();c.setAttribute('position',g.getAttribute('position'));c.setIndex(g.index);return c;});
  const world=mergeGeometries(solid,false)!,vertices=new Float32Array(world.getAttribute('position').array),indices=new Uint32Array(world.index!.array);
  world.dispose();collision.dispose();walls.forEach(g=>g.dispose());
  group.userData={name:'The Embrace',artist:'Hank Willis Thomas',position:[EMBRACE.x,EMBRACE.z],yaw:EMBRACE.yaw,ground,height:EMBRACE.height,width:EMBRACE.width,triangles:geometry.index!.count/3,source:'OSM node 10552518542; plaza ways 1132661865, 1131759734, 1334814996',accuracy:'Mapped position and plaza; bronze is an original procedural interpretation, orientation estimated'};
  scene.add(group);return{group,collision:{vertices,indices}};
}
