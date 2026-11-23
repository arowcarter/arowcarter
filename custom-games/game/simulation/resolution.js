    // Replay, resupply, combat, and the four simultaneous resolution steps.
    // --- SIMULTANEOUS 4-STEP WEGO RESOLUTION ---
    function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

    function highlightResStep(stepNum) {
      resolutionReplay.step = stepNum;
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

    function addEffect(fx, entities = []) {
      const viewer = fogViewer();
      const privateEffect = viewer !== null && entities.some(e => e.kind === 'unit');
      const viewers = privateEffect
        ? (netActive() ? [viewer] : [1, 2]).filter(p => entities.every(e => isEntityVisible(e, p)))
        : null;
      if (viewers && viewers.length === 0) return;
      state.effects.push({ ...fx, viewers, createdAt: performance.now() });
    }

    function recordResolutionFrame() {
      const now = performance.now();
      resolutionReplay.frames.push({
        time: now - resolutionReplay.start,
        step: resolutionReplay.step,
        entities: state.entities.map(e => ({ ...e })),
        ruins: state.ruins.map(r => ({ ...r })),
        destroyedBuildings: [...state.destroyedBuildings],
        drones: state.drones.map(d => ({ ...d })),
        effects: state.effects.map(fx => ({ ...fx }))
      });
    }

    function startResolutionReplay() {
      if (resolutionReplay.playback || resolutionReplay.frames.length < 2 ||
          (netActive() && state.phase === 'POST_RESOLUTION' && NET.nextReady[NET.role]) ||
          (state.phase !== 'POST_RESOLUTION' && state.phase !== 'GAMEOVER')) return;
      state.selectedId = null;
      resolutionReplay.playback = { start: performance.now(), index: 0 };
      updateUI();
    }

    function checkContactResupplyForUnit(unit, x, y) {
      if (!unit.ammoSpent) return false;
      if (UNIT_DEFS[unit.type].category === 'land' && isBuildingAt(x, y)) return false;
      const touched = state.entities.some(e =>
        e.owner === unit.owner &&
        (UNIT_DEFS[unit.type].requiresRtbResupply
          ? (e.kind === 'structure' && e.type === 'air_base') || (e.kind === 'unit' && UNIT_DEFS[e.type].canReloadAir)
          : (e.kind === 'structure' && STRUCTURE_DEFS[e.type].isResupply) ||
            (UNIT_DEFS[unit.type].category === 'air' && e.kind === 'unit' && UNIT_DEFS[e.type].canReloadAir)) &&
        distIn(x, y, e.x, e.y) <= RESUPPLY_TOUCH_IN
      );
      if (touched) {
        unit.ammoSpent = false;
        unit.idleResupplyTurns = 0;
        addEffect({ type: 'text', x, y: y - 0.35, text: 'RELOADED!', color: '#34d399', duration: 1500 }, [unit]);
        addLog(`🔋 <strong>${pName(unit.owner)} ${UNIT_DEFS[unit.type].name}</strong> reloaded on contact with friendly Base/Hub!`, 'emerald', [unit]);
        return true;
      }
      return false;
    }

    function checkConvoyContacts(stolenThisTurn, refilledThisTurn) {
      const convoys = state.entities.filter(e => e.kind === 'unit' && UNIT_DEFS[e.type].maxResupplyCharges);
      for (const convoy of convoys) {
        const def = UNIT_DEFS[convoy.type];
        if (!refilledThisTurn.has(convoy.id) && state.entities.some(e =>
          e.kind === 'structure' && e.owner === convoy.owner && STRUCTURE_DEFS[e.type].isBase &&
          distIn(e.x, e.y, convoy.x, convoy.y) <= RESUPPLY_TOUCH_IN)) {
          convoy.resupplyCharges = def.maxResupplyCharges;
          refilledThisTurn.add(convoy.id);
        }
      }
      for (const unit of state.entities) {
        if (unit.kind !== 'unit' || UNIT_DEFS[unit.type].requiresRtbResupply) continue;
        if (UNIT_DEFS[unit.type].category === 'land' && isBuildingAt(unit.x, unit.y)) continue;
        for (const convoy of convoys) {
          if (unit.id === convoy.id || convoy.resupplyCharges <= 0 ||
              distIn(unit.x, unit.y, convoy.x, convoy.y) > RESUPPLY_TOUCH_IN) continue;
          const enemy = unit.owner !== convoy.owner;
          const key = `${unit.id}:${convoy.id}`;
          if (enemy && (stolenThisTurn.has(key) || !UNIT_DEFS[convoy.type].stealableAmmo)) continue;
          if (!enemy && !unit.ammoSpent) continue;
          convoy.resupplyCharges--;
          if (enemy) stolenThisTurn.add(key);
          if (unit.ammoSpent) {
            unit.ammoSpent = false;
            unit.idleResupplyTurns = 0;
          } else {
            unit.reserveAmmo++;
          }
          addLog(`🔋 ${pName(unit.owner)} ${UNIT_DEFS[unit.type].name} ${enemy ? 'stole ammunition from' : 'reloaded from'} a convoy.`, 'emerald', [unit, convoy]);
          break;
        }
      }
    }

    function unitBuildingCell(unit) {
      if (!unit || unit.kind !== 'unit' || !UNIT_DEFS[unit.type].canEnterBuilding) return null;
      const cell = getCustomCellAt(unit.x, unit.y);
      return cell?.type === 'B' ? { ...cell, buildingId: buildingOccupancyId(unit.x, unit.y) } : null;
    }

    function unitEngagementRange(unit, destroyedBuildings = state.destroyedBuildings) {
      const def = UNIT_DEFS[unit.type];
      if (!def.canEnterBuilding || !['sniper_team', 'drone_operator'].includes(unit.type)) return def.range;
      const cell = getCustomCellAt(unit.x, unit.y, destroyedBuildings);
      return def.range + (cell?.type === 'B' ? (cell.bldgTier === 3 ? 1 : cell.bldgTier === 2 ? 0.5 : 0) : 0);
    }

    function contestedBuilding(unit) {
      const cell = unitBuildingCell(unit);
      if (!cell) return false;
      const occupants = state.entities.filter(e => unitBuildingCell(e)?.buildingId === cell.buildingId);
      return occupants.some(e => e.owner !== unit.owner) && occupants.some(e => !e.ammoSpent);
    }

    function directFireBlocked(attacker, target) {
      const def = UNIT_DEFS[attacker.type];
      if (!state.customMap || (def.category === 'air' && !def.lowAltitudeFire) ||
          (def.category !== 'air' && target.kind === 'unit' && UNIT_DEFS[target.type].category === 'air')) return false;
      const startId = buildingOccupancyId(attacker.x, attacker.y), endId = buildingOccupancyId(target.x, target.y);
      const cm = state.customMap, distance = distIn(attacker.x, attacker.y, target.x, target.y);
      const steps = Math.max(1, Math.ceil(distance / Math.min(MAP_W / cm.cols, MAP_H / cm.rows) * 4));
      for (let i = 1; i < steps; i++) {
        const cell = getCustomCellAt(attacker.x + (target.x - attacker.x) * i / steps,
          attacker.y + (target.y - attacker.y) * i / steps);
        const id = buildingOccupancyId(attacker.x + (target.x - attacker.x) * i / steps,
          attacker.y + (target.y - attacker.y) * i / steps);
        if (cell.type === 'B' &&
            id !== startId && id !== endId &&
            (def.lowAltitudeFire ? cell.bldgTier === 3 : cell.bldgTier >= 2 || def.range <= 1)) return true;
      }
      return false;
    }

    function canAutoEngage(attacker, target) {
      if (attacker.owner === target.owner) return false;
      const aDef = UNIT_DEFS[attacker.type];
      if (aDef.atk <= 0 || aDef.indirectFire) return false;
      if (target.kind === 'unit' && target.submerged &&
          (!(aDef.sonarRange || aDef.startsSubmerged) || !isEntityVisible(target, attacker.owner))) return false;
      const aCell = unitBuildingCell(attacker), tCell = unitBuildingCell(target);
      const sameBuilding = aCell && tCell && aCell.buildingId === tCell.buildingId;
      if (tCell && !sameBuilding && target.revealedBuilding !== tCell.buildingId &&
          !state.drones.some(d => d.owner === attacker.owner &&
            distanceToEntity(d.x, d.y, target) <= d.revealRange + 0.03)) return false;
      if (!sameBuilding && distanceToEntity(attacker.x, attacker.y, target) > unitEngagementRange(attacker) + 0.03) return false;
      if (!sameBuilding && directFireBlocked(attacker, target)) return false;

      if (attacker.type === 'air_def') {
        return target.kind === 'unit' && UNIT_DEFS[target.type].category === 'air';
      }
      if (target.kind === 'unit' && UNIT_DEFS[target.type].category === 'air') {
        return aDef.category === 'air' || attacker.type === 'air_def';
      }
      if (attacker.type === 'infantry') {
        if (target.kind === 'unit' && (target.type === 'heavy_veh' || UNIT_DEFS[target.type].category !== 'land')) {
          return false;
        }
      }
      return true;
    }

    function convertStructureToRuin(struct) {
      if (struct.type === 'pontoon_bridge') return;
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

    function damageBuildingAt(idx, owner, destroyed, directHeavyStrike = false) {
      const cm = state.customMap;
      if (!cm || cm.types[idx] !== 'B' || state.destroyedBuildings.includes(idx)) return;
      const id = cm.buildingGroups?.[idx] >= 0 ? cm.buildingGroups[idx] : idx;
      const members = cm.buildingMembers[id] || [idx];
      const tier = cm.bldgTier[idx] || 1;
      state.buildingDamage[id] = (state.buildingDamage[id] || 0) +
        (directHeavyStrike && tier === 2 ? 2 : 1);
      if (state.buildingDamage[id] < (cm.bldgHp[idx] || 1)) return;
      for (const target of state.entities) {
        if (target.kind === 'unit' && UNIT_DEFS[target.type].category === 'land' &&
            getCustomCellAt(target.x, target.y).type === 'B' &&
            getCustomCellAt(target.x, target.y).buildingId === id) {
          if (!destroyed.has(target.id)) state.stats.kills[owner]++;
          destroyed.add(target.id);
        }
      }
      for (const member of members) state.destroyedBuildings.push(member);
    }

    function applyAreaBlast(owner, x, y, radius, attack, destroyed, label, source = null, immuneMainBases = false) {
      for (const target of state.entities) {
        if (immuneMainBases && target.kind === 'structure' && target.type === 'main_base') continue;
        if (distanceToEntity(x, y, target) > radius) continue;
        const defense = rollDie(target.hp);
        const hit = attack > defense;
        if (hit) {
          if (!destroyed.has(target.id)) state.stats.kills[owner]++;
          destroyed.add(target.id);
        }
        const name = target.kind === 'unit' ? UNIT_DEFS[target.type].name : STRUCTURE_DEFS[target.type].name;
        addLog(`💥 <strong>${label}:</strong> ${pName(owner)} rolled ${attack} vs ${pName(target.owner)} ${name} ${defense} → <strong>${hit ? 'DESTROYED' : 'DEFLECTED'}</strong>.`,
          'danger', source ? [source, target] : [target]);
      }
      if (!state.customMap) return;
      const cm = state.customMap;
      const cellW = MAP_W / cm.cols, cellH = MAP_H / cm.rows;
      const minCol = Math.max(0, Math.floor((x - radius) / cellW));
      const maxCol = Math.min(cm.cols - 1, Math.floor((x + radius) / cellW));
      const minRow = Math.max(0, Math.floor((y - radius) / cellH));
      const maxRow = Math.min(cm.rows - 1, Math.floor((y + radius) / cellH));
      const hitBuildings = new Set();
      const directCell = label === 'MISSILE' ? getCustomCellAt(x, y) : null;
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const idx = row * cm.cols + col;
          const nearestX = Math.max(col * cellW, Math.min(x, (col + 1) * cellW));
          const nearestY = Math.max(row * cellH, Math.min(y, (row + 1) * cellH));
          if (cm.types[idx] !== 'B' || state.destroyedBuildings.includes(idx) ||
              distIn(x, y, nearestX, nearestY) > radius) continue;
          const id = cm.buildingGroups?.[idx] >= 0 ? cm.buildingGroups[idx] : idx;
          if (hitBuildings.has(id)) continue;
          hitBuildings.add(id);
          const directMissile = directCell?.type === 'B' && directCell.buildingId === id;
          damageBuildingAt(idx, owner, destroyed, directMissile);
        }
      }
    }

    async function runSimultaneousResolution() {
      clearOnlineReview();
      if (!netActive()) {
        materializeStandingEngage(1);
        materializeStandingEngage(2);
      }
      if (netActive()) rngState = (NET.seed + state.turn * 7919) >>> 0;
      const scaling = { 1: getLinearScaling(1, state.turn), 2: getLinearScaling(2, state.turn) };
      resolutionReplay.frames = [];
      resolutionReplay.start = performance.now();
      resolutionReplay.playback = null;
      state.phase = 'RESOLVING';
      state.selectedId = null;
      document.getElementById('resolution-banner').classList.remove('hidden');
      document.getElementById('btn-next-turn').classList.add('hidden');
      updateUI();

      addLog(`<strong class="text-amber-300">══ TURN ${state.turn} SIMULTANEOUS RESOLUTION ══</strong>`, 'amber');

      const movedUnitIds = new Set();
      const stolenThisTurn = new Set();
      const refilledThisTurn = new Set();
      const spentBeforeThisTurn = new Set(
        state.entities.filter(e => e.kind === 'unit' && e.ammoSpent).map(e => e.id)
      );

      // STEP 1: SIMULTANEOUS MOVEMENT & MID-PATH RESUPPLY
      highlightResStep(1);
      recordResolutionFrame();
      for (const unit of state.entities) {
        if (unit.kind === 'unit') checkContactResupplyForUnit(unit, unit.x, unit.y);
      }
      checkConvoyContacts(stolenThisTurn, refilledThisTurn);
      const unitPaths = new Map();
      for (const p of [1, 2]) {
        for (const o of state.orders[p]) {
          if (o.type === 'MOVE') {
            if (!unitPaths.has(o.unitId)) unitPaths.set(o.unitId, []);
            if (unitPaths.get(o.unitId).length >= MAX_MOVES_PER_UNIT_PER_TURN) {
              addLog(`⚠️ ${pName(p)} extra movement order canceled (one move per unit per turn).`, 'amber');
              continue;
            }
            unitPaths.get(o.unitId).push(o);
            movedUnitIds.add(o.unitId);
          }
        }
      }

      if (unitPaths.size > 0) {
        SFX.play('move');
        const blockedPaths = new Set();
        const groupPaths = new Map();
        for (const [unitId, legs] of unitPaths) {
          const unit = getEntityById(unitId), order = legs[0];
          if (!unit || order.groupRouteId == null) continue;
          const key = `${unit.owner}:${order.groupRouteId}:${order.groupStep}`;
          if (!groupPaths.has(key)) groupPaths.set(key, []);
          groupPaths.get(key).push({ unit, order });
        }
        for (const members of groupPaths.values()) {
          const blocked = members.some(({ unit, order }) => {
            const def = UNIT_DEFS[unit.type];
            return def.category === 'land' &&
              (traceLandPath(unit.x, unit.y, order.toX, order.toY, !!def.canEnterBuilding, unit).blocked ||
               buildingMoveWait(unit, unit.x, unit.y, order.toX, order.toY, state.turn, false) ||
               (buildingTransition(unit.x, unit.y, order.toX, order.toY) && contestedBuilding(unit)));
          });
          if (blocked) {
            for (const { unit } of members) {
              blockedPaths.add(unit.id);
              movedUnitIds.delete(unit.id);
            }
            addLog(`⚠️ ${pName(members[0].unit.owner)} group could not move in formation.`, 'amber', members.map(m => m.unit));
          }
        }
        const maxLegs = Math.max(...Array.from(unitPaths.values()).map(arr => arr.length));
        for (let leg = 0; leg < maxLegs; leg++) {
          const activeAnims = [];
          for (const [unitId, legs] of unitPaths.entries()) {
            if (leg < legs.length && !blockedPaths.has(unitId)) {
              const u = getEntityById(unitId);
              if (u) {
                let toX = legs[leg].toX, toY = legs[leg].toY;
                if (UNIT_DEFS[u.type].category === 'land') {
                  const trace = traceLandPath(u.x, u.y, toX, toY, !!UNIT_DEFS[u.type].canEnterBuilding, u);
                  if (trace.blocked || buildingMoveWait(u, u.x, u.y, toX, toY, state.turn, false) ||
                      (buildingTransition(u.x, u.y, toX, toY) && contestedBuilding(u))) {
                    if (trace.reason === 'ROADBLOCK') {
                      toX = trace.prevX; toY = trace.prevY;
                    } else {
                      toX = u.x; toY = u.y;
                      movedUnitIds.delete(unitId);
                    }
                    blockedPaths.add(unitId);
                    addLog(`⚠️ ${pName(u.owner)} ${UNIT_DEFS[u.type].name} could not complete its move.`, 'amber', [u]);
                  }
                }
                activeAnims.push({
                  unit: u,
                  fromX: u.x,
                  fromY: u.y,
                  toX,
                  toY
                });
              }
            }
          }
          let occupancyChanged;
          do {
            occupancyChanged = false;
            const animations = new Map(activeAnims.map(a => [a.unit.id, a]));
            const occupants = new Map();
            for (const unit of state.entities) {
              if (unit.kind !== 'unit' || !UNIT_DEFS[unit.type].canEnterBuilding) continue;
              const animation = animations.get(unit.id);
              const id = buildingOccupancyId(animation ? animation.toX : unit.x, animation ? animation.toY : unit.y);
              if (id === null) continue;
              if (!occupants.has(id)) occupants.set(id, []);
              occupants.get(id).push({ unit, animation });
            }
            const cancel = new Set();
            for (const [id, members] of occupants) {
              if (members.length < 2) continue;
              for (const { unit, animation } of members) {
                if (!animation) continue;
                if (buildingOccupancyId(animation.fromX, animation.fromY) !== id) cancel.add(unit.id);
              }
            }
            for (const members of groupPaths.values()) {
              if (members.some(({ unit }) => cancel.has(unit.id))) {
                for (const { unit } of members) cancel.add(unit.id);
              }
            }
            for (const id of cancel) {
              const animation = animations.get(id);
              if (!animation || blockedPaths.has(id)) continue;
              animation.toX = animation.fromX;
              animation.toY = animation.fromY;
              blockedPaths.add(id);
              movedUnitIds.delete(id);
              occupancyChanged = true;
              addLog(`⚠️ ${pName(animation.unit.owner)} ${UNIT_DEFS[animation.unit.type].name} could not complete its move.`, 'amber', [animation.unit]);
            }
          } while (occupancyChanged);
          const duration = 520;
          const startTime = performance.now();
          let processedTick = 0;
          await new Promise(resolve => {
            function stepAnim(now) {
              const t = Math.min(1, (now - startTime) / duration);
              const nextTick = Math.floor(t * 40);
              while (processedTick < nextTick) {
                processedTick++;
                const fixedT = processedTick / 40;
                const fixedEase = fixedT < 0.5 ? 2 * fixedT * fixedT : 1 - Math.pow(-2 * fixedT + 2, 2) / 2;
                for (const a of activeAnims) {
                  a.unit.x = a.fromX + (a.toX - a.fromX) * fixedEase;
                  a.unit.y = a.fromY + (a.toY - a.fromY) * fixedEase;
                  if (UNIT_DEFS[a.unit.type].canEnterBuilding && a.unit.revealedBuilding != null &&
                      isBuildingAt(a.unit.x, a.unit.y) &&
                      buildingOccupancyId(a.unit.x, a.unit.y) !== a.unit.revealedBuilding) {
                    a.unit.revealedBuilding = null;
                  }
                }
                for (const unit of state.entities) {
                  if (unit.kind === 'unit') checkContactResupplyForUnit(unit, unit.x, unit.y);
                }
                checkConvoyContacts(stolenThisTurn, refilledThisTurn);
              }
              const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
              for (const a of activeAnims) {
                a.unit.x = a.fromX + (a.toX - a.fromX) * ease;
                a.unit.y = a.fromY + (a.toY - a.fromY) * ease;
              }
              recordResolutionFrame();
              if (t < 1) requestAnimationFrame(stepAnim);
              else resolve();
            }
            requestAnimationFrame(stepAnim);
          });
          for (const a of activeAnims) {
            const from = getCustomCellAt(a.fromX, a.fromY), to = unitBuildingCell(a.unit);
            if (to && (from?.type !== 'B' || buildingOccupancyId(a.fromX, a.fromY) !== to.buildingId)) {
              a.unit.buildingEnteredTurn = state.turn;
              a.unit.buildingBreacher = state.entities.some(e => e.owner !== a.unit.owner &&
                unitBuildingCell(e)?.buildingId === to.buildingId) ? to.buildingId : null;
            }
            if (!to) {
              a.unit.buildingEnteredTurn = null;
              a.unit.buildingBreacher = null;
            }
          }
        }
        addLog(`Step 1: ${unitPaths.size} unit(s) completed simultaneous movement.`, 'slate');
      } else {
        addLog('Step 1: No movement orders queued.', 'slate');
      }

      for (const u of state.entities) {
        if (u.kind === 'unit' && u.ammoSpent) {
          checkContactResupplyForUnit(u, u.x, u.y);
        }
      }
      checkConvoyContacts(stolenThisTurn, refilledThisTurn);
      for (const p of [1, 2]) {
        for (const order of state.orders[p].filter(o => o.type === 'DRONE')) {
          const unit = getEntityById(order.unitId);
          if (!unit || unit.owner !== p || unit.kind !== 'unit') continue;
          const def = UNIT_DEFS[unit.type];
          if (!def.droneRange || unit.ammoSpent || contestedBuilding(unit) ||
              distIn(unit.x, unit.y, order.x, order.y) > def.droneRange + 0.03) {
            addLog(`⚠️ ${pName(p)} drone launch canceled (operator unavailable or target out of range).`, 'amber');
            continue;
          }
          unit.ammoSpent = true;
          unit.idleResupplyTurns = 0;
          state.drones.push({ owner: p, x: order.x, y: order.y, revealRange: def.droneRevealRange,
            expiresTurn: state.turn + def.droneDurationTurns - 1 });
          addLog(`🛰️ ${pName(p)} launched a reconnaissance drone.`, p === 1 ? 'p1' : 'p2', [unit]);
        }
      }
      recordResolutionFrame();
      await sleep(350);

      // STEP 2: ORDERED ENGAGEMENT AND RETURN FIRE (SIMULTANEOUS, MUTUAL KILLS)
      highlightResStep(2);
      recordResolutionFrame();
      const targetAttackers = new Map();
      const assignedAttackers = new Set();
      const engageIds = new Set();
      for (const p of [1, 2]) {
        for (const o of state.orders[p]) {
          if (o.type === 'ENGAGE') {
            const unit = getEntityById(o.unitId);
            if (unit && unit.kind === 'unit' && unit.owner === p) engageIds.add(o.unitId);
          }
        }
      }

      for (const unit of state.entities) {
        if (unit.kind !== 'unit' || unit.ammoSpent ||
            (!engageIds.has(unit.id) && !contestedBuilding(unit))) continue;
        const cell = unitBuildingCell(unit);
        const contested = contestedBuilding(unit);
        const candidates = state.entities.filter(t => canAutoEngage(unit, t) &&
          (!contested || unitBuildingCell(t)?.buildingId === cell.buildingId));
        if (candidates.length === 0) continue;

        candidates.sort((a, b) => {
          const da = distanceToEntity(unit.x, unit.y, a);
          const db = distanceToEntity(unit.x, unit.y, b);
          if (Math.abs(da - db) > 0.02) return da - db;
          return a.hp - b.hp;
        });

        const chosen = candidates[0];
        if (!targetAttackers.has(chosen.id)) targetAttackers.set(chosen.id, []);
        targetAttackers.get(chosen.id).push(unit);
        assignedAttackers.add(unit.id);
      }

      for (const [targetId, attackers] of targetAttackers) {
        const target = getEntityById(targetId);
        for (const attacker of attackers) {
          if (UNIT_DEFS[attacker.type].transientUntilQuietMove) attacker.submerged = false;
          const cell = unitBuildingCell(attacker);
          if (cell && unitBuildingCell(target)?.buildingId !== cell.buildingId) {
            attacker.revealedBuilding = cell.buildingId;
          }
        }
      }

      // Each defender without an attack may return fire against one eligible attacker.
      for (const [targetId, attackers] of Array.from(targetAttackers.entries())) {
        const defender = getEntityById(targetId);
        if (!defender || defender.kind !== 'unit' || defender.ammoSpent || assignedAttackers.has(defender.id)) continue;
        const eligible = attackers.filter(a => canAutoEngage(defender, a));
        eligible.sort((a, b) => {
          const da = distIn(defender.x, defender.y, a.x, a.y);
          const db = distIn(defender.x, defender.y, b.x, b.y);
          if (Math.abs(da - db) > 0.02) return da - db;
          return a.hp - b.hp;
        });
        if (eligible.length > 0) {
          const target = eligible[0];
          if (UNIT_DEFS[defender.type].transientUntilQuietMove) defender.submerged = false;
          const cell = unitBuildingCell(defender);
          if (cell && unitBuildingCell(target)?.buildingId !== cell.buildingId) {
            defender.revealedBuilding = cell.buildingId;
          }
          if (!targetAttackers.has(target.id)) targetAttackers.set(target.id, []);
          targetAttackers.get(target.id).push(defender);
          assignedAttackers.add(defender.id);
        }
      }

      const destroyedInStep2 = new Set();
      const barrages = [1, 2].flatMap(p =>
        state.orders[p].filter(o => o.type === 'BARRAGE').map(o => ({ ...o, owner: p }))
      );
      const combatCells = new Map(state.entities.map(e => [e.id, unitBuildingCell(e)]));
      if (targetAttackers.size > 0 || barrages.length > 0) {
        SFX.play('fire');
        for (const [targetId, attackers] of targetAttackers.entries()) {
          const target = getEntityById(targetId);
          if (!target) continue;

          const targetCell = combatCells.get(target.id);
          const groups = new Map();
          for (const attacker of attackers) {
            const attackerCell = combatCells.get(attacker.id);
            const modifier = targetCell && attacker.type !== 'strategic_bomber' && attackerCell?.buildingId !== targetCell.buildingId
              ? 'cover' : targetCell && attackerCell?.buildingId === targetCell.buildingId &&
                attacker.buildingBreacher === targetCell.buildingId &&
                ['specops', 'breacher', 'breacher_squad'].includes(attacker.type) ? 'breach' : 'normal';
            if (!groups.has(modifier)) groups.set(modifier, []);
            groups.get(modifier).push(attacker);
          }
          for (const [modifier, group] of groups) {
            const combinedAtk = group.reduce((sum, u) => sum + UNIT_DEFS[u.type].atk +
              scaling[u.owner].unitCountAtkBonus + scaling[u.owner].progressAtkBonus, 0);
            let atkRoll = rollDie(combinedAtk);
            if (modifier === 'cover') atkRoll = Math.min(atkRoll, rollDie(combinedAtk));
            else if (modifier === 'breach') atkRoll = Math.max(atkRoll, rollDie(combinedAtk));
            const defRoll = rollDie(target.hp);
            const hit = atkRoll > defRoll;

            for (const a of group) {
              a.ammoSpent = true;
              a.idleResupplyTurns = 0;
              addEffect({
                type: 'beam',
                x1: a.x, y1: a.y, x2: target.x, y2: target.y,
                color: pColor(a.owner), duration: 1100
              }, [a, target]);
            }

            const tName = target.kind === 'unit' ? UNIT_DEFS[target.type].name : STRUCTURE_DEFS[target.type].name;
            const aNames = group.map(a => UNIT_DEFS[a.type].name).join(' + ');

            if (hit) {
              if (!destroyedInStep2.has(target.id)) state.stats.kills[group[0].owner]++;
              destroyedInStep2.add(target.id);
              if (group.some(a => a.type === 'strategic_bomber')) {
                const cell = getCustomCellAt(target.x, target.y);
                if (cell?.type === 'B') damageBuildingAt(cell.idx, group[0].owner, destroyedInStep2, true);
              }
              addEffect({ type: 'boom', x: target.x, y: target.y, color: '#f97316', duration: 950 }, [target]);
              addEffect({ type: 'text', x: target.x, y: target.y - 0.35, text: `💥 ${atkRoll} > ${defRoll}`, color: '#fb7185', duration: 1600 }, [target]);
              addLog(`💥 <strong>ENGAGE:</strong> ${pName(group[0].owner)} [${aNames}] rolled <strong>${atkRoll}</strong> (d${combinedAtk}) vs ${pName(target.owner)} ${tName} <strong>${defRoll}</strong> (d${target.hp}) → <strong>DESTROYED!</strong>`, 'danger', [...group, target]);
            } else {
              addEffect({ type: 'text', x: target.x, y: target.y - 0.35, text: `🛡️ ${atkRoll} ≤ ${defRoll}`, color: '#94a3b8', duration: 1500 }, [target]);
              addLog(`🛡️ <strong>ENGAGE:</strong> ${pName(group[0].owner)} [${aNames}] rolled <strong>${atkRoll}</strong> (d${combinedAtk}) vs ${pName(target.owner)} ${tName} <strong>${defRoll}</strong> (d${target.hp}) → <strong>DEFLECTED</strong>.`, 'slate', [...group, target]);
            }
          }
        }

        for (const order of barrages) {
          const unit = getEntityById(order.unitId);
          if (!unit || unit.owner !== order.owner || unit.kind !== 'unit') continue;
          const def = UNIT_DEFS[unit.type];
          const distance = distIn(unit.x, unit.y, order.x, order.y);
          if (!def.indirectFire || unit.ammoSpent || unitPaths.has(unit.id) ||
              distance < def.minRange || distance > def.range + 0.03) {
            addLog(`⚠️ ${pName(order.owner)} barrage canceled (artillery unavailable or target out of range).`, 'amber');
            continue;
          }
          unit.ammoSpent = true;
          unit.idleResupplyTurns = 0;
          const attack = rollDie(def.atk + scaling[unit.owner].unitCountAtkBonus + scaling[unit.owner].progressAtkBonus);
          addEffect({ type: 'boom', x: order.x, y: order.y, color: '#f97316', duration: 1100 }, [unit]);
          applyAreaBlast(unit.owner, order.x, order.y, def.blastRadius, attack, destroyedInStep2, 'BARRAGE', unit);
        }

        recordResolutionFrame();
        if (destroyedInStep2.size > 0) SFX.play('explode');
        else SFX.play('miss');

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
        addLog('Step 2: No units ordered to engage had a target in range.', 'slate');
      }
      for (const unit of state.entities) {
        if (unit.kind === 'unit' && unit.ammoSpent && unit.reserveAmmo > 0) {
          unit.reserveAmmo--;
          unit.ammoSpent = false;
          unit.idleResupplyTurns = 0;
        }
      }
      recordResolutionFrame();
      await sleep(950);

      // STEP 3: MISSILES & AIR DEFENSE INTERCEPTION
      highlightResStep(3);
      recordResolutionFrame();
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

          let missileRoll = rollDie(MISSILE_ATK);
          const interceptors = state.entities.filter(e =>
            e.kind === 'unit' &&
            e.owner !== m.owner &&
            ((e.type === 'air_def' && distIn(e.x, e.y, m.targetX, m.targetY) <= ESTABLISHED_ZONE_IN) ||
             (UNIT_DEFS[e.type].missileInterceptDie && state.entities.some(ship =>
               ship.kind === 'unit' && ship.owner === e.owner && UNIT_DEFS[ship.type].category === 'sea' &&
               distanceToEntity(m.targetX, m.targetY, ship) <= MISSILE_BLAST_RADIUS &&
               distIn(e.x, e.y, ship.x, ship.y) <= UNIT_DEFS[e.type].sonarRange)))
          );

          let interceptText = '';
          let intercepted = false;
          if (interceptors.length > 0) {
            const interceptDie = UNIT_DEFS[interceptors[0].type].missileInterceptDie || 4;
            const adRoll = rollDie(interceptDie);
            addEffect({
              type: 'beam', x1: interceptors[0].x, y1: interceptors[0].y,
              x2: m.targetX, y2: m.targetY, color: '#34d399', duration: 1000
            }, [interceptors[0]]);
            if (adRoll > missileRoll) {
              intercepted = true;
              interceptText = ` (Intercept D${interceptDie}=${adRoll} > ${missileRoll} — INTERCEPTED!)`;
            } else {
              missileRoll = Math.max(0, missileRoll - adRoll);
              interceptText = ` (Intercept D${interceptDie}=${adRoll} reduced Atk to ${missileRoll})`;
            }
          }

          if (intercepted) {
            SFX.play('miss');
            addEffect({ type: 'text', x: m.targetX, y: m.targetY - 0.35, text: '🛡️ INTERCEPTED!', color: '#34d399', duration: 1500 }, [interceptors[0]]);
            addLog(`🚀 <strong>MISSILE:</strong> ${pName(m.owner)} strike${interceptText}`, 'emerald', [interceptors[0]]);
          } else {
            SFX.play('explode');
            addEffect({ type: 'boom', x: m.targetX, y: m.targetY, color: '#ef4444', duration: 1000 });
            if (interceptors.length) {
              addLog(`🚀 <strong>MISSILE:</strong> ${pName(m.owner)} strike${interceptText}`, 'amber', [interceptors[0]]);
            }
            applyAreaBlast(m.owner, m.targetX, m.targetY, MISSILE_BLAST_RADIUS, missileRoll,
              destroyedByMissile, 'MISSILE', null, true);
          }
        }

        recordResolutionFrame();
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
      recordResolutionFrame();
      await sleep(800);

      // STEP 4: LOGISTICS, PRODUCTION, CONSTRUCTION & REPAIRS
      highlightResStep(4);
      recordResolutionFrame();

      for (const e of state.entities) {
        if (e.cooldown > 0) {
          e.cooldown--;
        }
        if (e.kind === 'unit') {
          if (e.ammoSpent && spentBeforeThisTurn.has(e.id) && !UNIT_DEFS[e.type].requiresRtbResupply && !UNIT_DEFS[e.type].requiresLogisticsResupply) {
            e.idleResupplyTurns++;
            if (e.idleResupplyTurns >= 2) {
              e.ammoSpent = false;
              e.idleResupplyTurns = 0;
              addEffect({ type: 'text', x: e.x, y: e.y - 0.35, text: 'IDLE RELOAD', color: '#34d399', duration: 1300 }, [e]);
              addLog(`🔋 ${pName(e.owner)} ${UNIT_DEFS[e.type].name} completed 2-turn Idle Resupply.`, 'emerald', [e]);
            }
          }
          e.secured = !movedUnitIds.has(e.id);
          if (UNIT_DEFS[e.type].transientUntilQuietMove && movedUnitIds.has(e.id) && !assignedAttackers.has(e.id)) e.submerged = true;
        }
      }

      for (const r of state.ruins) {
        if (r.cooldown > 0) r.cooldown--;
      }

      for (const p of [1, 2]) {
        for (const o of state.orders[p]) {
          if ((o.unitId != null && (!getEntityById(o.unitId) || getEntityById(o.unitId).owner !== p)) ||
              (o.baseId != null && (!getEntityById(o.baseId) || getEntityById(o.baseId).owner !== p))) {
            addLog(`⚠️ ${pName(p)} order canceled (referenced unit or facility destroyed).`, 'amber');
            continue;
          }
          if (o.type === 'PRODUCE') {
            const base = getEntityById(o.baseId);
            if (!base) {
              addLog(`⚠️ ${pName(p)} production canceled (facility destroyed).`, 'amber');
              continue;
            }
            const pt = findSpawnPointNear(base, o.unitType);
            if (!pt) {
              addLog(`⚠️ ${pName(p)} production canceled (no suitable spawn location).`, 'amber');
              continue;
            }
            const produced = spawnUnit(p, o.unitType, pt.x, pt.y);
            rememberProducedRally(p, base, produced);
            base.cooldown = Math.max(1, UNIT_DEFS[o.unitType].prodCooldown - scaling[p].cooldownReduction);
            const baseName = base.kind === 'unit' ? UNIT_DEFS[base.type].name : STRUCTURE_DEFS[base.type].name;
            addLog(`🏭 <strong>${pName(p)}</strong> produced <strong>${UNIT_DEFS[o.unitType].name}</strong> at ${baseName}.`, p === 1 ? 'p1' : 'p2', [produced]);
          } else if (o.type === 'DEPLOY_AD') {
            const base = getEntityById(o.baseId);
            if (!base) continue;
            const deployed = spawnUnit(p, 'air_def', o.x, o.y);
            rememberProducedRally(p, base, deployed);
            base.cooldown = Math.max(1, UNIT_DEFS.air_def.prodCooldown - scaling[p].cooldownReduction);
            addLog(`🛡️ <strong>${pName(p)}</strong> deployed <strong>Air Defense</strong> in 3" Established Zone.`, p === 1 ? 'p1' : 'p2', [deployed]);
          } else if (o.type === 'CONSTRUCT') {
            const unit = getEntityById(o.unitId);
            if (!unit || !unit.secured || !isLandForBase(unit.x, unit.y) ||
                !validSecondaryLocation(o.structType, unit.x, unit.y) ||
                (SECONDARY_BASE_TYPES.has(o.structType) && secondaryBaseCount(p) >= MAX_SECONDARY_BASES) ||
                (o.structType === 'port' && !isNearWater(unit.x, unit.y, 1.2))) {
              addLog(`⚠️ ${pName(p)} construction/conversion canceled (unit unavailable or location invalid).`, 'amber');
              continue;
            }
            const { x, y } = unit;
            state.entities = state.entities.filter(e => e.id !== unit.id);
            spawnStructure(p, o.structType, x, y, false);
            addEffect({ type: 'text', x, y: y - 0.35, text: 'BUILT!', color: '#38bdf8', duration: 1500 });
            addLog(`🏗️ <strong>${pName(p)}</strong> completed <strong>${STRUCTURE_DEFS[o.structType].name}</strong> at (${x.toFixed(1)}", ${y.toFixed(1)}").`, 'emerald');
          } else if (o.type === 'ROADBLOCK') {
            const unit = getEntityById(o.unitId);
            if (!unit || unit.owner !== p || distIn(unit.x, unit.y, o.x1, o.y1) > RESUPPLY_TOUCH_IN + 1e-9 ||
                distIn(o.x1, o.y1, o.x2, o.y2) < 0.01 ||
                distIn(o.x1, o.y1, o.x2, o.y2) > UNIT_DEFS.roadblock.maxBarrierLength + 1e-9) {
              addLog(`⚠️ ${pName(p)} roadblock deployment canceled (unit unavailable or out of range).`, 'amber');
              continue;
            }
            const roadblock = spawnUnit(p, 'roadblock', (o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2);
            Object.assign(roadblock, { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 });
            addLog(`🚧 ${pName(p)} deployed a roadblock.`, p === 1 ? 'p1' : 'p2', [roadblock]);
          } else if (o.type === 'BRIDGE') {
            const unit = getEntityById(o.unitId);
            if (!unit || unit.owner !== p || !UNIT_DEFS[unit.type].maxBridgeSpan ||
                !isValidBridge(unit, o.x, o.y, UNIT_DEFS[unit.type].maxBridgeSpan)) {
              addLog(`⚠️ ${pName(p)} bridge deployment canceled (unit unavailable or crossing invalid).`, 'amber');
              continue;
            }
            const bridge = spawnStructure(p, 'pontoon_bridge', (unit.x + o.x) / 2, (unit.y + o.y) / 2);
            Object.assign(bridge, { x1: unit.x, y1: unit.y, x2: o.x, y2: o.y });
            addLog(`🌉 ${pName(p)} deployed a pontoon bridge.`, p === 1 ? 'p1' : 'p2');
          } else if (o.type === 'REPAIR_MAIN') {
            const ruin = getRuinById(o.ruinId);
            if (!ruin || ruin.owner !== p || ruin.cooldown > 0) {
              addLog(`⚠️ ${pName(p)} repair canceled (ruin unavailable or not ready).`, 'amber');
              continue;
            }
            state.ruins = state.ruins.filter(r => r.id !== ruin.id);
            spawnStructure(p, 'main_base', ruin.x, ruin.y, ruin.isOriginalMain);
            addLog(`🔧 <strong>${pName(p)}</strong> reconstructed <strong>Main Base</strong>!`, 'emerald');
          } else if (o.type === 'REPAIR_UNIT') {
            const ruin = getRuinById(o.ruinId);
            const unit = getEntityById(o.unitId);
            if (!ruin || !unit || ruin.owner !== p || ruin.cooldown > 0 ||
                distIn(unit.x, unit.y, ruin.x, ruin.y) > 0.8 || !unit.secured ||
                (SECONDARY_BASE_TYPES.has(ruin.type) && secondaryBaseCount(p) >= MAX_SECONDARY_BASES)) {
              addLog(`⚠️ ${pName(p)} ruin repair canceled (unit or ruin unavailable).`, 'amber');
              continue;
            }
            state.ruins = state.ruins.filter(r => r.id !== ruin.id);
            spawnStructure(p, ruin.type, ruin.x, ruin.y, ruin.isOriginalMain);
            addLog(`🔧 <strong>${pName(p)}</strong> repaired <strong>${STRUCTURE_DEFS[ruin.type].name}</strong>!`, 'emerald');
          }
        }
      }

      if (state.turn % MISSILE_RESTOCK_TURNS === 0) {
        state.missiles[1]++;
        state.missiles[2]++;
        addLog('🚀 <strong>5-TURN RESTOCK:</strong> Both players received +1 Missile!', 'amber');
      }
      state.drones = state.drones.filter(d => d.expiresTurn > state.turn);
      recordResolutionFrame();

      state.orders[1] = [];
      state.orders[2] = [];
      await netSyncPoint();

      for (const p of [1, 2]) {
        state.unitGroups[p] = state.unitGroups[p].map(group => ({
          ...group, unitIds: group.unitIds.filter(id => {
            const unit = getEntityById(id);
            return unit && unit.kind === 'unit' && unit.owner === p;
          })
        })).filter(group => group.unitIds.length > 0);
        for (const id of Object.keys(state.rallyPoints[p])) {
          const facility = getEntityById(Number(id));
          if (!facility || facility.owner !== p) delete state.rallyPoints[p][id];
        }
        state.standingEngage[p] = state.standingEngage[p].filter(o => {
          const unit = getEntityById(o.unitId);
          return unit && unit.kind === 'unit' && unit.owner === p;
        });
        state.futurePlans[p] = state.futurePlans[p].filter(o => {
          const missing = (o.unitId != null && !getEntityById(o.unitId)) ||
            (o.baseId != null && !getEntityById(o.baseId)) || (o.ruinId != null && !getRuinById(o.ruinId));
          if (missing) logPlan(p, `Canceled future order: ${o.label} (referenced entity no longer exists).`, true);
          return !missing;
        });
      }

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
      startOnlineReview();
      updateUI();
      if (netActive() && NET.nextReady[1] && NET.nextReady[2]) beginNextTurn();
    }

    function beginNextTurn() {
      if (state.phase !== 'POST_RESOLUTION' || resolutionReplay.playback) return;
      for (const unit of state.entities) {
        if (unit.kind === 'unit') unit.revealedBuilding = null;
      }
      if (netActive()) {
        if (!NET.nextReady[1] || !NET.nextReady[2]) return;
        clearOnlineReview();
        NET.nextReady = { 1: false, 2: false };
        state.turn++;
        state.planCurrent = true;
        state.activePlayer = NET.role;
        state.phase = 'PLANNING';
        promoteDuePlans(NET.role, state.turn);
        rescheduleQueuedOrders(NET.role);
        applyPendingRallies(NET.role);
        document.getElementById('resolution-banner').classList.add('hidden');
        document.getElementById('btn-next-turn').classList.add('hidden');
        showToast(`Turn ${state.turn} — plan your secret orders.`, 'info');
        updateUI();
        netMaybeAutoPass();
        return;
      }
      state.turn++;
      state.planCurrent = true;
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
        promoteDuePlans(1, state.turn);
        rescheduleQueuedOrders(1);
        applyPendingRallies(1);
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
