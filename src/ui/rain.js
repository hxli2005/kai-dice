// 《开！》数字雨：黑客帝国式的代码瀑布，三层景深＋“码字”马赛克。
// 纯表现层：不读引擎、不碰规则。降级策略——减少动态效果时只画一帧静态雨。

const KANA = 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ';
const DIGITS = '0123456789';
const SYMS = ':・."=*+-<>¦|ç';
export const GLYPHS = KANA + KANA + DIGITS + SYMS;
const pick = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

export const RAIN = {
  head: '#e8ffe9',
  hot: '#9dffb4',
  core: '#00ff41',
  mid: '#00b82e',
  dim: '#006b1a',
  deep: '#003b0c',
};

// 一层雨：经典“半透明黑覆盖 + 只画头字”画法，每帧成本 ≈ 列数，手机上也稳。
function makeLayer(canvas, { size, speed, alpha, fade, mutate }) {
  const ctx = canvas.getContext('2d');
  let cols = [];
  let w = 0;
  let h = 0;
  let dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.ceil(w / size) + 1;
    cols = Array.from({ length: n }, () => ({
      y: -Math.random() * h * 1.5,
      v: speed * (0.55 + Math.random() * 0.9),
      last: null,
      glyph: pick(),
    }));
    ctx.clearRect(0, 0, w, h);
  }
  function glyph(ch, x, y, color) {
    ctx.fillStyle = color;
    // 片中是镜像片假名：水平翻转
    ctx.save();
    ctx.translate(x + size, y);
    ctx.scale(-1, 1);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }
  function step(dt, boost = 1) {
    // 透明画布上用 destination-out 渐隐，三层才能叠出景深
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${fade})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `${size}px "Share Tech Mono", "MS Gothic", "Hiragino Kaku Gothic Pro", monospace`;
    ctx.textBaseline = 'top';
    ctx.globalAlpha = alpha;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const x = i * size;
      const prevRow = Math.floor(c.y / size);
      c.y += c.v * dt * boost;
      const row = Math.floor(c.y / size);
      if (row !== prevRow) {
        // 上一格的头字降为普通绿
        if (c.last != null) {
          ctx.clearRect(x, c.last * size, size, size);
          glyph(c.glyph, x, c.last * size, RAIN.core);
        }
        c.glyph = pick();
        glyph(c.glyph, x, row * size, RAIN.head);
        c.last = row;
      }
      // 尾迹里随机变字
      if (Math.random() < mutate) {
        const ry = row - 2 - ((Math.random() * 18) | 0);
        if (ry > 0) {
          ctx.clearRect(x, ry * size, size, size);
          glyph(pick(), x, ry * size, Math.random() < 0.5 ? RAIN.mid : RAIN.dim);
        }
      }
      if (c.y > h + size * (8 + Math.random() * 20)) {
        c.y = -Math.random() * h * 0.5;
        c.v = speed * (0.55 + Math.random() * 0.9);
        c.last = null;
      }
    }
    ctx.globalAlpha = 1;
  }
  return { resize, step };
}

// 码字马赛克：把一段文字（报价数字）铺成会变字的代码格。
export function createMosaic(canvas, { cell = 9, under: underAlpha = 0.28 } = {}) {
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const octx = off.getContext('2d', { willReadFrequently: true });
  const under = document.createElement('canvas'); // 字形底光：让码字从远处也认得出
  const uctx = under.getContext('2d');
  let cells = [];
  let text = '';
  let w = 0;
  let h = 0;
  let dpr = 1;
  let pulse = 0;
  let sweep = -1;
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    off.width = Math.max(1, Math.ceil(w / cell));
    off.height = Math.max(1, Math.ceil(h / cell));
    octx.clearRect(0, 0, off.width, off.height);
    cells = [];
    if (!text) return;
    octx.fillStyle = '#fff';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    let fs = off.height * 0.98;
    octx.font = `700 ${fs}px "Share Tech Mono", "PingFang SC", "Microsoft YaHei", sans-serif`;
    const tw = octx.measureText(text).width;
    if (tw > off.width * 0.96) fs *= (off.width * 0.96) / tw;
    octx.font = `700 ${fs}px "Share Tech Mono", "PingFang SC", "Microsoft YaHei", sans-serif`;
    octx.fillText(text, off.width / 2, off.height / 2 + fs * 0.04);
    under.width = canvas.width;
    under.height = canvas.height;
    uctx.setTransform(1, 0, 0, 1, 0, 0);
    uctx.clearRect(0, 0, under.width, under.height);
    uctx.filter = `blur(${Math.round(cell * dpr * 0.9)}px)`;
    uctx.drawImage(off, 0, 0, off.width * cell * dpr, off.height * cell * dpr);
    uctx.filter = 'none';
    uctx.globalCompositeOperation = 'source-in';
    uctx.fillStyle = RAIN.core;
    uctx.fillRect(0, 0, under.width, under.height);
    uctx.globalCompositeOperation = 'source-over';
    const data = octx.getImageData(0, 0, off.width, off.height).data;
    for (let y = 0; y < off.height; y++) {
      for (let x = 0; x < off.width; x++) {
        const a = data[(y * off.width + x) * 4 + 3];
        if (a > 90) cells.push({ x, y, g: pick(), t: Math.random(), edge: a < 200 });
      }
    }
    sweep = 0;
  }
  function set(next) {
    if (next === text) return;
    text = next;
    layout();
    pulse = 1;
  }
  function draw(dt) {
    ctx.clearRect(0, 0, w, h);
    if (!cells.length) return;
    pulse = Math.max(0, pulse - dt * 0.0012);
    if (sweep >= 0) sweep += dt * 0.0016;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = underAlpha + pulse * 0.3;
    ctx.drawImage(under, 0, 0);
    ctx.restore();
    ctx.font = `${cell + 1}px "Share Tech Mono", "MS Gothic", monospace`;
    ctx.textBaseline = 'top';
    const rows = off.height;
    for (const c of cells) {
      if (Math.random() < 0.06) c.g = pick();
      c.t += dt * 0.001;
      // 解码扫描：新字从上往下“落定”
      const settled = sweep < 0 || c.y / rows < sweep;
      const flick = 0.72 + 0.28 * Math.sin(c.t * 5 + c.x * 1.7 + c.y);
      const wave = Math.max(0, 1 - Math.abs(((performance.now() / 1400 + c.x * 0.02) % 1.6) - c.y / rows) * 5);
      let color = RAIN.core;
      let a = (c.edge ? 0.55 : 0.92) * flick;
      if (!settled) {
        color = RAIN.head;
        a = 0.5 + Math.random() * 0.5;
      } else if (wave > 0.6 || pulse > Math.random() * 1.4) {
        color = RAIN.head;
      } else if (wave > 0.2) {
        color = RAIN.hot;
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      ctx.fillText(settled ? c.g : pick(), c.x * cell, c.y * cell);
    }
    ctx.globalAlpha = 1;
    if (sweep > 1.2) sweep = -1;
  }
  return { set, draw, layout };
}

// 整屏数字雨：far/mid/near 三层，far 层 CSS 模糊做景深。
export function createRain(host, { density = 1 } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const specs = [
    { cls: 'rain-far', size: 9, speed: 0.05, alpha: 0.45, fade: 0.09, mutate: 0.02 },
    { cls: 'rain-mid', size: 13, speed: 0.09, alpha: 0.7, fade: 0.075, mutate: 0.03 },
    { cls: 'rain-near', size: 19, speed: 0.16, alpha: 0.85, fade: 0.06, mutate: 0.02 },
  ];
  const layers = specs.map((s) => {
    const c = document.createElement('canvas');
    c.className = `rain-layer ${s.cls}`;
    c.setAttribute('aria-hidden', 'true');
    host.appendChild(c);
    return makeLayer(c, { ...s, speed: s.speed * density });
  });
  let raf = 0;
  let last = performance.now();
  let boost = 1;
  let boostTarget = 1;
  let running = false;
  const resize = () => layers.forEach((l) => l.resize());
  function frame(now) {
    const dt = Math.min(50, now - last);
    last = now;
    boost += (boostTarget - boost) * Math.min(1, dt * 0.004);
    for (const l of layers) l.step(dt, boost);
    if (running) raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running) return;
    resize();
    if (reduced.matches) {
      for (let i = 0; i < 60; i++) for (const l of layers) l.step(33, 1);
      return;
    }
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }
  addEventListener('resize', () => running && resize());
  return {
    start,
    stop,
    surge(level = 2.6, ms = 900) {
      boostTarget = level;
      setTimeout(() => (boostTarget = 1), ms);
    },
  };
}
