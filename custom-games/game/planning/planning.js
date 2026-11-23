    // Planning, orders, fog of war, setup, and player handoff.
    // --- AP & ORDER QUEUE HELPERS ---
    function getMaxAP(turn = state.turn) {
      return MAX_AP + Math.floor(Math.max(0, turn - 1) / AP_GAIN_INTERVAL);
    }

    function getLinearScaling(player, turn = 1, maxTurns = 15, baseUnits = 3) {
      const progress = Math.max(0, Math.min(1, (turn - 1) / Math.max(1, maxTurns - 1)));
      const ownUnitCount = state.entities.filter(e => e.kind === 'unit' && e.owner === player).length;
      const extraUnits = Math.max(0, ownUnitCount - baseUnits);
      return {
        progress, extraUnits,
        cooldownReduction: Math.min(1, Math.floor(progress * 2)),
        unitCountAtkBonus: Math.floor(extraUnits / 5),
        progressAtkBonus: Math.floor(progress * 2),
        moveSpeedScale: 1 + progress * 0.2
      };
    }

    function getPlanningTurn() {
      return state.phase === 'PLANNING' && !state.planCurrent
        ? state.turn + state.planTurnOffset : state.turn;
    }

    function allQueuedOrders(player) {
      return [...state.orders[player].map(o => ({ order: o, turn: state.turn })),
        ...state.futurePlans[player].map(o => ({ order: o, turn: o.targetTurn }))]
        .sort((a, b) => a.turn - b.turn || a.order.id - b.order.id);
    }

    function selectAutomaticTurn(player, type, cost, unit = null, base = null, earliest = state.turn) {
      const queued = allQueuedOrders(player).filter(x => !x.order.invalid);
      const related = queued.filter(({ order }) =>
        (unit && order.unitId === unit.id) ||
        (base && (order.baseId === base.id || order.unitId === base.id)) ||
        (type === 'MISSILE' && order.type === 'MISSILE'));
      let turn = related.length ? Math.max(earliest, state.turn, related[related.length - 1].turn) : Math.max(earliest, state.turn);
      if (unit && unit.ammoSpent && ['ENGAGE', 'BARRAGE', 'DRONE'].includes(type)) turn = Math.max(turn, state.turn + 1);
      if (unit && type === 'CONSTRUCT') {
        if (!unit.secured) turn = Math.max(turn, state.turn + 1);
        for (const entry of queued) {
          if (entry.order.unitId === unit.id && entry.order.type === 'MOVE') {
            turn = Math.max(turn, entry.turn + 2);
          }
        }
      }
      if (base) {
        turn = Math.max(turn, state.turn + base.cooldown);
        for (const entry of queued) {
          if (entry.order.baseId === base.id && (entry.order.type === 'PRODUCE' || entry.order.type === 'DEPLOY_AD')) {
            const produced = entry.order.type === 'DEPLOY_AD' ? 'air_def' : entry.order.unitType;
            const cooldown = Math.max(1, UNIT_DEFS[produced].prodCooldown -
              getLinearScaling(player, entry.turn).cooldownReduction);
            turn = Math.max(turn, entry.turn + cooldown + 1);
          }
        }
      }
      while (true) {
        const orders = getOrdersForTurn(player, turn);
        const full = getQueuedAP(player, turn) + cost > getMaxAP(turn);
        const conflict = unit && orders.some(o => o.unitId === unit.id &&
          ((type === 'MOVE' && (o.type === 'MOVE' || o.type === 'BARRAGE' || o.type === 'CONSTRUCT' || o.type === 'REPAIR_UNIT')) ||
           (type === 'BARRAGE' && (o.type === 'MOVE' || o.type === 'BARRAGE')) ||
           ((type === 'CONSTRUCT' || type === 'REPAIR_UNIT') && (o.type === 'MOVE' || o.type === 'CONSTRUCT' || o.type === 'REPAIR_UNIT')) ||
           (type === 'DRONE' && (o.type === 'DRONE' || o.type === 'ENGAGE')) ||
           (type === 'ENGAGE' && o.type === 'DRONE')));
        if (!full && !conflict) break;
        turn++;
      }
      state.planCurrent = turn === state.turn;
      if (!state.planCurrent) state.planTurnOffset = turn - state.turn;
      return turn;
    }

    function resetPlanningTurn() {
      state.planCurrent = true;
    }

    function getOrdersForTurn(player, turn = getPlanningTurn()) {
      return turn === state.turn ? state.orders[player] :
        state.futurePlans[player].filter(o => o.targetTurn === turn && !o.invalid);
    }

    function getQueuedAP(player, turn = getPlanningTurn()) {
      return getOrdersForTurn(player, turn).reduce((sum, o) => sum + o.cost, 0);
    }

    function getRemainingAP(player, turn = getPlanningTurn()) {
      if (netActive() && NET.locked[player]) return 0;
      return Math.max(0, getMaxAP(turn) - getQueuedAP(player, turn));
    }

    function queueFutureOrder(player, targetTurn, orderSpec) {
      if (targetTurn <= state.turn || getQueuedAP(player, targetTurn) + orderSpec.cost > getMaxAP(targetTurn)) {
        showToast('Not enough AP for that future turn.', 'warn');
        return false;
      }
      if (orderSpec.type === 'MOVE' &&
          (orderSpec.cost !== MOVE_AP_COST || hasUnitMovedThisTurn(orderSpec.unitId, player, targetTurn))) {
        showToast('A unit can only schedule one free move per turn.', 'warn');
        return false;
      }
      const { id, targetTurn: ignoredTurn, ...spec } = orderSpec;
      state.futurePlans[player].push({ ...spec, id: nextOrderId++, targetTurn });
      return true;
    }

    function addPlanningOrder(player, order) {
      const turn = getPlanningTurn();
      if (turn > state.turn) return queueFutureOrder(player, turn, order);
      state.orders[player].push({ ...order, id: nextOrderId++ });
      return true;
    }

    function getProjectedPosAtTurn(unit, player, upToTurn) {
      let pos = { x: unit.x, y: unit.y };
      for (const o of state.orders[player]) {
        if (o.type === 'MOVE' && o.unitId === unit.id) pos = { x: o.toX, y: o.toY };
      }
      const moves = state.futurePlans[player].filter(o => o.type === 'MOVE' && o.unitId === unit.id &&
        !o.invalid && o.targetTurn > state.turn && o.targetTurn <= upToTurn)
        .sort((a, b) => a.targetTurn - b.targetTurn || a.id - b.id);
      for (const o of moves) pos = { x: o.toX, y: o.toY };
      return pos;
    }

    function getQueuedMissileCount(player) {
      return getOrdersForTurn(player).filter(o => o.type === 'MISSILE').length;
    }

    function getAvailableMissiles(player) {
      const reserved = state.orders[player].filter(o => o.type === 'MISSILE').length +
        state.futurePlans[player].filter(o => o.type === 'MISSILE').length;
      return Math.max(0, state.missiles[player] - reserved);
    }

    function getUnitMoveOrders(unitId, player) {
      return getOrdersForTurn(player).filter(o => o.type === 'MOVE' && o.unitId === unitId);
    }

    function hasUnitMovedThisTurn(unitId, player, turn = getPlanningTurn()) {
      return getOrdersForTurn(player, turn).filter(o => o.type === 'MOVE' && o.unitId === unitId).length >=
        MAX_MOVES_PER_UNIT_PER_TURN;
    }

    function getPlannedPos(entity, player) {
      if (entity.kind !== 'unit') return { x: entity.x, y: entity.y };
      return getProjectedPosAtTurn(entity, player, getPlanningTurn());
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
      return spd * getLinearScaling(unit.owner, getPlanningTurn()).moveSpeedScale;
    }

    function isFacilityQueued(baseId, player) {
      return getOrdersForTurn(player).some(o => (o.type === 'PRODUCE' || o.type === 'DEPLOY_AD') && o.baseId === baseId);
    }

    function hasUnitFullTurnOrder(unitId, player) {
      return getOrdersForTurn(player).some(o =>
        (o.type === 'CONSTRUCT' || o.type === 'REPAIR_UNIT') && o.unitId === unitId
      );
    }

    // --- ENGAGE ORDERS & FOG OF WAR ---
    function hasEngageOrder(unitId, player) {
      return state.standingEngage[player].some(o => o.unitId === unitId);
    }

    function toggleEngageOrder(unit) {
      const p = state.activePlayer;
      if (state.phase !== 'PLANNING' || unit.owner !== p || UNIT_DEFS[unit.type].atk <= 0 ||
          UNIT_DEFS[unit.type].indirectFire || (netActive() && NET.locked[p])) return;
      const current = state.standingEngage[p].find(o => o.unitId === unit.id);
      if (current) {
        removeQueuedOrder(p, current.id);
      } else {
        state.standingEngage[p].push({
          id: nextOrderId++, type: 'ENGAGE', cost: ENGAGE_AP_COST, unitId: unit.id,
          label: `${UNIT_DEFS[unit.type].name} ENGAGE (until canceled)`
        });
      }
      SFX.play('click');
      resetPlanningTurn();
      updateUI();
    }

    function materializeStandingEngage(player) {
      for (const order of state.standingEngage[player]) {
        const unit = getEntityById(order.unitId);
        if (!unit || unit.kind !== 'unit' || unit.owner !== player) continue;
        if (state.orders[player].some(o => o.unitId === unit.id && (o.type === 'DRONE' || o.type === 'ENGAGE'))) continue;
        state.orders[player].push({ ...order, id: nextOrderId++, standingOrder: true });
      }
    }

    function queueBarrage(unit, x, y) {
      const p = state.activePlayer;
      const def = UNIT_DEFS[unit.type];
      selectAutomaticTurn(p, 'BARRAGE', def.actionCost, unit);
      if (state.phase !== 'PLANNING' || unit.owner !== p || !def.indirectFire ||
          (unit.ammoSpent && getPlanningTurn() === state.turn) || (netActive() && NET.locked[p])) return;
      if (getOrdersForTurn(p).some(o => o.type === 'BARRAGE' && o.unitId === unit.id)) {
        showToast('This artillery unit already has a barrage order.', 'warn');
        return;
      }
      if (getUnitMoveOrders(unit.id, p).length > 0) {
        showToast('Artillery cannot move and barrage in the same turn.', 'warn');
        return;
      }
      if (getRemainingAP(p) < def.actionCost) {
        showToast(`Barrage requires ${def.actionCost} AP.`, 'warn');
        return;
      }
      const from = getPlannedPos(unit, p);
      const distance = distIn(from.x, from.y, x, y);
      if (distance < def.minRange || distance > def.range + 0.03) {
        showToast(`Barrage must target ${def.minRange}"–${def.range}" from the final position.`, 'warn');
        return;
      }
      addPlanningOrder(p, {
        type: 'BARRAGE', cost: def.actionCost, unitId: unit.id, x, y,
        label: `Artillery barrage → (${x.toFixed(1)}", ${y.toFixed(1)}")`
      });
      setMode('IDLE');
    }

    function queueDrone(unit, x, y) {
      const p = state.activePlayer;
      const def = UNIT_DEFS[unit.type];
      selectAutomaticTurn(p, 'DRONE', def.actionCost, unit);
      if (state.phase !== 'PLANNING' || unit.owner !== p || !def.droneRange ||
          (unit.ammoSpent && getPlanningTurn() === state.turn) || (netActive() && NET.locked[p])) return;
      if (getRemainingAP(p) < def.actionCost) {
        showToast(`Launching a drone requires ${def.actionCost} AP.`, 'warn');
        return;
      }
      if (getOrdersForTurn(p).some(o => o.unitId === unit.id && (o.type === 'DRONE' || o.type === 'ENGAGE'))) {
        showToast('This operator already has a drone or engagement order.', 'warn');
        return;
      }
      const from = getPlannedPos(unit, p);
      if (distIn(from.x, from.y, x, y) > def.droneRange + 0.03) {
        showToast(`Drone must be deployed within ${def.droneRange}" of the operator.`, 'warn');
        return;
      }
      addPlanningOrder(p, {
        type: 'DRONE', cost: def.actionCost, unitId: unit.id, x, y,
        label: `Drone → (${x.toFixed(1)}", ${y.toFixed(1)}")`
      });
      setMode('IDLE');
    }

    function queueRoadblock(unit, x1, y1, x2, y2) {
      const p = state.activePlayer;
      const def = UNIT_DEFS.roadblock;
      selectAutomaticTurn(p, 'ROADBLOCK', def.actionCost, unit);
      if (state.phase !== 'PLANNING' || unit.owner !== p || UNIT_DEFS[unit.type].category !== 'land' ||
          unit.type === 'roadblock' || (netActive() && NET.locked[p])) return;
      if (getRemainingAP(p) < def.actionCost) {
        showToast(`Roadblock requires ${def.actionCost} AP.`, 'warn');
        return;
      }
      const from = getPlannedPos(unit, p);
      if (distIn(from.x, from.y, x1, y1) > RESUPPLY_TOUCH_IN + 1e-9) {
        showToast('The first endpoint must be within 0.62" of the unit.', 'warn');
        return;
      }
      const length = distIn(x1, y1, x2, y2);
      if (length < 0.01 || length > def.maxBarrierLength + 1e-9) {
        showToast(`Choose a second endpoint no more than ${def.maxBarrierLength}" away.`, 'warn');
        return;
      }
      addPlanningOrder(p, {
        type: 'ROADBLOCK', cost: def.actionCost, unitId: unit.id, x1, y1, x2, y2,
        label: `Roadblock → (${x1.toFixed(1)}", ${y1.toFixed(1)}")–(${x2.toFixed(1)}", ${y2.toFixed(1)}")`
      });
      setMode('IDLE');
    }

    function isValidBridge(from, x, y, maxSpan) {
      if (distIn(from.x, from.y, x, y) > maxSpan + 0.03 ||
          distIn(from.x, from.y, x, y) < 0.12 ||
          !isLandForUnit(from.x, from.y) || !isLandForUnit(x, y) || isBuildingAt(x, y)) return false;
      let touchesWater = false;
      for (let i = 1; i < 40; i++) {
        const t = i / 40, sx = from.x + (x - from.x) * t, sy = from.y + (y - from.y) * t;
        if (isBuildingAt(sx, sy)) return false;
        if (isPointInWater(sx, sy)) touchesWater = true;
      }
      return touchesWater;
    }

    function queueBridge(unit, x, y) {
      const p = state.activePlayer, def = UNIT_DEFS[unit.type];
      selectAutomaticTurn(p, 'BRIDGE', def.actionCost, unit);
      if (state.phase !== 'PLANNING' || unit.owner !== p || !def.maxBridgeSpan ||
          (netActive() && NET.locked[p])) return;
      if (getRemainingAP(p) < def.actionCost) {
        showToast(`Bridge deployment requires ${def.actionCost} AP.`, 'warn');
        return;
      }
      if (!isValidBridge(getPlannedPos(unit, p), x, y, def.maxBridgeSpan)) {
        showToast(`Choose land across water within ${def.maxBridgeSpan}" of the bridgelayer.`, 'warn');
        return;
      }
      addPlanningOrder(p, {
        type: 'BRIDGE', cost: def.actionCost, unitId: unit.id, x, y,
        label: `Pontoon bridge → (${x.toFixed(1)}", ${y.toFixed(1)}")`
      });
      setMode('IDLE');
    }

    // Hot-seat resolution starts from the last planning player's perspective.
    function fogViewer() {
      if (netActive()) return NET.role;
      return state.phase === 'SETUP' ? null : state.activePlayer;
    }

    // Enemy units are revealed only inside a friendly unit's engagement range (or a friendly base zone).
    function isEntityVisible(e, viewer = fogViewer(), entities = state.entities, destroyedBuildings = state.destroyedBuildings, drones = state.drones) {
      if (viewer === null || e.owner === viewer || e.kind === 'structure') return true;
      if (e.submerged) {
        return entities.some(f => f.owner === viewer && f.kind === 'unit' &&
          (UNIT_DEFS[f.type].sonarRange || UNIT_DEFS[f.type].startsSubmerged) &&
          distIn(f.x, f.y, e.x, e.y) <= (UNIT_DEFS[f.type].sonarRange || UNIT_DEFS[f.type].range) + 0.03);
      }
      if (drones.some(d => d.owner === viewer && distanceToEntity(d.x, d.y, e) <= d.revealRange + 0.03)) return true;
      if (e.kind === 'unit' && UNIT_DEFS[e.type].canEnterBuilding && state.customMap) {
        const cell = getCustomCellAt(e.x, e.y, destroyedBuildings);
        if (cell.type === 'B') {
          if (entities.some(f => f.kind === 'unit' && f.owner === viewer &&
              UNIT_DEFS[f.type].canEnterBuilding &&
              getCustomCellAt(f.x, f.y, destroyedBuildings)?.idx === cell.idx)) return true;
          if (e.revealedBuilding !== cell.idx) return false;
        }
      }
      return entities.some(f => f.owner === viewer &&
        distanceToEntity(f.x, f.y, e) <= (f.kind === 'unit'
          ? unitEngagementRange(f, destroyedBuildings) : ESTABLISHED_ZONE_IN) + 0.03);
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

    function addLog(msg, tone = 'slate', entities = []) {
      const viewer = fogViewer();
      const privateEntry = viewer !== null && entities.some(e => e.kind === 'unit');
      const viewers = privateEntry
        ? (netActive() || state.phase !== 'RESOLVING' ? [viewer] : [1, 2])
            .filter(p => entities.every(e => isEntityVisible(e, p)))
        : [];
      if (privateEntry && viewers.length === 0) return;
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
      if (privateEntry) {
        entry.dataset.viewers = viewers.join(',');
        entry.hidden = !viewers.includes(viewer);
      }
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
        cooldown: 0,
        submerged: !!def.startsSubmerged,
        resupplyCharges: def.maxResupplyCharges || 0,
        reserveAmmo: 0,
        idleResupplyTurns: 0,
        buildingEnteredTurn: null,
        buildingBreacher: null,
        secured: false
      };
      state.entities.push(ent);
      return ent;
    }

    function findSpawnPointNear(base, unitType) {
      const cat = UNIT_DEFS[unitType].category;
      const radii = [0.85, 1.3, 1.85, 2.5, 3.2, 4.2];
      for (const r of radii) {
        for (let i = 0; i < 20; i++) {
          const ang = (i / 20) * Math.PI * 2;
          const sx = Math.max(0.5, Math.min(MAP_W - 0.5, base.x + Math.cos(ang) * r));
          const sy = Math.max(0.5, Math.min(MAP_H - 0.5, base.y + Math.sin(ang) * r));
          const terrainOk = cat === 'air'
            ? (base.kind === 'unit' && UNIT_DEFS[base.type].canProduceAir ? isWaterForShip(sx, sy) : true)
            : (cat === 'sea' ? isWaterForShip(sx, sy) : isLandForUnit(sx, sy));
          if (!terrainOk) continue;
          const crowded = state.entities.some(e => distIn(e.x, e.y, sx, sy) < 0.65);
          if (!crowded) return { x: sx, y: sy };
        }
      }
      if (cat === 'sea' || (base.kind === 'unit' && UNIT_DEFS[base.type].canProduceAir)) return null;
      return { x: Math.max(0.6, Math.min(MAP_W - 0.6, base.x + 0.7)), y: base.y };
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

    // --- SETUP PHASE & SMART AUTO-DEPLOY ---
    function getSetupPlayer() {
      return (state.setupStep % 2 === 0) ? 1 : 2;
    }

    function handleSetupClick(mx, my) {
      if (!isWithinOutskirts(mx, my)) {
        showToast(`Main Bases must be placed within ${EDGE_DEPLOY_IN.toFixed(1)}" of the map edge!`, 'warn');
        SFX.play('miss');
        return;
      }
      if (isBuildingAt(mx, my)) {
        showToast('Cannot deploy Main Base on an impassable Building (B) tile!', 'danger');
        SFX.play('miss');
        return;
      }
      if (!isLandForBase(mx, my)) {
        showToast('Main Bases must be placed on dry land!', 'warn');
        SFX.play('miss');
        return;
      }
      if (state.entities.some(e => distIn(e.x, e.y, mx, my) < 2.2)) {
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

    function findSmartOutskirtsSpot(region, existingSpots) {
      const step = 0.6;
      const valid = [];

      for (let x = region.x0; x <= region.x1; x += step) {
        for (let y = region.y0; y <= region.y1; y += step) {
          if (!isWithinOutskirts(x, y) || !isLandForBase(x, y)) continue;
          const tooClose = existingSpots.some(s => distIn(s.x, s.y, x, y) < 3.0) ||
            state.entities.some(e => distIn(e.x, e.y, x, y) < 3.0);
          if (tooClose) continue;
          valid.push({ x, y });
        }
      }

      if (valid.length === 0) return null;
      const cx = (region.x0 + region.x1) / 2;
      const cy = (region.y0 + region.y1) / 2;
      valid.sort((a, b) => distIn(a.x, a.y, cx, cy) - distIn(b.x, b.y, cx, cy));
      return valid[0];
    }

    function autoDeploySetup() {
      if (state.phase !== 'SETUP') return;

      if (!state.customMap) {
        const spots = [
          { owner: 1, x: 4.0, y: 8.8 },
          { owner: 2, x: 64.0, y: 8.8 },
          { owner: 1, x: 4.0, y: 35.2 },
          { owner: 2, x: 64.0, y: 35.2 }
        ];
        while (state.setupStep < 4) {
          const s = spots[state.setupStep];
          spawnStructure(s.owner, 'main_base', s.x, s.y, true);
          state.setupStep++;
        }
      } else {
        // Smart Custom Map Auto-Deploy: opposite edges on walkable G/R land (never B or W)
        const wide = MAP_W >= MAP_H;
        const m = EDGE_DEPLOY_IN - 0.8;
        const regions = wide
          ? [
              { owner: 1, x0: 0.8, x1: m, y0: 1.0, y1: MAP_H * 0.45 },
              { owner: 2, x0: MAP_W - m, x1: MAP_W - 0.8, y0: 1.0, y1: MAP_H * 0.45 },
              { owner: 1, x0: 0.8, x1: m, y0: MAP_H * 0.55, y1: MAP_H - 1.0 },
              { owner: 2, x0: MAP_W - m, x1: MAP_W - 0.8, y0: MAP_H * 0.55, y1: MAP_H - 1.0 }
            ]
          : [
              { owner: 1, x0: 1.0, x1: MAP_W * 0.46, y0: 0.8, y1: m },
              { owner: 2, x0: 1.0, x1: MAP_W * 0.46, y0: MAP_H - m, y1: MAP_H - 0.8 },
              { owner: 1, x0: MAP_W * 0.54, x1: MAP_W - 1.0, y0: 0.8, y1: m },
              { owner: 2, x0: MAP_W * 0.54, x1: MAP_W - 1.0, y0: MAP_H - m, y1: MAP_H - 0.8 }
            ];

        const chosenSpots = [];
        while (state.setupStep < 4) {
          const reg = regions[state.setupStep];
          let pt = findSmartOutskirtsSpot(reg, chosenSpots);
          if (!pt) {
            pt = findSmartOutskirtsSpot({ x0: 0.8, x1: MAP_W - 0.8, y0: 0.8, y1: MAP_H - 0.8 }, chosenSpots);
          }
          if (!pt) {
            showToast(`Could not find enough open Ground/Road land in ${EDGE_DEPLOY_IN.toFixed(1)}" outskirts for auto-deploy.`, 'danger');
            return;
          }
          chosenSpots.push(pt);
          spawnStructure(reg.owner, 'main_base', pt.x, pt.y, true);
          state.setupStep++;
        }
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
      addLog(`<strong>CAMPAIGN STARTED (v2.2 WEGO):</strong> Player 1 (Blue), queue up to ${getMaxAP()} AP of secret orders!`, 'amber');
      showToast('Deployment Complete! Player 1 (Blue): Queue your secret orders.', 'success');
      updateUI();
      netMaybeAutoPass();
    }

    // --- MODE MANAGEMENT ---
    function setMode(newMode, bannerText = '') {
      state.mode = newMode;
      if (newMode === 'IDLE') resetPlanningTurn();
      if (newMode !== 'DEPLOY_AD_ZONE') state.pendingAdBaseId = null;
      if (newMode !== 'ROADBLOCK_END') state.pendingRoadblockStart = null;
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
    function queueMoveLeg(unit, toX, toY, automatic = true) {
      const p = state.activePlayer;
      if (state.phase !== 'PLANNING' || unit.owner !== p || (netActive() && NET.locked[p])) return false;
      if (automatic) selectAutomaticTurn(p, 'MOVE', MOVE_AP_COST, unit);
      if (hasUnitMovedThisTurn(unit.id, p)) {
        showToast('This unit already has a move queued for this turn.', 'warn');
        return false;
      }
      if (hasUnitFullTurnOrder(unit.id, p)) {
        showToast('This unit already has a 4 AP order queued!', 'warn');
        SFX.play('miss');
        return false;
      }

      const from = getPlannedPos(unit, p);
      const def = UNIT_DEFS[unit.type];
      if (buildingMoveWait(unit, from.x, from.y, toX, toY, getPlanningTurn())) {
        if (!automatic) {
          showToast('A high-rise requires an interior staging turn before exit.', 'warn');
          return false;
        }
        selectAutomaticTurn(p, 'MOVE', MOVE_AP_COST, unit, null, getPlanningTurn() + 1);
      }
      if (def.indirectFire && getOrdersForTurn(p).some(o => o.type === 'BARRAGE' && o.unitId === unit.id)) {
        showToast('Artillery cannot move and barrage in the same turn.', 'warn');
        return false;
      }
      if (def.speed <= 0) {
        showToast('This unit cannot move.', 'warn');
        return false;
      }

      if (def.category === 'land') {
        const trace = traceLandPath(from.x, from.y, toX, toY, !!def.canEnterBuilding, unit, true);
        if (trace.blocked) {
          if (trace.reason === 'ROADBLOCK') {
            showToast('A roadblock blocks this land unit.', 'warn');
          } else if (trace.reason === 'BUILDING') {
            showToast('Path blocked by buildings! Route around city blocks.', 'danger');
          } else {
            showToast('Land units cannot cross water without a road or bridge!', 'warn');
          }
          SFX.play('miss');
          return false;
        }
      } else if (def.category === 'sea') {
        const trace = traceSeaPath(from.x, from.y, toX, toY);
        if (trace.blocked) {
          showToast('Ships can only navigate through open water!', 'warn');
          SFX.play('miss');
          return false;
        }
      }

      const maxSpd = getLegSpeed(unit, from.x, from.y, toX, toY);
      const d = distIn(from.x, from.y, toX, toY);
      if (d < 0.12 && !buildingTransition(from.x, from.y, toX, toY)) {
        showToast('Choose a destination further from current waypoint.', 'warn');
        return false;
      }
      if (d > maxSpd + 0.05) {
        showToast(`Exceeds leg range (${d.toFixed(2)}" > ${maxSpd.toFixed(1)}"). Click closer!`, 'warn');
        SFX.play('miss');
        return false;
      }

      const legIndex = getUnitMoveOrders(unit.id, p).length + 1;
      const roadBonus = def.category === 'land' && segmentTouchesRoad(from.x, from.y, toX, toY);
      addPlanningOrder(p, {
        type: 'MOVE',
        cost: MOVE_AP_COST,
        unitId: unit.id,
        legIndex,
        fromX: from.x,
        fromY: from.y,
        toX,
        toY,
        roadBonus,
        label: `${def.name} Move → (${toX.toFixed(1)}", ${toY.toFixed(1)}")${roadBonus ? ' [ROAD +1"]' : ''}`
      });
      SFX.play('move');

      if (automatic && state.mode === 'MOVE') {
        setMode('IDLE');
      } else {
        if (automatic) resetPlanningTurn();
        updateUI();
      }
      return true;
    }

    function queueMissileOrder(x, y) {
      const p = state.activePlayer;
      if (state.phase !== 'PLANNING' || (netActive() && NET.locked[p])) return;
      selectAutomaticTurn(p, 'MISSILE', MISSILE_AP_COST);
      if (getRemainingAP(p) < MISSILE_AP_COST) {
        showToast(`Missile strike requires ${MISSILE_AP_COST} AP.`, 'warn');
        return;
      }
      if (getAvailableMissiles(p) < 1) {
        showToast('No Missiles remaining in stockpile!', 'warn');
        return;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > MAP_W || y < 0 || y > MAP_H) {
        showToast('Choose a target within the map.', 'warn');
        return;
      }
      addPlanningOrder(p, {
        type: 'MISSILE',
        cost: MISSILE_AP_COST,
        targetX: x,
        targetY: y,
        label: `🚀 Missile Strike → (${x.toFixed(1)}", ${y.toFixed(1)}")`
      });
      SFX.play('lock');
      setMode('IDLE');
      showToast('Missile strike queued. The blast can hit both sides.', 'warn');
    }

    function queueProduceOrder(base, unitType) {
      const p = state.activePlayer;
      if (state.phase !== 'PLANNING' || base.owner !== p || (netActive() && NET.locked[p])) return false;
      if (facilityQueueCount(base.id, p) >= MAX_FACILITY_QUEUE) {
        showToast(`This facility already has ${MAX_FACILITY_QUEUE} production orders.`, 'warn');
        return false;
      }
      selectAutomaticTurn(p, 'PRODUCE', 2, null, base);
      if (!PLAYABLE_UNITS.has(unitType)) {
        showToast('This unit is not available until its mechanics are implemented.', 'warn');
        return false;
      }
      const produces = base.kind === 'unit'
        ? (UNIT_DEFS[base.type].canProduceAir ? ['plane', 'strategic_bomber'] : [])
        : STRUCTURE_DEFS[base.type].produces;
      if (!produces.includes(unitType)) {
        showToast('This facility cannot produce that unit.', 'warn');
        return false;
      }
      if (getRemainingAP(p) < 2) {
        showToast('Need 2 AP to produce a unit!', 'warn');
        return false;
      }
      if ((base.cooldown > 0 && getPlanningTurn() === state.turn) || isFacilityQueued(base.id, p)) {
        showToast('This facility is on cooldown or already producing!', 'warn');
        return false;
      }
      const def = UNIT_DEFS[unitType];
      const baseName = base.kind === 'unit' ? UNIT_DEFS[base.type].name : STRUCTURE_DEFS[base.type].name;
      addPlanningOrder(p, {
        type: 'PRODUCE',
        cost: 2,
        baseId: base.id,
        unitType,
        label: `🏭 Produce ${def.name} at ${baseName} (${def.prodCooldown}t CD)`
      });
      SFX.play('click');
      resetPlanningTurn();
      updateUI();
      return true;
    }

    function facilityQueueCount(baseId, player) {
      return allQueuedOrders(player).filter(({ order }) =>
        order.baseId === baseId && (order.type === 'PRODUCE' || order.type === 'DEPLOY_AD')).length;
    }

    function fillProductionQueue(base, unitType) {
      let added = 0;
      while (facilityQueueCount(base.id, state.activePlayer) < MAX_FACILITY_QUEUE) {
        if (!queueProduceOrder(base, unitType)) break;
        added++;
      }
      if (added) showToast(`Queued ${added} production order(s).`, 'success');
    }

    function queueDeployAdZone(base, x, y) {
      const p = state.activePlayer;
      if (facilityQueueCount(base.id, p) >= MAX_FACILITY_QUEUE) {
        showToast(`This facility already has ${MAX_FACILITY_QUEUE} production orders.`, 'warn');
        return;
      }
      selectAutomaticTurn(p, 'DEPLOY_AD', 2, null, base);
      if (getRemainingAP(p) < 2) {
        showToast('Need 2 AP to deploy Air Defense!', 'warn');
        return;
      }
      if (isBuildingAt(x, y)) {
        showToast('Cannot deploy Air Defense on an impassable Building (B) tile!', 'danger');
        SFX.play('miss');
        return;
      }
      if (!isLandForUnit(x, y)) {
        showToast('Air Defense must be deployed on open land or roads!', 'warn');
        SFX.play('miss');
        return;
      }
      if (distIn(x, y, base.x, base.y) > ESTABLISHED_ZONE_IN) {
        showToast('Must deploy within the 3" Established Zone of this Base!', 'warn');
        return;
      }
      addPlanningOrder(p, {
        type: 'DEPLOY_AD',
        cost: 2,
        baseId: base.id,
        x, y,
        label: `🛡️ Deploy Air Defense in 3" Zone (${x.toFixed(1)}", ${y.toFixed(1)}")`
      });
      SFX.play('lock');
      setMode('IDLE');
    }

    function secondaryBaseCount(player, includeQueued = false) {
      let count = state.entities.filter(e => e.kind === 'structure' && e.owner === player &&
        SECONDARY_BASE_TYPES.has(e.type)).length;
      if (includeQueued) {
        count += allQueuedOrders(player).filter(({ order }) =>
          (order.type === 'CONSTRUCT' && SECONDARY_BASE_TYPES.has(order.structType)) ||
          (order.type === 'REPAIR_UNIT' && SECONDARY_BASE_TYPES.has(getRuinById(order.ruinId)?.type))).length;
      }
      return count;
    }

    function validSecondaryLocation(type, x, y) {
      return !SECONDARY_BASE_TYPES.has(type) || !state.entities.some(e =>
        e.kind === 'structure' && e.type === 'main_base' &&
        distIn(e.x, e.y, x, y) < MAIN_BASE_EXCLUSION_IN - 1e-9);
    }

    function queueConstructOrder(unit, structType) {
      const p = state.activePlayer;
      selectAutomaticTurn(p, 'CONSTRUCT', 4, unit);
      if (getRemainingAP(p) < 4) {
        showToast('Construction / Conversion requires 4 AP!', 'warn');
        return;
      }
      if (!unit.secured && getPlanningTurn() === state.turn) {
        showToast('Unit must hold its ground for 1 full turn (Secured) before building!', 'warn');
        return;
      }
      if (getUnitMoveOrders(unit.id, p).length > 0) {
        showToast('A unit cannot move and construct in the same turn.', 'warn');
        return;
      }
      if (hasUnitFullTurnOrder(unit.id, p)) {
        showToast('This unit already has a construction or repair order.', 'warn');
        return;
      }
      const location = getPlannedPos(unit, p);
      if (SECONDARY_BASE_TYPES.has(structType) && secondaryBaseCount(p, true) >= MAX_SECONDARY_BASES) {
        showToast('Maximum of four secondary bases, including queued construction and repairs.', 'warn');
        resetPlanningTurn();
        return;
      }
      if (!validSecondaryLocation(structType, location.x, location.y)) {
        showToast('Secondary bases must be at least 3" from every main base.', 'warn');
        resetPlanningTurn();
        return;
      }
      if (!isLandForBase(location.x, location.y)) {
        showToast('Cannot construct a structure on water or an impassable Building (B) tile!', 'danger');
        SFX.play('miss');
        return;
      }
      if (structType === 'port' && !isNearWater(location.x, location.y, 1.2)) {
        showToast('Ports must be constructed on land adjacent to water!', 'warn');
        return;
      }
      const sName = STRUCTURE_DEFS[structType].name;
      const verb = structType === 'resupply_hub' ? 'Convert Infantry →' : 'Construct';
      addPlanningOrder(p, {
        type: 'CONSTRUCT',
        cost: 4,
        unitId: unit.id,
        structType,
        label: `🏗️ ${verb} ${sName} (Consumes ${UNIT_DEFS[unit.type].name})`
      });
      SFX.play('lock');
      resetPlanningTurn();
      updateUI();
    }

    function queueRepairRuin(ruin, unit = null) {
      const p = state.activePlayer;
      selectAutomaticTurn(p, unit ? 'REPAIR_UNIT' : 'REPAIR_MAIN', 4, unit, null, state.turn + ruin.cooldown);
      if (getRemainingAP(p) < 4) {
        showToast('Reconstruction requires 4 AP!', 'warn');
        return;
      }
      if (ruin.cooldown > 0 && getPlanningTurn() === state.turn) {
        showToast(`Ruin still cooling down (${ruin.cooldown} turns left)!`, 'warn');
        return;
      }
      const sName = STRUCTURE_DEFS[ruin.type].name;
      if (ruin.type === 'main_base') {
        addPlanningOrder(p, {
          type: 'REPAIR_MAIN',
          cost: 4,
          ruinId: ruin.id,
          label: `🔧 Reconstruct ${sName} (4 AP)`
        });
      } else {
        if (SECONDARY_BASE_TYPES.has(ruin.type) && secondaryBaseCount(p, true) >= MAX_SECONDARY_BASES) {
          showToast('Maximum of four secondary bases, including queued construction and repairs.', 'warn');
          resetPlanningTurn();
          return;
        }
        if (!unit || (unit.type !== 'infantry' && unit.type !== 'specops')) {
          showToast('Move an Infantry or Special Forces unit onto the Ruin to repair it!', 'warn');
          return;
        }
        if (getUnitMoveOrders(unit.id, p).length > 0) {
          showToast('A unit cannot move and repair in the same turn.', 'warn');
          return;
        }
        if (hasUnitFullTurnOrder(unit.id, p)) {
          showToast('This unit already has a construction or repair order.', 'warn');
          return;
        }
        addPlanningOrder(p, {
          type: 'REPAIR_UNIT',
          cost: 4,
          ruinId: ruin.id,
          unitId: unit.id,
          label: `🔧 Repair ${sName} with ${UNIT_DEFS[unit.type].name}`
        });
      }
      SFX.play('lock');
      resetPlanningTurn();
      updateUI();
    }

    function logPlan(player, message, warning = false) {
      const entry = document.createElement('div');
      entry.className = `text-xs p-1.5 rounded border ${warning ? 'text-amber-200 border-amber-500/40' : 'text-slate-300 border-slate-700/60'}`;
      entry.dataset.viewers = String(player);
      entry.hidden = fogViewer() !== player;
      entry.textContent = message;
      document.getElementById('combat-log').prepend(entry);
    }

    function isQueuedOrderPositionValid(order, player, turn, unit, base, ruin) {
      const pos = unit ? getProjectedPosAtTurn(unit, player, turn) : null;
      if (order.type === 'BARRAGE') {
        const def = UNIT_DEFS[unit.type], distance = distIn(pos.x, pos.y, order.x, order.y);
        return distance >= def.minRange && distance <= def.range + 0.03;
      }
      if (order.type === 'DRONE') {
        return distIn(pos.x, pos.y, order.x, order.y) <= UNIT_DEFS[unit.type].droneRange + 0.03;
      }
      if (order.type === 'ROADBLOCK') {
        return distIn(pos.x, pos.y, order.x1, order.y1) <= RESUPPLY_TOUCH_IN + 1e-9;
      }
      if (order.type === 'BRIDGE') {
        return isValidBridge(pos, order.x, order.y, UNIT_DEFS[unit.type].maxBridgeSpan);
      }
      if (order.type === 'CONSTRUCT') {
        return isLandForBase(pos.x, pos.y) &&
          validSecondaryLocation(order.structType, pos.x, pos.y) &&
          (!SECONDARY_BASE_TYPES.has(order.structType) || secondaryBaseCount(player) < MAX_SECONDARY_BASES) &&
          (order.structType !== 'port' || isNearWater(pos.x, pos.y, 1.2));
      }
      if (order.type === 'REPAIR_UNIT') return distIn(pos.x, pos.y, ruin.x, ruin.y) <= 0.8 &&
        (!SECONDARY_BASE_TYPES.has(ruin.type) || secondaryBaseCount(player) < MAX_SECONDARY_BASES);
      if (order.type === 'DEPLOY_AD') {
        const from = base.kind === 'unit' ? getProjectedPosAtTurn(base, player, turn) : base;
        return isLandForUnit(order.x, order.y) && !isBuildingAt(order.x, order.y) &&
          distIn(from.x, from.y, order.x, order.y) <= ESTABLISHED_ZONE_IN;
      }
      return true;
    }

    function prepareGroupMoves(player, orders, turn) {
      state.planCurrent = turn === state.turn;
      if (!state.planCurrent) state.planTurnOffset = turn - state.turn;
      let displacement = null;
      const prepared = [];
      for (const order of orders) {
        const unit = getEntityById(order.unitId);
        if (!unit || unit.owner !== player) continue;
        const from = getProjectedPosAtTurn(unit, player, turn);
        const def = UNIT_DEFS[unit.type];
        const trace = def.category === 'land'
          ? traceLandPath(from.x, from.y, order.toX, order.toY, !!def.canEnterBuilding, unit, true)
          : def.category === 'sea' ? traceSeaPath(from.x, from.y, order.toX, order.toY) : { blocked: false };
        const dx = order.toX - from.x, dy = order.toY - from.y;
        const distance = Math.hypot(dx, dy);
        if (def.speed <= 0 || trace.blocked ||
            buildingMoveWait(unit, from.x, from.y, order.toX, order.toY, turn) ||
            (distance < 0.12 && !buildingTransition(from.x, from.y, order.toX, order.toY)) ||
            distance > getLegSpeed(unit, from.x, from.y, order.toX, order.toY) + 0.05 ||
            (displacement && (Math.abs(dx - displacement.dx) > 1e-6 || Math.abs(dy - displacement.dy) > 1e-6))) {
          return null;
        }
        displacement = { dx, dy };
        prepared.push({ ...order, fromX: from.x, fromY: from.y });
      }
      return prepared;
    }

    function promoteDuePlans(player, currentTurn) {
      const due = state.futurePlans[player].filter(o => o.targetTurn <= currentTurn)
        .sort((a, b) => a.targetTurn - b.targetTurn || a.id - b.id);
      state.futurePlans[player] = state.futurePlans[player].filter(o => o.targetTurn > currentTurn);
      const handledGroups = new Set(), canceledGroups = new Set();
      for (const plan of due) {
        if (plan.groupRouteId != null) {
          const route = plan.groupRouteId, key = `${route}:${plan.groupStep}`;
          if (canceledGroups.has(route) || handledGroups.has(key)) continue;
          handledGroups.add(key);
          const batch = due.filter(o => o.groupRouteId === route && o.groupStep === plan.groupStep);
          const members = batch.filter(o => {
            const unit = getEntityById(o.unitId);
            return unit && unit.owner === player;
          });
          const available = members.every(o => !state.orders[player].some(existing =>
            existing.unitId === o.unitId && ['MOVE', 'BARRAGE', 'CONSTRUCT', 'REPAIR_UNIT'].includes(existing.type)));
          const prepared = available ? prepareGroupMoves(player, members, currentTurn) : null;
          if (!prepared) {
            const remove = window.confirm('A group route can no longer move in formation. Remove its remaining orders?');
            const later = [...due.filter(o => o.groupRouteId === route && !handledGroups.has(`${route}:${o.groupStep}`)),
              ...state.futurePlans[player].filter(o => o.groupRouteId === route)];
            state.futurePlans[player] = state.futurePlans[player].filter(o => o.groupRouteId !== route);
            if (!remove) {
              for (const o of [...batch, ...later]) {
                state.futurePlans[player].push({ ...o, targetTurn: Math.max(currentTurn + 1, o.targetTurn + 1), invalid: true });
              }
            }
            canceledGroups.add(route);
            logPlan(player, `${remove ? 'Canceled' : 'Deferred'} group route: formation cannot be maintained.`, true);
            continue;
          }
          for (const preparedOrder of prepared) {
            const { targetTurn, id, invalid, ...order } = preparedOrder;
            state.orders[player].push({ ...order, id: nextOrderId++ });
          }
          continue;
        }
        const unit = plan.unitId != null ? getEntityById(plan.unitId) : null;
        const base = plan.baseId != null ? getEntityById(plan.baseId) : null;
        const ruin = plan.ruinId != null ? getRuinById(plan.ruinId) : null;
        if ((plan.unitId != null && (!unit || unit.owner !== player)) ||
            (plan.baseId != null && (!base || base.owner !== player)) ||
            (plan.ruinId != null && (!ruin || ruin.owner !== player))) {
          logPlan(player, `Canceled future order: ${plan.label} (referenced entity no longer exists).`, true);
          continue;
        }
        const busy = (plan.type === 'PRODUCE' || plan.type === 'DEPLOY_AD') &&
          (base.cooldown > 0 || state.orders[player].some(o =>
            (o.type === 'PRODUCE' || o.type === 'DEPLOY_AD') && o.baseId === base.id));
        const incompatible = state.orders[player].some(o => o.unitId === plan.unitId && plan.unitId != null &&
          ((plan.type === 'BARRAGE' && (o.type === 'MOVE' || o.type === 'BARRAGE')) ||
           ((plan.type === 'CONSTRUCT' || plan.type === 'REPAIR_UNIT') &&
            (o.type === 'MOVE' || o.type === 'CONSTRUCT' || o.type === 'REPAIR_UNIT')) ||
           (plan.type === 'DRONE' && (o.type === 'DRONE' || o.type === 'ENGAGE')) ||
           (plan.type === 'ENGAGE' && o.type === 'DRONE')));
        if (getRemainingAP(player, currentTurn) < plan.cost || busy || incompatible ||
            (ruin && ruin.cooldown > 0) ||
            (plan.type === 'CONSTRUCT' && !unit.secured) ||
            !isQueuedOrderPositionValid(plan, player, currentTurn, unit, base, ruin)) {
          if (!window.confirm(`The order "${plan.label}" is not ready this turn. Remove it and reschedule later orders?`)) {
            state.futurePlans[player].push({ ...plan, targetTurn: currentTurn + 1, invalid: true });
            logPlan(player, `Deferred: ${plan.label}.`, true);
          }
          continue;
        }
        if (plan.type === 'MOVE') {
          const previous = state.orders[player].filter(o => o.type === 'MOVE' && o.unitId === unit.id);
          const from = previous.length ? { x: previous[previous.length - 1].toX, y: previous[previous.length - 1].toY } : unit;
          const def = UNIT_DEFS[unit.type];
          const trace = def.category === 'land'
            ? traceLandPath(from.x, from.y, plan.toX, plan.toY, !!def.canEnterBuilding, unit, true)
            : def.category === 'sea' ? traceSeaPath(from.x, from.y, plan.toX, plan.toY) : { blocked: false };
          if (hasUnitMovedThisTurn(unit.id, player, currentTurn) || def.speed <= 0 || trace.blocked ||
              buildingMoveWait(unit, from.x, from.y, plan.toX, plan.toY, currentTurn) ||
              distIn(from.x, from.y, plan.toX, plan.toY) > getLegSpeed(unit, from.x, from.y, plan.toX, plan.toY) + 0.05 ||
              state.orders[player].some(o => o.unitId === unit.id && (o.type === 'BARRAGE' || o.type === 'CONSTRUCT' || o.type === 'REPAIR_UNIT'))) {
            if (!window.confirm(`The route order "${plan.label}" is no longer valid. Remove it and reschedule later orders?`)) {
              state.futurePlans[player].push({ ...plan, targetTurn: currentTurn + 1, invalid: true });
              logPlan(player, `Deferred: ${plan.label}.`, true);
            }
            continue;
          }
          plan.fromX = from.x;
          plan.fromY = from.y;
        }
        const { targetTurn, id, invalid, ...order } = plan;
        state.orders[player].push({ ...order, id: nextOrderId++ });
        logPlan(player, `Promoted: ${plan.label}.`);
      }
    }

    function rescheduleQueuedOrders(player) {
      const pending = allQueuedOrders(player).map(x => x.order);
      state.orders[player] = [];
      state.futurePlans[player] = [];
      const handledGroups = new Set(), canceledGroups = new Set(), deferredGroups = new Set();
      for (const original of pending) {
        if (original.groupRouteId != null) {
          const route = original.groupRouteId, key = `${route}:${original.groupStep}`;
          if (canceledGroups.has(route) || handledGroups.has(key)) continue;
          handledGroups.add(key);
          const batch = pending.filter(o => o.groupRouteId === route && o.groupStep === original.groupStep)
            .filter(o => {
              const unit = getEntityById(o.unitId);
              return unit && unit.owner === player;
            });
          if (!batch.length) continue;
          if (deferredGroups.has(route) || batch.some(o => o.invalid)) {
            deferredGroups.add(route);
            for (const o of batch) state.futurePlans[player].push({ ...o, targetTurn: Math.max(state.turn + 1, o.targetTurn || state.turn + 1), invalid: true });
            continue;
          }
          let turn = state.turn, changed;
          do {
            changed = false;
            for (const o of batch) {
              const next = selectAutomaticTurn(player, 'MOVE', o.cost, getEntityById(o.unitId), null, turn);
              if (next > turn) { turn = next; changed = true; }
            }
          } while (changed);
          while (batch.some(o => {
            const unit = getEntityById(o.unitId), from = getProjectedPosAtTurn(unit, player, turn);
            return buildingMoveWait(unit, from.x, from.y, o.toX, o.toY, turn);
          })) turn++;
          const prepared = prepareGroupMoves(player, batch, turn);
          if (!prepared) {
            if (window.confirm('A group route can no longer move in formation. Remove its remaining orders?')) {
              state.orders[player] = state.orders[player].filter(o => o.groupRouteId !== route);
              state.futurePlans[player] = state.futurePlans[player].filter(o => o.groupRouteId !== route);
              canceledGroups.add(route);
            } else {
              deferredGroups.add(route);
              for (const o of batch) state.futurePlans[player].push({ ...o, targetTurn: Math.max(state.turn + 1, turn), invalid: true });
            }
            continue;
          }
          for (const item of prepared) {
            const { targetTurn, invalid, ...order } = item;
            if (turn === state.turn) state.orders[player].push(order);
            else state.futurePlans[player].push({ ...order, targetTurn: turn });
          }
          continue;
        }
        const { targetTurn, invalid, ...order } = original;
        const unit = order.unitId != null ? getEntityById(order.unitId) : null;
        const base = order.baseId != null ? getEntityById(order.baseId) : null;
        if ((order.unitId != null && (!unit || unit.owner !== player)) ||
            (order.baseId != null && (!base || base.owner !== player)) ||
            (order.ruinId != null && !getRuinById(order.ruinId))) continue;
        if (invalid) {
          state.futurePlans[player].push({ ...order, targetTurn: Math.max(state.turn + 1, targetTurn), invalid: true });
          continue;
        }
        const ruin = order.ruinId != null ? getRuinById(order.ruinId) : null;
        let turn = selectAutomaticTurn(player, order.type, order.cost, unit,
          order.type === 'PRODUCE' || order.type === 'DEPLOY_AD' ? base : null,
          ruin ? state.turn + ruin.cooldown : state.turn);
        if (order.type === 'MOVE') {
          let from = getProjectedPosAtTurn(unit, player, turn);
          while (buildingMoveWait(unit, from.x, from.y, order.toX, order.toY, turn)) {
            turn = selectAutomaticTurn(player, 'MOVE', order.cost, unit, null, turn + 1);
            from = getProjectedPosAtTurn(unit, player, turn);
          }
          const def = UNIT_DEFS[unit.type];
          const trace = def.category === 'land'
            ? traceLandPath(from.x, from.y, order.toX, order.toY, !!def.canEnterBuilding, unit, true)
            : def.category === 'sea' ? traceSeaPath(from.x, from.y, order.toX, order.toY) : { blocked: false };
          if (trace.blocked || buildingMoveWait(unit, from.x, from.y, order.toX, order.toY, turn) ||
              distIn(from.x, from.y, order.toX, order.toY) >
              getLegSpeed(unit, from.x, from.y, order.toX, order.toY) + 0.05) {
            if (!window.confirm(`The route order "${order.label}" is no longer valid. Remove it and reschedule later orders?`)) {
              state.futurePlans[player].push({ ...order, targetTurn: Math.max(state.turn + 1, turn), invalid: true });
            }
            continue;
          }
          order.fromX = from.x;
          order.fromY = from.y;
        }
        if (!isQueuedOrderPositionValid(order, player, turn, unit, base, ruin)) {
          if (!window.confirm(`The order "${order.label}" is no longer valid. Remove it and reschedule later orders?`)) {
            state.futurePlans[player].push({ ...order, targetTurn: Math.max(state.turn + 1, turn), invalid: true });
          }
          continue;
        }
        if (turn === state.turn) state.orders[player].push(order);
        else state.futurePlans[player].push({ ...order, targetTurn: turn });
      }
      resetPlanningTurn();
    }

    function removeQueuedOrder(player, id) {
      const selected = allQueuedOrders(player).find(entry => entry.order.id === id);
      const route = selected && selected.order.groupRouteId;
      state.standingEngage[player] = state.standingEngage[player].filter(o => o.id !== id);
      state.orders[player] = state.orders[player].filter(o => o.id !== id && (route == null || o.groupRouteId !== route));
      state.futurePlans[player] = state.futurePlans[player].filter(o => o.id !== id && (route == null || o.groupRouteId !== route));
      rescheduleQueuedOrders(player);
    }

    function undoLastOrder() {
      if (state.phase !== 'PLANNING' || (netActive() && NET.locked[NET.role])) return;
      const list = [...allQueuedOrders(state.activePlayer),
        ...state.standingEngage[state.activePlayer].map(order => ({ order }))];
      if (list.length === 0) return;
      const latest = list.reduce((a, b) => a.order.id > b.order.id ? a : b);
      removeQueuedOrder(state.activePlayer, latest.order.id);
      SFX.play('click');
      updateUI();
    }

    function clearAllOrders() {
      if (state.phase !== 'PLANNING' || (netActive() && NET.locked[NET.role])) return;
      const p = state.activePlayer;
      state.orders[p] = [];
      state.futurePlans[p] = [];
      state.standingEngage[p] = [];
      setMode('IDLE');
      SFX.play('click');
      updateUI();
    }

    // --- HOTSEAT LOCK & WEGO TRANSITION ---
    function lockActivePlayerOrders() {
      if (state.phase !== 'PLANNING') return;
      if (netActive() && NET.locked[NET.role]) return;
      if (netActive() && NET.warnUnusedAP) {
        const remaining = getRemainingAP(NET.role, state.turn);
        if (remaining > 0 && !window.confirm(`You have ${remaining} unused AP this turn. Lock orders anyway?`)) {
          showToast('Orders remain unlocked.', 'info');
          return;
        }
      }
      materializeStandingEngage(state.activePlayer);
      state.selectedUnitIds = [];
      if (netActive()) {
        setMode('IDLE');
        state.selectedId = null;
        SFX.play('lock');
        NET.locked[NET.role] = true;
        netSend({ t: 'orders', orders: state.orders[NET.role] });
        showToast(NET.locked[netPeerRole()] ? 'Orders locked — resolving…' : 'Orders locked. Waiting for opponent…', 'info');
        updateUI();
        netMaybeResolve();
        return;
      }
      setMode('IDLE');
      state.selectedId = null;
      SFX.play('lock');

      if (state.activePlayer === 1) {
        const modal = document.getElementById('handoff-modal');
        document.getElementById('handoff-title').textContent = 'Player 1 Orders Locked';
        document.getElementById('handoff-subtitle').textContent =
          `Player 1 queued ${state.orders[1].length} secret order(s) (${getQueuedAP(1, state.turn)}/${getMaxAP()} AP). Pass device to Player 2 (Red).`;
        const btn = document.getElementById('btn-handoff-ready');
        btn.textContent = 'Player 2 (Red) Ready — Begin Planning';
        btn.className = 'tac-btn w-full py-3 rounded-xl bg-gradient-to-b from-rose-500 to-rose-700 hover:from-rose-400 hover:to-rose-600 text-white font-extrabold uppercase tracking-wider text-sm';
        btn.onclick = () => {
          modal.classList.add('hidden');
          state.activePlayer = 2;
          state.planCurrent = true;
          promoteDuePlans(2, state.turn);
          rescheduleQueuedOrders(2);
          applyPendingRallies(2);
          SFX.play('click');
          updateUI();
        };
        modal.classList.remove('hidden');
      } else {
        runSimultaneousResolution();
      }
    }
