// The armoury: one pistol everybody owns, one primary slot, and grenades. Each
// weapon is a row of numbers; the system owns ammo, reload, spread, switching and
// the view model, while main.js owns the ray and the damage. Prices are the buy
// menu's; the economy lives in rounds.js.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { name: 'P-12 Sidearm', price: 0, damage: 26, headDamage: 78, gap: 0.16, mag: 12, reserve: 48, spreadStill: 0.004, spreadMove: 0.02, reload: 1.4, auto: false, barrel: 0.18, scope: false },
  rifle: { name: 'VK-9 Carbine', price: 2700, damage: 34, headDamage: 100, gap: 0.096, mag: 30, reserve: 90, spreadStill: 0.0022, spreadMove: 0.028, reload: 1.9, auto: true, barrel: 0.42, scope: false },
  smg: { name: 'Kestrel-9 SMG', price: 1500, damage: 22, headDamage: 66, gap: 0.07, mag: 32, reserve: 96, spreadStill: 0.006, spreadMove: 0.035, reload: 1.6, auto: true, barrel: 0.32, scope: false },
  dmr: { name: 'Longshore DMR', price: 4000, damage: 80, headDamage: 160, gap: 0.85, mag: 5, reserve: 15, spreadStill: 0.0008, spreadMove: 0.012, reload: 2.6, auto: false, barrel: 0.62, scope: true },
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
export const AMMO_PRICE = 100;
const MUZZLE_TIME = 0.06;
const SWITCH_TIME = 0.45;

export function createWeapon(camera, sfx) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.3 });

  // One small view model per gun; only the current one is visible. A grenade is a
  // sphere with a pin ring, held the same way.
  const models = {};
  for (const [id, def] of Object.entries(WEAPONS)) {
    const model = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, def.barrel + 0.12), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, def.barrel), grip);
    barrel.position.set(0, 0.02, -(def.barrel / 2 + 0.05));
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.16), grip);
    stock.position.set(0, -0.02, def.barrel / 2 + 0.1);
    model.add(receiver, barrel, stock);
    if (def.scope) {
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.14), dark);
      scope.position.set(0, 0.065, 0);
      model.add(scope);
    }
    if (id === 'pistol') {
      model.scale.set(0.65, 0.65, 0.65);
      stock.visible = false;
    } else {
      model.scale.set(0.8, 0.8, 0.8);
    }
    model.position.set(0.26, -0.24, -0.55);
    model.visible = false;
    camera.add(model);
    models[id] = model;
  }
  const grenadeModel = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), dark);
  const pin = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12), body);
  pin.position.set(0, 0.07, 0);
  grenadeModel.add(shell, pin);
  grenadeModel.position.set(0.26, -0.24, -0.55);
  grenadeModel.visible = false;
  camera.add(grenadeModel);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.22, -1.05);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.26, -0.2, -0.7);
  camera.add(flashLight);

  const owned = {
    pistol: { id: 'pistol', mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve },
    primary: null,
  };
  const state = {
    current: 'pistol',
    grenades: 0,
    cooldown: 0,
    reloadLeft: 0,
    switchLeft: 0,
    flash: 0,
    kick: 0,
  };

  function currentDef() {
    if (state.current === 'grenade') return null;
    return WEAPONS[state.current === 'primary' ? owned.primary.id : 'pistol'];
  }

  function currentAmmo() {
    if (state.current === 'grenade') return { mag: state.grenades, reserve: 0 };
    const slot = state.current === 'primary' ? owned.primary : owned.pistol;
    return { mag: slot.mag, reserve: slot.reserve };
  }

  function showModel() {
    for (const model of Object.values(models)) model.visible = false;
    grenadeModel.visible = false;
    if (state.current === 'grenade') grenadeModel.visible = true;
    else if (state.current === 'primary' && owned.primary) models[owned.primary.id].visible = true;
    else models.pistol.visible = true;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switchLeft = Math.max(0, state.switchLeft - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = state.current === 'grenade' ? grenadeModel : state.current === 'primary' && owned.primary ? models[owned.primary.id] : models.pistol;
    model.position.z = -0.55 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      const def = currentDef();
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = state.current === 'primary' ? owned.primary : owned.pistol;
        const need = def.mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    owned,
    step,
    currentDef,
    currentAmmo,
    currentName() {
      if (state.current === 'grenade') return 'HE-1 Grenade';
      return currentDef().name;
    },
    ready() {
      if (state.switchLeft > 0 || state.reloadLeft > 0 || state.cooldown > 0) return false;
      if (state.current === 'grenade') return state.grenades > 0;
      return currentAmmo().mag > 0;
    },
    pullTrigger() {
      state.cooldown = currentDef().gap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055;
      if (sfx) sfx.shot(state.current === 'primary' ? owned.primary.id : 'pistol');
    },
    takeRound() {
      const slot = state.current === 'primary' ? owned.primary : owned.pistol;
      if (!slot || slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const def = currentDef();
      if (!def) return;
      const slot = state.current === 'primary' ? owned.primary : owned.pistol;
      if (state.reloadLeft > 0 || slot.mag === def.mag || slot.reserve === 0) return;
      state.reloadLeft = def.reload;
      if (sfx) sfx.reload();
    },
    spread(speed) {
      const def = currentDef();
      if (!def) return 0;
      return def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
    },
    switchTo(slot) {
      if (slot === state.current || state.switchLeft > 0) return false;
      if (slot === 'primary' && !owned.primary) return false;
      if (slot === 'grenade' && state.grenades === 0) return false;
      state.current = slot;
      state.reloadLeft = 0;
      state.switchLeft = SWITCH_TIME;
      showModel();
      return true;
    },
    buyPrimary(id, money) {
      const def = WEAPONS[id];
      if (!def || def.price === 0) return { ok: false, cost: 0 };
      if (money < def.price) return { ok: false, cost: 0 };
      owned.primary = { id, mag: def.mag, reserve: def.reserve };
      state.current = 'primary';
      state.reloadLeft = 0;
      showModel();
      return { ok: true, cost: def.price };
    },
    buyGrenade(money) {
      if (money < GRENADE_PRICE || state.grenades >= 2) return { ok: false, cost: 0 };
      state.grenades += 1;
      return { ok: true, cost: GRENADE_PRICE };
    },
    buyArmor(money) {
      if (money < ARMOR_PRICE) return { ok: false, cost: 0 };
      return { ok: true, cost: ARMOR_PRICE };
    },
    buyAmmo(money) {
      if (money < AMMO_PRICE) return { ok: false, cost: 0 };
      for (const slot of [owned.pistol, owned.primary]) {
        if (!slot) continue;
        slot.reserve = WEAPONS[slot.id].reserve;
      }
      return { ok: true, cost: AMMO_PRICE };
    },
    throwGrenade() {
      if (state.current !== 'grenade' || state.grenades <= 0) return false;
      state.grenades -= 1;
      if (state.grenades === 0) {
        state.current = owned.primary ? 'primary' : 'pistol';
        showModel();
      }
      return true;
    },
    refill() {
      for (const slot of [owned.pistol, owned.primary]) {
        if (!slot) continue;
        slot.mag = WEAPONS[slot.id].mag;
        slot.reserve = WEAPONS[slot.id].reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.switchLeft = 0;
      showModel();
    },
  };
}
