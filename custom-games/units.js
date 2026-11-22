/**
 * Unit and structure definitions for the Tactical Map War Game.
 * Loaded before the main game script, so these globals are available to it.
 *
 * Unit fields:      category (land|air|sea), speed (inches per leg), hp, atk (dice sides),
 *                   range (inches), prodCooldown (turns between builds)
 * Structure fields: hp, isBase, isResupply, produces (unit keys), needsWater
 */

const UNIT_DEFS = {
  infantry: {
    name: 'Infantry', shape: 'Square', category: 'land',
    speed: 1, hp: 2, atk: 2, range: 1, prodCooldown: 2,
    notes: 'Attacks Inf, SpecOps, Light Veh & Bases. Converts to Resupply Hub (4 AP when Secured).'
  },
  specops: {
    name: 'Special Forces', shape: 'Egg', category: 'land',
    speed: 2, hp: 4, atk: 3, range: 1, prodCooldown: 3,
    notes: 'Elite land unit. Attacks all land units & bases. Can repair general ruins.'
  },
  light_veh: {
    name: 'Light Vehicle', shape: 'Small Bead', category: 'land',
    speed: 3, hp: 6, atk: 4, range: 1, prodCooldown: 2,
    notes: 'Fast all-purpose land unit. Road bonus gives 4" speed per leg.'
  },
  heavy_veh: {
    name: 'Heavy Vehicle', shape: 'Big Bead', category: 'land',
    speed: 2, hp: 8, atk: 5, range: 1, prodCooldown: 3,
    notes: 'Heavy armor. Immune to standard Infantry engagements.'
  },
  air_def: {
    name: 'Air Defense', shape: 'Beehive', category: 'land',
    speed: 2, hp: 4, atk: 4, range: 3, prodCooldown: 2,
    notes: 'Engages Planes on command (3") & intercepts Missiles (D4 within 3").'
  },
  plane: {
    name: 'Plane', shape: 'Small Heart', category: 'air',
    speed: 4, hp: 6, atk: 5, range: 3, prodCooldown: 4,
    notes: 'Fast air strike (3" range). Immune to land units except Air Defense.'
  },
  ship: {
    name: 'Ship', shape: 'Small Star', category: 'sea',
    speed: 3, hp: 6, atk: 4, range: 3, prodCooldown: 4,
    notes: 'Water only. Engages land and sea targets within 3" on command.'
  }
};

const STRUCTURE_DEFS = {
  main_base: {
    name: 'Main Base', shape: 'Shield', hp: 14, isBase: true, isResupply: true,
    produces: ['infantry', 'specops', 'light_veh', 'heavy_veh', 'air_def'],
    notes: 'Commander HQ. Immune to Missiles. Losing both Original Main Bases loses the match.'
  },
  major_base: {
    name: 'Major Base', shape: 'Wheel', hp: 10, isBase: true, isResupply: true,
    produces: ['infantry', 'specops', 'light_veh', 'heavy_veh', 'air_def'],
    notes: 'Forward heavy production hub. Produces all land units & resupplies.'
  },
  minor_base: {
    name: 'Minor Base', shape: 'Disc', hp: 8, isBase: true, isResupply: true,
    produces: ['infantry', 'light_veh', 'air_def'],
    notes: 'Light production outpost. Produces Inf, Light Veh, Air Defense & resupplies.'
  },
  port: {
    name: 'Port', shape: 'Big Star', hp: 8, isBase: true, isResupply: true,
    produces: ['ship'], needsWater: true,
    notes: 'Naval yard. Must be built along coastline. Produces Ships (4t CD).'
  },
  air_base: {
    name: 'Air Base', shape: 'Big Heart', hp: 6, isBase: true, isResupply: true,
    produces: ['plane'],
    notes: 'Airfield. Produces Planes (4t CD) & resupplies.'
  },
  resupply_hub: {
    name: 'Resupply Hub', shape: 'Pot', hp: 3, isBase: false, isResupply: true,
    produces: [],
    notes: 'Forward logistics depot. Reloads Spent friendly units on contact/pass.'
  }
};
