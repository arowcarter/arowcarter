/**
 * Unit and structure definitions for the Tactical Map War Game (v2.2).
 * Loaded before the main game script, so these globals are available to it.
 *
 * Unit fields:      category (land|air|sea), speed (inches per leg), hp, atk (dice sides),
 *                   range (inches), prodCooldown (turns between builds), plus optional
 *                   mechanic metadata (minRange, blastRadius, actionCost, canEnterBuilding,
 *                   maxBridgeSpan, maxBarrierLength, maxResupplyCharges, stealableAmmo, requiresRtbResupply,
 *                   droneRange, droneRevealRange, droneDurationTurns, canProduceAir,
 *                   canReloadAir, sonarRange, missileInterceptDie, startsSubmerged,
 *                   transientUntilQuietMove)
 * Structure fields: hp, isBase, isResupply, produces (unit keys), needsWater
 */

const UNIT_DEFS = {
  infantry: {
    name: 'Infantry', shape: 'Square', category: 'land',
    speed: 1, hp: 2, atk: 2, range: 1, prodCooldown: 2, actionCost: 0,
    notes: 'Attacks Inf, SpecOps, Light Veh & Bases. Converts to Resupply Hub (4 AP when Secured).'
  },
  specops: {
    name: 'Special Forces', shape: 'Egg', category: 'land',
    speed: 2, hp: 4, atk: 3, range: 1, prodCooldown: 3, actionCost: 0,
    notes: 'Elite land unit. Attacks all land units & bases. Can repair general ruins.'
  },
  light_veh: {
    name: 'Light Vehicle', shape: 'Small Bead', category: 'land',
    speed: 3, hp: 6, atk: 4, range: 1, prodCooldown: 2, actionCost: 0,
    notes: 'Fast all-purpose land unit. Road bonus gives +1" speed per leg.'
  },
  heavy_veh: {
    name: 'Heavy Vehicle', shape: 'Big Bead', category: 'land',
    speed: 2, hp: 8, atk: 5, range: 1, prodCooldown: 3, actionCost: 0,
    notes: 'Heavy armor. Immune to standard Infantry engagements.'
  },
  air_def: {
    name: 'Air Defense', shape: 'Beehive', category: 'land',
    speed: 2, hp: 4, atk: 4, range: 3, prodCooldown: 2, actionCost: 0,
    notes: 'Engages Planes (3") & intercepts Missiles (D4 within 3").'
  },
  plane: {
    name: 'Plane', shape: 'Small Heart', category: 'air',
    speed: 4, hp: 6, atk: 5, range: 3, prodCooldown: 4, actionCost: 0,
    notes: 'Fast air strike (3" range). Flies over B tiles; immune to land except Air Defense.'
  },
  ship: {
    name: 'Ship', shape: 'Small Star', category: 'sea',
    speed: 3, hp: 6, atk: 4, range: 3, prodCooldown: 4, actionCost: 0,
    notes: 'Water only. Engages land and sea targets within 3".'
  },
  artillery: {
    name: 'Artillery', shape: 'Triangle', category: 'land',
    speed: 1, hp: 3, atk: 5, range: 3, minRange: 1, blastRadius: 0.75,
    prodCooldown: 3, actionCost: 1, indirectFire: true,
    notes: 'Spends 1 AP to barrage an area within 1"–3" (0.75" blast), firing over B tiles. Cannot move and barrage in the same turn.'
  },
  sniper_team: {
    name: 'Sniper Team', shape: 'Diamond', category: 'land',
    speed: 2, hp: 2, atk: 4, range: 2, prodCooldown: 2, actionCost: 0,
    canEnterBuilding: true, stealthInBuilding: true, instantKillOnBuildingCollapse: true,
    notes: 'Can enter B tiles; hidden inside buildings until firing. Killed if B tile is destroyed.'
  },
  bridgelayer: {
    name: 'Armored Bridgelayer (AVLB)', shape: 'Trapezoid', category: 'land',
    speed: 2, hp: 5, atk: 0, range: 2, maxBridgeSpan: 2, prodCooldown: 3, actionCost: 2,
    notes: 'Spends 2 AP adjacent to narrow W to deploy a destroyable Pontoon Bridge (up to 2" wide).'
  },
  roadblock: {
    name: 'Roadblock', shape: 'Bar', category: 'land',
    speed: 0, hp: 4, atk: 0, range: 0, prodCooldown: 0, actionCost: 2,
    deployable: true, blocksRoad: true, maxBarrierLength: 2,
    notes: 'A land unit places a destroyable barrier up to 2" long (2 AP). Blocks land units of both sides.'
  },
  ammo_convoy: {
    name: 'Mobile Ammo Convoy', shape: 'Cylinder', category: 'land',
    speed: 3, hp: 3, atk: 0, range: 0.62, prodCooldown: 2, actionCost: 0,
    isResupply: true, maxResupplyCharges: 3, stealableAmmo: true,
    notes: 'Mobile 0.62" resupply (3 charges; restocks at friendly Base). Enemies can steal 1 charge on contact.'
  },
  strategic_bomber: {
    name: 'Strategic Bomber', shape: 'Wide Chevron', category: 'air',
    speed: 3, hp: 5, atk: 7, range: 1, prodCooldown: 4, actionCost: 0,
    requiresRtbResupply: true,
    notes: 'Heavy Atk 7 strike (1" range). No Idle Resupply—must return to Air Base or Carrier (0.62") to rearm.'
  },
  drone_operator: {
    name: 'Drone Operator', shape: 'Hexagon', category: 'land',
    speed: 2, hp: 3, atk: 1, range: 5, droneRange: 5, droneRevealRange: 2,
    droneDurationTurns: 2, prodCooldown: 2, actionCost: 1, requiresLogisticsResupply: true,
    notes: 'Launches 2-turn drone (5" range, reveals enemies & hidden Snipers in 2"). Reloads at Base/Hub/Convoy.'
  },
  aircraft_carrier: {
    name: 'Aircraft Carrier (CVN)', shape: 'Long Oval', category: 'sea',
    speed: 1, hp: 10, atk: 2, range: 2, prodCooldown: 5, actionCost: 0,
    canProduceAir: true, canReloadAir: true, resupplyRange: 0.62,
    notes: 'Water-only floating airfield. Produces air units at sea and reloads aircraft within 0.62".'
  },
  asw_corvette: {
    name: 'ASW Corvette', shape: 'Small Wedge', category: 'sea',
    speed: 4, hp: 3, atk: 3, range: 2, sonarRange: 2, missileInterceptDie: 4,
    prodCooldown: 2, actionCost: 0,
    notes: 'Fast littoral ship. Reveals submerged Submarines (2") & rolls D4 Missile Intercept for nearby Ships.'
  },
  attack_submarine: {
    name: 'Attack Submarine (SSN)', shape: 'Capsule', category: 'sea',
    speed: 2, hp: 4, atk: 6, range: 2, prodCooldown: 3, actionCost: 0,
    startsSubmerged: true, transientUntilQuietMove: true,
    notes: 'Starts submerged (immune to Auto-Engage except Corvettes/Subs). Firing reveals until 1 quiet move turn.'
  }
};

const STRUCTURE_DEFS = {
  main_base: {
    name: 'Main Base', shape: 'Shield', hp: 14, isBase: true, isResupply: true,
    produces: ['infantry', 'specops', 'light_veh', 'heavy_veh', 'air_def', 'artillery', 'sniper_team', 'bridgelayer', 'ammo_convoy', 'drone_operator'],
    notes: 'Commander HQ. Immune to Missiles. Losing both Original Main Bases loses the match.'
  },
  major_base: {
    name: 'Major Base', shape: 'Wheel', hp: 10, isBase: true, isResupply: true,
    produces: ['infantry', 'specops', 'light_veh', 'heavy_veh', 'air_def', 'artillery', 'sniper_team', 'bridgelayer', 'ammo_convoy', 'drone_operator'],
    notes: 'Forward heavy production hub. Produces heavy & specialist land units and resupplies.'
  },
  minor_base: {
    name: 'Minor Base', shape: 'Disc', hp: 8, isBase: true, isResupply: true,
    produces: ['infantry', 'light_veh', 'air_def', 'sniper_team', 'ammo_convoy', 'drone_operator'],
    notes: 'Light production outpost. Produces light/recon/support units and resupplies.'
  },
  port: {
    name: 'Port', shape: 'Big Star', hp: 8, isBase: true, isResupply: true,
    produces: ['ship', 'aircraft_carrier', 'asw_corvette', 'attack_submarine'], needsWater: true,
    notes: 'Naval yard. Must be built along coastline. Produces surface ships, carriers, and submarines.'
  },
  air_base: {
    name: 'Air Base', shape: 'Big Heart', hp: 6, isBase: true, isResupply: true,
    produces: ['plane', 'strategic_bomber'],
    notes: 'Airfield. Produces strike aircraft and strategic bombers.'
  },
  resupply_hub: {
    name: 'Resupply Hub', shape: 'Pot', hp: 3, isBase: false, isResupply: true,
    produces: [],
    notes: 'Forward logistics depot. Reloads Spent friendly units on contact/pass.'
  },
  pontoon_bridge: {
    name: 'Pontoon Bridge', shape: 'Bridge', hp: 4, isBase: false, isResupply: false,
    produces: [],
    notes: 'A destroyable crossing deployed by an Armored Bridgelayer.'
  }
};
