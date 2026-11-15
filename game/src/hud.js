// The DOM HUD: health and armor bars, money, ammo, timer, team score, bomb
// status, kill feed, round banners, the buy menu and the overlay panels. It never
// touches the simulation; main.js pushes numbers in and reads callbacks out.
// Every setter skips DOM writes when the value did not change.
const COPY = {
  start: {
    title: 'Dusk Harbor',
    copy: 'A tactical round shooter on a working port at sunset. Vanguard attacks, Sentinel defends. Plant the bomb or clear the harbor.',
    action: 'Click to play',
  },
  paused: {
    title: 'Dusk Harbor',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundWon: {
    title: 'Round won',
    copy: '',
    action: 'Next round',
  },
  roundLost: {
    title: 'Round lost',
    copy: '',
    action: 'Next round',
  },
  dead: {
    title: 'You are down',
    copy: 'Spectating a teammate. The round plays on without you.',
    action: 'Keep watching',
  },
  matchWon: {
    title: 'Harbor taken',
    copy: '',
    action: 'Play again',
  },
  matchLost: {
    title: 'Harbor held',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthBar = $('health-fill');
  const healthNum = $('health-num');
  const armorBar = $('armor-fill');
  const armorNum = $('armor-num');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const roundLabel = $('round-label');
  const scoreV = $('score-vanguard');
  const scoreS = $('score-sentinel');
  const bombStatus = $('bomb-status');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damage = $('damage');
  const buyMenu = $('buy-menu');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const plantBar = $('plant-fill');
  const plantWrap = $('plant-progress');
  const defuseWrap = $('defuse-warning');
  const defuseFill = $('defuse-fill');

  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastBomb = '';
  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;

  return {
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve && name === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = name;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
    },
    setHealth(health, armor) {
      if (health === lastHealth && armor === lastArmor) return;
      lastHealth = health;
      lastArmor = armor;
      healthNum.textContent = String(Math.ceil(health));
      healthBar.style.width = `${Math.max(0, health)}%`;
      armorNum.textContent = String(Math.ceil(armor));
      armorBar.style.width = `${Math.max(0, Math.min(100, armor * 2))}%`;
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
      if (buyMoney) buyMoney.textContent = `$${value}`;
    },
    setTimer(seconds, phase) {
      const text = phase === 'buy' ? `BUY ${Math.ceil(seconds)}` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('buy', phase === 'buy');
    },
    setScore(vanguard, sentinel, round) {
      const text = `${vanguard}-${sentinel}|${round}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreV.textContent = String(vanguard);
      scoreS.textContent = String(sentinel);
      roundLabel.textContent = `ROUND ${round}`;
    },
    setBombStatus(text) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombStatus.textContent = text;
      bombStatus.classList.toggle('alert', text.includes('PLANTED') || text.includes('DEFUSING'));
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damage.classList.remove('on'), 180);
    },
    killFeed(text, friendly) {
      const line = document.createElement('div');
      line.className = friendly ? 'feed-line friendly' : 'feed-line enemy';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
      setTimeout(() => line.remove(), 5000);
    },
    banner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.remove('hidden');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.add('hidden'), ms);
    },
    hideBanner() {
      banner.classList.add('hidden');
    },
    setPlantProgress(p) {
      plantWrap.classList.toggle('hidden', p <= 0);
      plantBar.style.width = `${Math.round(p * 100)}%`;
    },
    setDefuseWarning(show, p) {
      defuseWrap.classList.toggle('hidden', !show);
      if (show) defuseFill.style.width = `${Math.round(p * 100)}%`;
    },
    buildBuyMenu(items, onBuy) {
      buyList.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = item.disabled;
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">${item.price === 0 ? 'FREE' : '$' + item.price}</span>`;
        row.addEventListener('click', () => onBuy(item.id));
        buyList.appendChild(row);
      }
    },
    showBuy(open) {
      buyMenu.classList.toggle('hidden', !open);
    },
    showOverlay(mode, score) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = text.copy || score || '';
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
