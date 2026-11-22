import assert from 'node:assert/strict';
import test from 'node:test';
import {pointInPolygon} from '../src/simulation/city-tiles.ts';
import {createFenwayRoofSampler,fenwayDiamond,fenwayInfield,fenwayScoreboardMount} from '../src/render/fenway-layout.ts';
import {fenwayBleacherRows,fenwaySeatingRows,fenwayTreadSupport} from '../src/render/fenway-seating.ts';

const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

test('Fenway dirt surrounds home plate and keeps all four base paths clear of the grass',()=>{
  const diamond=fenwayDiamond(),{dirt,grass,platePoint}=fenwayInfield(diamond);
  for(const spot of [platePoint(0,-3.5),platePoint(-3,0),platePoint(3,0),platePoint(0,45)]){
    assert.ok(pointInPolygon(...spot,dirt));
    assert.ok(!pointInPolygon(...spot,grass));
  }
  const bases=[diamond.home,diamond.first,diamond.second,diamond.third];
  for(let i=0;i<bases.length;i++){
    const a=bases[i],b=bases[(i+1)%bases.length],length=distance(a,b);
    const dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length;
    for(let along=1;along<length;along++)for(const width of [-1,0,1]){
      const x=a[0]+dx*along-dz*width,z=a[1]+dz*along+dx*width;
      assert.ok(pointInPolygon(x,z,dirt)&&!pointInPolygon(x,z,grass),`open dirt path at ${x}, ${z}`);
    }
  }
  assert.ok(pointInPolygon(...diamond.mound,grass),'grass surrounds the separate raised mound');
});

test('outfield bleacher rows meet at their bend and leave the scoreboard supports clear',()=>{
  const rows=[...fenwayBleacherRows()],left=rows.filter(r=>r.out[0]<.8),right=rows.filter(r=>r.out[0]>.8);
  assert.ok(left.length>20&&right.length>30);
  for(let i=0;i<20;i++)assert.ok(distance(left[i].end,right[i].start)<.001,`shared corner on tier ${i}`);
  const roof=createFenwayRoofSampler(),scoreboard=fenwayScoreboardMount(roof);
  for(const {start,end} of rows){
    const dx=end[0]-start[0],dz=end[1]-start[1],length=distance(start,end);
    for(const foot of scoreboard.feet){
      const t=Math.max(0,Math.min(1,((foot.x-start[0])*dx+(foot.z-start[1])*dz)/length**2));
      assert.ok(distance([foot.x,foot.z],[start[0]+dx*t,start[1]+dz*t])>1.5);
    }
  }
});

test('all three Green Monster tiers follow the surveyed slope above the wall',()=>{
  const roof=createFenwayRoofSampler(),rows=[...fenwaySeatingRows(roof)].filter(row=>row.roofLimit!==undefined);
  assert.equal(rows.length,3);
  for(const {start,end,out,step,roofLimit} of rows){
    let supported=0;
    for(let i=1;i<100;i++){
      const x=start[0]+(end[0]-start[0])*i/100,z=start[1]+(end[1]-start[1])*i/100;
      const tread=fenwayTreadSupport(roof,x,z,out,step,roofLimit);
      if(!tread)continue;
      for(const offset of [-.48,0,.48]){
        const y=roof(x+out[0]*step*offset,z+out[1]*step*offset);
        assert.ok(tread.top>y&&tread.bottom<y);
      }
      supported++;
    }
    assert.ok(supported>80);
  }
  const {out,step,roofLimit}=rows[2];
  for(const [x,z] of [[-1876,343.8],[-1827,343]]){
    assert.ok(roof(x,z)>20,'the surveyed rooftop boxes stand above the seating deck');
    assert.equal(fenwayTreadSupport(roof,x,z,out,step,roofLimit),undefined);
  }
  for(const [x,z] of [[-1873.4,343.8],[-1824.25,343]]){
    assert.ok(roof(x,z)<18,'the center is clear but the tread edge would intersect the box');
    assert.equal(fenwayTreadSupport(roof,x,z,out,step,roofLimit),undefined);
  }
});
