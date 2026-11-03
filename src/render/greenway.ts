import * as THREE from 'three';
import type {CityData,Point2} from '../types';
import {greenway,greenwayBounds,intersectsGreenwayBounds,insideGreenwayRings,inGreenway,inGreenwayWalk,type GreenwayBounds} from '../simulation/greenway.ts';
import {sampleElevation} from '../simulation/terrain.ts';
import {inTunnelApproach} from '../simulation/tunnels.ts';
import {parkSurface} from './area-surfaces.ts';
import {clipPortalSurface,drapedRibbonInto} from './terrain-ground.ts';
import {PartBatches,box,type Part} from './geometry-writer.ts';
import {seeded,hash} from './materials';
import {createGrassMaterial} from './ground-cover';
import {createStreetTrees,type TreeField} from './foliage';
import {due,type Pace} from './pacing.ts';

let shared:ReturnType<typeof makeMaterials>|undefined;
function makeMaterials(){
  const ground=(color:string)=>new THREE.MeshStandardMaterial({color,roughness:.93,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  const lawn=createGrassMaterial('#c3d5ad');lawn.polygonOffset=true;lawn.polygonOffsetFactor=1;lawn.polygonOffsetUnits=1;
  return {lawn,meadow:ground('#8a9360'),garden:ground('#626b43'),paving:ground('#c4bbaa'),path:ground('#d4c9b3'),boardwalk:ground('#a68a63'),
    stone:ground('#b7b8ad'),darkStone:ground('#626e6d'),water:new THREE.MeshStandardMaterial({color:'#729e9f',metalness:.25,roughness:.23}),
    iron:new THREE.MeshStandardMaterial({color:'#536e70',metalness:.65,roughness:.46}),wood:ground('#9a744e'),leaf:ground('#698151'),flower:ground('#a5a06b'),purple:ground('#8b7b94'),
    white:ground('#e4e1cf'),teal:ground('#477e7b'),steel:new THREE.MeshStandardMaterial({color:'#b3c4c6',metalness:.85,roughness:.22})};
}
/** Source-aligned landscape, built and disposed with its owning city tile.
 * Feature models and low planting are restrained procedural interpretations. */
export function* greenwayDetailSteps(city:CityData,options:{bounds?:GreenwayBounds;owner?:string;treeField?:TreeField;pace?:Pace}={}):Generator<void,THREE.Group>{
  const group=new THREE.Group();group.name='Rose Kennedy Greenway';
  const bounds=options.bounds,visible=(rings:Point2[][])=>!bounds||intersectsGreenwayBounds(greenwayBounds(rings),bounds);
  const parcels=greenway.parcels.filter(p=>visible(p.rings));
  if(!parcels.length){group.userData={parcels:0,trees:0};return group;}
  const mats=shared??=makeMaterials(),batches=new PartBatches(160),matrix=new THREE.Matrix4();
  const owned=(x:number,z:number)=>!bounds||(x>=bounds.minX&&x<bounds.maxX&&z>=bounds.minZ&&z<bounds.maxZ);
  const safe=(x:number,z:number)=>inGreenway(x,z)&&!inTunnelApproach(city,x,z);
  const h=(x:number,z:number)=>sampleElevation(city,x,z);
  const part=(shape:Part,material:THREE.Material,x:number,y:number,z:number,yaw=0)=>batches.part(shape,material,matrix.makeRotationY(yaw).setPosition(x,y,z));
  function surface(rings:Point2[][],material:THREE.Material,offset:number,clipToTile=true){
    const geometry=clipPortalSurface(city,parkSurface(city,rings,offset,undefined,clipToTile?bounds:undefined));
    if(geometry.attributes.position.count)batches.at(material,rings[0][0][0],rings[0][0][1]).append(geometry);geometry.dispose();
  }
  const circle=(x:number,z:number,r:number):Point2[]=>Array.from({length:64},(_,i)=>[x+Math.cos(i/64*Math.PI*2)*r,z+Math.sin(i/64*Math.PI*2)*r]);
  // Adjacent ground polygons meet at one height above the old inventory sheets.
  // The source overlay is cut to current roadways and to its interior surfaces.
  for(const p of greenway.bases.filter(p=>visible(p.rings))){if(due(options.pace))yield;surface(p.rings,mats[p.kind as 'lawn'|'meadow'|'paving'],.09);}
  const surfaces=greenway.surfaces.filter(a=>visible(a.rings));
  for(const a of surfaces){if(due(options.pace))yield;surface(a.rings,mats[a.kind as 'lawn'|'garden'|'path'|'boardwalk'],a.kind==='boardwalk'?.105:.09);}
  const shrub=new THREE.IcosahedronGeometry(1,0),flower=new THREE.IcosahedronGeometry(1,0),trees:THREE.Vector3[]=[];
  let plants=0,benches=0,features=0;
  // Low garden masses preserve the mapped bed edges; no forest scatter on lawns.
  for(const a of [...surfaces.filter(a=>a.kind==='garden'),...parcels.filter(a=>a.kind==='meadow')]){
    if(due(options.pace))yield;
    const b=greenwayBounds(a.rings),random=seeded(hash(a.id)),step=a.kind==='meadow'?1.7:2.25;
    for(let x=b.minX+1;x<b.maxX;x+=step)for(let z=b.minZ+1;z<b.maxZ;z+=step){
      const px=x+(random()-.5)*1.2,pz=z+(random()-.5)*1.2;if(!owned(px,pz)||!insideGreenwayRings([px,pz],a.rings)||!safe(px,pz)||inGreenwayWalk(px,pz))continue;
      const size=.5+random()*.45,y=h(px,pz),height=a.kind==='meadow'?.45:.36+random()*.4;
      matrix.makeScale(size,height,size).setPosition(px,y+height*.65+.1,pz);batches.part(shrub,mats.leaf,matrix);
      if(random()>.5){matrix.makeScale(size*.5,.12,size*.5).setPosition(px,y+height+.13,pz);batches.part(flower,random()>.45?mats.flower:mats.purple,matrix);}plants++;
    }
  }
  shrub.dispose();flower.dispose();
  const cylinder=new THREE.CylinderGeometry(1,1,1,16),cone=new THREE.ConeGeometry(1,1,32),sphere=new THREE.IcosahedronGeometry(1,1);
  const scaled=(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{matrix.makeScale(sx,sy,sz).setPosition(x,y,z);batches.part(geometry,material,matrix);};
  const ribbon=(points:Point2[],width:number,material:THREE.Material,y=.14)=>drapedRibbonInto(batches.at(material,...points[0]),city,points,width,y);
  // Full feature extents are constructed only in the anchor's owning tile;
  // terrain surfaces above are clipped per tile. This prevents duplicate props.
  for(const obj of greenway.objects){
    const [x,z]=obj.point;if(!owned(x,z))continue;if(due(options.pace))yield;
    const y=h(x,z),yaw=obj.yaw??0;
    if(obj.kind==='tree'){
      if(safe(x,z)&&!greenway.objects.some(o=>['labyrinth','rings','carousel'].includes(o.kind)&&Math.hypot(x-o.point[0],z-o.point[1])<(o.radius??0)+1))trees.push(new THREE.Vector3(x,y+.08,z));continue;
    }
    if(obj.kind==='bench'){
      if(!safe(x,z))continue;
      for(let slat=0;slat<4;slat++)part(box(1.8,.065,.1),mats.wood,x+Math.sin(yaw)*(slat-1.5)*.12,y+.48,z+Math.cos(yaw)*(slat-1.5)*.12,yaw);
      part(box(1.8,.33,.065),mats.wood,x+Math.sin(yaw)*.22,y+.77,z+Math.cos(yaw)*.22,yaw);
      for(const s of [-1,1])part(box(.07,.46,.5),mats.iron,x+Math.cos(yaw)*.64*s,y+.25,z-Math.sin(yaw)*.64*s,yaw);benches++;continue;
    }
    features++;
    if(obj.kind==='rings'){
      surface(obj.rings!,mats.darkStone,.13,false);
      for(const radius of [2.4,4.8,7.2,9.4]){
        ribbon([...circle(x,z,radius),circle(x,z,radius)[0]],.15,mats.stone,.145);
        const n=Math.round(radius*2.5);for(let i=0;i<n;i++){const angle=i/n*Math.PI*2,px=x+Math.cos(angle)*radius,pz=z+Math.sin(angle)*radius;
          scaled(cylinder,mats.water,px,h(px,pz)+.33+(i%3)*.1,pz,.035,.38+(i%3)*.2,.035);}
      }
    }else if(obj.kind==='labyrinth'){
      surface(obj.rings!,mats.lawn,.12,false);
      // Seven concentric circuits with alternating entrances: a visual reading
      // of the granite walking labyrinth, not a surveyed maze topology.
      for(let j=0;j<7;j++){const r=2+j*1.35,start=j%2?.17:Math.PI+.17,arc=Array.from({length:91},(_,i):Point2=>[x+Math.cos(start+i/90*(Math.PI*2-.34))*r,z+Math.sin(start+i/90*(Math.PI*2-.34))*r]);ribbon(arc,.48,mats.stone,.145);}
      scaled(cylinder,mats.stone,x,y+.15,z,.9,.15,.9);scaled(cylinder,mats.water,x,y+.43,z,.08,.55,.08);
    }else if(obj.kind==='sculpture'){
      // The OSM fountain node pins the reflecting pool more precisely than the
      // visitor-map label. Its sculpture is an original faceted approximation.
      const sx=x,sz=z,sy=y;
      scaled(cylinder,mats.darkStone,sx,sy+.18,sz,2.6,.24,2.6);scaled(cylinder,mats.water,sx,sy+.31,sz,2.4,.035,2.4);
      const poly=new THREE.DodecahedronGeometry(1.25,0);for(const sign of [-1,1]){matrix.makeRotationZ(sign*.6).setPosition(sx+sign*.58,sy+1.55,sz);batches.part(poly,mats.steel,matrix);}poly.dispose();
    }else if(obj.kind==='carousel'){
      const r=obj.radius??6.6;scaled(cylinder,mats.stone,x,y+.18,z,r,.3,r);scaled(cylinder,mats.wood,x,y+.42,z,r-.5,.2,r-.5);
      scaled(cone,mats.white,x,y+4.7,z,r+1,2.1,r+1);scaled(cylinder,mats.teal,x,y+3.7,z,r+1,.3,r+1);
      for(let i=0;i<12;i++){const a=i/12*Math.PI*2,px=x+Math.cos(a)*(r-.4),pz=z+Math.sin(a)*(r-.4);scaled(cylinder,mats.iron,px,y+2.1,pz,.06,3.5,.06);
        scaled(sphere,i%2?mats.teal:mats.white,x+Math.cos(a)*(r-1.7),y+1.1,z+Math.sin(a)*(r-1.7),.42,.38,.8);}
      scaled(cone,mats.teal,x,y+6,z,.55,1.1,.55);
    }else if(obj.kind==='canal'){
      const points=obj.points!;ribbon(points,2.1,mats.stone,.14);ribbon(points,1.4,mats.water,.155);
      // The North End's long steel pergolas frame the Cross Street promenade.
      const [a,b]=obj.pergola!,length=Math.hypot(b[0]-a[0],b[1]-a[1]),ux=(b[0]-a[0])/length,uz=(b[1]-a[1])/length,angle=Math.atan2(-uz,ux),steps=Math.ceil(length/6);
      for(let j=0;j<=steps;j++){const d=length*j/steps,px=a[0]+ux*d,pz=a[1]+uz*d;if(!safe(px,pz))continue;
        for(const side of [-1,1])part(box(.16,3.3,.16),mats.iron,px-uz*side*2,h(px,pz)+1.72,pz+ux*side*2);
        part(box(.2,.23,5),mats.iron,px,h(px,pz)+3.4,pz,angle);
      }
      for(let d=0;d<length;d+=1.2){const px=a[0]+ux*d,pz=a[1]+uz*d;if(!safe(px,pz))continue;part(box(.1,.1,4.9),mats.iron,px,h(px,pz)+3.58,pz,angle);}
      for(const side of [-1,1]){
        const px=(a[0]+b[0])/2-uz*side*2,pz=(a[1]+b[1])/2+ux*side*2;
        part(box(length,.18,.16),mats.iron,px,h(px,pz)+3.48,pz,angle);
      }
    }else if(obj.kind==='stream'){
      const points:Point2[]=Array.from({length:33},(_,i):Point2=>{const t=i/32;return[x+Math.sin(t*5)*2.8+(t-.5)*15,z+(t-.5)*38];}).filter(p=>safe(...p));
      if(points.length>1){ribbon(points,2.4,mats.darkStone,.135);ribbon(points,1.65,mats.water,.15);}
      for(let i=0;i<19;i++){const px=x-8+(i%4)*.7,pz=z-13+i*1.3;if(!safe(px,pz))continue;part(box(.075,3.2+(i%3)*.3,.075),mats.leaf,px,h(px,pz)+1.7,pz);}
    }else if(obj.kind==='fog'){
      for(let i=0;i<3;i++){const px=x+i*2,pz=z+i*.6;scaled(cylinder,mats.steel,px,h(px,pz)+1.4,pz,.2,2.7,.2);}
    }
  }
  cylinder.dispose();cone.dispose();sphere.dispose();
  if(trees.length){if(options.treeField)options.treeField.add(options.owner??'greenway',trees);else group.add(createStreetTrees(trees,{scale:1.4,grates:false}));}
  for(const mesh of batches.meshes()){mesh.name='Greenway landscape details';mesh.receiveShadow=true;mesh.castShadow=![mats.lawn,mats.path,mats.paving,mats.garden,mats.meadow,mats.water].includes(mesh.material as THREE.MeshStandardMaterial);group.add(mesh);}
  group.userData={parcels:parcels.length,surfaces:surfaces.length,trees:trees.length,plants,benches,features,source:'OpenStreetMap and Rose Kennedy Greenway Conservancy',accuracy:'Mapped landscape with interpretive planting and landmark models'};
  return group;
}
