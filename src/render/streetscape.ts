import * as THREE from 'three';
import { PartBatches, box, type Part } from './geometry-writer';
import { drain, due } from './pacing';
import type { CityData } from '../types';
import { closestRoad } from '../simulation/roads';
import { hash, seeded } from './materials';
import { sourceWallSampler, type DetailOptions } from './facade-details';
import { architectureFor } from './neighborhood-profiles';
import { isFenwayBuilding } from './fenway-park';
import { storefrontStreet } from './street-character';

let shopResources:{trim:THREE.Material;sill:THREE.Material;frame:THREE.Material;bronze:THREE.Material;glass:THREE.Material;interiors:THREE.Material[];warm:THREE.Material;awnings:THREE.Material[];labels:string[];signs:THREE.Material[]}|undefined;
function shopMaterials(){
  if(shopResources)return shopResources;
  const labels = ['BOOKS', 'CAFE', 'MARKET', 'ATELIER', 'RECORDS', 'FLOWERS'];
  const signs = labels.map((label, i) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = ['#263f34', '#293947', '#563b36'][i % 3]; ctx.fillRect(0,0,512,96);
    ctx.strokeStyle = '#bdb28e'; ctx.lineWidth = 2; ctx.strokeRect(6,6,500,84);
    ctx.fillStyle = '#ede5c9'; ctx.font = '500 45px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label,256,50);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ map: texture, roughness: .8 });
  });
  shopResources={
    trim:new THREE.MeshStandardMaterial({ color: '#cabd9f', roughness: .87 }),sill:new THREE.MeshStandardMaterial({ color: '#91897a', roughness: .96 }),
    frame:new THREE.MeshStandardMaterial({ color: '#263c34', roughness: .6, metalness: .15 }),bronze:new THREE.MeshStandardMaterial({ color: '#988467', roughness: .52, metalness: .5 }),
    glass:new THREE.MeshPhysicalMaterial({ color: '#a9bec0', roughness: .17, metalness: .08, transparent: true, opacity: .21, depthWrite: false, clearcoat: .7, clearcoatRoughness: .15 }),
    interiors:[0,1,2].map(style => shopInterior(style)),warm:new THREE.MeshStandardMaterial({ color: '#b9a279', roughness: .8, emissive: '#b79455', emissiveIntensity: .12 }),
    awnings:['#25483b', '#303f50', '#743e3b'].map(color => new THREE.MeshStandardMaterial({ color, roughness: .98, side: THREE.DoubleSide })),labels,signs,
  };
  return shopResources;
}

/** Interpretive Back Bay storefronts. The shop names are fictional generic labels.
 * Candidate street-facing hull edges are checked against the actual loaded mesh;
 * recessed/gapped boundaries are skipped rather than covering them with a fake wall.
 */
export function addStreetscape(scene: THREE.Scene, city: CityData, options: DetailOptions = {}): THREE.Group { return drain(streetscapeSteps(scene, city, options)); }
export function* streetscapeSteps(scene: THREE.Scene, city: CityData, options: DetailOptions = {}): Generator<void, THREE.Group> {
  const group = new THREE.Group(); group.name = 'Boston storefronts';
  const batches = new PartBatches(), pace = options.pace;
  const {trim,sill,frame,bronze,glass,interiors,warm,awnings,labels,signs}=shopMaterials();
  const budget=options.budget??650;
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const unit = new THREE.Vector3(1,1,1), position = new THREE.Vector3(), euler = new THREE.Euler();
  function add(geo: Part, material: THREE.Material, x:number,y:number,z:number,yaw:number,rx=0) {
    q.setFromEuler(euler.set(rx,yaw,0,'YXZ'));
    matrix.compose(position.set(x,y,z),q,unit);batches.part(geo,material,matrix);
  }

  // Reuse the spatial wall index: probes touch only nearby triangles.
  const sampler=options.sampler??sourceWallSampler(scene),startSamples=sampler.samples;
  const used = new Set<string>();
  let count=0;const areaCount=new Map<string,number>();
  for (const building of [...(options.buildings??city.buildings)].sort((a,b)=>hash(a.id)-hash(b.id))) {
    if(due(pace))yield;
    if(architectureFor(building)||isFenwayBuilding(building))continue;
    if (building.landmark || building.height<7 || building.height>75) continue;
    const base=building.baseElevation??0,area=`${Math.floor(building.center[0]/320)},${Math.floor(building.center[1]/320)}`;
    const random=seeded(hash(building.id));
    const points=building.footprint;
    for(let e=0;e<points.length;e++) {
      const a=points[e],b=points[(e+1)%points.length];
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      if(length<8)continue;
      const nx=dz/length,nz=-dx/length,yaw=Math.atan2(nx,nz);
      for(let d=4.4;d<length-4.0;d+=7.4+random()*1.8) {
        if(count>=budget||(areaCount.get(area)??0)>=16)break;
        const x=a[0]+dx*d/length,z=a[1]+dz*d/length;
        const road=closestRoad(city,x,z,true);
        if(!storefrontStreet(road.road.name,road.road.width,road.road.kind))continue;
        // Respect setbacks, street orientation, and cross-street corners.
        if(road.distance<road.road.width/2+1.5 || road.distance>road.road.width/2+15)continue;
        if(((road.x-x)*nx+(road.z-z)*nz)/road.distance<.8)continue;
        if(Math.abs(Math.sin(road.yaw)*dx/length+Math.cos(road.yaw)*dz/length)<.86)continue;
        if(road.road.points.some((p,i)=> (i===0||i===road.road.points.length-1) && Math.hypot(p[0]-x,p[1]-z)<12))continue;
        const key=`${Math.round(x/5)},${Math.round(z/5)}`;if(used.has(key))continue;
        // Verify the middle and both ends of a storefront against source wall triangles.
        const checks=[-2.5,0,2.5];let valid=true;
        for(const offset of checks) {
          const sx=x+Math.cos(yaw)*offset,sz=z-Math.sin(yaw)*offset;
          const hit=sampler.sample(sx,sz,nx,nz,base+2.1);
          if(!hit || Math.abs(hit.depth)>.28){valid=false;break;}
        }
        if(!valid)continue;
        used.add(key);count++;areaCount.set(area,(areaCount.get(area)??0)+1);
        const width=5.7+random()*.45;
        const draw=(geo:Part,mat:THREE.Material,xx:number,yy:number,depth=.1,rx=0)=>add(geo,mat,x+Math.cos(yaw)*xx+nx*depth,base+yy,z-Math.sin(yaw)*xx+nz*depth,yaw,rx);
        // Ground floor: masonry base, display glazing, inset door and narrow frames.
        draw(box(width,.62,.22),sill,0,.32,.13);
        const interior=interiors[count%interiors.length];
        draw(box(width,3.4,.12),frame,0,2.0,.075);
        draw(new THREE.PlaneGeometry(width-1.65,2.5),interior,-.66,1.92,.145);
        draw(new THREE.PlaneGeometry(width-1.65,2.5),glass,-.66,1.92,.43);
        draw(new THREE.PlaneGeometry(1.05,2.65),interior,width/2-.69,1.86,.15);
        draw(new THREE.PlaneGeometry(1.05,2.65),glass,width/2-.69,1.86,.43);
        for(const xx of [-width/2+.12,width/2-1.32,width/2-.1])draw(box(.16,3.0,.46),trim,xx,1.8,.28);
        draw(box(width,.19,.55),trim,0,3.48,.31);
        draw(box(width,.16,.28),trim,0,.65,.23);
        draw(box(.075,2.5,.16),bronze,-.66,1.92,.46);
        draw(box(width-1.65,.08,.16),bronze,-.66,2.6,.46);
        draw(box(.055,.45,.12),bronze,width/2-1.05,1.42,.55);
        // Actual shelf/counter layers sit behind the glazing, giving parallax
        // and framed shadows as the player passes the storefront.
        draw(box(width-1.82,.34,.15),warm,-.66,.97,.27);
        draw(box(width-1.77,.055,.2),bronze,-.66,1.17,.29);
        for(let j=0;j<4;j++)draw(box(.27+random()*.23,.24+random()*.34,.08),warm,-width/2+.62+j*.88,1.35,.25);
        const label=Math.floor(random()*labels.length);
        draw(box(width,.68,.22),frame,0,3.94,.19);
        draw(new THREE.PlaneGeometry(width-.22,.56),signs[label],0,3.94,.315);
        if(random()<.48) {
          const material=awnings[Math.floor(random()*awnings.length)];
          // A restrained fabric canopy above the display window, clear of the curb.
          draw(box(width+.15,.075,1.5),material,0,3.43,.82,.19);
          draw(box(width+.15,.27,.075),material,0,3.16,1.55);
          draw(box(width+.2,.07,.07),bronze,0,3.58,.16);
          for(const side of [-1,1])draw(box(.045,.045,1.45),bronze,side*(width/2-.12),3.37,.83,.19);
        }
      }
    }
  }
  for(const mesh of batches.meshes()){mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
  group.userData.storefrontCount=count;
  group.userData.drawCalls=group.children.length;
  group.userData.wallProbes=sampler.samples-startSamples;
  group.userData.provenance='Original fictional shop art, located on road-facing source mesh walls';
  (options.target??scene).add(group);return group;
}

/** Perspective room artwork is original procedural drawing, not a real shop photo. */
function shopInterior(style:number):THREE.MeshStandardMaterial {
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=512;
  const c=canvas.getContext('2d')!,random=seeded(781+style*17);
  const bg=c.createLinearGradient(0,0,768,512);bg.addColorStop(0,'#514f43');bg.addColorStop(1,'#1d2827');c.fillStyle=bg;c.fillRect(0,0,768,512);
  c.fillStyle='#655c48';c.beginPath();c.moveTo(0,0);c.lineTo(768,0);c.lineTo(622,106);c.lineTo(146,106);c.closePath();c.fill();
  c.fillStyle='#776652';c.beginPath();c.moveTo(0,512);c.lineTo(768,512);c.lineTo(622,376);c.lineTo(146,376);c.closePath();c.fill();
  c.strokeStyle='#252e2a';c.lineWidth=2;
  for(let i=0;i<10;i++){c.beginPath();c.moveTo(384+(i-4.5)*90,512);c.lineTo(384+(i-4.5)*55,376);c.stroke();}
  c.fillStyle='#2a342d';c.fillRect(145,105,478,272);
  for(let shelf=0;shelf<3;shelf++){
    const y=165+shelf*72;
    c.fillStyle='#897055';c.fillRect(164,y+37,437,10);
    for(let i=0;i<22;i++){
      const x=170+i*19,hi=15+random()*21;
      c.fillStyle=['#a78b5f','#aeb5a0','#70534a','#536d66','#c6ac78'][Math.floor(random()*5)];
      if(style===1){c.beginPath();c.ellipse(x+6,y+30,6,9,0,0,Math.PI*2);c.fill();}
      else c.fillRect(x,y+37-hi,9+random()*6,hi);
    }
  }
  c.fillStyle='#3c3730';c.fillRect(100,366,568,95);c.fillStyle='#9b7f56';c.fillRect(94,361,580,13);
  for(const x of [244,524]){
    c.strokeStyle='#292d29';c.lineWidth=5;c.beginPath();c.moveTo(x,40);c.lineTo(x,119);c.stroke();
    c.fillStyle='#d2b77c';c.beginPath();c.moveTo(x-32,136);c.lineTo(x-13,113);c.lineTo(x+13,113);c.lineTo(x+32,136);c.closePath();c.fill();
    const glow=c.createRadialGradient(x,141,1,x,141,90);glow.addColorStop(0,'#f3cb7d3d');glow.addColorStop(1,'#f3cb7d00');c.fillStyle=glow;c.fillRect(x-90,75,180,180);
  }
  // The outer edges recede into darkness behind the projecting stone reveals.
  const shade=c.createLinearGradient(0,0,768,0);shade.addColorStop(0,'#101817b8');shade.addColorStop(.15,'#10181700');shade.addColorStop(.85,'#10181700');shade.addColorStop(1,'#101817b8');c.fillStyle=shade;c.fillRect(0,0,768,512);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;
  return new THREE.MeshStandardMaterial({map,roughness:.86,emissiveMap:map,emissive:0xffffff,emissiveIntensity:.11});
}
