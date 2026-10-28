import type { DriveInput, TravelMode } from '../types';

type SoundName = 'engine-idle' | 'engine-drive' | 'city-ambience' | 'tire-road' | 'horn' | 'tire-skid' | 'helicopter-rotor';
type AudioControls = Partial<Pick<DriveInput, 'steer' | 'brake' | 'handbrake'>> & { lift?: number; verticalSpeed?: number; gear?:number; rpm?:number };
interface Loop { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode; }
const SOUNDS: SoundName[] = ['engine-idle', 'engine-drive', 'city-ambience', 'tire-road', 'horn', 'tire-skid', 'helicopter-rotor'];
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));

/** Local sound assets only: no provider credentials or API calls in the browser. */
export class DriveAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private buffers = new Map<SoundName, AudioBuffer>();
  private loops = new Map<SoundName, Loop>();
  private failed = new Set<SoundName>();
  private oneShots = new Set<AudioBufferSourceNode | OscillatorNode>();
  private fallback?: { oscillator: OscillatorNode; gain: GainNode; filter: BiquadFilterNode };
  private rotorFallback?: { oscillator: OscillatorNode; modulator: OscillatorNode; gain: GainNode };
  private mode: TravelMode = 'drive';
  private disposed = false;
  private muted = false;
  private paused = true;
  private gear = 0;
  private rpm = 850;
  private previousTime = 0;
  private lastHorn = -Infinity;
  private gate = -1;

  get enabled() { return !this.muted; }
  set enabled(value: boolean) {
    this.muted = !value;
    if (this.muted) this.stopOneShots();
    this.syncMaster();
    if (value) this.resume();
  }

  setMode(mode: TravelMode) {
    if (mode === this.mode) return;
    this.mode = mode; this.stopOneShots();
    if (!this.context) return;
    const now = this.context.currentTime;
    const silent: SoundName[] = mode === 'helicopter' ? ['engine-idle', 'engine-drive', 'tire-road', 'tire-skid'] : ['helicopter-rotor'];
    for (const name of silent) this.loops.get(name)?.gain.gain.setTargetAtTime(0, now, 0.1);
    if (mode === 'helicopter') this.fallback?.gain.gain.setTargetAtTime(0, now, 0.1);
    else this.rotorFallback?.gain.gain.setTargetAtTime(0, now, 0.1);
  }

  /** A fresh, read-only snapshot for local diagnostics; never exposes audio nodes. */
  getStatus() {
    return {
      context: this.context?.state ?? 'not-started', mode: this.mode,
      enabled: this.enabled, paused: this.paused || document.hidden,
      loadedCount: this.buffers.size, expectedCount: SOUNDS.length,
      loading: !this.disposed && Boolean(this.context) && this.buffers.size + this.failed.size < SOUNDS.length,
      failed: [...this.failed], activeLoops: this.loops.size,
      activeOneShots: this.oneShots.size, fallback: Boolean(this.mode === 'drive' ? this.fallback : this.rotorFallback),
      masterGain: this.master?.gain.value ?? 0, rpm: Math.round(this.rpm), gear: this.gear + 1,
      rotorGain: this.loops.get('helicopter-rotor')?.gain.gain.value ?? 0,
      engineGain: (this.loops.get('engine-idle')?.gain.gain.value ?? 0) + (this.loops.get('engine-drive')?.gain.gain.value ?? 0),
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
      void this.loadSounds();
    }
    // Resume directly in the user gesture, even before the next simulation tick.
    void this.context.resume().catch(() => {});
  }

  update(speed: number, throttle: number, paused: boolean, controls?: AudioControls) {
    const context = this.context;
    if (!context || this.disposed) return;
    if (paused && !this.paused) this.stopOneShots();
    this.paused = paused;
    this.syncMaster();
    const now = context.currentTime;
    const dt = clamp(now - this.previousTime, 0, 0.1); this.previousTime = now;
    if (paused || document.hidden) return;

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
    const mix = clamp(Math.max(velocity / 6, load * 0.52));
    this.setLoop('engine-idle', Math.cos(mix * Math.PI / 2) * (0.43 + load * 0.12), clamp(this.rpm / 1000, 0.82, 1.55), 780 + load * 650);
    this.setLoop('engine-drive', Math.sin(mix * Math.PI / 2) * (0.46 + load * 0.3), clamp(this.rpm / 2600, 0.55, 1.8), 1300 + load * 2400 + this.rpm * 0.25);
    this.setLoop('city-ambience', 0.17 / (1 + velocity * 0.035), 1, 4200);
    this.setLoop('tire-road', Math.pow(clamp(velocity / 25), 0.8) * 0.44, clamp(0.62 + velocity / 32, 0.62, 1.6), 1400 + velocity * 90);

    const steer = clamp(Math.abs(controls?.steer ?? 0));
    const cornerScrub = clamp((steer * velocity * velocity - 115) / 200) * 0.5;
    const lockedTires = controls?.handbrake ? clamp((velocity - 1.5) / 8) : 0;
    const hardBraking = (controls?.brake ?? 0) > 0.85 && velocity > 8 ? 0.2 : 0;
    this.setLoop('tire-skid', Math.max(cornerScrub, lockedTires, hardBraking) * 0.32, clamp(0.85 + velocity * 0.014, 0.85, 1.4), 3600);
    if (this.fallback) {
      this.fallback.oscillator.frequency.setTargetAtTime(this.rpm / 30, now, 0.12);
      this.fallback.gain.gain.setTargetAtTime(0.035 + load * 0.045, now, 0.1);
      this.fallback.filter.frequency.setTargetAtTime(160 + load * 180, now, 0.1);
    }
  }

  horn() {
    const context = this.context;
    if (!context || !this.master || this.mode !== 'drive' || this.muted || this.paused || document.hidden || this.disposed) return;
    const now = context.currentTime;
    if (now - this.lastHorn < 0.7) return;
    this.resume(); this.lastHorn = now; this.stopOneShots();
    const buffer = this.buffers.get('horn');
    if (buffer) {
      const source = context.createBufferSource(); source.buffer = buffer;
      const gain = context.createGain(); gain.gain.value = 0.7;
      source.connect(gain); gain.connect(this.master); this.oneShots.add(source);
      source.onended = () => { this.oneShots.delete(source); source.disconnect(); gain.disconnect(); };
      source.start();
    } else if (this.failed.has('horn')) this.fallbackHorn();
  }

  dispose() {
    this.disposed = true;
    this.stopOneShots();
    for (const loop of this.loops.values()) { loop.source.stop(); loop.source.disconnect(); }
    this.fallback?.oscillator.stop(); this.rotorFallback?.oscillator.stop(); this.rotorFallback?.modulator.stop(); this.loops.clear(); this.buffers.clear();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    window.removeEventListener('pagehide', this.hidePage);
    window.removeEventListener('pointerdown', this.resume, { capture: true });
    window.removeEventListener('keydown', this.resume, { capture: true });
    void this.context?.close().catch(() => {});
  }

  private resume = () => {
    if (!this.muted && !document.hidden && this.context?.state === 'suspended') void this.context.resume().catch(() => {});
  };
  private visibilityChanged = () => { if (document.hidden) this.stopOneShots(); this.syncMaster(); };
  private hidePage = () => { this.paused = true; this.stopOneShots(); this.syncMaster(); };

  private syncMaster() {
    if (!this.context || !this.master) return;
    const target = this.muted || this.paused || document.hidden || this.disposed ? 0 : 0.75;
    if (target === this.gate) return;
    this.gate = target;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, target === 0 ? 0.025 : 0.09);
  }

  private async loadSounds() {
    const context = this.context!;
    await Promise.all(SOUNDS.map(async name => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}audio/${name}.mp3`, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('Audio unavailable');
        let buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (this.disposed) return;
        if (name !== 'horn') buffer = this.seamlessBuffer(buffer);
        this.normalize(buffer);
        this.buffers.set(name, buffer);
        if (name !== 'horn') this.createLoop(name, buffer);
      } catch {
        if (!this.disposed) this.failed.add(name);
      }
    }));
    // Synthesis is a last-resort fallback, never layered over recordings.
    if (!this.disposed && this.failed.has('engine-idle') && this.failed.has('engine-drive')) this.createFallbackEngine();
    if (!this.disposed && this.failed.has('helicopter-rotor')) this.createFallbackRotor();
  }

  private createLoop(name: SoundName, buffer: AudioBuffer) {
    const context = this.context!;
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 0.5;
    const gain = context.createGain(); gain.gain.value = 0;
    source.connect(filter); filter.connect(gain); gain.connect(this.master!);
    this.loops.set(name, { source, gain, filter }); source.start();
  }

  private setLoop(name: SoundName, volume: number, rate: number, cutoff: number) {
    const loop = this.loops.get(name);
    if (!loop || !this.context) return;
    const now = this.context.currentTime;
    if (name === 'engine-idle' && this.failed.has('engine-drive')) volume = Math.max(volume, 0.46);
    if (name === 'engine-drive' && this.failed.has('engine-idle')) volume = Math.max(volume, 0.4);
    loop.gain.gain.setTargetAtTime(volume, now, name === 'tire-skid' ? 0.07 : 0.14);
    loop.source.playbackRate.setTargetAtTime(rate, now, 0.12);
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
  private normalize(buffer: AudioBuffer) {
    let energy = 0, peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) { energy += samples[i] * samples[i]; peak = Math.max(peak, Math.abs(samples[i])); }
    }
    const rms = Math.sqrt(energy / (buffer.length * buffer.numberOfChannels));
    const scale = Math.min(0.13 / Math.max(0.001, rms), 0.75 / Math.max(0.001, peak), 4);
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
    this.oneShots.clear();
  }
}
