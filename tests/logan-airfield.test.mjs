import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';
import {DATA_DIR,loadMetroCity,hasMetroData,readJson} from './helpers/metro-city.mjs';
import {AIRCRAFT,AIRFIELD_LAYERS,E_EXTENSION,LOGAN_COMPLEX,LOGAN_TOWER,MARKING,aircraftSolids,airfieldPaint,airfieldPaved,airfieldPolygons,holdMarking,isAirfieldData,lineQuads,loganComplexPart,loganRole,runwayFrame,runwayMarkings,runwayRank,stopwayChevrons} from '../src/simulation/logan-airfield.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {createTireSurfaceSampler} from '../src/simulation/tire-tracks.ts';
import {DrapedSurface} from '../src/render/draped-surface.ts';
import {drain} from '../src/render/pacing.ts';

const FT=.3048,centre=q=>[q.reduce((s,p)=>s+p[0],0)/q.length,q.reduce((s,p)=>s+p[1],0)/q.length];
const quadArea=q=>{let a=0;for(let i=0,j=q.length-1;i<q.length;j=i++)a+=q[j][0]*q[i][1]-q[i][0]*q[j][1];return Math.abs(a)/2;};
/** A marking's place in a runway's frame: metres along it from end 0 and across it (the pilot's right positive). */
const place=(runway,p,end=0)=>{const f=runwayFrame(runway,end),dx=p[0]-f.origin[0],dz=p[1]-f.origin[1];return{along:dx*f.u[0]+dz*f.u[1],across:dx*f.r[0]+dz*f.r[1]};};
const synthetic=(length,width,ends)=>({id:'test',width,shoulder:7.62,grooved:true,ends:[{name:ends[0][0],point:[0,0],displaced:ends[0][1],marking:ends[0][2]},{name:ends[1][0],point:[0,-length],displaced:ends[1][1],marking:ends[1][2]}]});

test('a runway frame has the runway ahead and the pilot\'s right on the right',()=>{
  // Taking off to the north (z falls): east, x positive, is on the right.
  const f=runwayFrame(synthetic(3000,45.72,[['36',0,'precision'],['18',0,'precision']]),0);
  assert.deepEqual(f.u.map(v=>Math.round(v)),[0,-1]);assert.deepEqual(f.r.map(v=>Math.round(v)),[1,0]);assert.equal(f.length,3000);
});

test('a precision runway carries the marks of the advisory circular at their distances',()=>{
  const runway=synthetic(3000,150*FT,[['4R',0,'precision'],['22L',0,'precision']]),quads=runwayMarkings(runway).map(q=>({q,...place(runway,centre(q)),area:quadArea(q)}));
  // Twelve threshold stripes 150 ft long beginning 20 ft in, six a side, the middle clear.
  const stripes=quads.filter(m=>Math.abs(m.along-(20*FT+75*FT))<.5&&Math.abs(m.area-150*FT*5.75*FT)<.5);
  assert.equal(stripes.length,12);assert.equal(stripes.filter(m=>m.across>0).length,6);assert.ok(Math.min(...stripes.map(m=>Math.abs(m.across)))>5.75*FT,'the centre is left clear');
  // Aiming points 1,020 ft from the threshold, 150 by 30 ft, one each side.
  const aim=quads.filter(m=>Math.abs(m.along-(1020+75)*FT)<.5&&Math.abs(m.area-150*FT*30*FT)<1);assert.equal(aim.length,2);assert.ok(aim[0].across*aim[1].across<0);
  // Touchdown zone: three bars a side at 500 ft, two at 1,500 and 2,000, one at 2,500 and 3,000.
  const bars=at=>quads.filter(m=>Math.abs(m.along-(at+37.5)*FT)<.5&&Math.abs(m.area-75*FT*6*FT)<.3).length;
  assert.deepEqual([500,1500,2000,2500,3000].map(bars),[6,4,4,2,2]);
  // The centre line: 120 ft stripes, 3 ft wide, none inside either designation.
  const dashes=quads.filter(m=>Math.abs(m.across)<.01&&Math.abs(m.area-120*FT*3*FT)<.3);
  assert.ok(dashes.length>35);assert.ok(Math.min(...dashes.map(m=>m.along))>(20+150+40+60+30+60)*FT,'the centre line starts beyond the number');
  // The far end is marked the same way.
  assert.equal(quads.filter(m=>Math.abs(m.along-(3000-(20+75)*FT))<.5&&Math.abs(m.area-150*FT*5.75*FT)<.5).length,12);
});

test('the designation reads from the approach: the letter nearer the threshold, the number beyond it, left to right',()=>{
  const runway=synthetic(3000,150*FT,[['15R',0,'precision'],['33L',0,'precision']]),M=MARKING,from=M.stripeSetback+M.stripeLength+M.numberGap;
  const strokes=runwayMarkings(runway).map(q=>({...place(runway,centre(q)),q})).filter(m=>m.along>from-1&&m.along<from+2*M.numberHeight+M.numberGap/2+1&&Math.abs(m.across)<12);
  const letter=strokes.filter(m=>m.along<from+M.numberHeight+1),number=strokes.filter(m=>m.along>from+M.numberHeight+M.numberGap/2-1);
  assert.equal(letter.length,5,'an R is five strokes');assert.ok(letter.every(m=>Math.abs(m.across)<=M.numberWidth/2+M.stroke));
  // "1" is to the pilot's left of "5": negative across.
  const left=number.filter(m=>m.across<0),right=number.filter(m=>m.across>0);assert.equal(left.length,2,'a 1 is two strokes');assert.equal(right.length,5,'a 5 is five');
  // A 100 ft runway has eight threshold stripes and a narrower aiming point.
  const narrow=synthetic(1600,100*FT,[['14',0,'basic'],['32',0,'precision']]),marks=runwayMarkings(narrow).map(q=>({...place(narrow,centre(q)),area:quadArea(q)}));
  assert.equal(marks.filter(m=>Math.abs(m.along-95*FT)<.5&&Math.abs(m.area-150*FT*5.75*FT)<.5).length,8);
  assert.equal(marks.filter(m=>Math.abs(m.area-150*FT*20*FT)<1).length,4,'two aiming points an end');
  // A basic end has no touchdown zone; the precision end of the same runway has.
  const bar=m=>Math.abs(m.area-75*FT*6*FT)<.3;assert.equal(marks.filter(m=>bar(m)&&m.along<800).length,0);assert.ok(marks.filter(m=>bar(m)&&m.along>800).length>=6);
});

test('a displaced threshold has its bar, arrowheads and arrows, and every mark beyond it moves with it',()=>{
  const d=1155*FT,runway=synthetic(3050,150*FT,[['4R',d,'precision'],['22L',0,'precision']]),quads=runwayMarkings(runway).map(q=>({q,...place(runway,centre(q)),area:quadArea(q)}));
  const bar=quads.filter(m=>Math.abs(m.area-10*FT*150*FT)<.5);assert.equal(bar.length,1);assert.ok(Math.abs(bar[0].along-(d-5*FT))<.01,'the bar ends on the threshold');
  const before=quads.filter(m=>m.along<d-10*FT&&Math.abs(m.across)<20);
  assert.ok(before.filter(m=>m.q.length===4&&Math.abs(m.across)>3).length>=4,'arrowheads across the runway');assert.ok(before.filter(m=>Math.abs(m.across)<.01).length>=6,'arrows up the centre line');
  assert.equal(quads.filter(m=>Math.abs(m.along-(d+95*FT))<.5&&Math.abs(m.area-150*FT*5.75*FT)<.5).length,12,'the stripes begin 20 ft beyond the displaced threshold');
  assert.equal(quads.filter(m=>Math.abs(m.along-(d+1095*FT))<.5&&Math.abs(m.area-150*FT*30*FT)<1).length,2,'the aiming point is 1,020 ft beyond it');
});

test('chevrons point at the runway, hold bars face it, and a line is quads of its width',()=>{
  const runway=synthetic(2000,45.72,[['9',0,'basic'],['27',0,'basic']]);
  // A pad south of end 0 (the runway runs north from z 0): each chevron's point is its northern vertex.
  const chevrons=stopwayChevrons([0,150,0,0],45.72,[runway]);assert.ok(chevrons.length>=6);
  for(const q of chevrons){const tip=q.reduce((a,p)=>p[1]<a[1]?p:a);assert.ok(Math.abs(tip[0])<.01,'the point is on the centre line');}
  assert.deepEqual(stopwayChevrons([0,0,0,150],45.72,[runway]).map(q=>q.map(p=>p.map(v=>+v.toFixed(6)))),chevrons.map(q=>q.map(p=>p.map(v=>+v.toFixed(6)))),'whichever way the pad is drawn');
  const hold=holdMarking([10,10],[0,-1]).map(q=>({c:centre(q),w:Math.max(...q.map(p=>p[0]))-Math.min(...q.map(p=>p[0]))}));
  const solid=hold.filter(h=>h.w>20),dashed=hold.filter(h=>h.w<2);assert.equal(solid.length,2);assert.ok(dashed.length>10);
  assert.ok(Math.max(...dashed.map(h=>h.c[1]))<Math.min(...solid.map(h=>h.c[1])),'the dashed lines are on the runway side');
  const quads=lineQuads([0,0,100,0,100,50],.3,40);assert.equal(quads.length,5);assert.ok(Math.abs(quads.reduce((s,q)=>s+quadArea(q),0)-(150+4*.15)*.3)<.01);
});

test('an aircraft\'s collision boxes cover its fuselage, wing and fin',()=>{
  for(const [kind,a] of Object.entries(AIRCRAFT)){
    const [body,wing,fin]=aircraftSolids(kind);
    assert.ok(body.length>a.length*.9&&body.width===a.body);assert.ok(wing.width>a.span*.9&&wing.y<a.axis);assert.ok(fin.y+fin.height/2<=a.tail+.01&&fin.along>a.length*.85);
    assert.ok(a.axis-a.body/2>.8,`${kind}: the belly clears the ground`);
  }
});

const metro=hasMetroData()&&existsSync(new URL('airfield.json',DATA_DIR))?await loadMetroCity({tiles:[]}):undefined,skip=!metro&&'needs the metro package with airfield.json in public/data';
const data=metro?readJson('airfield.json'):undefined,paved=data?airfieldPaved(data):undefined;
if(metro)metro.airfield=data; // as boot() does before the world is built
// FAA NASR, effective 29 October 2026: length and width in feet, displaced thresholds in feet by end.
const PUBLISHED={'04L/22R':[7864,150,{'22R':819}],'04R/22L':[10006,150,{'4R':1155,'22L':1199}],'09/27':[7001,150,{}],'14/32':[5000,100,{}],'15L/33R':[2557,100,{}],'15R/33L':[10083,150,{'15R':882}]};

test('the package ships Logan\'s six runways at their published lengths, widths and thresholds',{skip},()=>{
  assert.ok(isAirfieldData(data));assert.deepEqual(data.runways.map(r=>r.id),Object.keys(PUBLISHED));
  for(const runway of data.runways){
    const [length,width,displaced]=PUBLISHED[runway.id],f=runwayFrame(runway,0);
    assert.ok(Math.abs(f.length-length*FT)<1,`${runway.id}: ${f.length.toFixed(1)} m against ${(length*FT).toFixed(1)}`);assert.ok(Math.abs(runway.width-width*FT)<.01);
    for(const end of runway.ends)assert.ok(Math.abs(end.displaced-(displaced[end.name]??0)*FT)<.01,`${end.name} threshold`);
    assert.deepEqual(runway.ends.map(e=>e.name).join('/').replace(/^(\d)([LR]?)\//,'0$1$2/'),runway.id);
    // Magnetic headings name the ends: the true bearing from an end is its number times ten, less the 15 degrees of variation at Boston.
    for(const end of [0,1]){const g=runwayFrame(runway,end),bearing=(Math.atan2(g.u[0],-g.u[1])*180/Math.PI+360)%360,named=parseInt(runway.ends[end].name)*10,off=Math.abs(((bearing+15-named)+540)%360-180);assert.ok(off<6,`${runway.ends[end].name} bears ${bearing.toFixed(0)} true`);}
  }
});

test('every runway is paved from end to end and edge to edge, on ground the package draws',{skip},()=>{
  const keys=new Set(metro.tiles.keys),range={min:Infinity,max:-Infinity};
  for(const key of Object.keys(data.tiles))assert.ok(keys.has(key),`tile ${key} holds airfield pavement and is in the package`);
  for(const runway of data.runways){
    const f=runwayFrame(runway,0);let off=0,n=0;
    for(let a=2;a<f.length-2;a+=10)for(const c of [-runway.width/2+.5,0,runway.width/2-.5]){const x=f.origin[0]+f.u[0]*a+f.r[0]*c,z=f.origin[1]+f.u[1]*a+f.r[1]*c;n++;if(paved(x,z)!=='runway')off++;const y=sampleElevation(metro,x,z);range.min=Math.min(range.min,y);range.max=Math.max(range.max,y);}
    assert.ok(off/n<.012,`${runway.id}: ${off} of ${n} points are not runway pavement`);
    // Beside the runway lies its shoulder, then grass or a taxiway: never nothing where the runway should be.
    const mid=[f.origin[0]+f.u[0]*f.length*.37+f.r[0]*(runway.width/2+2),f.origin[1]+f.u[1]*f.length*.37+f.r[1]*(runway.width/2+2)];assert.ok(['shoulder','taxiway','apron','runway'].includes(paved(...mid)));
  }
  assert.ok(range.min>-1&&range.max<6,`the runways lie between ${range.min.toFixed(2)} and ${range.max.toFixed(2)} m`);
  // The layers do not overlap: a point is in one polygon of one layer at most (sampled on a 40 m lattice).
  const b=data.bounds,count={};
  for(let x=b.minX;x<b.maxX;x+=40)for(let z=b.minZ;z<b.maxZ;z+=40){const layer=paved(x,z);if(layer)count[layer]=(count[layer]??0)+1;}
  for(const layer of AIRFIELD_LAYERS)assert.ok(Math.abs(count[layer]*1600-data.area[layer])/data.area[layer]<.12,`${layer}: ${count[layer]*1600} m2 sampled against ${data.area[layer]} recorded`);
});

test('where runways cross, the higher ranked one\'s marks run through and no mark lies off the pavement',{skip},()=>{
  const paint=airfieldPaint(data),white=[...paint.values()].flatMap(t=>t.white),yellow=[...paint.values()].flatMap(t=>t.yellow);
  assert.ok(white.length>900&&yellow.length>3000,`${white.length} white and ${yellow.length} yellow marks`);
  for(const q of [...white,...yellow])assert.ok(paved(...centre(q)),'a mark\'s middle is on pavement');
  const on=(runway,p,margin=0)=>{const m=place(runway,p),f=runwayFrame(runway,0);return m.along>-margin&&m.along<f.length+margin&&Math.abs(m.across)<runway.width/2+margin;};
  // 15R/33L and 04R/22L are the two longest precision runways: 15R/33L ranks first and keeps its centre line through every crossing.
  const ranked=[...data.runways].sort((a,b)=>runwayRank(b)-runwayRank(a));assert.equal(ranked[0].id,'15R/33L');
  const main=ranked[0],f=runwayFrame(main,0),dashes=white.filter(q=>{const m=place(main,centre(q));return Math.abs(m.across)<.05&&Math.abs(quadArea(q)-120*FT*3*FT)<.3;});
  assert.ok(dashes.length>=Math.floor((f.length-2*380)/(200*FT))-2,`${dashes.length} centre line stripes on ${main.id}`);
  // Every mark a runway would carry alone is painted unless a higher ranked runway's pavement holds its middle
  // (a side stripe: any other runway's), and none that such pavement holds is painted.
  const key=q=>centre(q).map(v=>v.toFixed(2)).join(','),painted=new Set(white.map(key));let dropped=0;
  for(const runway of data.runways){
    const higher=data.runways.filter(o=>runwayRank(o)>runwayRank(runway)),others=data.runways.filter(o=>o!==runway);
    for(const q of runwayMarkings(runway)){
      const c=centre(q),side=Math.abs(place(runway,c).across)>runway.width/2-MARKING.side-.05,crossed=(side?others:higher).some(o=>on(o,c,side?0:2));
      if(crossed){dropped++;assert.ok(!painted.has(key(q)),`a mark of ${runway.id} is painted on a runway that outranks it`);}
      else if(q.every(p=>paved(...p)))assert.ok(painted.has(key(q)),`a mark of ${runway.id} is missing`);
    }
  }
  assert.ok(dropped>20&&dropped<200,`${dropped} marks give way at the crossings`);
  // No taxiway line or hold bar is painted on a runway.
  for(const q of yellow)assert.ok(!data.runways.some(r=>on(r,centre(q),-1.5)),'yellow paint keeps off the runways');
});

test('parked aircraft stand on the apron, clear of each other, and the jet bridges reach them',{skip},()=>{
  const provenance=readJson('provenance.json').loganAirfield,kinds={};for(const a of data.aircraft)kinds[a.kind]=(kinds[a.kind]??0)+1;
  assert.deepEqual(kinds,provenance.aircraft);assert.ok(data.aircraft.length>=30&&data.aircraft.length<=80);assert.ok(kinds.wide>=4&&kinds.narrow>=20);
  const segment=a=>{const s=AIRCRAFT[a.kind];return[a.nose,[a.nose[0]-a.heading[0]*s.length,a.nose[1]-a.heading[1]*s.length]];};
  const gap=(p,[a,b])=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);};
  for(const a of data.aircraft){
    const s=AIRCRAFT[a.kind],[nose,tail]=segment(a);assert.ok(Math.abs(Math.hypot(...a.heading)-1)<.001);
    for(const t of [.1,.3,.5,.7,.9])assert.ok(paved(nose[0]+(tail[0]-nose[0])*t,nose[1]+(tail[1]-nose[1])*t),`${a.stand}: the aircraft stands on pavement`);
    assert.notEqual(paved(...nose),'runway');assert.notEqual(paved(...tail),'runway');
    // No other aircraft's fuselage comes within this one's body width of its fuselage.
    for(const b of data.aircraft)if(b!==a)for(const t of [0,.25,.5,.75,1]){const p=[nose[0]+(tail[0]-nose[0])*t,nose[1]+(tail[1]-nose[1])*t];assert.ok(gap(p,segment(b))>s.body/2+AIRCRAFT[b.kind].body/2+3,`${a.stand} and ${b.stand}`);}
  }
  assert.equal(new Set(data.aircraft.map(a=>a.stand)).size,data.aircraft.length,'one aircraft a stand');
  const docked=data.jetBridges.filter(b=>b.docked);assert.ok(docked.length>=15,`${docked.length} bridges are docked`);
  for(const b of docked){const head=b.line.slice(-2),near=Math.min(...data.aircraft.map(a=>{const s=AIRCRAFT[a.kind];return gap(head,segment(a))-s.body/2;}));assert.ok(near>-.05&&near<1.2,`bridge ${b.ref} ends ${near.toFixed(2)} m from a fuselage`);}
});

test('the airport\'s surveyed buildings are finished as what they are',{skip},()=>{
  const complex=metro.landmarkBuildings.find(b=>b.id===LOGAN_COMPLEX);assert.ok(complex,'the terminal complex is a landmark building of the package');
  assert.equal(loganRole(data,complex),'complex');assert.equal(loganRole(data,{...complex,id:LOGAN_TOWER}),'tower');assert.equal(loganRole(undefined,complex),undefined);
  const box=(x,z,w,d,height)=>({id:'x',center:[x,z],height,footprint:[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]]});
  assert.equal(loganRole(data,box(4100,-2700,90,80,18)),'hangar');assert.equal(loganRole(data,box(4100,-2700,12,10,5)),'shed');
  assert.equal(loganRole(data,box(4100,-2700,60,60,40)),undefined,'a hotel keeps its windows');assert.equal(loganRole(data,box(3300,-2600,12,10,8)),undefined,'a house in East Boston is no airport building');
  // Each terminal's outline holds a point of its own, and Terminal E's roof is red only over its extension.
  const names=new Set(data.terminals.map(t=>t.name));for(const name of ['Terminal A','Terminal B','Terminal C','Terminal E'])assert.ok(names.has(name),name);
  const e=data.terminals.find(t=>t.name==='Terminal E'),xs=e.ring.filter((_,i)=>i%2===0);assert.ok(Math.min(...xs)<E_EXTENSION-150&&Math.max(...xs)>E_EXTENSION+150,'the extension line crosses Terminal E');
  const within=(ring,x0,x1)=>{for(let i=0;i<4000;i++){const x=x0+(x1-x0)*((i*.6180339)%1),z=-2600+500*((i*.7548776)%1);let hit=false;for(let a=0,b=ring.length-2;a<ring.length;b=a,a+=2)if((ring[a+1]>z)!==(ring[b+1]>z)&&x<(ring[b]-ring[a])*(z-ring[a+1])/(ring[b+1]-ring[a+1])+ring[a])hit=!hit;if(hit)return[x,z];}};
  const west=within(e.ring,Math.min(...xs),E_EXTENSION-5),east=within(e.ring,E_EXTENSION+5,Math.max(...xs));
  assert.equal(loganComplexPart(data,...west,true),'red-roof');assert.equal(loganComplexPart(data,...east,true),'roof');assert.equal(loganComplexPart(data,...east,false),'terminal');
  // The central garage stands between the terminals, in no terminal's outline.
  assert.equal(loganComplexPart(data,4560,-1850,true),'deck');assert.equal(loganComplexPart(data,4560,-1850,false),'garage');
});

test('a wheel on a runway is on pavement, and the pavement drapes on the terrain of its tile',{skip},()=>{
  const sampler=createTireSurfaceSampler(metro,()=>[]),r=data.runways.find(r=>r.id==='15R/33L'),f=runwayFrame(r,0),x=f.origin[0]+f.u[0]*900,z=f.origin[1]+f.u[1]*900;
  assert.equal(sampler(x,sampleElevation(metro,x,z),z),'pavement');
  const grass=[x+f.r[0]*95,z+f.r[1]*95];assert.equal(paved(...grass),undefined);assert.equal(sampler(grass[0],sampleElevation(metro,...grass),grass[1]),'grass');
  // The tile the package gained for the airfield: its runway pavement becomes a mesh on the ground there.
  const key=readJson('provenance.json').loganAirfield.addedTiles[0];assert.equal(key,'6_-3');
  const surface=new DrapedSurface(metro,{offset:.02});let area=0;
  for(const polygon of airfieldPolygons(data,key,'runway')){drain(surface.add(polygon));area+=quadArea(polygon[0]);}
  const geometry=drain(surface.geometrySteps()),p=geometry.attributes.position;assert.ok(geometry.index.count>300);
  let worst=0;for(let i=0;i<p.count;i+=7)worst=Math.max(worst,Math.abs(p.getY(i)-sampleElevation(metro,p.getX(i),p.getZ(i))-.02));
  assert.ok(worst<.002,`the pavement lies ${worst.toFixed(4)} m off its 2 cm over the ground`);assert.ok(area>10000);
});
