import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {prepareRoadTerrain} from '../src/simulation/road-grading.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';

const source=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url),'utf8'));
const city={...source,elevation:{...source.elevation,heights:[...source.elevation.heights]}};
prepareRoadTerrain(city);
const ordinary=source.roads.filter(road=>!road.elevations);

// Classify junction approaches independently from the grading implementation.
// Road directions compete there; the ordinary street interior should be flatter.
const endpoints=new Map();
for(const road of ordinary)for(const point of [road.points[0],road.points.at(-1)]){
  const key=`${Math.floor(point[0]/32)},${Math.floor(point[1]/32)}`,list=endpoints.get(key)??[];
  list.push(point);endpoints.set(key,list);
}
function nearJunction(x,z){
  const ix=Math.floor(x/32),iz=Math.floor(z/32);
  for(let xx=ix-1;xx<=ix+1;xx++)for(let zz=iz-1;zz<=iz+1;zz++)
    for(const point of endpoints.get(`${xx},${zz}`)??[])if(Math.hypot(point[0]-x,point[1]-z)<16)return true;
  return false;
}

function crossSections(){
  const samples=[];
  for(const road of ordinary){
    // These are the cross-sections drawn by drapedRibbon, including its blend
    // between neighboring point tangents on curved source streets.
    const normal=index=>{
      const a=road.points[Math.max(0,index-1)],b=road.points[Math.min(road.points.length-1,index+1)];
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;
      return [-dz/length,dx/length];
    };
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      if(length<.01)continue;
      const na=normal(i-1),nb=normal(i);
      for(let distance=0;distance<length;distance+=2){
        const t=distance/length,x=a[0]+dx*t,z=a[1]+dz*t;
        const nx=na[0]+(nb[0]-na[0])*t,nz=na[1]+(nb[1]-na[1])*t,half=road.width/2;
        const left=[x+nx*half,z+nz*half],right=[x-nx*half,z-nz*half],width=Math.hypot(left[0]-right[0],left[1]-right[1]);
        const crossfall=data=>Math.abs(sampleElevation(data,...left)-sampleElevation(data,...right))/width;
        // Equal curb heights can conceal a V-shaped dip in the middle. Sample
        // every metre or less across the complete rendered pavement as well.
        const divisions=Math.ceil(width),step=width/divisions;
        let previousOld,previousHeight,localGrade=0,localOld=0,newBankExcess=-Infinity,worstSpan;
        for(let j=0;j<=divisions;j++){
          const offset=half-j*road.width/divisions,sx=x+nx*offset,sz=z+nz*offset;
          const oldHeight=sampleElevation(source,sx,sz),height=sampleElevation(city,sx,sz);
          if(j){
            const before=Math.abs(oldHeight-previousOld)/step,after=Math.abs(height-previousHeight)/step;
            if(after>localGrade){localGrade=after;localOld=before;}
            const excess=after-Math.max(.06,before+.002);
            if(excess>newBankExcess){newBankExcess=excess;worstSpan={x:sx,z:sz,before,after};}
          }
          previousOld=oldHeight;previousHeight=height;
        }
        samples.push({id:road.id,width:road.width,x,z,old:crossfall(source),grade:crossfall(city),junction:nearJunction(x,z),localGrade,localOld,newBankExcess,worstSpan});
      }
    }
  }
  return samples;
}
const quantile=(rows,q)=>[...rows].sort((a,b)=>a.grade-b.grade)[Math.floor(rows.length*q)].grade;
const sections=crossSections();

test('map-wide major road crossfall improves across actual rendered widths, including isolated worst cases',()=>{
  const rows=sections.filter(row=>row.width>=7),interior=rows.filter(row=>!row.junction);
  assert.ok(rows.length>80000&&interior.length>45000,'audit must cover the whole current road network');
  const oldMean=rows.reduce((sum,row)=>sum+row.old,0)/rows.length;
  const mean=rows.reduce((sum,row)=>sum+row.grade,0)/rows.length;
  assert.ok(mean<oldMean*.15,'road leveling must substantially improve the source DEM crossfall');
  assert.ok(quantile(rows,.95)<.01,'95% of full-width road sections stay below 1% crossfall');
  assert.ok(quantile(rows,.99)<.02,'junction blending cannot spread large banks through the network');
  assert.ok(quantile(interior,.99)<.018,'road interiors stay nearly level across their width');
  // Percentiles alone would hide the isolated locations reported by players.
  const worst=[...rows].sort((a,b)=>b.grade-a.grade)[0];
  const worstInterior=[...interior].sort((a,b)=>b.grade-a.grade)[0];
  assert.ok(worst.grade<.06,`severe bank on ${worst.id} at ${worst.x},${worst.z}: ${worst.grade}`);
  assert.ok(worstInterior.grade<.055,`severe interior bank on ${worstInterior.id} at ${worstInterior.x},${worstInterior.z}: ${worstInterior.grade}`);
});

test('all road widths stay smooth between the curbs, including narrow lanes and steep junctions',()=>{
  const narrow=sections.filter(row=>row.width<7);
  assert.ok(sections.length>90000&&narrow.length>6000,'coverage includes all narrow lanes');
  assert.equal(new Set(narrow.map(row=>row.id)).size,94,'all current 4.2m lanes are exercised');
  const local=sections.map(row=>({...row,grade:row.localGrade}));
  assert.ok(quantile(local,.95)<.02,'95% of pavement cross-sections must have no internal lateral segment steeper than 2%');
  const maximum=local.reduce((a,b)=>a.grade>b.grade?a:b);
  assert.ok(maximum.grade<=.06,`remaining absolute internal bank on ${maximum.id} at ${maximum.x},${maximum.z}: ${(maximum.grade*100).toFixed(2)}%`);
  const worst=sections.reduce((a,b)=>a.newBankExcess>b.newBankExcess?a:b),span=worst.worstSpan;
  assert.ok(worst.newBankExcess<=0,`new internal bank on ${worst.id} at ${span.x},${span.z}: ${(span.after*100).toFixed(2)}% (source ${(span.before*100).toFixed(2)}%); ${worst.junction?'junction':'interior'}`);
  for(const fixture of [
    {id:'13512-0-0',x:-2690.332359,z:2465.165019,name:'Estey Street'},
    {id:'17845-0-0',x:-2736.107359,z:2091.509238,name:'Eldora Street'},
    {id:'3336-0-0',x:-2705.626007,z:2060.079907,name:'Hillside Street'},
  ]){
    const nearby=sections.filter(row=>row.id===fixture.id&&Math.hypot(row.x-fixture.x,row.z-fixture.z)<3);
    assert.ok(nearby.length>0,`${fixture.name} regression must hit the reported geometry`);
    assert.ok(nearby.every(row=>row.localGrade<.06),`${fixture.name} must not regain its hidden central ridge or dip`);
  }
});

test('leveling across streets does not introduce short artificial longitudinal humps or dips',()=>{
  for(const fixture of [
    {id:'13860-0-0',x:-2465.0389926085445,z:2475.700773570404,name:'Fisher Avenue',kind:'crest'},
    {id:'15445-0-0',x:1989.1936677428714,z:-1375.3131705134324,name:'Commercial',kind:'dip'},
    {id:'14192-0-0',x:992.030744143606,z:-998.4043734454291,name:'Ashburton Place',kind:'dip'},
  ]){
    const road=ordinary.find(r=>r.id===fixture.id),stations=[0];
    for(let i=1;i<road.points.length;i++)stations.push(stations.at(-1)+Math.hypot(road.points[i][0]-road.points[i-1][0],road.points[i][1]-road.points[i-1][1]));
    let closest={distance:Infinity,station:0};
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=stations[i]-stations[i-1];
      if(length<.01)continue;
      const t=Math.max(0,Math.min(1,((fixture.x-a[0])*dx+(fixture.z-a[1])*dz)/(length*length)));
      const distance=Math.hypot(fixture.x-a[0]-dx*t,fixture.z-a[1]-dz*t);
      if(distance<closest.distance)closest={distance,station:stations[i-1]+length*t};
    }
    assert.ok(closest.distance<.01&&closest.station>12&&closest.station<stations.at(-1)-12,'fixture must lie inside its real source centerline');
    const pointAt=station=>{
      let i=1;while(i<stations.length-1&&stations[i]<station)i++;
      const a=road.points[i-1],b=road.points[i],t=(station-stations[i-1])/(stations[i]-stations[i-1]);
      return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    };
    const deviationFromChord=data=>{
      const [a,b,c]=[-12,0,12].map(offset=>sampleElevation(data,...pointAt(closest.station+offset)));
      const chord=(a+c)/2;
      return fixture.kind==='crest'?Math.max(0,b-chord):Math.max(0,chord-b);
    };
    const before=deviationFromChord(source),after=deviationFromChord(city);
    assert.ok(after<=before+.3,`${fixture.name} gained a short artificial ${fixture.kind}: ${after.toFixed(2)}m versus ${before.toFixed(2)}m in source terrain`);
  }
});

test('roadbed leveling preserves the broad elevation range of all four Mission Hill corridors',()=>{
  for(const name of ['Parker Hill Avenue','Calumet Street','Hillside Street','Fisher Avenue']){
    const points=ordinary.filter(road=>road.name===name).flatMap(road=>road.points);
    assert.ok(points.length>10,`${name} needs real source fixtures`);
    const range=data=>{const heights=points.map(point=>sampleElevation(data,...point));return Math.max(...heights)-Math.min(...heights);};
    const before=range(source),after=range(city);
    assert.ok(before>15&&Math.abs(after-before)<1,`${name} must retain its hill: ${before}m before, ${after}m after`);
  }
});
