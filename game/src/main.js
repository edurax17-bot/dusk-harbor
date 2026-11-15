// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. Dusk Harbor: 5v5 rounds, Vanguard attacks, Sentinel defends.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, GRENADE_PRICE, ARMOR_PRICE, AMMO_PRICE } from './weapon.js';
import { createGrenades } from './grenade.js';
import { createBots } from './bots.js';
import { createAudio } from './audio.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const KILL_REWARD = 300;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const VANGUARD_NAMES = ['Vex', 'Heron', 'Mako', 'Rook'];
const SENTINEL_NAMES = ['Ash', 'Bram', 'Cy', 'Dune', 'Echo'];

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = shot ? mulberry32(seed) : mulberry32((Date.now() % 2147483647) | 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 22, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const sfx = createAudio();
const world = createWorld(scene);
const hud = createHud();
const player = createPlayer(world.colliders);
const weapon = createWeapon(camera, sfx);
const grenades = createGrenades(scene, world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();

// Tracer pool: ten reusable lines, no allocation while firing.
const tracers = [];
for (let i = 0; i < 10; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0 });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}

function spawnTracer(from, to, color) {
  const tracer = tracers.find((t) => t.life <= 0) || tracers[0];
  const pos = tracer.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  tracer.line.material.color.setHex(color);
  tracer.line.visible = true;
  tracer.life = 0.07;
}

function botName(bot) {
  return bot.team === 'vanguard' ? VANGUARD_NAMES[bot.index] : SENTINEL_NAMES[bot.index];
}

let shake = 0;
let buyOpen = false;
let started = false;
let frozen = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let wasFiring = false;
let playerFired = null;
let spectateBot = null;

const body = player.state;

const rounds = createRounds({
  onBuyPhase(round) {
    hud.banner(`ROUND ${round} — BUY PHASE`, 'Press B to buy. Vanguard plants, Sentinel defends.', 3000);
    buildBuyMenu();
    hud.setBombStatus('BOMB WITH YOU — PLANT AT A OR B');
  },
  onRoundStart(round) {
    hud.hideOverlay();
    hud.banner(`ROUND ${round}`, 'Plant the bomb at A or B — or clear the harbor.', 2600);
    if (input.state.locked) hud.hideOverlay();
  },
  onRoundEnd(winner, message) {
    const won = winner === 'vanguard';
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', message, 3800);
    if (won) sfx.roundWin();
    else sfx.roundLose();
    if (!player.state.alive) hud.showOverlay('dead', 0);
  },
  onResetRound() {
    resetRound();
  },
  onMatchEnd(winner) {
    const won = winner === 'vanguard';
    hud.showOverlay(won ? 'matchWon' : 'matchLost', `Final score — Vanguard ${rounds.state.scoreVanguard} : ${rounds.state.scoreSentinel} Sentinel.`);
    if (document.pointerLockElement) document.exitPointerLock();
    started = false;
  },
  onPlant(site) {
    hud.setBombStatus(`BOMB PLANTED AT SITE ${site} — ${SITES[site].name.toUpperCase()}`);
    hud.banner('BOMB PLANTED', `Defend site ${site} until it blows.`, 3000);
    sfx.plant();
  },
  onBombBeep() {
    sfx.beep();
  },
  onExplode(position) {
    grenades.detonate(position, null);
    shake = 0.6;
    sfx.explosion();
  },
});

const bots = createBots(scene, world, random, {
  damagePlayer(amount, fromPos, head) {
    if (shot) return; // staged captures never kill the player
    if (!player.state.alive) return;
    player.applyDamage(amount);
    hud.damageFlash();
    shake = Math.max(shake, 0.12);
    if (!player.state.alive) {
      rounds.loseBomb();
      hud.killFeed('A Sentinel eliminated you', false);
      hud.banner('YOU ARE DOWN', 'Spectating a teammate.', 3000);
      spectateBot = bots.bots.find((b) => b.team === 'vanguard' && b.alive) || null;
      if (document.pointerLockElement) document.exitPointerLock();
    }
  },
  tracer(from, to) {
    muzzle.set(from.x, from.y + 1.28, from.z);
    spawnTracer(muzzle, to, 0x2ec4b6);
  },
  shotSound(fromPos) {
    const d = Math.hypot(fromPos.x - body.position.x, fromPos.z - body.position.z);
    if (d < 26) sfx.shot('rifle');
  },
  onBotDeath(bot, attacker) {
    const victim = botName(bot);
    if (attacker === 'player') return; // the player's own shoot path reports it
    if (attacker && attacker.team) {
      hud.killFeed(`${botName(attacker)} ▸ ${victim}`, attacker.team === 'vanguard');
    } else {
      hud.killFeed(`${victim} is down`, bot.team === 'vanguard');
    }
  },
});

const shootables = world.shootables.concat(bots.hitMeshes);

function resetRound() {
  bots.reset(rounds.state.round);
  const spawn = { x: 0, z: 13.5, yaw: 0 };
  player.respawn(spawn.x, spawn.z, spawn.yaw);
  weapon.refill();
  grenades.clear();
  spectateBot = null;
  hud.setHealth(100, 0);
  hud.setAmmo(weapon.currentAmmo().mag, weapon.currentAmmo().reserve, weapon.currentName());
  hud.setBombStatus('BOMB WITH YOU — PLANT AT A OR B');
  hud.setDefuseWarning(false, 0);
  hud.setPlantProgress(0);
}

function buildBuyMenu() {
  const money = rounds.state.money;
  const ownedPrimary = weapon.owned.primary ? weapon.owned.primary.id : null;
  const items = [
    { id: 'rifle', key: '1', name: WEAPONS.rifle.name, desc: 'Versatile automatic rifle — 34 dmg, 30 rounds', price: WEAPONS.rifle.price, disabled: money < WEAPONS.rifle.price || ownedPrimary === 'rifle' },
    { id: 'smg', key: '2', name: WEAPONS.smg.name, desc: 'Fast close-quarters SMG — 22 dmg, 32 rounds', price: WEAPONS.smg.price, disabled: money < WEAPONS.smg.price || ownedPrimary === 'smg' },
    { id: 'dmr', key: '3', name: WEAPONS.dmr.name, desc: 'Long-range marksman rifle — 80 dmg, 5 rounds', price: WEAPONS.dmr.price, disabled: money < WEAPONS.dmr.price || ownedPrimary === 'dmr' },
    { id: 'grenade', key: '4', name: 'HE-1 Grenade', desc: 'Thrown explosive, 120 max damage in 6 m', price: GRENADE_PRICE, disabled: money < GRENADE_PRICE || weapon.state.grenades >= 2 },
    { id: 'armor', key: '5', name: 'Kevlar Armor', desc: 'Absorbs half of each hit, 50 points', price: ARMOR_PRICE, disabled: money < ARMOR_PRICE || player.state.armor >= 50 },
    { id: 'ammo', key: '6', name: 'Ammo refill', desc: 'Top up reserve ammo for every owned gun', price: AMMO_PRICE, disabled: money < AMMO_PRICE },
  ];
  hud.buildBuyMenu(items, buyItem);
}

function buyItem(id) {
  if (rounds.state.phase !== 'buy') return;
  let result = { ok: false, cost: 0 };
  if (id === 'rifle' || id === 'smg' || id === 'dmr') result = weapon.buyPrimary(id, rounds.state.money);
  else if (id === 'grenade') result = weapon.buyGrenade(rounds.state.money);
  else if (id === 'armor') result = weapon.buyArmor(rounds.state.money);
  else if (id === 'ammo') result = weapon.buyAmmo(rounds.state.money);
  if (!result.ok) return;
  if (id === 'armor') player.state.armor = 50;
  rounds.spend(result.cost);
  sfx.buy();
  hud.setMoney(rounds.state.money);
  hud.setAmmo(weapon.currentAmmo().mag, weapon.currentAmmo().reserve, weapon.currentName());
  hud.setHealth(player.state.health, player.state.armor);
  buildBuyMenu();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (buyOpen) {
      buyOpen = false;
      hud.showBuy(false);
    }
  } else if (!buyOpen && rounds.state.phase !== 'match') {
    hud.showOverlay(started ? 'paused' : 'start', 0);
  }
}

hud.onPlay(() => {
  if (shot) return;
  sfx.unlock();
  if (rounds.state.phase === 'match') {
    rounds.state.scoreVanguard = 0;
    rounds.state.scoreSentinel = 0;
    rounds.state.round = 0;
    rounds.state.money = 800;
    rounds.state.matchWinner = null;
    rounds.state.winner = null;
    resetRound();
    rounds.startBuy();
    input.requestLock();
    return;
  }
  if (rounds.state.phase === 'over' || rounds.state.phase === 'buy') input.requestLock();
  else input.requestLock();
});

function syncCamera() {
  if (!player.state.alive && spectateBot && spectateBot.alive) {
    camera.position.set(spectateBot.position.x, spectateBot.position.y + 1.6, spectateBot.position.z);
    camera.rotation.set(0, spectateBot.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  if (shake > 0) {
    camera.rotation.x += (random() - 0.5) * shake * 0.06;
    camera.rotation.y += (random() - 0.5) * shake * 0.06;
  }
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  const def = weapon.currentDef();
  if (!def) return false;
  if (!weapon.takeRound()) {
    sfx.dry();
    return false;
  }
  scene.updateMatrixWorld(true);
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  muzzle.copy(camera.position).addScaledVector(direction, 0.6);
  if (hit) {
    spawnTracer(muzzle, hit.point, 0xf5a623);
    const target = hit.object.userData.bot;
    if (target) {
      const killed = bots.damageBot(target, hit.object.userData.part === 'head' ? def.headDamage : def.damage, hit.object.userData.part, 'player');
      if (killed) {
        rounds.state.money += KILL_REWARD;
        hud.setMoney(rounds.state.money);
        hud.killFeed(`You ▸ ${botName(target)}${hit.object.userData.part === 'head' ? ' (headshot)' : ''}`, true);
        hud.hitMarker(true, 4000);
        sfx.kill();
      } else {
        hud.hitMarker(false);
        sfx.hit();
      }
    }
  } else {
    const far = camera.position.clone().addScaledVector(direction, 80);
    spawnTracer(muzzle, far, 0xf5a623);
  }
  weapon.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  shake = Math.max(shake, 0.05);
  hud.setAmmo(weapon.currentAmmo().mag, weapon.currentAmmo().reserve, weapon.currentName());
  return true;
}

function throwGrenade() {
  if (!weapon.throwGrenade()) return;
  scene.updateMatrixWorld(true);
  camera.getWorldDirection(direction);
  const origin = camera.position.clone().addScaledVector(direction, 0.5);
  origin.y -= 0.1;
  grenades.throwFrom(origin, direction, 13);
  hud.setAmmo(weapon.currentAmmo().mag, weapon.currentAmmo().reserve, weapon.currentName());
}

function blastDamage(at, radius, maxDamage, minDamage) {
  shake = Math.max(shake, 0.5);
  sfx.explosion();
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.position.x - at.x, bot.position.z - at.z);
    if (d > radius) continue;
    const dmg = Math.round(maxDamage - ((maxDamage - minDamage) * d) / radius);
    const killed = bots.damageBot(bot, dmg, 'torso', bot.team === 'sentinel' ? 'player' : null);
    if (killed && bot.team === 'sentinel') {
      rounds.state.money += KILL_REWARD;
      hud.setMoney(rounds.state.money);
      hud.killFeed(`You ▸ ${botName(bot)} (grenade)`, true);
    }
  }
  if (player.state.alive) {
    const d = Math.hypot(body.position.x - at.x, body.position.z - at.z);
    if (d < radius) {
      const dmg = Math.round((maxDamage - ((maxDamage - minDamage) * d) / radius) * 0.6);
      player.applyDamage(dmg);
      hud.damageFlash();
      if (!player.state.alive) {
        rounds.loseBomb();
        hud.killFeed('Your own grenade took you down', false);
        spectateBot = bots.bots.find((b) => b.team === 'vanguard' && b.alive) || null;
      }
    }
  }
}

function nearestDefender(position, radius) {
  let best = null;
  let bestD = Infinity;
  for (const bot of bots.bots) {
    if (bot.team !== 'sentinel' || !bot.alive) continue;
    const d = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
    if (d < radius && d < bestD) {
      bestD = d;
      best = bot;
    }
  }
  return best;
}

function step(dt) {
  elapsed += dt;
  shake = Math.max(0, shake - dt * 1.4);
  player.step(dt, input.state.keys);
  weapon.step(dt);
  bots.step(dt, {
    time: elapsed,
    player: { position: body.position, alive: player.state.alive, y: body.position.y },
    playerFired,
    bomb: rounds.state.bomb.planted ? { planted: true, site: rounds.state.bomb.site } : null,
  });
  grenades.step(dt, blastDamage);
  rounds.step(dt, {
    player: { position: body.position, alive: player.state.alive },
    planting: input.state.keys.has('KeyE'),
    nearestDefender,
    aliveCounts: () => ({
      vanguard: (player.state.alive ? 1 : 0) + bots.remaining('vanguard'),
      sentinel: bots.remaining('sentinel'),
    }),
  });
  for (const tracer of tracers) {
    if (tracer.life > 0) {
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.07) * 0.9;
      if (tracer.life <= 0) tracer.line.visible = false;
    }
  }
  if (playerFired && elapsed - playerFired.time > 1) playerFired = null;
}

function handlePressed() {
  for (const code of input.takePressed()) {
    if (code === 'KeyB' && rounds.state.phase === 'buy') {
      buyOpen = !buyOpen;
      hud.showBuy(buyOpen);
      if (buyOpen) {
        buildBuyMenu();
        if (document.pointerLockElement) document.exitPointerLock();
      } else {
        input.requestLock();
      }
      continue;
    }
    if (buyOpen) {
      const buyKeys = { Digit1: 'rifle', Digit2: 'smg', Digit3: 'dmr', Digit4: 'grenade', Digit5: 'armor', Digit6: 'ammo' };
      if (buyKeys[code]) buyItem(buyKeys[code]);
      continue;
    }
    if (code === 'Digit1') weapon.switchTo('primary');
    else if (code === 'Digit2') weapon.switchTo('pistol');
    else if (code === 'Digit3' || code === 'KeyG') weapon.switchTo('grenade');
    else if (code === 'KeyR') weapon.reload();
    if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3' || code === 'KeyG') {
      hud.setAmmo(weapon.currentAmmo().mag, weapon.currentAmmo().reserve, weapon.currentName());
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (player.state.alive) player.look(look.x, look.y);
    handlePressed();
    if (buyOpen && rounds.state.phase !== 'buy') {
      buyOpen = false;
      hud.showBuy(false);
    }
    const firing = input.state.firing && player.state.alive && !buyOpen;
    const def = weapon.currentDef();
    if (firing && weapon.ready()) {
      const isAuto = def ? def.auto : false;
      if (isAuto || !wasFiring) {
        if (weapon.state.current === 'grenade') throwGrenade();
        else if (shoot(shot ? 0 : weapon.spread(player.groundSpeed()))) {
          playerFired = { x: body.position.x, z: body.position.z, time: elapsed };
        }
      }
    }
    wasFiring = input.state.firing;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    // HUD refresh (setters skip unchanged values).
    hud.setHealth(player.state.health, player.state.armor);
    hud.setMoney(rounds.state.money);
    hud.setAmmo(weapon.currentAmmo().mag, weapon.currentAmmo().reserve, weapon.currentName());
    hud.setTimer(rounds.state.timeLeft, rounds.state.phase);
    hud.setScore(rounds.state.scoreVanguard, rounds.state.scoreSentinel, rounds.state.round);
    hud.setCrosshairGap(4 + weapon.spread(player.groundSpeed()) * 320);
    hud.setPlantProgress(rounds.plantProgress());
    const bomb = rounds.state.bomb;
    if (bomb.planted) {
      hud.setBombStatus(`BOMB PLANTED AT SITE ${bomb.site} — ${Math.ceil(bomb.timer)}s`);
      hud.setDefuseWarning(bomb.defuseProgress > 0, bomb.defuseProgress);
    } else if (bomb.carried) {
      hud.setBombStatus('BOMB WITH YOU — PLANT AT A OR B');
      hud.setDefuseWarning(false, 0);
    } else if (bomb.lost) {
      hud.setBombStatus('BOMB LOST — ELIMINATE SENTINEL');
      hud.setDefuseWarning(false, 0);
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  scene.add(rounds.bombMesh);
  resetRound();
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'start') {
    body.position.set(0.6, 0, 13.2);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -8));
    hud.showOverlay('start', 0);
  } else if (name === 'buy') {
    body.position.set(0, 0, 12);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -8));
    buildBuyMenu();
    hud.showBuy(true);
  } else if (name === 'play' || name === 'end') {
    // Skip the buy phase: hand the player the rifle and start the round live.
    weapon.owned.primary = { id: 'rifle', mag: WEAPONS.rifle.mag, reserve: WEAPONS.rifle.reserve };
    weapon.state.current = 'primary';
    weapon.refill();
    rounds.state.phase = 'live';
    rounds.state.timeLeft = 88;
    body.position.set(4, 0, 10);
    // Two Sentinels in the open mid-lane, backs turned, for a clean sightline.
    const foe1 = bots.bots.find((b) => b.team === 'sentinel' && b.index === 0);
    const foe2 = bots.bots.find((b) => b.team === 'sentinel' && b.index === 1);
    foe1.position.set(4, 0, -2);
    foe1.yaw = Math.PI;
    foe2.position.set(6, 0, -6);
    foe2.yaw = Math.PI;
    settle(20);
    if (name === 'play') {
      for (let round = 0; round < 3; round += 1) {
        aimAt(bots.aimPoint(4));
        shoot(0);
        if (round < 2) settle(8);
      }
      settle(12);
      aimAt(bots.aimPoint(5));
      shoot(0);
      settle(1);
    } else {
      for (const bot of bots.bots) {
        if (bot.team === 'sentinel') bots.damageBot(bot, 999, 'torso', 'player');
      }
      aimAt(new THREE.Vector3(14, 1.5, -8));
      settle(30);
      hud.showOverlay('roundWon', 'Sentinel team eliminated.');
    }
  }
  hud.setScore(rounds.state.scoreVanguard, rounds.state.scoreSentinel, rounds.state.round);
  hud.setTimer(rounds.state.timeLeft, rounds.state.phase);
  hud.setAmmo(weapon.currentAmmo().mag, weapon.currentAmmo().reserve, weapon.currentName());
  hud.setHealth(player.state.health, player.state.armor);
  hud.setMoney(rounds.state.money);
  // Re-show the combat feedback on the capture frame itself: the feed line
  // and the kill hitmarker fade on real-time timers, and the capture runs
  // seconds after the shots. Display-only; the kill already registered.
  paintTwiceThenReady(name === 'play' ? () => {
    hud.killFeed('You ▸ Ash', true);
    hud.hitMarker(true, 10000);
  } : undefined);
}

function paintTwiceThenReady(onReady) {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      if (onReady) onReady();
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(rounds.bombMesh);
resetRound();
// Debug handle for headless playtests (read-only state inspection).
window.__game = { bots, player, rounds, weapon, hud, body, world, THREE, raycaster, camera, shootables, aimAt, shoot, step, input, grenades, resetRound };
// The first buy phase is the initial state (round 1); its UI is set up here
// rather than through startBuy, which advances to the next round.
hud.banner('ROUND 1 — BUY PHASE', 'Press B to buy. Vanguard plants, Sentinel defends.', 3000);
buildBuyMenu();
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
