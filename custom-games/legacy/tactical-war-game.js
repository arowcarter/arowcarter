/**
 * ============================================================================
 * TACTICAL MAP WAR GAME v2.1 — WEGO, AUTO-ENGAGEMENT & MULTI-ACTION (11x17")
 * Complete 2-Player Hotseat Simultaneous-Turn Implementation
 * ============================================================================
 */

const MAP_W = 17;
const MAP_H = 11;
const MAX_AP = 4;
const EDGE_DEPLOY_IN = 1.5;
const ESTABLISHED_ZONE_IN = 3.0;
const RESUPPLY_TOUCH_IN = 0.62;
const RUIN_REPAIR_TURNS = 6;
const MISSILE_ATK = 8;
const MISSILE_RESTOCK_TURNS = 5;

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
    notes: 'Heavy armor. Immune to standard Infantry auto-engagements.'
  },
  air_def: {
    name: 'Air Defense', shape: 'Beehive', category: 'land',
    speed: 2, hp: 4, atk: 4, range: 3, prodCooldown: 2,
    notes: 'Auto-engages Planes (3") & intercepts Missiles (D4 within 3").'
  },
  plane: {
    name: 'Plane', shape: 'Small Heart', category: 'air',
    speed: 4, hp: 6, atk: 5, range: 3, prodCooldown: 4,
    notes: 'Fast air strike (3" range). Immune to land units except Air Defense.'
  },
  ship: {
    name: 'Ship', shape: 'Small Star', category: 'sea',
    speed: 3, hp: 6, atk: 4, range: 3, prodCooldown: 4,
    notes: 'Water only. Auto-engages land and sea targets within 3".'
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

const WATER_POLYS = [
  [
    { x: 6.2, y: 0.0 }, { x: 10.8, y: 0.0 }, { x: 10.5, y: 1.6 },
    { x: 9.6, y: 2.7 }, { x: 7.4, y: 2.7 }, { x: 6.5, y: 1.5 }
  ],
  [
    { x: 7.8, y: 2.4 }, { x: 9.2, y: 2.4 }, { x: 9.3, y: 8.6 }, { x: 7.7, y: 8.6 }
  ],
  [
    { x: 7.3, y: 8.3 }, { x: 9.7, y: 8.3 }, { x: 10.9, y: 9.6 },
    { x: 11.1, y: 11.0 }, { x: 5.9, y: 11.0 }, { x: 6.1, y: 9.5 }
  ]
];

const BRIDGES = [
  { x: 7.45, y: 3.45, w: 2.1, h: 0.72 },
  { x: 7.45, y: 6.85, w: 2.1, h: 0.72 }
];

const ROADS = [
  [{ x: 0.8, y: 2.6 }, { x: 4.5, y: 3.8 }, { x: 12.5, y: 3.8 }, { x: 16.2, y: 2.6 }],
  [{ x: 0.8, y: 8.4 }, { x: 4.5, y: 7.2 }, { x: 12.5, y: 7.2 }, { x: 16.2, y: 8.4 }],
  [{ x: 3.4, y: 1.2 }, { x: 4.5, y: 3.8 }, { x: 4.5, y: 7.2 }, { x: 3.4, y: 9.8 }],
  [{ x: 13.6, y: 1.2 }, { x: 12.5, y: 3.8 }, { x: 12.5, y: 7.2 }, { x: 13.6, y: 9.8 }]
];

// --- PROCEDURAL WEB AUDIO SFX ---
const SFX = {
  enabled: true,
  ctx: null,
  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  },
  play(type) {
    try {
      const c = this.ensure();
      if (!c) return;
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);

      if (type === 'click') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(340, now + 0.06);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now); osc.stop(now + 0.07);
      } else if (type === 'move') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(330, now + 0.14);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now); osc.stop(now + 0.17);
      } else if (type === 'fire') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(75, now + 0.18);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
        osc.start(now); osc.stop(now + 0.2);
      } else if (type === 'explode') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(32, now + 0.32);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
        osc.start(now); osc.stop(now + 0.35);
      } else if (type === 'miss') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(190, now);
        osc.frequency.setValueAtTime(150, now + 0.07);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now); osc.stop(now + 0.16);
      } else if (type === 'lock') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(660, now + 0.07);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now); osc.stop(now + 0.21);
      } else if (type === 'victory') {
        [523, 659, 784, 1046].forEach((freq, i) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = 'triangle';
          o.connect(g); g.connect(c.destination);
          o.frequency.setValueAtTime(freq, now + i * 0.11);
          g.gain.setValueAtTime(0.11, now + i * 0.11);
          g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.11 + 0.28);
          o.start(now + i * 0.11); o.stop(now + i * 0.11 + 0.3);
        });
      }
    } catch (err) {}
  }
};

// --- GAME STATE ---
let nextEntityId = 1;
let nextOrderId = 1;

const state = {
  phase: 'SETUP', // 'SETUP' | 'PLANNING' | 'RESOLVING' | 'POST_RESOLUTION' | 'GAMEOVER'
  setupStep: 0,   // 0: P1 Base 1, 1: P2 Base 1, 2: P1 Base 2, 3: P2 Base 2
  turn: 1,
  activePlayer: 1,
  missiles: { 1: 6, 2: 6 },
  orders: { 1: [], 2: [] },
  entities: [],
  ruins: [],
  selectedId: null,
  mode: 'IDLE',   // 'IDLE' | 'MOVE' | 'MISSILE' | 'DEPLOY_AD_ZONE'
  pendingAdBaseId: null,
  showZones: true,
  showRanges: true,
  hoverMap: null,
  moveAnims: [],
  effects: [],
  stats: { kills: { 1: 0, 2: 0 }, missilesFired: { 1: 0, 2: 0 } }
};

// --- CANVAS SETUP ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const wrapper = document.getElementById('canvas-wrapper');
let ppi = 50;
let offsetX = 24;
let offsetY = 24;

function resizeCanvas() {
  const rect = wrapper.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(300, Math.floor(rect.width * dpr));
  canvas.height = Math.max(240, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const pad = 26;
  const availW = Math.max(120, rect.width - pad * 2);
  const availH = Math.max(120, rect.height - pad * 2);
  ppi = Math.min(availW / MAP_W, availH / MAP_H);
  offsetX = (rect.width - MAP_W * ppi) / 2;
  offsetY = (rect.height - MAP_H * ppi) / 2;
}

function toPxX(inX) { return offsetX + inX * ppi; }
function toPxY(inY) { return offsetY + inY * ppi; }
function toMapX(pxX) { return (pxX - offsetX) / ppi; }
function toMapY(pxY) { return (pxY - offsetY) / ppi; }

// --- GEOMETRY & TERRAIN HELPERS ---
function distIn(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInWater(x, y) {
  for (const poly of WATER_POLYS) {
    if (pointInPoly(x, y, poly)) return true;
  }
  return false;
}

function isPointOnBridge(x, y) {
  for (const b of BRIDGES) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
  }
  return false;
}

function isLandForUnit(x, y) {
  if (isPointOnBridge(x, y)) return true;
  return !isPointInWater(x, y);
}

function isLandForBase(x, y) {
  return !isPointInWater(x, y);
}

function isWaterForShip(x, y) {
  return isPointInWater(x, y);
}

function isNearWater(x, y, radius = 0.85) {
  if (isPointInWater(x, y)) return true;
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2;
    if (isPointInWater(x + Math.cos(ang) * radius, y + Math.sin(ang) * radius)) return true;
  }
  return false;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function isOnRoad(x, y, tolerance = 0.28) {
  for (const road of ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      if (distToSegment(x, y, road[i].x, road[i].y, road[i + 1].x, road[i + 1].y) <= tolerance) {
        return true;
      }
    }
  }
  return false;
}

function segmentTouchesRoad(x1, y1, x2, y2) {
  const samples = [0, 0.25, 0.5, 0.75, 1];
  for (const t of samples) {
    const sx = x1 + (x2 - x1) * t;
    const sy = y1 + (y2 - y1) * t;
    if (isOnRoad(sx, sy, 0.3)) return true;
  }
  return false;
}

function isWithinOutskirts(x, y) {
  return x >= 0.3 && x <= MAP_W - 0.3 && y >= 0.3 && y <= MAP_H - 0.3 &&
    (x <= EDGE_DEPLOY_IN || x >= MAP_W - EDGE_DEPLOY_IN || y <= EDGE_DEPLOY_IN || y >= MAP_H - EDGE_DEPLOY_IN);
}

function isInsideEstablishedZone(x, y, owner) {
  return state.entities.some(e =>
    e.kind === 'structure' &&
    e.owner === owner &&
    STRUCTURE_DEFS[e.type].isBase &&
    distIn(x, y, e.x, e.y) <= ESTABLISHED_ZONE_IN
  );
}

function rollDie(sides) {
  return Math.floor(Math.random() * Math.max(1, sides)) + 1;
}

function pColor(owner) {
  return owner === 1 ? '#38bdf8' : '#fb7185';
}

function pDark(owner) {
  return owner === 1 ? '#0c4a6e' : '#881337';
}

function pName(owner) {
  return owner === 1 ? 'P1 (Blue)' : 'P2 (Red)';
}

function getEntityById(id) {
  return state.entities.find(e => e.id === id) || null;
}

function getRuinById(id) {
  return state.ruins.find(r => r.id === id) || null;
}

// --- AP & ORDER QUEUE HELPERS ---
function getQueuedAP(player) {
  return state.orders[player].reduce((sum, o) => sum + o.cost, 0);
}

function getRemainingAP(player) {
  return Math.max(0, MAX_AP - getQueuedAP(player));
}

function getQueuedMissileCount(player) {
  return state.orders[player].filter(o => o.type === 'MISSILE').length;
}

function getAvailableMissiles(player) {
  return Math.max(0, state.missiles[player] - getQueuedMissileCount(player));
}

function getUnitMoveOrders(unitId, player) {
  return state.orders[player].filter(o => o.type === 'MOVE' && o.unitId === unitId);
}

function getPlannedPos(entity, player) {
  if (entity.kind !== 'unit') return { x: entity.x, y: entity.y };
  const moves = getUnitMoveOrders(entity.id, player);
  if (moves.length === 0) return { x: entity.x, y: entity.y };
  const last = moves[moves.length - 1];
  return { x: last.toX, y: last.toY };
}

function getLegSpeed(unit, fromX, fromY, toX = null, toY = null) {
  const def = UNIT_DEFS[unit.type];
  let spd = def.speed;
  if (def.category === 'land') {
    if (toX !== null && toY !== null) {
      if (segmentTouchesRoad(fromX, fromY, toX, toY)) spd += 1;
    } else if (isOnRoad(fromX, fromY, 0.3)) {
      spd += 1;
    }
  }
  return spd;
}

function isFacilityQueued(baseId, player) {
  return state.orders[player].some(o => (o.type === 'PRODUCE' || o.type === 'DEPLOY_AD') && o.baseId === baseId);
}

function hasUnitFullTurnOrder(unitId, player) {
  return state.orders[player].some(o =>
    (o.type === 'CONSTRUCT' || o.type === 'REPAIR_UNIT') && o.unitId === unitId
  );
}

// --- UI FEEDBACK: TOAST & LOG ---
function showToast(msg, tone = 'info') {
  const container = document.getElementById('toast-container');
  const div = document.createElement('div');
  const colors = {
    info: 'bg-slate-900/95 border-sky-400/70 text-sky-100',
    warn: 'bg-amber-950/95 border-amber-400/80 text-amber-100',
    danger: 'bg-rose-950/95 border-rose-400/80 text-rose-100',
    success: 'bg-emerald-950/95 border-emerald-400/80 text-emerald-100'
  };
  div.className = `toast-animate px-4 py-2 rounded-xl border text-xs sm:text-sm font-bold text-center shadow-2xl mb-1.5 ${colors[tone] || colors.info}`;
  div.textContent = msg;
  container.innerHTML = '';
  container.appendChild(div);
}

function addLog(msg, tone = 'slate') {
  const logEl = document.getElementById('combat-log');
  const colors = {
    slate: 'text-slate-300 border-slate-700/60 bg-slate-900/60',
    p1: 'text-sky-200 border-sky-500/40 bg-sky-950/35',
    p2: 'text-rose-200 border-rose-500/40 bg-rose-950/35',
    amber: 'text-amber-200 border-amber-500/40 bg-amber-950/35',
    emerald: 'text-emerald-200 border-emerald-500/40 bg-emerald-950/35',
    danger: 'text-rose-200 border-rose-500/60 bg-rose-950/60'
  };
  const entry = document.createElement('div');
  entry.className = `px-2 py-1.5 rounded-lg border leading-snug ${colors[tone] || colors.slate}`;
  entry.innerHTML = `<span class="text-slate-500 mr-1">[T${state.turn}]</span>${msg}`;
  logEl.prepend(entry);
}

// --- ENTITY CREATION ---
function spawnStructure(owner, type, x, y, isOriginalMain = false) {
  const def = STRUCTURE_DEFS[type];
  const ent = {
    id: nextEntityId++,
    kind: 'structure',
    owner,
    type,
    x, y,
    hp: def.hp,
    cooldown: 0,
    isOriginalMain
  };
  state.entities.push(ent);
  return ent;
}

function spawnUnit(owner, type, x, y) {
  const def = UNIT_DEFS[type];
  const ent = {
    id: nextEntityId++,
    kind: 'unit',
    owner,
    type,
    x, y,
    hp: def.hp,
    ammoSpent: false,
    idleResupplyTurns: 0,
    secured: false
  };
  state.entities.push(ent);
  return ent;
}

function findSpawnPointNear(base, unitType) {
  const cat = UNIT_DEFS[unitType].category;
  const radii = [0.65, 0.95, 1.25, 1.55];
  for (const r of radii) {
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const sx = Math.max(0.35, Math.min(MAP_W - 0.35, base.x + Math.cos(ang) * r));
      const sy = Math.max(0.35, Math.min(MAP_H - 0.35, base.y + Math.sin(ang) * r));
      const terrainOk = cat === 'air' ? true : (cat === 'sea' ? isWaterForShip(sx, sy) : isLandForUnit(sx, sy));
      if (!terrainOk) continue;
      const crowded = state.entities.some(e => distIn(e.x, e.y, sx, sy) < 0.42);
      if (!crowded) return { x: sx, y: sy };
    }
  }
  return { x: Math.max(0.4, Math.min(MAP_W - 0.4, base.x + 0.5)), y: base.y };
}

function spawnStartingForceFor(owner) {
  const bases = state.entities.filter(e => e.kind === 'structure' && e.owner === owner && e.type === 'main_base');
  if (bases.length === 0) return;
  const b1 = bases[0];
  const b2 = bases[1] || bases[0];
  const p1 = findSpawnPointNear(b1, 'infantry');
  spawnUnit(owner, 'infantry', p1.x, p1.y);
  const p2 = findSpawnPointNear(b2, 'infantry');
  spawnUnit(owner, 'infantry', p2.x, p2.y);
  const p3 = findSpawnPointNear(b1, 'light_veh');
  spawnUnit(owner, 'light_veh', p3.x, p3.y);
}

// --- SETUP PHASE ---
function getSetupPlayer() {
  return (state.setupStep % 2 === 0) ? 1 : 2;
}

function handleSetupClick(mx, my) {
  if (!isWithinOutskirts(mx, my)) {
    showToast('Main Bases must be placed within 1.5" of the map edge!', 'warn');
    SFX.play('miss');
    return;
  }
  if (!isLandForBase(mx, my)) {
    showToast('Main Bases must be placed on dry land!', 'warn');
    SFX.play('miss');
    return;
  }
  if (state.entities.some(e => distIn(e.x, e.y, mx, my) < 1.1)) {
    showToast('Too close to another structure!', 'warn');
    SFX.play('miss');
    return;
  }

  const owner = getSetupPlayer();
  const baseNum = state.setupStep < 2 ? 1 : 2;
  spawnStructure(owner, 'main_base', mx, my, true);
  SFX.play('lock');
  addLog(`<strong>${pName(owner)}</strong> deployed Original Main Base #${baseNum} at (${mx.toFixed(1)}", ${my.toFixed(1)}").`, owner === 1 ? 'p1' : 'p2');

  state.setupStep++;
  if (state.setupStep >= 4) {
    finishSetup();
  } else {
    state.activePlayer = getSetupPlayer();
    updateUI();
  }
}

function autoDeploySetup() {
  if (state.phase !== 'SETUP') return;
  const spots = [
    { owner: 1, x: 1.0, y: 2.2 },
    { owner: 2, x: 16.0, y: 2.2 },
    { owner: 1, x: 1.0, y: 8.8 },
    { owner: 2, x: 16.0, y: 8.8 }
  ];
  while (state.setupStep < 4) {
    const s = spots[state.setupStep];
    spawnStructure(s.owner, 'main_base', s.x, s.y, true);
    state.setupStep++;
  }
  SFX.play('lock');
  addLog('⚡ Quick Auto-Deploy placed all 4 Original Main Bases and starting forces.', 'emerald');
  finishSetup();
}

function finishSetup() {
  spawnStartingForceFor(1);
  spawnStartingForceFor(2);
  state.phase = 'PLANNING';
  state.activePlayer = 1;
  state.turn = 1;
  state.selectedId = null;
  setMode('IDLE');
  document.getElementById('setup-banner').classList.add('hidden');
  addLog('<strong>CAMPAIGN STARTED (v2.1 WEGO):</strong> Player 1 (Blue), queue up to 4 AP of secret orders!', 'amber');
  showToast('Deployment Complete! Player 1 (Blue): Queue your secret orders.', 'success');
  updateUI();
}

// --- MODE MANAGEMENT ---
function setMode(newMode, bannerText = '') {
  state.mode = newMode;
  if (newMode !== 'DEPLOY_AD_ZONE') state.pendingAdBaseId = null;
  const banner = document.getElementById('map-mode-banner');
  const txt = document.getElementById('map-mode-text');
  if (newMode === 'IDLE') {
    banner.classList.add('hidden');
  } else {
    txt.textContent = bannerText || newMode;
    banner.classList.remove('hidden');
  }
  updateUI();
}

// --- ORDER QUEUEING ---
function queueMoveLeg(unit, toX, toY) {
  const p = state.activePlayer;
  if (getRemainingAP(p) < 1) {
    showToast('Not enough AP remaining (need 1 AP)!', 'warn');
    SFX.play('miss');
    return false;
  }
  if (hasUnitFullTurnOrder(unit.id, p)) {
    showToast('This unit already has a 4 AP order queued!', 'warn');
    SFX.play('miss');
    return false;
  }

  const from = getPlannedPos(unit, p);
  const def = UNIT_DEFS[unit.type];
  const terrainOk = def.category === 'air' ? true : (def.category === 'sea' ? isWaterForShip(toX, toY) : isLandForUnit(toX, toY));
  if (!terrainOk) {
    showToast(def.category === 'sea' ? 'Ships can only move on water!' : 'Land units must stay on land or bridges!', 'warn');
    SFX.play('miss');
    return false;
  }

  const maxSpd = getLegSpeed(unit, from.x, from.y, toX, toY);
  const d = distIn(from.x, from.y, toX, toY);
  if (d < 0.12) {
    showToast('Choose a destination further from current waypoint.', 'warn');
    return false;
  }
  if (d > maxSpd + 0.05) {
    showToast(`Exceeds leg range (${d.toFixed(2)}" > ${maxSpd.toFixed(1)}"). Click closer!`, 'warn');
    SFX.play('miss');
    return false;
  }

  const legIndex = getUnitMoveOrders(unit.id, p).length + 1;
  const roadBonus = def.category === 'land' && maxSpd > def.speed;
  state.orders[p].push({
    id: nextOrderId++,
    type: 'MOVE',
    cost: 1,
    unitId: unit.id,
    legIndex,
    fromX: from.x,
    fromY: from.y,
    toX,
    toY,
    roadBonus,
    label: `${def.name} Leg #${legIndex} → (${toX.toFixed(1)}", ${toY.toFixed(1)}")${roadBonus ? ' [ROAD +1"]' : ''}`
  });
  SFX.play('move');

  if (getRemainingAP(p) === 0 && state.mode === 'MOVE') {
    setMode('IDLE');
  } else {
    updateUI();
  }
  return true;
}

function queueMissileOrder(targetEntity) {
  const p = state.activePlayer;
  if (getRemainingAP(p) < 1) {
    showToast('Not enough AP (need 1 AP)!', 'warn');
    return;
  }
  if (getAvailableMissiles(p) < 1) {
    showToast('No Missiles remaining in stockpile!', 'warn');
    return;
  }
  if (targetEntity.owner === p) {
    showToast('Cannot target your own forces with a Missile!', 'warn');
    return;
  }
  if (targetEntity.kind === 'structure' && targetEntity.type === 'main_base') {
    showToast('Main Bases are immune to Missile attacks!', 'danger');
    SFX.play('miss');
    return;
  }

  const tName = targetEntity.kind === 'unit' ? UNIT_DEFS[targetEntity.type].name : STRUCTURE_DEFS[targetEntity.type].name;
  state.orders[p].push({
    id: nextOrderId++,
    type: 'MISSILE',
    cost: 1,
    targetId: targetEntity.id,
    targetX: targetEntity.x,
    targetY: targetEntity.y,
    label: `🚀 Missile Strike → Enemy ${tName}`
  });
  SFX.play('lock');
  setMode('IDLE');
  showToast(`Missile strike queued on Enemy ${tName}!`, 'warn');
}

function queueProduceOrder(base, unitType) {
  const p = state.activePlayer;
  if (getRemainingAP(p) < 2) {
    showToast('Need 2 AP to produce a unit!', 'warn');
    return;
  }
  if (base.cooldown > 0 || isFacilityQueued(base.id, p)) {
    showToast('This facility is on cooldown or already producing!', 'warn');
    return;
  }
  const def = UNIT_DEFS[unitType];
  state.orders[p].push({
    id: nextOrderId++,
    type: 'PRODUCE',
    cost: 2,
    baseId: base.id,
    unitType,
    label: `🏭 Produce ${def.name} at ${STRUCTURE_DEFS[base.type].name} (${def.prodCooldown}t CD)`
  });
  SFX.play('click');
  updateUI();
}

function queueDeployAdZone(base, x, y) {
  const p = state.activePlayer;
  if (getRemainingAP(p) < 2) {
    showToast('Need 2 AP to deploy Air Defense!', 'warn');
    return;
  }
  if (!isLandForUnit(x, y)) {
    showToast('Air Defense must be deployed on land!', 'warn');
    return;
  }
  if (distIn(x, y, base.x, base.y) > ESTABLISHED_ZONE_IN) {
    showToast('Must deploy within the 3" Established Zone of this Base!', 'warn');
    return;
  }
  state.orders[p].push({
    id: nextOrderId++,
    type: 'DEPLOY_AD',
    cost: 2,
    baseId: base.id,
    x, y,
    label: `🛡️ Deploy Air Defense in 3" Zone (${x.toFixed(1)}", ${y.toFixed(1)}")`
  });
  SFX.play('lock');
  setMode('IDLE');
}

function queueConstructOrder(unit, structType) {
  const p = state.activePlayer;
  if (getRemainingAP(p) < 4) {
    showToast('Construction / Conversion requires 4 AP (entire turn)!', 'warn');
    return;
  }
  if (!unit.secured) {
    showToast('Unit must hold its ground for 1 full turn (Secured) before building!', 'warn');
    return;
  }
  if (structType === 'port' && !isNearWater(unit.x, unit.y)) {
    showToast('Ports must be constructed on land adjacent to water!', 'warn');
    return;
  }
  const sName = STRUCTURE_DEFS[structType].name;
  const verb = structType === 'resupply_hub' ? 'Convert Infantry →' : 'Construct';
  state.orders[p].push({
    id: nextOrderId++,
    type: 'CONSTRUCT',
    cost: 4,
    unitId: unit.id,
    structType,
    label: `🏗️ ${verb} ${sName} (Consumes ${UNIT_DEFS[unit.type].name})`
  });
  SFX.play('lock');
  updateUI();
}

function queueRepairRuin(ruin, unit = null) {
  const p = state.activePlayer;
  if (getRemainingAP(p) < 4) {
    showToast('Reconstruction requires 4 AP (entire turn)!', 'warn');
    return;
  }
  if (ruin.cooldown > 0) {
    showToast(`Ruin still cooling down (${ruin.cooldown} turns left)!`, 'warn');
    return;
  }
  const sName = STRUCTURE_DEFS[ruin.type].name;
  if (ruin.type === 'main_base') {
    state.orders[p].push({
      id: nextOrderId++,
      type: 'REPAIR_MAIN',
      cost: 4,
      ruinId: ruin.id,
      label: `🔧 Reconstruct ${sName} (4 AP)`
    });
  } else {
    if (!unit || (unit.type !== 'infantry' && unit.type !== 'specops')) {
      showToast('Move an Infantry or Special Forces unit onto the Ruin to repair it!', 'warn');
      return;
    }
    state.orders[p].push({
      id: nextOrderId++,
      type: 'REPAIR_UNIT',
      cost: 4,
      ruinId: ruin.id,
      unitId: unit.id,
      label: `🔧 Repair ${sName} with ${UNIT_DEFS[unit.type].name}`
    });
  }
  SFX.play('lock');
  updateUI();
}

function undoLastOrder() {
  if (state.phase !== 'PLANNING') return;
  const list = state.orders[state.activePlayer];
  if (list.length === 0) return;
  list.pop();
  SFX.play('click');
  updateUI();
}

function clearAllOrders() {
  if (state.phase !== 'PLANNING') return;
  state.orders[state.activePlayer] = [];
  setMode('IDLE');
  SFX.play('click');
  updateUI();
}

// --- HOTSEAT LOCK & WEGO TRANSITION ---
function lockActivePlayerOrders() {
  if (state.phase !== 'PLANNING') return;
  setMode('IDLE');
  state.selectedId = null;
  SFX.play('lock');

  if (state.activePlayer === 1) {
    // Show Privacy Handoff to Player 2
    const modal = document.getElementById('handoff-modal');
    document.getElementById('handoff-title').textContent = 'Player 1 Orders Locked';
    document.getElementById('handoff-subtitle').textContent =
      `Player 1 queued ${state.orders[1].length} secret order(s) (${getQueuedAP(1)}/4 AP). Pass device to Player 2 (Red).`;
    const btn = document.getElementById('btn-handoff-ready');
    btn.textContent = 'Player 2 (Red) Ready — Begin Planning';
    btn.className = 'tac-btn w-full py-3 rounded-xl bg-gradient-to-b from-rose-500 to-rose-700 hover:from-rose-400 hover:to-rose-600 text-white font-extrabold uppercase tracking-wider text-sm';
    btn.onclick = () => {
      modal.classList.add('hidden');
      state.activePlayer = 2;
      SFX.play('click');
      updateUI();
    };
    modal.classList.remove('hidden');
  } else {
    // Both locked! Begin Simultaneous Resolution
    runSimultaneousResolution();
  }
}

// --- SIMULTANEOUS 4-STEP WEGO RESOLUTION ---
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function highlightResStep(stepNum) {
  document.querySelectorAll('#res-steps [data-step]').forEach(el => {
    const s = Number(el.dataset.step);
    if (s === stepNum) {
      el.className = 'px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-extrabold shadow';
    } else if (s < stepNum) {
      el.className = 'px-2 py-0.5 rounded bg-emerald-900/80 text-emerald-300 border border-emerald-500/40';
    } else {
      el.className = 'px-2 py-0.5 rounded bg-slate-800 text-slate-400';
    }
  });
}

function addEffect(fx) {
  state.effects.push({ ...fx, createdAt: performance.now() });
}

function checkContactResupplyForUnit(unit, x, y) {
  if (!unit.ammoSpent) return false;
  const touched = state.entities.some(e =>
    e.kind === 'structure' &&
    e.owner === unit.owner &&
    STRUCTURE_DEFS[e.type].isResupply &&
    distIn(x, y, e.x, e.y) <= RESUPPLY_TOUCH_IN
  );
  if (touched) {
    unit.ammoSpent = false;
    unit.idleResupplyTurns = 0;
    addEffect({ type: 'text', x, y: y - 0.35, text: 'RELOADED!', color: '#34d399', duration: 1500 });
    addLog(`🔋 <strong>${pName(unit.owner)} ${UNIT_DEFS[unit.type].name}</strong> reloaded on contact with friendly Base/Hub!`, 'emerald');
    return true;
  }
  return false;
}

function canAutoEngage(attacker, target) {
  if (attacker.owner === target.owner) return false;
  const aDef = UNIT_DEFS[attacker.type];
  if (distIn(attacker.x, attacker.y, target.x, target.y) > aDef.range + 0.03) return false;

  if (attacker.type === 'air_def') {
    return target.kind === 'unit' && target.type === 'plane';
  }
  if (target.kind === 'unit' && target.type === 'plane') {
    return attacker.type === 'plane' || attacker.type === 'air_def';
  }
  if (attacker.type === 'infantry') {
    if (target.kind === 'unit' && (target.type === 'heavy_veh' || target.type === 'plane' || target.type === 'ship')) {
      return false;
    }
  }
  return true;
}

function convertStructureToRuin(struct) {
  state.ruins.push({
    id: nextEntityId++,
    owner: struct.owner,
    type: struct.type,
    x: struct.x,
    y: struct.y,
    cooldown: RUIN_REPAIR_TURNS,
    isOriginalMain: !!struct.isOriginalMain
  });
}

async function runSimultaneousResolution() {
  state.phase = 'RESOLVING';
  state.selectedId = null;
  document.getElementById('resolution-banner').classList.remove('hidden');
  document.getElementById('btn-next-turn').classList.add('hidden');
  updateUI();

  addLog(`<strong class="text-amber-300">══ TURN ${state.turn} SIMULTANEOUS RESOLUTION ══</strong>`, 'amber');

  const movedUnitIds = new Set();
  const spentBeforeThisTurn = new Set(
    state.entities.filter(e => e.kind === 'unit' && e.ammoSpent).map(e => e.id)
  );

  // ============================================================
  // STEP 1: SIMULTANEOUS MULTI-LEG MOVEMENT & MID-PATH RESUPPLY
  // ============================================================
  highlightResStep(1);
  const unitPaths = new Map();
  for (const p of [1, 2]) {
    for (const o of state.orders[p]) {
      if (o.type === 'MOVE') {
        if (!unitPaths.has(o.unitId)) unitPaths.set(o.unitId, []);
        unitPaths.get(o.unitId).push(o);
        movedUnitIds.add(o.unitId);
      }
    }
  }

  if (unitPaths.size > 0) {
    SFX.play('move');
    const maxLegs = Math.max(...Array.from(unitPaths.values()).map(arr => arr.length));
    for (let leg = 0; leg < maxLegs; leg++) {
      const activeAnims = [];
      for (const [unitId, legs] of unitPaths.entries()) {
        if (leg < legs.length) {
          const u = getEntityById(unitId);
          if (u) {
            activeAnims.push({
              unit: u,
              fromX: legs[leg].fromX,
              fromY: legs[leg].fromY,
              toX: legs[leg].toX,
              toY: legs[leg].toY
            });
          }
        }
      }
      const duration = 520;
      const startTime = performance.now();
      await new Promise(resolve => {
        function stepAnim(now) {
          const t = Math.min(1, (now - startTime) / duration);
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          for (const a of activeAnims) {
            a.unit.x = a.fromX + (a.toX - a.fromX) * ease;
            a.unit.y = a.fromY + (a.toY - a.fromY) * ease;
            checkContactResupplyForUnit(a.unit, a.unit.x, a.unit.y);
          }
          if (t < 1) requestAnimationFrame(stepAnim);
          else resolve();
        }
        requestAnimationFrame(stepAnim);
      });
    }
    addLog(`Step 1: ${unitPaths.size} unit(s) completed simultaneous movement.`, 'slate');
  } else {
    addLog('Step 1: No movement orders queued.', 'slate');
  }

  // Check stationary contact resupply as well
  for (const u of state.entities) {
    if (u.kind === 'unit' && u.ammoSpent) {
      checkContactResupplyForUnit(u, u.x, u.y);
    }
  }
  await sleep(350);

  // ============================================================
  // STEP 2: AUTOMATIC ENGAGEMENT (0 AP, SIMULTANEOUS, MUTUAL KILLS)
  // ============================================================
  highlightResStep(2);
  const targetAttackers = new Map(); // targetId -> [attackerEntity, ...]

  for (const unit of state.entities) {
    if (unit.kind !== 'unit' || unit.ammoSpent) continue;
    const candidates = state.entities.filter(t => canAutoEngage(unit, t));
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => {
      const da = distIn(unit.x, unit.y, a.x, a.y);
      const db = distIn(unit.x, unit.y, b.x, b.y);
      if (Math.abs(da - db) > 0.02) return da - db;
      return a.hp - b.hp;
    });

    const chosen = candidates[0];
    if (!targetAttackers.has(chosen.id)) targetAttackers.set(chosen.id, []);
    targetAttackers.get(chosen.id).push(unit);
  }

  const destroyedInStep2 = new Set();
  if (targetAttackers.size > 0) {
    SFX.play('fire');
    for (const [targetId, attackers] of targetAttackers.entries()) {
      const target = getEntityById(targetId);
      if (!target) continue;

      const combinedAtk = attackers.reduce((sum, u) => sum + UNIT_DEFS[u.type].atk, 0);
      const atkRoll = rollDie(combinedAtk);
      const defRoll = rollDie(target.hp);
      const hit = atkRoll > defRoll;

      // Mark attackers SPENT & draw beams
      for (const a of attackers) {
        a.ammoSpent = true;
        a.idleResupplyTurns = 0;
        addEffect({
          type: 'beam',
          x1: a.x, y1: a.y, x2: target.x, y2: target.y,
          color: pColor(a.owner), duration: 1100
        });
      }

      const tName = target.kind === 'unit' ? UNIT_DEFS[target.type].name : STRUCTURE_DEFS[target.type].name;
      const aNames = attackers.map(a => UNIT_DEFS[a.type].name).join(' + ');

      if (hit) {
        destroyedInStep2.add(target.id);
        state.stats.kills[attackers[0].owner]++;
        addEffect({ type: 'boom', x: target.x, y: target.y, color: '#f97316', duration: 950 });
        addEffect({ type: 'text', x: target.x, y: target.y - 0.35, text: `💥 ${atkRoll} > ${defRoll}`, color: '#fb7185', duration: 1600 });
        addLog(`💥 <strong>AUTO-ENGAGE:</strong> ${pName(attackers[0].owner)} [${aNames}] rolled <strong>${atkRoll}</strong> (d${combinedAtk}) vs ${pName(target.owner)} ${tName} <strong>${defRoll}</strong> (d${target.hp}) → <strong>DESTROYED!</strong>`, 'danger');
      } else {
        addEffect({ type: 'text', x: target.x, y: target.y - 0.35, text: `🛡️ ${atkRoll} ≤ ${defRoll}`, color: '#94a3b8', duration: 1500 });
        addLog(`🛡️ <strong>AUTO-ENGAGE:</strong> ${pName(attackers[0].owner)} [${aNames}] rolled <strong>${atkRoll}</strong> (d${combinedAtk}) vs ${pName(target.owner)} ${tName} <strong>${defRoll}</strong> (d${target.hp}) → <strong>DEFLECTED</strong>.`, 'slate');
      }
    }

    if (destroyedInStep2.size > 0) SFX.play('explode');
    else SFX.play('miss');

    // Remove destroyed entities simultaneously
    const survivors = [];
    for (const e of state.entities) {
      if (destroyedInStep2.has(e.id)) {
        if (e.kind === 'structure') convertStructureToRuin(e);
      } else {
        survivors.push(e);
      }
    }
    state.entities = survivors;
  } else {
    addLog('Step 2: No Loaded units in Automatic Engagement range.', 'slate');
  }
  await sleep(950);

  // ============================================================
  // STEP 3: MISSILES & AIR DEFENSE INTERCEPTION
  // ============================================================
  highlightResStep(3);
  const missileOrders = [
    ...state.orders[1].filter(o => o.type === 'MISSILE').map(o => ({ ...o, owner: 1 })),
    ...state.orders[2].filter(o => o.type === 'MISSILE').map(o => ({ ...o, owner: 2 }))
  ];

  if (missileOrders.length > 0) {
    const destroyedByMissile = new Set();
    for (const m of missileOrders) {
      if (state.missiles[m.owner] <= 0) continue;
      state.missiles[m.owner]--;
      state.stats.missilesFired[m.owner]++;

      const target = getEntityById(m.targetId);
      if (!target) {
        addLog(`🚀 ${pName(m.owner)} Missile struck empty coordinates (target already destroyed).`, 'amber');
        addEffect({ type: 'boom', x: m.targetX, y: m.targetY, color: '#f59e0b', duration: 850 });
        continue;
      }

      let missileRoll = rollDie(MISSILE_ATK);
      const interceptors = state.entities.filter(e =>
        e.kind === 'unit' &&
        e.owner === target.owner &&
        e.type === 'air_def' &&
        distIn(e.x, e.y, target.x, target.y) <= ESTABLISHED_ZONE_IN
      );

      let interceptText = '';
      let intercepted = false;
      if (interceptors.length > 0) {
        const adRoll = rollDie(4);
        addEffect({
          type: 'beam', x1: interceptors[0].x, y1: interceptors[0].y,
          x2: target.x, y2: target.y, color: '#34d399', duration: 1000
        });
        if (adRoll > missileRoll) {
          intercepted = true;
          interceptText = ` (Air Def D4=${adRoll} > ${missileRoll} — INTERCEPTED!)`;
        } else {
          missileRoll = Math.max(0, missileRoll - adRoll);
          interceptText = ` (Air Def D4=${adRoll} reduced Atk to ${missileRoll})`;
        }
      }

      const tName = target.kind === 'unit' ? UNIT_DEFS[target.type].name : STRUCTURE_DEFS[target.type].name;
      if (intercepted) {
        SFX.play('miss');
        addEffect({ type: 'text', x: target.x, y: target.y - 0.35, text: '🛡️ INTERCEPTED!', color: '#34d399', duration: 1500 });
        addLog(`🚀 <strong>MISSILE:</strong> ${pName(m.owner)} fired at ${tName}${interceptText}`, 'emerald');
      } else {
        const defRoll = rollDie(target.hp);
        if (missileRoll > defRoll) {
          destroyedByMissile.add(target.id);
          state.stats.kills[m.owner]++;
          SFX.play('explode');
          addEffect({ type: 'boom', x: target.x, y: target.y, color: '#ef4444', duration: 1000 });
          addEffect({ type: 'text', x: target.x, y: target.y - 0.35, text: `🚀 HIT ${missileRoll}>${defRoll}`, color: '#fb7185', duration: 1600 });
          addLog(`🚀 <strong>MISSILE HIT:</strong> ${pName(m.owner)} struck ${pName(target.owner)} ${tName}${interceptText} vs Def <strong>${defRoll}</strong> (d${target.hp}) → <strong>DESTROYED!</strong>`, 'danger');
        } else {
          SFX.play('miss');
          addEffect({ type: 'text', x: target.x, y: target.y - 0.35, text: `🚀 MISS ${missileRoll}≤${defRoll}`, color: '#fbbf24', duration: 1500 });
          addLog(`🚀 <strong>MISSILE:</strong> ${pName(m.owner)} struck ${pName(target.owner)} ${tName}${interceptText} vs Def <strong>${defRoll}</strong> (d${target.hp}) → <strong>SURVIVED</strong>.`, 'amber');
        }
      }
    }

    if (destroyedByMissile.size > 0) {
      const survivors = [];
      for (const e of state.entities) {
        if (destroyedByMissile.has(e.id)) {
          if (e.kind === 'structure') convertStructureToRuin(e);
        } else {
          survivors.push(e);
        }
      }
      state.entities = survivors;
    }
  } else {
    addLog('Step 3: No Missiles launched this turn.', 'slate');
  }
  await sleep(800);

  // ============================================================
  // STEP 4: LOGISTICS, PRODUCTION, CONSTRUCTION & REPAIRS
  // ============================================================
  highlightResStep(4);

  // 4A: Cooldowns & Idle Resupply
  for (const e of state.entities) {
    if (e.kind === 'structure' && e.cooldown > 0) {
      e.cooldown--;
    }
    if (e.kind === 'unit') {
      // Idle resupply ticks for units that were ALREADY spent before this turn's Step 2
      if (e.ammoSpent && spentBeforeThisTurn.has(e.id)) {
        e.idleResupplyTurns++;
        if (e.idleResupplyTurns >= 2) {
          e.ammoSpent = false;
          e.idleResupplyTurns = 0;
          addEffect({ type: 'text', x: e.x, y: e.y - 0.35, text: 'IDLE RELOAD', color: '#34d399', duration: 1300 });
          addLog(`🔋 ${pName(e.owner)} ${UNIT_DEFS[e.type].name} completed 2-turn Idle Resupply.`, 'emerald');
        }
      }
      // Secured status: units that did NOT move this turn become Secured
      e.secured = !movedUnitIds.has(e.id);
    }
  }

  for (const r of state.ruins) {
    if (r.cooldown > 0) r.cooldown--;
  }

  // 4B: Production, Air Defense Zone Deploy, Construction, Infantry->Resupply Hub, Repairs
  for (const p of [1, 2]) {
    for (const o of state.orders[p]) {
      if (o.type === 'PRODUCE') {
        const base = getEntityById(o.baseId);
        if (!base) {
          addLog(`⚠️ ${pName(p)} production canceled (facility destroyed).`, 'amber');
          continue;
        }
        const pt = findSpawnPointNear(base, o.unitType);
        spawnUnit(p, o.unitType, pt.x, pt.y);
        base.cooldown = UNIT_DEFS[o.unitType].prodCooldown;
        addLog(`🏭 <strong>${pName(p)}</strong> produced <strong>${UNIT_DEFS[o.unitType].name}</strong> at ${STRUCTURE_DEFS[base.type].name}.`, p === 1 ? 'p1' : 'p2');
      } else if (o.type === 'DEPLOY_AD') {
        const base = getEntityById(o.baseId);
        if (!base) continue;
        spawnUnit(p, 'air_def', o.x, o.y);
        base.cooldown = UNIT_DEFS.air_def.prodCooldown;
        addLog(`🛡️ <strong>${pName(p)}</strong> deployed <strong>Air Defense</strong> in 3" Established Zone.`, p === 1 ? 'p1' : 'p2');
      } else if (o.type === 'CONSTRUCT') {
        const unit = getEntityById(o.unitId);
        if (!unit) {
          addLog(`⚠️ ${pName(p)} construction/conversion canceled (unit destroyed in combat!).`, 'amber');
          continue;
        }
        const { x, y } = unit;
        state.entities = state.entities.filter(e => e.id !== unit.id);
        spawnStructure(p, o.structType, x, y, false);
        addEffect({ type: 'text', x, y: y - 0.35, text: 'BUILT!', color: '#38bdf8', duration: 1500 });
        addLog(`🏗️ <strong>${pName(p)}</strong> completed <strong>${STRUCTURE_DEFS[o.structType].name}</strong> at (${x.toFixed(1)}", ${y.toFixed(1)}").`, 'emerald');
      } else if (o.type === 'REPAIR_MAIN') {
        const ruin = getRuinById(o.ruinId);
        if (!ruin) continue;
        state.ruins = state.ruins.filter(r => r.id !== ruin.id);
        spawnStructure(p, 'main_base', ruin.x, ruin.y, ruin.isOriginalMain);
        addLog(`🔧 <strong>${pName(p)}</strong> reconstructed <strong>Main Base</strong>!`, 'emerald');
      } else if (o.type === 'REPAIR_UNIT') {
        const ruin = getRuinById(o.ruinId);
        const unit = getEntityById(o.unitId);
        if (!ruin || !unit) {
          addLog(`⚠️ ${pName(p)} ruin repair canceled (unit destroyed).`, 'amber');
          continue;
        }
        state.ruins = state.ruins.filter(r => r.id !== ruin.id);
        spawnStructure(p, ruin.type, ruin.x, ruin.y, ruin.isOriginalMain);
        addLog(`🔧 <strong>${pName(p)}</strong> repaired <strong>${STRUCTURE_DEFS[ruin.type].name}</strong>!`, 'emerald');
      }
    }
  }

  // 4C: 5-Turn Automatic Missile Restock
  if (state.turn % MISSILE_RESTOCK_TURNS === 0) {
    state.missiles[1]++;
    state.missiles[2]++;
    addLog('🚀 <strong>5-TURN RESTOCK:</strong> Both players received +1 Missile!', 'amber');
  }

  // Clear resolved orders
  state.orders[1] = [];
  state.orders[2] = [];

  // 4D: Check Victory Condition
  const p1MainAlive = state.entities.filter(e => e.kind === 'structure' && e.owner === 1 && e.isOriginalMain).length;
  const p2MainAlive = state.entities.filter(e => e.kind === 'structure' && e.owner === 2 && e.isOriginalMain).length;

  if (p1MainAlive === 0 || p2MainAlive === 0) {
    state.phase = 'GAMEOVER';
    SFX.play('victory');
    showVictoryModal(p1MainAlive, p2MainAlive);
    updateUI();
    return;
  }

  state.phase = 'POST_RESOLUTION';
  document.getElementById('btn-next-turn').classList.remove('hidden');
  showToast(`Turn ${state.turn} Resolved! Review the battlefield, then begin Turn ${state.turn + 1}.`, 'success');
  updateUI();
}

function beginNextTurn() {
  if (state.phase !== 'POST_RESOLUTION') return;
  state.turn++;
  state.activePlayer = 1;
  state.phase = 'PLANNING';
  document.getElementById('resolution-banner').classList.add('hidden');

  const modal = document.getElementById('handoff-modal');
  document.getElementById('handoff-title').textContent = `Turn ${state.turn} — Planning Phase`;
  document.getElementById('handoff-subtitle').textContent = 'Pass device to Player 1 (Blue) to plot secret orders.';
  const btn = document.getElementById('btn-handoff-ready');
  btn.textContent = 'Player 1 (Blue) Ready — Begin Planning';
  btn.className = 'tac-btn w-full py-3 rounded-xl bg-gradient-to-b from-sky-500 to-blue-700 hover:from-sky-400 hover:to-blue-600 text-white font-extrabold uppercase tracking-wider text-sm';
  btn.onclick = () => {
    modal.classList.add('hidden');
    SFX.play('click');
    updateUI();
  };
  modal.classList.remove('hidden');
  updateUI();
}

function showVictoryModal(p1Main, p2Main) {
  const modal = document.getElementById('victory-modal');
  const title = document.getElementById('victory-title');
  const sub = document.getElementById('victory-subtitle');
  if (p1Main === 0 && p2Main === 0) {
    title.textContent = 'MUTUAL ANNIHILATION — DRAW!';
    sub.textContent = 'Both commanders lost their Original Main Bases simultaneously.';
  } else if (p2Main === 0) {
    title.textContent = 'PLAYER 1 (BLUE) VICTORY!';
    sub.textContent = 'Both Red Original Main Bases have been destroyed.';
  } else {
    title.textContent = 'PLAYER 2 (RED) VICTORY!';
    sub.textContent = 'Both Blue Original Main Bases have been destroyed.';
  }
  document.getElementById('victory-stats').innerHTML = `
    <div>Turns Played: <strong>${state.turn}</strong></div>
    <div>Blue Kills: <strong class="text-sky-300">${state.stats.kills[1]}</strong> | Red Kills: <strong class="text-rose-300">${state.stats.kills[2]}</strong></div>
    <div>Missiles Fired: Blue <strong>${state.stats.missilesFired[1]}</strong> | Red <strong>${state.stats.missilesFired[2]}</strong></div>
  `;
  modal.classList.remove('hidden');
}

// --- CANVAS HIT-TESTING & INTERACTION ---
function findEntityAt(mx, my) {
  let best = null;
  let bestDist = 0.48;
  for (const e of state.entities) {
    const d = distIn(mx, my, e.x, e.y);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

function findRuinAt(mx, my) {
  let best = null;
  let bestDist = 0.5;
  for (const r of state.ruins) {
    const d = distIn(mx, my, r.x, r.y);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  return best;
}

function handleCanvasClick(evt) {
  const rect = canvas.getBoundingClientRect();
  const px = evt.clientX - rect.left;
  const py = evt.clientY - rect.top;
  const mx = toMapX(px);
  const my = toMapY(py);
  if (mx < 0 || mx > MAP_W || my < 0 || my > MAP_H) return;

  if (state.phase === 'SETUP') {
    handleSetupClick(mx, my);
    return;
  }

  if (state.phase !== 'PLANNING') {
    const clicked = findEntityAt(mx, my);
    state.selectedId = clicked ? clicked.id : null;
    updateUI();
    return;
  }

  const p = state.activePlayer;

  // Mode: MISSILE
  if (state.mode === 'MISSILE') {
    const target = findEntityAt(mx, my);
    if (!target) {
      showToast('Click directly on an enemy unit or non-Main-Base structure!', 'warn');
      return;
    }
    queueMissileOrder(target);
    return;
  }

  // Mode: DEPLOY_AD_ZONE
  if (state.mode === 'DEPLOY_AD_ZONE') {
    const base = getEntityById(state.pendingAdBaseId);
    if (base) queueDeployAdZone(base, mx, my);
    return;
  }

  // Mode: MOVE (explicit chained leg plotting)
  if (state.mode === 'MOVE') {
    const sel = getEntityById(state.selectedId);
    if (sel && sel.kind === 'unit' && sel.owner === p) {
      queueMoveLeg(sel, mx, my);
      return;
    }
    setMode('IDLE');
  }

  // Mode: IDLE
  const clickedEntity = findEntityAt(mx, my);
  if (clickedEntity) {
    state.selectedId = clickedEntity.id;
    SFX.play('click');
    updateUI();
    return;
  }

  const clickedRuin = findRuinAt(mx, my);
  if (clickedRuin) {
    state.selectedId = clickedRuin.id;
    SFX.play('click');
    updateUI();
    return;
  }

  // Quick-Move convenience: if a friendly unit is selected & you click empty terrain within leg range, queue a move leg!
  const sel = getEntityById(state.selectedId);
  if (sel && sel.kind === 'unit' && sel.owner === p && getRemainingAP(p) >= 1 && !hasUnitFullTurnOrder(sel.id, p)) {
    const from = getPlannedPos(sel, p);
    const maxSpd = getLegSpeed(sel, from.x, from.y, mx, my);
    if (distIn(from.x, from.y, mx, my) <= maxSpd + 0.05) {
      queueMoveLeg(sel, mx, my);
      return;
    }
  }

  state.selectedId = null;
  updateUI();
}

function handleCanvasMove(evt) {
  const rect = canvas.getBoundingClientRect();
  const px = evt.clientX - rect.left;
  const py = evt.clientY - rect.top;
  const mx = toMapX(px);
  const my = toMapY(py);
  if (mx >= 0 && mx <= MAP_W && my >= 0 && my <= MAP_H) {
    state.hoverMap = { x: mx, y: my };
    document.getElementById('tel-coords').textContent = `${mx.toFixed(2)}", ${my.toFixed(2)}"`;
    const terrain = isPointOnBridge(mx, my) ? 'BRIDGE (ROAD)' : (isPointInWater(mx, my) ? 'WATER' : (isOnRoad(mx, my) ? 'HIGHWAY (+1")' : 'LAND'));
    const tEl = document.getElementById('tel-terrain');
    tEl.textContent = terrain;
    tEl.className = terrain.includes('WATER') ? 'text-sky-400' : (terrain.includes('HIGHWAY') || terrain.includes('BRIDGE') ? 'text-amber-300' : 'text-emerald-400');

    const sel = getEntityById(state.selectedId);
    if (sel) {
      const ref = (state.phase === 'PLANNING' && sel.owner === state.activePlayer) ? getPlannedPos(sel, state.activePlayer) : sel;
      document.getElementById('tel-dist').textContent = `${distIn(ref.x, ref.y, mx, my).toFixed(2)}"`;
    } else {
      document.getElementById('tel-dist').textContent = '—';
    }
  } else {
    state.hoverMap = null;
  }
}

// --- UI RENDERING ---
function updateUI() {
  const p = state.activePlayer;
  const remAP = getRemainingAP(p);
  const queuedAP = getQueuedAP(p);

  // Player Pill
  const pill = document.getElementById('hud-player-pill');
  const dot = document.getElementById('hud-player-dot');
  const pTxt = document.getElementById('hud-player-text');
  const phaseBadge = document.getElementById('hud-phase-badge');

  if (p === 1) {
    pill.className = 'px-3 py-1.5 rounded-lg border border-sky-500/60 bg-sky-950/50 text-sky-200 flex items-center gap-2 font-bold text-xs sm:text-sm tracking-wide';
    dot.className = 'w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]';
    pTxt.textContent = 'PLAYER 1 (BLUE)';
  } else {
    pill.className = 'px-3 py-1.5 rounded-lg border border-rose-500/60 bg-rose-950/50 text-rose-200 flex items-center gap-2 font-bold text-xs sm:text-sm tracking-wide';
    dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-400 shadow-[0_0_8px_#fb7185]';
    pTxt.textContent = 'PLAYER 2 (RED)';
  }
  phaseBadge.textContent = state.phase.replace('_', ' ');

  // Turn & Restock
  document.getElementById('hud-turn').textContent = state.turn;
  const turnsToRestock = MISSILE_RESTOCK_TURNS - ((state.turn - 1) % MISSILE_RESTOCK_TURNS);
  document.getElementById('hud-restock').textContent = `In ${turnsToRestock}t`;

  // AP Pips
  const pipsEl = document.getElementById('hud-ap-pips');
  pipsEl.innerHTML = '';
  for (let i = 0; i < MAX_AP; i++) {
    const pip = document.createElement('div');
    if (i < remAP) pip.className = `ap-pip ${p === 1 ? 'active-p1' : 'active-p2'}`;
    else if (i < remAP + queuedAP) pip.className = 'ap-pip queued';
    else pip.className = 'ap-pip empty';
    pipsEl.appendChild(pip);
  }
  document.getElementById('hud-ap-text').textContent = `${remAP}/${MAX_AP}`;

  // Missiles
  const availM = getAvailableMissiles(p);
  document.getElementById('hud-missiles').textContent = availM;
  document.getElementById('btn-launch-missile').disabled = state.phase !== 'PLANNING' || remAP < 1 || availM < 1;

  // Lock Orders button
  const lockBtn = document.getElementById('btn-lock-orders');
  lockBtn.disabled = state.phase !== 'PLANNING';
  lockBtn.textContent = p === 1 ? 'Lock P1 Orders 🔒' : 'Lock P2 & Resolve ⚡';

  // Setup instructions
  if (state.phase === 'SETUP') {
    const sp = getSetupPlayer();
    const num = state.setupStep < 2 ? 1 : 2;
    document.getElementById('setup-instruction').textContent =
      `${pName(sp)}: Place Original Main Base #${num} on dry land within 1.5" of any map edge.`;
  }

  // Main Base Counters
  const p1B = state.entities.filter(e => e.kind === 'structure' && e.owner === 1 && e.isOriginalMain).length;
  const p2B = state.entities.filter(e => e.kind === 'structure' && e.owner === 2 && e.isOriginalMain).length;
  document.getElementById('tel-p1-bases').textContent = `${p1B}/2`;
  document.getElementById('tel-p2-bases').textContent = `${p2B}/2`;

  renderInspector();
  renderOrderQueue();
}

function renderInspector() {
  const box = document.getElementById('inspector-content');
  const badge = document.getElementById('inspector-owner-badge');
  const p = state.activePlayer;
  const remAP = getRemainingAP(p);

  const ent = getEntityById(state.selectedId);
  const ruin = !ent ? getRuinById(state.selectedId) : null;

  if (!ent && !ruin) {
    badge.textContent = 'NO SELECTION';
    badge.className = 'text-[10px] font-mono-tac px-2 py-0.5 rounded bg-slate-800 text-slate-400';
    box.innerHTML = `
      <div class="text-slate-400 leading-relaxed">
        Click any unit, structure, or ruin on the 11×17" map to inspect stats and queue orders.<br/>
        <span class="text-sky-300 font-semibold">Tip:</span> Select a friendly unit and click within its movement ring to chain multiple <strong>1 AP</strong> move legs!
      </div>`;
    return;
  }

  if (ruin) {
    const sDef = STRUCTURE_DEFS[ruin.type];
    badge.textContent = `${pName(ruin.owner)} RUIN`;
    badge.className = 'text-[10px] font-mono-tac px-2 py-0.5 rounded bg-amber-900/60 text-amber-300 border border-amber-500/40';
    const canRepairMain = state.phase === 'PLANNING' && ruin.owner === p && ruin.type === 'main_base' && ruin.cooldown === 0 && remAP >= 4;
    const nearbyRepairUnit = state.entities.find(u =>
      u.kind === 'unit' && u.owner === p && (u.type === 'infantry' || u.type === 'specops') &&
      distIn(u.x, u.y, ruin.x, ruin.y) <= 0.8
    );
    const canRepairGen = state.phase === 'PLANNING' && ruin.owner === p && ruin.type !== 'main_base' && ruin.cooldown === 0 && remAP >= 4 && !!nearbyRepairUnit;

    box.innerHTML = `
      <div class="font-bold text-sm text-amber-300 mb-1">🏚️ ${sDef.name} Ruins</div>
      <div class="font-mono-tac text-[11px] text-slate-300 mb-2">
        Cooldown: <strong class="${ruin.cooldown === 0 ? 'text-emerald-400' : 'text-amber-300'}">${ruin.cooldown === 0 ? 'READY TO REPAIR' : ruin.cooldown + ' turn(s)'}</strong>
      </div>
      ${ruin.type === 'main_base'
        ? `<button id="act-repair-main" ${canRepairMain ? '' : 'disabled'} class="tac-btn w-full py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs">🔧 Reconstruct Main Base (4 AP)</button>`
        : `<button id="act-repair-gen" ${canRepairGen ? '' : 'disabled'} class="tac-btn w-full py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs">🔧 Repair with Inf/SpecOps (4 AP)</button>`
      }
    `;
    if (canRepairMain) document.getElementById('act-repair-main').onclick = () => queueRepairRuin(ruin);
    if (canRepairGen) document.getElementById('act-repair-gen').onclick = () => queueRepairRuin(ruin, nearbyRepairUnit);
    return;
  }

  const isOwn = ent.owner === p;
  badge.textContent = pName(ent.owner);
  badge.className = ent.owner === 1
    ? 'text-[10px] font-mono-tac px-2 py-0.5 rounded bg-sky-900/70 text-sky-300 border border-sky-500/40'
    : 'text-[10px] font-mono-tac px-2 py-0.5 rounded bg-rose-900/70 text-rose-300 border border-rose-500/40';

  if (ent.kind === 'unit') {
    const def = UNIT_DEFS[ent.type];
    const legs = isOwn ? getUnitMoveOrders(ent.id, p).length : 0;
    const canAct = state.phase === 'PLANNING' && isOwn;
    const canMove = canAct && remAP >= 1 && !hasUnitFullTurnOrder(ent.id, p);
    const canBuild = canAct && remAP >= 4 && ent.secured && def.category === 'land';

    box.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <span class="font-extrabold text-sm text-slate-100">${def.name} <span class="text-[10px] font-mono-tac text-slate-400">(${def.shape})</span></span>
        <span class="px-1.5 py-0.5 rounded text-[10px] font-mono-tac font-bold ${ent.ammoSpent ? 'bg-rose-900/80 text-rose-300 border border-rose-500/50' : 'bg-emerald-900/80 text-emerald-300 border border-emerald-500/50'}">
          ${ent.ammoSpent ? `SPENT (${ent.idleResupplyTurns}/2t)` : 'LOADED'}
        </span>
      </div>
      <div class="grid grid-cols-4 gap-1 font-mono-tac text-[10px] bg-slate-900/80 rounded-lg p-1.5 mb-2 text-center">
        <div><div class="text-slate-500">SPD</div><div class="text-slate-100 font-bold">${def.speed}"</div></div>
        <div><div class="text-slate-500">HP</div><div class="text-slate-100 font-bold">d${def.hp}</div></div>
        <div><div class="text-slate-500">ATK</div><div class="text-amber-300 font-bold">d${def.atk}</div></div>
        <div><div class="text-slate-500">RNG</div><div class="text-rose-300 font-bold">${def.range}"</div></div>
      </div>
      <div class="flex items-center justify-between text-[10px] font-mono-tac mb-2">
        <span class="${ent.secured ? 'text-emerald-400' : 'text-slate-400'}">${ent.secured ? '✓ Ground Secured' : '○ Not Secured Yet'}</span>
        ${legs > 0 ? `<span class="text-amber-300 font-bold">${legs} Move Leg(s) Queued</span>` : ''}
      </div>
      <p class="text-[11px] text-slate-400 mb-2 leading-snug">${def.notes}</p>
      ${canAct ? `
        <div class="space-y-1.5">
          <button id="act-move-leg" ${canMove ? '' : 'disabled'} class="tac-btn w-full py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-bold text-xs">
            🧭 ${legs > 0 ? `Chain Move Leg #${legs + 1}` : 'Plot Move Path'} (1 AP)
          </button>
          ${ent.type === 'infantry' ? `
            <button id="act-convert-hub" ${canBuild ? '' : 'disabled'} class="tac-btn w-full py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs">
              ⛽ Convert Infantry → Resupply Hub (4 AP)
            </button>` : ''}
          ${def.category === 'land' ? `
            <div class="grid grid-cols-2 gap-1 pt-0.5">
              <button data-build="major_base" ${canBuild ? '' : 'disabled'} class="tac-btn py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold">Major Base (4 AP)</button>
              <button data-build="minor_base" ${canBuild ? '' : 'disabled'} class="tac-btn py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold">Minor Base (4 AP)</button>
              <button data-build="air_base" ${canBuild ? '' : 'disabled'} class="tac-btn py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold">Air Base (4 AP)</button>
              <button data-build="port" ${canBuild && isNearWater(ent.x, ent.y) ? '' : 'disabled'} class="tac-btn py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold">Port (4 AP)</button>
            </div>` : ''}
        </div>
      ` : ''}
    `;

    if (canMove) {
      document.getElementById('act-move-leg').onclick = () =>
        setMode('MOVE', `CLICK WITHIN RANGE TO CHAIN LEG #${legs + 1} (1 AP)`);
    }
    const hubBtn = document.getElementById('act-convert-hub');
    if (hubBtn && canBuild) {
      hubBtn.onclick = () => queueConstructOrder(ent, 'resupply_hub');
    }
    box.querySelectorAll('[data-build]').forEach(btn => {
      btn.onclick = () => queueConstructOrder(ent, btn.dataset.build);
    });
  } else {
    // Structure Inspector
    const def = STRUCTURE_DEFS[ent.type];
    const canAct = state.phase === 'PLANNING' && isOwn;
    const busy = ent.cooldown > 0 || isFacilityQueued(ent.id, p);
    const canProd = canAct && remAP >= 2 && !busy;

    box.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <span class="font-extrabold text-sm text-slate-100">${def.name} <span class="text-[10px] font-mono-tac text-slate-400">(${def.shape})</span></span>
        <span class="px-1.5 py-0.5 rounded text-[10px] font-mono-tac font-bold bg-slate-800 text-amber-300">HP d${def.hp}</span>
      </div>
      <div class="text-[10px] font-mono-tac mb-1.5 ${busy ? 'text-amber-400' : 'text-emerald-400'}">
        ${ent.cooldown > 0 ? `⏳ Production Cooldown: ${ent.cooldown} turn(s)` : (isFacilityQueued(ent.id, p) ? '📦 Production Queued This Turn' : '✓ Ready for Production / Resupply')}
      </div>
      <p class="text-[11px] text-slate-400 mb-2 leading-snug">${def.notes}</p>
      ${canAct && def.produces.length > 0 ? `
        <div class="text-[10px] font-mono-tac uppercase text-slate-400 mb-1">Produce Unit (2 AP):</div>
        <div class="grid grid-cols-2 gap-1">
          ${def.produces.map(ut => `
            <button data-prod="${ut}" ${canProd ? '' : 'disabled'} class="tac-btn py-1.5 px-1.5 rounded bg-indigo-900/80 hover:bg-indigo-800 text-indigo-100 text-[10px] font-bold">
              + ${UNIT_DEFS[ut].name} (${UNIT_DEFS[ut].prodCooldown}t)
            </button>`).join('')}
        </div>
        ${def.produces.includes('air_def') ? `
          <button id="act-ad-zone" ${canProd ? '' : 'disabled'} class="tac-btn w-full mt-1.5 py-1.5 rounded-lg bg-emerald-800/80 hover:bg-emerald-700 text-emerald-100 text-[11px] font-bold">
            🛡️ Deploy Air Defense in 3" Zone (2 AP)
          </button>` : ''}
      ` : ''}
    `;

    box.querySelectorAll('[data-prod]').forEach(btn => {
      btn.onclick = () => queueProduceOrder(ent, btn.dataset.prod);
    });
    const adBtn = document.getElementById('act-ad-zone');
    if (adBtn && canProd) {
      adBtn.onclick = () => {
        state.pendingAdBaseId = ent.id;
        setMode('DEPLOY_AD_ZONE', 'CLICK LAND WITHIN 3" ESTABLISHED ZONE TO DEPLOY AIR DEFENSE');
      };
    }
  }
}

function renderOrderQueue() {
  const p = state.activePlayer;
  const list = state.orders[p];
  document.getElementById('queue-count').textContent = list.length;
  const el = document.getElementById('order-queue-list');
  if (state.phase !== 'PLANNING') {
    el.innerHTML = '<div class="text-slate-500 italic">Order queue active during Planning Phase.</div>';
    return;
  }
  if (list.length === 0) {
    el.innerHTML = '<div class="text-slate-500 italic">No secret orders queued yet. (4 AP available)</div>';
    return;
  }
  el.innerHTML = list.map((o, idx) => `
    <div class="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-900/80 border border-slate-700/70">
      <span class="truncate text-slate-200">${idx + 1}. ${o.label}</span>
      <span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold flex-shrink-0">${o.cost} AP</span>
    </div>
  `).join('');
}

// --- CANVAS RENDERING ENGINE ---
function drawStar(cx, cy, spikes, outerR, innerR) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.closePath();
}

function drawHeart(cx, cy, size) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.55);
  ctx.bezierCurveTo(cx - size * 1.15, cy - size * 0.2, cx - size * 0.55, cy - size * 1.0, cx, cy - size * 0.3);
  ctx.bezierCurveTo(cx + size * 0.55, cy - size * 1.0, cx + size * 1.15, cy - size * 0.2, cx, cy + size * 0.55);
  ctx.closePath();
}

function drawEntityShape(e, px, py, alpha = 1.0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const fill = pColor(e.owner);
  const dark = pDark(e.owner);
  const s = Math.max(8, ppi * 0.21);

  ctx.fillStyle = fill;
  ctx.strokeStyle = '#090e1a';
  ctx.lineWidth = 2;

  if (e.kind === 'structure') {
    const bs = s * 1.38;
    if (e.type === 'main_base') {
      // Shield
      ctx.beginPath();
      ctx.moveTo(px, py - bs);
      ctx.lineTo(px + bs * 0.85, py - bs * 0.55);
      ctx.lineTo(px + bs * 0.72, py + bs * 0.4);
      ctx.lineTo(px, py + bs);
      ctx.lineTo(px - bs * 0.72, py + bs * 0.4);
      ctx.lineTo(px - bs * 0.85, py - bs * 0.55);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(9, bs * 0.75)}px Inter`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('★', px, py);
    } else if (e.type === 'major_base') {
      // Wheel
      ctx.beginPath(); ctx.arc(px, py, bs * 0.9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = dark; ctx.lineWidth = 2;
      for (let a = 0; a < 4; a++) {
        const ang = (a * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(ang) * bs * 0.8, py - Math.sin(ang) * bs * 0.8);
        ctx.lineTo(px + Math.cos(ang) * bs * 0.8, py + Math.sin(ang) * bs * 0.8);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(px, py, bs * 0.3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    } else if (e.type === 'minor_base') {
      // Disc
      ctx.beginPath(); ctx.arc(px, py, bs * 0.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, bs * 0.38, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (e.type === 'port') {
      // Big Star
      drawStar(px, py, 5, bs * 1.05, bs * 0.48); ctx.fill(); ctx.stroke();
    } else if (e.type === 'air_base') {
      // Big Heart
      drawHeart(px, py, bs * 0.95); ctx.fill(); ctx.stroke();
    } else if (e.type === 'resupply_hub') {
      // Pot shape
      ctx.beginPath();
      ctx.arc(px, py + bs * 0.12, bs * 0.68, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fde68a';
      ctx.fillRect(px - bs * 0.45, py - bs * 0.65, bs * 0.9, bs * 0.28);
      ctx.strokeRect(px - bs * 0.45, py - bs * 0.65, bs * 0.9, bs * 0.28);
    }
  } else {
    // Units
    if (e.type === 'infantry') {
      ctx.fillRect(px - s * 0.72, py - s * 0.72, s * 1.44, s * 1.44);
      ctx.strokeRect(px - s * 0.72, py - s * 0.72, s * 1.44, s * 1.44);
    } else if (e.type === 'specops') {
      // Egg
      ctx.beginPath();
      ctx.ellipse(px, py, s * 0.68, s * 0.92, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    } else if (e.type === 'light_veh') {
      // Small Bead
      ctx.beginPath(); ctx.arc(px, py, s * 0.75, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (e.type === 'heavy_veh') {
      // Big Bead
      ctx.beginPath(); ctx.arc(px, py, s * 1.02, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, s * 0.52, 0, Math.PI * 2); ctx.fillStyle = dark; ctx.fill();
    } else if (e.type === 'air_def') {
      // Beehive
      ctx.beginPath();
      ctx.arc(px, py, s * 0.85, Math.PI, 0);
      ctx.lineTo(px + s * 0.85, py + s * 0.65);
      ctx.lineTo(px - s * 0.85, py + s * 0.65);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px - s * 0.65, py + s * 0.1); ctx.lineTo(px + s * 0.65, py + s * 0.1); ctx.stroke();
    } else if (e.type === 'plane') {
      // Small Heart
      drawHeart(px, py, s * 0.92); ctx.fill(); ctx.stroke();
    } else if (e.type === 'ship') {
      // Small Star
      drawStar(px, py, 5, s * 0.95, s * 0.42); ctx.fill(); ctx.stroke();
    }
  }

  ctx.restore();
}

function renderFrame(now) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  // 1. Map Base (Land)
  const mapPxW = MAP_W * ppi;
  const mapPxH = MAP_H * ppi;
  ctx.fillStyle = '#152232';
  ctx.fillRect(offsetX, offsetY, mapPxW, mapPxH);

  // Setup Outskirts Highlight
  if (state.phase === 'SETUP') {
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
    const m = EDGE_DEPLOY_IN * ppi;
    ctx.fillRect(offsetX, offsetY, mapPxW, m);
    ctx.fillRect(offsetX, offsetY + mapPxH - m, mapPxW, m);
    ctx.fillRect(offsetX, offsetY + m, m, mapPxH - m * 2);
    ctx.fillRect(offsetX + mapPxW - m, offsetY + m, m, mapPxH - m * 2);
    ctx.strokeRect(offsetX + m, offsetY + m, mapPxW - m * 2, mapPxH - m * 2);
    ctx.restore();
  }

  // 2. Water Polygons
  ctx.save();
  ctx.fillStyle = '#0c3556';
  ctx.strokeStyle = '#1e5a88';
  ctx.lineWidth = 2;
  for (const poly of WATER_POLYS) {
    ctx.beginPath();
    poly.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(toPxX(pt.x), toPxY(pt.y));
      else ctx.lineTo(toPxX(pt.x), toPxY(pt.y));
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // 3. Bridges
  ctx.save();
  for (const b of BRIDGES) {
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.fillRect(toPxX(b.x), toPxY(b.y), b.w * ppi, b.h * ppi);
    ctx.strokeRect(toPxX(b.x), toPxY(b.y), b.w * ppi, b.h * ppi);
  }
  ctx.restore();

  // 4. Highways (+1" Road Bonus)
  ctx.save();
  for (const road of ROADS) {
    ctx.beginPath();
    road.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(toPxX(pt.x), toPxY(pt.y));
      else ctx.lineTo(toPxX(pt.x), toPxY(pt.y));
    });
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = Math.max(5, ppi * 0.16);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // 5. Inch Grid & Coordinate Labels
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.13)';
  ctx.lineWidth = 1;
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#64748b';
  for (let x = 0; x <= MAP_W; x++) {
    const px = toPxX(x);
    ctx.beginPath(); ctx.moveTo(px, offsetY); ctx.lineTo(px, offsetY + mapPxH); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(`${x}"`, px, offsetY - 8);
  }
  for (let y = 0; y <= MAP_H; y++) {
    const py = toPxY(y);
    ctx.beginPath(); ctx.moveTo(offsetX, py); ctx.lineTo(offsetX + mapPxW, py); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(`${y}"`, offsetX - 6, py + 3);
  }
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(offsetX, offsetY, mapPxW, mapPxH);
  ctx.restore();

  // 6. Toggleable 3" Established Zones
  if (state.showZones) {
    ctx.save();
    for (const e of state.entities) {
      if (e.kind === 'structure' && STRUCTURE_DEFS[e.type].isBase) {
        ctx.beginPath();
        ctx.arc(toPxX(e.x), toPxY(e.y), ESTABLISHED_ZONE_IN * ppi, 0, Math.PI * 2);
        ctx.fillStyle = e.owner === 1 ? 'rgba(56, 189, 248, 0.05)' : 'rgba(251, 113, 133, 0.05)';
        ctx.fill();
        ctx.strokeStyle = e.owner === 1 ? 'rgba(56, 189, 248, 0.25)' : 'rgba(251, 113, 133, 0.25)';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  // 7. Toggleable Automatic Engagement Radii (Loaded units only)
  if (state.showRanges) {
    ctx.save();
    for (const e of state.entities) {
      if (e.kind === 'unit' && !e.ammoSpent) {
        const rng = UNIT_DEFS[e.type].range * ppi;
        ctx.beginPath();
        ctx.arc(toPxX(e.x), toPxY(e.y), rng, 0, Math.PI * 2);
        ctx.strokeStyle = e.owner === 1 ? 'rgba(56, 189, 248, 0.28)' : 'rgba(251, 113, 133, 0.28)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  // 8. Ruins
  for (const r of state.ruins) {
    const px = toPxX(r.x), py = toPxY(r.y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, Math.max(10, ppi * 0.25), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
    ctx.fill();
    ctx.strokeStyle = r.cooldown === 0 ? '#10b981' : '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = r.cooldown === 0 ? '#34d399' : '#fbbf24';
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(r.cooldown === 0 ? 'FIX' : `${r.cooldown}t`, px, py);
    ctx.restore();
  }

  // 9. Secret Orders Visualization (Active Player Only during Planning)
  if (state.phase === 'PLANNING') {
    const p = state.activePlayer;
    const movesByUnit = new Map();
    for (const o of state.orders[p]) {
      if (o.type === 'MOVE') {
        if (!movesByUnit.has(o.unitId)) movesByUnit.set(o.unitId, []);
        movesByUnit.get(o.unitId).push(o);
      } else if (o.type === 'MISSILE') {
        const tx = toPxX(o.targetX), ty = toPxY(o.targetY);
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(tx, ty, 16, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(tx - 20, ty); ctx.lineTo(tx + 20, ty); ctx.moveTo(tx, ty - 20); ctx.lineTo(tx, ty + 20); ctx.stroke();
        ctx.restore();
      } else if (o.type === 'DEPLOY_AD') {
        const dx = toPxX(o.x), dy = toPxY(o.y);
        ctx.save();
        ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(dx, dy, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }

    // Draw Chained Multi-Action Move Polylines + Waypoint Badges + Ghost Silhouette
    for (const [unitId, legs] of movesByUnit.entries()) {
      const unit = getEntityById(unitId);
      if (!unit) continue;
      ctx.save();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(toPxX(legs[0].fromX), toPxY(legs[0].fromY));
      for (const leg of legs) {
        ctx.lineTo(toPxX(leg.toX), toPxY(leg.toY));
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Numbered Waypoints
      legs.forEach((leg, i) => {
        const wx = toPxX(leg.toX), wy = toPxY(leg.toY);
        ctx.beginPath();
        ctx.arc(wx, wy, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#0f172a';
        ctx.fill();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fde68a';
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${i + 1}`, wx, wy);
      });

      // Ghost Silhouette at Final Planned Destination
      const finalLeg = legs[legs.length - 1];
      drawEntityShape(unit, toPxX(finalLeg.toX), toPxY(finalLeg.toY), 0.42);
      ctx.restore();
    }
  }

  // 10. Entities
  for (const e of state.entities) {
    const px = toPxX(e.x), py = toPxY(e.y);
    if (state.selectedId === e.id) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, Math.max(15, ppi * 0.34), 0, Math.PI * 2);
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }

    drawEntityShape(e, px, py, 1.0);

    // Status Badges
    ctx.save();
    if (e.kind === 'unit') {
      if (e.ammoSpent) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(px + 9, py - 9, 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 7px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('S', px + 9, py - 9);
      }
      if (e.secured) {
        ctx.fillStyle = '#10b981';
        ctx.beginPath(); ctx.arc(px - 9, py - 9, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#022c22'; ctx.font = 'bold 7px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('✓', px - 9, py - 9);
      }
    } else if (e.cooldown > 0) {
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(px + 5, py - 15, 16, 11);
      ctx.fillStyle = '#0f172a'; ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${e.cooldown}t`, px + 13, py - 9.5);
    }
    ctx.restore();
  }

  // 11. Live Movement Range Ring & Inch Ruler for Selected Friendly Unit
  if (state.phase === 'PLANNING') {
    const sel = getEntityById(state.selectedId);
    if (sel && sel.kind === 'unit' && sel.owner === state.activePlayer && getRemainingAP(state.activePlayer) >= 1 && !hasUnitFullTurnOrder(sel.id, state.activePlayer)) {
      const from = getPlannedPos(sel, state.activePlayer);
      const spd = state.hoverMap ? getLegSpeed(sel, from.x, from.y, state.hoverMap.x, state.hoverMap.y) : getLegSpeed(sel, from.x, from.y);
      ctx.save();
      ctx.beginPath();
      ctx.arc(toPxX(from.x), toPxY(from.y), spd * ppi, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (state.hoverMap) {
        const d = distIn(from.x, from.y, state.hoverMap.x, state.hoverMap.y);
        ctx.beginPath();
        ctx.moveTo(toPxX(from.x), toPxY(from.y));
        ctx.lineTo(toPxX(state.hoverMap.x), toPxY(state.hoverMap.y));
        ctx.strokeStyle = d <= spd + 0.05 ? '#34d399' : '#fb7185';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 12. Visual Combat & Resupply Effects
  state.effects = state.effects.filter(fx => now - fx.createdAt < fx.duration);
  for (const fx of state.effects) {
    const p = (now - fx.createdAt) / fx.duration;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p);
    if (fx.type === 'beam') {
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 3.5 * (1 - p * 0.5);
      ctx.beginPath();
      ctx.moveTo(toPxX(fx.x1), toPxY(fx.y1));
      ctx.lineTo(toPxX(fx.x2), toPxY(fx.y2));
      ctx.stroke();
    } else if (fx.type === 'boom') {
      ctx.beginPath();
      ctx.arc(toPxX(fx.x), toPxY(fx.y), 6 + p * 28, 0, Math.PI * 2);
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (fx.type === 'text') {
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#090e1a';
      ctx.fillText(fx.text, toPxX(fx.x) + 1, toPxY(fx.y) - p * 22 + 1);
      ctx.fillStyle = fx.color;
      ctx.fillText(fx.text, toPxX(fx.x), toPxY(fx.y) - p * 22);
    }
    ctx.restore();
  }

  requestAnimationFrame(renderFrame);
}

// --- RESET GAME ---
function resetCampaign() {
  state.phase = 'SETUP';
  state.setupStep = 0;
  state.turn = 1;
  state.activePlayer = 1;
  state.missiles = { 1: 6, 2: 6 };
  state.orders = { 1: [], 2: [] };
  state.entities = [];
  state.ruins = [];
  state.selectedId = null;
  state.mode = 'IDLE';
  state.effects = [];
  state.stats = { kills: { 1: 0, 2: 0 }, missilesFired: { 1: 0, 2: 0 } };
  document.getElementById('victory-modal').classList.add('hidden');
  document.getElementById('resolution-banner').classList.add('hidden');
  document.getElementById('setup-banner').classList.remove('hidden');
  document.getElementById('combat-log').innerHTML = '';
  addLog('New v2.1 WEGO campaign initialized. Deploy 2 Original Main Bases per player.', 'amber');
  updateUI();
}

// --- EVENT LISTENERS ---
window.addEventListener('resize', resizeCanvas);
canvas.addEventListener('click', handleCanvasClick);
canvas.addEventListener('mousemove', handleCanvasMove);

document.getElementById('btn-auto-deploy').addEventListener('click', autoDeploySetup);
document.getElementById('btn-lock-orders').addEventListener('click', lockActivePlayerOrders);
document.getElementById('btn-next-turn').addEventListener('click', beginNextTurn);
document.getElementById('btn-undo-order').addEventListener('click', undoLastOrder);
document.getElementById('btn-clear-orders').addEventListener('click', clearAllOrders);
document.getElementById('btn-cancel-mode').addEventListener('click', () => setMode('IDLE'));
document.getElementById('btn-play-again').addEventListener('click', resetCampaign);
document.getElementById('btn-clear-log').addEventListener('click', () => {
  document.getElementById('combat-log').innerHTML = '';
});

document.getElementById('btn-launch-missile').addEventListener('click', () => {
  if (state.phase === 'PLANNING') {
    setMode('MISSILE', 'SELECT ENEMY TARGET FOR MISSILE STRIKE (1 AP, CANNOT HIT MAIN BASES)');
  }
});

document.getElementById('btn-toggle-zones').addEventListener('click', (e) => {
  state.showZones = !state.showZones;
  e.target.textContent = `Zones: ${state.showZones ? 'ON' : 'OFF'}`;
});

document.getElementById('btn-toggle-ranges').addEventListener('click', (e) => {
  state.showRanges = !state.showRanges;
  e.target.textContent = `Engage: ${state.showRanges ? 'ON' : 'OFF'}`;
});

document.getElementById('btn-toggle-sound').addEventListener('click', (e) => {
  SFX.enabled = !SFX.enabled;
  e.target.textContent = SFX.enabled ? '🔊' : '🔇';
});

document.getElementById('btn-rules').addEventListener('click', () => {
  document.getElementById('rules-modal').classList.remove('hidden');
});
document.getElementById('btn-close-rules').addEventListener('click', () => {
  document.getElementById('rules-modal').classList.add('hidden');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    setMode('IDLE');
    document.getElementById('rules-modal').classList.add('hidden');
  }
});

// --- BOOT ---
resizeCanvas();
addLog('Welcome to <strong>Tactical Map War Game v2.1</strong> (WEGO, Auto-Engage & Multi-Action). Place Main Bases or click Quick Auto-Deploy.', 'amber');
updateUI();
requestAnimationFrame(renderFrame);
