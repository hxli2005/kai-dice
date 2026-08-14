// English adaptation for the player-facing shell.
//
// Chinese remains the canonical/default product language. `?lang=en` selects
// English and is persisted for ordinary navigation; `?lang=zh` switches back.
//
// **真迹护栏（DESIGN §3，不可协商）**：DESIGN 第 179 行「真迹不可赛后重写」。
// 这个适配器是**子串替换**——它认不出哪段中文是我们的界面文案、哪段是模型当时
// 留下的话。所以边界不能靠"替换项写得够长"来保证（试过，`改`、`接通`、` 秒`
// 这类片段照样会啃进模型散文，把「他改口了」变成「他EDIT口了」）。
// 边界靠**显式标记**：凡是模型留档（台词、判词、笔记、假设、belief／say）
// 的 DOM 容器一律打 `data-raw`，本模块见到就整棵子树跳过，一个字都不动。
// 老档里的中文留档在英文界面下**原样显示中文**——这是宪法要求的结果，不是缺陷：
// 我们没有权限把它翻译成英文，翻译就是赛后重写。新开的英文局由模型自己用英文写
// （见 outputLanguageRule）。
// ⚠️ 新增任何渲染模型文字的地方，必须同时打 `data-raw`，否则就是违宪。

const LANG_KEY = 'kai.lang.v1';
const hasBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

function queryLanguage() {
  if (!hasBrowser) return null;
  const value = new URLSearchParams(location.search).get('lang');
  return value === 'en' || value === 'zh' ? value : null;
}

export function language() {
  if (!hasBrowser) return 'zh';
  const query = queryLanguage();
  if (query) {
    try { localStorage.setItem(LANG_KEY, query); } catch {}
    return query;
  }
  try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
}

export const isEnglish = () => language() === 'en';

export function languageUrl(next = isEnglish() ? 'zh' : 'en') {
  if (!hasBrowser) return `?lang=${next}`;
  const url = new URL(location.href);
  url.searchParams.set('lang', next);
  return `${url.pathname.split('/').pop() || 'index.html'}${url.search}${url.hash}`;
}

export const outputLanguageRule = () =>
  isEnglish()
    ? 'Write every natural-language value in the JSON output (belief, say, note, reaction text, verdict, hypotheses, and misses) in English.'
    : '';

const EXACT = new Map([
  ['《开！》大厅', 'KAI! · Lobby'],
  ['《开！》三管机对局界面', 'KAI! three-tube match interface'],
  ['开！', 'KAI!'],
  ['三管对局机', 'THREE-TUBE TABLE'],
  ['大厅工具', 'Lobby tools'],
  ['其他设备', 'Other modes and tools'],
  ['其他模式', 'Other modes'],
  ['开局控制台', 'Match console'],
  ['选择桌型', 'CHOOSE TABLE'],
  ['选择对手', 'CHOOSE OPPONENTS'],
  ['正席', 'PRIMARY'],
  ['副席', 'SIDE TABLE'],
  ['单挑', 'HEAD-TO-HEAD'],
  ['三人桌', 'THREE-PLAYER'],
  ['裁判线路', 'TABLE STATUS'],
  ['开局', 'START'],
  ['开实验局', 'START SANDBOX'],
  ['实验桌', 'LAB TABLE'],
  ['开 · 沙盒', 'ON · SANDBOX'],
  ['关', 'OFF'],
  ['本机榜', 'LOCAL STANDINGS'],
  ['本地账本', 'ON-DEVICE LEDGER'],
  ['好友房', 'FRIENDS ROOM'],
  ['邀朋友同桌', 'Invite a friend'],
  ['模型竞技场', 'MODEL ARENA'],
  ['双模型自战 · BYOK', 'AI vs AI · BYOK'],
  ['--设置', '--settings'],
  ['--说明', '--how-to-play'],
  ['设置', 'Settings'],
  ['说明', 'How to play'],
  ['菜单', 'Menu'],
  ['三管机操作', 'Three-tube table controls'],
  ['看自己的骰子', 'Peek at your dice'],
  ['减少报价数量', 'Decrease bid quantity'],
  ['增加报价数量', 'Increase bid quantity'],
  ['报数', 'Place bid'],
  ['选择一点', 'Select ones'],
  ['选择二点', 'Select twos'],
  ['选择三点', 'Select threes'],
  ['选择四点', 'Select fours'],
  ['选择五点', 'Select fives'],
  ['选择六点', 'Select sixes'],
  ['宣盲', 'Declare Blind'],
  ['宣斋', 'Declare No-Wilds'],
  ['宣抬', 'Declare Raise'],
  ['盲', 'BLIND'],
  ['斋', 'NO-WILDS'],
  ['抬', 'RAISE'],
  ['报', 'BID'],
  ['开', 'CALL'],
  ['戳', 'POKE'],
  ['扩', 'MORE'],
  ['数量', 'COUNT'],
  ['你', 'YOU'],
  ['它', 'AI'],
  ['客人', 'GUEST'],
  ['出局', 'OUT'],
  ['在动', 'ACTING'],
  ['在看', 'WATCHING'],
  ['AI生成', 'AI-GENERATED'],
  ['阶梯', 'LADDER'],
  ['深水', 'DEEP'],
  ['判定', 'RULING'],
  ['成立', 'STANDS'],
  ['不成立', 'FALSE'],
  ['掐中', 'CALZA'],
  ['掐空', 'MISSED'],
  ['换桌', 'CHANGE TABLE'],
  ['再来一局', 'PLAY AGAIN'],
  ['胜负', 'RESULT'],
  ['赢', 'WIN'],
  ['输', 'LOSS'],
  ['局数', 'ROUNDS'],
  ['身家', 'BALANCE'],
  ['虚报率', 'BLUFF RATE'],
  ['其中', 'BREAKDOWN'],
  ['蒙报', 'BLIND BIDS'],
  ['开牌命中', 'CALL ACCURACY'],
  ['被他开', 'CALLED BY AI'],
  ['平均思考', 'AVG. THINK TIME'],
  ['词条', 'MODS'],
  ['名次', 'STANDINGS'],
  ['场', 'MATCH'],
  ['档案', 'PROFILE'],
  ['规矩', 'RULES'],
  ['对面是谁', 'ABOUT THE OPPONENT'],
  ['封印', 'COMMITMENTS'],
  ['离桌', 'LEAVE TABLE'],
  ['你的账', 'YOUR RECORD'],
  ['他们的本子', 'THEIR NOTEBOOKS'],
  ['完整说明 →', 'FULL GUIDE →'],
  ['保存', 'SAVE'],
  ['验证中…', 'TESTING…'],
  ['客席', 'GUEST SEAT'],
  ['格式', 'FORMAT'],
  ['撤席', 'REMOVE SEAT'],
  ['拉一份现在的模型清单', 'LOAD CURRENT MODEL LIST'],
  ['免费', 'free'],
  ['便宜', 'low-cost'],
  ['挑一枚名章', 'CHOOSE A SEAL'],
  ['先不了', 'NOT NOW'],
  ['你的手，你自己知道', 'Your move — you know what you did'],
  ['说：', 'Said: '],
  ['想：', 'Thought: '],
  ['诈', 'BAIT'],
  ['戏眼', 'KEY MOMENT'],
  ['暂无记录', 'No record yet'],
  ['生面孔', 'NEW OPPONENT'],
  ['他还没对你立过案。', 'No hypotheses about you yet.'],
  ['你记错了', 'You got that wrong'],
  ['你在演', 'You are bluffing'],
  ['慢着', 'Hold on'],
  ['显示已降级', 'DISPLAY FALLBACK'],
  ['规则与操作仍可继续', 'Rules and controls still work'],
  ['现在不能用', 'Not available now'],
  ['演出中 · 触摸加速', 'SEQUENCE · TAP TO SKIP'],
  ['触摸骰仓看骰', 'TAP DICE BAY TO PEEK'],
  ['三 管 机 · 正 在 通 电', 'THREE-TUBE TABLE · POWERING ON'],
  ['触 摸 跳 过', 'TAP TO SKIP'],
  ['待 报', 'AWAITING BID'],
  ['点 清', 'COUNTING'],
  ['判 定', 'RULING'],
]);

// Copy fragments are intentionally specific. Avoid short, general-purpose
// substitutions here so model-authored historical prose is not rewritten.
const PHRASES = [
  ['榜上还没有人。完成第一局，本机会把第一行写在这里。', 'No results yet. Finish a match to write the first line to this device.'],
  ['榜上还没有人。打一场，这里就有第一行。', 'No results yet. Play a match to add the first line.'],
  ['一整场，他只读你一个人。', 'For the whole match, the opponent reads only you.'],
  ['朋友局／混沌局：热闹，但两个人分他的心。想被读透，回单挑。', 'Friends / chaos mode: busier, but the AI splits its attention. Choose head-to-head to be read closely.'],
  ['需要 ', 'NEED '],
  [' 席', ' SEAT(S)'],
  [' 席已接通', ' SEAT(S) CONNECTED'],
  ['接通', 'CONNECTED'],
  ['自带钥匙 · 你的模型以本名上桌', 'BYOK · Your model joins under its real model name'],
  // ⚠️ 这里曾有一条 `['改', 'EDIT']`。**单字片段不许进 PHRASES**——它排在
  // `['改口 ', 'FOLDED ']` 前面，把我们自己的文案啃成了「点此EDIT为公开」
  // 「用 −／＋ EDIT数量」「HELD 2 EDIT口 1」，还让下面两条完整句子的替换永远命中不了。
  // 客席卡那颗「改」按钮已改走 isEnglish() 分支（main.js）。同理不许再加
  // `接通`／` 秒`／` 口` 这类短词——要翻就在渲染处开分支，别往子串表里塞。
  ['许愿＋', 'WISH +'],
  ['勾上的新规矩全桌明牌。实验局不入榜、不记账、不进档案。', 'Selected rules are public to the whole table. Sandbox matches do not affect standings, balances, or profiles.'],
  ['本机存档 · 无账号 · 模型名仅作事实性标注 · 非官方 · 无关联', 'On-device saves · No account · Model names are factual labels only · Unofficial · No affiliation'],
  ['钥匙已分流：你的自带钥匙在「客席」卡上；官方人物（李/飞/账）只认「设置」里的暗号。点此收起', 'Keys have moved: configure BYOK on the Guest Seat card; official seats use the access code in Settings. Tap to dismiss.'],
  ['托管 · 一键可玩', 'HOSTED · PLAY NOW'],
  ['官方通道 · 需暗号', 'OFFICIAL CHANNEL · CODE REQUIRED'],
  ['客席 · 自带钥匙', 'GUEST SEAT · BYOK'],
  ['这一席的账由官方通道出，你什么都不用配。', 'This seat is hosted. No setup is required.'],
  ['走官方通道，需要暗号。', 'Uses the official channel and requires an access code.'],
  ['你的钥匙，浏览器直连，key 不出这台设备。', 'Uses your key in a direct browser connection; the key stays on this device.'],
  ['真身：', 'MODEL: '],
  ['实验 · ', 'LAB · '],
  ['深水 ×2', 'DEEP WATER ×2'],
  ['盲 ×2', 'BLIND ×2'],
  ['斋 ×1.5', 'NO-WILDS ×1.5'],
  ['抬 ×2', 'RAISE ×2'],
  ['（一号机代打）', ' (AI SUBSTITUTE)'],
  ['（掉线）', ' (DISCONNECTED)'],
  ['他在想', 'AI is thinking'],
  ['轮到你了。', 'Your move.'],
  ['还在？', 'Still there?'],
  ['该你出手了。', 'Your move.'],
  ['暗号不对', 'Wrong access code'],
  ['今日额度用完', 'Daily quota reached'],
  ['今日免费额度用完了（有暗号可填在设置里）', 'Free daily quota reached (enter an access code in Settings)'],
  ['官方通道未开或已熔断', 'The official channel is unavailable'],
  ['这个域名没有官方通道', 'This domain has no official channel'],
  ['他说胡话了', 'The model returned an invalid move'],
  ['响应超时', 'Response timed out'],
  ['网络不通', 'Network unavailable'],
  ['未填暗号', 'No access code entered'],
  ['官方通道未开（服务端没配 key）', 'The official channel is not configured'],
  ['已连通', 'Connected'],
  ['降级沉默', 'fell back to silent mode'],
  ['开房中…', 'CREATING ROOM…'],
  ['房间未响应 · 再试', 'ROOM UNAVAILABLE · RETRY'],
  ['重连失败，房间可能已散', 'Could not reconnect; the room may have closed'],
  ['连接断了', 'Connection lost'],
  ['房间服务没应——稍后再试', 'The room service did not respond — try again later'],
  ['截屏即可分享 · 这一场已记进他的本子', 'Screenshot to share · This match is now in the opponent’s notebook'],
  ['实验局 · 不入榜不入账不入档案', 'Sandbox · No standings, balance, or profile changes'],
  ['看看他当时怎么想的 →', 'SEE WHAT THE AI THOUGHT →'],
  ['实验桌 · 沙盒对局', 'LAB TABLE · SANDBOX MATCH'],
  ['对局档案', 'MATCH REPORT'],
  ['（赊着）', ' (IN DEBT)'],
  ['（沙盒·不记账）', ' (SANDBOX · NOT RECORDED)'],
  ['（没看过骰）', ' (DICE NOT SEEN)'],
  ['看过骰的 ', 'ACROSS '],
  [' 口', ' BIDS'],
  ['明知 ', 'KNOWING '],
  ['看走眼 ', 'MISREAD '],
  ['最狠 ', 'WILDEST '],
  ['掉一颗骰', ' lost one die'],
  ['池 ×', 'POT ×'],
  ['你参战 ', 'YOU PLAYED '],
  ['全桌 ', 'TABLE TOTAL '],
  [' 秒', ' SEC'],
  [' 场 ', ' MATCHES · '],
  [' 胜', ' WINS'],
  ['翻篇 ', 'RESETS '],
  ['破绽：', 'TELL: '],
  ['对你 ', 'VS YOU '],
  [' 战 ', ' MATCHES · '],
  ['被戳 ', 'POKED '],
  [' 次', ' TIMES'],
  ['嘴硬 ', 'HELD '],
  ['改口 ', 'FOLDED '],
  ['虚报 ', 'BLUFFS '],
  ['开牌 ', 'CALLS '],
  ['不盲', 'NO BLINDS'],
  ['的假设', ' · HYPOTHESES'],
  ['立案：第 ', 'OPENED: MATCH '],
  ['证据 ', ' · EVIDENCE '],
  ['反例 ', ' · COUNTEREXAMPLES '],
  ['撤案', 'CLOSED'],
  ['他的小本子', 'THE AI NOTEBOOK'],
  ['假设的一生', 'HYPOTHESIS HISTORY'],
  ['左边是桌上发生的事（引擎盖的章，错不了）；右边是他当时心里记下的——', 'The left side is the engine-verified table record. The right side is what the AI wrote at the time — '],
  ['真迹，不是真相', 'an authentic trace, not objective truth'],
  ['他记成什么样就是什么样：记歪了、嘴硬了、把五次记成两次，那也是他当时的脑子。这些字都是当时留的，散场之后谁也改不了，包括他自己。', 'It may be mistaken, stubborn, or misremember a count. These notes were recorded in the moment and cannot be rewritten after the match — not even by the AI.'],
  ['你翻过这本子——这事他知道（可在设置里关掉）。', 'You opened this notebook. The AI knows (you can disable this in Settings).'],
  ['你翻本子的事没告诉他（设置里已关）。', 'The AI was not told you opened the notebook (disabled in Settings).'],
  ['（你的手，你自己知道）', '(Your move — you know what you did.)'],
  ['（不用想：他不玩盲，上桌先掀盅）', '(Automatic: this seat does not play blind and peeked immediately.)'],
  ['（这一手没开口——通道断了，纯算数行棋）', '(No model response — silent fallback made this move.)'],
  ['（没留话）', '(No note left.)'],
  ['你的账', 'YOUR RECORD'],
  ['轮流报「桌上共有几个几」。', 'Take turns bidding how many dice of one face are on the whole table. '],
  ['只能往上抬', 'Bids must rise'],
  ['：数量加大，或同数量、点数加大——抬不动了就只能开。', ': increase the quantity, or keep the quantity and increase the face. If no higher bid is possible, you must call.'],
  ['1 点是万能牌', 'Ones are wild'],
  ['（癞子），清点时算作任意点数；宣「斋」的那一局失效。', ' and count as any face; No-Wilds disables wild ones for that round.'],
  ['开只开上家：数够，开的人输；不够，报的人输。输家掉一骰，掉光出局。', 'You may only call the previous bidder. If the bid stands, the caller loses; otherwise the bidder loses. The loser drops one die and is eliminated at zero.'],
  ['每报一手，全桌各追 1 注；开牌胜者收整池。', 'Every bid adds one stake per player. The winner of the call takes the whole pot.'],
  ['第 6 手报价起进深水：池自动再 ×2。倍率全部相乘。', 'From the sixth bid onward, Deep Water automatically doubles the pot. All multipliers stack.'],
  ['额度片按 1／5／25／100 合并显示。不限时——但你手停多久，他们都记着。', 'Chips are grouped in denominations of 1 / 5 / 25 / 100. There is no timer, but the AI records how long you take.'],
  ['模型是真身', 'The model is the opponent'],
  ['提示词只管规则', 'The prompt contains rules only'],
  ['系统说话零容忍，他说话零审查', 'System facts are strict; model speech is unfiltered'],
  ['说明页', 'guide'],
  ['站内的模型名只是事实性标注。本作与各模型厂商无关联、未获授权，不使用其商标与形象。', 'Model names are factual labels only. This game is unofficial, unaffiliated with model providers, and uses none of their logos or characters. '],
  ['大厅第一席（', 'The first lobby seat ('],
  ['）**不用配任何东西**，直接开局——那一席的账我们出，每天一份免费额度。下面这格是给机位用的。', ') needs no setup: start playing immediately on the hosted daily quota. The field below is for other official seats.'],
  ['暗号（官方通道——解锁机位与更高额度）', 'Access code (official channel — unlocks other seats and a higher quota)'],
  ['自带 API？在大厅的「客席」卡上填钥匙，你的模型以本名上桌。', 'Bringing your own API? Configure it on the Guest Seat card; your model joins under its real model name.'],
  ['翻小本子这件事：', 'Opening the notebook: '],
  ['他知道（点此改为不告诉他）', 'the AI knows (click to make it private)'],
  ['不告诉他（点此改为公开）', 'private (click to tell the AI)'],
  ['清空本地记录（档案·账本·战绩）', 'Clear local data (profiles · balances · results)'],
  ['再点一次确认——档案、账本、战绩将全部清空（钥匙保留）', 'Click again to confirm — all profiles, balances, and results will be cleared (keys are kept)'],
  ['自带钥匙，让你的模型以本名上桌——素颜，无剧本，只守规矩。换模型＝换人，各记各的账。钥匙只存这台设备，浏览器直连模型商。', 'Bring your own key and seat a model under its real model name — no persona script, just the rules. Each model keeps a separate record. Your key stays on this device and the browser connects directly to the provider.'],
  ['一把钥匙开一屋子模型：', 'Use one key for many models: '],
  ['用 OpenRouter', 'USE OPENROUTER'],
  ['用 DeepSeek', 'USE DEEPSEEK'],
  ['筛一筛：claude / deepseek / 便宜 / 免费', 'Filter: claude / deepseek / low-cost / free'],
  ['OpenAI 兼容', 'OpenAI-compatible'],
  ['保存并试一手', 'SAVE & TEST'],
  ['三格都要填', 'All three fields are required'],
  ['拉取中…', 'LOADING…'],
  ['价格不定（路由型）', 'Variable price (router)'],
  ['思考型（慢且贵）', 'Reasoning model (slower and pricier)'],
  ['每百万', 'per million'],
  ['清单 ', 'LIST: '],
  [' 个，显示 ', ' MODELS · SHOWING '],
  [' 个。', '.'],
  ['清单拉不下来（网络或它那边的事）——照旧手敲 Model 就行。', 'Could not load the list. You can still enter a model ID manually.'],
  ['已选 ', 'SELECTED '],
  ['好友房里没有名字，只有章——桌上喊你就喊这个字。', 'Friends Rooms use seals instead of names. This mark identifies you at the table.'],
  ['点任意处，上桌', 'TAP ANYWHERE TO PLAY'],
  ['看明白了？点任意处，上桌', 'READY? TAP ANYWHERE TO PLAY'],
  ['点骰盅，偷看自己的骰子', 'Tap your cup to peek at your dice'],
  ['报数：桌上共有几个几', 'Bid the total number of a face on the table'],
  ['觉得他吹牛，拍「开」', 'Think the bid is false? Press CALL'],
  ['盲、斋、抬：池子翻倍，赢多输也多', 'Blind, Exact, and Raise multiply the pot — both wins and losses'],
  ['点数加大。抬不动了就只能开。', 'increase the face at the same quantity. If you cannot raise, you must call.'],
  ['倍率对全桌双向生效，赢多输也多。', 'Multipliers apply to everyone: win more, lose more.'],
];

const DYNAMIC = [
  [/^第\s*(\d+)\s*局$/, 'ROUND $1'],
  [/^第\s*(\d+)\s*局([\s\S]*)$/, 'ROUND $1$2'],
  [/^(\d+)\/(\d+)\s*席已接通$/, '$1/$2 SEAT(S) CONNECTED'],
  [/^需要\s*(\d+)\s*席$/, 'NEED $1 SEAT(S)'],
  [/^报\s*(\d+)\s*个\s*(\d+)$/, 'BID $1 × $2'],
  [/^(\d+)\s*个$/, '$1 ×'],
  [/^(\d+)\s*局$/, '$1 ROUNDS'],
  [/^(\d+)\s*次$/, '$1 TIMES'],
  [/^今日\s*(\d+)\/(.+)$/, 'TODAY $1/$2'],
  [/^模型清单$/, 'MODEL LIST'],
];

export function translateUiText(value, lang = language()) {
  if (lang !== 'en' || value == null) return value;
  const raw = String(value);
  if (EXACT.has(raw)) return EXACT.get(raw);
  const leading = raw.match(/^\s*/)?.[0] ?? '';
  const trailing = raw.match(/\s*$/)?.[0] ?? '';
  const core = raw.trim();
  if (EXACT.has(core)) return leading + EXACT.get(core) + trailing;
  let out = core;
  for (const [pattern, replacement] of DYNAMIC) {
    if (pattern.test(out)) {
      out = out.replace(pattern, replacement);
      break;
    }
  }
  for (const [from, to] of PHRASES) out = out.split(from).join(to);
  return leading + out + trailing;
}

// 真迹护栏：`data-raw` 子树内一律不碰（见文件头）。textarea 同理——那是玩家自己敲的字。
const RAW = 'script,style,textarea,[data-raw]';
const isRaw = (node) => {
  const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return !(el instanceof Element) || !!el.closest(RAW);
};

function localizeElement(el) {
  if (!(el instanceof Element) || el.closest(RAW)) return;
  for (const attr of ['aria-label', 'title', 'placeholder']) {
    if (!el.hasAttribute(attr)) continue;
    const before = el.getAttribute(attr);
    const after = translateUiText(before);
    if (after !== before) el.setAttribute(attr, after);
  }
  if (el.matches('a[href="about.html"]')) el.setAttribute('href', 'about.en.html');
  if (el.matches('a[href="index.html"]')) el.setAttribute('href', 'index.html?lang=en');
}

function localizeTree(root) {
  if (!isEnglish() || !root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (isRaw(root)) return;
    const after = translateUiText(root.nodeValue);
    if (after !== root.nodeValue) root.nodeValue = after;
    return;
  }
  if (!(root instanceof Element) && root !== document) return;
  if (root instanceof Element) {
    if (root.closest(RAW)) return; // 整棵真迹子树跳过，连里面的元素属性也不碰
    localizeElement(root);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (isRaw(node)) continue;
      const after = translateUiText(node.nodeValue);
      if (after !== node.nodeValue) node.nodeValue = after;
    } else localizeElement(node);
  }
}

let observer = null;

export function installEnglishUi() {
  if (!hasBrowser || !isEnglish()) return;
  document.documentElement.lang = 'en';
  document.documentElement.classList.add('lang-en');
  document.title = document.title.includes('大厅') ? 'KAI! · Lobby' : translateUiText(document.title);
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', 'manifest.en.webmanifest');
  localizeTree(document);
  if (observer) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) localizeTree(node);
      if (record.type === 'characterData') localizeTree(record.target);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
