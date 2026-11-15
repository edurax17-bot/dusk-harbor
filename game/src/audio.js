// Sound, synthesized: no audio files, no network. A shared noise buffer and a
// master gain; every effect is a few oscillators or a burst of filtered noise, so
// the whole kit costs one small buffer and no per-frame work.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  function noise(dur, filterFreq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter).connect(amp).connect(master);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), ctx.currentTime + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(amp).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  return {
    unlock() { ensure(); },
    shot(id) {
      if (id === 'dmr') { noise(0.22, 900, 0.9); tone(140, 0.18, 0.5, 'sawtooth', 50); }
      else if (id === 'smg') { noise(0.08, 1600, 0.5); tone(220, 0.06, 0.25, 'square', 90); }
      else if (id === 'pistol') { noise(0.12, 1200, 0.6); tone(180, 0.1, 0.3, 'square', 70); }
      else { noise(0.14, 1100, 0.75); tone(160, 0.12, 0.4, 'sawtooth', 60); }
    },
    dry() { tone(1200, 0.04, 0.2, 'square'); },
    reload() { tone(500, 0.05, 0.2, 'square'); setTimeout(() => tone(700, 0.05, 0.2, 'square'), 350); },
    hit() { tone(1900, 0.05, 0.3, 'sine'); },
    kill() { tone(660, 0.09, 0.3, 'sine'); setTimeout(() => tone(990, 0.12, 0.3, 'sine'), 90); },
    explosion() { noise(0.7, 300, 1.2); tone(70, 0.6, 0.8, 'sine', 30); },
    beep() { tone(1050, 0.09, 0.35, 'square'); },
    plant() { tone(520, 0.15, 0.3, 'sine'); setTimeout(() => tone(780, 0.2, 0.3, 'sine'), 150); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.3, 'triangle'), i * 130)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.3, 'triangle'), i * 130)); },
    buy() { tone(880, 0.07, 0.25, 'sine'); setTimeout(() => tone(1175, 0.09, 0.25, 'sine'), 70); },
    click() { tone(1000, 0.03, 0.15, 'square'); },
  };
}
