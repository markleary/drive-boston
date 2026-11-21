import fellsmere from '../data/fellsmere.json' with { type: 'json' };
import {DEFAULT_CAR, CAR_POWERTRAINS, isPerformanceCar, isElectricCar, type PerformanceCarId, type PlayerCarId} from './player-cars.ts';
import type { DriveInput, TravelMode } from '../types';

type CombustionCarId = Exclude<PerformanceCarId, 'tesla-model-3-performance'>;
type CarLayer = 'idle'|'drive'|'high'|'upshift'|'downshift';
type CarSound = `${CombustionCarId}-${CarLayer}`;
const carSound=(id:CombustionCarId,layer:CarLayer):CarSound=>`${id}-${layer}`;
type TruckEffect = 'moving-truck-horn' | 'moving-truck-storrow-crash' | 'moving-truck-boo' | 'moving-truck-reverse';
const EV_DRIVE='tesla-model-3-performance-drive', EV_REVERSE='tesla-model-3-performance-reverse';
const EV_SOUNDS=[EV_DRIVE,EV_REVERSE] as const;
const WRX_SPOOL='subaru-wrx-turbo-spool',GT2_TURBO='maserati-gt2-stradale-turbo';
const GT2='maserati-gt2-stradale';
/** The Maserati has no downshift clip: its loops rise with the revs as the lower gear takes up, and a blip played
 * beside them stood apart from the engine (the generated one was taken for a dog's bark). */
const carLayers=(id:CombustionCarId):readonly CarLayer[]=>id===GT2?['idle','drive','high','upshift']:['idle','drive','high','upshift','downshift'];
/** Turbocharger loops, each heard through a band-pass that follows its pitch. */
const TURBO_SOUNDS=[WRX_SPOOL,GT2_TURBO] as const;
const turboSound=(id:PlayerCarId)=>id==='subaru-wrx'?[WRX_SPOOL] as const:id===GT2?[GT2_TURBO] as const:[];
const FOUNTAIN = 'pond-fountain';
const FOUNTAIN_RANGE = 145; // metres from a jet
type SoundName = typeof FOUNTAIN | CarSound | TruckEffect | typeof EV_SOUNDS[number] | typeof TURBO_SOUNDS[number] | 'engine-idle' | 'engine-drive' | 'city-ambience' | 'tire-road' | 'horn' | 'tire-skid' | 'helicopter-rotor' | 'crash-light' | 'crash-car' | 'crash-heavy' | 'pedestrian-thump';
/** What the player struck: another car (traffic or parked), a bus or tram, a building or barrier, the ground, or a walker. */
export type ImpactKind = 'vehicle' | 'heavy' | 'static' | 'ground' | 'pedestrian';
type ListenerPosition = { x: number; z: number };
type AudioControls = Partial<Pick<DriveInput, 'steer' | 'brake' | 'handbrake'>> & { lift?: number; verticalSpeed?: number; gear?:number; rpm?:number; storrowed?:boolean; wheelspin?:number; turboBoost?:number };
interface Loop { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode; releaseEnd?:number; }
const CAR_IDS=(Object.keys(CAR_POWERTRAINS) as PerformanceCarId[]).filter((id):id is CombustionCarId=>!isElectricCar(id));
const CAR_SOUNDS=CAR_IDS.flatMap(id=>carLayers(id).map(layer=>carSound(id,layer)));
const CAR_ENGINE_SOUNDS=CAR_IDS.flatMap(id=>(['idle','drive','high'] as const).map(layer=>carSound(id,layer)));
const COMMON_SOUNDS: SoundName[] = ['engine-idle', 'engine-drive', 'city-ambience', 'tire-road', 'horn', 'tire-skid', 'helicopter-rotor', 'crash-light', 'crash-car', 'crash-heavy', 'pedestrian-thump'];
const REVERSE_ALARM:TruckEffect='moving-truck-reverse';
const TRUCK_EFFECTS:TruckEffect[]=['moving-truck-horn','moving-truck-storrow-crash','moving-truck-boo',REVERSE_ALARM];
const SOUNDS:SoundName[] = [...CAR_SOUNDS, ...COMMON_SOUNDS,...TRUCK_EFFECTS,...EV_SOUNDS,...TURBO_SOUNDS];
const ONE_SHOTS = new Set<SoundName>([...TRUCK_EFFECTS.filter(name=>name!==REVERSE_ALARM),...CAR_IDS.flatMap(id=>carLayers(id).filter(layer=>layer==='upshift'||layer==='downshift').map(layer=>carSound(id,layer))),'horn', 'crash-light', 'crash-car', 'crash-heavy', 'pedestrian-thump']);
/** Velocity change (m/s in one physics step) below which a knock is a bump rather than a crash. */
const LIGHT_IMPACT = 3.5;
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));

/** Local sound assets only: no provider credentials or API calls in the browser. */
export class DriveAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private buffers = new Map<SoundName, AudioBuffer>();
  private loops = new Map<SoundName, Loop>();
  private retiringLoops = new Set<Loop>();
  private failed = new Set<SoundName>();
  private oneShots = new Set<AudioBufferSourceNode | OscillatorNode>();
  private hornShot?:AudioBufferSourceNode;
  private fallback?: { oscillator: OscillatorNode; gain: GainNode; filter: BiquadFilterNode };
  private electric?: {oscillator:OscillatorNode;gain:GainNode};
  private rotorFallback?: { oscillator: OscillatorNode; modulator: OscillatorNode; gain: GainNode };
  private carId:PlayerCarId=DEFAULT_CAR;
  private vehicleSounds = SOUNDS;
  private fountainWanted = false;
  private loadingFountain = false;
  private get wantedSounds(): SoundName[] { return this.fountainWanted ? [FOUNTAIN, ...this.vehicleSounds] : this.vehicleSounds; }
  private loadingMobileSounds = false;
  private previousDriveGear=0;
  private lastShift=-Infinity;
  private shiftCount=0;
  private get carEngineReady(){const id=this.carId;return isElectricCar(id)?this.loops.has(EV_DRIVE):isPerformanceCar(id)&&(['idle','drive','high'] as const).every(layer=>this.loops.has(carSound(id,layer)));}
  private readonly mobile:boolean;
  constructor(mobile = false) {
    this.mobile=mobile;
    if (mobile) this.vehicleSounds = COMMON_SOUNDS;
  }

  setCar(id:PlayerCarId){
    if(id===this.carId)return;this.carId=id;this.previousDriveGear=0;this.gear=0;this.rpm=850;this.stopOneShots();this.resetVehicleEffects();
    if(this.context)for(const name of ['engine-idle','engine-drive',...CAR_SOUNDS,...EV_SOUNDS] as SoundName[])this.loops.get(name)?.gain.gain.setTargetAtTime(0,this.context.currentTime,.025);
    this.electric?.gain.gain.setTargetAtTime(0,this.context!.currentTime,.025);
    if (this.mobile) {
      this.vehicleSounds = [...COMMON_SOUNDS.slice(0, 3), ...CAR_SOUNDS.filter(name => name.startsWith(id + '-')), ...COMMON_SOUNDS.slice(3),...(id==='moving-truck'?TRUCK_EFFECTS:[]),...(isElectricCar(id)?EV_SOUNDS:[]),...turboSound(id)];
      for (const name of [...CAR_SOUNDS,...TRUCK_EFFECTS,...EV_SOUNDS,...TURBO_SOUNDS] as const) {
        if (this.wantedSounds.includes(name)) continue;
        this.releaseSound(name);
        this.failed.delete(name);
      }
      if (this.context) void this.loadMobileSounds();
    }
  }
  private mode: TravelMode = 'drive';
  private disposed = false;
  private muted = false;
  private paused = true;
  private gear = 0;
  private rpm = 850;
  private previousTime = 0;
  private lastHorn = -Infinity;
  private lastImpact = new Map<ImpactKind, number>();
  private impactCount = 0;
  private lastStorrow=-Infinity;
  private storrowCount=0;
  private reverseAlarmNextBeep=0;
  private noise?: AudioBuffer;
  private gate = -1;

  get enabled() { return !this.muted; }
  set enabled(value: boolean) {
    this.muted = !value;
    if (this.muted) {this.stopOneShots();this.resetVehicleEffects();}
    this.syncMaster();
    if (value) this.resume();
  }

  setMode(mode: TravelMode) {
    if (mode === this.mode) return;
    this.mode = mode; this.previousDriveGear=0;this.stopOneShots();this.resetVehicleEffects();
    if (!this.context) return;
    const now = this.context.currentTime;
    const silent: SoundName[] = mode === 'helicopter' ? ['engine-idle', 'engine-drive', 'tire-road', 'tire-skid'] : mode==='bike'?['engine-idle','engine-drive','helicopter-rotor','tire-skid']:mode==='walk'?['engine-idle','engine-drive','helicopter-rotor','tire-road','tire-skid']:['helicopter-rotor'];
    if(mode!=='drive')silent.push(...CAR_SOUNDS,...EV_SOUNDS);
    this.electric?.gain.gain.setTargetAtTime(0,now,.1);
    for (const name of silent) this.loops.get(name)?.gain.gain.setTargetAtTime(0, now, 0.1);
    if (mode !== 'drive') this.fallback?.gain.gain.setTargetAtTime(0, now, 0.1);
    if(mode!=='helicopter')this.rotorFallback?.gain.gain.setTargetAtTime(0, now, 0.1);
  }

  /** A fresh, read-only snapshot for local diagnostics; never exposes audio nodes. */
  getStatus() {
    return {
      carId:this.carId,shiftCount:this.shiftCount,context: this.context?.state ?? 'not-started', mode: this.mode,
      enabled: this.enabled, paused: this.paused || document.hidden,
      loadedCount: this.buffers.size, expectedCount: this.wantedSounds.length,
      decodedBytes:[...this.buffers.values()].reduce((bytes,b)=>bytes+b.length*b.numberOfChannels*4,0),
      loading: !this.disposed && Boolean(this.context) && this.buffers.size + this.failed.size < this.wantedSounds.length,
      failed: [...this.failed], activeLoops: this.loops.size,
      activeOneShots: this.oneShots.size, fallback: Boolean(this.mode === 'drive' ? isElectricCar(this.carId)?!this.carEngineReady&&this.electric:this.fallback : this.mode==='helicopter'?this.rotorFallback:false),
      masterGain: this.master?.gain.value ?? 0, rpm: Math.round(this.rpm), gear: this.gear + 1,
      fountainGain: this.loops.get(FOUNTAIN)?.gain.gain.value ?? 0,
      rotorGain: this.loops.get('helicopter-rotor')?.gain.gain.value ?? 0,
      electricGain:this.electric?.gain.gain.value??0, impactCount: this.impactCount,storrowCount:this.storrowCount,
      reverseAlarm:this.loops.has(REVERSE_ALARM),electricReverse:this.loops.has(EV_REVERSE),
      electricReverseGain:this.loops.get(EV_REVERSE)?.gain.gain.value??0,
      electricReverseRate:this.loops.get(EV_REVERSE)?.source.playbackRate.value??0,
      turboGain:TURBO_SOUNDS.reduce((sum,name)=>sum+(this.loops.get(name)?.gain.gain.value??0),0),
      engineProfile:this.mode!=='drive'?'off':this.carEngineReady?this.carId:isElectricCar(this.carId)?'electric-fallback':this.loops.has('engine-idle')||this.loops.has('engine-drive')?'generic':this.fallback?'synthesized':'loading',
      engineGain: (this.loops.get('engine-idle')?.gain.gain.value ?? 0) + (this.loops.get('engine-drive')?.gain.gain.value ?? 0)+CAR_ENGINE_SOUNDS.reduce((sum,name)=>sum+(this.loops.get(name)?.gain.gain.value??0),0)+(this.fallback?.gain.gain.value??0)+(this.loops.get(EV_DRIVE)?.gain.gain.value??0)+(isElectricCar(this.carId)&&this.mode==='drive'?(this.electric?.gain.gain.value??0):0),
    };
  }

  /** Called from the Start button's user gesture; repeated calls are safe. */
  start() {
    if (this.disposed) return;
    if (!this.context) {
      try { this.context = new AudioContext({ latencyHint: 'interactive' }); }
      catch { return; }
      const context = this.context;
      this.master = context.createGain(); this.master.gain.value = 0;
      const highpass = context.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 35;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -14; compressor.knee.value = 18; compressor.ratio.value = 4;
      compressor.attack.value = 0.008; compressor.release.value = 0.18;
      this.master.connect(highpass); highpass.connect(compressor); compressor.connect(context.destination);
      document.addEventListener('visibilitychange', this.visibilityChanged);
      window.addEventListener('pagehide', this.hidePage);
      window.addEventListener('pointerdown', this.resume, { capture: true });
      window.addEventListener('keydown', this.resume, { capture: true });
      const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='sine';oscillator.frequency.value=160;gain.gain.value=0;oscillator.connect(gain);gain.connect(this.master);oscillator.start();this.electric={oscillator,gain};
      if (this.mobile) void this.loadMobileSounds();
      else void Promise.all(SOUNDS.map(name => this.loadSound(name))).then(() => this.ensureFallbacks());
    }
    // Resume directly in the user gesture, even before the next simulation tick.
    void this.context.resume().catch(() => {});
  }

  update(speed: number, throttle: number, paused: boolean, controls?: AudioControls, listener?: ListenerPosition) {
    const context = this.context;
    if (!context || this.disposed) return;
    if (paused && !this.paused) {this.stopOneShots();this.resetVehicleEffects();}
    this.paused = paused;
    this.syncMaster();
    this.updateReverseAlarm(!controls?.storrowed&&((controls?.gear??0)<0||speed<-.2));
    this.updateElectricReverse(speed,(controls?.gear??0)<0);
    const now = context.currentTime;
    const dt = clamp(now - this.previousTime, 0, 0.1); this.previousTime = now;
    if (paused || document.hidden) {this.previousDriveGear=0;return;}

    this.updateFountain(listener);
    const velocity = Math.abs(Number.isFinite(speed) ? speed : 0);
    const pedal = clamp(Number.isFinite(throttle) ? Math.abs(throttle) : 0);
    const braking = speed * throttle < -0.5;
    const load = braking ? 0 : pedal;
    if (this.mode === 'helicopter') {
      const lift = clamp(controls?.lift ?? 0, -1, 1);
      const climb = clamp((controls?.verticalSpeed ?? 0) / 7, -1, 1);
      const power = clamp(0.35 + Math.max(0, lift) * 0.35 + Math.max(0, climb) * 0.12 + velocity / 45 * 0.2);
      // A governor holds rotor speed nearly constant; load changes volume and
      // brightness more than pitch, even while climbing or moving quickly.
      this.rpm = 380 + power * 22;
      this.setLoop('helicopter-rotor', 0.48 + power * 0.18, 0.94 + power * 0.1, 2000 + power * 2100);
      this.setLoop('city-ambience', 0.08, 1, 2400);
      if (this.rotorFallback) {
        this.rotorFallback.gain.gain.setTargetAtTime(0.07 + power * 0.04, now, 0.15);
        this.rotorFallback.modulator.frequency.setTargetAtTime(17 + power * 2, now, 0.2);
      }
      return;
    }
    if(this.mode==='walk'){
      // Footsteps arrive one at a time from the gait.
      this.rpm=0;this.gear=0;this.setLoop('city-ambience',.2,1,5200);return;
    }
    if(this.mode==='bike'){
      this.rpm=0;this.gear=0;
      this.electric?.oscillator.frequency.setTargetAtTime(150+velocity*27+load*70,now,.12);
      this.electric?.gain.gain.setTargetAtTime((velocity>.3||load>.1)?(.008+load*.022):0,now,.10);
      this.setLoop('city-ambience',.15,1,4200);
      this.setLoop('tire-road',Math.pow(clamp(velocity/25),.8)*.22,.7+velocity/35,1700+velocity*80);
      this.setLoop('tire-skid',controls?.handbrake&&velocity>4?.10:0,1,2700);
      return;
    }
    if(isElectricCar(this.carId)){
      // A direct-drive EV has no combustion idle, exhaust layers or shift
      // transients. A missing Tesla asset must never sound like a petrol car.
      this.rpm=controls?.rpm??0;this.gear=0;this.previousDriveGear=0;
      for(const name of ['engine-idle','engine-drive',...CAR_ENGINE_SOUNDS] as SoundName[])this.setLoop(name,0,1,2000);
      this.fallback?.gain.gain.setTargetAtTime(0,now,.1);
      const moving=clamp(velocity/.65),gain=moving*(.045+load*.075);
      this.setLoop(EV_DRIVE,gain,clamp(.72+velocity*.038,.72,2.6),2400+load*1200);
      this.electric?.oscillator.frequency.setTargetAtTime(160+velocity*16+load*35,now,.15);
      this.electric?.gain.gain.setTargetAtTime(this.carEngineReady?0:moving*(.007+load*.012),now,.1);
      this.updateRoadSounds(velocity,controls);
      return;
    }
    // Gentle automatic shifts keep the engine from becoming a rising siren.
    const shifts = [0, 6.5, 12.8, 20, 29, 40];
    if (speed < -0.2) this.gear = 0;
    else {
      while (this.gear < 4 && velocity > shifts[this.gear + 1] + 0.7) this.gear++;
      while (this.gear > 0 && velocity < shifts[this.gear] - 0.9) this.gear--;
    }
    const span = shifts[this.gear + 1] - shifts[this.gear];
    const progress = clamp((velocity - shifts[this.gear]) / span, 0, 1.2);
    const targetRpm = controls?.rpm ?? (velocity < 0.7 ? 850 + load * 1050 : 1250 + progress * 2300 + load * 450);
    if(controls?.gear!==undefined)this.gear=Math.max(0,Math.abs(controls.gear)-1);
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-dt * 5));
    const id=this.carId,useCar=this.carEngineReady;
    if(isPerformanceCar(id)){
      const nextGear=controls?.gear??1;
      const shifting = this.previousDriveGear>0 && nextGear>0 && nextGear!==this.previousDriveGear;
      if (id==='subaru-wrx' && !this.muted) {
        const boost=clamp(controls?.turboBoost??0), charge=clamp((boost-.45)/.55);
        const underLoad=!shifting && !controls?.handbrake && (controls?.brake??0)<=.1;
        const rate=.90+.35*boost;
        // Follow the recorded compressor's ~600 Hz whir as playback speeds up.
        this.setLoop(WRX_SPOOL,underLoad ? .034*charge*charge*load : 0,rate,600*rate);
      }
      if (id===GT2 && !this.muted) {
        // Induction rush of the two turbochargers: it comes in with the boost, part throttle included, and
        // follows the generated loop's 611 Hz whistle as the compressors speed up.
        const boost=clamp(controls?.turboBoost??0),rate=.82+.42*boost;
        this.setLoop(GT2_TURBO,controls?.handbrake||(controls?.brake??0)>.1?0:.10*boost**1.5*(.35+.65*load),rate,611*rate);
      }
      if(shifting&&velocity>2&&now-this.lastShift>.12){
        const buffer=this.buffers.get(carSound(id,nextGear>this.previousDriveGear?'upshift':'downshift'));
        if(buffer&&!this.muted){
          const gentle=id!=='mclaren-gt',up=nextGear>this.previousDriveGear;
          // The dual-clutch upshift is a hard thump under load and close to silent on a light pedal; its generated
          // clip is entered .50 s in, where the thump begins. A downshift finds no clip (carLayers) and plays nothing.
          if(id===GT2)this.playOneShot(buffer,.10+.24*load,1,'thump',0,.50);
          else this.playOneShot(buffer,gentle?(up?.11:.14):(up?.26:.24),1,gentle?'exhaust':'gt');
          this.shiftCount++;
        }
        this.lastShift=now;
      }
      this.previousDriveGear=nextGear;
    }
    // Use the complete generic engine mix until every dedicated car layer is
    // decoded, so either a partial failure or total loss cannot leave RPM gaps.
    if (useCar) {
      for(const name of CAR_ENGINE_SOUNDS)if(!name.startsWith(id+'-'))this.setLoop(name,0,1,2000);
      this.setLoop('engine-idle',0,1,1000);this.setLoop('engine-drive',0,1,1000);
    }
    if(useCar&&id==='subaru-wrx'){
      // The generated drive and high loops both have a dominant firing pulse near
      // 80 Hz. Match their pitch to two firings per revolution across the blend.
      const mid=clamp((this.rpm-850)/1150)*Math.PI/2;
      const high=clamp((this.rpm-3500)/1700)*Math.PI/2;
      const level=(.37+load*.32)*(now-this.lastShift<.16?.72:1);
      this.setLoop(carSound(id,'idle'),Math.cos(mid)*.50,clamp(this.rpm/1080,.65,1.65),1450+load*550);
      this.setLoop(carSound(id,'drive'),Math.sin(mid)*Math.cos(high)*level,clamp(this.rpm/2400,.39,2.7),1750+load*2400);
      this.setLoop(carSound(id,'high'),Math.sin(high)*level,clamp(this.rpm/2340,.7,2.8),2400+load*3300);
    }else if(useCar&&id===GT2){
      // The generated loops carry their strongest tone at 124 Hz (drive) and 202 Hz (high). Played at rpm/4000
      // and rpm/6500 that tone is the same in both wherever they overlap, and rises with the revs. A closed
      // throttle shuts the exhaust valves: quieter and duller, as the car is below 5,000 rpm. The idle is as loud as
      // the other cars' (every loop is normalized to one level as it loads, so a quiet file needs no more gain).
      const mid=clamp((this.rpm-950)/1300)*Math.PI/2,high=clamp((this.rpm-4700)/1900)*Math.PI/2;
      const level=(.30+load*.46)*(now-this.lastShift<.08?.62:1);
      this.setLoop(carSound(id,'idle'),Math.cos(mid)*.5,clamp(this.rpm/900,.8,1.7),1300+load*500);
      this.setLoop(carSound(id,'drive'),Math.sin(mid)*Math.cos(high)*level,clamp(this.rpm/4000,.36,1.9),1400+load*3300);
      this.setLoop(carSound(id,'high'),Math.sin(high)*level,clamp(this.rpm/6500,.6,1.3),2300+load*4300);
    }else if(useCar&&id==='moving-truck'){
      // The heavy diesel works below 3,000 RPM, with injector clatter at idle
      // and a loaded exhaust layer through its long automatic gear changes.
      const driveMix=clamp(Math.max(velocity/5,load*.72)),highMix=clamp((this.rpm-2050)/750),duck=now-this.lastShift<.28?.72:1;
      this.setLoop(carSound(id,'idle'),(1-driveMix)*.58,clamp(this.rpm/650,.78,1.6),1700);
      this.setLoop(carSound(id,'drive'),driveMix*(1-highMix)*(.52+load*.23)*duck,clamp(this.rpm/1800,.45,1.7),1900+load*1800);
      this.setLoop(carSound(id,'high'),driveMix*highMix*(.48+load*.25)*duck,clamp(this.rpm/2800,.65,1.25),2300+load*1500);
    }else if(useCar&&isPerformanceCar(id)){
      const revised=id!=='mclaren-gt',supra=id==='supra-mk4';
      // Both newer cars now use mastered GT exhaust sources. All moving mixes
      // replace idle completely above 8 m/s and follow the sources' nominal
      // RPMs; the Supra's six-cylinder-inspired pitch change is baked in.
      const driveMix=clamp(Math.max(velocity/8,load*.6));
      const highMix=clamp((this.rpm-4500)/2300);
      const shiftDuck=now-this.lastShift<.075?(revised?.78:.55):1;
      const midCutoff=supra?1800+load*3000:1800+load*3300;
      const highCutoff=supra?2500+load*3500:3000+load*4300;
      this.setLoop(carSound(id,'idle'),(1-driveMix)*.48,clamp(this.rpm/850,.85,revised?1.3:1.5),revised?950:1200);
      this.setLoop(carSound(id,'drive'),driveMix*(1-highMix)*(supra?.47+load*.26:.44+load*.23)*shiftDuck,clamp(this.rpm/4000,.48,1.85),midCutoff);
      this.setLoop(carSound(id,'high'),driveMix*highMix*(supra?.43+load*.27:.40+load*.25)*shiftDuck,clamp(this.rpm/7000,.6,1.25),highCutoff);
    }else{
      const mix=clamp(Math.max(velocity/6,load*.52));
      this.setLoop('engine-idle',this.failed.has('engine-drive')?.46:Math.cos(mix*Math.PI/2)*(.43+load*.12),clamp(this.rpm/1000,.82,1.55),780+load*650);
      this.setLoop('engine-drive',this.failed.has('engine-idle')?.4:Math.sin(mix*Math.PI/2)*(.46+load*.3),clamp(this.rpm/2600,.55,1.8),1300+load*2400+this.rpm*.25);
      for(const name of CAR_SOUNDS)this.setLoop(name,0,1,2000);
    }
    this.updateRoadSounds(velocity,controls);
    if (this.fallback) {
      this.fallback.oscillator.frequency.setTargetAtTime(this.rpm / 30, now, 0.12);
      this.fallback.gain.gain.setTargetAtTime(useCar?0:0.035 + load * 0.045, now, 0.1);
      this.fallback.filter.frequency.setTargetAtTime(160 + load * 180, now, 0.1);
    }
  }

  private updateFountain(listener?: ListenerPosition) {
    const onFootOrBike = this.mode === 'walk' || this.mode === 'bike';
    if (!this.fountainWanted && (!onFootOrBike || this.muted || !listener)) return;
    let distance = Infinity;
    if (onFootOrBike && listener) {
      for (const [x,z] of fellsmere.fountains)
        distance = Math.min(distance, Math.hypot(x-listener.x,z-listener.z));
    }

    if (!this.fountainWanted) {
      if (distance >= FOUNTAIN_RANGE) return;
      this.fountainWanted = true;
      // Join the phone's serial decode queue. On desktop an earlier fetch can
      // still be in flight if the player leaves and re-enters via the map.
      if (this.mobile) void this.loadMobileSounds();
      else if (!this.loadingFountain) {
        this.loadingFountain = true;
        void this.loadSound(FOUNTAIN).finally(() => { this.loadingFountain = false; });
      }
    }
    const proximity = clamp(1 - distance / FOUNTAIN_RANGE);
    this.setLoop(FOUNTAIN, .82 * proximity ** 2, 1, 2200 + 8000 * proximity);
    // Keep the buffer at the edge of earshot. A teleport or mode switch can
    // start this fade at full volume, so finish it before disconnecting.
    if (distance > FOUNTAIN_RANGE + 20 && (this.loops.get(FOUNTAIN)?.gain.gain.value ?? 0) < .0001) {
      this.fountainWanted = false;
      this.releaseSound(FOUNTAIN);
      this.failed.delete(FOUNTAIN);
    }
  }

  private updateRoadSounds(velocity:number,controls?:AudioControls){
    this.setLoop('city-ambience', 0.17 / (1 + velocity * 0.035), 1, 4200);
    this.setLoop('tire-road', Math.pow(clamp(velocity / 25), 0.8) * 0.44, clamp(0.62 + velocity / 32, 0.62, 1.6), 1400 + velocity * 90);

    const steer = clamp(Math.abs(controls?.steer ?? 0));
    const cornerScrub = clamp((steer * velocity * velocity - 115) / 200) * 0.5;
    const lockedTires = controls?.handbrake ? clamp((velocity - 1.5) / 8) : 0;
    const hardBraking = (controls?.brake ?? 0) > 0.85 && velocity > 8 ? 0.2 : 0;
    // Rear tyres spinning under power or sliding sideways squeal whatever the road speed (a burnout stands still).
    const spinning = clamp(controls?.wheelspin ?? 0);
    this.setLoop('tire-skid', Math.max(cornerScrub, lockedTires, hardBraking, spinning) * 0.32, clamp(0.85 + velocity * 0.014 + spinning * .12, 0.85, 1.4), 3600);
  }

  horn() {
    const context = this.context;
    if (!context || !this.master || this.mode !== 'drive' || this.muted || this.paused || document.hidden || this.disposed) return;
    const now = context.currentTime;
    if (now - this.lastHorn < 0.7) return;
    this.resume(); this.lastHorn = now;
    // Retrigger only the horn: honking at the bridge must not cancel the
    // metal tear or the spectator reaction scheduled after it.
    try{this.hornShot?.stop();}catch{/* Previous horn already ended. */}
    this.hornShot=undefined;
    const buffer = this.buffers.get(this.carId==='moving-truck'?'moving-truck-horn':'horn')??this.buffers.get('horn');
    if (buffer) this.hornShot=this.playOneShot(buffer, 0.7, 1);
    else if (this.failed.has('horn')) this.fallbackHorn();
  }

  private playOneShot(buffer: AudioBuffer, volume: number, rate: number, softShift:false|'gt'|'exhaust'|'thump'=false,delay=0,offset=0) {
    const context = this.context!;
    const source = context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate;
    const gain = context.createGain(); gain.gain.value = volume;
    let filter:BiquadFilterNode|undefined;
    if(softShift){
      // Preserve the approved GT mix. The new banks use a slower, softer
      // exhaust transition to soften generated transients and suppress clicking.
      const exhaust=softShift==='exhaust',thump=softShift==='thump',attack=exhaust?.065:thump?.008:.025,release=exhaust?.18:thump?.12:.08;
      filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=exhaust?650:thump?2200:1100;filter.Q.value=.5;
      source.connect(filter);filter.connect(gain);
      const now=context.currentTime,duration=(buffer.duration-offset)/rate;
      gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(volume,now+attack);
      gain.gain.setValueAtTime(volume,now+Math.max(attack,duration-release));gain.gain.linearRampToValueAtTime(0,now+duration);
    }else source.connect(gain);
    gain.connect(this.master!); this.oneShots.add(source);
    source.onended = () => { this.oneShots.delete(source); if(this.hornShot===source)this.hornShot=undefined;source.disconnect(); filter?.disconnect(); gain.disconnect(); };
    source.start(context.currentTime+delay,offset);
    return source;
  }

  /** A filtered noise burst with a fast decay stands in for a missing crash clip. */
  private fallbackImpact(volume: number, soft: boolean) {
    const context = this.context!, now = context.currentTime;
    if (!this.noise) {
      const length = Math.floor(context.sampleRate * .45); this.noise = context.createBuffer(1, length, context.sampleRate);
      const samples = this.noise.getChannelData(0); let seed = 1;
      for (let i = 0; i < length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; samples[i] = (seed / 4294967296 * 2 - 1) * Math.exp(-i / length * 9); }
    }
    const source = context.createBufferSource(); source.buffer = this.noise;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = soft ? 260 : 900; filter.Q.value = .7;
    const gain = context.createGain(); gain.gain.setValueAtTime(volume * .5, now); gain.gain.exponentialRampToValueAtTime(.001, now + (soft ? .25 : .45));
    source.connect(filter); filter.connect(gain); gain.connect(this.master!); this.oneShots.add(source);
    source.onended = () => { this.oneShots.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start();
  }

  /** One footfall of the player on foot: a short, dull tap, firmer at a run (`run` 0..1). */
  footstep(run: number) {
    const context = this.context;
    if (!context || !this.master || this.mode !== 'walk' || this.muted || this.paused || document.hidden || this.disposed) return;
    const now = context.currentTime, length = Math.floor(context.sampleRate * .08), buffer = context.createBuffer(1, length, context.sampleRate), samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / length * 7);
    const source = context.createBufferSource(); source.buffer = buffer;
    const filter = context.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 380 + Math.random() * 160 + clamp(run) * 220; filter.Q.value = .9;
    const gain = context.createGain(); gain.gain.value = .05 + clamp(run) * .07;
    source.connect(filter); filter.connect(gain); gain.connect(this.master); this.oneShots.add(source);
    source.onended = () => { this.oneShots.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(now);
  }

  /** One collision sound. `severity` is the chassis velocity change of the knock
   * (m/s per step) or, for a walker, the vehicle speed; it sets clip and volume. */
  impact(kind: ImpactKind, severity: number) {
    const context = this.context;
    if (!context || !this.master || this.mode === 'helicopter' || this.muted || this.paused || document.hidden || this.disposed || !Number.isFinite(severity)) return;
    const now = context.currentTime;
    if (now - (this.lastImpact.get(kind) ?? -Infinity) < (kind === 'pedestrian' ? .3 : .18)) return;
    this.lastImpact.set(kind, now); this.resume();
    let name: SoundName, gain: number;
    if (kind === 'pedestrian') { name = 'pedestrian-thump'; gain = .35 + clamp(severity / 20) * .45; }
    else {
      const heavy = kind === 'heavy' || kind === 'static';
      name = severity < LIGHT_IMPACT ? 'crash-light' : heavy ? 'crash-heavy' : 'crash-car';
      gain = severity < LIGHT_IMPACT ? .22 + severity / LIGHT_IMPACT * .3 : .5 + clamp((severity - LIGHT_IMPACT) / 14) * .5;
      if (kind === 'ground') gain *= .6;
    }
    this.impactCount++;
    const buffer = this.buffers.get(name);
    if (buffer) this.playOneShot(buffer, gain, kind === 'pedestrian' ? .95 + Math.random() * .1 : .92 + Math.random() * .16);
    else if (this.failed.has(name)) this.fallbackImpact(gain, kind === 'pedestrian');
  }

  /** One confirmed roof strike. Scheduling on the audio clock lets pause,
   * mute and vehicle changes cancel the delayed spectator reaction. */
  storrowed(severity:number){
    const context=this.context;
    if(!context||!this.master||this.mode!=='drive'||this.carId!=='moving-truck'||this.muted||this.paused||document.hidden||this.disposed||!Number.isFinite(severity))return;
    const now=context.currentTime;if(now-this.lastStorrow<1.2)return;
    this.stopLoop(REVERSE_ALARM);
    this.lastStorrow=now;this.storrowCount++;this.impactCount++;this.resume();
    const gain=.55+clamp(Math.abs(severity)/15)*.45,crash=this.buffers.get('moving-truck-storrow-crash'),boo=this.buffers.get('moving-truck-boo');
    if(crash)this.playOneShot(crash,gain,1);
    else this.fallbackImpact(gain,false);
    if(boo)this.playOneShot(boo,.68,1,false,.7);
  }

  dispose() {
    this.disposed = true;
    this.stopOneShots();
    for (const name of this.buffers.keys()) this.releaseSound(name);
    for(const loop of [...this.retiringLoops]){loop.source.onended=null;loop.source.stop();this.disconnectLoop(loop);}
    this.electric?.oscillator.stop();this.fallback?.oscillator.stop(); this.rotorFallback?.oscillator.stop(); this.rotorFallback?.modulator.stop();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    window.removeEventListener('pagehide', this.hidePage);
    window.removeEventListener('pointerdown', this.resume, { capture: true });
    window.removeEventListener('keydown', this.resume, { capture: true });
    void this.context?.close().catch(() => {});
  }

  private resume = () => {
    if (!this.muted && !document.hidden && this.context?.state === 'suspended') void this.context.resume().catch(() => {});
  };
  private visibilityChanged = () => { if (document.hidden) {this.stopOneShots();this.resetVehicleEffects();} this.syncMaster(); };
  private hidePage = () => { this.paused = true; this.stopOneShots(); this.resetVehicleEffects();this.syncMaster(); };

  private syncMaster() {
    if (!this.context || !this.master) return;
    const target = this.muted || this.paused || document.hidden || this.disposed ? 0 : 0.75;
    if (target === this.gate) return;
    this.gate = target;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, target === 0 ? 0.025 : 0.09);
  }

  /** Bound both the resident car bank and the number of simultaneous mobile decodes. */
  private async loadMobileSounds() {
    if (this.loadingMobileSounds) return;
    this.loadingMobileSounds = true;
    try {
      while (!this.disposed) {
        const next = this.wantedSounds.find(name => !this.buffers.has(name) && !this.failed.has(name));
        if (!next) break;
        await this.loadSound(next);
        this.ensureFallbacks();
      }
    } finally {
      this.loadingMobileSounds = false;
    }
  }

  private async loadSound(name: SoundName) {
    const wanted = () => !this.disposed && this.wantedSounds.includes(name);
    try {
      const revision=name===EV_REVERSE?'?v=ufo-pws-3':name==='mclaren-720s-drive'||name==='mclaren-720s-high'?'?v=gt-exhaust-4':name==='supra-mk4-drive'||name==='supra-mk4-high'?'?v=six-exhaust-3':name.startsWith('mclaren-720s-')||name.startsWith('supra-mk4-')?'?v=exhaust-2':'';
      const extension=name===EV_REVERSE?'wav':'mp3';
      const response = await fetch(`${import.meta.env.BASE_URL}audio/${name}.${extension}${revision}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('Audio unavailable');
      const encoded = await response.arrayBuffer();
      if (!wanted()) return;
      let buffer = await this.context!.decodeAudioData(encoded);
      if (!wanted()) return;
      // Reverse is already phase-aligned during mastering. A second arbitrary
      // crossfade would bring back the periodic cancellation/volume wobble.
      if (!ONE_SHOTS.has(name)&&name!==EV_REVERSE) buffer = this.seamlessBuffer(buffer);
      // The provider's deliberately quiet motor source needs more gain before
      // the restrained EV mix; retain the same RMS and peak ceiling.
      this.normalize(buffer,name===EV_DRIVE?32:4);
      // Start the warning at its first beep when reverse is selected, rather
      // than continuously running a silent alarm at an arbitrary phase.
      if (!ONE_SHOTS.has(name)&&name!==REVERSE_ALARM&&name!==EV_REVERSE) this.createLoop(name, buffer);
      this.buffers.set(name, buffer);
    } catch {
      if (wanted()) this.failed.add(name);
    }
  }

  private ensureFallbacks() {
    if (this.disposed) return;
    // Synthesis is a last-resort fallback, never layered over recordings.
    if (!this.fallback && this.failed.has('engine-idle') && this.failed.has('engine-drive')) this.createFallbackEngine();
    if (!this.rotorFallback && this.failed.has('helicopter-rotor')) this.createFallbackRotor();
  }

  private releaseSound(name: SoundName) {
    if(name===EV_REVERSE)this.stopElectricReverse();else this.stopLoop(name);
    this.buffers.delete(name);
  }

  private stopLoop(name:SoundName,releaseSeconds=.035){
    const loop = this.loops.get(name);
    if (loop) {
      this.loops.delete(name);
      if(name===EV_REVERSE&&!this.disposed&&this.context?.state==='running'){
        this.fadeOutLoop(loop,releaseSeconds);
      }else{loop.source.stop();this.disconnectLoop(loop);}
    }
  }

  private fadeOutLoop(loop:Loop,seconds:number){
    const now=this.context!.currentTime,end=now+(seconds+.005),gain=loop.gain.gain;
    // A mute/mode change may shorten a driving fade. Repeated updates must
    // never restart its clock or prolong an already scheduled release.
    if(loop.releaseEnd!==undefined&&loop.releaseEnd<=end)return;
    if(typeof gain.cancelAndHoldAtTime==='function')gain.cancelAndHoldAtTime(now);
    else {const value=gain.value;gain.cancelScheduledValues(now);gain.setValueAtTime(value,now);}
    gain.linearRampToValueAtTime(0,now+seconds);loop.releaseEnd=end;
    this.retiringLoops.add(loop);loop.source.onended=()=>this.disconnectLoop(loop);
    loop.source.stop(end);
  }

  private disconnectLoop(loop:Loop){
    loop.source.onended=null;loop.source.disconnect();loop.filter.disconnect();loop.gain.disconnect();
    this.retiringLoops.delete(loop);
  }

  private stopElectricReverse(){
    this.stopLoop(EV_REVERSE);
    for(const loop of this.retiringLoops)this.fadeOutLoop(loop,.035);
  }

  private resetVehicleEffects(){
    this.stopLoop(REVERSE_ALARM);
    this.stopElectricReverse();
    for(const name of TURBO_SOUNDS)this.setLoop(name,0,1,600);
  }

  private updateElectricReverse(speed:number,reverseGear:boolean){
    const active=this.loops.has(EV_REVERSE);
    // A small dead band prevents suspension/velocity jitter near standstill
    // from repeatedly starting and stopping the warning.
    const reverse=reverseGear?speed<=(active?.35:.15):speed<(active?-.05:-.25);
    if(!isElectricCar(this.carId)||this.mode!=='drive'||this.paused||this.muted||document.hidden||this.disposed){this.stopElectricReverse();return;}
    if(!reverse){this.stopLoop(EV_REVERSE,1.5);return;}
    const buffer=this.buffers.get(EV_REVERSE);
    if(!buffer)return;
    const reverseSpeed=clamp(-speed,0,7),rate=.86+.36*reverseSpeed/7;
    if(!active){this.stopElectricReverse();this.createLoop(EV_REVERSE,buffer,rate);}
    // Continuous speed-driven pitch, with no throttle/RPM bends or periodic
    // modulation. The new lower source keeps even fast reversing restrained.
    this.setLoop(EV_REVERSE,.26,rate,2200);
  }

  private updateReverseAlarm(reverse:boolean){
    if(!reverse||this.carId!=='moving-truck'||this.mode!=='drive'||this.paused||this.muted||document.hidden||this.disposed){this.stopLoop(REVERSE_ALARM);return;}
    const buffer=this.buffers.get(REVERSE_ALARM);
    if(!buffer)return;
    const now=this.context!.currentTime;
    if(!this.loops.has(REVERSE_ALARM)){this.createLoop(REVERSE_ALARM,buffer);this.reverseAlarmNextBeep=now;}
    const loop=this.loops.get(REVERSE_ALARM)!;loop.source.playbackRate.value=1;loop.filter.frequency.value=3200;
    // The generated warning tone is gated on the audio clock for an exact
    // 0.45 s beep / 0.55 s silent cadence, independent of FPS or engine RPM.
    // A short edge ramp removes clicks; one source serves every repetition.
    while(this.reverseAlarmNextBeep<now-.45)this.reverseAlarmNextBeep+=1;
    while(this.reverseAlarmNextBeep<now+1.1){
      const start=this.reverseAlarmNextBeep,gain=loop.gain.gain;
      gain.setValueAtTime(0,start);gain.linearRampToValueAtTime(.42,start+.008);
      gain.setValueAtTime(.42,start+.435);gain.linearRampToValueAtTime(0,start+.45);
      this.reverseAlarmNextBeep+=1;
    }
  }

  private createLoop(name: SoundName, buffer: AudioBuffer,initialRate=1) {
    const context = this.context!;
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
    source.playbackRate.value=initialRate;
    const filter = context.createBiquadFilter();
    const turbo=(TURBO_SOUNDS as readonly SoundName[]).includes(name);
    filter.type = turbo ? 'bandpass' : 'lowpass';
    filter.Q.value = turbo ? (name===GT2_TURBO?1.1:2) : .5;
    const gain = context.createGain(); gain.gain.value = 0;
    source.connect(filter); filter.connect(gain); gain.connect(this.master!);
    this.loops.set(name, { source, gain, filter }); source.start();
  }

  private setLoop(name: SoundName, volume: number, rate: number, cutoff: number) {
    const loop = this.loops.get(name);
    if (!loop || !this.context) return;
    const now = this.context.currentTime;
    if (volume>0 && name === 'engine-idle' && this.failed.has('engine-drive')) volume = Math.max(volume, 0.46);
    if (volume>0 && name === 'engine-drive' && this.failed.has('engine-idle')) volume = Math.max(volume, 0.4);
    loop.gain.gain.setTargetAtTime(volume, now, name === 'tire-skid' ? 0.07 : 0.14);
    loop.source.playbackRate.setTargetAtTime(rate, now, name===EV_REVERSE?.2:.12);
    loop.filter.frequency.setTargetAtTime(cutoff, now, 0.12);
  }

  /** Crossfade the final 60 ms into the beginning to soften codec/loop seams. */
  private seamlessBuffer(input: AudioBuffer) {
    const overlap = Math.min(Math.floor(input.sampleRate * 0.06), Math.floor(input.length / 4));
    const length = input.length - overlap;
    const output = this.context!.createBuffer(input.numberOfChannels, length, input.sampleRate);
    for (let channel = 0; channel < input.numberOfChannels; channel++) {
      const source = input.getChannelData(channel), target = output.getChannelData(channel);
      target.set(source.subarray(overlap));
      for (let i = 0; i < overlap; i++) {
        const t = i / (overlap - 1);
        target[length - overlap + i] = source[input.length - overlap + i] * (1 - t) + source[i] * t;
      }
    }
    return output;
  }

  /** Normalize differing generations gently, retaining headroom for mixing. */
  private normalize(buffer: AudioBuffer,maxBoost=4) {
    let energy = 0, peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) { energy += samples[i] * samples[i]; peak = Math.max(peak, Math.abs(samples[i])); }
    }
    const rms = Math.sqrt(energy / (buffer.length * buffer.numberOfChannels));
    const scale = Math.min(0.13 / Math.max(0.001, rms), 0.75 / Math.max(0.001, peak), maxBoost);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] *= scale;
    }
  }

  private createFallbackEngine() {
    const context = this.context!;
    const oscillator = context.createOscillator(); oscillator.type = 'triangle'; oscillator.frequency.value = 28;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 180;
    const gain = context.createGain(); gain.gain.value = 0;
    oscillator.connect(filter); filter.connect(gain); gain.connect(this.master!); oscillator.start();
    this.fallback = { oscillator, gain, filter };
  }

  private createFallbackRotor() {
    const context = this.context!;
    const oscillator = context.createOscillator(); oscillator.type = 'triangle'; oscillator.frequency.value = 82;
    const modulator = context.createOscillator(); modulator.frequency.value = 18;
    const modulation = context.createGain(); modulation.gain.value = 0.42;
    const pulse = context.createGain(); pulse.gain.value = 0.55;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 440;
    const gain = context.createGain(); gain.gain.value = 0;
    modulator.connect(modulation); modulation.connect(pulse.gain);
    oscillator.connect(pulse); pulse.connect(filter); filter.connect(gain); gain.connect(this.master!);
    oscillator.start(); modulator.start(); this.rotorFallback = { oscillator, modulator, gain };
  }

  private fallbackHorn() {
    const context = this.context!, now = context.currentTime;
    const gain = context.createGain(); gain.connect(this.master!);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.09, now + 0.02);
    gain.gain.setValueAtTime(0.09, now + 0.2); gain.gain.linearRampToValueAtTime(0, now + 0.35);
    let remaining = 2;
    for (const frequency of [349, 440]) {
      const oscillator = context.createOscillator(); oscillator.type = 'triangle'; oscillator.frequency.value = frequency;
      oscillator.connect(gain); this.oneShots.add(oscillator);
      oscillator.onended = () => { this.oneShots.delete(oscillator); oscillator.disconnect(); if (!--remaining) gain.disconnect(); };
      oscillator.start(); oscillator.stop(now + 0.36);
    }
  }

  private stopOneShots() {
    for (const source of this.oneShots) { try { source.stop(); } catch { /* Already ended. */ } }
    this.oneShots.clear();this.hornShot=undefined;
  }
}
