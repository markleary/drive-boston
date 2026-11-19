import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {CityData} from '../types';
import {lowClearanceCrossings,longfellowPortalLayout,type LowClearanceCrossing} from '../simulation/low-clearance.ts';
import {clearRoadside,inLanes,roadsidePoint} from '../simulation/highway-signs.ts';
import {sampleRoadElevation} from '../simulation/road-surfaces.ts';
import {sampleElevation} from '../simulation/terrain.ts';

/** Signs are based on the same soffits that truck contacts use. The Boston
 * Longfellow portal follows the user's reference: riveted open-spandrel steel,
 * block granite abutments, ornamental railing, and a yellow clearance diamond. */
export function addLowClearanceDetails(scene:THREE.Object3D,city:CityData,mobile=false){
  const group=new THREE.Group();group.name='Parkway low clearance bridges';
  const collisions:{id:string;vertices:Float32Array;indices:Uint32Array}[]=[];
  const steel=new THREE.MeshStandardMaterial({color:'#53645b',metalness:.62,roughness:.62});
  const flange=new THREE.MeshStandardMaterial({color:'#737b66',metalness:.5,roughness:.68});
  const stone=new THREE.MeshStandardMaterial({color:'#b1aaa0',roughness:.95});
  const trim=new THREE.MeshStandardMaterial({color:'#c5beb0',roughness:.92});
  const joint=new THREE.MeshStandardMaterial({color:'#817d73',roughness:1});
  const rust=new THREE.MeshStandardMaterial({color:'#805139',metalness:.15,roughness:1});
  const rear=new THREE.MeshStandardMaterial({color:'#777d76',metalness:.6,roughness:.66});
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>(),faces=new Map<string,THREE.Material>();
  const sites=lowClearanceCrossings(city);
  const add=(geometry:THREE.BufferGeometry,material:THREE.Material,solid=false,id='clearance-detail')=>{
    const list=batches.get(material)??[];list.push(geometry);batches.set(material,list);
    if(solid){const p=geometry.getAttribute('position');collisions.push({id,vertices:new Float32Array(p.array),indices:geometry.index?new Uint32Array(geometry.index.array):Uint32Array.from({length:p.count},(_,i)=>i)});}
  };
  const box=(w:number,h:number,d:number,x:number,y:number,z:number,yaw:number,m:THREE.Material,solid=false,id?:string)=>add(new THREE.BoxGeometry(w,h,d).rotateY(yaw).translate(x,y,z),m,solid,id);
  function face(text:string,diamond:boolean){
    const key=`${diamond}:${text}`,old=faces.get(key);if(old)return old;
    if(typeof document==='undefined'){const m=new THREE.MeshBasicMaterial({color:'#efbc33'});faces.set(key,m);return m;}
    const w=diamond?512:1024,h=diamond?512:160,scale=mobile ? .5 : 1;
    const c=document.createElement('canvas');c.width=w*scale;c.height=h*scale;const ctx=c.getContext('2d')!;ctx.scale(scale,scale);
    ctx.fillStyle='#f0bf36';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#201e17';ctx.lineWidth=diamond?14:9;
    if(diamond){
      ctx.clearRect(0,0,512,512);ctx.beginPath();ctx.moveTo(256,9);ctx.lineTo(503,256);ctx.lineTo(256,503);ctx.lineTo(9,256);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle='#191b15';for(const reverse of [false,true]){ctx.save();ctx.translate(256,reverse?426:86);if(reverse)ctx.rotate(Math.PI);ctx.beginPath();ctx.moveTo(0,-37);ctx.lineTo(-43,7);ctx.lineTo(-16,7);ctx.lineTo(-16,40);ctx.lineTo(16,40);ctx.lineTo(16,7);ctx.lineTo(43,7);ctx.closePath();ctx.fill();ctx.restore();}
      ctx.font='bold 106px Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,266,352);
    }else{
      ctx.strokeRect(10,10,w-20,h-20);ctx.fillStyle='#1c1e17';ctx.font='bold 79px Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(`CLEARANCE  ${text}`,512,85,970);
    }
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
    const material=new THREE.MeshBasicMaterial({map,transparent:diamond,alphaTest:diamond?.5:0,toneMapped:false});faces.set(key,material);return material;
  }
  function panel(site:LowClearanceCrossing,x:number,y:number,z:number,yaw:number,diamond:boolean){
    const width=diamond?1.7:4,height=diamond?1.7:.625;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),face(site.posted,diamond));mesh.position.set(x,y,z);mesh.rotation.y=yaw;
    mesh.name=`${site.name}: ${site.posted} ${diamond?'advance warning':'bridge clearance board'}`;mesh.userData.clearanceId=site.id;group.add(mesh);
    // Square backing is rotated for the diamond; its corners remain inside the face.
    const back=new THREE.BoxGeometry(diamond?1.16:width,diamond?1.16:height,.045);if(diamond)back.rotateZ(Math.PI/4);back.rotateY(yaw);back.translate(x-Math.sin(yaw)*.03,y,z-Math.cos(yaw)*.03);add(back,rear);
  }
  for(const site of sites){
    const road=city.roads.find(r=>r.id===site.roadId)!;
    // Signs on each legal approach; a two-way source road warns both directions.
    for(const direction of road.oneway===0?[-1,1]:[road.oneway<0?-1:1]){
      const yaw=site.yaw+(direction<0?Math.PI:0),dx=Math.sin(yaw),dz=Math.cos(yaw),distance=site.halfDepth+24;
      const x=site.x-dx*distance,z=site.z-dz*distance,y=sampleRoadElevation(city,road,x,z),near=city.roads.filter(r=>r.points.some(p=>Math.hypot(p[0]-x,p[1]-z)<70));
      const approach=clearRoadside({x,y,z,yaw,width:site.width,edge:site.width/2},1.35,(px,pz)=>inLanes(city,near,px,pz,y));
      // A crowded interchange can omit an advance post, but never its bridge board.
      if(approach){const p=roadsidePoint(approach,approach.post),ground=sampleElevation(city,p.x,p.z),mid=Math.max(y,ground)+2.7;panel(site,p.x,mid,p.z,yaw+Math.PI,true);box(.075,mid-ground+.4,.075,p.x,(ground+mid+.4)/2,p.z,yaw,rear);}
      const front=site.halfDepth+.4,bx=site.x-dx*front,bz=site.z-dz*front;
      panel(site,bx,site.kind==='longfellow'?sampleRoadElevation(city,road,bx,bz)+site.clearance+.60:site.underside+.36,bz,yaw+Math.PI,false);
    }
    if(site.kind!=='longfellow')continue;
    const sin=Math.sin(site.yaw),cos=Math.cos(site.yaw);
    // The westbound river-side opening also carries the continuous four-meter
    // Paul Dudley White path (OSM150052469), outside the roadway. Its pier
    // belongs beyond that path, not in the space between the path and lanes.
    const {left,right,pierOffset,pierWidth}=longfellowPortalLayout(site),span=left+right;
    const position=(across:number,along:number,y:number)=>new THREE.Vector3(site.x+across*cos+along*sin,y,site.z-across*sin+along*cos);
    const deckRoads=city.roads.filter(r=>['13130-0-0','13131-0-0','8580-0-0','9280-0-0'].includes(r.id));
    const deckAt=(across:number,along:number)=>{const p=position(across,along,0);return deckRoads.length?Math.min(...deckRoads.map(r=>sampleRoadElevation(city,r,p.x,p.z))):site.underside+2;};
    const localBox=(w:number,h:number,d:number,across:number,along:number,y:number,m:THREE.Material,solid=false)=>{const p=position(across,along,y);box(w,h,d,p.x,p.y,p.z,site.yaw,m,solid,site.id);};
    const beam=(a:THREE.Vector3,b:THREE.Vector3,width:number,height:number,m:THREE.Material,solid=false)=>{
      const direction=b.clone().sub(a),g=new THREE.BoxGeometry(width,height,direction.length());g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),direction.normalize()));g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());add(g,m,solid,site.id);
    };
    // Each rib has a continuous collision mesh. Lane-center headroom is only
    // 30 cm above the posted minimum: the 12 ft mover strikes the eastbound
    // steel, while the higher westbound arch keeps its different clearance.
    for(const along of [-site.halfDepth,0,site.halfDepth]){
      const center=position(0,along,0),floor=sampleRoadElevation(city,road,center.x,center.z);
      const soffit=(x:number)=>floor+site.clearance+.30-.30*(x/(site.width/2))**2;
      for(let i=0;i<24;i++){
        const a=-left+span*i/24,b=-left+span*(i+1)/24;
        const p=position(a,along,soffit(a)+.23),q=position(b,along,soffit(b)+.23);
        beam(p,q,.45,.46,steel,true);
        for(const lip of [-.23,.23])beam(position(a,along,soffit(a)+.23+lip),position(b,along,soffit(b)+.23+lip),.62,.065,flange);
        if(i%2===0){const h=Math.max(.1,deckAt(a,along)-.3-soffit(a)-.46);localBox(.12,h,.18,a,along,soffit(a)+.46+h/2,steel);}
        if(i%3===0)for(const side of [-1,1]){const p=position((a+b)/2,along+side*.246,soffit((a+b)/2)+.23);add(new THREE.SphereGeometry(.042,6,4).translate(...p.toArray()),flange);}
      }
      for(let i=0;i<12;i++){const a=-left+span*i/12,b=-left+span*(i+1)/12;beam(position(a,along,deckAt(a,along)-.25),position(b,along,deckAt(b,along)-.25),.42,.33,flange);for(const level of [.36,.95])beam(position(a,along,deckAt(a,along)+level),position(b,along,deckAt(b,along)+level),.075,.065,flange);}
      for(let x=-left;x<=right;x+=.58)localBox(.045,.93,.055,x,along,deckAt(x,along)+.49,steel);
    }
    // Longitudinal floor joists remain above the arch crown and below the
    // existing drivable upper deck; their shadows give the underpass depth.
    for(let across=-left+.7;across<right;across+=1.7)beam(position(across,-site.halfDepth,deckAt(across,-site.halfDepth)-.58),position(across,site.halfDepth,deckAt(across,site.halfDepth)-.58),.16,.3,steel);
    for(const side of [-1,1]){
      const x=side*((side<0?left:right)+pierOffset),p=position(x,0,0),bottom=sampleElevation(city,p.x,p.z)-.3,top=Math.min(...deckRoads.map(r=>sampleRoadElevation(city,r,p.x,p.z)))-1.2,h=Math.max(.5,top-bottom);
      localBox(pierWidth,h,site.halfDepth*2+1.1,x,0,(bottom+top)/2,joint,true);
      for(let y=bottom+.02,course=0;y<top-.15;y+=.62,course++)for(let along=-site.halfDepth-.4;along<site.halfDepth+.4;along+=1.4){
        const shift=course%2?.25:0;for(const faceSide of [-1,1])localBox(.10,Math.min(.59,top-y),1.35,x+faceSide*1.14,Math.min(site.halfDepth-.28,along+shift),y+.295,course%3===0?trim:stone);
      }
      localBox(2.85,.32,site.halfDepth*2+1.6,x,0,top+.08,trim);
      localBox(3.05,.42,site.halfDepth*2+1.75,x,0,bottom+.3,stone);
      for(const along of [-site.halfDepth-.68,site.halfDepth+.68]){localBox(2.45,h-.4,.22,x,along,bottom+h/2,stone);localBox(2.7,.22,.28,x,along,top-.3,trim);}
    }
    // A few restrained rusty joints and drips, not uniform pristine paint.
    for(const along of [-site.halfDepth-.235,site.halfDepth+.235])for(const x of [-left+1.4,-left/2,right*.62])localBox(.12,.30,.012,x,along,deckAt(x,along)-.37,rust);
  }
  for(const [material,parts]of batches){
    const normalized=parts.map(g=>{const n=g.index?g.toNonIndexed():g;n.deleteAttribute('uv');return n;});const geometry=mergeGeometries(normalized,false)!;
    new Set([...parts,...normalized]).forEach(g=>g.dispose());const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  group.userData={crossings:sites.length,longfellowPortals:sites.filter(s=>s.kind==='longfellow').length,clearanceIds:sites.map(s=>s.id),accuracy:'Longfellow east 10 ft 6 in from supplied reference, west 12 ft from OSM; other signs round down modeled slab clearances'};
  scene.add(group);return{group,collisions};
}
