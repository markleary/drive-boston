import assert from 'node:assert/strict';
import test from 'node:test';
import {PAD_BUTTONS,createGamepadReader,padDriveInput,padFlightInput,padGlyph,padStick,padTrigger,spatialNeighbor} from '../src/ui/gamepad.ts';

/** A standard-mapping pad; `held` names buttons, `axes` are [lx,ly,rx,ry], triggers are analog values. */
function pad({index=0,mapping='standard',held=[],axes=[0,0,0,0],lt=0,rt=0,connected=true}={}){
  const buttons=Array.from({length:17},(_,i)=>({pressed:false,value:0}));
  for(const name of held)buttons[PAD_BUTTONS[name]]={pressed:true,value:1};
  buttons[PAD_BUTTONS.LT]={pressed:lt>.1,value:lt};buttons[PAD_BUTTONS.RT]={pressed:rt>.1,value:rt};
  return{index,id:`pad ${index}`,connected,mapping,axes,buttons};
}
const frame=(overrides={})=>({...createGamepadReader().poll(0,[pad()]),...overrides});

test('sticks ignore drift and rescale from the edge of the dead zone',()=>{
  assert.deepEqual(padStick(.1,-.08),[0,0]);
  const [x]=padStick(.5,0);assert.ok(x>.35&&x<.45);
  assert.deepEqual(padStick(1,0),[1,0]);
  assert.deepEqual(padStick(Number.NaN,undefined),[0,0]);
  assert.equal(padTrigger(.03),0);assert.equal(padTrigger(1),1);
});

test('the controller in use is the one last touched, not slot 0',()=>{
  const reader=createGamepadReader();
  // An idle non-standard device sits in slot 0; the player presses A on slot 1.
  let result=reader.poll(0,[pad({index:0,mapping:''}),pad({index:1,held:['A']})]);
  assert.equal(result.id,'pad 1');assert.ok(result.pressed.has('A'));assert.ok(result.active);
  // Still held: no new press, and the selection stays put while slot 0 idles.
  result=reader.poll(16,[pad({index:0,mapping:''}),pad({index:1,held:['A']})]);
  assert.equal(result.id,'pad 1');assert.equal(result.pressed.size,0);assert.ok(result.held.has('A'));
  assert.ok(Math.abs(result.dt-.016)<1e-9);
  // A null slot and a disconnected pad are skipped; with nothing left the frame is idle.
  assert.equal(reader.poll(32,[null,pad({index:1,connected:false})]).connected,false);
  assert.equal(reader.poll(48,null).connected,false);
});

test('unplugging the controller in use is reported even when another device remains',()=>{
  const reader=createGamepadReader();
  assert.equal(reader.poll(0,[pad({index:0,held:['A']}),pad({index:1,mapping:''})]).id,'pad 0');
  const after=reader.poll(16,[null,pad({index:1,mapping:''})]);
  assert.equal(after.lost,true);assert.equal(after.connected,true);assert.equal(after.id,'pad 1');
  assert.equal(reader.poll(32,[null,pad({index:1,mapping:''})]).lost,false);
  // Unplugging the last one is reported the same way.
  const empty=reader.poll(48,[]);assert.equal(empty.lost,true);assert.equal(empty.connected,false);
  assert.equal(reader.poll(64,[]).lost,false);
});

test('a standard mapping wins when no pad has been touched yet',()=>{
  const result=createGamepadReader().poll(0,[pad({index:0,mapping:''}),pad({index:1})]);
  assert.equal(result.id,'pad 1');assert.equal(result.active,false);
});

test('triggers count as held buttons only past half travel',()=>{
  const reader=createGamepadReader();
  let result=reader.poll(0,[pad({rt:.3})]);
  assert.equal(result.held.has('RT'),false);assert.ok(result.rt>.2&&result.rt<.3);
  result=reader.poll(16,[pad({rt:.8})]);assert.ok(result.pressed.has('RT'));
});

test('menu navigation repeats like a held arrow key',()=>{
  const reader=createGamepadReader();
  assert.equal(reader.poll(0,[pad({held:['Down']})]).nav,'down');
  assert.equal(reader.poll(200,[pad({held:['Down']})]).nav,null);
  assert.equal(reader.poll(400,[pad({held:['Down']})]).nav,'down');
  assert.equal(reader.poll(450,[pad({held:['Down']})]).nav,null);
  assert.equal(reader.poll(520,[pad({held:['Down']})]).nav,'down');
  assert.equal(reader.poll(540,[pad()]).nav,null);
  // The left stick navigates along its dominant axis.
  assert.equal(reader.poll(560,[pad({axes:[-.9,.2,0,0]})]).nav,'left');
});

test('LT brakes in proportion while rolling, then reverses near a stop',()=>{
  const braking=padDriveInput(frame({lt:.4}),12);
  assert.equal(braking.brake,.4);assert.equal(braking.throttle,0);
  const reversing=padDriveInput(frame({lt:1}),.2);
  assert.equal(reversing.throttle,-1);assert.equal(reversing.brake,0);
  // RT brakes a car that is rolling backwards, then drives forward.
  assert.deepEqual([padDriveInput(frame({rt:.5}),-3).brake,padDriveInput(frame({rt:.5}),-3).throttle],[.5,0]);
  assert.equal(padDriveInput(frame({rt:.5}),0).throttle,.5);
  assert.equal(padDriveInput(frame({rt:1,lt:.3}),10).throttle,1);
});

test('left stick steers left as positive, A is the handbrake and X the wheelie',()=>{
  const input=padDriveInput(frame({lx:-.7,held:new Set(['A','X'])}),5);
  assert.equal(input.steer,.7);assert.equal(input.handbrake,true);assert.equal(input.wheelie,true);
  assert.deepEqual(padDriveInput(frame({connected:false}),0),{throttle:0,brake:0,steer:0,handbrake:false,wheelie:false});
});

test('flight: left stick moves, right stick or bumpers turn, triggers climb and descend',()=>{
  assert.deepEqual(padFlightInput(frame({lx:.5,ly:-1,rx:-.25,rt:.6,lt:.1})),{forward:1,strafe:.5,turn:-.25,lift:.5});
  assert.equal(padFlightInput(frame({held:new Set(['RB'])})).turn,1);
  assert.equal(padFlightInput(frame({rx:.6,held:new Set(['RB'])})).turn,1);
});

test('spatial navigation stays in the row and column the player expects',()=>{
  // Settings-like layout: two rows of segmented buttons, then a primary and a text button.
  const box=(left,top,width=100,height=30)=>({left,top,right:left+width,bottom:top+height});
  const boxes=[box(0,0),box(102,0),box(204,0),box(0,60,150),box(152,60,150),box(0,120,200,48),box(220,130,80,20),box(0,190,120,20)];
  assert.equal(spatialNeighbor(boxes[0],boxes,'right'),1);
  assert.equal(spatialNeighbor(boxes[2],boxes,'right'),-1);
  assert.equal(spatialNeighbor(boxes[0],boxes,'down'),3);
  assert.equal(spatialNeighbor(boxes[2],boxes,'down'),4);
  assert.equal(spatialNeighbor(boxes[4],boxes,'down'),6);
  assert.equal(spatialNeighbor(boxes[6],boxes,'left'),5);
  // Nothing lies inside the cone below the text button, so down falls back to the nearest box past the edge.
  assert.equal(spatialNeighbor(boxes[6],boxes,'down'),7);
  assert.equal(spatialNeighbor(boxes[3],boxes,'up'),0);
  assert.equal(spatialNeighbor(boxes[0],boxes,'up'),-1);
});

test('glyphs carry an accessible name for every control',()=>{
  assert.match(padGlyph('A'),/class="pad-glyph face pad-a".*aria-label="A button".*>A</);
  assert.match(padGlyph('RT'),/shoulder.*>RT</);
  assert.match(padGlyph('L3'),/stick click.*aria-label="Press left stick".*>LS</);
  assert.match(padGlyph('DpadLR'),/dpad.*<svg/);
  assert.match(padGlyph('Menu'),/icon.*aria-label="Menu button"/);
});
