// The look plan, in one place. Dusk Harbor is a working port at sunset: a deep
// blue-violet dusk sky over warm sodium lamps, rusted containers and wet asphalt.
// Six base values carry the whole scene; the two team colours mark Vanguard (amber,
// the player's team) and Sentinel (teal) and appear nowhere else.
export const PALETTE = {
  canvas: '#1a1626', // dusk sky, fog and the page behind the canvas
  surface: '#2a2438', // walls, warehouse skin, dark metal
  hairline: '#4a4238', // crates, containers, cover
  ink: '#efe7d6', // warm lamplight white, HUD text
  muted: '#8a8fa3', // cool dusk fill, secondary HUD text
  accent: '#f5a623', // Vanguard amber, muzzle light, highlights
  sentinel: '#2ec4b6', // Sentinel teal, enemy markers
  rust: '#a5502e', // rusted container orange
  moss: '#5c6b4f', // faded container green
  water: '#22384a', // harbour water beyond the east wall
};

export const TEAM_COLORS = {
  vanguard: PALETTE.accent,
  sentinel: PALETTE.sentinel,
};
