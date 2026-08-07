// 音效（DESIGN §6 juice）：Web Audio 现场合成，零资源文件。

let ctx = null;
const ac = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());

// iOS 等平台需在用户手势内解锁
export function unlockAudio() {
  const c = ac();
  if (c.state === 'suspended') c.resume();
}

function burst({ at = 0, dur = 0.08, freq = 1800, vol = 0.5, q = 1.2 }) {
  const c = ac();
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

function thump({ at = 0, freq = 90, dur = 0.22, vol = 0.9 }) {
  const c = ac();
  const t = c.currentTime + at;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(35, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur);
}

export const sfx = {
  shake() {
    // 摇盅：一串骰子碰撞
    for (let i = 0; i < 7; i++)
      burst({ at: i * 0.07 + Math.random() * 0.02, freq: 1500 + Math.random() * 1500, vol: 0.25 });
  },
  land() {
    burst({ freq: 900, vol: 0.4, dur: 0.05 });
    burst({ at: 0.04, freq: 2200, vol: 0.2, dur: 0.04 });
  },
  tick() {
    burst({ freq: 2600, vol: 0.12, dur: 0.03 });
  },
  slam() {
    // 开！拍桌
    thump({ vol: 1 });
    burst({ freq: 500, vol: 0.5, dur: 0.12, q: 0.7 });
  },
  loseDie() {
    thump({ freq: 160, dur: 0.3, vol: 0.5 });
  },
};
