import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityData, Point2 } from '../types';
import { closestRoad, pointInside } from '../simulation/roads';
import { canvasTexture, seeded } from './materials';
import { createStreetTrees } from './foliage';
import { sampleElevation } from '../simulation/terrain';

/** Original interpretation of the illustrative plan on Boston's current project
 * page: https://www.boston.gov/departments/parks-and-recreation/project/copley-square-park-improvements
 * Reviewed 2026-10-26: raised grove, fountain-side groves, diagonal circulation,
 * plaza and Trinity-side lawn. These are approximate landscape forms, not a
 * surveyed as-built model. No plan imagery is distributed or used as a texture.
 */
export function addParkDetails(scene:THREE.Scene,city:CityData) {
  const group=new THREE.Group();group.name='Copley Square landscape';
  // Actual centerline intersection and Boylston tangent define the rotated grid.
  const ox=-206.404,oz=3,ux=.937299711562161,uz=-.34852439040257976,vx=-uz,vz=ux;
  const angle=Math.atan2(-uz,ux);
  const world=(u:number,v:number,y=0)=>new THREE.Vector3(ox+ux*u+vx*v,y+sampleElevation(city,ox+ux*u+vx*v,oz+uz*u+vz*v),oz+uz*u+vz*v);
  const safe=(u:number,v:number,clearance=1.3)=>{
    const p=world(u,v),road=closestRoad(city,p.x,p.z,true);
    return road.distance>road.road.width/2+clearance&&!city.buildings.some(b=>pointInside([p.x,p.z],b.footprint));
  };
  const stone=new THREE.MeshStandardMaterial({color:'#bbb5a7',roughness:.92});
  const darkStone=new THREE.MeshStandardMaterial({color:'#777d76',roughness:.86});
  const wood=new THREE.MeshStandardMaterial({color:'#957b56',roughness:.86});
  const iron=new THREE.MeshStandardMaterial({color:'#343d39',roughness:.7,metalness:.3});
  const soil=new THREE.MeshStandardMaterial({color:'#554c37',roughness:1});
  const grass=new THREE.MeshStandardMaterial({map:groundTexture('grass'),color:'#aeb784',roughness:1});
  const paving=new THREE.MeshStandardMaterial({map:groundTexture('paving'),color:'#d8cbb2',roughness:.94});
  const water=new THREE.MeshPhysicalMaterial({color:'#6f9994',roughness:.15,metalness:.13,transparent:true,opacity:.87,clearcoat:1,clearcoatRoughness:.12});
  const jetMaterial=new THREE.MeshStandardMaterial({color:'#d9efea',roughness:.18,metalness:.1,transparent:true,opacity:.7,depthWrite:false});
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),one=new THREE.Vector3(1,1,1);
  function add(g:THREE.BufferGeometry,m:THREE.Material,u:number,y:number,v:number,localAngle=0){
    q.setFromAxisAngle(new THREE.Vector3(0,1,0),angle+localAngle);matrix.compose(world(u,v,y),q,one);g.applyMatrix4(matrix);
    const list=batches.get(m)??[];list.push(g);batches.set(m,list);
  }
  function polygon(points:Point2[],y:number,material:THREE.Material){
    const shape=new THREE.Shape(points.map(([u,v])=>new THREE.Vector2(u,v)));
    const g=new THREE.ShapeGeometry(shape),p=g.getAttribute('position'),uv=g.getAttribute('uv');
    for(let i=0;i<p.count;i++){
      const u=p.getX(i),v=p.getY(i),point=world(u,v,y);p.setXYZ(i,point.x,point.y,point.z);uv.setXY(i,u/4,v/4);
    }
    const index=g.index!;for(let i=0;i<index.count;i+=3){const b=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,b);}
    g.computeVertexNormals();const list=batches.get(material)??[];list.push(g);batches.set(material,list);
  }
  function edge(a:Point2,b:Point2,width:number,height:number,y:number,material:THREE.Material){
    const du=b[0]-a[0],dv=b[1]-a[1],length=Math.hypot(du,dv);
    add(new THREE.BoxGeometry(length,height,width),material,(a[0]+b[0])/2,y,(a[1]+b[1])/2,Math.atan2(-dv,du));
  }
  function border(points:Point2[],width:number,height:number,y:number,material:THREE.Material){
    for(let i=0;i<points.length;i++)edge(points[i],points[(i+1)%points.length],width,height,y,material);
  }
  // Open circulation and event space remain dominant, as in the published plan.
  const plaza:Point2[]=[[12,17],[34,17],[71,48],[102,48],[102,79],[65,81],[20,84],[12,75]];
  polygon(plaza,.065,paving);
  const lawn:Point2[]=[[69,53],[99,51],[99,80],[64,74]];
  polygon(lawn,.105,grass);border(lawn,.34,.17,.1,stone);
  const smallLawns:Point2[][]=[[[13,66],[22,66],[25,75],[16,79]],[[62,41],[73,48],[62,53]],[[122,16],[140,15],[142,20],[126,25]],[[149,13],[171,10],[173,13],[153,23]]];
  for(const patch of smallLawns){polygon(patch,.105,grass);border(patch,.25,.12,.1,stone);}

  // Broad raised grove with stone sitting edges; the low elevation is visual
  // interpretation of the plan's tree-protection platform.
  const grove:Point2[]=[[19,29],[35,20],[67,39],[64,49],[25,42]];
  polygon(grove,.48,paving);border(grove,.68,.48,.27,darkStone);border(grove,.84,.12,.53,stone);
  const groveBeds:Point2[][]=[[[23,29],[35,23],[39,26],[27,35]],[[38,31],[43,29],[50,34],[48,39]],[[52,37],[61,40],[60,46],[51,43]]];
  for(const patch of groveBeds){polygon(patch,.50,soil);border(patch,.16,.12,.52,darkStone);}
  // Fountain-side groves are intentionally separate from the raised grove.
  const northGroves:Point2[][]=[[[46,15],[72,15],[70,30],[62,29]],[[105,15],[118,15],[126,25],[112,34],[106,31]]];
  for(const patch of northGroves){polygon(patch,.11,grass);border(patch,.3,.17,.11,stone);}
  // Explicit diagonal walkway preserves the established pedestrian route.
  edge([24,77],[171,13],4.3,.035,.145,paving);
  edge([18,23],[84,57],3.8,.035,.145,paving);

  // Renovated fountain interpreted as a low, angular granite basin with a row
  // of modest jets. Its rim and seating are kept away from Boylston's travel lane.
  const basin:Point2[]=[[77,24],[101,24],[103,28],[99,33],[82,33],[77,30]];
  const waterOutline:Point2[]=[[77.7,24.7],[100.5,24.7],[102.1,28],[98.6,32.3],[82.3,32.3],[77.7,29.6]];
  polygon(basin,.28,darkStone);border(basin,.65,.42,.26,stone);polygon(waterOutline,.405,water);
  for(let i=0;i<3;i++)add(new THREE.BoxGeometry(19-i*1.4,.19,1.6),darkStone,89,.12+i*.17,23-i*1.5);
  for(let i=0;i<3;i++)edge([79+i*.7,22.2-i*1.5],[99-i*.7,22.2-i*1.5],.25,.16,.22+i*.17,stone);

  let benches=0;
  const bench=(u:number,v:number,yaw=0,elevation=0,length=3.3)=>{
    if(!safe(u,v,2))return;benches++;
    const c=Math.cos(yaw),s=Math.sin(yaw);
    const part=(g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number)=>add(g,m,u+c*x+s*z,y+elevation,v-s*x+c*z,yaw);
    for(let j=0;j<5;j++)part(new THREE.BoxGeometry(length,.065,.095),wood,0,.48,-.24+j*.115);
    for(const x of [-length*.36,length*.36]){
      part(new THREE.BoxGeometry(.07,.42,.48),iron,x,.23,0);
      part(new THREE.BoxGeometry(.065,.54,.065),iron,x,.65,.26);
      part(new THREE.BoxGeometry(.065,.06,.54),iron,x,.72,0);
    }
    for(let j=0;j<3;j++)part(new THREE.BoxGeometry(length,.11,.065),wood,0,.72+j*.14,.29);
  };
  for(const u of [29,37,45,53])bench(u,42+(u-25)*7/39-.6,-.178,.52);
  for(const u of [52,61,69])bench(u,13.5,Math.PI);
  for(const u of [108,117,129])bench(u,13.5,Math.PI);
  for(const u of [78,87,96])bench(u,35.5);
  for(const u of [37,45,53,61,75,84,93])bench(u,83,Math.PI);
  bench(21,56,Math.PI/2);bench(21,62,Math.PI/2);

  const trees:THREE.Vector3[]=[];
  const tree=(u:number,v:number,h=0)=>{if(safe(u,v,3))trees.push(world(u,v,h));};
  for(const [u,v] of [[26,29],[34,25],[37,33],[46,34],[52,40],[59,43],[29,37]])tree(u,v,.5);
  for(const [u,v] of [[50,17],[59,18],[67,20],[108,19],[117,21],[126,19],[138,17],[153,17],[163,13],[39,80],[49,80],[59,81],[73,83],[83,84],[93,84]])tree(u,v,.05);
  const treeGroup=createStreetTrees(trees);treeGroup.name='Copley grove trees';group.add(treeGroup);

  for(const [material,geometries] of batches){
    const normalized=geometries.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(normalized,false);
    if(geometry){geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=material!==water;mesh.receiveShadow=true;group.add(mesh);}
    new Set([...geometries,...normalized]).forEach(g=>g.dispose());
  }
  const jets=new THREE.InstancedMesh(new THREE.CylinderGeometry(.035,.052,1,7),jetMaterial,11);
  const droplets=new THREE.InstancedMesh(new THREE.SphereGeometry(.045,5,4),jetMaterial,44);
  jets.name='Copley fountain jets';droplets.name='Copley fountain droplets';jets.userData.noAO=true;droplets.userData.noAO=true;
  group.add(jets,droplets);const dummy=new THREE.Object3D();
  function update(time:number){
    for(let i=0;i<11;i++){
      const height=.6+.25*Math.sin(time*1.7+i*.55),u=79.7+i*1.89,v=25.8;
      dummy.position.copy(world(u,v,.41+height/2));dummy.rotation.set(0,0,0);dummy.scale.set(1,height,1);dummy.updateMatrix();jets.setMatrixAt(i,dummy.matrix);
      for(let j=0;j<4;j++){
        const t=(time*.66+j*.25+i*.09)%1;
        dummy.position.copy(world(u+.16*Math.sin(i*2.1+j*1.7)*t,v+.65*t,.42+height*4*t*(1-t)));
        dummy.scale.setScalar(.65+.4*t);dummy.updateMatrix();droplets.setMatrixAt(i*4+j,dummy.matrix);
      }
    }
    jets.instanceMatrix.needsUpdate=true;droplets.instanceMatrix.needsUpdate=true;
  }
  update(0);group.userData={trees:trees.length,benches,drawCalls:group.children.length-1+treeGroup.children.length,source:'Boston Parks current illustrative Copley Square plan',accuracy:'Approximate original landscaping; not measured as-built geometry'};
  scene.add(group);return {group,update};
}

function groundTexture(kind:'grass'|'paving'){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const c=canvas.getContext('2d')!,random=seeded(kind==='grass'?780:129);
  if(kind==='grass'){
    c.fillStyle='#69794b';c.fillRect(0,0,512,512);
    for(let i=0;i<19000;i++){
      const x=random()*512,y=random()*512;
      c.strokeStyle=`hsla(${72+random()*19},${19+random()*20}%,${28+random()*25}%,.45)`;
      c.lineWidth=.65+random()*.8;c.beginPath();c.moveTo(x,y);c.lineTo(x-1+random()*2,y-2-random()*5);c.stroke();
    }
  }else{
    c.fillStyle='#bdb8a9';c.fillRect(0,0,512,512);
    for(let row=0;row<8;row++)for(let col=-1;col<5;col++){
      const x=col*128+(row%2)*64,v=167+Math.floor(random()*25);
      c.fillStyle=`rgb(${v+12},${v+8},${v})`;c.fillRect(x+1,row*64+1,126,62);
    }
    for(let i=0;i<16000;i++){
      const v=random()>.5?255:60;c.fillStyle=`rgba(${v},${v},${v},.08)`;c.fillRect(random()*512,random()*512,1,1);
    }
  }
  const texture=canvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;return texture;
}
