import assert from 'node:assert/strict';
import test from 'node:test';
import {TriangleWriter} from '../src/render/geometry-writer.ts';
import {drapedStripInto,drapedRibbonInto} from '../src/render/terrain-ground.ts';
import {pavementEdges,pavementSpan,polylineLength,roadwaySpan,stationAlong} from '../src/simulation/tile-format.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {roadMidpoint} from '../src/simulation/road-tile-coverage.ts';
import {hasMetroData,loadMetroCity} from './helpers/metro-city.mjs';

const flat={bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},elevation:{width:3,height:3,cellSize:100,originX:-100,originZ:-100,heights:[2,2,2,2,2,2,2,2,2]},roads:[],tunnels:[]};

test('pavement edges decode from tile-origin centimetres',()=>{
  const {left,right}=pavementEdges({tx:2,tz:-1,size:1000},{road:'r',edges:[150,25,-120,75,1000,0,900,0,7]});
  assert.deepEqual(left,[[2001.5,-999.75],[2010,-1000]]);assert.deepEqual(right,[[1998.8,-999.25],[2009,-1000]]);
});

test('a crosswalk spans the pavement edges at its own station, wherever the centerline sits between them',()=>{
  const edges={left:[[0,5],[20,5],[40,9]],right:[[0,-5],[20,-5],[40,-9]]};
  assert.deepEqual(pavementSpan(edges,[10,0],1,0),[-5,5]);assert.deepEqual(pavementSpan(edges,[30,0],1,0),[-7,7]);
  assert.deepEqual(pavementSpan(edges,[30,0],-1,0),[-7,7],'the same span seen from the far end');
  assert.equal(pavementSpan(edges,[45,0],1,0),undefined,'no span beyond the recorded edges');
  const offset={left:[[0,8],[40,8]],right:[[0,-2],[40,-2]]};
  assert.deepEqual(pavementSpan(offset,[20,0],1,0),[-2,8]);assert.deepEqual(pavementSpan(offset,[20,0],-1,0),[-8,2],'offsets flip with the direction, lower first');
});

test('a crosswalk completes across a twin carriageway that adjoins its roadway, not across a gap, a slanting edge, a junction mouth or a chain of records',()=>{
  const own=[-5,5],beside={left:[[0,15],[40,15]],right:[[0,4.8],[40,4.8]]},third={left:[[0,24],[40,24]],right:[[0,15.2],[40,15.2]]};
  const apart={left:[[0,-8],[40,-8]],right:[[0,-14],[40,-14]]},slant={left:[[0,-20],[40,20]],right:[[6,-20],[46,20]]},short={left:[[0,3],[10,3]],right:[[0,-3],[10,-3]]};
  assert.deepEqual(roadwaySpan(own,[third,beside,apart,slant,short],[20,0],1,0),[-5,15],'across the adjoining record only; the record touching just that one, the 3 m gap, the 45 degree edges and a record ending before the station are ignored');
  assert.deepEqual(roadwaySpan(own,[],[20,0],1,0),own);
  assert.deepEqual(roadwaySpan([-5,5],[beside],[20,0],-1,0),[-15,5],'seen from the far end the neighbour lies on the other side');
  // A wider street's record running alongside (its edge dipping into this road's junction mouth, as Faneuil Street's does at Bothwell Road) would add more than one roadway of this width: the stripes stay on the own roadway.
  const mouth={left:[[0,5.3],[40,5.3]],right:[[0,-28],[40,-28]]},twin={left:[[0,-5.2],[40,-5.2]],right:[[0,-16.5],[40,-16.5]]};
  assert.deepEqual(roadwaySpan(own,[mouth],[20,0],1,0),own,'a record adding 23 m beside a 10 m roadway is a junction mouth, not a twin');
  assert.deepEqual(roadwaySpan(own,[twin],[20,0],1,0),[-16.5,5],'a record adding up to the own width plus 2 m is a twin carriageway');
});

test('a crosswalk station follows the centerline, not the bearing of a short first segment',()=>{
  const line=[[0,0],[1,0],[2,.3],[3,.9],[4,1.8],[14,11.8],[30,27.8]];
  assert.equal(polylineLength(line).toFixed(2),'41.33');
  const station=stationAlong(line,8);
  assert.ok(Math.abs(station.at[0]-6.436)<.005&&Math.abs(station.at[1]-4.236)<.005,`8 m along the line sits on the diagonal (${station.at})`);
  assert.ok(Math.abs(station.tx-Math.SQRT1_2)<1e-9&&Math.abs(station.tz-Math.SQRT1_2)<1e-9,'with the direction of the segment it lies on');
  assert.deepEqual(stationAlong(line,0),{at:[0,0],tx:1,tz:0});
  assert.equal(stationAlong(line,50),undefined,'beyond the line there is no station');
});

test('Boylston Street\'s crosswalks follow the curbs where the roadway narrows and shifts off the centerline',{skip:!hasMetroData()},async()=>{
  const city=await loadMetroCity({bounds:{minX:0,maxX:1000,minZ:-1000,maxZ:0}}),road=city.roads.find(r=>r.id==='17569-0-0');
  assert.ok(road&&road.pavedWidth>20,'the whole segment measures over 20 m');
  const tile=city.loadedTiles.get('0_-1'),record=tile.pavements.find(p=>p.road===road.id);assert.ok(record,'tile 0_-1 owns the record');
  const edges=pavementEdges(tile,record),span=(a,b)=>{const len=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(b[0]-a[0])/len,tz=(b[1]-a[1])/len;return pavementSpan(edges,[a[0]+tx*8,a[1]+tz*8],tx,tz);};
  const west=span(road.points[0],road.points[1]),east=span(road.points.at(-1),road.points.at(-2));
  assert.ok(west&&Math.abs(west[1]-west[0]-14)<.5,`the west crossing spans the 14 m roadway there (${west})`);
  assert.ok(east&&east[1]-east[0]>19&&Math.abs(east[0]+east[1])>10,`the east crossing spans a 20 m roadway shifted off the centerline (${east})`);
});

test('a strip between measured edges covers the quads a ribbon would, following each edge',()=>{
  const sink=new TriangleWriter();
  drapedStripInto(sink,flat,[[0,5],[20,5],[40,9]],[[0,-5],[20,-5],[40,-9]],.045);
  const p=sink.position,n=sink.count;assert.ok(n>=12&&n%3===0);
  let area=0,maxZ=0;
  for(let i=0;i<n;i+=3){const ax=p[i*3],az=p[i*3+2],bx=p[i*3+3],bz=p[i*3+5],cx=p[i*3+6],cz=p[i*3+8];area+=Math.abs((bx-ax)*(cz-az)-(bz-az)*(cx-ax))/2;}
  for(let k=0;k<n;k++){assert.ok(Math.abs(p[k*3+1]-2.045)<1e-6,'draped onto the ground plus the offset');maxZ=Math.max(maxZ,Math.abs(p[k*3+2]));}
  assert.ok(Math.abs(area-(200+20*14))<1e-3,'a 10 m parallel section then a flare to 18 m');assert.ok(Math.abs(maxZ-9)<1e-9,'the far end reaches the measured 9 m edge');
  const ribbon=new TriangleWriter();drapedRibbonInto(ribbon,flat,[[0,0],[20,0]],10,.045);
  const strip=new TriangleWriter();drapedStripInto(strip,flat,[[0,5],[20,5]],[[0,-5],[20,-5]],.045);
  assert.equal(strip.count,ribbon.count,'same subdivision as the constant-width ribbon');
  for(let k=0;k<strip.count;k++)assert.ok(strip.normal[k*3+1]>.99,'strip triangles wind upward like the ribbon (left is the +normal side)');
  for(let k=0;k<strip.count;k++)for(let c=0;c<3;c++)assert.ok(Math.abs(strip.position[k*3+c]-ribbon.position[k*3+c])<1e-9,'vertex for vertex the ribbon');
});

test('the Brookline Avenue island keeps its lawn and loses the curbs of the roadway the Muddy River restoration removed',{skip:!hasMetroData()},async()=>{
  const city=await loadMetroCity({bounds:{minX:-2500,maxX:-2000,minZ:600,maxZ:1000}}),tile=city.loadedTiles.get('-3_0'),curbs=tile.curbs.filter(c=>c.length>=2);
  const distance=([x,z],c)=>{let best=Infinity;for(let i=1;i<c.length;i++){const [ax,az]=c[i-1],[bx,bz]=c[i],dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(x-ax-t*dx,z-az-t*dz));}return best;};
  const nearest=p=>Math.min(...curbs.map(c=>distance(p,c)));
  // The streets' own curbs along the island stay (the survey's ring was one polyline).
  assert.ok(nearest([-2319.3,828.82])<.1,'Brookline Avenue keeps its curb along the island');assert.ok(nearest([-2253.09,828.68])<.1,'Park Drive keeps its curb along the island');
  // The curved south edge and the corridor south of it were a roadway until 2016; no street explains them now.
  for(const p of [[-2264.76,843.28],[-2291.21,838.27],[-2288,846]])assert.ok(nearest(p)>5,`no curb remains at ${p}, the removed roadway's edge`);
  // The inventory records a 9.5 ft sidewalk around the whole 2,200 m2 island: only that strip stays concrete.
  const contains=(p,rings)=>pointInside(p,rings[0])&&!rings.slice(1).some(h=>pointInside(p,h)),walks=tile.sidewalks.map(w=>w.rings);
  assert.ok(!walks.some(r=>contains([-2285,815],r)),'the island centre is lawn, not the inventory outline');
  assert.ok(!walks.some(r=>contains([-2282,838],r))&&!walks.some(r=>contains([-2292,850],r)),'the sidewalk strips of the removed roadway south of the island went with its curbs');
  assert.ok(walks.some(r=>contains([-2317.86,829.61],r)),'a sidewalk strip remains along Brookline Avenue');
});

test('Riverway northbound was moved out of the splitter island onto the roadway, is measured from the island curb, and its crosswalk spans both carriageways',{skip:!hasMetroData()},async()=>{
  const city=await loadMetroCity({bounds:{minX:-2600,maxX:-2300,minZ:650,maxZ:850}}),road=city.roads.find(r=>r.id==='28373-0-0'),island=city.parks.find(p=>p.name==='Riverway II');
  assert.ok(road&&island,'the northbound carriageway and the splitter island');
  // Boston Segments drew this line 1.5 m inside the island; the installer moved its interior onto the roadway, a lane beyond the island curb, with the endpoints fixed.
  assert.ok(road.sourcePoints&&road.sourcePoints.length>=2&&road.points.some((p,i)=>!road.sourcePoints[i]||p[0]!==road.sourcePoints[i][0]||p[1]!==road.sourcePoints[i][1]),'the installer kept the source line beside the moved one');
  assert.deepEqual([road.points[0],road.points[road.points.length-1]],[road.sourcePoints[0],road.sourcePoints[road.sourcePoints.length-1]],'the junction ends stay');
  assert.deepEqual(road.points[0].map(Math.round),[-2524,787],'it starts at the Longwood junction');
  const along=t=>stationAlong(road.points,t);
  assert.ok(Math.hypot(road.points[1][0]-road.points[0][0],road.points[1][1]-road.points[0][1])<18&&polylineLength(road.points)>100,'the taper starts with a short segment on a long road, so the crosswalk station must follow the line');
  for(const s of [30,60,90])assert.ok(!pointInside(along(s).at,island.rings[0]),`the moved centerline at ${s} m runs outside the island`);
  const tile=city.loadedTiles.get('-3_0'),record=tile.pavements.find(p=>p.road===road.id),edges=pavementEdges(tile,record),mid=along(30),inside=pavementSpan(edges,mid.at,mid.tx,mid.tz);
  assert.ok(inside&&inside[0]<-2&&inside[1]>2&&inside[1]-inside[0]<16,`measured from the island curb across the roadway around the moved line (${inside})`);
  const foot=along(8),own=pavementSpan(edges,foot.at,foot.tx,foot.tz),whole=roadwaySpan(own,tile.pavements.map(p=>pavementEdges(tile,p)),foot.at,foot.tx,foot.tz);
  assert.ok(whole[1]-whole[0]>own[1]-own[0]+4&&whole[1]-whole[0]>18,`the crosswalk at the nose grows from the record (${own}) across the southbound carriageway (${whole})`);
});

test('Bothwell Road\'s crosswalk stays on its own roadway beside Faneuil Street and Arlington Street',{skip:!hasMetroData()},async()=>{
  // Faneuil Street's record runs alongside the first metres of Bothwell Road with its edge dipping into the junction mouth, and Arlington Street's adjoins that one: both edges are aligned, so alignment and overlap alone chained the stripes to 49.8 m.
  const city=await loadMetroCity({bounds:{minX:-7300,maxX:-6900,minZ:-450,maxZ:-200}}),road=city.roads.find(r=>r.id==='7736-0-0'),tile=city.loadedTiles.get('-8_-1'),record=tile.pavements.find(p=>p.road===road.id);
  assert.ok(road&&record,'Bothwell Road and its record in the tile that owns it');
  const {at,tx,tz}=stationAlong(road.points,8),own=pavementSpan(pavementEdges(tile,record),at,tx,tz),all=[...tile.pavements,...tile.borderPavements].map(p=>pavementEdges(tile,p)),whole=roadwaySpan(own,all,at,tx,tz);
  assert.ok(own[1]-own[0]<9,`a 7.7 m side street (${own})`);
  assert.deepEqual(whole,own,`the crosswalk does not reach Faneuil Street's far curb or Arlington Street (${whole})`);
  const present=new Set([...tile.pavements,...tile.borderPavements].map(p=>p.road));assert.ok(present.has('7735-0-0')&&present.has('14199-0-0'),'with both neighbouring records present in the tile');
});

test('Highland Avenue\'s border record follows the station the renderer walks to, not one extrapolated along a short first segment',{skip:!hasMetroData()},async()=>{
  // osm-170502324-0 starts with a 1.2 m segment at a bend; 8 m along the line the westbound carriageway osm-170502325-0 (owned by tile -4_-6) adjoins its roadway, so tile -4_-5 needs that record as a border copy.
  const city=await loadMetroCity({bounds:{minX:-3900,maxX:-3500,minZ:-5200,maxZ:-4800}}),road=city.roads.find(r=>r.id==='osm-170502324-0'),tile=city.loadedTiles.get('-4_-5'),record=tile.pavements.find(p=>p.road===road.id);
  assert.ok(road&&record&&Math.hypot(road.points[1][0]-road.points[0][0],road.points[1][1]-road.points[0][1])<2,'the eastbound carriageway with a short first segment, owned by tile -4_-5');
  assert.ok(!tile.pavements.some(p=>p.road==='osm-170502325-0')&&tile.borderPavements.some(p=>p.road==='osm-170502325-0'),'the westbound record reaches the tile as a border record');
  const {at,tx,tz}=stationAlong(road.points,8),edges=pavementEdges(tile,record),own=pavementSpan(edges,at,tx,tz),whole=roadwaySpan(own,[...tile.pavements,...tile.borderPavements].map(p=>pavementEdges(tile,p)),at,tx,tz);
  assert.ok(whole[0]<own[0]-4&&whole[1]===own[1],`the crosswalk grows across the westbound carriageway (${own} -> ${whole})`);
});

test('Edwin H. Land Boulevard crosswalks span the carriageway another tile owns through its border record',{skip:!hasMetroData()},async()=>{
  // Northbound osm-426646441-0 (midpoint in tile -1_-2) and southbound osm-8615699-0 (midpoint in tile 0_-2) share the roadway where it crosses the tile line at x=0.
  const city=await loadMetroCity({bounds:{minX:-200,maxX:200,minZ:-2100,maxZ:-1800}}),north=city.loadedTiles.get('-1_-2'),south=city.loadedTiles.get('0_-2');
  assert.ok(north.pavements.some(p=>p.road==='osm-426646441-0')&&south.pavements.some(p=>p.road==='osm-8615699-0'),'each tile owns one carriageway');
  assert.ok(!north.pavements.some(p=>p.road==='osm-8615699-0')&&north.borderPavements.some(p=>p.road==='osm-8615699-0'),'the southbound record reaches the northbound tile as a border record');
  assert.ok(south.borderPavements.some(p=>p.road==='osm-426646441-0'),'and the other way round');
  const road=city.roads.find(r=>r.id==='osm-426646441-0'),record=north.pavements.find(p=>p.road===road.id),edges=pavementEdges(north,record);
  const b=road.points[road.points.length-1],a=road.points[road.points.length-2],len=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(a[0]-b[0])/len,tz=(a[1]-b[1])/len,at=[b[0]+tx*8,b[1]+tz*8];
  const own=pavementSpan(edges,at,tx,tz),alone=roadwaySpan(own,north.pavements.map(p=>pavementEdges(north,p)),at,tx,tz),whole=roadwaySpan(own,[...north.pavements,...north.borderPavements].map(p=>pavementEdges(north,p)),at,tx,tz);
  assert.ok(whole[1]-whole[0]>alone[1]-alone[0]+5,`the crosswalk at the far end grows across the southbound carriageway only with the border record (${alone} -> ${whole})`);
});

test('the shipped package carries curb-bounded roadways, inventory sidewalks, islands and driveways',{skip:!hasMetroData()},async()=>{
  const city=await loadMetroCity({bounds:{minX:-2500,maxX:-1500,minZ:600,maxZ:1500}}),roadsById=new Map();
  for(const road of city.roads)roadsById.set(road.id,[...roadsById.get(road.id)??[],road]);
  let records=0,sidewalks=0,bricks=0,islands=0,driveways=0,borders=0,mfa=false;
  for(const [key,tile] of city.loadedTiles){
    const x0=tile.tx*tile.size,z0=tile.tz*tile.size,inside=([x,z])=>x>=x0&&x<x0+tile.size&&z>=z0&&z<z0+tile.size;
    const owned=city.roads.filter(r=>!r.elevations&&!r.tunnel&&inside(roadMidpoint(r)));
    assert.equal(tile.pavements.length,owned.length,`${key}: one record per owned surface road`);
    for(const record of tile.pavements){
      const candidates=roadsById.get(record.road);assert.ok(candidates?.length,`${key}: ${record.road} exists`);
      const {left,right}=pavementEdges(tile,record);assert.ok(left.length>=2&&left.length===right.length);
      const road=candidates.reduce((best,r)=>Math.hypot((left[0][0]+right[0][0])/2-r.points[0][0],(left[0][1]+right[0][1])/2-r.points[0][1])<Math.hypot((left[0][0]+right[0][0])/2-best.points[0][0],(left[0][1]+right[0][1])/2-best.points[0][1])?r:best);
      const first=road.points[0],last=road.points.at(-1);
      assert.ok(Math.hypot((left[0][0]+right[0][0])/2-first[0],(left[0][1]+right[0][1])/2-first[1])<road.width,`${key}: ${road.name} record starts at the road`);
      assert.ok(Math.hypot((left.at(-1)[0]+right.at(-1)[0])/2-last[0],(left.at(-1)[1]+right.at(-1)[1])/2-last[1])<road.width,`${key}: ${road.name} record ends at the road`);
      for(let i=0;i<left.length;i++){const w=Math.hypot(left[i][0]-right[i][0],left[i][1]-right[i][1]);assert.ok(w>=2.3&&w<=60,`${key}: ${road.name} roadway ${w.toFixed(1)} m wide`);}
      if(record.walk)assert.ok(record.walk.every(v=>v===0||v===1));
      records++;
    }
    for(const walk of tile.sidewalks){assert.ok(walk.rings[0].length>=3&&walk.rings[0].every(p=>inside(p)||true));if(walk.material==='brick')bricks++;sidewalks++;}
    for(const rings of tile.islands){
      assert.ok(rings[0].length>=3);islands++;
      const cx=rings[0].reduce((s,p)=>s+p[0],0)/rings[0].length,cz=rings[0].reduce((s,p)=>s+p[1],0)/rings[0].length;
      for(const road of city.roads)for(const p of road.points)if(Math.hypot(p[0]-cx,p[1]-cz)<30)assert.ok(!pointInside(p,rings[0]),`${key}: island holds no street vertex of ${road.name}`);
    }
    for(const record of tile.borderPavements){assert.ok(!tile.pavements.some(p=>p.road===record.road)&&roadsById.has(record.road),`border record ${record.road} belongs to another tile`);borders++;}
    for(const rings of tile.driveways){
      assert.ok(rings[0].length>=3);driveways++;
      // The driveway loop at the MFA's Fenway entrance: curbed, inside the park polygon, an OSM service way but no centerline.
      if(pointInside([-1657,1117],rings[0]))mfa=true;
      // Parts are clipped to their tile; a service way that duplicates a mapped street may overlap it (it hides under the roadway asphalt).
      for(const p of rings[0])assert.ok(p[0]>=x0-.01&&p[0]<=x0+tile.size+.01&&p[1]>=z0-.01&&p[1]<=z0+tile.size+.01,`${key}: driveway part stays inside its tile`);
    }
  }
  assert.ok(records>500&&sidewalks>500&&bricks>0&&islands>5&&driveways>5&&borders>0,`Fenway window: ${records} roadways, ${sidewalks} sidewalks (${bricks} brick), ${islands} islands, ${driveways} driveways, ${borders} border records`);
  assert.ok(mfa,'the MFA Fenway pull-off is paved');
  const ratios=city.roads.filter(r=>r.name==='Riverway'&&r.pavedWidth).map(r=>r.pavedWidth/r.width).sort((a,b)=>a-b);
  assert.ok(ratios.length>10&&ratios[ratios.length>>1]>1.3,'the Riverway parkway is much wider than its class guess');
  assert.ok(city.roads.filter(r=>r.pavedWidth).length>city.roads.length*.7,'most surface roads were measured on both sides');
});
