const copyButton = document.getElementById('copyButton');
const copyStatus = document.getElementById('copyStatus');
const commandNode = document.getElementById('command');
const packageHash = document.getElementById('packageHash');
const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
let bestOf = 1;
let agent = params.get('agent') === 'claude' ? 'claude' : 'codex';

const TEXT = {
  zh: {
    title: '和你自己的 Codex 打一局 · 《开！》', eyebrow: 'LOCAL AGENT MATCH',
    headline: '和你自己的<br>Codex 打一局。', lede: '不用交 API Key。启动器在你的电脑开一张本地牌桌，调用你已经登录的 Codex，然后自动打开浏览器。',
    runLabel: '启动', runTitle: '复制这一条命令', copy: '复制', copying: '复制中', copied: '已复制', copyFailed: '复制失败，请手动选中命令',
    status: '在 Terminal、PowerShell 或任意命令行中运行。', stepsLabel: '发生什么', stepsTitle: '全程只在你的电脑',
    stepOneTitle: '检查 Codex', stepOneBody: '确认本机已经安装并登录 Codex CLI。',
    stepTwoTitle: '启动本地裁判', stepTwoBody: '下载一次性运行包，在 127.0.0.1 创建权威牌桌。',
    stepThreeTitle: '你和 Codex 入座', stepThreeBody: '浏览器控制你的席位，Codex 通过固定席位 MCP 行动。',
    specLabel: '边界', specTitle: '它会碰什么，不会碰什么', reqNodeLabel: '需要', reqNodeValue: 'Node.js 20+ · 已登录的 Codex CLI',
    accountLabel: '账号', accountValue: '只由你本机的 Codex CLI 使用', networkLabel: '牌桌', networkValue: '仅绑定 127.0.0.1，不对公网开放',
    recordsLabel: '记录', recordsValue: '写入你当前目录下的 kai-liars-records/', footerStatement: '你的 Codex。你的额度。你的桌。',
    footerMeta: '本地运行 · 无账号托管 · 非官方', hashLoading: '读取中…', hashFailed: '校验值暂不可用', opponentCaption: '本地对手', seriesCaption: '系列长度',
  },
  en: {
    title: 'Play Liar\'s Dice against your own Codex · Kai', eyebrow: 'LOCAL AGENT MATCH',
    headline: 'Play your own<br>Codex.', lede: 'No API key form. The launcher opens a referee on your computer, starts the Codex CLI you already signed into, and opens the table in your browser.',
    runLabel: 'Run', runTitle: 'Copy one command', copy: 'Copy', copying: 'Copying', copied: 'Copied', copyFailed: 'Copy failed. Select the command manually.',
    status: 'Run it in Terminal, PowerShell, or any command line.', stepsLabel: 'What happens', stepsTitle: 'Everything stays on your computer',
    stepOneTitle: 'Check Codex', stepOneBody: 'Make sure Codex CLI is installed and signed in.',
    stepTwoTitle: 'Start a local referee', stepTwoBody: 'The one-time package creates the authoritative table on 127.0.0.1.',
    stepThreeTitle: 'Take your seats', stepThreeBody: 'You play in the browser. Codex acts through its fixed-seat MCP.',
    specLabel: 'Boundary', specTitle: 'What it touches—and what it does not', reqNodeLabel: 'Requires', reqNodeValue: 'Node.js 20+ · Codex CLI signed in',
    accountLabel: 'Account', accountValue: 'Used only by Codex CLI on your computer', networkLabel: 'Table', networkValue: 'Bound to 127.0.0.1; never exposed publicly',
    recordsLabel: 'Records', recordsValue: 'Written to kai-liars-records/ under your current directory', footerStatement: 'Your Codex. Your account. Your table.',
    footerMeta: 'Runs locally · No hosted account · Unofficial', hashLoading: 'Loading…', hashFailed: 'Checksum unavailable', opponentCaption: 'Local opponent', seriesCaption: 'Series length',
  },
};

const AGENT_TEXT = {
  zh: {
    codex: {
      title: '和你自己的 Codex 打一局 · 《开！》', headline: '和你自己的<br>Codex 打一局。',
      lede: '不用交 API Key。启动器在你的电脑开一张本地牌桌，调用你已经登录的 Codex，然后自动打开浏览器。',
      stepOneTitle: '检查 Codex', stepOneBody: '确认本机已经安装并登录 Codex CLI。',
      stepThreeTitle: '你和 Codex 入座', stepThreeBody: '浏览器控制你的席位，Codex 通过固定席位 MCP 行动。',
      reqNodeValue: 'Node.js 20+ · 已登录的 Codex CLI', accountValue: '只由你本机的 Codex CLI 使用', footerStatement: '你的 Codex。你的额度。你的桌。',
    },
    claude: {
      title: '和你自己的 Claude Code 打一局 · 《开！》', headline: '和你自己的<br>Claude Code 打一局。',
      lede: '不用交 API Key。启动器在你的电脑开一张本地牌桌，调用你已经登录的 Claude Code，然后自动打开浏览器。',
      stepOneTitle: '检查 Claude Code', stepOneBody: '确认本机已经安装并登录 Claude Code。',
      stepThreeTitle: '你和 Claude 入座', stepThreeBody: '浏览器控制你的席位，Claude Code 通过固定席位 MCP 行动。',
      reqNodeValue: 'Node.js 20+ · 已登录的 Claude Code', accountValue: '只由你本机的 Claude Code 使用', footerStatement: '你的 Claude。你的额度。你的桌。',
    },
  },
  en: {
    codex: {
      title: 'Play Liar\'s Dice against your own Codex · Kai', headline: 'Play your own<br>Codex.',
      lede: 'No API key form. The launcher opens a referee on your computer, starts the Codex CLI you already signed into, and opens the table in your browser.',
      stepOneTitle: 'Check Codex', stepOneBody: 'Make sure Codex CLI is installed and signed in.',
      stepThreeTitle: 'Take your seats', stepThreeBody: 'You play in the browser. Codex acts through its fixed-seat MCP.',
      reqNodeValue: 'Node.js 20+ · Codex CLI signed in', accountValue: 'Used only by Codex CLI on your computer', footerStatement: 'Your Codex. Your account. Your table.',
    },
    claude: {
      title: 'Play Liar\'s Dice against your own Claude Code · Kai', headline: 'Play your own<br>Claude Code.',
      lede: 'No API key form. The launcher opens a referee on your computer, starts the Claude Code CLI you already signed into, and opens the table in your browser.',
      stepOneTitle: 'Check Claude Code', stepOneBody: 'Make sure Claude Code is installed and signed in.',
      stepThreeTitle: 'Take your seats', stepThreeBody: 'You play in the browser. Claude Code acts through its fixed-seat MCP.',
      reqNodeValue: 'Node.js 20+ · Claude Code signed in', accountValue: 'Used only by Claude Code on your computer', footerStatement: 'Your Claude. Your account. Your table.',
    },
  },
};

function applyAgentCopy() {
  const text = AGENT_TEXT[language][agent];
  document.title = text.title;
  document.getElementById('headline').innerHTML = text.headline;
  for (const id of ['lede', 'stepOneTitle', 'stepOneBody', 'stepThreeTitle', 'stepThreeBody', 'reqNodeValue', 'accountValue', 'footerStatement']) {
    document.getElementById(id).textContent = text[id];
  }
  updateLanguageLink();
}

function updateLanguageLink() {
  const languageLink = document.getElementById('languageLink');
  languageLink.textContent = language === 'en' ? '中文' : 'EN';
  const linkParams = new URLSearchParams();
  if (language !== 'en') linkParams.set('lang', 'en');
  if (agent === 'claude') linkParams.set('agent', 'claude');
  languageLink.href = `agent.html${linkParams.size ? `?${linkParams}` : ''}`;
}

function applyLanguage() {
  const text = TEXT[language];
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title = text.title;
  const htmlBindings = ['headline'];
  const bindings = [
    'eyebrow', 'lede', 'runLabel', 'runTitle', 'stepsLabel', 'stepsTitle',
    'stepOneTitle', 'stepOneBody', 'stepTwoTitle', 'stepTwoBody', 'stepThreeTitle', 'stepThreeBody',
    'specLabel', 'specTitle', 'reqNodeLabel', 'reqNodeValue', 'accountLabel', 'accountValue',
    'networkLabel', 'networkValue', 'recordsLabel', 'recordsValue', 'footerStatement', 'footerMeta', 'opponentCaption', 'seriesCaption',
  ];
  for (const id of bindings) document.getElementById(id).textContent = text[id];
  for (const id of htmlBindings) document.getElementById(id).innerHTML = text[id];
  copyButton.textContent = text.copy;
  copyStatus.textContent = text.status;
  packageHash.textContent = text.hashLoading;
  updateLanguageLink();
  applyAgentCopy();
}

function updateCommand() {
  const packageUrl = `${location.origin}/downloads/kai-${agent}-play.tgz`;
  commandNode.textContent = `npx --yes ${packageUrl}${bestOf === 3 ? ' --best-of 3' : ''}`;
}

function loadHash() {
  packageHash.textContent = TEXT[language].hashLoading;
  fetch(`downloads/kai-${agent}-play.sha256`, { cache: 'no-store' })
    .then((response) => response.ok ? response.text() : Promise.reject(new Error('checksum unavailable')))
    .then((value) => { packageHash.textContent = value.split(/\s+/)[0]; })
    .catch(() => { packageHash.textContent = TEXT[language].hashFailed; });
}

async function copyCommand() {
  const text = TEXT[language];
  copyButton.disabled = true;
  copyButton.dataset.state = 'loading';
  copyButton.textContent = text.copying;
  try {
    await navigator.clipboard.writeText(commandNode.textContent);
    copyButton.dataset.state = 'success';
    copyButton.textContent = text.copied;
    copyStatus.textContent = text.copied;
    copyStatus.dataset.tone = 'success';
  } catch {
    copyButton.dataset.state = 'error';
    copyButton.textContent = text.copy;
    copyStatus.textContent = text.copyFailed;
    copyStatus.dataset.tone = 'error';
  }
  setTimeout(() => {
    copyButton.disabled = false;
    copyButton.dataset.state = 'default';
    copyButton.textContent = text.copy;
  }, 1400);
}

for (const option of document.querySelectorAll('[data-best-of]')) option.addEventListener('click', () => {
  bestOf = Number(option.dataset.bestOf);
  for (const button of document.querySelectorAll('[data-best-of]')) {
    const selected = Number(button.dataset.bestOf) === bestOf;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  updateCommand();
});
for (const option of document.querySelectorAll('[data-agent]')) option.addEventListener('click', () => {
  agent = option.dataset.agent;
  for (const button of document.querySelectorAll('[data-agent]')) {
    const selected = button.dataset.agent === agent;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  applyAgentCopy();
  updateCommand();
  loadHash();
});
copyButton.addEventListener('click', copyCommand);

for (const button of document.querySelectorAll('[data-agent]')) {
  const selected = button.dataset.agent === agent;
  button.classList.toggle('is-selected', selected);
  button.setAttribute('aria-pressed', String(selected));
}
applyLanguage();
updateCommand();
loadHash();
