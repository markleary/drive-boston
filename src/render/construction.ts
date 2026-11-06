import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

export type ConstructionVehicleKind='dump-truck'|'excavator';
/** Grounded model envelopes, also used by the construction collision proxies. */
export const CONSTRUCTION_VEHICLE_DIMENSIONS={
  'dump-truck':{width:2.5,length:6.8,height:3.2},
  excavator:{width:2.45,length:6.5,height:3.05},
} as const;

type Surface='yellow'|'orange'|'white'|'black'|'rubber'|'steel'|'glass'|'amber'|'lamp'|'red'|'soil';
type Parts=Map<Surface,THREE.BufferGeometry[]>;

/** All construction props use shared, immutable model buffers. A prototype is
 * merged by surface once; streaming a worksite only clones its transforms. */
export function createConstructionAssets(){
  const standard=(color:number,roughness=.65,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const materials:Record<Surface,THREE.MeshStandardMaterial>={
    yellow:standard(0xeeb725,.48,.15),orange:standard(0xff641b,.6),
    white:new THREE.MeshStandardMaterial({color:0xf2f1e5,roughness:.42,emissive:0xe5e3d6,emissiveIntensity:.14}),
    black:standard(0x25292b,.76),rubber:standard(0x16191a,.94),steel:standard(0x8b9699,.4,.72),
    glass:new THREE.MeshStandardMaterial({color:0x163941,roughness:.19,metalness:.45}),
    amber:new THREE.MeshStandardMaterial({color:0xffb52e,roughness:.3,emissive:0xff8c06,emissiveIntensity:1.5}),
    lamp:new THREE.MeshStandardMaterial({color:0xf2ecda,roughness:.26,emissive:0xffe6b2,emissiveIntensity:.5}),
    red:new THREE.MeshStandardMaterial({color:0xac2119,roughness:.35,emissive:0xc52813,emissiveIntensity:.3}),
    soil:standard(0x544535,.96),
  };
  const geometries=new Set<THREE.BufferGeometry>();
  const add=(parts:Parts,surface:Surface,g:THREE.BufferGeometry,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>{
    g.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x,y,z);
    const list=parts.get(surface)??[];list.push(g);parts.set(surface,list);
  };
  const box=(p:Parts,s:Surface,w:number,h:number,d:number,x:number,y:number,z:number,rz=0)=>add(p,s,new THREE.BoxGeometry(w,h,d),x,y,z,0,0,rz);
  const cylinder=(p:Parts,s:Surface,r:number,h:number,x:number,y:number,z:number,axis:'x'|'y'|'z'='y',top=r)=>add(p,s,new THREE.CylinderGeometry(top,r,h,12),x,y,z,axis==='z'?Math.PI/2:0,0,axis==='x'?Math.PI/2:0);
  const beam=(p:Parts,s:Surface,a:THREE.Vector3,b:THREE.Vector3,w:number,d:number)=>{
    const g=new THREE.BoxGeometry(w,a.distanceTo(b),d),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());
    g.applyQuaternion(q);const mid=a.clone().add(b).multiplyScalar(.5);add(p,s,g,mid.x,mid.y,mid.z);
  };
  const finish=(name:string,parts:Parts)=>{
    const group=new THREE.Group();group.name=name;
    for(const [surface,list]of parts){
      // Box, cylinder and extruded pieces all carry position/normal/UV attributes.
      const normalized=list.map(g=>g.index?g.toNonIndexed():g);
      const geometry=mergeGeometries(normalized,false)!;
      geometry.computeBoundingSphere();geometries.add(geometry);
      for(const g of normalized)g.dispose();for(const g of list)if(g.index)g.dispose();
      const mesh=new THREE.Mesh(geometry,materials[surface]);mesh.name=`${name} ${surface}`;
      mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
    }
    return group;
  };

  const coneParts:Parts=new Map();
  // A 28-inch highway cone: a heavy square rubber foot, uninterrupted tapered
  // profile and two reflective collars whose radii follow that same profile.
  const foot=new THREE.Shape(),half=.245,corner=.045;
  foot.moveTo(-half+corner,-half);foot.lineTo(half-corner,-half);foot.quadraticCurveTo(half,-half,half,-half+corner);
  foot.lineTo(half,half-corner);foot.quadraticCurveTo(half,half,half-corner,half);foot.lineTo(-half+corner,half);
  foot.quadraticCurveTo(-half,half,-half,half-corner);foot.lineTo(-half,-half+corner);foot.quadraticCurveTo(-half,-half,-half+corner,-half);
  const base=new THREE.ExtrudeGeometry(foot,{depth:.055,bevelEnabled:false,curveSegments:3});base.rotateX(-Math.PI/2);add(coneParts,'rubber',base);
  cylinder(coneParts,'orange',.191,.045,0,.075,0);
  const bottom=.095,top=.715,radius=(y:number)=>.184-(y-bottom)/(top-bottom)*.145;
  for(const [a,b,s]of [[bottom,.245,'orange'],[.245,.355,'white'],[.355,.47,'orange'],[.47,.57,'white'],[.57,top,'orange']] as const){
    add(coneParts,s,new THREE.CylinderGeometry(radius(b),radius(a),b-a,16,1,true),0,(a+b)/2,0);
  }
  cylinder(coneParts,'orange',radius(top),.016,0,top,0,'y',radius(top));
  cylinder(coneParts,'black',.018,.002,0,.724,0);
  const cone=finish('Traffic cone',coneParts);

  const truckParts:Parts=new Map();
  box(truckParts,'black',1.7,.24,5.8,0,.82,-.1);
  for(const z of [-2.25,-1.1,2.05]){
    cylinder(truckParts,'steel',.1,2.15,0,.49,z,'x');
    for(const side of [-1,1]){
      cylinder(truckParts,'rubber',.48,.32,side*1.08,.49,z,'x');
      cylinder(truckParts,'steel',.29,.015,side*1.235,.49,z,'x');
      cylinder(truckParts,'black',.11,.010,side*1.245,.49,z,'x');
      for(let j=0;j<12;j++){
        const angle=j*Math.PI/6;
        add(truckParts,'black',new THREE.BoxGeometry(.325,.045,.11),side*1.08,.49+Math.cos(angle)*.474,z+Math.sin(angle)*.474,angle);
      }
    }
  }
  // Bed and ribs, with an open, recessed soil load rather than a solid yellow box.
  box(truckParts,'yellow',2.28,.18,3.65,0,1.17,-1.24);
  for(const side of [-1,1]){
    box(truckParts,'yellow',.12,.93,3.78,side*1.12,1.72,-1.24);
    box(truckParts,'steel',.12,.10,3.8,side*1.12,2.23,-1.24);
    for(const z of [-2.85,-1.95,-1.05,-.15,.5])box(truckParts,'yellow',.07,1.05,.07,side*1.198,1.73,z);
    box(truckParts,'black',.07,.43,.48,side*1.10,.62,-2.89);
    box(truckParts,'steel',.13,.08,.42,side*1.04,.96,.93);
    box(truckParts,'white',.017,.055,3.4,side*1.201,1.38,-1.24);
    box(truckParts,'red',.02,.055,.40,side*1.211,1.38,-2.60);
  }
  box(truckParts,'yellow',2.3,.98,.12,0,1.73,-3.13);
  box(truckParts,'yellow',2.3,1.10,.12,0,1.79,.61);
  box(truckParts,'soil',2.07,.22,3.42,0,1.44,-1.26);
  box(truckParts,'yellow',2.2,.12,.95,0,2.40,.40);
  box(truckParts,'yellow',2.2,.38,1.52,0,1.22,1.53);
  box(truckParts,'yellow',2.19,.20,1.53,0,2.91,1.53);
  box(truckParts,'yellow',2.14,.76,.15,0,2.02,.84);
  for(const side of [-1,1]){
    box(truckParts,'yellow',.11,1.50,.11,side*1.03,2.10,.87);
    box(truckParts,'yellow',.10,1.50,.11,side*1.03,2.10,2.22);
    box(truckParts,'glass',.035,.86,1.12,side*1.09,2.31,1.56);
    box(truckParts,'yellow',.07,.39,1.28,side*1.10,1.67,1.56);
    box(truckParts,'black',.025,.055,.19,side*1.143,1.88,1.19);
    box(truckParts,'steel',.15,.06,.54,side*1.08,1.01,1.47);
    box(truckParts,'steel',.22,.05,.55,side*1.10,.76,1.48);
    box(truckParts,'black',.09,.48,.24,side*1.20,2.34,2.10);
    box(truckParts,'steel',.07,.07,.35,side*1.17,2.22,2.04);
    box(truckParts,'yellow',.28,.13,1.01,side*1.02,1.04,2.05);
    cylinder(truckParts,'amber',.10,.14,side*.64,3.09,1.48);
    box(truckParts,'lamp',.36,.21,.035,side*.84,1.34,3.31);
    box(truckParts,'amber',.17,.09,.04,side*1.01,1.51,3.31);
    box(truckParts,'red',.22,.15,.04,side*.92,1.01,-3.32);
  }
  box(truckParts,'glass',1.91,.83,.045,0,2.33,2.282);
  box(truckParts,'yellow',.07,.95,.065,0,2.33,2.31);
  box(truckParts,'black',.70,.035,.045,-.46,1.99,2.32,.12);
  box(truckParts,'black',.70,.035,.045,.46,1.99,2.32,.12);
  box(truckParts,'yellow',1.93,.56,1.02,0,1.66,2.77);
  box(truckParts,'black',.90,.42,.035,0,1.48,3.30);
  for(let i=0;i<5;i++)box(truckParts,'steel',.81,.025,.045,0,1.32+i*.07,3.325);
  box(truckParts,'steel',2.40,.20,.17,0,1.04,3.30);
  box(truckParts,'steel',2.37,.15,.16,0,.88,-3.27);
  cylinder(truckParts,'steel',.065,1.65,-.92,2.20,.71);
  const truck=finish('Construction dump truck',truckParts);

  const excavatorParts:Parts=new Map();
  box(excavatorParts,'black',1.55,.32,2.76,0,.54,-.46);
  for(const side of [-1,1]){
    box(excavatorParts,'rubber',.48,.51,2.94,side*.96,.38,-.48);
    for(const z of [-1.83,.87])cylinder(excavatorParts,'rubber',.29,.48,side*.96,.38,z,'x');
    for(let i=0;i<15;i++){
      const z=-1.83+i*.192;
      box(excavatorParts,'black',.51,.065,.11,side*.96,.663,z);
      box(excavatorParts,'black',.51,.06,.11,side*.96,.082,z);
    }
    for(let i=0;i<6;i++)cylinder(excavatorParts,'steel',.175,.02,side*1.20,.38,-1.65+i*.48,'x');
    box(excavatorParts,'yellow',.07,.15,2.55,side*1.19,.72,-.48);
  }
  cylinder(excavatorParts,'black',.78,.22,0,.86,-.50);
  box(excavatorParts,'yellow',2.04,.53,2.54,0,1.19,-.59);
  box(excavatorParts,'yellow',2.15,.59,.73,0,1.64,-1.58);
  box(excavatorParts,'black',1.83,.13,.07,0,1.39,-1.981);
  for(let i=0;i<7;i++)box(excavatorParts,'black',.035,.33,.025,-.84+i*.13,1.77,-1.953);
  box(excavatorParts,'yellow',.78,.62,1.12,-.58,1.67,-.58);
  box(excavatorParts,'black',.48,.025,.67,-.58,1.997,-.58);
  // Offset glazed operator cab, framed at its four corners.
  box(excavatorParts,'black',.90,.12,1.26,.49,1.53,-.48);
  box(excavatorParts,'glass',.86,1.02,1.16,.49,2.12,-.48);
  box(excavatorParts,'yellow',1.02,.12,1.37,.49,2.70,-.48);
  for(const x of [.02,.96])for(const z of [-1.10,.14])box(excavatorParts,'yellow',.07,1.14,.07,x,2.13,z);
  box(excavatorParts,'black',.035,.07,1.21,.984,1.91,-.48);
  box(excavatorParts,'yellow',.96,.10,.07,.49,1.87,.17);
  cylinder(excavatorParts,'amber',.10,.14,.51,2.86,-.76);
  box(excavatorParts,'lamp',.25,.14,.07,.49,2.58,.241);
  cylinder(excavatorParts,'black',.045,.53,-.78,2.15,-.95);
  // Stowed working arm: low enough for street trees and entirely inside a
  // 6.5 m longitudinal envelope, without reaching into the adjacent lane.
  const a=new THREE.Vector3(-.43,1.48,.20),b=new THREE.Vector3(-.43,2.48,1.12),c=new THREE.Vector3(-.43,1.37,2.48),d=new THREE.Vector3(-.43,.42,2.73);
  beam(excavatorParts,'yellow',a,b,.36,.42);beam(excavatorParts,'yellow',b,c,.29,.34);beam(excavatorParts,'yellow',c,d,.24,.27);
  for(const p of [a,b,c])cylinder(excavatorParts,'steel',.12,.45,p.x,p.y,p.z,'x');
  beam(excavatorParts,'black',new THREE.Vector3(-.65,1.43,.35),new THREE.Vector3(-.65,2.25,1.07),.09,.09);
  beam(excavatorParts,'steel',new THREE.Vector3(-.65,2.25,1.07),new THREE.Vector3(-.65,2.47,1.21),.055,.055);
  beam(excavatorParts,'black',new THREE.Vector3(-.24,2.43,1.19),new THREE.Vector3(-.24,1.78,2.00),.085,.085);
  beam(excavatorParts,'steel',new THREE.Vector3(-.24,1.78,2.00),new THREE.Vector3(-.24,1.40,2.44),.055,.055);
  box(excavatorParts,'steel',.84,.15,.73,-.43,.20,2.71);
  box(excavatorParts,'steel',.84,.48,.12,-.43,.41,2.37);
  for(const side of [-1,1])box(excavatorParts,'steel',.07,.38,.67,-.43+side*.385,.35,2.70);
  for(let i=0;i<4;i++)box(excavatorParts,'black',.09,.10,.25,-.73+i*.20,.135,3.10);
  const excavator=finish('Construction excavator',excavatorParts);

  const signParts:Parts=new Map();
  box(signParts,'rubber',.78,.07,.56,0,.035,0);
  cylinder(signParts,'steel',.026,2.04,0,1.09,0);
  box(signParts,'black',1.01,1.01,.055,0,2.12,0,Math.PI/4);
  box(signParts,'orange',.94,.94,.06,0,2.12,-.008,Math.PI/4);
  // Crisp lettering is actual geometry: no canvas, texture uploads or font
  // dependencies are created as sites stream in and out.
  const glyphs:Record<string,string[]>={
    L:['100','100','100','100','111'],A:['010','101','111','101','101'],
    N:['1001','1101','1011','1001','1001'],E:['111','100','110','100','111'],
    C:['111','100','100','100','111'],O:['111','101','101','101','111'],
    S:['111','100','111','001','111'],D:['110','101','101','101','110'],
  };
  const word=(text:string,y:number,scale:number)=>{
    const width=[...text].reduce((n,c)=>n+glyphs[c][0].length+1,0)-1;let cursor=-width*scale/2;
    for(const char of text){const glyph=glyphs[char];for(let row=0;row<5;row++)for(let col=0;col<glyph[row].length;col++)if(glyph[row][col]==='1'){
      // Seen from -Z on the approach, +X is the left side of the sign.
      box(signParts,'black',scale*.93,scale*.93,.009,-(cursor+col*scale+scale/2),y+(2-row)*scale,-.044);
    }cursor+=(glyph[0].length+1)*scale;}
  };
  word('LANE',2.25,.033);word('CLOSED',1.99,.030);
  box(signParts,'black',1.13,.40,.08,0,1.18,-.025);
  // Amber left-merge arrow (local +X); the closed curb lane is at local -X.
  for(let i=0;i<7;i++)cylinder(signParts,'amber',.029,.016,-.43+i*.135,1.18,-.079,'z');
  for(let i=1;i<=2;i++)for(const side of [-1,1])cylinder(signParts,'amber',.029,.016,.38-i*.11,1.18+side*i*.070,-.079,'z');
  const sign=finish('Lane closed sign',signParts);

  return {
    cone:()=>cone.clone(),
    vehicle:(kind:ConstructionVehicleKind)=>(kind==='excavator'?excavator:truck).clone(),
    sign:()=>sign.clone(),
    dispose(){geometries.forEach(g=>g.dispose());Object.values(materials).forEach(m=>m.dispose());},
  };
}
