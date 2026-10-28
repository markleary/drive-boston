import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createMinimapLabeler,abbreviateRoadName} from '../src/ui/minimap-labels.ts';

const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url),'utf8'));
const labeler=createMinimapLabeler(city.roads),measureText=text=>text.length*5.6;

test('connected short GIS fragments label a named through road once and ignore public alleys',()=>{
  const roads=Array.from({length:12},(_,i)=>({id:String(i),name:'Beacon Street',width:12,oneway:0,points:[[-300+i*50,70],[-250+i*50,70]]}));
  roads.push({id:'alley',name:'Public Alley 418',width:4.2,oneway:0,points:[[-300,-50],[300,-50]]});
  const labels=createMinimapLabeler(roads)({center:[0,0],scale:216/460,width:216,height:216,measureText});
  assert.deepEqual(labels.map(label=>label.name),['Beacon Street']);
  assert.equal(labels[0].text,'Beacon St');
  assert.equal(abbreviateRoadName('Commonwealth Avenue'),'Commonwealth Ave');
});

test('real Boston minimap fixtures show useful major streets in distinct neighborhoods',()=>{
  const cases=[
    {center:[city.spawn.x,city.spawn.z],expected:['Boylston Street','Dartmouth Street','Newbury Street']},
    {center:[-2193.769866,2303.505],expected:['Parker Hill Avenue','Hillside Street']},
    {center:[1917.3601,-700.6415],expected:['Atlantic Avenue','Purchase Street']},
  ];
  for(const {center,expected}of cases){
    const labels=labeler({center,scale:216/460,width:216,height:216,measureText});
    for(const name of expected)assert.ok(labels.some(label=>label.name===name),`${name} must be readable at ${center}`);
  }
});

test('labels remain upright, inside the circular crop, and clear of map markers at driving and flight scales',()=>{
  for(const width of [128,156,216])for(const range of [460,700,1100])for(const center of [[city.spawn.x,city.spawn.z],[-2193.77,2303.5],[1917.36,-700.64]]){
    const fontSize=width<160?10:11,scale=width/range;
    const reserved=city.landmarks.map(landmark=>({x:(landmark.position[0]-center[0])*scale+width/2,y:(landmark.position[1]-center[1])*scale+width/2,radius:7}));
    const labels=labeler({center,scale,width,height:width,measureText,fontSize,reserved});
    assert.equal(new Set(labels.map(label=>label.name)).size,labels.length);
    assert.ok(labels.length<=(width<160?4:6));
    const markers=[{x:width/2,y:width/2,radius:width<160?16:20},{x:width/2,y:14,radius:12},...reserved];
    for(let i=0;i<labels.length;i++){
      const label=labels[i],cos=Math.cos(label.angle),sin=Math.sin(label.angle),half=measureText(label.text)/2+3,high=fontSize/2+3;
      assert.ok(Math.abs(label.angle)<=Math.PI/2,'road names must never read upside down');
      for(const u of [-1,1])for(const v of [-1,1]){
        const x=label.x+u*half*cos-v*high*sin,y=label.y+u*half*sin+v*high*cos;
        assert.ok(Math.hypot(x-width/2,y-width/2)<=width/2-6+.001,'the entire text/halo must survive the circle crop');
      }
      for(const marker of markers){
        const dx=marker.x-label.x,dy=marker.y-label.y;
        const nearestX=Math.max(0,Math.abs(dx*cos+dy*sin)-half),nearestY=Math.max(0,Math.abs(-dx*sin+dy*cos)-high);
        assert.ok(Math.hypot(nearestX,nearestY)>=marker.radius-.001,'text must leave player, north and landmark markers visible');
      }
      for(const other of labels.slice(i+1))assert.ok(label.bounds.right+3<=other.bounds.left||other.bounds.right+3<=label.bounds.left||label.bounds.bottom+3<=other.bounds.top||other.bounds.bottom+3<=label.bounds.top,'labels must not overlap');
    }
  }
});

test('small viewpoint changes retain world-space text anchors instead of sliding labels along streets',()=>{
  const center=[city.spawn.x,city.spawn.z],scale=216/460;
  const before=labeler({center,scale,width:216,height:216,measureText});
  const after=labeler({center:[center[0]+1,center[1]],scale,width:216,height:216,measureText});
  const shared=before.filter(label=>after.some(next=>next.name===label.name));
  assert.ok(shared.length>=2);
  for(const label of shared){
    const next=after.find(next=>next.name===label.name);
    assert.ok(Math.abs(next.x-label.x+scale)<.001&&Math.abs(next.y-label.y)<.001,'the same name should track a fixed mapped position');
  }
});
