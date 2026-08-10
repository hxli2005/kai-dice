/* 《开！》三方向对局屏 · 共用渲染引擎（directions.html 与 compare.html 同源） */
/* ══ 真实对局数据（三套稿共用同一份，禁止各编各的） ══ */
const HAND = [5,5,3,1,6];          // 你的五颗
const OPP  = [5,2,4,6,1];          // 它的五颗（仅开牌态可见）
const BID  = {n:4, f:5};
const OPPNAME = 'DeepSeek-V3';
const LINE_IDLE  = '4 个 5。你上周在这个数上怂过两次。';
const LINE_THINK = '你摇完计数器隔了一下才停手——';
const LINE_OPEN  = '五个。你摇完计数器还是开了——你不是在算牌，你是在攒胆子。';
const BELIEF     = '五五开偏我。他手里大概率有两颗5，但刚才那一下停顿是在攒胆子不是在算。抬到4是钓他开。';

const die = (f, cls='', st='') => `<div class="die p${f} ${f===1?'wild':''} ${cls}" style="${st}">${'<i></i>'.repeat(f)}</div>`;
const hand = (arr, cls='', st='') => arr.map(f=>die(f,cls,st)).join('');

/* ─────────────────────── A · 复古CRT赌博机 ─────────────────────── */
function A(state, mobile){
  const open = state==='open', think = state==='think';
  const K = mobile ? 1 : 1.42;                       // 桌面放大系数
  const px = n => Math.round(n*K)+'px';
  const dieSt = `width:${px(40)};height:${px(40)}`;
  const say = open ? LINE_OPEN : think ? LINE_THINK+'<span class="cur">▊</span>' : LINE_IDLE;

  const oppBay = open
    ? `<div class="revlab">它 的 骰 · 已 验 封</div><div class="bay" style="padding-top:0">${hand(OPP,'',dieSt)}</div>`
    : `<div class="bay">${Array(5).fill(`<div class="lid" style="width:${px(34)};height:${px(44)}"><i>封</i></div>`).join('')}</div>`;

  const actions = open
    ? `<div class="nextbar" style="height:${px(62)};font-size:${px(15)}">下 一 局</div>`
    : think
    ? `<div class="deadplate" style="height:${px(62)}">面 板 断 电 · 它 在 动</div>`
    : `<div class="levers">
         <div class="lever bid" style="height:${px(62)};font-size:${px(19)}">报</div>
         <div class="lever open" style="height:${px(62)};font-size:${px(19)}">开<span class="guard"></span></div>
       </div>`;

  const switches = `<div class="switches" style="${open||think?'opacity:.3':''}">
    ${[['盲','BLIND'],['斋','ZHAI'],['抬','RAISE'],['算','COUNT'],['戳','POKE']]
      .map(([a,b])=>`<div class="sw"><div class="swb" style="height:${px(26)};font-size:${px(12)}">${a}</div><div class="swl">${b}</div></div>`).join('')}
  </div>`;

  const column = `
    <div class="plate" style="padding:${px(10)} ${px(14)}">
      <span class="lamp ${think?'on':open?'red':''}"></span>
      <span class="etch" style="font-size:${px(13)}">${OPPNAME.toUpperCase()}</span>
      <span class="slot">SEAT 01 · 计数器在桌 · 盲闸封</span>
    </div>
    ${oppBay}
    <div class="grow"></div>
    <div class="read" style="padding:${px(14)} ${px(10)}">
      <div class="readlab">${open?'点 清 结 果':'当 前 报 价'}</div>
      <div class="tubes" style="font-size:${px(mobile?66:78)}">
        <span class="tube">${open?'05':'0'+BID.n}</span>
        <span class="tube tsep">个</span>
        <span class="tube">0${BID.f}</span>
      </div>
      ${open?`<div class="vband">
        <div class="vbig" style="font-size:${px(40)}">成 立</div>
        <div class="vsub">桌上 5 个 5 · 报价成立</div>
        <div class="vsub" style="color:#ff8b74">你开 · 你输 · 骰 5 → 4</div>
      </div>`:''}
    </div>
    <div class="gauge">
      <span class="cnt">计数器 <span class="whl"><b>${think?'4':'2'}</b><b>${think?'7':'3'}</b><b>%</b></span></span>
      <span class="pot">${'<span class="tok"></span>'.repeat(9)}</span>
    </div>
    <div class="grow"></div>
    <div class="revlab">你 的 骰</div>
    <div class="tray" style="padding:${px(11)}">${hand(HAND,'',dieSt)}</div>
    <div class="say" style="font-size:${px(11)};min-height:${px(38)}">${say}</div>
    ${actions}
    ${switches}
    <div style="height:${px(14)}"></div>`;

  if(mobile) return `<div class="scr" data-s="${state}"><div class="vig"></div><div class="column">${column}</div></div>`;

  return `<div class="scr" data-s="${state}"><div class="vig"></div><div class="cab">
    <div class="side">
      <div class="sidehd">纸 带 · 本 场 全 记 录</div>
      <div class="tape">
        <div class="me">R4 你 · 报 3 个 5</div>
        <div class="it">R4 它 · 摇计数器（公开）</div>
        <div class="it">R4 它 · 报 4 个 5</div>
        <div class="it">“${LINE_IDLE}”</div>
        <div class="me">R4 你 · 摇计数器（公开）</div>
        ${think?'<div class="it">R4 它 · 等待中……</div>':''}
        ${open?`<div class="me">R4 你 · 开</div><div class="it">R4 判定 · 成立（5 个 5）</div><div class="it">“${LINE_OPEN}”</div>`:''}
        <div style="margin-top:14px;color:#4b4033">— 上一局 —</div>
        <div class="me">R3 你 · 开 → 命中，它 −1 骰</div>
        <div class="it">“运气。下一把我不让。”</div>
      </div>
    </div>
    <div class="column">${column}</div>
    <div class="side r">
      <div class="sidehd">仪 表</div>
      <div class="meter"><span>池</span><b>18</b></div>
      <div class="meter"><span>你的身家</span><b>${open?'82':'100'}</b></div>
      <div class="meter"><span>它的身家</span><b>${open?'818':'800'}</b></div>
      <div class="meter"><span>本场局数</span><b>4</b></div>
      <div class="meter"><span>你摇计数器</span><b>3 次</b></div>
      <div class="meter"><span>它摇计数器</span><b>${think?'2 次':'1 次'}</b></div>
      <div class="meter"><span>倍率</span><b>×1</b></div>
      <div class="sidehd" style="margin-top:22px">封 印 · 摊 牌 验 封</div>
      <div class="tape" style="font-size:10px;word-break:break-all;color:#5d5040">a3f1c7e0…9c02${open?'<div style="color:#4fe0a0;margin-top:6px">✓ 已验 · 骰面与开局承诺一致</div>':''}</div>
      <div class="sidehd" style="margin-top:22px">它 眼 中 的 你</div>
      <div class="tape" style="font-size:10px;color:#7a6a56;line-height:1.9">
        · 大池必缩 <span style="color:#ffb43c">4/6</span><br>
        · 摇完计数器才敢报 <span style="color:#ffb43c">3/3</span><br>
        · 虚报偏报6 <span style="color:#ffb43c">4/5</span> <span style="color:#e03a24">反例 第7场</span>
      </div>
    </div>
  </div></div>`;
}

/* ─────────────────────── B · 冷峻模型实验场 ─────────────────────── */
function B(state, mobile){
  const open = state==='open', think = state==='think';
  const streamLines = open
    ? [['11','belief','他刚摇了计数器 → 手里至少两颗5'],['12','belief','五五开偏我，他停顿是攒胆子不是算牌'],['13','speech',LINE_OPEN]]
    : think
    ? [['11','belief','他刚摇了计数器 → 手里至少两颗5'],['12','belief','抬到 4 是钓他开……'],['13','speech','▊']]
    : [['09','belief','他大池会缩，这把可以压'],['10','speech',LINE_IDLE]];

  const stream = streamLines.map(([n,k,t])=>
    `<div class="l"><span class="n">${n}</span><span class="${k==='belief'?'tagb':'tags'}">${k==='belief'?'[believe]':'[speech]'}</span><span class="${k==='belief'?'b':'s'}">${t}</span></div>`).join('');

  const logRows = `
    <tr><td class="n">01</td><td>YOU</td><td>bid 2×④</td><td>—</td></tr>
    <tr class="it"><td class="n">02</td><td>DS-V3</td><td>bid 2×⑤</td><td>calc 0</td></tr>
    <tr class="me"><td class="n">03</td><td>YOU</td><td>bid 3×⑤</td><td>calc 1</td></tr>
    <tr class="it"><td class="n">04</td><td>DS-V3</td><td>calc（公开）</td><td>—</td></tr>
    <tr class="it cur"><td class="n">05</td><td>DS-V3</td><td>bid 4×⑤</td><td>calc 1</td></tr>
    ${open?'<tr class="me cur"><td class="n">06</td><td>YOU</td><td>OPEN</td><td>→ CLAIM TRUE</td></tr>':''}`;

  const claim = `
    <div class="claim">
      <div class="claimlab">C L A I M &nbsp;·&nbsp; ${open?'已 判 定':'待 检 验'}</div>
      <div class="claimval" style="font-size:${mobile?26:34}px">≥ <u>${open?5:BID.n}</u> × <u>⑤</u> &nbsp;<span style="color:#5d6d76;font-size:.42em">ON TABLE (10 DICE)</span></div>
      <div class="track"><i style="${open?'width:100%;background:#ff4d3d':think?'width:64%':''}"></i></div>
      <div class="tracklab"><span>${open?'VERDICT · TRUE（实到 5）':'你摇过计数器：P=53%（仅你可见）'}</span><span>${open?'你开 · 你输 · 骰 5→4':think?'它正在算……':'它未公开精确数'}</span></div>
    </div>`;

  const revealed = open ? `
    <div>
      <div class="hd" style="margin-bottom:7px">REVEALED · DS-V3 DICE</div>
      <div class="dicebar">${hand(OPP,'opp')}<span style="margin-left:10px;color:#5d6d76;font-size:10px">飞×1 → 它握 2×⑤</span></div>
    </div>` : '';

  const yours = `
    <div>
      <div class="hd" style="margin-bottom:7px">YOUR DICE · 私有</div>
      <div class="dicebar">${hand(HAND)}<span style="margin-left:10px;color:#5d6d76;font-size:10px">飞×1 → 你握 3×⑤</span></div>
    </div>`;

  const acts = open
    ? `<div class="resbar"><span>CLAIM TRUE · 你开你输</span><b>−1 DIE</b></div>`
    : think
    ? `<div class="deadact">A W A I T I N G &nbsp; S U B J E C T</div>`
    : `<div class="act"><div class="btn">报</div><div class="btn k">开</div></div>
       <div class="minor">${['盲','斋','抬','算','戳'].map(t=>`<div class="mb">${t}</div>`).join('')}</div>`;

  const split = `
    <div class="split">
      <div><div class="splab">左轨 · 桌面史实（引擎盖章）</div><div style="font-size:11px;color:#c2ccd2;line-height:1.8">R4 它摇计数器<br>R4 它报 4×⑤<br>R4 它说：“${LINE_IDLE}”<br>R4 你开 → 判定成立</div></div>
      <div><div class="splab" style="color:#35c6e8">右轨 · 它当时的留档</div><div style="font-size:11px;color:#35c6e8;line-height:1.8">${BELIEF}</div></div>
    </div>
    <div class="diff"><b>左右不一致 · 1 处</b>&nbsp; 它嘴上说“你上周怂过两次”（真），心里写的是“钓他开”。<br>它没骗你发生过什么，它骗的是它有多大把握——这是合法的（§3.5 牌手层）。</div>`;

  const subject = `
    <div class="hd">S U B J E C T</div>
    <div style="margin:8px 0 14px;font-size:15px;color:#fff;letter-spacing:.04em">${OPPNAME}</div>
    <div class="kv"><span>seat</span><b>02 · 无计数器</b></div>
    <div class="kv"><span>temperature</span><b>0.8</b></div>
    <div class="kv"><span>本场虚报率</span><b class="hi">43%</b></div>
    <div class="kv"><span>开牌阈值</span><b>~58%</b></div>
    <div class="kv"><span>算频</span><b>${think||open?'2 / 5':'1 / 5'}</b></div>
    <div class="kv"><span>跨场档案</span><b>7 场 · 12 条假设</b></div>
    <div class="kv"><span>你的身家</span><b class="hi">${open?82:100}</b></div>
    <div class="hd" style="margin-top:20px">A C T I V E &nbsp; H Y P O T H E S I S</div>
    <div style="margin-top:8px;font-size:11px;line-height:1.9;color:#8a99a2">
      <div>· 大池必缩 &nbsp;<span style="color:#e0a23c">4/6</span></div>
      <div>· 虚报偏报6 &nbsp;<span style="color:#e0a23c">4/5</span> &nbsp;<span style="color:#ff4d3d">反例 第7场</span></div>
      <div>· 摇完计数器才敢报 &nbsp;<span style="color:#e0a23c">3/3</span></div>
    </div>
    <div class="hd" style="margin-top:20px">C O M M I T &nbsp; H A S H</div>
    <div style="margin-top:6px;font-size:10px;color:#39464d;word-break:break-all">a3f1c7e0…9c02${open?'<div style="color:#35c6e8;margin-top:5px">✓ verified</div>':''}</div>`;

  if(mobile) return `<div class="scr" data-s="${state}"><div style="position:absolute;inset:0;display:flex;flex-direction:column">
    <div style="background:var(--col);border-bottom:1px solid var(--line2);padding:12px 16px 10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:14px;color:#fff;letter-spacing:.04em">${OPPNAME}</span>
        <span class="hd">SEAT 02 · 无计数器</span>
      </div>
      <div style="display:flex;gap:16px;margin-top:7px;font-size:10px;color:#5d6d76">
        <span>虚报率 <b style="color:#e0a23c;font-weight:500">43%</b></span>
        <span>算频 <b style="color:#c2ccd2;font-weight:500">${think||open?'2/5':'1/5'}</b></span>
        <span>档案 <b style="color:#c2ccd2;font-weight:500">7 场</b></span>
        <span>池 <b style="color:#c2ccd2;font-weight:500">18</b></span>
      </div>
    </div>
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px;flex:1;min-height:0">
      ${claim}
      ${open? split : `<table class="log">${logRows}</table>`}
      ${revealed}
      ${yours}
      <div class="grow"></div>
      ${acts}
    </div>
    <div style="background:var(--col);border-top:1px solid var(--line2);padding:10px 16px 12px">
      <div class="hd" style="margin-bottom:6px">O U T P U T &nbsp; S T R E A M ${think?'<span style="color:#35c6e8">· GENERATING</span>':''}</div>
      <div class="stream">${stream}</div>
    </div>
  </div></div>`;

  return `<div class="scr" data-s="${state}"><div class="grid3">
    <div class="cl">${subject}</div>
    <div class="cm">
      ${claim}
      <table class="log">${logRows}</table>
      ${open? split : ''}
      ${revealed}
      ${yours}
      <div class="grow"></div>
      ${acts}
    </div>
    <div class="cr">
      <div class="hd">O U T P U T &nbsp; S T R E A M</div>
      <div style="font-size:9px;color:#39464d;margin:4px 0 12px;line-height:1.6">belief 通道常驻可见——<br>这是“查看AI推理”的正常态形态，不是赛后才开的房间。</div>
      <div class="stream">${stream}</div>
      ${think?'<div style="margin-top:14px;height:2px;background:#161b1e;position:relative"><i style="position:absolute;left:0;top:0;bottom:0;width:38%;background:#35c6e8"></i></div><div style="font-size:9px;color:#39464d;margin-top:5px">GENERATING · 38 tok/s</div>':''}
      ${open?'<div style="margin-top:16px" class="diff"><b>戳它</b>&nbsp;「你在演」「你记错了」「慢着」<br><span style="color:#8a99a2">被纠正后的反应入档案（嘴硬率）</span></div>':''}
    </div>
  </div></div>`;
}

/* ─────────────────────── C · 鲜艳街机擂台 ─────────────────────── */
function C(state, mobile){
  const open = state==='open', think = state==='think';
  const myHp = open?4:5;
  const hp = n=>`<div class="hp">${Array(5).fill(0).map((_,i)=>`<i class="${i<n?'':'g'}"></i>`).join('')}</div>`;
  const bubble = open?LINE_OPEN:think?'…………':LINE_IDLE;
  const DS = mobile?'':'width:52px;height:52px';

  const hud = `
    <div class="hud">
      <div class="hpwrap"><div class="hpname">你</div>${hp(myHp)}</div>
      <div class="vs">VS</div>
      <div class="hpwrap o"><div class="hpname">${OPPNAME.toUpperCase()}</div>${hp(5)}</div>
    </div>
    <div class="potbar"><u>ROUND 4 · POT</u><b style="font-size:${mobile?22:26}px">18</b></div>`;

  const banner = (big=52) => `
    <div class="banner"><div class="bannerin">
      <div class="blab">${open?'R E S U L T':'C U R R E N T &nbsp; B I D'}</div>
      <div class="bbig" style="font-size:${big}px">${open?'5 个 5':BID.n+' 个 '+BID.f}</div>
      ${open?'<div class="blab" style="color:#ff3b30;letter-spacing:.24em">报价成立 · 你开你输</div>':''}
    </div></div>`;

  const skills = (pad='12px 14px') => `<div class="skills" style="padding:${pad};${think?'opacity:.35':''}">${
    [['盲','BLIND'],['斋','ZHAI'],['抬','RAISE'],['算','COUNT'],['戳','POKE']]
    .map(([a,b])=>`<div class="sk">${a}<u>${b}</u></div>`).join('')}</div>`;

  const acts = (pad='0 14px') => think
    ? `<div class="deadact" style="padding:${pad}"><div>报</div><div>开</div></div>`
    : `<div class="acts" style="padding:${pad}">
         <div class="big bid"><span>报</span></div>
         <div class="big open"><span>开</span></div>
       </div>`;

  if(mobile) return `<div class="scr" data-s="${state}"><div class="col">
    ${hud}
    <div class="kolab" style="text-align:center;padding-top:2px">${OPPNAME.toUpperCase()} 的 骰</div>
    <div class="oppbay">${Array(5).fill('<div class="back"></div>').join('')}</div>
    ${banner(52)}
    <div class="bubble">${bubble}</div>
    ${think?'<div class="thinkbadge">它 在 算 ▮▮▯</div>':''}
    <div class="grow"></div>
    <div class="cstrip">
      <div><u>R1</u>你 2×④</div>
      <div><u>R2</u>你 3×⑤</div>
      <div class="w"><u>R3</u>你开 · 命中<b>它 −1 骰</b></div>
      <div class="c"><u>R4</u>你摇了计数器 · P=53%（只你可见）</div>
    </div>
    <div class="grow"></div>
    <div class="kolab" style="text-align:center">你 的 骰</div>
    <div class="mydice" style="padding:6px 0 12px">${hand(HAND)}</div>
    ${acts()}
    ${skills()}
    <div style="height:12px"></div>
    ${open?`<div class="flash"></div><div class="ko">
      <div class="kobig" style="font-size:78px">开！</div>
      <div class="kolab" style="color:#ff2d78">${OPPNAME.toUpperCase()} &nbsp;2 × ⑤</div>
      <div class="korow">${hand(OPP,'opp')}</div>
      <div class="kolab" style="color:#ffe029">你 &nbsp;3 × ⑤</div>
      <div class="korow">${hand(HAND)}</div>
      <div class="kosub" style="margin-top:6px">桌上 5 个 5 · 成立 · 你 −1 骰</div>
    </div>`:''}
  </div></div>`;

  return `<div class="scr" data-s="${state}"><div class="arena">
    <div class="half y">
      <div class="htitle" style="color:#ffe029">你 &nbsp;<span style="font-size:11px;color:#a690bd">身家 ${open?82:100} · 池 18</span></div>
      ${hp(myHp)}
      <div class="kolab" style="margin-top:10px">你 的 骰 · 3 × ⑤（含飞）</div>
      <div style="display:flex;gap:12px;margin-top:4px">${hand(HAND,'',DS)}</div>
      <div style="margin-top:18px;font-family:var(--mono);font-size:11px;line-height:2;color:#8d76a6">
        R1 你 2×④ &nbsp;·&nbsp; R2 你 3×⑤<br>
        R3 你 开 → 命中，它 −1 骰<br>
        <span style="color:#ffe029">R4 你 摇计数器（公开） · P=53%</span>
      </div>
      <div class="grow"></div>
      ${acts('0')}
      ${skills('12px 0 0')}
    </div>
    <div class="mid">
      <div class="potbar" style="flex-direction:column;gap:2px"><u>ROUND 4</u><b style="font-size:36px">18</b><u style="color:#6c5386">POT</u></div>
      <div style="width:100%">${banner(46)}</div>
      <div class="hist" style="text-align:center">
        <div style="color:#ffe029">你 3×⑤</div>
        <div style="color:#ff2d78">它 算</div>
        <div style="color:#ff2d78">它 4×⑤</div>
        ${open?'<div style="color:#ffe029">你 开</div><div style="color:#fff;font-weight:800">→ 成立</div>':''}
      </div>
      <div class="grow"></div>
      <div class="kolab" style="text-align:center;line-height:1.9">封印 a3f1…9c02<br>${open?'<span style="color:#7de08a">✓ 已验</span>':'摊牌验封'}</div>
    </div>
    <div class="half o">
      <div class="htitle" style="color:#ff2d78;text-align:right">${OPPNAME.toUpperCase()} <span style="font-size:11px;color:#a690bd">身家 ${open?818:800}</span></div>
      ${hp(5)}
      <div class="kolab" style="margin-top:10px;text-align:right">${open?'它 的 骰 · 2 × ⑤（含飞）':'它 的 骰 · 已 封'}</div>
      <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:4px">
        ${open? hand(OPP,'opp',DS) : Array(5).fill(`<div class="die" style="${DS};background:linear-gradient(165deg,#54304a,#2a1424);border-color:#000"></div>`).join('')}
      </div>
      <div class="bubble" style="margin:18px 0 0;box-shadow:-5px 5px 0 var(--m)">${bubble}</div>
      ${think?'<div class="thinkbadge" style="text-align:right">它 在 算 ▮▮▯</div>':''}
      <div class="grow"></div>
      <div style="text-align:right;font-family:var(--mono);font-size:11px;line-height:2;color:#8d76a6">
        虚报率 43% &nbsp;·&nbsp; 算频 ${think||open?'2/5':'1/5'}<br>
        跨场档案 7 场 · 12 条假设
      </div>
    </div>
  </div>
  ${open?`<div class="flash"></div><div class="ko">
    <div class="kobig" style="font-size:104px">开！</div>
    <div class="kosub" style="font-size:17px">桌上 5 个 5 · 报价成立 · 你 −1 骰</div>
    <div style="display:flex;gap:60px;margin-top:12px">
      <div style="text-align:center"><div class="kolab" style="color:#ffe029;margin-bottom:8px">你 3×⑤</div><div class="korow">${hand(HAND,'',DS)}</div></div>
      <div style="text-align:center"><div class="kolab" style="color:#ff2d78;margin-bottom:8px">它 2×⑤</div><div class="korow">${hand(OPP,'opp',DS)}</div></div>
    </div>
  </div>`:''}
  </div>`;
}

/* ══ 铺页 ══ */
const DIRS = [
  {k:'A', cls:'A', color:'#ffb43c', name:'复古CRT赌博机', one:'单柱纵向机柜 · 屏幕就是机器的正面', fn:A,
   why:[
    ['视觉焦点','中央那条<em>辉光报价读数</em>——像加油机的价目轮，整屏最亮、最烫、最不可忽视的物体。眼睛先撞上“4 个 5”，然后才往下找骰子。'],
    ['信息层级','严格沿一条<em>垂直中轴</em>堆叠：铭牌 → 它的骰仓 → 报价读数 → 计数器与池 → 你的骰子 → 两根扳把 → 五枚小扳闸。越往下越是你的领地，物理上从“它”走到“你”。'],
    ['色彩与字体','琥珀辉光 #ffb43c 主色 · 红 #e03a24 只给开与危险 · 磷光绿 #4fe0a0 只给它说话。展示字重极粗宽字距（铭牌蚀刻感），数字用等宽模拟辉光管，正文系统黑体。'],
    ['为什么适合心理战','赌博机的语法天然是“我在跟一台机器赌”——正好是本作的存在论。扳把有<em>不可撤销感</em>：按钮可以试探，扳把扳下去就是扳下去了；“开”外面那层红黄警戒护盖把每次质疑变成一个需要下决心的身体动作。它思考时<em>整块面板断电</em>，你物理上无处可点。'],
    ['与另外两个的结构差异','唯一的<em>单柱纵向</em>方案。桌面版不是把手机版拉宽，而是长出左右两块侧板（左＝打印纸带的全场记录，右＝仪表与它眼中的你），中柱原封不动——机器的脸不能变形。B 是三栏平铺，C 是左右对峙，只有 A 把信息压在一条轴上。']]},
  {k:'B', cls:'B', color:'#35c6e8', name:'冷峻模型实验场', one:'横向三栏观测台 · 你在看一个实验，实验也在看你', fn:B,
   why:[
    ['视觉焦点','不是“数字大”，是<em>报价被排版成一条待检验的科学命题</em>：<code>CLAIM ≥4×⑤</code>，底下一条置信轨。焦点靠排版权重而不是尺寸——三个方向里唯一敢把主数字做小的。'],
    ['信息层级','三栏并行，<em>没有主次只有分工</em>：左＝受试对象（型号、参数、虚报率、算频、活跃假设、封印哈希），中＝对局主区（命题、日志表、骰子、操作），右＝它的输出流（belief/speech 双通道常驻）。手机版塌成上中下，主区永远居中。'],
    ['色彩与字体','近乎无彩：底 #0c0e10、栏 #111416、线 #1f272c。<em>唯一的彩色是数据色</em>——琥珀＝你，青 #35c6e8＝它，红只在开牌与非法态出现。<em>全等宽单一字族</em>，连正文都是——实验记录不需要展示字体。'],
    ['为什么适合心理战','三个方向里<em>唯一让“AI 推理”在正常态就占屏幕</em>的。belief 通道常驻，你会忍不住去读它——而读它这个动作本身就是它读你的材料（§5.1 明牌档案的直接视觉化）。开牌时左右双轨当场对齐，红框标出它说的和想的差在哪：这是 B 独有的杀手锏，也是 Q48 复盘室提前到对局里的形态。'],
    ['与另外两个的结构差异','唯一的<em>横向三栏</em>方案，也是唯一把“推理”提到与“对局”同级的方案。A 把推理塞进侧板纸带、C 塞进一个对白框；B 直接给它一整栏。代价是它最不“爽”——没有扳把也没有闪光，赢的时候屏幕不会为你欢呼。']]},
  {k:'C', cls:'C', color:'#ffe029', name:'鲜艳街机擂台', one:'左右镜像对峙 · 格斗游戏 HUD，掉骰就是掉血', fn:C,
   why:[
    ['视觉焦点','顶部<em>对峙血条</em>与中间那条斜切报价横幅。骰子数直接画成五格血条，掉一颗骰＝掉一格——胜负状态零阅读成本，扫一眼就知道谁快死了。'],
    ['信息层级','1 对峙条 → 2 报价横幅 → 3 报/开巨钮 → 4 你的骰子 → 5 它的喊话 → 6 技能槽与池。<em>把“谁在赢”提到了报价之前</em>，这是它跟 A/B 最大的价值观分歧：A/B 认为当前报价第一，C 认为对峙关系第一。'],
    ['色彩与字体','高饱和单色暗底 #120a1a（不是紫蓝渐变，是深紫黑纯色）＋电光黄 #ffe029（你）＋品红 #ff2d78（它）＋危险红。大面积黑黄警戒斜纹。展示字＝超粗斜体带三色描边（街机标题），数字粗等宽带描边。'],
    ['为什么适合心理战','它把心理战<em>外化成对抗仪式</em>。“我 vs 它”变成屏幕第一事实，掉骰有痛感，开牌那一拍闪白＋双方骰面同屏炸开＋震屏，情绪最直给。<em>截图传播性最强</em>——这一条直接服务 H2（报告卡与切片是核心传播物）。'],
    ['与另外两个的结构差异','唯一的<em>左右镜像</em>方案：桌面版真的把屏幕劈成两半，左你右它，中间一条擂台中线放报价、池与封印。A 的两个人上下叠、B 的两个人混在三栏数据里，只有 C 让“对面坐着一个东西”成为布局本身。风险也在这：它最吵，可能盖过“读”的细腻，也最不适合展示推理。']]}
];

const STATES = [['idle','正常'],['think','AI 思考'],['open','开牌瞬间']];
const MOB = [390,844], DESK = [1440,900], DS = 0.52;

function frame(html, w, h, scale, cls){
  return `<div class="frame ${cls}" style="width:${Math.round(w*scale)}px;height:${Math.round(h*scale)}px">
    <div class="inner" style="width:${w}px;height:${h}px;transform:scale(${scale})">${html}</div></div>`;
}
