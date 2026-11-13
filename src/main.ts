import './style.css';
import { FencingGame } from './game/FencingGame';
import type { GameSnapshot } from './game/FencingGame';
import { AI_INFO, WEAPON_INFO } from './game/types';
import type { AIStyle, CombatEvent, Difficulty, MatchConfig, Weapon } from './game/types';

const icon = (name: 'sound' | 'mute' | 'arrow' | 'eye' | 'close' | 'restart' | 'play' | 'help') => {
  const paths = {
    sound: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
    mute: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 5m0-5-5 5"/>',
    arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    restart: '<path d="M4 10a8 8 0 1 1 2 7M4 10V4m0 6h6"/>',
    play: '<path d="m8 5 11 7-11 7V5Z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.2 2.1c-.8.4-1 1-1 1.9m0 3h.01"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main id="game-shell">
    <div id="scene" aria-label="3D 击剑比赛场景"></div>
    <div class="scene-shade"></div>
    <div class="grain"></div>

    <header class="global-header">
      <button class="brand" id="brand-button" aria-label="返回主菜单">
        <span class="brand-mark"><i></i><i></i></span>
        <span><b>EN GARDE</b><small>写实击剑竞技</small></span>
      </button>
      <div class="header-right">
        <span class="ruleset"><i></i> FIE RULESET · 2026</span>
        <button class="icon-button" id="help-button" aria-label="操作说明">${icon('help')}</button>
        <button class="icon-button" id="sound-button" aria-label="关闭声音">${icon('sound')}</button>
      </div>
    </header>

    <section id="menu-screen" class="menu-screen screen-active">
      <div class="hero-copy">
        <div class="eyebrow reveal"><span>01</span> A REALISTIC FENCING SIMULATOR</div>
        <h1 class="reveal delay-1">胜负，<br><em>悬于一寸。</em></h1>
        <p class="hero-intro reveal delay-2">不是更快地出剑，而是更早地读懂。<br>在距离、时机与优先权之间，做出你的选择。</p>
        <div class="hero-principles reveal delay-3">
          <div><b>DISTANCE</b><span>控制每一厘米</span></div>
          <div><b>INTENTION</b><span>捕捉肩臂预兆</span></div>
          <div><b>TIMING</b><span>一剑，胜过十剑</span></div>
        </div>
      </div>

      <div class="match-setup reveal delay-2">
        <div class="setup-heading"><span>MATCH SETUP</span><b>对局配置</b><small>单人竞技</small></div>
        <div class="setup-section weapon-section">
          <label><span>选择剑种</span><small>WEAPON</small></label>
          <div class="weapon-options">
            ${(['foil', 'epee', 'sabre'] as Weapon[]).map((weapon) => {
              const info = WEAPON_INFO[weapon];
              return `<button class="weapon-option ${weapon === 'foil' ? 'selected' : ''}" data-weapon="${weapon}">
                <span class="weapon-index">${info.index}</span>
                <span class="weapon-name"><b>${info.name}</b><small>${info.french}</small></span>
                <span class="weapon-rule">${info.target}<br>${info.rule}</span>
                <span class="selection-line"></span>
              </button>`;
            }).join('')}
          </div>
        </div>
        <div class="setup-section opponent-section">
          <label><span>对手风格</span><small>OPPONENT</small></label>
          <div class="opponent-select-wrap">
            <div class="opponent-avatar"><span>AI</span><i></i></div>
            <div class="opponent-copy"><b id="style-name">防守反击</b><span id="style-french">THE TACTICIAN</span></div>
            <select id="style-select" aria-label="对手风格">
              <option value="counter">防守反击 · The Tactician</option>
              <option value="aggressive">激进压迫 · The Chaser</option>
              <option value="deceiver">佯攻变线 · The Illusionist</option>
            </select>
            <span class="select-chevron">⌄</span>
          </div>
          <p id="style-description">控制距离，诱导出手，格挡后反击。</p>
        </div>
        <div class="setup-section difficulty-section">
          <label><span>竞技强度</span><small>DIFFICULTY</small></label>
          <div class="segmented" id="difficulty-options">
            <button data-difficulty="rookie">入门</button>
            <button class="selected" data-difficulty="advanced">进阶</button>
            <button data-difficulty="master">大师</button>
          </div>
        </div>
        <div class="setup-footer-options">
          <label class="assist-toggle"><input type="checkbox" id="assists-toggle" checked><span class="toggle-track"><i></i></span><span>距离辅助<small>DISTANCE ASSIST</small></span></label>
          <div class="match-length"><span>赛制</span><button data-score="5">5 剑</button><button class="selected" data-score="15">15 剑</button></div>
        </div>
        <button id="start-button" class="start-button"><span><small>STEP ON THE PISTE</small>走上剑道</span>${icon('arrow')}</button>
        <p class="pointer-note">进入后锁定鼠标 · ESC 随时暂停 · 建议佩戴耳机</p>
      </div>
      <div class="menu-footer"><span>FIE 国际击剑竞赛规则</span><span>PROTOTYPE / BUILD 0.1.0</span><span>DESIGNED FOR PC</span></div>
    </section>

    <section id="hud" class="hud hidden" aria-live="polite">
      <div class="mask-overlay" id="mask-overlay"><div class="mask-mesh"></div></div>
      <div class="scoreboard">
        <div class="competitor player-competitor"><span class="competitor-tag">YOU</span><div><b>PLAYER 01</b><small id="player-weapon">花剑 · FOIL</small></div><strong id="player-score">0</strong></div>
        <div class="match-clock"><span id="hud-weapon">FOIL</span><b id="match-time">03:00</b><small id="round-label">15 TOUCH MATCH</small></div>
        <div class="competitor ai-competitor"><strong id="ai-score">0</strong><div><b id="ai-name">THE TACTICIAN</b><small>OPPONENT · AI</small></div><span class="competitor-tag">AI</span></div>
      </div>
      <div class="scoring-light player-light" id="player-light"><i></i><span>VALID</span></div>
      <div class="scoring-light ai-light" id="ai-light"><i></i><span>VALID</span></div>
      <div class="priority-indicator neutral" id="priority-indicator"><span class="priority-icon">R</span><div><small>RIGHT OF WAY</small><b id="priority-text">中立 · 无优先权</b></div></div>
      <div class="view-indicator" id="view-indicator">${icon('eye')}<span>第三人称</span><kbd>Q</kbd></div>

      <div class="referee-call" id="referee-call"><small>ARBITRE</small><b>En garde</b><span>双方进入预备线</span></div>
      <div class="crosshair" id="crosshair"><i></i><i></i><span></span></div>
      <div class="event-toast" id="event-toast"><b></b><span></span></div>
      <div class="combat-log" id="combat-log"></div>

      <div class="distance-panel" id="distance-panel">
        <div class="hud-caption"><span>DISTANCE / 距离感</span><small>LIVE</small></div>
        <div class="distance-value"><strong id="distance-value">4.40</strong><span>m</span><b id="distance-zone">安全距离</b></div>
        <div class="distance-track"><div class="zone inside"></div><div class="zone lunge"></div><div class="zone threat"></div><div class="zone safe"></div><i id="distance-marker"></i></div>
        <div class="distance-labels"><span>内围</span><span>弓步</span><span>威胁</span><span>安全</span></div>
      </div>

      <div class="action-panel">
        <small>CURRENT ACTION</small><b id="player-action">En garde · 预备</b>
        <div class="action-divider"></div><span id="opponent-action">观察对手肩臂</span>
      </div>

      <div class="parry-panel">
        <div class="hud-caption"><span>PARRY / 格挡位</span><small>1—8</small></div>
        <div class="parry-dial" id="parry-dial">
          ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<span data-parry="${n}" class="parry-point p${n}">${n}</span>`).join('')}
          <div class="parry-center"><small>PARRY</small><b id="parry-number">4</b></div>
          <i class="parry-line"></i>
        </div>
        <p>右键格挡 · 鼠标选择方位</p>
      </div>

      <div class="quick-controls">
        <span><kbd>W</kbd><kbd>S</kbd> 步法</span><span><i class="mouse left"></i> 刺 / 劈</span><span><i class="mouse right"></i> 格挡</span><span><kbd>⇧</kbd> 弓步</span><span><kbd>F</kbd> 冲刺</span><span><kbd>G</kbd> 佯攻</span>
      </div>
      <button id="capture-button" class="capture-button hidden">点击回到剑道</button>
    </section>

    <section id="pause-screen" class="modal-screen hidden">
      <div class="modal-backdrop"></div><div class="pause-content">
        <div class="eyebrow"><span>II</span> MATCH SUSPENDED</div><h2>Halt<span>.</span></h2><p>比赛已冻结。你的动作与优先权将被保留。</p>
        <div class="modal-actions"><button class="primary-action" id="resume-button">${icon('play')}继续对局</button><button id="restart-button">${icon('restart')}重新开始</button><button id="quit-button">返回配置</button></div>
        <small class="esc-hint">按 ESC 继续</small>
      </div>
    </section>

    <section id="end-screen" class="modal-screen hidden">
      <div class="modal-backdrop"></div><div class="end-content">
        <div class="eyebrow"><span>END</span> MATCH TERMINÉ</div><h2 id="end-title">Victoire<span>.</span></h2><p id="end-subtitle">你赢下了这场对局</p>
        <div class="final-score"><div><small>YOU</small><b id="final-player-score">15</b></div><span>—</span><div><small>OPPONENT</small><b id="final-ai-score">12</b></div></div>
        <div class="match-stats"><div><b id="stat-hits">0</b><span>有效命中</span></div><div><b id="stat-parries">0</b><span>成功格挡</span></div><div><b id="stat-attacks">0</b><span>发起进攻</span></div></div>
        <div class="modal-actions"><button class="primary-action" id="rematch-button">${icon('restart')}再战一场</button><button id="end-menu-button">调整对局配置</button></div>
      </div>
    </section>

    <section id="help-screen" class="modal-screen hidden">
      <div class="modal-backdrop"></div><div class="help-content">
        <button class="icon-button help-close" id="help-close" aria-label="关闭">${icon('close')}</button>
        <div class="eyebrow"><span>?</span> FENCING MANUAL</div><h2>先读懂，再出剑。</h2>
        <div class="manual-grid">
          <div><h3>步法与距离</h3><dl><dt><kbd>W / S</kbd></dt><dd>Advance / Retreat<br><small>向前步 / 向后步</small></dd><dt><kbd>A / D</kbd></dt><dd>重心侧向微调</dd><dt><kbd>C</kbd></dt><dd>Half-step 半步</dd><dt><kbd>V</kbd></dt><dd>Glissade 滑步</dd><dt><kbd>Space</kbd></dt><dd>Ballestra 跃步</dd></dl></div>
          <div><h3>进攻与防守</h3><dl><dt><kbd>左键</kbd></dt><dd>Simple Attack 直刺 / 劈砍</dd><dt><kbd>右键</kbd></dt><dd>Parry 格挡<br><small>鼠标方位决定 1—8 号位</small></dd><dt><kbd>Shift</kbd></dt><dd>Lunge 弓步进攻</dd><dt><kbd>F</kbd></dt><dd>Flèche 冲刺进攻</dd><dt><kbd>G</kbd></dt><dd>Feint 佯攻，接左键变线</dd></dl></div>
          <div><h3>剑刃与视野</h3><dl><dt><kbd>鼠标</kbd></dt><dd>独立控制剑尖轨迹</dd><dt><kbd>E</kbd></dt><dd>Prise de fer 压剑</dd><dt><kbd>Q</kbd></dt><dd>第一 / 第三人称切换</dd><dt><kbd>1—8</kbd></dt><dd>辅助选择格挡位</dd><dt><kbd>ESC</kbd></dt><dd>Halt 暂停比赛</dd></dl></div>
        </div>
        <div class="manual-rule"><b>教练提示</b><p>弓步落空后的恢复阶段最脆弱。花剑与佩剑中，成功格挡会转移优先权；单纯后撤躲开不会。佯攻后快速横移鼠标并再次出手，可完成 Disengagement 转移进攻。</p></div>
      </div>
    </section>
  </main>
`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const config: MatchConfig = { weapon: 'foil', style: 'counter', difficulty: 'advanced', assists: true, targetScore: 15 };
let latestSnapshot: GameSnapshot | undefined;
let refereeTimer = 0;
let toastTimer = 0;
let endShown = false;

function showReferee(title: string, detail: string, duration = 1500) {
  window.clearTimeout(refereeTimer);
  const call = $('#referee-call');
  call.querySelector('b')!.textContent = title;
  call.querySelector('span')!.textContent = detail;
  call.classList.remove('call-visible');
  requestAnimationFrame(() => call.classList.add('call-visible'));
  refereeTimer = window.setTimeout(() => call.classList.remove('call-visible'), duration);
}

function showToast(title: string, detail: string) {
  window.clearTimeout(toastTimer);
  const toast = $('#event-toast');
  toast.querySelector('b')!.textContent = title;
  toast.querySelector('span')!.textContent = detail;
  toast.classList.add('visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 1300);
}

function addLog(event: CombatEvent) {
  if (!['parry', 'hit', 'invalid', 'score', 'blade'].includes(event.type)) return;
  const item = document.createElement('div');
  item.className = `log-item ${event.side ?? ''} ${event.valid === false ? 'invalid' : ''}`;
  item.innerHTML = `<i></i><div><b>${event.title}</b><span>${event.detail ?? ''}</span></div>`;
  $('#combat-log').prepend(item);
  while ($('#combat-log').children.length > 3) $('#combat-log').lastElementChild!.remove();
  window.setTimeout(() => item.classList.add('faded'), 3600);
  window.setTimeout(() => item.remove(), 4400);
}

function onGameEvent(event: CombatEvent) {
  addLog(event);
  if (event.type === 'phase') showReferee(event.title, event.detail ?? '', event.title.includes('Victoire') || event.title.includes('Terminé') ? 2500 : 1400);
  if (event.type === 'parry') showToast(event.title, event.detail ?? '');
  if (event.type === 'blade') showToast(event.title, event.detail ?? '');
  if (event.type === 'invalid') showToast(event.title, event.detail ?? '');
  if (event.type === 'score') {
    showReferee(event.title, event.detail ?? '', 1800);
    const shell = $('#game-shell');
    shell.classList.remove('scored-player', 'scored-ai', 'scored-both');
    void shell.offsetWidth;
    shell.classList.add(event.title.includes('双方') ? 'scored-both' : event.side === 'player' ? 'scored-player' : 'scored-ai');
    window.setTimeout(() => shell.classList.remove('scored-player', 'scored-ai', 'scored-both'), 700);
  }
  if (event.type === 'score' || event.type === 'invalid') {
    for (const side of ['player', 'ai']) {
      const light = $(`#${side}-light`);
      const active = event.side === side || event.title.includes('双方');
      light.classList.toggle('active', active);
      light.classList.toggle('white', event.type === 'invalid');
      light.querySelector('span')!.textContent = event.type === 'invalid' ? 'OFF TARGET' : 'VALID';
      if (active) window.setTimeout(() => light.classList.remove('active', 'white'), 1800);
    }
  }
}

function onGameUpdate(snapshot: GameSnapshot) {
  latestSnapshot = snapshot;
  $('#player-score').textContent = String(snapshot.score.player);
  $('#ai-score').textContent = String(snapshot.score.ai);
  const seconds = Math.ceil(snapshot.time);
  $('#match-time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('#round-label').textContent = snapshot.overtime ? 'SUDDEN DEATH' : `${config.targetScore} TOUCH MATCH`;
  $('#distance-value').textContent = snapshot.distance.toFixed(2);
  $('#distance-zone').textContent = snapshot.zone;
  $('#distance-marker').style.left = `${Math.max(1, Math.min(99, (4.7 - snapshot.distance) / 4.25 * 100))}%`;
  $('#player-action').textContent = snapshot.playerAction;
  $('#opponent-action').textContent = snapshot.aiAction === 'En garde · 预备' ? '观察对手肩臂' : `对手 · ${snapshot.aiAction}`;
  $('#parry-number').textContent = String(snapshot.parry);
  document.querySelectorAll('.parry-point').forEach((point) => point.classList.toggle('active', Number((point as HTMLElement).dataset.parry) === snapshot.parry));
  $('#parry-dial').style.setProperty('--parry-angle', `${(snapshot.parry - 1) * 45}deg`);
  const priority = $('#priority-indicator');
  priority.className = `priority-indicator ${snapshot.priority ?? 'neutral'} ${config.weapon === 'epee' ? 'epee' : ''}`;
  $('#priority-text').textContent = config.weapon === 'epee' ? '无优先权 · 先中得分' : snapshot.priority === 'player' ? '你持有进攻优先权' : snapshot.priority === 'ai' ? '对手持有进攻优先权' : '中立 · 无优先权';
  $('#view-indicator span').textContent = snapshot.view === 'first' ? '第一人称 · 面罩视野' : '第三人称 · 战术视野';
  $('#hud').classList.toggle('first-person', snapshot.view === 'first');
  $('#distance-panel').classList.toggle('assist-hidden', !config.assists);
  $('#pause-screen').classList.toggle('hidden', snapshot.phase !== 'pause');
  $('#capture-button').classList.toggle('hidden', snapshot.phase !== 'allez' || Boolean(document.pointerLockElement));
  if (snapshot.phase === 'end' && !endShown) showEnd(snapshot);
}

const game = new FencingGame($('#scene'), onGameEvent, onGameUpdate);

function selectButton(selector: string, selected: HTMLElement) {
  document.querySelectorAll(selector).forEach((button) => button.classList.toggle('selected', button === selected));
}

document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach((button) => {
  button.addEventListener('click', () => {
    config.weapon = button.dataset.weapon as Weapon;
    selectButton('[data-weapon]', button);
    game.previewConfig(config);
    $('#player-weapon').textContent = `${WEAPON_INFO[config.weapon].name} · ${WEAPON_INFO[config.weapon].french}`;
    $('#hud-weapon').textContent = WEAPON_INFO[config.weapon].french;
  });
});

$('#style-select').addEventListener('change', (event) => {
  config.style = (event.target as HTMLSelectElement).value as AIStyle;
  const info = AI_INFO[config.style];
  $('#style-name').textContent = info.name;
  $('#style-french').textContent = info.french;
  $('#style-description').textContent = info.description;
  $('#ai-name').textContent = info.french;
});

document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((button) => button.addEventListener('click', () => {
  config.difficulty = button.dataset.difficulty as Difficulty;
  selectButton('[data-difficulty]', button);
}));
$('#assists-toggle').addEventListener('change', (event) => { config.assists = (event.target as HTMLInputElement).checked; });
document.querySelectorAll<HTMLButtonElement>('[data-score]').forEach((button) => button.addEventListener('click', () => {
  config.targetScore = Number(button.dataset.score);
  selectButton('[data-score]', button);
}));

function startMatch() {
  endShown = false;
  $('#combat-log').innerHTML = '';
  $('#menu-screen').classList.add('hidden');
  $('#pause-screen').classList.add('hidden');
  $('#end-screen').classList.add('hidden');
  $('#help-screen').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  document.body.classList.add('in-match');
  game.startMatch(config);
}

function returnToMenu() {
  game.toMenu();
  endShown = false;
  $('#hud').classList.add('hidden');
  $('#pause-screen').classList.add('hidden');
  $('#end-screen').classList.add('hidden');
  $('#menu-screen').classList.remove('hidden');
  document.body.classList.remove('in-match');
}

function showEnd(snapshot: GameSnapshot) {
  endShown = true;
  const won = snapshot.score.player > snapshot.score.ai;
  $('#end-title').innerHTML = won ? 'Victoire<span>.</span>' : 'Défaite<span>.</span>';
  $('#end-subtitle').textContent = won ? '你赢下了这场对局。距离与判断，胜过速度。' : '对局结束。复盘每一次出手，再走上剑道。';
  $('#final-player-score').textContent = String(snapshot.score.player);
  $('#final-ai-score').textContent = String(snapshot.score.ai);
  $('#stat-hits').textContent = String(snapshot.stats.hits);
  $('#stat-parries').textContent = String(snapshot.stats.parries);
  $('#stat-attacks').textContent = String(snapshot.stats.attacks);
  $('#end-screen').classList.remove('hidden');
}

$('#start-button').addEventListener('click', startMatch);
$('#resume-button').addEventListener('click', () => game.resume());
$('#restart-button').addEventListener('click', startMatch);
$('#rematch-button').addEventListener('click', startMatch);
$('#quit-button').addEventListener('click', returnToMenu);
$('#end-menu-button').addEventListener('click', returnToMenu);
$('#brand-button').addEventListener('click', () => { if (document.body.classList.contains('in-match')) game.pause(); else returnToMenu(); });
$('#capture-button').addEventListener('click', () => game.requestPointer());
$('#sound-button').addEventListener('click', () => {
  game.audio.enabled = !game.audio.enabled;
  $('#sound-button').innerHTML = icon(game.audio.enabled ? 'sound' : 'mute');
  $('#sound-button').setAttribute('aria-label', game.audio.enabled ? '关闭声音' : '开启声音');
});
let helpWasPlaying = false;
$('#help-button').addEventListener('click', () => {
  helpWasPlaying = ['allez', 'ready', 'en garde'].includes(latestSnapshot?.phase ?? 'menu');
  if (helpWasPlaying) game.pause();
  $('#pause-screen').classList.add('hidden');
  $('#help-screen').classList.remove('hidden');
});
$('#help-close').addEventListener('click', () => {
  $('#help-screen').classList.add('hidden');
  if (helpWasPlaying) game.resume();
  helpWasPlaying = false;
});
window.addEventListener('keydown', (event) => {
  if (event.code === 'Enter' && !document.body.classList.contains('in-match') && $('#help-screen').classList.contains('hidden')) startMatch();
});
