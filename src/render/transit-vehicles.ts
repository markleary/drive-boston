import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

type Surface='body'|'green'|'yellow'|'glass'|'dark'|'metal'|'rubber'|'head'|'tail';
const palette:Record<Surface,number>={body:0xd9dedb,green:0x246a4e,yellow:0xe4bd25,glass:0x20343c,dark:0x22292c,metal:0x8d9b9e,rubber:0x171d20,head:0xf2eacf,tail:0xa72922};
function builder(){
 const parts=new Map<Surface,THREE.BufferGeometry[]>();
 const add=(kind:Surface,g:THREE.BufferGeometry)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();n.deleteAttribute('uv');const list=parts.get(kind)??[];list.push(n);parts.set(kind,list);};
 const box=(kind:Surface,w:number,h:number,d:number,x:number,y:number,z:number,rx=0)=>add(kind,new THREE.BoxGeometry(w,h,d).rotateX(rx).translate(x,y,z));
 const beam=(kind:Surface,a:number[],b:number[],r=.035)=>{const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start),g=new THREE.CylinderGeometry(r,r,delta.length(),6);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));g.translate(...start.add(end).multiplyScalar(.5).toArray());add(kind,g);};
 const finish=()=>{const group=new THREE.Group();for(const[kind,geometries]of parts){const geometry=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!geometry)continue;const material=new THREE.MeshStandardMaterial({color:palette[kind],roughness:kind==='glass'?.16:kind==='metal'?.34:.55,metalness:kind==='glass'?.4:kind==='metal'?.75:.15,emissive:kind==='head'?0xf2dfb8:kind==='tail'?0xc92b21:0,emissiveIntensity:.3});const mesh=new THREE.Mesh(geometry,material);mesh.name=kind;mesh.castShadow=kind!=='glass';mesh.receiveShadow=true;group.add(mesh);}return group;};
 return{add,box,beam,finish};
}
/** Destination displays are painted once per headsign and shared by every vehicle showing it. */
const signTextures=new Map<string,THREE.CanvasTexture>();
function sign(text:string,w:number,h:number){
 if(typeof document==='undefined')return new THREE.Group();
 let texture=signTextures.get(text);
 if(!texture){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=64;const c=canvas.getContext('2d')!;c.fillStyle='#101512';c.fillRect(0,0,512,64);c.fillStyle='#f5bf55';c.textAlign='center';c.textBaseline='middle';c.font='bold 32px monospace';c.fillText(text,256,33,485);texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;signTextures.set(text,texture);}
 return new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture}));
}
let logoTexture:THREE.CanvasTexture|undefined;
function logo(){
 if(typeof document==='undefined')return new THREE.Group();
 if(!logoTexture){const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const c=canvas.getContext('2d')!;c.fillStyle='#f2f1df';c.beginPath();c.arc(64,64,61,0,Math.PI*2);c.fill();c.strokeStyle='#202a2a';c.lineWidth=8;c.stroke();c.fillStyle='#202a2a';c.font='bold 91px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText('T',64,69);logoTexture=new THREE.CanvasTexture(canvas);logoTexture.colorSpace=THREE.SRGBColorSpace;}
 return new THREE.Mesh(new THREE.PlaneGeometry(.72,.72),new THREE.MeshStandardMaterial({map:logoTexture,transparent:true,roughness:.6}));
}

/** Original 40-foot low-floor city bus: white/black glazing band, yellow belt,
 * curb-side double doors, rooftop HVAC, dual rear tires and destination display.
 * The body is built once; every bus in the fleet shares its geometry and materials. */
let busTemplate:THREE.Group|undefined;
function busBody(){
 const p=builder();p.box('body',2.5,2.52,11.7,0,1.68,0);p.box('dark',2.52,1.14,10.6,0,2.08,-.35);p.box('yellow',2.53,.3,11.62,0,1.35,0);
 p.box('body',2.5,.29,11.7,0,2.97,0);p.box('dark',2.48,.3,11.9,0,.4,0);p.box('body',1.85,.32,3.3,0,3.23,-2.65);
 p.box('dark',2.3,1.34,.08,0,2.09,5.875);p.box('glass',2.19,1.03,.04,0,1.95,5.93);p.box('dark',.04,1.13,.05,0,1.98,5.96);
 p.box('yellow',2.51,.36,.08,0,1.12,5.91);p.box('dark',2.28,.39,.06,0,2.77,5.94);
 for(const side of [-1,1]){
  for(let z=-4.8;z<4.5;z+=1.25){p.box('glass',.035,1.04,1.14,side*1.268,2.12,z);p.box('body',.055,1.15,.055,side*1.285,2.1,z+.61);}
  for(const z of [3.64,-3.64]){const tire=new THREE.CylinderGeometry(.47,.47,.28,20).rotateZ(Math.PI/2).translate(side*1.19,.48,z);p.add('rubber',tire);p.add('metal',new THREE.CylinderGeometry(.27,.27,.035,14).rotateZ(Math.PI/2).translate(side*1.345,.48,z));}
  p.beam('dark',[side*1.15,2.6,5.4],[side*1.52,2.5,5.9],.035);p.box('dark',.12,.45,.26,side*1.53,2.23,5.92);
  p.box('head',.37,.2,.07,side*.86,.78,5.95);p.box('tail',.2,.5,.06,side*1.02,1.09,-5.92);
  for(let i=0;i<5;i++)p.box('dark',.036,.034,2.1,side*1.28,.57+i*.11,-4.6);
 }
 for(const z of [4.43,.22]){p.box('dark',.045,2.16,1.34,-1.301,1.56,z);for(const offset of [-.32,.32])p.box('glass',.035,1.9,.58,-1.329,1.59,z+offset);p.box('yellow',.05,.09,1.38,-1.35,.62,z);}
 return p.finish();
}
export function createTransitBus(destination:string){
 busTemplate??=busBody();const group=busTemplate.clone();group.name=`MBTA-style bus ${destination}`;const display=sign(destination,2.18,.32);display.position.set(0,2.77,5.985);group.add(display);
 const rear=sign(destination.split(' ')[0],.8,.28);rear.position.set(0,2.6,-5.96);rear.rotation.y=Math.PI;group.add(rear);
 for(const side of [-1,1]){const t=logo();t.position.set(side*1.29,.88,-1.42);t.rotation.y=side*Math.PI/2;group.add(t);}
 return group;
}

/** Original articulated Green Line vehicle inspired by the contemporary
 * silver/green fleet. Separate body sections follow the track's local tangent. */
export function createGreenLine(destination:string){
 const group=new THREE.Group();group.name='Green Line articulated trolley';const sections:THREE.Group[]=[];
 for(let section=0;section<3;section++){
  const p=builder(),length=section===1?6.25:7.7,front=section===0,rear=section===2;
  p.box('body',2.54,2.56,length,0,1.82,0);p.box('green',2.58,.62,length+.01,0,.86,0);p.box('dark',2.57,1.1,length-.1,0,2.28,0);p.box('body',2.55,.24,length,0,3.1,0);p.box('metal',2.0,.35,Math.max(2,length-2),0,3.38,0);
  for(const side of [-1,1]){
   for(let z=-length/2+.7;z<length/2-.4;z+=1.25){p.box('glass',.035,1.01,1.08,side*1.3,2.28,z);p.box('body',.06,1.13,.065,side*1.32,2.26,z+.58);}
   const doorZ=section===1?0:-1.45;p.box('green',.065,2.23,1.32,side*1.325,1.57,doorZ);for(const dz of [-.3,.3])p.box('glass',.04,1.3,.53,side*1.365,1.9,doorZ+dz);
   for(const z of [-length*.29,length*.29])p.add('rubber',new THREE.CylinderGeometry(.34,.34,.16,14).rotateZ(Math.PI/2).translate(side*1.0,.35,z));
  }
  if(front||rear){const end=front?1:-1,z=end*(length/2+.04);p.box('green',2.57,1.0,.07,0,1.06,z);p.box('dark',2.39,1.58,.07,0,2.18,z+.025*end);p.box('glass',2.24,1.05,.045,0,2.04,z+.07*end);p.box('dark',.055,1.08,.05,0,2.02,z+.1*end);for(const side of [-1,1])p.box(front?'head':'tail',.24,.15,.08,side*.91,1.15,z+.09*end);p.box('metal',1.0,.14,.4,0,.47,z+.2*end);}
  const body=p.finish();sections.push(body);group.add(body);
  if(front){const label=sign(destination,2.17,.33);label.position.set(0,2.78,length/2+.14);body.add(label);}
  if(section===1){
   const pantograph=builder();pantograph.beam('dark',[-.6,3.62,-.9],[-.6,4.7,.0],.045);pantograph.beam('dark',[.6,3.62,-.9],[.6,4.7,.0],.045);pantograph.beam('dark',[-.6,4.7,0],[-.6,5.65,-.7],.045);pantograph.beam('dark',[.6,4.7,0],[.6,5.65,-.7],.045);pantograph.box('metal',1.8,.08,.22,0,5.68,-.7);body.add(pantograph.finish());
  }
 }
 const bellows:THREE.Group[]=[];
 for(let joint=0;joint<2;joint++){const p=builder();for(let i=0;i<9;i++)p.box(i%2?'dark':'rubber',2.46,2.65,.065,0,1.82,(i-4)*.075);const b=p.finish();bellows.push(b);group.add(b);}
 return{group,sections,bellows,offsets:[7.35,0,-7.35],length:22.5};
}
