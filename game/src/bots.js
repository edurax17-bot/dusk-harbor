// Bots: 4 Vanguard teammates and 5 Sentinel opponents, built from boxes in team
// colours. Each bot runs a small state machine — move along a BFS path over the
// map's waypoint graph, hold and scan, engage on sight, rotate to a planted bomb
// — and hears nearby gunfire. Shots are resolved with a world raycast for
// occlusion and an angular-error test for the hit, so a bot never shoots through
// a wall. No allocations in the step loop: the raycaster, vectors and the BFS
// queue are reused.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS } from './world.js';

const BOT_SPEED = 3.4;
const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const EYE = 1.5;
const SIGHT_RANGE = 26;
const HEAR_RANGE = 26;
const PERCEIVE_EVERY = 0.22;
const REACTION_MIN = 0.55;
const REACTION_MAX = 1.0;
const BURST_MIN = 3;
const BURST_MAX = 5;
const SHOT_GAP = 0.14;
const BOT_DAMAGE = 14;
const BOT_HEAD_DAMAGE = 72;
const FALL_SECONDS = 0.4;

const ATTACK_LANES = [13, 10, 14, 13];
const DEFEND_HOLDS = [18, 19, 20, 11, 12];

function nearestWaypoint(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (const w of WAYPOINTS) {
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bestD) {
      bestD = d;
      best = w.id;
    }
  }
  return best;
}

// BFS over the waypoint graph; returns a list of waypoint ids from `from` to
// `to`, or an empty list when they are the same node.
const bfsQueue = [];
const bfsCame = new Map();
function findPath(from, to) {
  if (from === to) return [];
  bfsQueue.length = 0;
  bfsCame.clear();
  bfsQueue.push(from);
  bfsCame.set(from, -1);
  let head = 0;
  while (head < bfsQueue.length) {
    const cur = bfsQueue[head];
    head += 1;
    if (cur === to) break;
    for (const next of WAYPOINTS[cur].links) {
      if (!bfsCame.has(next)) {
        bfsCame.set(next, cur);
        bfsQueue.push(next);
      }
    }
  }
  if (!bfsCame.has(to)) return [];
  const path = [];
  let node = to;
  while (node !== -1) {
    path.push(node);
    node = bfsCame.get(node);
  }
  path.reverse();
  return path;
}

export function createBots(scene, world, rng, hooks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const eyePos = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const probe = new THREE.Box3();
  const tmp = new THREE.Vector3();

  const teamMats = {
    vanguard: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.6, metalness: 0.1 }),
    sentinel: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.sentinel), roughness: 0.6, metalness: 0.1 }),
  };
  const darkMats = {
    vanguard: new THREE.MeshStandardMaterial({ color: new THREE.Color('#7a5410'), roughness: 0.7 }),
    sentinel: new THREE.MeshStandardMaterial({ color: new THREE.Color('#14655e'), roughness: 0.7 }),
  };
  const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5, metalness: 0.3 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.62, 0.3);
  const headGeo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
  const legGeo = new THREE.BoxGeometry(0.16, 0.8, 0.16);
  const gunGeo = new THREE.BoxGeometry(0.06, 0.1, 0.55);

  const bots = [];
  const hitMeshes = [];

  function buildBot(team, index) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, teamMats[team]);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(headGeo, darkMats[team]);
    head.position.y = 1.62;
    const legL = new THREE.Mesh(legGeo, darkMats[team]);
    legL.position.set(-0.1, 0.4, 0);
    const legR = new THREE.Mesh(legGeo, darkMats[team]);
    legR.position.set(0.1, 0.4, 0);
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.18, 1.28, -0.28);
    group.add(torso, head, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      team,
      index,
      group,
      torso,
      head,
      legL,
      legR,
      position: group.position,
      yaw: 0,
      health: 100,
      armor: 0,
      alive: true,
      state: 'move',
      path: [],
      pathIndex: 0,
      holdUntil: 0,
      destination: 0,
      target: null,
      targetIsPlayer: false,
      lastSeen: null,
      reactionAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      perceiveAt: index * 0.05,
      strafeDir: 1,
      strafeUntil: 0,
      fall: 0,
      walkPhase: rng() * 6,
      defusing: false,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) buildBot('vanguard', i);
  for (let i = 0; i < 5; i += 1) buildBot('sentinel', i);

  function overlaps(x, z) {
    probe.min.set(x - BOT_RADIUS, 0.02, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, BOT_HEIGHT - 0.02, z + BOT_RADIUS);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function moveToward(bot, tx, tz, dt) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    // Arrive a little early: several waypoints sit close to a wall, and a
    // bot that must reach the exact point would push against it forever.
    if (dist < 0.7) return true;
    const stepLen = Math.min(dist, BOT_SPEED * dt);
    const nx = bot.position.x + (dx / dist) * stepLen;
    const nz = bot.position.z + (dz / dist) * stepLen;
    const oldX = bot.position.x;
    const oldZ = bot.position.z;
    if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
    if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
    if (Math.abs(bot.position.x - oldX) < 1e-6 && Math.abs(bot.position.z - oldZ) < 1e-6) {
      // No progress at all (a wall corner, or a straight-on block): sidestep
      // along the wall instead of pushing against it forever.
      const px = bot.position.x + (-dz / dist) * stepLen;
      const pz = bot.position.z + (dx / dist) * stepLen;
      if (!overlaps(px, pz)) {
        bot.position.x = px;
        bot.position.z = pz;
      } else {
        const qx = bot.position.x - (-dz / dist) * stepLen;
        const qz = bot.position.z - (dx / dist) * stepLen;
        if (!overlaps(qx, qz)) {
          bot.position.x = qx;
          bot.position.z = qz;
        }
      }
    }
    bot.yaw = Math.atan2(-dx, -dz);
    bot.walkPhase += dt * 9;
    const swing = Math.sin(bot.walkPhase) * 0.35;
    bot.legL.rotation.x = swing;
    bot.legR.rotation.x = -swing;
    return dist <= 0.7;
  }

  function setDestination(bot, nodeId) {
    bot.destination = nodeId;
    bot.path = findPath(nearestWaypoint(bot.position.x, bot.position.z), nodeId);
    bot.pathIndex = 0;
    bot.state = 'move';
  }

  function seesTarget(bot, tx, ty, tz) {
    eyePos.set(bot.position.x, EYE, bot.position.z);
    toTarget.set(tx - eyePos.x, ty - eyePos.y, tz - eyePos.z);
    const dist = toTarget.length();
    if (dist > SIGHT_RANGE) return false;
    dir.copy(toTarget).normalize();
    raycaster.set(eyePos, dir);
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit || hit.distance >= dist - 0.3;
  }

  // Angular test: a shot with `error` radians hits a torso of half-width 0.3 m at
  // this distance when the error is smaller than the target's angular radius.
  function shotHits(error, dist, head) {
    const radius = head ? 0.16 : 0.34;
    return Math.abs(error) < Math.atan2(radius, dist) * 1.15;
  }

  function fireAt(bot, ctx, targetPos, targetIsPlayer, targetBot) {
    const dist = Math.hypot(targetPos.x - bot.position.x, targetPos.z - bot.position.z);
    const tracking = Math.min(1, (ctx.time - bot.reactionAt) * 0.8);
    const error = (rng() * 2 - 1) * (0.065 - 0.033 * tracking + dist * 0.0012);
    const head = Math.abs(error) < 0.012 && rng() < 0.35;
    if (shotHits(error, dist, head)) {
      const dmg = head ? BOT_HEAD_DAMAGE : BOT_DAMAGE;
      if (targetIsPlayer) {
        hooks.damagePlayer(dmg, bot.position, head);
      } else if (targetBot && targetBot.alive) {
        damageBot(targetBot, dmg, head ? 'head' : 'torso', bot);
      }
    }
    hooks.tracer(bot.position, targetPos);
    if (hooks.shotSound) hooks.shotSound(bot.position);
  }

  function damageBot(bot, amount, part, attacker) {
    if (!bot.alive) return false;
    let rest = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, rest * 0.5);
      bot.armor -= absorbed;
      rest -= absorbed;
    }
    bot.health -= rest;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.state = 'dead';
    if (hooks.onBotDeath) hooks.onBotDeath(bot, attacker);
    return true;
  }

  function perceive(bot, ctx) {
    // Nearest visible enemy: the player first, then enemy bots.
    let best = null;
    let bestDist = Infinity;
    let bestIsPlayer = false;
    // The player is the enemy only for Sentinels; Vanguard teammates never
    // target the player (their spawns are metres away — without this they
    // would gun the player down at the start of round 1).
    if (bot.team === 'sentinel' && ctx.player.alive) {
      const dx = ctx.player.position.x - bot.position.x;
      const dz = ctx.player.position.z - bot.position.z;
      const d = Math.hypot(dx, dz);
      const facing = Math.cos(bot.yaw) * -dz + Math.sin(bot.yaw) * -dx;
      if (d < bestDist && (facing > -0.4 * d || d < 6) && seesTarget(bot, ctx.player.position.x, ctx.player.position.y + 1.2, ctx.player.position.z)) {
        best = ctx.player.position;
        bestDist = d;
        bestIsPlayer = true;
      }
    }
    for (const other of bots) {
      if (other.team === bot.team || !other.alive) continue;
      const dx = other.position.x - bot.position.x;
      const dz = other.position.z - bot.position.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestDist) continue;
      const facing = Math.cos(bot.yaw) * -dz + Math.sin(bot.yaw) * -dx;
      if ((facing > -0.4 * d || d < 6) && seesTarget(bot, other.position.x, 1.2, other.position.z)) {
        best = other.position;
        bestDist = d;
        bestIsPlayer = false;
        bot.targetBot = other;
      }
    }
    if (best) {
      if (!bot.target || bot.targetIsPlayer !== bestIsPlayer || (bot.targetBot && best && !bestIsPlayer && bot.targetBot.position !== best)) {
        bot.reactionAt = ctx.time + REACTION_MIN + rng() * (REACTION_MAX - REACTION_MIN);
        bot.burstLeft = 0;
      }
      bot.target = best;
      bot.targetIsPlayer = bestIsPlayer;
      if (!bestIsPlayer) {
        for (const other of bots) {
          if (other.team !== bot.team && other.alive && other.position === best) bot.targetBot = other;
        }
      }
      bot.lastSeen = { x: best.x, z: best.z, time: ctx.time };
    } else if (bot.target && ctx.time - (bot.lastSeen ? bot.lastSeen.time : 0) > 1.6) {
      bot.target = null;
      bot.targetBot = null;
    }
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / FALL_SECONDS);
      bot.group.rotation.x = -bot.fall * 1.45;
      bot.group.position.y = -bot.fall * 0.1;
      return;
    }
    bot.group.rotation.x = 0;
    bot.group.position.y = 0;

    if (ctx.time >= bot.perceiveAt) {
      bot.perceiveAt = ctx.time + PERCEIVE_EVERY;
      perceive(bot, ctx);
    }

    // Hearing: a nearby gunshot pulls a holding bot toward the sound.
    if (ctx.playerFired && bot.state === 'hold') {
      const d = Math.hypot(ctx.playerFired.x - bot.position.x, ctx.playerFired.z - bot.position.z);
      if (d < HEAR_RANGE && ctx.time - ctx.playerFired.time < 0.5) {
        setDestination(bot, nearestWaypoint(ctx.playerFired.x, ctx.playerFired.z));
      }
    }

    // The bomb drives the round: defenders rotate to it, attackers guard it.
    if (ctx.bomb && ctx.bomb.planted && bot.state !== 'engage') {
      const siteNode = ctx.bomb.site === 'A' ? 13 : 14;
      if (bot.destination !== siteNode) setDestination(bot, siteNode);
    }

    if (bot.target && ctx.time >= bot.reactionAt) {
      // Engage: face the target, strafe, fire in bursts.
      const tp = bot.targetIsPlayer ? ctx.player.position : bot.targetBot ? bot.targetBot.position : bot.target;
      if (!tp || (bot.targetBot && !bot.targetBot.alive)) {
        bot.target = null;
        bot.targetBot = null;
      } else {
        const dx = tp.x - bot.position.x;
        const dz = tp.z - bot.position.z;
        bot.yaw = Math.atan2(-dx, -dz);
        if (ctx.time >= bot.strafeUntil) {
          bot.strafeDir = rng() < 0.5 ? -1 : 1;
          bot.strafeUntil = ctx.time + 0.7 + rng() * 0.9;
        }
        const sideX = Math.cos(bot.yaw) * bot.strafeDir;
        const sideZ = -Math.sin(bot.yaw) * bot.strafeDir;
        const nx = bot.position.x + sideX * BOT_SPEED * 0.45 * dt;
        const nz = bot.position.z + sideZ * BOT_SPEED * 0.45 * dt;
        if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
        if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
        if (bot.burstLeft <= 0 && ctx.time >= bot.nextShotAt) {
          bot.burstLeft = BURST_MIN + Math.floor(rng() * (BURST_MAX - BURST_MIN + 1));
          bot.nextShotAt = ctx.time;
        }
        if (bot.burstLeft > 0 && ctx.time >= bot.nextShotAt) {
          bot.burstLeft -= 1;
          bot.nextShotAt = ctx.time + SHOT_GAP;
          const aim = tmp.set(tp.x, (bot.targetIsPlayer ? ctx.player.position.y + 1.2 : 1.2), tp.z);
          fireAt(bot, ctx, aim, bot.targetIsPlayer, bot.targetBot);
          if (bot.burstLeft === 0) bot.nextShotAt = ctx.time + 0.5 + rng() * 0.5;
        }
        bot.state = 'engage';
        bot.group.rotation.y = bot.yaw;
        return;
      }
    }

    if (bot.state === 'hold') {
      if (ctx.time >= bot.holdUntil) {
        if (bot.team === 'vanguard') {
          const lane = ATTACK_LANES[Math.floor(rng() * ATTACK_LANES.length)];
          setDestination(bot, lane);
        } else {
          setDestination(bot, DEFEND_HOLDS[bot.index % DEFEND_HOLDS.length]);
        }
      }
      bot.group.rotation.y = bot.yaw;
      return;
    }

    // Move along the path.
    if (bot.pathIndex < bot.path.length) {
      const node = WAYPOINTS[bot.path[bot.pathIndex]];
      if (moveToward(bot, node.x, node.z, dt)) bot.pathIndex += 1;
    } else {
      bot.state = 'hold';
      bot.holdUntil = ctx.time + (bot.team === 'sentinel' ? 6 + rng() * 4 : 1.5 + rng() * 2);
      bot.yaw += (rng() - 0.5) * 1.2;
    }
    bot.group.rotation.y = bot.yaw;
  }

  function reset(roundIndex) {
    for (const bot of bots) {
      const spawn = bot.team === 'vanguard'
        ? { x: [-3, -1, 1, 3][bot.index], z: 13.5, yaw: 0 }
        : { x: [-3, -1, 1, 3, 0][bot.index], z: -13.5, yaw: Math.PI };
      bot.position.set(spawn.x, 0, spawn.z);
      bot.yaw = spawn.yaw;
      bot.group.rotation.set(0, spawn.yaw, 0);
      bot.health = 100;
      bot.armor = bot.team === 'sentinel' && roundIndex > 1 ? 50 : 0;
      bot.alive = true;
      bot.fall = 0;
      bot.target = null;
      bot.targetBot = null;
      bot.burstLeft = 0;
      bot.defusing = false;
      bot.legL.rotation.x = 0;
      bot.legR.rotation.x = 0;
      if (bot.team === 'vanguard') {
        setDestination(bot, ATTACK_LANES[bot.index % ATTACK_LANES.length]);
      } else {
        // Walk to the hold first (state 'move' from setDestination); arriving
        // there switches the bot to 'hold' and it rotates between holds.
        // Forcing 'hold' here used to pin every defender at its spawn.
        setDestination(bot, DEFEND_HOLDS[bot.index % DEFEND_HOLDS.length]);
      }
    }
  }

  function step(dt, ctx) {
    for (const bot of bots) stepBot(bot, dt, ctx);
    // Separation: bots never stack on one another.
    for (let i = 0; i < bots.length; i += 1) {
      const a = bots[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < bots.length; j += 1) {
        const b = bots[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.49 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = (0.7 - d) / 2;
          const ux = dx / d;
          const uz = dz / d;
          if (!overlaps(a.position.x - ux * push, a.position.z - uz * push)) {
            a.position.x -= ux * push;
            a.position.z -= uz * push;
          }
          if (!overlaps(b.position.x + ux * push, b.position.z + uz * push)) {
            b.position.x += ux * push;
            b.position.z += uz * push;
          }
        }
      }
    }
  }

  return {
    bots,
    hitMeshes,
    reset,
    step,
    damageBot,
    remaining(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    aimPoint(index) {
      const bot = bots[index % bots.length];
      return new THREE.Vector3(bot.position.x, 1.2, bot.position.z);
    },
  };
}
