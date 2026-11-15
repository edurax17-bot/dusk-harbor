// Rounds and the economy: buy phase, live round, round end, match end. Vanguard
// attacks, Sentinel defends. A round ends by elimination, by the bomb exploding,
// by a defuse, or on the timer (defenders win). First to 5 rounds takes the
// match. Money: kill +300, round win +3250, loss +1900, plant +300, defuse +300.
// The bomb is the player's to carry and plant; if the player dies it is lost and
// the round becomes elimination-only for Vanguard.
import * as THREE from 'three';
import { SITES } from './world.js';

export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const BOMB_SECONDS = 35;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 5;
export const ROUND_END_SECONDS = 4;
export const WIN_ROUNDS = 5;

export function createRounds(hooks) {
  const state = {
    phase: 'buy', // buy | live | over | match
    round: 1,
    scoreVanguard: 0,
    scoreSentinel: 0,
    timeLeft: BUY_SECONDS,
    money: 800,
    bomb: {
      carried: true,
      planted: false,
      lost: false,
      site: null,
      position: null,
      timer: 0,
      defuseProgress: 0,
      defuser: null,
    },
    winner: null,
    matchWinner: null,
    message: '',
  };

  const bombMesh = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.18, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.5, metalness: 0.4 }),
  );
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff4444 }),
  );
  bombLight.position.set(0, 0.12, 0);
  bombMesh.add(bombBody, bombLight);
  bombMesh.visible = false;

  let plantProgress = 0;
  let plantingSite = null;
  let beepAt = 0;

  function siteAt(x, z) {
    for (const key of Object.keys(SITES)) {
      const r = SITES[key].rect;
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return key;
    }
    return null;
  }

  function endRound(winner, message) {
    if (state.phase === 'over' || state.phase === 'match') return;
    state.phase = 'over';
    state.timeLeft = ROUND_END_SECONDS;
    state.winner = winner;
    state.message = message;
    if (winner === 'vanguard') state.scoreVanguard += 1;
    else state.scoreSentinel += 1;
    state.money += winner === 'vanguard' ? 3250 : 1900;
    if (hooks.onRoundEnd) hooks.onRoundEnd(winner, message, state.scoreVanguard, state.scoreSentinel);
    if (state.scoreVanguard >= WIN_ROUNDS || state.scoreSentinel >= WIN_ROUNDS) {
      state.matchWinner = state.scoreVanguard >= WIN_ROUNDS ? 'vanguard' : 'sentinel';
    }
  }

  function startRound() {
    state.phase = 'live';
    state.timeLeft = ROUND_SECONDS;
    plantProgress = 0;
    plantingSite = null;
    state.bomb.defuseProgress = 0;
    state.bomb.defuser = null;
    if (hooks.onRoundStart) hooks.onRoundStart(state.round);
  }

  function startBuy() {
    state.round += 1;
    state.phase = 'buy';
    state.timeLeft = BUY_SECONDS;
    state.bomb.carried = true;
    state.bomb.planted = false;
    state.bomb.lost = false;
    state.bomb.site = null;
    state.bomb.position = null;
    state.bomb.timer = 0;
    state.bomb.defuseProgress = 0;
    state.bomb.defuser = null;
    bombMesh.visible = false;
    plantProgress = 0;
    plantingSite = null;
    if (hooks.onBuyPhase) hooks.onBuyPhase(state.round);
  }

  function plantBomb(site, position) {
    state.bomb.planted = true;
    state.bomb.carried = false;
    state.bomb.site = site;
    state.bomb.position = position.clone();
    state.bomb.timer = BOMB_SECONDS;
    state.money += 300;
    bombMesh.position.copy(position);
    bombMesh.position.y = 0.12;
    bombMesh.visible = true;
    beepAt = 0;
    if (hooks.onPlant) hooks.onPlant(site);
  }

  function step(dt, ctx) {
    if (state.phase === 'buy') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) startRound();
      return;
    }
    if (state.phase === 'live') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        endRound('sentinel', 'Time up — Sentinel holds the harbor.');
        return;
      }
      // Planting: the player holds E inside a site while carrying the bomb.
      if (state.bomb.carried && ctx.player.alive && ctx.planting) {
        const site = siteAt(ctx.player.position.x, ctx.player.position.z);
        if (site) {
          if (plantingSite !== site) {
            plantingSite = site;
            plantProgress = 0;
          }
          plantProgress += dt;
          if (plantProgress >= PLANT_SECONDS) {
            plantBomb(site, ctx.player.position);
            plantingSite = null;
            plantProgress = 0;
          }
        } else {
          plantingSite = null;
          plantProgress = 0;
        }
      } else {
        plantingSite = null;
        plantProgress = 0;
      }

      // The planted bomb ticks down and beeps faster as it nears zero.
      if (state.bomb.planted) {
        state.bomb.timer -= dt;
        beepAt -= dt;
        if (beepAt <= 0) {
          beepAt = Math.max(0.25, state.bomb.timer / BOMB_SECONDS);
          bombLight.material.color.setHex(bombLight.material.color.getHex() === 0xff4444 ? 0xffffff : 0xff4444);
          if (hooks.onBombBeep) hooks.onBombBeep();
        }
        if (state.bomb.timer <= 0) {
          bombMesh.visible = false;
          endRound('vanguard', 'The bomb detonated — Vanguard takes the round.');
          if (hooks.onExplode) hooks.onExplode(state.bomb.position);
          return;
        }
        // Defuse: a Sentinel bot standing on the bomb works it for 5 seconds.
        const defuser = ctx.nearestDefender ? ctx.nearestDefender(state.bomb.position, 1.6) : null;
        if (defuser) {
          state.bomb.defuser = defuser;
          state.bomb.defuseProgress += dt / DEFUSE_SECONDS;
          if (state.bomb.defuseProgress >= 1) {
            bombMesh.visible = false;
            endRound('sentinel', 'The bomb was defused — Sentinel takes the round.');
            return;
          }
        } else {
          state.bomb.defuser = null;
          state.bomb.defuseProgress = 0;
        }
      }

      // Elimination check. A planted bomb keeps the round alive even if every
      // Vanguard is down: the defenders must defuse it before it blows.
      if (ctx.aliveCounts) {
        const counts = ctx.aliveCounts();
        if (counts.sentinel === 0) {
          endRound('vanguard', 'Sentinel team eliminated.');
          return;
        }
        if (counts.vanguard === 0 && !state.bomb.planted) {
          endRound('sentinel', 'Vanguard team eliminated.');
        }
      }
      return;
    }
    if (state.phase === 'over') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        if (state.matchWinner) {
          state.phase = 'match';
          if (hooks.onMatchEnd) hooks.onMatchEnd(state.matchWinner, state.scoreVanguard, state.scoreSentinel);
        } else {
          startBuy();
          if (hooks.onResetRound) hooks.onResetRound();
        }
      }
    }
  }

  return {
    state,
    bombMesh,
    step,
    siteAt,
    plantProgress() {
      return plantingSite ? plantProgress / PLANT_SECONDS : 0;
    },
    plantingSite() {
      return plantingSite;
    },
    loseBomb() {
      if (state.bomb.carried) {
        state.bomb.carried = false;
        state.bomb.lost = true;
      }
    },
    spend(amount) {
      if (state.money < amount) return false;
      state.money -= amount;
      return true;
    },
    startBuy,
    endRound,
  };
}
