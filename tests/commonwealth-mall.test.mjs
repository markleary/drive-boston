import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {loadMetroCity,windowCity,hasMetroData} from './helpers/metro-city.mjs';
import {MALL_BLOCKS,MALL_MONUMENTS,MALL_HALF_WIDTH,MALL_ROWS,MALL_GATE_HALF,MALL_FENCE_END,MALL_FENCE_SETBACK,WOMENS_MEMORIAL_RADIUS,mallFrames,planMall,isCommonwealthMall,isPlannedMallLawn,mallPathTest,mallGroundTest,monumentYaw} from '../src/simulation/commonwealth-mall.ts';
import {buildMonument,statueFigure,strokeRing,mallDetailSteps} from '../src/render/commonwealth-mall.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {createTireSurfaceSampler} from '../src/simulation/tire-tracks.ts';

// Arlington Street to Kenmore Square, every tile the Mall touches.
const MALL={minX:-1720,maxX:320,minZ:-460,maxZ:220};
const metro=hasMetroData()?await loadMetroCity({bounds:MALL}):undefined,skip=!metro&&'needs the metro package in public/data';
const malls=metro?metro.parks.filter(isCommonwealthMall):[];
const edgeDistance=(p,ring)=>{
  let best=Infinity;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/d)):0;best=Math.min(best,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz));}
  return best;
};
const inside=(p,rings)=>pointInside(p,rings[0])&&!rings.slice(1).some(h=>pointInside(p,h));
/** The surveyed sidewalk polygons of every loaded tile that reach onto a Mall lawn. */
const surveyed=metro?[...metro.loadedTiles.values()].flatMap(tile=>tile.sidewalks).filter(w=>w.rings[0].some(p=>malls.some(m=>pointInside(p,m.rings[0])))):[];
const onPaving=p=>surveyed.some(w=>inside(p,w.rings));
/** Signed clearance from surveyed paving: metres outside the nearest outline (negative on the paving). */
const pavingClearance=p=>{let best=Infinity;for(const w of surveyed)for(const ring of w.rings)best=Math.min(best,edgeDistance(p,ring));return onPaving(p)?-best:best;};
const lawnOf=p=>malls.find(m=>inside(p,m.rings));

test('the Mall is nine lawn blocks of the installed park records, east to west',{skip},()=>{
  assert.equal(malls.length,14,'thirteen records east of Charlesgate and the Kenmore block');
  assert.equal(MALL_BLOCKS.length,9);assert.equal(malls.filter(isPlannedMallLawn).length,9,'one record a block');
  for(const [i,frame] of mallFrames.entries()){
    const {block,length}=frame,lawn=lawnOf(frame.at(length*.55,0));
    assert.ok(lawn,`${block.name}: a lawn under the axis`);
    if(i)assert.ok(block.east[0]<MALL_BLOCKS[i-1].west[0],`${block.name} lies west of the block before it`);
    for(const [end,gate] of block.fence.entries()){
      if(!gate)continue;
      const s=end?length:0,inward=end?-1:1;
      assert.ok(edgeDistance(frame.at(s,0),lawn.rings[0])<.3,`${block.name}: end ${end} on the lawn's edge`);
      // The lawn is 100 ft wide at a street end (a metre less at Gloucester Street): it holds the fence's last post
      // a metre in, and stops short of 15.8 m from the axis.
      for(const side of [1,-1]){
        const reach=(gate.reach??MALL_FENCE_END)+.25;
        assert.ok(inside(frame.at(s+inward,side*reach),lawn.rings),`${block.name}: end ${end} lawn reaches ${side*reach} m`);
        assert.ok(!inside(frame.at(s+inward,side*(MALL_HALF_WIDTH+.6)),lawn.rings),`${block.name}: end ${end} lawn stops before ${side*(MALL_HALF_WIDTH+.6)} m`);
      }
      assert.ok(!inside(frame.at(s-inward*.6,0),lawn.rings),`${block.name}: the cross street sidewalk lies beyond end ${end}`);
      // The walk enters about the gate's centre: paving for 2.8 m either side of it, lawn 3.5 m out.
      for(const side of [1,-1]){
        assert.ok(onPaving(frame.at(s+inward*1.6,gate.centre+side*2.8)),`${block.name}: end ${end}, the walk reaches ${side*2.8} m from its centre`);
        assert.ok(!onPaving(frame.at(s+inward*1.6,gate.centre+side*3.5)),`${block.name}: end ${end}, lawn ${side*3.5} m from the walk's centre`);
      }
    }
    // The walk's stretch of the axis is surveyed paving on the seven full blocks and the Hereford Street block.
    if(i<8)for(let s=block.walk[0]+1;s<block.walk[1]-1;s+=4){
      // Round a monument the paving widens and the island opens: outside the block's plain stretches.
      const p=frame.at(s,0);if(MALL_MONUMENTS.some(m=>{const [ms,mv]=frame.local(m.around??m.at);return Math.abs(mv)<2&&Math.abs(s-ms)<m.paved[0]+1;}))continue;
      assert.ok(onPaving(p),`${block.name}: surveyed walk at ${s} m`);
      for(const side of [1,-1])assert.ok(!onPaving(frame.at(s,side*4.4)),`${block.name}: lawn beside the walk at ${s} m`);
    }
  }
});

test('each monument stands on the island the sidewalk inventory leaves open in the walk',{skip},()=>{
  assert.deepEqual(MALL_MONUMENTS.map(m=>m.id),['hamilton','glover','collins','vendome','garrison','morison','women','sarmiento','eriksson']);
  for(const monument of MALL_MONUMENTS){
    const island=surveyed.flatMap(w=>w.rings.slice(1).map(hole=>({walk:w,hole}))).find(({walk,hole})=>pointInside(monument.at,walk.rings[0])&&pointInside(monument.at,hole));
    assert.ok(island,`${monument.name}: inside an open island of a surveyed walk`);
    const frame=mallFrames.find(f=>{const [s,v]=f.local(monument.at);return s>0&&s<f.length&&Math.abs(v)<1;});
    assert.ok(frame,`${monument.name}: on a block's axis`);
    // Its solid parts stay on the island (the three figures of the Women's Memorial on their round).
    const model=buildMonument(monument.id),yaw=monumentYaw(monument),sin=Math.sin(yaw),cos=Math.cos(yaw);
    for(const s of model.solids){
      const centre=[monument.at[0]+s.x*cos+s.z*sin,monument.at[1]-s.x*sin+s.z*cos];
      assert.ok(pointInside(centre,island.hole)||edgeDistance(centre,island.hole)<.6,`${monument.name}: a solid part off its island`);
    }
    for(const part of model.parts)part.geometry.dispose();
    // Leif Eriksson looks west; the others toward the Public Garden.
    const ahead=[monument.at[0]+Math.sin(yaw),monument.at[1]+Math.cos(yaw)];
    assert.equal(ahead[0]>monument.at[0],monument.faces==='east',`${monument.name} faces ${monument.faces}`);
  }
  const women=MALL_MONUMENTS.find(m=>m.id==='women'),round=surveyed.flatMap(w=>w.rings.slice(1)).find(hole=>pointInside(women.at,hole));
  const radii=round.map(p=>Math.hypot(p[0]-women.at[0],p[1]-women.at[1]));
  assert.ok(Math.min(...radii)>WOMENS_MEMORIAL_RADIUS-.35&&Math.max(...radii)<WOMENS_MEMORIAL_RADIUS+.35,`the round is ${Math.min(...radii).toFixed(2)} to ${Math.max(...radii).toFixed(2)} m`);
});

test('four rows of trees stand on the lawns, clear of the walk, the monuments and the curbs',{skip},()=>{
  const plan=planMall(metro.parks);
  assert.ok(plan.trees.length>380&&plan.trees.length<480,`${plan.trees.length} trees`);
  const species=new Set(plan.trees.map(t=>t.species));assert.deepEqual([...species].sort(),['elm','honey locust','maple','red oak']);
  assert.ok(plan.trees.filter(t=>t.species==='elm').length>plan.trees.length*.35,'elms lead the planting');
  const rows=new Map();
  for(const tree of plan.trees){
    const p=[tree.x,tree.z],lawn=lawnOf(p);
    assert.ok(lawn&&isPlannedMallLawn(lawn),'on a planned lawn');
    assert.ok(edgeDistance(p,lawn.rings[0])>=2.6-1e-9,'2.6 m inside the curb');
    assert.ok(pavingClearance(p)>.9,`a trunk ${pavingClearance(p).toFixed(2)} m from surveyed paving at ${p.map(v=>v.toFixed(1))}`);
    const frame=mallFrames.find(f=>{const [s,v]=f.local(p);return s>=0&&s<=f.length&&Math.abs(v)<MALL_HALF_WIDTH;}),[s,v]=frame.local(p);
    const row=[MALL_ROWS[0],-MALL_ROWS[0],MALL_ROWS[1],-MALL_ROWS[1],0].find(r=>Math.abs(v-r)<.46);
    assert.ok(row!==undefined,`in a row: ${v.toFixed(2)} m from the axis`);
    if(row===0)assert.ok(s<frame.block.walk[0]-5||s>frame.block.walk[1]+5,'the middle row stands only beyond the walk');
    const key=`${frame.index}:${row}`,list=rows.get(key)??[];list.push(s);rows.set(key,list);
  }
  // Along a row the trunks keep their spacing.
  for(const list of rows.values()){list.sort((a,b)=>a-b);for(let i=1;i<list.length;i++)assert.ok(list[i]-list[i-1]>6.5,`trunks ${(list[i]-list[i-1]).toFixed(1)} m apart in a row`);}
  for(const frame of mallFrames.slice(0,7))for(const row of [MALL_ROWS[0],-MALL_ROWS[0],MALL_ROWS[1],-MALL_ROWS[1]])assert.ok((rows.get(`${frame.index}:${row}`)?.length??0)>=8,`${frame.block.name}: row ${row} is planted`);
});

test('a tile that sees only some of the lawns plans the same trees, benches and fences on them',{skip},()=>{
  const whole=planMall(metro.parks),key=t=>`${t.x},${t.z}`;
  // What tile -1_0 collects: the parks whose box meets its square.
  const square={minX:-1000,maxX:0,minZ:0,maxZ:1000},parks=metro.parks.filter(p=>{const xs=p.rings[0].map(v=>v[0]),zs=p.rings[0].map(v=>v[1]);return Math.min(...xs)<=square.maxX&&Math.max(...xs)>=square.minX&&Math.min(...zs)<=square.maxZ&&Math.max(...zs)>=square.minZ;});
  const part=planMall(parks),owned=p=>p[0]>=square.minX&&p[0]<square.maxX&&p[1]>=square.minZ&&p[1]<square.maxZ;
  assert.ok(parks.filter(isCommonwealthMall).length<malls.length,'the tile sees a subset of the lawns');
  const expected=whole.trees.filter(t=>owned([t.x,t.z])).map(key).sort(),got=part.trees.filter(t=>owned([t.x,t.z])).map(key).sort();
  assert.ok(expected.length>30,`${expected.length} trees in the tile`);assert.deepEqual(got,expected);
  assert.deepEqual(part.benches,whole.benches);assert.deepEqual(part.fences,whole.fences);
  assert.equal(planMall(metro.parks),whole,'one plan per park list');
  assert.deepEqual(planMall(metro.parks.filter(p=>!isCommonwealthMall(p))),{trees:[],benches:[],fences:[],monuments:[]},'nothing without a Mall lawn');
});

test('an iron fence crosses each end of a block behind the sidewalk, open where the walk enters',{skip},()=>{
  const plan=planMall(metro.parks);
  assert.equal(plan.fences.length,30,'fifteen fenced ends, a run either side of the walk');
  const ends=new Map();
  for(const run of plan.fences){
    const frame=mallFrames[run.block],gate=frame.block.fence[run.end],local=run.posts.map(p=>frame.local(p.at)),s=local[0][0],side=Math.sign(local[0][1]-gate.centre),k=side>0?0:1;
    assert.ok(gate,'a run stands only at a fenced end');
    assert.ok(run.posts.length===5||run.posts.length===6,`${run.posts.length-1} panels`);
    assert.deepEqual(run.posts.slice(1).map(p=>p.kind),[...Array(run.posts.length-2).fill('line'),'end']);
    assert.equal(run.posts[0].kind,run.block===0&&!run.end?'stone':'gate','granite posts stand at the Arlington Street entrance only');
    assert.ok(Math.abs(local[0][1]-(gate.centre+side*MALL_GATE_HALF))<1e-6,'the opening is centred on the walk');
    assert.ok(Math.abs(Math.abs(local.at(-1)[1])-(gate.reach??MALL_FENCE_END))<1e-6,'the last post stands short of the curb');
    assert.ok(Math.abs((run.end?frame.length-s:s)-Math.max(.2,gate.back[k]+MALL_FENCE_SETBACK))<1e-6);
    for(const [i,[ps,v]] of local.entries()){
      assert.ok(Math.abs(ps-s)<1e-6,'a straight run across the lawn');
      if(i){const gap=Math.abs(v-local[i-1][1]);assert.ok(gap>1.9&&gap<2.45,`posts ${gap.toFixed(2)} m apart`);}
      // On the lawn's end (an end is not quite square to the axis: a corner post may stand a hand's width past the park record's edge).
      const p=run.posts[i].at,clear=pavingClearance(p);
      assert.ok(lawnOf(p)||malls.some(m=>edgeDistance(p,m.rings[0])<.3),`${frame.block.name}: a post off the lawn`);
      assert.ok((run.end?frame.length-ps:ps)<1.2,'at the lawn\'s end');
      // Behind the back of the cross street sidewalk: off its paving, and no more than half a metre of lawn before it.
      assert.ok(clear>.05,`${frame.block.name}: a ${run.posts[i].kind} post ${clear.toFixed(2)} m off the paving`);
      if(gate.back[k]>.05)assert.ok(clear<.55,`${frame.block.name} end ${run.end}: a ${run.posts[i].kind} post stands ${clear.toFixed(2)} m behind the sidewalk`);
    }
    const key=`${run.block}:${run.end}`,list=ends.get(key)??[];list.push(local[0]);ends.set(key,list);
  }
  for(const [key,gates] of ends){
    const [block,end]=key.split(':').map(Number),frame=mallFrames[block],centre=frame.block.fence[end].centre;
    assert.equal(gates.length,2,'a run either side of the walk');
    // The walk passes between the gate posts: paving a metre inside each post, lawn at its foot.
    for(const [s,v] of gates)for(const reach of [1,.15])assert.equal(onPaving(frame.at(s,centre+(v-centre)*(1-reach/MALL_GATE_HALF))),reach===1,`${frame.block.name} end ${end}: ${reach} m inside a gate post`);
    assert.ok(onPaving(frame.at(gates[0][0],centre)),'the walk enters between them');
  }
});

test('benches face each other across the walk',{skip},()=>{
  const plan=planMall(metro.parks);
  assert.ok(plan.benches.length>80&&plan.benches.length<110,`${plan.benches.length} benches`);
  for(const bench of plan.benches){
    const p=[bench.x,bench.z],frame=mallFrames.find(f=>{const [s,v]=f.local(p);return s>=0&&s<=f.length&&Math.abs(v)<MALL_HALF_WIDTH;}),[s,v]=frame.local(p);
    assert.ok(s>=frame.block.walk[0]+13&&s<=frame.block.walk[1]-13,'beside the walk, clear of its ends');
    // The seat, half a metre deep, is on the lawn; the sitter's feet are toward the walk.
    assert.ok(pavingClearance(p)>.3,`a bench ${pavingClearance(p).toFixed(2)} m from the paving in ${frame.block.name}`);
    const ahead=frame.local([bench.x+Math.sin(bench.yaw)*2,bench.z+Math.cos(bench.yaw)*2]);
    assert.ok(Math.abs(ahead[1])<Math.abs(v)-1.9&&Math.abs(ahead[0]-s)<.01,'facing the axis squarely');
    if(frame.index<8)assert.ok(onPaving([bench.x+Math.sin(bench.yaw)*1.4,bench.z+Math.cos(bench.yaw)*1.4]),'the surveyed walk passes before it');
    assert.ok(lawnOf(p),'on the lawn');
  }
});

test('mapped paths on the Mall give way to the surveyed walk; the rest are paved',{skip},()=>{
  const onMall=mallPathTest(metro.parks),kinds={block:0,lawn:0},blockPaths=[];let covered=0,open=[];
  for(const tile of metro.loadedTiles.values())for(const path of tile.parkPaths){
    const kind=onMall(path);if(!kind)continue;kinds[kind]++;
    let samples=0,hits=0;if(kind==='block'&&!/807050706/.test(path.id))blockPaths.push(path);
    for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2));for(let k=0;k<=n;k++){samples++;if(surveyed.some(w=>pointInside([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n],w.rings[0])))hits++;}}
    if(hits>=samples*.8)covered++;else open.push(path.id.replace(/-0--?\d.*$/,''));
  }
  assert.ok(kinds.block>=30&&kinds.lawn>=6,JSON.stringify(kinds));
  // Only the walk west of the underpass and the Kenmore block's walks lack a surveyed polygon.
  assert.ok(open.includes('osm-way-807050706'),'the Charlesgate East walk is paved from its mapped line');
  assert.ok(open.length>=6&&open.length<=kinds.lawn+1,`unsurveyed: ${open.join(', ')}`);assert.ok(covered>=30);
  assert.ok(blockPaths.every(path=>!open.includes(path.id.replace(/-0--?\d.*$/,''))),'every mapped path on a surveyed block is its polygon');
  // A path that merely passes by is not the Mall's.
  assert.equal(onMall({points:[[-466.9,-125.5],[-466.9,-60]]}),undefined);
  assert.equal(mallPathTest([])({points:[[-500,-113],[-520,-106]]}),undefined);
});

test('the lawn is grass under the wheels and keeps the street trees of the crossing streets off its ends',{skip},()=>{
  const surface=createTireSurfaceSampler(metro,()=>metro.loadedTiles.values()),frame=mallFrames[4],at=(s,v)=>{const [x,z]=frame.at(s,v);return surface(x,sampleElevation(metro,x,z),z);};
  assert.equal(at(80,9),'grass','the lawn, typed with the paved squares, is turf');
  assert.equal(at(80,0),'pavement','the surveyed walk');
  const ground=mallGroundTest(metro.parks);
  assert.ok(ground(...frame.at(80,9))&&ground(...frame.at(80,13.2)),'no street tree on the lawn');
  assert.ok(ground(...frame.at(-3,9))&&ground(...frame.at(frame.length+4,-12)),'nor on the cross street sidewalk before a fence');
  assert.ok(!ground(...frame.at(-8,9))&&!ground(...frame.at(80,17.5)),'the streets themselves are untouched');
  const kenmore=malls.find(m=>/Mall II$/.test(m.name)),centre=[kenmore.rings[0].reduce((s,p)=>s+p[0],0)/4,kenmore.rings[0].reduce((s,p)=>s+p[1],0)/4];
  assert.ok(!ground(...centre),'the Kenmore block keeps its street trees');
  assert.ok(!mallGroundTest([])(...frame.at(80,9)),'a city without the Mall is not affected');
});

test('monuments are compact solids of the right stature',()=>{
  const heights={hamilton:[5.6,6.6],glover:[4.6,5.4],collins:[5.2,6.2],vendome:[.9,1.2],garrison:[4.5,5.3],morison:[3,3.8],women:[1.8,2.1],sarmiento:[4.4,5.2],eriksson:[5.2,6]};
  let total=0;
  for(const monument of MALL_MONUMENTS){
    const model=buildMonument(monument.id),box=new THREE.Box3();let triangles=0;
    for(const part of model.parts){
      const g=part.geometry;g.computeBoundingBox();box.union(g.boundingBox);triangles+=(g.index?g.index.count:g.getAttribute('position').count)/3;
      assert.ok(g.getAttribute('normal')&&!g.getAttribute('uv'),'position and normal only, so parts of one finish merge');
      g.dispose();
    }
    const [low,high]=heights[monument.id];
    assert.ok(model.height>=low&&model.height<=high,`${monument.id} stands ${model.height.toFixed(2)} m`);
    assert.ok(Math.abs(box.max.y-model.height)<.12&&box.min.y>-.01,`${monument.id}: drawn from the ground to its stated height`);
    assert.ok(triangles<2400,`${monument.id}: ${triangles} triangles`);total+=triangles;
    assert.ok(model.solids.length>=1);
    for(const s of model.solids)assert.ok(s.h>.45&&s.w>.3&&s.d>.3&&Math.hypot(s.x,s.z)<4.5,`${monument.id}: a box a car meets`);
  }
  assert.ok(total<10000,`${total} triangles in all`);
  const standing=statueFigure({height:2}),seated=statueFigure({height:2,seated:true});standing.computeBoundingBox();seated.computeBoundingBox();
  assert.ok(Math.abs(standing.boundingBox.max.y-2)<.05&&Math.abs(standing.boundingBox.min.y)<.01,'a figure is as tall as asked');
  assert.ok(seated.boundingBox.max.y>1.45&&seated.boundingBox.max.y<1.65&&seated.boundingBox.max.z>.6,'seated: three quarters the height, knees forward');
  assert.ok(standing.index.count/3<800);
});

test('a path is stroked to a ring half its width either side',()=>{
  const ring=strokeRing([[0,0],[10,0],[10,10]],2);
  assert.deepEqual(ring.map(p=>p.map(v=>Math.round(v*100)/100)),[[0,1],[9,1],[9,10],[11,10],[11,-1],[0,-1]]);
  assert.equal(strokeRing([[0,0],[5,0]],3).length,4);
});

/** The picket mask is painted on a canvas: a stand-in context is enough to build the furnishings. */
function withCanvas(run){
  const saved=Object.getOwnPropertyDescriptor(globalThis,'document'),context=new Proxy({},{get:(target,name)=>name in target?target[name]:()=>{},set:(target,name,value)=>{target[name]=value;return true;}});
  globalThis.document={createElement:()=>({getContext:()=>context})};
  try{return run();}finally{if(saved)Object.defineProperty(globalThis,'document',saved);else delete globalThis.document;}
}
const drain=steps=>{let r=steps.next();while(!r.done)r=steps.next();return r.value;};

test('each tree, bench, fence panel and monument is drawn by exactly one tile',{skip},()=>withCanvas(()=>{
  const plan=planMall(metro.parks),totals={trees:0,benches:0,fencePanels:0,monuments:[],walks:0,solids:0};
  for(const [key,tile] of metro.loadedTiles){
    const size=tile.size,bounds={minX:tile.tx*size,maxX:(tile.tx+1)*size,minZ:tile.tz*size,maxZ:(tile.tz+1)*size};
    // The tile builder's view: the parks whose box meets the square, the tile's own paths and sidewalks.
    const parks=metro.parks.filter(p=>{const xs=p.rings[0].map(v=>v[0]),zs=p.rings[0].map(v=>v[1]);return Math.min(...xs)<=bounds.maxX&&Math.max(...xs)>=bounds.minX&&Math.min(...zs)<=bounds.maxZ&&Math.max(...zs)>=bounds.minZ;});
    const window=windowCity(metro,{minX:Math.max(bounds.minX,MALL.minX),maxX:Math.min(bounds.maxX,MALL.maxX),minZ:Math.max(bounds.minZ,MALL.minZ),maxZ:Math.min(bounds.maxZ,MALL.maxZ)});
    const details=drain(mallDetailSteps(window,parks,tile.parkPaths,{bounds,sidewalks:tile.sidewalks}));
    if(!parks.some(isCommonwealthMall)){assert.equal(details,undefined,`${key}: nothing where no lawn is in view`);continue;}
    for(const name of ['trees','benches','fencePanels','walks'])totals[name]+=details.stats[name];
    totals.monuments.push(...details.stats.monuments);totals.solids+=details.solids.length;
    assert.equal(details.trees.length,details.stats.trees);
    for(const tree of details.trees)assert.ok(tree.position.x>=bounds.minX&&tree.position.x<bounds.maxX&&tree.position.z>=bounds.minZ&&tree.position.z<bounds.maxZ,'a tile plants inside its square');
    for(const mesh of details.meshes){
      assert.ok(mesh.geometry.getAttribute('position').count>0);
      const pickets=mesh.name==='Commonwealth Avenue Mall fence pickets';
      assert.equal(!!mesh.userData.noAO,pickets,'only the cutout panels stay out of the ambient occlusion normals');
      if(pickets){assert.ok(mesh.material.alphaMap&&mesh.material.alphaTest>0&&mesh.material.side===THREE.DoubleSide);assert.ok(mesh.castShadow);}
      mesh.geometry.dispose();
    }
    for(const box of details.solids)for(const v of Object.values(box))assert.ok(Number.isFinite(v));
  }
  assert.equal(totals.trees,plan.trees.length);assert.equal(totals.benches,plan.benches.length);
  assert.equal(totals.fencePanels,plan.fences.reduce((n,run)=>n+run.posts.length-1,0));assert.ok(totals.fencePanels>=145&&totals.fencePanels<=150,'about five panels a run');
  assert.deepEqual(totals.monuments.sort(),MALL_MONUMENTS.map(m=>m.name).sort());
  // The Charlesgate East walk and the Kenmore block's walks, each paved by the tile that carries the path.
  assert.ok(totals.walks>=8&&totals.walks<=12,`${totals.walks} unsurveyed walks paved`);
  assert.equal(totals.solids,totals.fencePanels+MALL_MONUMENTS.reduce((n,m)=>n+buildMonument(m.id).solids.length,0));
}));
