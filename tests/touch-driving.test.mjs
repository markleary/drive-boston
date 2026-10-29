import assert from 'node:assert/strict';
import test from 'node:test';
import {createTouchDrivingState,normalizeTouchStick} from '../src/ui/touch-driving.ts';

const released={throttle:0,brake:0,steer:0,handbrake:false,wheelie:false};
function controls(){const state=createTouchDrivingState();state.setSuspended(false);return state;}

test('analog steering remains proportional and ignores vertical thumb drift',()=>{
  const state=controls();state.moveStick(-.5,1);
  assert.ok(state.getInput().steer>.4&&state.getInput().steer<.5);
  assert.equal(state.getInput().throttle,0);
  assert.deepEqual(normalizeTouchStick(.1,.9,'analog'),{x:0,y:0});
  state.moveStick(-2,0);assert.equal(state.getInput().steer,1);
  state.reset();assert.deepEqual(state.getInput(),released);
});

test('the pedal brake overrides gas without applying the handbrake or reversing',()=>{
  const state=controls();state.press(1,'gas');assert.equal(state.getInput().throttle,1);
  state.press(2,'brake');assert.deepEqual(state.getInput(),{...released,brake:1});
  state.release(2);assert.equal(state.getInput().throttle,1);
  state.release(1);state.press(3,'handbrake');assert.deepEqual(state.getInput(),{...released,handbrake:true});
});

test('two fingers on one pedal release independently',()=>{
  const state=controls();state.press(10,'gas');state.press(11,'gas');
  state.release(10);assert.equal(state.getInput().throttle,1);
  state.release(11);assert.deepEqual(state.getInput(),released);
});

test('direction changes require near standstill and release existing inputs',()=>{
  const state=controls();state.press(1,'gas');state.moveStick(.5,0);state.setSpeed(4);
  assert.equal(state.setGear(-1),false);assert.equal(state.getGear(),1);assert.equal(state.getInput().throttle,1);
  state.setSpeed(.1);assert.equal(state.setGear(-1),true);assert.deepEqual(state.getInput(),released);
  state.press(2,'gas');assert.equal(state.getInput().throttle,-1);
  state.setSpeed(-2);assert.equal(state.setGear(1),false);
});

test('combined joystick mixes proportional throttle and steering and returns to neutral',()=>{
  const state=controls();state.setMode('joystick');state.moveStick(-1,-1);
  assert.ok(Math.abs(state.getInput().steer-Math.SQRT1_2)<1e-12);
  assert.ok(Math.abs(state.getInput().throttle-Math.SQRT1_2)<1e-12);
  state.moveStick(0,1);assert.equal(state.getInput().throttle,-1);assert.equal(state.getInput().brake,0);
  state.moveStick(0,0);assert.deepEqual(state.getInput(),released);
  assert.equal(state.press(1,'gas'),false,'hidden pedal input cannot leak into joystick mode');
});

test('pause, switching layouts and entering flight clear all ground inputs',()=>{
  const state=controls();state.press(1,'gas');state.moveStick(.7,0);state.setSuspended(true);
  assert.deepEqual(state.getInput(),released);assert.equal(state.press(2,'gas'),false);
  state.setSuspended(false);assert.deepEqual(state.getInput(),released);
  state.press(3,'gas');state.setMode('joystick');assert.deepEqual(state.getInput(),released);
  state.moveStick(0,-1);state.setTravelMode('helicopter');assert.deepEqual(state.getInput(),released);
  state.setTravelMode('drive');assert.deepEqual(state.getInput(),released);
});

test('wheelie input is available only while riding and clears on mode change',()=>{
  const state=controls();assert.equal(state.press(1,'wheelie'),false);
  state.setTravelMode('bike');assert.equal(state.press(2,'wheelie'),true);assert.equal(state.getInput().wheelie,true);
  state.setTravelMode('drive');assert.deepEqual(state.getInput(),released);
});
