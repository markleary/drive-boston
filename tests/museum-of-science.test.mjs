import assert from 'node:assert/strict';
import test from 'node:test';
import {MUSEUM,MUSEUM_ROLES,museumStatue,museumTurbines} from '../src/simulation/museum-of-science.ts';
import {VIADUCT_TOWER} from '../src/simulation/lechmere-viaduct.ts';
import {drawnStreets} from '../src/simulation/drawn-streets.ts';
import {tileCollisionIndices} from '../src/render/tile-geometry.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

const metro=await loadMetroCity({bounds:{minX:100,maxX:500,minZ:-2090,maxZ:-1790}});
const buildings=new Map([...metro.loadedTiles.values()].flatMap(t=>t.buildings).map(b=>[b.id,b]));
/** Highest surface of a shell under a point, by its packaged triangles. */
function roofAt(id,x,z){
 const data=metro.geometry.get(id),p=data.positions,index=tileCollisionIndices(data);let best=-Infinity;
 for(let i=0;i<index.length;i+=3){
  const [a,b,c]=[index[i],index[i+1],index[i+2]].map(k=>[p[k*3],p[k*3+1],p[k*3+2]]),d=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(d)<1e-9)continue;
  const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/d,v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/d;
  if(u>=0&&v>=0&&u+v<=1)best=Math.max(best,u*a[1]+v*b[1]+(1-u-v)*c[1]);
 }
 return best;
}

test('every shell of the Museum is in the package, with one tower, one planetarium and the garage in Cambridge',()=>{
 for(const id of Object.keys(MUSEUM_ROLES))assert.ok(buildings.has(id),id);
 assert.equal(Object.keys(MUSEUM_ROLES).length,15);assert.equal(Object.values(MUSEUM_ROLES).filter(r=>r==='tower').length,1);
 assert.ok(buildings.get('CAM_BACB6-957MC-WMSBN').name==='Museum of Science');
});

test('the tower crown stands on the surveyed shaft and its lettering on real walls',()=>{
 const tower=buildings.get(MUSEUM.tower.id);assert.ok(Math.abs(tower.baseElevation+tower.height-MUSEUM.tower.top)<.05);
 assert.deepEqual(tower.footprint.map(p=>p.map(v=>+v.toFixed(3))),MUSEUM.tower.outline);
 assert.ok(Math.abs(roofAt(tower.id,...MUSEUM.tower.centre)-MUSEUM.tower.top)<.05,'the roof under the steeple');
 for(const face of MUSEUM.tower.faces){
  assert.ok(Math.abs(Math.hypot(...face.normal)-1)<.001);
  // Just inside the wall there is roof; just outside there is none.
  const inside=[face.mid[0]-face.normal[0]*.4,face.mid[1]-face.normal[1]*.4],outside=[face.mid[0]+face.normal[0]*.4,face.mid[1]+face.normal[1]*.4];
  assert.ok(Math.abs(roofAt(tower.id,...inside)-MUSEUM.tower.top)<.05,`wall at ${face.mid}`);assert.equal(roofAt(tower.id,...outside),-Infinity);
  for(const end of [-1,1]){const along=[-face.normal[1],face.normal[0]],q=[inside[0]+along[0]*end*(face.length/2-.5),inside[1]+along[1]*end*(face.length/2-.5)];assert.ok(roofAt(tower.id,...q)>MUSEUM.tower.top-.05,'the wall is as long as recorded');}
 }
});

test('the dome stands on the planetarium drum',()=>{
 const drum=buildings.get(MUSEUM.planetarium.id),{centre,top,radius}=MUSEUM.planetarium;
 assert.ok(Math.abs(roofAt(drum.id,...centre)-top)<.05);
 for(let k=0;k<12;k++){const a=k*Math.PI/6;assert.ok(Math.abs(roofAt(drum.id,centre[0]+Math.cos(a)*(radius-.6),centre[1]+Math.sin(a)*(radius-.6))-top)<.05,'roof to the rim');assert.equal(roofAt(drum.id,centre[0]+Math.cos(a)*(radius+.6),centre[1]+Math.sin(a)*(radius+.6)),-Infinity);}
});

test('each turbine stands on the roof it names',()=>{
 const turbines=museumTurbines();assert.equal(turbines.length,6);
 for(const t of turbines){
  assert.ok(Math.abs(roofAt(t.roof,t.position[0],t.position[2])-t.position[1])<.1,`${t.roof} at ${t.position}`);
  for(const other of Object.keys(MUSEUM_ROLES))if(other!==t.roof)assert.ok(roofAt(other,t.position[0],t.position[2])<t.position[1]+.1,`no higher shell over the turbine at ${t.position}`);
 }
});

test('the Tyrannosaurus stands on open ground between the sidewalk and the drive',()=>{
 const {x,z,yaw,half}=museumStatue(),tile=[...metro.loadedTiles.values()].find(t=>x>=t.tx*t.size&&x<(t.tx+1)*t.size&&z>=t.tz*t.size&&z<(t.tz+1)*t.size),streets=drawnStreets(tile);
 const inside=(p,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
 const within=(p,rings)=>inside(p,rings[0])&&!rings.slice(1).some(hole=>inside(p,hole));
 for(let across=-half[0];across<=half[0];across+=.4)for(let along=-half[1];along<=half[1];along+=.4){
  const px=x+Math.sin(yaw)*along+Math.cos(yaw)*across,pz=z+Math.cos(yaw)*along-Math.sin(yaw)*across;
  assert.ok(!streets.paved(px,pz)&&!streets.lot(px,pz,0),`asphalt under the statue at ${px.toFixed(1)}, ${pz.toFixed(1)}`);
  for(const id of Object.keys(MUSEUM_ROLES))assert.equal(roofAt(id,px,pz),-Infinity,'clear of the buildings');
  for(const walk of tile.sidewalks??[])assert.ok(!within([px,pz],walk.rings),`on a surveyed sidewalk at ${px.toFixed(1)}, ${pz.toFixed(1)}`);
  for(const rings of tile.streetSidewalks??[])assert.ok(!within([px,pz],rings),`on a sidewalk band at ${px.toFixed(1)}, ${pz.toFixed(1)}`);
 }
});

test('the survey\'s lone shell of the viaduct tower is the one the viaduct replaces',()=>{
 const shell=buildings.get(VIADUCT_TOWER.id);assert.ok(shell);
 assert.ok(Math.hypot(shell.footprint[0][0]-VIADUCT_TOWER.first[0],shell.footprint[0][1]-VIADUCT_TOWER.first[1])<.01);
 assert.ok(Math.abs(shell.baseElevation+shell.height-VIADUCT_TOWER.top)<.05);
 const hull=metro.far.tiles.get('0_-2').buildings.find(h=>!h.fragment&&Math.hypot(h.footprint[0][0]-VIADUCT_TOWER.first[0],h.footprint[0][1]-VIADUCT_TOWER.first[1])<.14);assert.ok(hull,'its far box is found by its first vertex');
});

test('the Tyrannosaurus is solid: a car driven at it from the dam road is stopped, and passes where it is not registered',async()=>{
 const {DrivingPhysics}=await import('../src/physics/vehicle.ts'),{museumStatueCollision}=await import('../src/render/museum-of-science.ts'),{windowCity}=await import('./helpers/metro-city.mjs');
 const city=windowCity(metro,{minX:330,maxX:540,minZ:-1990,maxZ:-1800}),mesh=museumStatueCollision(city),{x,z,yaw,half}=museumStatue();
 assert.ok(mesh.indices.length/3>300&&mesh.vertices.length===mesh.indices.length*3,'a triangle list');
 let low=Infinity,high=-Infinity;const across=[Math.cos(yaw),-Math.sin(yaw)],along=[Math.sin(yaw),Math.cos(yaw)];
 for(let i=0;i<mesh.vertices.length;i+=3){
  const dx=mesh.vertices[i]-x,dz=mesh.vertices[i+2]-z;low=Math.min(low,mesh.vertices[i+1]);high=Math.max(high,mesh.vertices[i+1]);
  assert.ok(Math.abs(dx*across[0]+dz*across[1])<=half[0]+.05&&Math.abs(dx*along[0]+dz*along[1])<=half[1]+2.2,'the mesh stays over its plinth (the tail reaches two metres past its end)');
 }
 assert.ok(high-low>5.5&&high-low<7,`about six metres tall (${(high-low).toFixed(2)})`);
 const run=async solid=>{
  const physics=await DrivingPhysics.create(city);
  try{
   if(solid)physics.addStaticMesh(mesh.vertices,mesh.indices);
   physics.reset(x+across[0]*14,z+across[1]*14,Math.atan2(-across[0],-across[1]));
   for(let i=0;i<60;i++)physics.step({throttle:0,brake:1,steer:0,handbrake:false},1/60);
   let nearest=Infinity;
   for(let frame=0;frame<7*60;frame++){physics.step({throttle:.6,brake:0,steer:0,handbrake:false},1/60);const s=physics.getState();nearest=Math.min(nearest,(s.x-x)*across[0]+(s.z-z)*across[1]);}
   return nearest;
  }finally{physics.dispose();}
 };
 const open=await run(false),blocked=await run(true);
 assert.ok(open<-3,`without the mesh the car drives through where the statue stands (${open.toFixed(1)} m)`);
 assert.ok(blocked>.8,`with it the car stops short of the statue's axis (${blocked.toFixed(1)} m)`);
});
