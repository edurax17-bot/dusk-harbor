// HE-1 grenades: a thrown sphere on a ballistic arc, a 1.4 s fuse, then an area
// blast. The blast hurts enemies and the thrower, never teammates, and shakes the
// camera of anyone close. One pooled flash light and one expanding ring are reused
// for every explosion, so throws allocate nothing in the hot loop.
import * as THREE from 'three';

const FUSE = 1.4;
const RADIUS = 6;
const MAX_DAMAGE = 120;
const MIN_DAMAGE = 20;
const GRAVITY = 12;

export function createGrenades(scene, colliders) {
  const shellGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.5, metalness: 0.5 });
  const ringGeo = new THREE.RingGeometry(0.4, 0.55, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb45e, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  const flash = new THREE.PointLight(0xffb45e, 0, 14, 1.5);
  scene.add(flash);

  const live = [];
  let ringAge = 99;
  let ringPos = new THREE.Vector3();

  const probe = new THREE.Box3();

  function hitsWorld(x, y, z) {
    probe.min.set(x - 0.09, y - 0.09, z - 0.09);
    probe.max.set(x + 0.09, y + 0.09, z + 0.09);
    for (const c of colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function throwFrom(origin, direction, power = 13) {
    const mesh = new THREE.Mesh(shellGeo, shellMat);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    scene.add(mesh);
    live.push({
      mesh,
      velocity: direction.clone().multiplyScalar(power),
      velocityY: direction.y * power + 3.5,
      fuse: FUSE,
      bounces: 0,
    });
  }

  function explode(at, onBlast) {
    ringPos.copy(at);
    ringPos.y = Math.max(0.06, at.y);
    ring.position.copy(ringPos);
    ring.visible = true;
    ringAge = 0;
    flash.position.copy(at);
    flash.position.y = at.y + 0.6;
    flash.intensity = 60;
    if (onBlast) onBlast(at, RADIUS, MAX_DAMAGE, MIN_DAMAGE);
  }

  function step(dt, onBlast) {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const g = live[i];
      g.fuse -= dt;
      g.velocityY -= GRAVITY * dt;
      const next = g.mesh.position.clone();
      next.x += g.velocity.x * dt;
      next.z += g.velocity.z * dt;
      next.y += g.velocityY * dt;
      if (next.y <= 0.09) {
        next.y = 0.09;
        g.velocityY = Math.abs(g.velocityY) > 2 ? -g.velocityY * 0.4 : 0;
        g.velocity.multiplyScalar(0.7);
        g.bounces += 1;
      } else if (hitsWorld(next.x, next.y, next.z)) {
        g.velocity.multiplyScalar(-0.35);
        g.velocityY = Math.abs(g.velocityY) * 0.3;
        g.bounces += 1;
      }
      g.mesh.position.copy(next);
      if (g.fuse <= 0) {
        const at = g.mesh.position.clone();
        scene.remove(g.mesh);
        live.splice(i, 1);
        explode(at, onBlast);
      }
    }
    if (ringAge < 0.6) {
      ringAge += dt;
      const t = ringAge / 0.6;
      ring.scale.setScalar(1 + t * (RADIUS * 2));
      ringMat.opacity = 0.85 * (1 - t);
      if (t >= 1) ring.visible = false;
    }
    flash.intensity = Math.max(0, flash.intensity - dt * 220);
  }

  function clear() {
    for (const g of live) scene.remove(g.mesh);
    live.length = 0;
    ring.visible = false;
    flash.intensity = 0;
  }

  return { throwFrom, step, clear, detonate: explode, count: () => live.length };
}
