import type { Point2 } from '../types';
import fenway from '../data/fenway-detail.json' with {type:'json'};

type Row = {start:Point2; end:Point2; out:Point2; step:number; startStation:number; roofLimit?:number};

/** Parallel rows on both faces of the outfield bleachers meet at the same
 * corner on every tier. Clip their outer ends to the mapped rim and leave
 * the rear walkway, including the scoreboard supports, clear. */
export function* fenwayBleacherRows():Generator<Row>{
  const rim=fenway.features.find(f=>f.role==='bleachers')!.points as Point2[];
  const fronts=[rim[6],rim[5],rim[4]],step=.84;
  const sections=fronts.slice(0,2).map((a,i)=>{
    const b=fronts[i+1],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    return {a,length,tx:dx/length,tz:dz/length};
  });
  const angle=Math.acos(Math.min(1,Math.max(-1,sections[0].tx*sections[1].tx+sections[0].tz*sections[1].tz)));
  const miter=Math.tan(angle/2);
  const edges=[6,0,1,2,3].map(i=>{
    const a=rim[i],b=rim[(i+1)%rim.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    return {a,nx:-dz/length,nz:dx/length,clearance:i===6||i===3?.4:3.2};
  });
  for(const [i,{a,length,tx,tz}] of sections.entries()){
    const out:Point2=[tz,-tx];
    const depth=Math.max(...rim.map(p=>(p[0]-a[0])*out[0]+(p[1]-a[1])*out[1]));
    for(let d=step/2;d<depth;d+=step){
      const x=a[0]+out[0]*d,z=a[1]+out[1]*d;
      let start=i===0?0:-d*miter,end=i===0?length+d*miter:length;
      for(const edge of edges){
        const distance=(x-edge.a[0])*edge.nx+(z-edge.a[1])*edge.nz-edge.clearance;
        const slope=tx*edge.nx+tz*edge.nz;
        if(Math.abs(slope)<1e-8){if(distance<0){end=start;break;}}
        else if(slope>0)start=Math.max(start,-distance/slope);
        else end=Math.min(end,-distance/slope);
      }
      if(end-start>1.1)yield {start:[x+tx*start,z+tz*start],end:[x+tx*end,z+tz*end],out,step,startStation:start};
    }
  }
}

export function* fenwaySeatingRows(roofAt:(x:number,z:number)=>number):Generator<Row>{
  yield* fenwayBleacherRows();
  function* straightRows(a:Point2,b:Point2,out:Point2,count:number,step=.84):Generator<Row>{
    for(let row=0;row<count;row++){
      const dx=out[0]*(row+.5)*step,dz=out[1]*(row+.5)*step;
      yield {start:[a[0]+dx,a[1]+dz],end:[b[0]+dx,b[1]+dz],out,step,startStation:0};
    }
  }
  yield* straightRows([-1901,438],[-1900,396],[-1,-.02],27);
  yield* straightRows([-1883,455],[-1800,435],[.234,.972],21);
  yield* straightRows([-1902,444],[-1883,455],[-.5,.866],23);
  const [,,right,left]=fenway.features.find(f=>f.role==='monster-seats')!.points as Point2[];
  const dx=right[0]-left[0],dz=right[1]-left[1],length=Math.hypot(dx,dz);
  for(const row of straightRows(left,right,[dz/length,-dx/length],3,.9)){
    // The center of each Monster tier is open seating deck. Two equipment
    // rooms interrupt these otherwise nearly level rows farther along.
    const deck=roofAt((row.start[0]+row.end[0])/2,(row.start[1]+row.end[1])/2);
    yield {...row,roofLimit:deck+1};
  }
}

/** Keep a tread level and extend its downhill riser into the slope.
 * An open edge or a jump to a different roof cannot support a tread. */
export function fenwayTreadSupport(roofAt:(x:number,z:number)=>number,x:number,z:number,out:Point2,step:number,roofLimit?:number){
  const dx=out[0]*step*.48,dz=out[1]*step*.48;
  const center=roofAt(x,z),front=roofAt(x-dx,z-dz),back=roofAt(x+dx,z+dz);
  const top=Math.max(center,front,back),bottom=Math.min(center,front,back);
  if(roofLimit!==undefined){
    if(top>roofLimit)return;
    // Allow a hand's breadth beside the housing, including where its corner
    // enters a tread without crossing the chair centerline.
    for(const side of [-.37,.37])for(const depth of [-1,1]){
      const along=depth*(step/2+.08);
      if(roofAt(x+out[0]*along-out[1]*side,z+out[1]*along+out[0]*side)>roofLimit)return;
    }
  }
  return Number.isFinite(bottom)&&top-bottom<1?{top:top+.08,bottom:bottom-.08}:undefined;
}
