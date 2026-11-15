// Dusk Harbor: a working port at sunset, 40 x 32 m, two bomb sites, three lanes.
// Vanguard (the player's team) spawns south, Sentinel north. Site A is the container
// yard east, Site B the warehouse west, Mid runs straight up the middle. Every box is
// a collider for movement and a surface a bullet stops on; deco meshes are visual
// only. Waypoints form a small graph the bots pathfind over with BFS.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { label: 'A', name: 'Container Yard', center: { x: 14, z: -8 }, rect: { x0: 11, x1: 17, z0: -11, z1: -5 } },
  B: { label: 'B', name: 'Warehouse', center: { x: -14, z: -8 }, rect: { x0: -17, x1: -11, z0: -11, z1: -5 } },
};

export const SPAWNS = {
  vanguard: [
    { x: -3, z: 13.5, yaw: 0 },
    { x: -1, z: 14, yaw: 0 },
    { x: 1, z: 14, yaw: 0 },
    { x: 3, z: 13.5, yaw: 0 },
    { x: 0, z: 12.5, yaw: 0 },
  ],
  sentinel: [
    { x: -3, z: -13.5, yaw: Math.PI },
    { x: -1, z: -14, yaw: Math.PI },
    { x: 1, z: -14, yaw: Math.PI },
    { x: 3, z: -13.5, yaw: Math.PI },
    { x: 0, z: -12.5, yaw: Math.PI },
  ],
};

// Waypoint graph: id, position, and the ids it links to. Bots BFS over this.
export const WAYPOINTS = [
  { id: 0, x: 0, z: 13, links: [1, 2, 3] }, // vanguard spawn
  { id: 1, x: 0, z: 8, links: [0, 2, 3, 4] }, // connector
  { id: 2, x: 9, z: 8, links: [1, 5] }, // to A lane
  { id: 3, x: -9, z: 8, links: [1, 6] }, // to B lane
  { id: 4, x: 0, z: 4, links: [1, 7] }, // mid upper
  { id: 5, x: 12, z: 4, links: [2, 8] }, // A lane mid
  { id: 6, x: -12, z: 4, links: [3, 9] }, // B lane mid
  { id: 7, x: 0, z: -2, links: [4, 10, 11, 12, 20] }, // mid doors
  { id: 8, x: 14, z: 0, links: [5, 11] }, // A lane lower
  { id: 9, x: -14, z: 0, links: [6, 12] }, // B lane lower
  { id: 10, x: 0, z: -8, links: [7, 13, 20] }, // mid to north
  { id: 11, x: 14, z: -5, links: [7, 8, 13, 18] }, // A approach
  { id: 12, x: -14, z: -5, links: [7, 9, 14, 19] }, // B approach
  { id: 13, x: 14, z: -8, links: [10, 11, 15, 18] }, // SITE A
  { id: 14, x: -14, z: -8, links: [10, 12, 16, 19] }, // SITE B
  { id: 15, x: 0, z: -13, links: [10, 13] }, // sentinel spawn
  { id: 16, x: 11, z: -10, links: [13, 14] }, // A back corner
  { id: 17, x: -11, z: -10, links: [13, 14] }, // B back corner
  { id: 18, x: 12, z: -6, links: [11, 13] }, // A hold
  { id: 19, x: -12, z: -6, links: [12, 14] }, // B hold
  { id: 20, x: 0, z: -6, links: [7, 10] }, // mid hold
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.9,
      metalness: name === 'rust' || name === 'moss' ? 0.25 : 0.03,
    });
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0') });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function deco(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function cylinder(radius, height, x, y, z, material, segments = 12) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function siteLabel(text, x, z, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'bold 96px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 68);
    const texture = new THREE.CanvasTexture(canvas);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }),
    );
    plane.position.set(x, 3.4, z);
    group.add(plane);
    return plane;
  }

  function siteZone(site, color) {
    const { rect } = site;
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(rect.x1 - rect.x0, rect.z1 - rect.z0),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.12, side: THREE.DoubleSide }),
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(site.center.x, 0.02, site.center.z);
    group.add(zone);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8), materials.hairline);
    post.position.set(rect.x0 + 0.3, 1.6, rect.z0 + 0.3);
    group.add(post);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lampMat);
    lamp.position.set(rect.x0 + 0.3, 3.3, rect.z0 + 0.3);
    group.add(lamp);
  }

  // Ground: wet asphalt slab.
  box(40.4, 0.4, 32.4, 0, -0.2, 0, 'surface');
  // Perimeter walls, 5 m high.
  box(0.4, 5, 32.4, -20.2, 2.5, 0, 'surface');
  box(0.4, 5, 32.4, 20.2, 2.5, 0, 'surface');
  box(40.4, 5, 0.4, 0, 2.5, -16.2, 'surface');
  box(40.4, 5, 0.4, 0, 2.5, 16.2, 'surface');

  // Harbour water and a ship silhouette beyond the east wall (visual only).
  const water = new THREE.Mesh(new THREE.PlaneGeometry(24, 32), materials.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(32, -0.05, 0);
  group.add(water);
  deco(10, 3, 4, 30, 1.5, -6, 'hairline');
  deco(4, 5, 3, 28, 2.5, 2, 'surface');
  deco(1.2, 8, 1.2, 26, 4, 8, 'hairline');

  // Site A: container yard, stacked rust and moss boxes. The stack sits at
  // the site's east edge so the mid-to-A and approach lanes stay open.
  box(4.8, 2.4, 2.4, 16, 1.2, -10, 'rust');
  box(4.8, 2.4, 2.4, 16, 3.6, -10, 'moss');
  box(2.4, 2.4, 4.8, 16.6, 1.2, -5.6, 'hairline');
  box(1.2, 1.2, 1.2, 11.4, 0.6, -5.2, 'rust');
  box(2.4, 1.2, 1.2, 15.6, 0.6, -11.6, 'moss');
  box(1.2, 1.2, 1.2, 12.2, 0.6, -11.4, 'hairline');

  // Site B: warehouse, open-top walls with two doors and crates inside.
  box(0.4, 4, 8.4, -18.2, 2, -8, 'surface');
  box(8.4, 4, 0.4, -14, 2, -12.2, 'surface');
  box(3.4, 4, 0.4, -16.5, 2, -3.8, 'surface');
  box(3.4, 4, 0.4, -11.5, 2, -3.8, 'surface');
  box(0.4, 4, 2.4, -9.8, 2, -11, 'surface');
  box(0.4, 4, 2.4, -9.8, 2, -5, 'surface');
  box(1.2, 1.2, 1.2, -16.4, 0.6, -10.4, 'moss');
  box(2.4, 1.2, 1.2, -10, 0.6, -7, 'rust'); // clear of the B-hold waypoint
  cylinder(0.55, 1.1, -15.6, 0.55, -5.4, 'hairline');
  cylinder(0.55, 1.1, -16.6, 0.55, -6.2, 'rust');

  // Mid: a wall with a gap on the east side, crates, and a double container
  // offset west so the straight mid lane (waypoints 1 -> 4) stays open and
  // the A-lane sightline from the spawn stays clear.
  box(3, 3, 0.4, -1.5, 1.5, -2, 'hairline');
  box(1.2, 1.2, 1.2, 2.2, 0.6, 2, 'rust');
  box(1.2, 1.2, 1.2, -2.4, 0.6, -5.4, 'moss');
  box(4.8, 2.4, 1.2, -5, 1.2, 6, 'hairline');

  // Lane cover: crates and containers on A and B lanes.
  box(1.2, 1.2, 1.2, 10, 0.6, 2, 'moss');
  box(1.2, 1.2, 1.2, 12.4, 0.6, 6.4, 'rust');
  box(2.4, 2.4, 2.4, 16, 1.2, 4, 'rust');
  box(1.2, 1.2, 1.2, -10, 0.6, 2, 'rust');
  box(1.2, 1.2, 1.2, -12.4, 0.6, 6.4, 'moss');
  box(2.4, 2.4, 2.4, -16, 1.2, 4, 'moss');

  // Connector corners: low walls behind the spawn connector, clear of the
  // waypoint lanes (they used to sit on the z = 8 lane and trap the bots).
  box(4, 1.1, 0.6, -4, 0.55, 12, 'hairline');
  box(4, 1.1, 0.6, 4, 0.55, 12, 'hairline');

  // Spawn cover: a low crate stack behind each spawn.
  box(2.4, 1.2, 1.2, -6, 0.6, 14.6, 'hairline');
  box(2.4, 1.2, 1.2, 6, 0.6, 14.6, 'hairline');
  box(2.4, 1.2, 1.2, -6, 0.6, -14.6, 'hairline');
  box(2.4, 1.2, 1.2, 6, 0.6, -14.6, 'hairline');

  // Gantry crane silhouette at the east edge.
  box(0.8, 12, 0.8, 19, 6, 6, 'hairline');
  box(0.8, 12, 0.8, 19, 6, 10, 'hairline');
  box(0.8, 0.8, 5.6, 19, 11.8, 8, 'hairline');
  deco(0.8, 0.8, 5.6, -19, 11.8, -8, 'hairline');
  deco(0.8, 12, 0.8, -19, 6, -6, 'hairline');
  deco(0.8, 12, 0.8, -19, 6, -10, 'hairline');

  // Lamp posts with warm heads.
  for (const [x, z] of [[-8, 10], [8, 10], [0, -10], [14, 2], [-14, 2]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.4, 8), materials.hairline);
    pole.position.set(x, 2.2, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), lampMat);
    head.position.set(x, 4.5, z);
    group.add(head);
  }

  siteZone(SITES.A, PALETTE.accent);
  siteZone(SITES.B, PALETTE.sentinel);
  const labelA = siteLabel('A', 14, -8, '#f5a623');
  const labelB = siteLabel('B', -14, -8, '#2ec4b6');

  // Light: a low warm sun from the west, a cool dusk fill, and a violet sky.
  // Bright enough to read the map at a glance: dusk, not night.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a76b8'), new THREE.Color('#2a2138'), 1.35);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 3.1);
  sun.position.set(-26, 10, 12);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#7a86b8'), 0.85);
  fill.position.set(18, 12, -10);
  scene.add(fill);

  const lampA = new THREE.PointLight(new THREE.Color('#ffb45e'), 20, 22, 1.6);
  lampA.position.set(11.3, 3.3, -10.7);
  scene.add(lampA);
  const lampB = new THREE.PointLight(new THREE.Color('#7fe0d4'), 18, 22, 1.6);
  lampB.position.set(-16.7, 3.3, -10.7);
  scene.add(lampB);

  return { colliders, shootables, group, labelA, labelB };
}
