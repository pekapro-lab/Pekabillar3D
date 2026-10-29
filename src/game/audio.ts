let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), ctx.currentTime + dur);
  amp.gain.setValueAtTime(gain, ctx.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + dur + 0.02);
}

function noise(dur: number, gain: number, freq: number): void {
  if (!ctx) return;
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  const amp = ctx.createGain();
  amp.gain.value = gain;
  src.connect(filter);
  filter.connect(amp);
  amp.connect(ctx.destination);
  src.start();
}

export function playCue(): void {
  unlockAudio();
  noise(0.07, 0.18, 240);
  tone(120, 0.09, "sine", 0.06, 70);
}

export function playHit(impact = 1): void {
  const strength = Math.max(0.2, Math.min(1, impact / 2.2));
  noise(0.022 + strength * 0.028, 0.05 + strength * 0.2, 480 + strength * 1100);
  tone(210 + strength * 260, 0.032, "triangle", 0.018 + strength * 0.05, 110);
}

export function playPocket(): void {
  tone(240, 0.18, "sine", 0.05, 90);
}

export function playFoul(): void {
  tone(180, 0.16, "sawtooth", 0.03, 90);
}

export function playWin(): void {
  tone(392, 0.12, "sine", 0.05);
  window.setTimeout(() => tone(523, 0.14, "sine", 0.05), 120);
  window.setTimeout(() => tone(659, 0.22, "sine", 0.05), 240);
}
