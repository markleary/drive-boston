import assert from 'node:assert/strict';
import test from 'node:test';
import {planPorchStairs} from '../src/render/porch-stairs.ts';
import {prepareNeighborhoodArchitecture,architectureFor} from '../src/render/neighborhood-profiles.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {pointInside} from '../src/simulation/roads.ts';

import {loadCentralCity} from './helpers/metro-city.mjs';
const city=await loadCentralCity();
prepareNeighborhoodArchitecture(city);
const ground=(x,z)=>sampleElevation(city,x,z);

function sourceSite(id){
  const building=city.buildings.find(b=>b.id===id),profile=architectureFor(building);
  assert.ok(building&&profile,'fixture must retain the measured source house and inferred wood profile');
  const {a,b,nx,nz,setback}=profile.front,frontage=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const tangent=[(b[0]-a[0])/frontage,(b[1]-a[1])/frontage],along=frontage*.23;
  const origin=[(a[0]+b[0])/2+tangent[0]*along,(a[1]+b[1])/2+tangent[1]*along];
  const site={origin,tangent,normal:[nx,nz],frontDepth:0,width:Math.min(3.15,frontage*.38),depth:Math.min(1.72,setback-1.65),frontage,along,setback,landingY:building.baseElevation+profile.raisedBase+.085};
  const neighbors=city.buildings.filter(other=>other!==building&&Math.hypot(other.center[0]-origin[0],other.center[1]-origin[1])<35);
  return{building,site,clear:p=>!neighbors.some(other=>pointInside(p,other.footprint))};
}

function sampleBlock(block,direction){
  const result=[],across=[direction[1],-direction[0]];
  for(let x=0;x<=8;x++)for(let z=0;z<=4;z++)result.push([
    block.center[0]+across[0]*block.width*(x/8-.5)+direction[0]*block.depth*(z/4-.5),
    block.center[1]+across[1]*block.width*(x/8-.5)+direction[1]*block.depth*(z/4-.5),
  ]);
  return result;
}

function assertGrounded(plan,site,terrain,clear=()=>true){
  assert.ok(plan,'a realistic stair must be found for this site');
  assert.ok(plan.riser>=.09&&plan.riser<=.205,'riser height must remain plausible rather than grow to fit a short yard');
  assert.ok(plan.width>=1&&plan.width<=1.3,'stairs must retain pedestrian width');
  const tops=[site.landingY,...plan.steps.map(step=>step.top),plan.landing.top];
  for(let i=1;i<tops.length;i++)assert.ok(Math.abs(tops[i-1]-tops[i]-plan.riser)<1e-8,'every transition includes one equal riser, including the porch and landing');
  for(const block of [...plan.steps,plan.landing]){
    assert.ok(block.bottom<block.top);
    for(const p of sampleBlock(block,plan.direction)){
      assert.ok(block.bottom<=terrain(...p)+.002,'masonry must reach the terrain under the whole footprint');
      assert.ok(block.top>=terrain(...p)+.015,'a tread must remain above the hillside');
      assert.ok(clear(p),'the staircase must not pass through a neighboring source footprint');
    }
  }
  const heights=plan.landing.corners.map(p=>terrain(...p));
  assert.ok(plan.landing.top-Math.max(...heights)<.09,'the toe must meet the actual landing terrain, not hang at a capped descent');
  for(let i=0;i<plan.steps.length;i++){
    const step=plan.steps[i],distance=Math.hypot(step.center[0]-plan.start[0],step.center[1]-plan.start[1]);
    assert.ok(step.depth>=.26&&step.depth<=.32,'treads cannot be compressed to fit a short setback');
    assert.ok(Math.abs(distance-(i+.5)*.28)<1e-8,'blocks must descend along their declared direction');
  }
  const first=plan.steps[0],local=[first.center[0]-site.origin[0],first.center[1]-site.origin[1]];
  const u=local[0]*site.tangent[0]+local[1]*site.tangent[1],d=local[0]*site.normal[0]+local[1]*site.normal[1]-site.frontDepth;
  if(plan.entry==='front')assert.ok(Math.abs(u)<1e-6&&d>site.depth,'front stairs must leave the front edge');
  else assert.ok(Math.abs(d-site.depth/2)<1e-6&&Math.sign(u)===(plan.entry==='left'?-1:1),'side stairs must connect to the matching side opening');
}

test('actual steep Calumet porches reach their landings and use side stairs where front setbacks are short',()=>{
  const cases=[
    ['BOS-3OZN2-AKS2H-DAMY1','left'], // 175–177 Calumet: old stair floated 1.76 m.
    // 137 Calumet (BOS-KGDEA-NSZGY-WPOOR) now drops 5.3 m to a level sidewalk and
    // no straight flight fits its 10 m yard, so its porch is omitted: see below.
    ['BOS-7P41I-76GYS-LS75Z','left'], // 36 Calumet.
    ['BOS-C8WFL-95U7F-IFGWT','left'], // 173 Calumet.
  ];
  for(const[id,entry]of cases){
    const{site,clear}=sourceSite(id),plan=planPorchStairs(site,ground,clear);
    assertGrounded(plan,site,ground,clear);assert.equal(plan.entry,entry);
    assert.ok(site.landingY-plan.landing.top>2,'the real descent must exceed the old 1.5 m cap');
    const local=plan.landing.corners.map(p=>({u:(p[0]-site.origin[0])*site.tangent[0]+(p[1]-site.origin[1])*site.tangent[1],d:(p[0]-site.origin[0])*site.normal[0]+(p[1]-site.origin[1])*site.normal[1]}));
    for(const p of local){
      assert.ok(p.d<=site.setback-1.39,'a straight flight must preserve the chosen pedestrian clear band');
      assert.ok(p.u>=-site.frontage/2-site.along-1.501&&p.u<=site.frontage/2-site.along+1.501,'a side flight may continue at most 1.5 m past the house corner');
    }
  }
});

test('small-rise real houses retain grounded entrances instead of being needlessly omitted',()=>{
  for(const id of ['BOS-6I0CB-O1JZC-KBT54','BOS-2NYVA-KCMKF-2EGOT','BOS-M8RWR-H9M78-06SGO']){
    // 34 Fisher, 8 Eldora, and 146 Hillside have low or cross-sloping front yards.
    const{site,clear}=sourceSite(id),plan=planPorchStairs(site,ground,clear);
    assertGrounded(plan,site,ground,clear);
    assert.ok(plan.steps.length<=4,'small-rise sites should not acquire a large ceremonial staircase');
  }
});

test('road grading retains grounded entrances on the previously repaired Calumet and Eldora houses',()=>{
  const graded=city;// the shipped grid is graded offline (scripts/grade-terrain.mjs)
  const terrain=(x,z)=>sampleElevation(graded,x,z);
  for(const id of ['BOS-3OZN2-AKS2H-DAMY1','BOS-7P41I-76GYS-LS75Z','BOS-C8WFL-95U7F-IFGWT','BOS-2NYVA-KCMKF-2EGOT']){
    const{site,clear}=sourceSite(id),plan=planPorchStairs(site,terrain,clear);
    assertGrounded(plan,site,terrain,clear);
  }
  // Levelling the sidewalk strip with its street left 137 Calumet's porch 5.3 m
  // above the yard's foot: the planner declines rather than squeeze the flight.
  const{site,clear}=sourceSite('BOS-KGDEA-NSZGY-WPOOR');
  assert.equal(planPorchStairs(site,terrain,clear),undefined);
});

const flatSite={origin:[0,0],tangent:[1,0],normal:[0,1],frontDepth:0,width:3.15,depth:1.72,frontage:10,along:2,setback:12,landingY:3.8};

test('a high porch on flat land uses a full descent with grounded blocks',()=>{
  const terrain=()=>0,plan=planPorchStairs(flatSite,terrain);
  assertGrounded(plan,flatSite,terrain);assert.equal(plan.entry,'front');
  assert.ok(plan.steps.length>=18);assert.ok(plan.run>5);
  assert.ok(Math.abs(plan.landing.top-.06)<1e-9);
});

test('rotated stairs stay grounded across a sloping yard and share an orthogonal footprint frame',()=>{
  const angle=.71,tangent=[Math.cos(angle),-Math.sin(angle)],normal=[Math.sin(angle),Math.cos(angle)];
  const site={...flatSite,origin:[20,-13],tangent,normal,frontDepth:.17,landingY:5.5};
  const terrain=(x,z)=>2+.11*(x-20)-.13*(z+13),plan=planPorchStairs(site,terrain);
  assertGrounded(plan,site,terrain);
  for(const block of [...plan.steps,plan.landing])for(const p of block.corners){
    const dx=p[0]-block.center[0],dz=p[1]-block.center[1];
    assert.ok(Math.abs(Math.abs(dx*plan.direction[0]+dz*plan.direction[1])-block.depth/2)<1e-8);
    assert.ok(Math.abs(Math.abs(dx*plan.direction[1]-dz*plan.direction[0])-block.width/2)<1e-8);
  }
});

test('neighbor clearance can redirect a front flight and impossible lots omit decorative stairs',()=>{
  const site={...flatSite,landingY:3.2},terrain=()=>0;
  const obstacle=[[-.8,1.85],[.8,1.85],[.8,8],[-.8,8]],clear=p=>!pointInside(p,obstacle);
  const plan=planPorchStairs(site,terrain,clear);
  assertGrounded(plan,site,terrain,clear);assert.equal(plan.entry,'left');
  assert.equal(planPorchStairs({...site,frontage:3.3,along:0,setback:3.3},terrain),undefined,'an impossible lot must not produce crushed treads or floating steps');
});

test('neighbor geometry through a tread center cannot be straddled by clear corners',()=>{
  const site={...flatSite,landingY:3.2},terrain=()=>0;
  const narrowWall=[[-.04,1.85],[.04,1.85],[.04,8],[-.04,8]],clear=p=>!pointInside(p,narrowWall);
  const plan=planPorchStairs(site,terrain,clear);
  assertGrounded(plan,site,terrain,clear);assert.notEqual(plan.entry,'front');
});
