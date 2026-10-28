import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
export {createTransitBus} from './transit-bus.ts';

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
function sign(text:string,w:number,h:number){
 if(typeof document==='undefined')return new THREE.Group();
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const c=canvas.getContext('2d')!;c.fillStyle='#101512';c.fillRect(0,0,1024,128);c.fillStyle='#f5bf55';c.textAlign='center';c.textBaseline='middle';c.font='bold 64px monospace';c.fillText(text,512,65,970);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture}));return mesh;
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
