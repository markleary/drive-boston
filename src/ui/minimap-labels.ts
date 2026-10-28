import type {Point2,Road} from '../types';

export interface MapLabelBounds {left:number;right:number;top:number;bottom:number;}
export interface MinimapRoadLabel {name:string;text:string;x:number;y:number;angle:number;bounds:MapLabelBounds;}
export interface MinimapLabelView {
  center:Point2; scale:number; width:number; height:number;
  measureText:(text:string)=>number; fontSize?:number; maxLabels?:number;
  reserved?:{x:number;y:number;radius:number}[];
}
type Path={points:Point2[];stations:number[];length:number};
type Anchor={name:string;text:string;path:Path;station:number;point:Point2;priority:number};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const nodeKey=(p:Point2)=>`${Math.round(p[0]*10)},${Math.round(p[1]*10)}`;

export function abbreviateRoadName(name:string){
  return name.replace(/\bStreet\b/g,'St').replace(/\bAvenue\b/g,'Ave').replace(/\bBoulevard\b/g,'Blvd')
    .replace(/\bParkway\b/g,'Pkwy').replace(/\bRoad\b/g,'Rd').replace(/\bPlace\b/g,'Pl')
    .replace(/\bSquare\b/g,'Sq').replace(/\bTerrace\b/g,'Ter');
}

function at(path:Path,station:number):Point2{
  let low=1,high=path.stations.length-1;
  while(low<high){const mid=(low+high)>>1;if(path.stations[mid]<station)low=mid+1;else high=mid;}
  const a=path.points[low-1],b=path.points[low],t=clamp((station-path.stations[low-1])/(path.stations[low]-path.stations[low-1]),0,1);
  return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
}

/** Join contiguous GIS fragments of one named road. Branches favor the straight
 * continuation, so a name follows the street rather than a short side spur. */
function paths(roads:Road[]):Path[]{
  const edges=roads.filter(r=>r.points.length>1).map(road=>({points:road.points,used:false}));
  const endpoints=new Map<string,number[]>();
  edges.forEach((edge,i)=>{for(const p of [edge.points[0],edge.points.at(-1)!]){const key=nodeKey(p),list=endpoints.get(key)??[];list.push(i);endpoints.set(key,list);}});
  const result:Path[]=[];
  for(const edge of edges){
    if(edge.used)continue;edge.used=true;const points=[...edge.points];
    const extend=()=>{for(;;){
      const end=points.at(-1)!,previous=points.at(-2)!,dx=end[0]-previous[0],dz=end[1]-previous[1],length=Math.hypot(dx,dz)||1;
      let best=-1,bestDot=-.2,reverse=false;
      for(const i of endpoints.get(nodeKey(end))??[]){const candidate=edges[i];if(candidate.used)continue;
        const flipped=nodeKey(candidate.points[0])!==nodeKey(end),next=candidate.points[flipped?candidate.points.length-2:1];
        const distance=Math.hypot(next[0]-end[0],next[1]-end[1]);if(distance<.001)continue;
        const dot=((next[0]-end[0])*dx+(next[1]-end[1])*dz)/length/distance;
        if(dot>bestDot){best=i;bestDot=dot;reverse=flipped;}
      }
      if(best<0)break;const next=edges[best];next.used=true;points.push(...(reverse?[...next.points].reverse():next.points).slice(1));
    }};
    extend();points.reverse();extend();
    const clean=points.filter((p,i)=>i===0||Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1])>.001);
    const stations=[0];for(let i=1;i<clean.length;i++)stations.push(stations[i-1]+Math.hypot(clean[i][0]-clean[i-1][0],clean[i][1]-clean[i-1][1]));
    if(stations.at(-1)!>1)result.push({points:clean,stations,length:stations.at(-1)!});
  }
  return result;
}

/** Build stable world-space anchors once. Layout only visits nearby buckets;
 * screen-space exclusions keep text clear of markers and the circular edge. */
export function createMinimapLabeler(roads:Road[]){
  const groups=new Map<string,Road[]>(),buckets=new Map<string,Anchor[]>(),cell=128;
  for(const road of roads){
    if(!road.name||road.width<7||/alley|unnamed|private|service/i.test(road.name))continue;
    const group=groups.get(road.name)??[];group.push(road);groups.set(road.name,group);
  }
  for(const [name,group]of groups){
    const chains=paths(group),length=chains.reduce((sum,p)=>sum+p.length,0),width=Math.max(...group.map(r=>r.width));
    if(width<8&&length<350)continue;
    const priority=width*2+Math.log1p(length)*3,text=abbreviateRoadName(name);
    for(const path of chains){
      const count=Math.max(1,Math.ceil(path.length/36));
      for(let i=0;i<count;i++){
        const station=(i+.5)*path.length/count,point=at(path,station),anchor={name,text,path,station,point,priority};
        const key=`${Math.floor(point[0]/cell)},${Math.floor(point[1]/cell)}`,list=buckets.get(key)??[];list.push(anchor);buckets.set(key,list);
      }
    }
  }
  // Layout keeps state between frames. Re-ranking every anchor by distance on
  // each redraw made names hop along their streets as the car moved, so a label
  // stays on the anchor it was drawn at for as long as that anchor still fits.
  let shown:Anchor[]=[],last:Point2|undefined,heading:Point2=[0,0];
  return ({center,scale,width,height,measureText,fontSize=11,maxLabels=width<160?4:6,reserved=[]}:MinimapLabelView):MinimapRoadLabel[]=>{
    if(scale<=0||Math.min(width,height)<60){shown=[];last=undefined;return[];}
    const cx=width/2,cy=height/2,radius=Math.min(cx,cy)-6,worldRadius=(radius+10)/scale;
    // Smoothed travel direction from view movement. A jump beyond the view is a
    // teleport that resets the layout; a stopped view gradually forgets heading.
    const mx=last?center[0]-last[0]:0,mz=last?center[1]-last[1]:0,moved=last?Math.hypot(mx,mz):Infinity;
    if(moved>worldRadius){shown=[];heading=[0,0];}
    else if(moved>.05)heading=[heading[0]*.6+mx/moved*.4,heading[1]*.6+mz/moved*.4];
    else heading=[heading[0]*.8,heading[1]*.8];
    last=[center[0],center[1]];
    const pace=Math.hypot(...heading),drift:Point2|undefined=pace>.3?[-heading[0]/pace,-heading[1]/pace]:undefined,travel=radius*.25;
    const candidates:{anchor:Anchor;x:number;y:number;distance:number}[]=[];
    for(let x=Math.floor((center[0]-worldRadius)/cell);x<=Math.floor((center[0]+worldRadius)/cell);x++)
      for(let z=Math.floor((center[1]-worldRadius)/cell);z<=Math.floor((center[1]+worldRadius)/cell);z++)
        for(const anchor of buckets.get(`${x},${z}`)??[]){
          const px=(anchor.point[0]-center[0])*scale+cx,py=(anchor.point[1]-center[1])*scale+cy,distance=Math.hypot(px-cx,py-cy);
          if(distance<radius)candidates.push({anchor,x:px,y:py,distance});
        }
    // Fit every candidate first. Labels drawn last frame then go first, in
    // their previous order, so they keep their places; remaining slots go to
    // the best nearby anchors.
    const previous=new Map(shown.map((anchor,i)=>[anchor,i])),measurements=new Map<string,number>();
    const markers=[{x:cx,y:cy,radius:width<160?16:20},{x:cx,y:14,radius:12}],exclusions=[...markers,...reserved];
    const fitted:{anchor:Anchor;x:number;y:number;angle:number;bounds:MapLabelBounds;rank:number;score:number}[]=[];
    for(const {anchor,x,y,distance} of candidates){
      const textWidth=measurements.get(anchor.text)??measureText(anchor.text);measurements.set(anchor.text,textWidth);
      const half=textWidth/2+3,high=fontSize/2+3,reach=half/scale;
      if(anchor.station<reach||anchor.path.length-anchor.station<reach)continue;
      const a=at(anchor.path,anchor.station-reach),b=at(anchor.path,anchor.station+reach);
      let angle=Math.atan2(b[1]-a[1],b[0]-a[0]);if(angle>Math.PI/2)angle-=Math.PI;if(angle< -Math.PI/2)angle+=Math.PI;
      const cos=Math.cos(angle),sin=Math.sin(angle);
      // Reject hairpins or strongly curved spans: straight text must still sit
      // on the mapped street throughout its length.
      if(Math.hypot(b[0]-a[0],b[1]-a[1])*scale<half*1.8)continue;
      if([-.5,0,.5].some(t=>{const p=at(anchor.path,anchor.station+reach*t);return Math.abs(-(p[0]-anchor.point[0])*sin+(p[1]-anchor.point[1])*cos)*scale>4;}))continue;
      // Text centered at (px,py) stays inside the circular crop and clear of markers.
      const fits=(px:number,py:number,avoid:typeof exclusions)=>[-1,1].every(u=>[-1,1].every(v=>Math.hypot(px+cos*half*u-sin*high*v-cx,py+sin*half*u+cos*high*v-cy)<=radius))
        &&!avoid.some(p=>{const dx=p.x-px,dy=p.y-py,rx=Math.abs(dx*cos+dy*sin),ry=Math.abs(-dx*sin+dy*cos);return Math.hypot(Math.max(0,rx-half),Math.max(0,ry-high))<p.radius;});
      if(!fits(x,y,exclusions))continue;
      // While moving, measure how far new text could drift before leaving the
      // crop or sliding under the car or north marker. Short-lived spots (often
      // the street being driven, just ahead of the car) would only flicker, and
      // longer-lived ones are preferred.
      const rank=previous.get(anchor)??previous.size;let survival=0;
      if(drift&&rank===previous.size){
        const step=travel/4;while(survival<radius*2&&fits(x+drift[0]*(survival+step),y+drift[1]*(survival+step),markers))survival+=step;
        if(survival<travel)continue;
      }
      const corners=[-1,1].flatMap(u=>[-1,1].map(v=>[x+cos*half*u-sin*high*v,y+sin*half*u+cos*high*v] as Point2));
      const bounds={left:Math.min(...corners.map(p=>p[0])),right:Math.max(...corners.map(p=>p[0])),top:Math.min(...corners.map(p=>p[1])),bottom:Math.max(...corners.map(p=>p[1]))};
      fitted.push({anchor,x,y,angle,bounds,rank,score:anchor.priority+(survival-distance)*.04});
    }
    fitted.sort((a,b)=>a.rank-b.rank||b.score-a.score||a.anchor.name.localeCompare(b.anchor.name)||a.anchor.station-b.anchor.station);
    const labels:MinimapRoadLabel[]=[],placed:Anchor[]=[],names=new Set<string>();
    for(const {anchor,x,y,angle,bounds} of fitted){
      if(names.has(anchor.name))continue;
      if(labels.some(label=>bounds.left<label.bounds.right+3&&bounds.right>label.bounds.left-3&&bounds.top<label.bounds.bottom+3&&bounds.bottom>label.bounds.top-3))continue;
      labels.push({name:anchor.name,text:anchor.text,x,y,angle,bounds});placed.push(anchor);names.add(anchor.name);if(labels.length>=maxLabels)break;
    }
    shown=placed;
    return labels;
  };
}
