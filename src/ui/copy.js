// Explicit locale renderers for composite UI copy.
//
// These surfaces contain interpolated values, so sending their finished HTML
// through the substring adapter can split a sentence into mixed languages.
// Keep both complete render paths here and leave model-authored records alone.

const pct = (value) => `${Math.round((value ?? 0) * 100)}%`;

export function matchReportCopy(data, english = false) {
  const {
    sandbox = false,
    matchNo,
    mods = [],
    trio = false,
    standings = '',
    won = false,
    roundsAlive = 0,
    rounds = 0,
    chips = 0,
    bluffRate = 0,
    seenBids = 0,
    myBluffs = 0,
    knowingBluffs = 0,
    thinBluffs = 0,
    knowingWildest = null,
    blindBids = 0,
    blindWildest = null,
    callsByOpponent = [],
    challengeHits = 0,
    challenges = 0,
    calzaHits = 0,
    calzas = 0,
    timesChallenged = 0,
    avgTimeSeconds = '0.0',
  } = data;

  if (!english) {
    const rows = [];
    if (sandbox) rows.push(['词条', mods.map((name) => `「${name}」`).join('')]);
    if (trio && standings) rows.push(['名次', standings]);
    rows.push(['胜负', won ? '赢' : '输']);
    rows.push([
      '局数',
      roundsAlive === rounds ? `${rounds} 局` : `你参战 ${roundsAlive} 局 · 全桌 ${rounds} 局`,
    ]);
    rows.push(['身家', `${chips}${chips <= 0 ? '（赊着）' : ''}${sandbox ? '（沙盒·不记账）' : ''}`]);
    rows.push(['虚报率', `${pct(bluffRate)}${seenBids ? `（看过骰的 ${seenBids} 口）` : '（没看过骰）'}`]);
    if (myBluffs) {
      rows.push([
        '其中',
        `明知 ${knowingBluffs} 口 · 看走眼 ${thinBluffs} 口${
          knowingWildest ? ` · 最狠 ${knowingWildest.count} 个 ${knowingWildest.face}` : ''
        }`,
      ]);
    }
    if (blindBids) {
      rows.push([
        '蒙报',
        `${blindBids} 口${blindWildest ? ` · 最狠 ${blindWildest.count} 个 ${blindWildest.face}` : ''}`,
      ]);
    }
    rows.push([
      '开牌命中',
      trio
        ? callsByOpponent.map((v) => `对${v.name} ${v.hits}/${v.calls}`).join(' · ')
        : `${challengeHits}/${challenges}`,
    ]);
    if (calzas) rows.push(['掐', `${calzaHits}/${calzas}`]);
    rows.push([
      '被他开',
      trio
        ? callsByOpponent.map((v) => `${v.name} ${v.calledYou} 次`).join(' · ')
        : `${timesChallenged} 次`,
    ]);
    rows.push(['平均思考', `${avgTimeSeconds} 秒`]);
    return {
      heading: sandbox ? '实验桌 · 沙盒对局' : `对局档案 · 第 ${matchNo} 场`,
      rows,
      changeTable: '换桌',
      playAgain: '再来一局',
      review: '看看他当时怎么想的 →',
      footer: sandbox ? '实验局 · 不入榜不入账不入档案' : '截屏即可分享 · 这一场已记进他的本子',
    };
  }

  const rows = [];
  if (sandbox) rows.push(['MODS', mods.map((name) => `“${name}”`).join(' · ')]);
  if (trio && standings) rows.push(['STANDINGS', standings]);
  rows.push(['RESULT', won ? 'WIN' : 'LOSS']);
  rows.push([
    'ROUNDS',
    roundsAlive === rounds
      ? `${rounds} ROUNDS`
      : `YOU PLAYED ${roundsAlive} ROUNDS · TABLE TOTAL ${rounds} ROUNDS`,
  ]);
  rows.push(['BALANCE', `${chips}${chips <= 0 ? ' (IN DEBT)' : ''}${sandbox ? ' (SANDBOX · NOT RECORDED)' : ''}`]);
  rows.push(['BLUFF RATE', `${pct(bluffRate)}${seenBids ? ` (ACROSS ${seenBids} SEEN-DICE BIDS)` : ' (DICE NOT SEEN)'}`]);
  if (myBluffs) {
    rows.push([
      'BREAKDOWN',
      `KNOWING ${knowingBluffs} BIDS · MISREAD ${thinBluffs} BIDS${
        knowingWildest ? ` · WILDEST ${knowingWildest.count} × ${knowingWildest.face}` : ''
      }`,
    ]);
  }
  if (blindBids) {
    rows.push([
      'BLIND BIDS',
      `${blindBids} BIDS${blindWildest ? ` · WILDEST ${blindWildest.count} × ${blindWildest.face}` : ''}`,
    ]);
  }
  rows.push([
    'CALL ACCURACY',
    trio
      ? callsByOpponent.map((v) => `VS ${v.name} ${v.hits}/${v.calls}`).join(' · ')
      : `${challengeHits}/${challenges}`,
  ]);
  if (calzas) rows.push(['CALZA', `${calzaHits}/${calzas}`]);
  rows.push([
    'CALLED BY OPPONENT',
    trio
      ? callsByOpponent.map((v) => `${v.name} ${v.calledYou} TIMES`).join(' · ')
      : `${timesChallenged} TIMES`,
  ]);
  rows.push(['AVG. THINK TIME', `${avgTimeSeconds} SEC`]);
  return {
    heading: sandbox ? 'LAB TABLE · SANDBOX MATCH' : `MATCH REPORT · MATCH ${matchNo}`,
    rows,
    changeTable: 'CHANGE TABLE',
    playAgain: 'PLAY AGAIN',
    review: 'SEE WHAT THE AI THOUGHT →',
    footer: sandbox
      ? 'Sandbox · No standings, balance, or profile changes'
      : 'Screenshot to share · This match is now in the opponent’s notebook',
  };
}

export function archiveTableCopy(stats, english = false) {
  const headers = english ? ['MATCH', 'RESULT', 'BLUFF', 'CALLS'] : ['场', '胜负', '虚报', '开牌'];
  return {
    headers,
    rows: (stats ?? []).slice(-6).map((stat, index, recent) => ({
      match: stats.length - recent.length + index + 1,
      result: stat.won === true ? (english ? 'WIN' : '胜') : stat.won === false ? (english ? 'LOSS' : '负') : '—',
      bluff: `${Math.round((stat.bluffRate ?? 0) * 100)}%`,
      calls: `${stat.myChallengeHits}/${stat.myChallenges}`,
    })),
  };
}

const RULES_ZH = `<h2 id="secRules">规矩</h2>
  <ul>
    <li>轮流报「桌上共有几个几」。<b>只能往上抬</b>：数量加大，或同数量、点数加大——抬不动了就只能开。</li>
    <li><b>1 点是万能牌</b>（癞子），清点时算作任意点数；宣「斋」的那一局失效。</li>
    <li>开只开上家：数够，开的人输；不够，报的人输。输家掉一骰，掉光出局。</li>
    <li>每报一手，全桌各追 1 注；开牌胜者收整池。</li>
    <li>三印的代价（倍率对全桌双向生效，赢多输也多）：盲＝没看骰就能宣、宣了整局不看，池×2　｜　斋＝首报者宣，1 不作癞子，池×1.5　｜　抬＝轮到你拍章，池×2，每人每局一次。</li>
    <li>第 6 手报价起进深水：池自动再 ×2。倍率全部相乘。</li>
    <li><b>小本子</b>：一场打完可以翻开看他当时怎么想的（说的一套、想的一套都在）。<b>翻本子是公开的</b>——他知道你研究过他，下回可能拿这个开你玩笑（不想让他知道，设置里可以关）。</li>
    <li>额度片按 1／5／25／100 合并显示。不限时——但你手停多久，他们都记着。</li>
  </ul>`;

const RULES_EN = `<h2 id="secRules">RULES</h2>
  <ul>
    <li>Take turns bidding how many dice of one face are on the table. <b>Bids must rise</b>: increase the count, or keep the count and increase the face. If you cannot raise, you must call.</li>
    <li><b>Ones are wild</b> and count as any face. NO-WILDS disables them for that round.</li>
    <li>You may call only the previous bidder. If the count is high enough, the caller loses; otherwise the bidder loses. The loser drops one die and is out after losing the last die.</li>
    <li>Every bid makes each player add 1 chip. The winner of the reveal takes the whole pot.</li>
    <li>The three declarations multiply both wins and losses: BLIND lets you declare before peeking and forbids peeking that round, pot ×2; NO-WILDS is available to the opening bidder and disables wild ones, pot ×1.5; RAISE is available once per player per round, pot ×2.</li>
    <li>Deep water begins with the sixth bid: the pot doubles again. All multipliers stack.</li>
    <li><b>The notebook</b> opens after a match and shows what the opponent said and thought at each move. <b>Opening it is public</b>: the opponent will know you studied it and may mention that next time. You can make notebook views private in Settings.</li>
    <li>Chips are grouped as 1 / 5 / 25 / 100. There is no timer, but opponents remember how long you take.</li>
  </ul>`;

const OPPONENT_ZH = `<h2 id="secWho">对面是谁</h2>
  <ul>
    <li><b>模型是真身</b>：做决定的是一个语言模型。怎么算、什么时候掀盅、开不开你这口价，都是它自己的判断。</li>
    <li><b>提示词只管规则</b>：发给它的只有游戏规则、能做哪些动作、输出格式，外加这一局实际发生了什么——<b>没有性格剧本，也没有任何“你该怎么说话”的交代</b>。怎么打、怎么说、说什么，全是它自己的判断。所以换个型号，你换到的是另一个对手。</li>
    <li><b>系统说话零容忍，他说话零审查</b>：结算、报告卡、档案统计由引擎复算，错了就是 bug；他的嘴可能记歪、可能夸大——那不是故障，那是对手。不服就「戳」他。</li>
    <li>站内的模型名只是事实性标注。本作与各模型厂商无关联、未获授权，不使用其商标与形象。<a href="about.html">说明页</a>写得更细。</li>
  </ul>`;

const OPPONENT_EN = `<h2 id="secWho">ABOUT THE OPPONENT</h2>
  <ul>
    <li><b>The model is the opponent</b>: a language model decides how to reason, when to reveal its dice, and whether to call your bid.</li>
    <li><b>The prompt contains rules, not a personality</b>: it receives the game rules, available actions, output format, and the events of this match. <b>There is no persona script or instruction for how it should speak.</b> Its play and words are its own decisions. Change the model and you change the opponent.</li>
    <li><b>System facts are strict; model speech is unfiltered</b>: results, report data, and profile statistics are recomputed by the engine. The opponent may still misjudge, exaggerate, or misremember. That is the opponent speaking, not a referee failure. Poke it when you disagree.</li>
    <li>Model names are factual labels only. This game is unaffiliated with and not endorsed by model providers, and it does not use their trademarks or imagery. Read the <a href="about.en.html">full guide</a>.</li>
  </ul>`;

export function drawerCoreCopy(english = false) {
  return english
    ? {
        lobbyNav: '<a href="#secRules">RULES</a><a href="#secWho">ABOUT THE OPPONENT</a><a href="#secBrain">SETTINGS</a>',
        tableNav: (hasMods) => `<a href="#profileSec">PROFILE</a><a href="#secRules">RULES</a><a href="#secWho">ABOUT THE OPPONENT</a>${hasMods ? '<a href="#secMods">MODS</a>' : ''}<a href="#secSeal">COMMITMENTS</a><a class="leave" id="leaveBtn">LEAVE TABLE</a>`,
        rules: RULES_EN,
        opponent: OPPONENT_EN,
        modsHeading: 'MODS · SHARED RULE CARDS',
      }
    : {
        lobbyNav: '<a href="#secRules">规矩</a><a href="#secWho">对面是谁</a><a href="#secBrain">设置</a>',
        tableNav: (hasMods) => `<a href="#profileSec">档案</a><a href="#secRules">规矩</a><a href="#secWho">对面是谁</a>${hasMods ? '<a href="#secMods">词条</a>' : ''}<a href="#secSeal">封印</a><a class="leave" id="leaveBtn">离桌</a>`,
        rules: RULES_ZH,
        opponent: OPPONENT_ZH,
        modsHeading: '词条（本桌明牌）',
      };
}

// Official mods carry authored English display fields. Wish mods are model
// records, so their stored text is returned unchanged and must render data-raw.
export function modDisplay(mod, english = false) {
  const officialEnglish = english && mod?.origin === 'official';
  return {
    name: officialEnglish ? (mod.nameEn ?? mod.name) : mod.name,
    card: officialEnglish ? (mod.cardEn ?? mod.card) : mod.card,
    raw: mod?.origin === 'wish',
  };
}

export function modActionLabel(action, mod, english = false) {
  return english && mod?.origin === 'official' ? (action.labelEn ?? action.label) : action.label;
}
