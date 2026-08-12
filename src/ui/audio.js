// 音效（DESIGN §6 juice）：Web Audio 现场合成，零资源文件。

let ctx = null;
const AudioCtor = typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext;
const ac = () => (AudioCtor ? (ctx ??= new AudioCtor()) : null);
const detune = (freq) => freq * (0.95 + Math.random() * 0.1);

// iOS 等平台需在用户手势内解锁
export function unlockAudio() {
  const c = ac();
  if (c?.state === 'suspended') c.resume().catch(() => {});
}

function burst({ at = 0, dur = 0.08, freq = 1800, vol = 0.5, q = 1.2 }) {
  const c = ac();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = detune(freq);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

// 118 Hz 的低频锤只属于判定落槌；其他反馈一律用中高频机械声。
function verdictThump({ at = 0, dur = 0.22, vol = 0.9 }) {
  const c = ac();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(118, t);
  o.frequency.exponentialRampToValueAtTime(42, t + dur);
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
  chips() {
    // 额度入池：两枚继电器脆响
    burst({ freq: 3200, vol: 0.22, dur: 0.035, q: 3 });
    burst({ at: 0.06, freq: 2700, vol: 0.18, dur: 0.035, q: 3 });
  },
  coin() {
    // 单枚额度落轨（保留旧 API 名，声音语义已去赌场化）
    burst({ freq: 2300 + Math.random() * 900, vol: 0.28, dur: 0.045, q: 4 });
  },
  jackpot() {
    // 大额入账收尾：金属轨道，不占用判定低频
    burst({ freq: 620, vol: 0.34, dur: 0.09, q: 1.1 });
    burst({ at: 0.05, freq: 1800, vol: 0.3, dur: 0.1, q: 1.5 });
  },
  stamp() {
    // 宣言锁存
    burst({ freq: 460, vol: 0.34, dur: 0.07, q: 1 });
    burst({ freq: 700, vol: 0.35, dur: 0.08, q: 1 });
  },
  slam() {
    // 开：断电噪脉冲，低频留给下一拍的判定
    burst({ freq: 500, vol: 0.5, dur: 0.12, q: 0.7 });
  },
  loseDie() {
    burst({ freq: 240, vol: 0.42, dur: 0.12, q: 0.8 });
  },
  verdict() {
    verdictThump({ dur: 0.26, vol: 0.82 });
    burst({ at: 0.035, freq: 980, vol: 0.22, dur: 0.09, q: 1.2 });
  },
  type() {
    burst({ freq: 3100, vol: 0.045, dur: 0.012, q: 4 });
  },
  deny() {
    burst({ freq: 340, vol: 0.18, dur: 0.055, q: 2 });
  },
};
