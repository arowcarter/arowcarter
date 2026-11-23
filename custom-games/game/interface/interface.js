    // Map interaction, interface updates, and canvas rendering.
    // --- CANVAS HIT-TESTING & INTERACTION ---
    function findEntityAt(mx, my) {
      let best = null;
      // Scale hit radius cleanly so clicking icons at 1x zoom (68" map) or 8x zoom feels responsive
      let bestDist = Math.max(0.48, 16 / Math.max(1, ppi));
      for (const e of state.entities) {
        if (!isEntityVisible(e)) continue;
        const d = distanceToEntity(mx, my, e);
        if (d < bestDist) {
          bestDist = d;
          best = e;
        }
      }
      return best;
    }

    function findRuinAt(mx, my) {
      let best = null;
      let bestDist = Math.max(0.5, 16 / Math.max(1, ppi));
      for (const r of state.ruins) {
        const d = distIn(mx, my, r.x, r.y);
        if (d < bestDist) {
          bestDist = d;
          best = r;
        }
      }
      return best;
    }

    function processMapClick(clientX, clientY) {
      if (resolutionReplay.playback) return;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const mx = toMapX(px);
      const my = toMapY(py);
      if (mx < 0 || mx > MAP_W || my < 0 || my > MAP_H) return;

      if (state.phase === 'SETUP') {
        if (netActive()) {
          if (getSetupPlayer() !== NET.role) {
            showToast("Waiting for your opponent's deployment…", 'info');
            return;
          }
          const before = state.setupStep;
          handleSetupClick(mx, my);
          if (state.setupStep !== before) netSend({ t: 'setup', x: mx, y: my });
          return;
        }
        handleSetupClick(mx, my);
        return;
      }

      if (state.phase !== 'PLANNING' || (netActive() && NET.locked[NET.role])) {
        const clicked = findEntityAt(mx, my);
        state.selectedId = clicked ? clicked.id : null;
        updateUI();
        return;
      }

      const p = state.activePlayer;

      if (state.mode === 'RALLY') {
        const facility = getEntityById(state.selectedId);
        if (facility && facility.owner === p) {
          state.rallyPoints[p][facility.id] = { x: mx, y: my };
          showToast(`Rally point set at (${mx.toFixed(1)}", ${my.toFixed(1)}").`, 'success');
        }
        setMode('IDLE');
        return;
      }

      if (state.mode === 'GROUP_ROUTE') {
        const units = state.selectedUnitIds.map(getEntityById);
        queueGroupRoute(units, mx, my);
        return;
      }

      if (state.mode === 'ROUTE') {
        const unit = getEntityById(state.selectedId);
        if (unit && unit.kind === 'unit' && unit.owner === p) {
          let target = { x: mx, y: my };
          if (state.customMap && state.showPins && !isBuildingAt(target.x, target.y)) {
            const radius = Math.max(0.35, 12 / Math.max(1, ppi));
            const pins = state.customMap.pins.map(pin => ({
              x: (pin.col + 0.5) * MAP_W / state.customMap.cols,
              y: (pin.row + 0.5) * MAP_H / state.customMap.rows
            }));
            const nearest = pins.sort((a, b) => distIn(a.x, a.y, mx, my) - distIn(b.x, b.y, mx, my))[0];
            if (nearest && distIn(nearest.x, nearest.y, mx, my) <= radius) target = nearest;
          }
          queueRoute(unit, target.x, target.y);
        }
        return;
      }
      if (state.mode === 'BRIDGE') {
        const unit = getEntityById(state.selectedId);
        if (unit) queueBridge(unit, mx, my);
        return;
      }
      if (state.mode === 'ROADBLOCK') {
        const unit = getEntityById(state.selectedId);
        if (unit) {
          const from = getPlannedPos(unit, p);
          if (distIn(from.x, from.y, mx, my) > RESUPPLY_TOUCH_IN + 1e-9) {
            showToast('The first endpoint must be within 0.62" of the unit.', 'warn');
          } else {
            state.pendingRoadblockStart = { x: mx, y: my };
            setMode('ROADBLOCK_END', `CLICK THE SECOND ENDPOINT WITHIN ${UNIT_DEFS.roadblock.maxBarrierLength}"`);
          }
        }
        return;
      }
      if (state.mode === 'ROADBLOCK_END') {
        const unit = getEntityById(state.selectedId);
        const start = state.pendingRoadblockStart;
        if (unit && start) queueRoadblock(unit, start.x, start.y, mx, my);
        return;
      }
      if (state.mode === 'DRONE') {
        const unit = getEntityById(state.selectedId);
        if (unit) queueDrone(unit, mx, my);
        return;
      }
      if (state.mode === 'BARRAGE') {
        const unit = getEntityById(state.selectedId);
        if (unit) queueBarrage(unit, mx, my);
        return;
      }

      if (state.mode === 'MISSILE') {
        queueMissileOrder(mx, my);
        return;
      }

      if (state.mode === 'DEPLOY_AD_ZONE') {
        const base = getEntityById(state.pendingAdBaseId);
        if (base) queueDeployAdZone(base, mx, my);
        return;
      }

      if (state.mode === 'MOVE') {
        const sel = getEntityById(state.selectedId);
        if (sel && sel.kind === 'unit' && sel.owner === p) {
          queueMoveLeg(sel, mx, my);
          return;
        }
        setMode('IDLE');
      }

      const clickedEntity = findEntityAt(mx, my);
      if (clickedEntity) {
        state.selectedUnitIds = [];
        state.selectedId = clickedEntity.id;
        SFX.play('click');
        updateUI();
        return;
      }

      const clickedRuin = findRuinAt(mx, my);
      if (clickedRuin) {
        state.selectedUnitIds = [];
        state.selectedId = clickedRuin.id;
        SFX.play('click');
        updateUI();
        return;
      }

      const sel = getEntityById(state.selectedId);
      if (sel && sel.kind === 'unit' && sel.owner === p && UNIT_DEFS[sel.type].speed > 0) {
        selectAutomaticTurn(p, 'MOVE', MOVE_AP_COST, sel);
        const from = getPlannedPos(sel, p);
        const maxSpd = getLegSpeed(sel, from.x, from.y, mx, my);
        if (distIn(from.x, from.y, mx, my) <= maxSpd + 0.05) {
          queueMoveLeg(sel, mx, my);
          return;
        }
        resetPlanningTurn();
      }

      state.selectedId = null;
      state.selectedUnitIds = [];
      updateUI();
    }

    function handleCanvasClick(evt) {
      if (state.didDragPan || state.panToolActive || state.spaceDown) {
        state.didDragPan = false;
        return;
      }
      if (evt.shiftKey && state.phase === 'PLANNING' && state.mode === 'IDLE' &&
          !(netActive() && NET.locked[state.activePlayer])) {
        const rect = canvas.getBoundingClientRect();
        const unit = findEntityAt(toMapX(evt.clientX - rect.left), toMapY(evt.clientY - rect.top));
        if (unit && unit.kind === 'unit' && unit.owner === state.activePlayer) {
          const current = state.selectedUnitIds.length ? state.selectedUnitIds.slice() :
            (getEntityById(state.selectedId) && getEntityById(state.selectedId).owner === state.activePlayer ? [state.selectedId] : []);
          setSelectedUnits(current.includes(unit.id) ? current.filter(id => id !== unit.id) : [...current, unit.id]);
          return;
        }
      }
      processMapClick(evt.clientX, evt.clientY);
    }

    function updateTelemetryAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const mx = toMapX(px);
      const my = toMapY(py);
      if (mx >= 0 && mx <= MAP_W && my >= 0 && my <= MAP_H) {
        state.hoverMap = { x: mx, y: my };
        document.getElementById('tel-coords').textContent = `${mx.toFixed(2)}", ${my.toFixed(2)}"`;

        const tEl = document.getElementById('tel-terrain');
        if (state.customMap) {
          const cell = getCustomCellAt(mx, my);
          if (cell) {
            const labels = { W: 'WATER', G: 'GROUND', R: 'ROAD (+1")', B: 'BUILDING (IMPASSABLE)' };
            tEl.textContent = labels[cell.type] || 'GROUND';
            tEl.className = cell.type === 'W' ? 'text-sky-400'
              : cell.type === 'R' ? 'text-amber-300'
              : cell.type === 'B' ? 'text-rose-400 font-bold'
              : 'text-emerald-400';

            const elevStr = cell.bldgHeight > 0
              ? `${cell.totalElev.toFixed(0)} (G:${cell.groundElev.toFixed(0)} +B:${cell.bldgHeight.toFixed(0)})`
              : `${cell.totalElev.toFixed(0)}`;
            document.getElementById('tel-elev').textContent = elevStr;
          }
        } else {
          const terrain = isPointOnBridge(mx, my) ? 'BRIDGE (ROAD)' : (isPointInWater(mx, my) ? 'WATER' : (isOnRoad(mx, my) ? 'HIGHWAY (+1")' : 'LAND'));
          tEl.textContent = terrain;
          tEl.className = terrain.includes('WATER') ? 'text-sky-400' : (terrain.includes('HIGHWAY') || terrain.includes('BRIDGE') ? 'text-amber-300' : 'text-emerald-400');
        }

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

    function handleCanvasMove(evt) {
      updateTelemetryAt(evt.clientX, evt.clientY);
    }

    // --- UI RENDERING ---
    function updateUI() {
      const p = state.activePlayer;
      const remAP = getRemainingAP(p, state.turn);
      const queuedAP = getQueuedAP(p, state.turn);
      const planningTurn = state.turn;
      document.querySelectorAll('#combat-log [data-viewers]').forEach(entry => {
        entry.hidden = !entry.dataset.viewers.split(',').includes(String(fogViewer()));
      });
      const reviewBtn = document.getElementById('btn-review-player');
      reviewBtn.classList.toggle('hidden', netActive() || (state.phase !== 'POST_RESOLUTION' && state.phase !== 'GAMEOVER'));
      reviewBtn.disabled = !!resolutionReplay.playback;
      reviewBtn.textContent = `Pass to ${pName(p === 1 ? 2 : 1)} to Review`;
      const replayBtn = document.getElementById('btn-replay-resolution');
      replayBtn.classList.toggle('hidden', resolutionReplay.frames.length < 2 || (state.phase !== 'POST_RESOLUTION' && state.phase !== 'GAMEOVER'));
      replayBtn.disabled = !!resolutionReplay.playback || (netActive() && state.phase === 'POST_RESOLUTION' && NET.nextReady[NET.role]);
      const victoryBtn = document.getElementById('btn-victory-result');
      victoryBtn.classList.toggle('hidden', state.phase !== 'GAMEOVER');
      victoryBtn.disabled = !!resolutionReplay.playback;
      const nextBtn = document.getElementById('btn-next-turn');
      nextBtn.disabled = !!resolutionReplay.playback || (netActive() && NET.nextReady[NET.role]);
      const reviewSeconds = onlineReview.deadline === null ? null : Math.max(0, Math.ceil((onlineReview.deadline - performance.now()) / 1000));
      nextBtn.textContent = netActive()
        ? (NET.nextReady[NET.role] ? 'Waiting for opponent…' :
          reviewSeconds === 0 && resolutionReplay.playback ? 'Ready after replay…' :
          reviewSeconds !== null ? `Ready for Next Turn (${reviewSeconds}s) ▶` : 'Ready for Next Turn ▶')
        : 'Begin Next Turn (Pass to P1) ▶';

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
      if (netActive() && state.phase === 'PLANNING') {
        phaseBadge.textContent += NET.locked[netPeerRole()] ? ' • OPPONENT LOCKED ✓' : ' • OPPONENT PLANNING…';
      }
      pTxt.textContent = (netActive() ? 'YOU: ' : '') + pTxt.textContent;

      document.getElementById('hud-turn').textContent = state.turn;
      const turnsToRestock = MISSILE_RESTOCK_TURNS - ((state.turn - 1) % MISSILE_RESTOCK_TURNS);
      document.getElementById('hud-restock').textContent = `In ${turnsToRestock}t`;

      const pipsEl = document.getElementById('hud-ap-pips');
      pipsEl.innerHTML = '';
      for (let i = 0; i < getMaxAP(planningTurn); i++) {
        const pip = document.createElement('div');
        if (i < remAP) pip.className = `ap-pip ${p === 1 ? 'active-p1' : 'active-p2'}`;
        else if (i < remAP + queuedAP) pip.className = 'ap-pip queued';
        else pip.className = 'ap-pip empty';
        pipsEl.appendChild(pip);
      }
      document.getElementById('hud-ap-text').textContent = `${remAP}/${getMaxAP(planningTurn)}`;

      const availM = getAvailableMissiles(p);
      document.getElementById('hud-missiles').textContent = availM;
      document.getElementById('btn-launch-missile').disabled = state.phase !== 'PLANNING' || availM < 1 || (netActive() && NET.locked[p]);

      const lockBtn = document.getElementById('btn-lock-orders');
      const autoPassBtn = document.getElementById('btn-auto-pass');
      const warnAPBtn = document.getElementById('btn-warn-unused-ap');
      autoPassBtn.classList.toggle('hidden', !netActive());
      warnAPBtn.classList.toggle('hidden', !netActive());
      autoPassBtn.textContent = `Auto-pass: ${NET.autoPass ? 'ON' : 'OFF'}`;
      autoPassBtn.setAttribute('aria-pressed', String(NET.autoPass));
      warnAPBtn.textContent = `AP warning: ${NET.warnUnusedAP ? 'ON' : 'OFF'}`;
      warnAPBtn.setAttribute('aria-pressed', String(NET.warnUnusedAP));
      lockBtn.disabled = state.phase !== 'PLANNING' || (netActive() && NET.locked[NET.role]);
      lockBtn.textContent = netActive()
        ? (NET.locked[NET.role] ? 'Locked — waiting… ⏳' : 'Lock Orders 🔒')
        : (p === 1 ? 'Lock P1 Orders 🔒' : 'Lock P2 & Resolve ⚡');

      if (state.phase === 'SETUP') {
        const sp = getSetupPlayer();
        const num = state.setupStep < 2 ? 1 : 2;
        document.getElementById('setup-instruction').textContent =
          `${pName(sp)}: Place Original Main Base #${num} on walkable dry land within ${EDGE_DEPLOY_IN.toFixed(1)}" of any map edge.`;
      }

      const p1B = state.entities.filter(e => e.kind === 'structure' && e.owner === 1 && e.isOriginalMain).length;
      const p2B = state.entities.filter(e => e.kind === 'structure' && e.owner === 2 && e.isOriginalMain).length;
      document.getElementById('tel-p1-bases').textContent = `${p1B}/2`;
      document.getElementById('tel-p2-bases').textContent = `${p2B}/2`;

      renderInspector();
      renderOrderQueue();
      renderGroupControls();
    }

    function setSelectedUnits(ids) {
      const p = state.activePlayer;
      state.selectedUnitIds = [...new Set(ids)].filter(id => {
        const unit = getEntityById(id);
        return unit && unit.kind === 'unit' && unit.owner === p;
      });
      state.selectedId = state.selectedUnitIds.length === 1 ? state.selectedUnitIds[0] : null;
      updateUI();
    }

    function renderGroupControls() {
      const p = state.activePlayer;
      const canAct = state.phase === 'PLANNING' && !(netActive() && NET.locked[p]);
      const selected = state.selectedUnitIds.length;
      document.getElementById('group-controls').classList.toggle('hidden', state.phase !== 'PLANNING');
      document.getElementById('group-selection-count').textContent = `${selected} unit(s) selected`;
      const list = document.getElementById('group-list'), previous = list.value;
      list.innerHTML = '';
      for (const group of state.unitGroups[p]) {
        const option = document.createElement('option');
        option.value = String(group.id);
        option.textContent = `${group.name} (${group.unitIds.length})`;
        list.appendChild(option);
      }
      if (state.unitGroups[p].some(group => String(group.id) === previous)) list.value = previous;
      document.getElementById('group-save').disabled = !canAct || selected === 0;
      document.getElementById('group-move').disabled = !canAct || selected === 0;
      document.getElementById('group-load').disabled = !canAct || !state.unitGroups[p].length;
      document.getElementById('group-delete').disabled = !canAct || !state.unitGroups[p].length;
      document.getElementById('group-name').disabled = !canAct;
      list.disabled = !canAct || !state.unitGroups[p].length;
    }

    function rallyControlsMarkup(facility, player) {
      const target = state.rallyPoints[player][facility.id];
      const disabled = netActive() && NET.locked[player] ? 'disabled' : '';
      return `<div class="text-[10px] text-slate-400 mt-1">Rally: ${target ? `(${target.x.toFixed(1)}", ${target.y.toFixed(1)}")` : 'not set'}</div>
        <div class="flex gap-1 mb-1">
          <button data-rally="set" ${disabled} class="tac-btn flex-1 py-1 rounded bg-teal-700 text-white text-[10px] font-bold">Set Rally Point</button>
          ${target ? `<button data-rally="clear" ${disabled} class="tac-btn px-2 py-1 rounded bg-slate-700 text-white text-[10px] font-bold">Clear</button>` : ''}
        </div>`;
    }

    function renderInspector() {
      const box = document.getElementById('inspector-content');
      const badge = document.getElementById('inspector-owner-badge');
      const p = state.activePlayer;
      const remAP = getRemainingAP(p);

      const ent = getEntityById(state.selectedId);
      const ruin = !ent ? getRuinById(state.selectedId) : null;

      if (state.selectedUnitIds.length > 1 && state.phase === 'PLANNING') {
        badge.textContent = `${state.selectedUnitIds.length} UNITS`;
        badge.className = 'text-[10px] font-mono-tac px-2 py-0.5 rounded bg-teal-900/70 text-teal-300 border border-teal-500/40';
        box.textContent = 'Save this selection as a named group or plot a formation move.';
        return;
      }

      if (!ent && !ruin) {
        badge.textContent = 'NO SELECTION';
        badge.className = 'text-[10px] font-mono-tac px-2 py-0.5 rounded bg-slate-800 text-slate-400';
        box.innerHTML = `
          <div class="text-slate-400 leading-relaxed">
            Click any unit, structure, or ruin on the map to inspect stats and queue orders.<br/>
            <span class="text-sky-300 font-semibold">Tip:</span> Select a friendly unit and click within its movement ring to schedule a free move.
          </div>`;
        return;
      }

      if (ruin) {
        const sDef = STRUCTURE_DEFS[ruin.type];
        badge.textContent = `${pName(ruin.owner)} RUIN`;
        badge.className = 'text-[10px] font-mono-tac px-2 py-0.5 rounded bg-amber-900/60 text-amber-300 border border-amber-500/40';
        const canRepairMain = state.phase === 'PLANNING' && ruin.owner === p && ruin.type === 'main_base';
        const nearbyRepairUnit = state.entities.find(u =>
          u.kind === 'unit' && u.owner === p && (u.type === 'infantry' || u.type === 'specops') &&
          distIn(getProjectedPosAtTurn(u, p, Infinity).x, getProjectedPosAtTurn(u, p, Infinity).y, ruin.x, ruin.y) <= 0.8
        );
        const canRepairGen = state.phase === 'PLANNING' && ruin.owner === p && ruin.type !== 'main_base' && !!nearbyRepairUnit;

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
        const hasBarrage = getOrdersForTurn(p).some(o => o.type === 'BARRAGE' && o.unitId === ent.id);
        const canMove = canAct && def.speed > 0 && !(netActive() && NET.locked[p]);
        const canRoute = canAct && def.speed > 0 && !(netActive() && NET.locked[p]);
        const unavailableAmmo = false;
        const scaling = getLinearScaling(ent.owner, getPlanningTurn());
        const displayedSpeed = isOwn ? +(def.speed * scaling.moveSpeedScale).toFixed(2) : def.speed;
        const displayedAttack = isOwn && def.atk > 0 ? def.atk + scaling.unitCountAtkBonus + scaling.progressAtkBonus : def.atk;
        const canBuild = canAct && def.category === 'land' && !def.deployable && !(netActive() && NET.locked[p]);

        box.innerHTML = `
          <div class="flex items-center justify-between mb-1">
            <span class="font-extrabold text-sm text-slate-100">${def.name} <span class="text-[10px] font-mono-tac text-slate-400">(${def.shape})</span></span>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-mono-tac font-bold ${ent.ammoSpent ? 'bg-rose-900/80 text-rose-300 border border-rose-500/50' : 'bg-emerald-900/80 text-emerald-300 border border-emerald-500/50'}">
              ${ent.ammoSpent ? (def.requiresRtbResupply ? 'SPENT (RETURN TO AIR BASE)' : def.requiresLogisticsResupply ? 'SPENT (RETURN TO BASE/HUB)' : `SPENT (${ent.idleResupplyTurns}/2t)`) : 'LOADED'}
            </span>
          </div>
          <div class="grid grid-cols-4 gap-1 font-mono-tac text-[10px] bg-slate-900/80 rounded-lg p-1.5 mb-2 text-center">
            <div><div class="text-slate-500">SPD</div><div class="text-slate-100 font-bold">${displayedSpeed}"</div></div>
            <div><div class="text-slate-500">HP</div><div class="text-slate-100 font-bold">d${def.hp}</div></div>
            <div><div class="text-slate-500">ATK</div><div class="text-amber-300 font-bold">d${displayedAttack}</div></div>
            <div><div class="text-slate-500">RNG</div><div class="text-rose-300 font-bold">${def.range}"</div></div>
          </div>
          <div class="flex items-center justify-between text-[10px] font-mono-tac mb-2">
            <span class="${ent.secured ? 'text-emerald-400' : 'text-slate-400'}">${ent.secured ? '✓ Ground Secured' : '○ Not Secured Yet'}</span>
            ${legs > 0 ? `<span class="text-amber-300 font-bold">Move Queued</span>` : ''}
          </div>
          <p class="text-[11px] text-slate-400 mb-2 leading-snug">${def.notes}</p>
          ${def.maxResupplyCharges && isOwn ? `<p class="text-[11px] text-emerald-300 mb-2">Ammo charges: ${ent.resupplyCharges}/${def.maxResupplyCharges}</p>` : ''}
          ${ent.reserveAmmo && isOwn ? `<p class="text-[11px] text-emerald-300 mb-2">Reserve ammo: ${ent.reserveAmmo}</p>` : ''}
          ${canAct ? `
            <div class="space-y-1.5">
              <button id="act-move-leg" ${canMove ? '' : 'disabled'} class="tac-btn w-full py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-bold text-xs">
                🧭 Plot Move (0 AP)
              </button>
              <button id="act-route" ${canRoute ? '' : 'disabled'} class="tac-btn w-full py-1.5 rounded-lg bg-teal-700 hover:bg-teal-600 text-white font-bold text-xs">🗺️ Route to Pin / Target</button>
              ${def.indirectFire ? `
              <button id="act-barrage" ${(netActive() && NET.locked[p]) ? 'disabled' : ''} class="tac-btn w-full py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-bold text-xs">🎯 Plot Barrage (${def.actionCost} AP)</button>` : `
              <button id="act-engage" ${def.atk <= 0 || unavailableAmmo || (netActive() && NET.locked[p]) ? 'disabled' : ''} class="tac-btn w-full py-1.5 rounded-lg ${hasEngageOrder(ent.id, p) ? 'bg-rose-600 hover:bg-rose-500' : 'bg-slate-700 hover:bg-slate-600'} text-white font-bold text-xs">
                ${hasEngageOrder(ent.id, p) ? '🎯 STANDING ENGAGE — click to cancel' : `🎯 Standing Engage (${ENGAGE_AP_COST} AP)`}
              </button>`}
              ${def.droneRange ? `<button id="act-drone" ${(netActive() && NET.locked[p]) ? 'disabled' : ''} class="tac-btn w-full py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white font-bold text-xs">🛰️ Launch Drone (${def.actionCost} AP)</button>` : ''}
              ${def.maxBridgeSpan ? `<button id="act-bridge" ${(netActive() && NET.locked[p]) ? 'disabled' : ''} class="tac-btn w-full py-1.5 rounded-lg bg-teal-700 hover:bg-teal-600 text-white font-bold text-xs">🌉 Deploy Bridge (${def.actionCost} AP)</button>` : ''}
              ${def.category === 'land' && ent.type !== 'roadblock' ? `<button id="act-roadblock" ${(netActive() && NET.locked[p]) ? 'disabled' : ''} class="tac-btn w-full py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-bold text-xs">🚧 Place Roadblock (2 AP)</button>` : ''}
              ${def.canProduceAir ? `
                ${rallyControlsMarkup(ent, p)}
                <div class="text-[10px] text-slate-400">Production queue: ${facilityQueueCount(ent.id, p)}/${MAX_FACILITY_QUEUE}</div>
                <div class="grid grid-cols-2 gap-1">
                  ${['plane', 'strategic_bomber'].map(ut => `<div class="flex gap-1"><button data-prod="${ut}" ${!(netActive() && NET.locked[p]) && facilityQueueCount(ent.id, p) < MAX_FACILITY_QUEUE ? '' : 'disabled'} class="tac-btn flex-1 py-1 rounded bg-indigo-900/80 text-indigo-100 text-[10px] font-bold">+ ${UNIT_DEFS[ut].name}</button><button data-autoprod="${ut}" ${!(netActive() && NET.locked[p]) && facilityQueueCount(ent.id, p) < MAX_FACILITY_QUEUE ? '' : 'disabled'} class="tac-btn px-1 rounded bg-indigo-700 text-indigo-100 text-[10px] font-bold" title="Fill production queue">Fill</button></div>`).join('')}
                </div>
                <div class="text-[10px] text-slate-400">Air production cooldown: ${ent.cooldown} turn(s)</div>` : ''}
              ${ent.type === 'infantry' ? `
                <button id="act-convert-hub" ${canBuild ? '' : 'disabled'} class="tac-btn w-full py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs">
                  ⛽ Convert Infantry → Resupply Hub (4 AP)
                </button>` : ''}
              ${def.category === 'land' && !def.deployable ? `
                <div class="grid grid-cols-2 gap-1 pt-0.5">
                  <button data-build="major_base" ${canBuild ? '' : 'disabled'} class="tac-btn py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold">Major Base (4 AP)</button>
                  <button data-build="minor_base" ${canBuild ? '' : 'disabled'} class="tac-btn py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold">Minor Base (4 AP)</button>
                  <button data-build="air_base" ${canBuild ? '' : 'disabled'} class="tac-btn py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold">Air Base (4 AP)</button>
                  <button data-build="port" ${canBuild && isNearWater(getProjectedPosAtTurn(ent, p, Infinity).x, getProjectedPosAtTurn(ent, p, Infinity).y, 1.2) ? '' : 'disabled'} class="tac-btn py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold">Port (4 AP)</button>
                </div>` : ''}
            </div>
          ` : ''}
        `;

        if (canMove) {
          document.getElementById('act-move-leg').onclick = () => {
            selectAutomaticTurn(p, 'MOVE', MOVE_AP_COST, ent);
            setMode('MOVE', 'CLICK WITHIN RANGE TO SCHEDULE A FREE MOVE');
          };
        }
        if (canRoute) document.getElementById('act-route').onclick = () =>
          setMode('ROUTE', 'CLICK A PIN OR DESTINATION TO PLAN A ROUTE');
        const engBtn = document.getElementById('act-engage');
        if (engBtn) engBtn.onclick = () => toggleEngageOrder(ent);
        const barrageBtn = document.getElementById('act-barrage');
        if (barrageBtn) barrageBtn.onclick = () => {
          selectAutomaticTurn(p, 'BARRAGE', def.actionCost, ent);
          setMode('BARRAGE', 'CLICK A BARRAGE TARGET WITHIN 1"–3" OF THE ARTILLERY');
        };
        const droneBtn = document.getElementById('act-drone');
        if (droneBtn) droneBtn.onclick = () => {
          selectAutomaticTurn(p, 'DRONE', def.actionCost, ent);
          setMode('DRONE', `CLICK A DRONE POSITION WITHIN ${def.droneRange}" OF THE OPERATOR`);
        };
        const roadblockBtn = document.getElementById('act-roadblock');
        if (roadblockBtn) roadblockBtn.onclick = () => {
          selectAutomaticTurn(p, 'ROADBLOCK', UNIT_DEFS.roadblock.actionCost, ent);
          setMode('ROADBLOCK', 'CLICK THE FIRST ENDPOINT WITHIN 0.62" OF THE UNIT');
        };
        const bridgeBtn = document.getElementById('act-bridge');
        if (bridgeBtn) bridgeBtn.onclick = () => {
          selectAutomaticTurn(p, 'BRIDGE', def.actionCost, ent);
          setMode('BRIDGE', `CLICK LAND ACROSS WATER WITHIN ${def.maxBridgeSpan}"`);
        };
        const hubBtn = document.getElementById('act-convert-hub');
        if (hubBtn && canBuild) {
          hubBtn.onclick = () => queueConstructOrder(ent, 'resupply_hub');
        }
        box.querySelectorAll('[data-build]').forEach(btn => {
          btn.onclick = () => queueConstructOrder(ent, btn.dataset.build);
        });
        box.querySelectorAll('[data-prod]').forEach(btn => {
          btn.onclick = () => queueProduceOrder(ent, btn.dataset.prod);
        });
        box.querySelectorAll('[data-autoprod]').forEach(btn => {
          btn.onclick = () => fillProductionQueue(ent, btn.dataset.autoprod);
        });
      } else {
        const def = STRUCTURE_DEFS[ent.type];
        const canAct = state.phase === 'PLANNING' && isOwn;
        const busy = (ent.cooldown > 0 && getPlanningTurn() === state.turn) || isFacilityQueued(ent.id, p);
        const canProd = canAct && !(netActive() && NET.locked[p]);

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
            ${rallyControlsMarkup(ent, p)}
            <div class="text-[10px] font-mono-tac uppercase text-slate-400 mb-1">Produce Unit (2 AP) • Queue ${facilityQueueCount(ent.id, p)}/${MAX_FACILITY_QUEUE}:</div>
            <div class="grid grid-cols-2 gap-1">
              ${def.produces.map(ut => `
                <div class="flex gap-1"><button data-prod="${ut}" ${canProd && PLAYABLE_UNITS.has(ut) && facilityQueueCount(ent.id, p) < MAX_FACILITY_QUEUE ? '' : 'disabled'} class="tac-btn flex-1 py-1.5 px-1.5 rounded bg-indigo-900/80 hover:bg-indigo-800 text-indigo-100 text-[10px] font-bold">
                  + ${UNIT_DEFS[ut].name} ${PLAYABLE_UNITS.has(ut) ? `(${UNIT_DEFS[ut].prodCooldown}t)` : '(not implemented)'}
                </button><button data-autoprod="${ut}" ${canProd && PLAYABLE_UNITS.has(ut) && facilityQueueCount(ent.id, p) < MAX_FACILITY_QUEUE ? '' : 'disabled'} class="tac-btn px-1 rounded bg-indigo-700 text-indigo-100 text-[10px] font-bold" title="Fill production queue">Fill</button></div>`).join('')}
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
        box.querySelectorAll('[data-autoprod]').forEach(btn => {
          btn.onclick = () => fillProductionQueue(ent, btn.dataset.autoprod);
        });
        const adBtn = document.getElementById('act-ad-zone');
        if (adBtn && canProd) {
          adBtn.onclick = () => {
            state.pendingAdBaseId = ent.id;
            setMode('DEPLOY_AD_ZONE', 'CLICK LAND WITHIN 3" ESTABLISHED ZONE TO DEPLOY AIR DEFENSE');
          };
        }
      }
      box.querySelectorAll('[data-rally]').forEach(btn => {
        btn.onclick = () => {
          if (state.phase !== 'PLANNING' || ent.owner !== state.activePlayer ||
              (netActive() && NET.locked[state.activePlayer])) return;
          if (btn.dataset.rally === 'clear') {
            delete state.rallyPoints[p][ent.id];
            updateUI();
          } else {
            setMode('RALLY', 'CLICK A DESTINATION FOR NEWLY PRODUCED UNITS');
          }
        };
      });
    }

    function renderOrderQueue() {
      const p = state.activePlayer;
      const list = [
        ...state.standingEngage[p].map(order => ({ order, standing: true })),
        ...allQueuedOrders(p).filter(entry => !entry.order.standingOrder)
      ];
      document.getElementById('queue-count').textContent = list.length;
      const el = document.getElementById('order-queue-list');
      if (state.phase !== 'PLANNING') {
        el.innerHTML = '<div class="text-slate-500 italic">Order queue active during Planning Phase.</div>';
        return;
      }
      if (list.length === 0) {
        el.innerHTML = `<div class="text-slate-500 italic">No secret orders queued yet. (${getRemainingAP(p)} AP available)</div>`;
        return;
      }
      el.innerHTML = list.map(({ order: o, turn, standing }, idx) => `
        <div class="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-900/80 border border-slate-700/70">
          <span class="truncate text-slate-200">${idx + 1}. [${standing ? 'STANDING' : `T${turn}${o.invalid ? ' • deferred' : ''}`}] ${o.label}</span>
          <span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold flex-shrink-0">${o.cost} AP</span>
          <button data-remove-order="${o.id}" class="text-rose-300 font-bold" title="${o.groupRouteId != null ? 'Remove group route' : 'Remove order'}">✕</button>
        </div>
      `).join('');
      el.querySelectorAll('[data-remove-order]').forEach(button => {
        button.onclick = () => {
          if (state.phase !== 'PLANNING' || (netActive() && NET.locked[p])) return;
          removeQueuedOrder(p, Number(button.dataset.removeOrder));
          updateUI();
        };
      });
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
      // Crisp, readable icon scaling across 1x-8x zoom on 68"x44" maps
      const s = Math.max(7.5, Math.min(20, ppi * 0.24));

      ctx.fillStyle = fill;
      ctx.strokeStyle = '#090e1a';
      ctx.lineWidth = 2;

      if (e.kind === 'structure') {
        const bs = s * 1.38;
        if (e.type === 'pontoon_bridge') {
          ctx.beginPath(); ctx.moveTo(toPxX(e.x1), toPxY(e.y1)); ctx.lineTo(toPxX(e.x2), toPxY(e.y2));
          ctx.strokeStyle = '#090e1a'; ctx.lineWidth = Math.max(5, ppi * 0.65); ctx.stroke();
          ctx.strokeStyle = fill; ctx.lineWidth = Math.max(3, ppi * 0.42); ctx.stroke();
        } else if (e.type === 'main_base') {
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
          ctx.beginPath(); ctx.arc(px, py, bs * 0.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(px, py, bs * 0.38, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        } else if (e.type === 'port') {
          drawStar(px, py, 5, bs * 1.05, bs * 0.48); ctx.fill(); ctx.stroke();
        } else if (e.type === 'air_base') {
          drawHeart(px, py, bs * 0.95); ctx.fill(); ctx.stroke();
        } else if (e.type === 'resupply_hub') {
          ctx.beginPath();
          ctx.arc(px, py + bs * 0.12, bs * 0.68, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#fde68a';
          ctx.fillRect(px - bs * 0.45, py - bs * 0.65, bs * 0.9, bs * 0.28);
          ctx.strokeRect(px - bs * 0.45, py - bs * 0.65, bs * 0.9, bs * 0.28);
        }
      } else {
        if (e.type === 'infantry') {
          ctx.fillRect(px - s * 0.72, py - s * 0.72, s * 1.44, s * 1.44);
          ctx.strokeRect(px - s * 0.72, py - s * 0.72, s * 1.44, s * 1.44);
        } else if (e.type === 'specops') {
          ctx.beginPath();
          ctx.ellipse(px, py, s * 0.68, s * 0.92, 0, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        } else if (e.type === 'light_veh') {
          ctx.beginPath(); ctx.arc(px, py, s * 0.75, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        } else if (e.type === 'heavy_veh') {
          ctx.beginPath(); ctx.arc(px, py, s * 1.02, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(px, py, s * 0.52, 0, Math.PI * 2); ctx.fillStyle = dark; ctx.fill();
        } else if (e.type === 'air_def') {
          ctx.beginPath();
          ctx.arc(px, py, s * 0.85, Math.PI, 0);
          ctx.lineTo(px + s * 0.85, py + s * 0.65);
          ctx.lineTo(px - s * 0.85, py + s * 0.65);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
          ctx.strokeStyle = dark; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px - s * 0.65, py + s * 0.1); ctx.lineTo(px + s * 0.65, py + s * 0.1); ctx.stroke();
        } else if (e.type === 'plane') {
          drawHeart(px, py, s * 0.92); ctx.fill(); ctx.stroke();
        } else if (e.type === 'ship') {
          drawStar(px, py, 5, s * 0.95, s * 0.42); ctx.fill(); ctx.stroke();
        } else if (e.type === 'artillery') {
          ctx.beginPath();
          ctx.moveTo(px, py - s);
          ctx.lineTo(px + s, py + s * 0.8);
          ctx.lineTo(px - s, py + s * 0.8);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
        } else if (e.type === 'sniper_team') {
          ctx.beginPath();
          ctx.moveTo(px, py - s);
          ctx.lineTo(px + s * 0.75, py);
          ctx.lineTo(px, py + s);
          ctx.lineTo(px - s * 0.75, py);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
        } else if (e.type === 'strategic_bomber') {
          ctx.beginPath();
          ctx.moveTo(px, py - s);
          ctx.lineTo(px + s * 1.3, py + s * 0.7);
          ctx.lineTo(px, py + s * 0.25);
          ctx.lineTo(px - s * 1.3, py + s * 0.7);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
        } else if (e.type === 'drone_operator') {
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const x = px + Math.cos(i * Math.PI / 3) * s, y = py + Math.sin(i * Math.PI / 3) * s;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (e.type === 'aircraft_carrier') {
          ctx.beginPath(); ctx.ellipse(px, py, s * 1.4, s * 0.55, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        } else if (e.type === 'asw_corvette') {
          ctx.beginPath(); ctx.moveTo(px + s, py); ctx.lineTo(px - s, py - s * 0.65); ctx.lineTo(px - s, py + s * 0.65); ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (e.type === 'attack_submarine') {
          ctx.beginPath(); ctx.ellipse(px, py, s * 1.2, s * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        } else if (e.type === 'roadblock') {
          if (e.x1 != null && e.y1 != null && e.x2 != null && e.y2 != null) {
            ctx.beginPath(); ctx.moveTo(toPxX(e.x1), toPxY(e.y1)); ctx.lineTo(toPxX(e.x2), toPxY(e.y2));
            ctx.strokeStyle = '#090e1a'; ctx.lineWidth = Math.max(5, ppi * 0.18); ctx.stroke();
            ctx.strokeStyle = fill; ctx.lineWidth = Math.max(3, ppi * 0.1); ctx.stroke();
          } else {
            ctx.fillRect(px - s, py - s * 0.35, s * 2, s * 0.7);
            ctx.strokeRect(px - s, py - s * 0.35, s * 2, s * 0.7);
          }
        } else if (e.type === 'ammo_convoy') {
          ctx.beginPath(); ctx.ellipse(px, py, s * 0.75, s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        } else if (e.type === 'bridgelayer') {
          ctx.beginPath(); ctx.moveTo(px - s, py + s * 0.65); ctx.lineTo(px - s * 0.65, py - s * 0.65);
          ctx.lineTo(px + s * 0.65, py - s * 0.65); ctx.lineTo(px + s, py + s * 0.65);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }

      ctx.restore();
    }

    function renderFrame(now) {
      let replayFrame = null;
      let visualNow = now;
      const playback = resolutionReplay.playback;
      if (playback) {
        const frames = resolutionReplay.frames;
        const elapsed = Math.max(0, now - playback.start);
        if (elapsed >= frames[frames.length - 1].time) {
          resolutionReplay.playback = null;
          highlightResStep(4);
          updateUI();
          if (onlineReview.deadline !== null) updateOnlineReview();
        } else {
          while (playback.index + 1 < frames.length && frames[playback.index + 1].time <= elapsed) playback.index++;
          replayFrame = frames[playback.index];
          visualNow = resolutionReplay.start + elapsed;
          if (playback.step !== replayFrame.step) {
            playback.step = replayFrame.step;
            highlightResStep(replayFrame.step);
          }
        }
      }
      const renderEntities = replayFrame ? replayFrame.entities : state.entities;
      const renderRuins = replayFrame ? replayFrame.ruins : state.ruins;
      const renderDestroyedBuildings = replayFrame ? replayFrame.destroyedBuildings : state.destroyedBuildings;
      const renderDrones = replayFrame ? replayFrame.drones : state.drones;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const mapPxW = MAP_W * ppi;
      const mapPxH = MAP_H * ppi;

      // 1. Terrain Layer: Custom Offscreen Map OR Default 11x17" Map
      if (state.customMap && state.customMap.offscreenCanvas) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(state.customMap.offscreenCanvas, offsetX, offsetY, mapPxW, mapPxH);
        const destroyed = replayFrame ? replayFrame.destroyedBuildings : state.destroyedBuildings;
        const cm = state.customMap;
        ctx.fillStyle = '#6b5b4b';
        for (const idx of destroyed) {
          const col = idx % cm.cols, row = Math.floor(idx / cm.cols);
          ctx.fillRect(toPxX(col * MAP_W / cm.cols), toPxY(row * MAP_H / cm.rows),
            MAP_W / cm.cols * ppi + 0.5, MAP_H / cm.rows * ppi + 0.5);
        }
        if (state.showBuildingBoxes) {
          const rubble = new Set(destroyed);
          ctx.strokeStyle = 'rgba(255, 218, 112, 0.8)';
          ctx.lineWidth = 1;
          const cellW = MAP_W / cm.cols, cellH = MAP_H / cm.rows;
          ctx.beginPath();
          for (const { idx, mask } of cm.buildingEdges) {
            if (rubble.has(idx)) continue;
            const x = toPxX((idx % cm.cols) * cellW), y = toPxY(Math.floor(idx / cm.cols) * cellH);
            const w = cellW * ppi, h = cellH * ppi;
            if (mask & 1) { ctx.moveTo(x, y); ctx.lineTo(x + w, y); }
            if (mask & 2) { ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); }
            if (mask & 4) { ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); }
            if (mask & 8) { ctx.moveTo(x, y); ctx.lineTo(x, y + h); }
          }
          ctx.stroke();
        }
        ctx.restore();
      } else {
        ctx.fillStyle = '#152232';
        ctx.fillRect(offsetX, offsetY, mapPxW, mapPxH);

        // Water Polygons
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

        // Bridges
        ctx.save();
        for (const b of BRIDGES) {
          ctx.fillStyle = '#334155';
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1.5;
          ctx.fillRect(toPxX(b.x), toPxY(b.y), b.w * ppi, b.h * ppi);
          ctx.strokeRect(toPxX(b.x), toPxY(b.y), b.w * ppi, b.h * ppi);
        }
        ctx.restore();

        // Highways (+1" Road Bonus)
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
      }

      // Setup Outskirts Highlight (6.0" from any edge)
      if (state.phase === 'SETUP') {
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
        const m = EDGE_DEPLOY_IN * ppi;
        ctx.fillRect(offsetX, offsetY, mapPxW, m);
        ctx.fillRect(offsetX, offsetY + mapPxH - m, mapPxW, m);
        ctx.fillRect(offsetX, offsetY + m, m, mapPxH - m * 2);
        ctx.fillRect(offsetX + mapPxW - m, offsetY + m, m, mapPxH - m * 2);
        ctx.strokeRect(offsetX + m, offsetY + m, mapPxW - m * 2, mapPxH - m * 2);
        ctx.restore();
      }

      // 2. Smart Inch Grid & Coordinate Labels (4" major at 1x, 1" minor when zoomed in)
      ctx.save();
      const showMinor = ppi >= 18;
      if (showMinor) {
        ctx.strokeStyle = state.customMap ? 'rgba(226, 232, 240, 0.08)' : 'rgba(148, 163, 184, 0.08)';
        ctx.lineWidth = 1;
        for (let x = 0; x <= Math.floor(MAP_W); x++) {
          if (x % 4 === 0) continue;
          const px = toPxX(x);
          ctx.beginPath(); ctx.moveTo(px, offsetY); ctx.lineTo(px, offsetY + mapPxH); ctx.stroke();
        }
        for (let y = 0; y <= Math.floor(MAP_H); y++) {
          if (y % 4 === 0) continue;
          const py = toPxY(y);
          ctx.beginPath(); ctx.moveTo(offsetX, py); ctx.lineTo(offsetX + mapPxW, py); ctx.stroke();
        }
      }

      const majorStep = ppi >= 26 ? 2 : 4;
      ctx.strokeStyle = state.customMap ? 'rgba(226, 232, 240, 0.16)' : 'rgba(148, 163, 184, 0.15)';
      ctx.lineWidth = 1;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#64748b';
      for (let x = 0; x <= Math.floor(MAP_W); x += majorStep) {
        const px = toPxX(x);
        ctx.beginPath(); ctx.moveTo(px, offsetY); ctx.lineTo(px, offsetY + mapPxH); ctx.stroke();
        if (px >= 12 && px <= w - 12) {
          ctx.textAlign = 'center';
          ctx.fillText(`${x}"`, px, Math.max(12, offsetY - 8));
        }
      }
      for (let y = 0; y <= Math.floor(MAP_H); y += majorStep) {
        const py = toPxY(y);
        ctx.beginPath(); ctx.moveTo(offsetX, py); ctx.lineTo(offsetX + mapPxW, py); ctx.stroke();
        if (py >= 14 && py <= h - 6) {
          ctx.textAlign = 'right';
          ctx.fillText(`${y}"`, Math.max(24, offsetX - 6), py + 3);
        }
      }
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.strokeRect(offsetX, offsetY, mapPxW, mapPxH);
      ctx.restore();

      // 3. Imported Landmark Pins (Custom Map)
      if (state.customMap && state.showPins && state.customMap.pins.length > 0) {
        const cm = state.customMap;
        ctx.save();
        for (const pin of cm.pins) {
          const ix = ((pin.col + 0.5) / cm.cols) * MAP_W;
          const iy = ((pin.row + 0.5) / cm.rows) * MAP_H;
          const px = toPxX(ix);
          const py = toPxY(iy);

          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#f43f5e';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          ctx.font = '600 10px Inter, sans-serif';
          const tw = ctx.measureText(pin.name).width;
          const bx = px - (tw + 10) / 2;
          const by = py - 22;

          ctx.fillStyle = 'rgba(2, 6, 23, 0.80)';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(bx, by, tw + 10, 16, 4);
          else ctx.rect(bx, by, tw + 10, 16);
          ctx.fill();
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(pin.name, px, by + 8.5);
        }
        ctx.restore();
      }

      // 4. Toggleable 3" Established Zones
      if (state.showZones) {
        ctx.save();
        for (const e of renderEntities) {
          if (e.kind === 'structure' && STRUCTURE_DEFS[e.type].isBase) {
            ctx.beginPath();
            ctx.arc(toPxX(e.x), toPxY(e.y), ESTABLISHED_ZONE_IN * ppi, 0, Math.PI * 2);
            ctx.fillStyle = e.owner === 1 ? 'rgba(56, 189, 248, 0.06)' : 'rgba(251, 113, 133, 0.06)';
            ctx.fill();
            ctx.strokeStyle = e.owner === 1 ? 'rgba(56, 189, 248, 0.35)' : 'rgba(251, 113, 133, 0.35)';
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        ctx.restore();
      }

      // 5. Toggleable Engagement Radii (Loaded units only)
      if (state.showRanges) {
        ctx.save();
        for (const e of renderEntities) {
          if (e.kind === 'unit' && !e.ammoSpent && isEntityVisible(e, fogViewer(), renderEntities, renderDestroyedBuildings, renderDrones)) {
            const rng = UNIT_DEFS[e.type].range * ppi;
            ctx.beginPath();
            ctx.arc(toPxX(e.x), toPxY(e.y), rng, 0, Math.PI * 2);
            ctx.strokeStyle = e.owner === 1 ? 'rgba(56, 189, 248, 0.35)' : 'rgba(251, 113, 133, 0.35)';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([2, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        ctx.restore();
      }

      // 6. Ruins
      for (const r of renderRuins) {
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

      // 7. Secret Orders Visualization (Active Player Only during Planning)
      if (state.phase === 'PLANNING') {
        const p = state.activePlayer;
        const facility = getEntityById(state.selectedId);
        const rally = facility && facility.owner === p && state.rallyPoints[p][facility.id];
        if (rally) {
          ctx.save();
          ctx.strokeStyle = '#2dd4bf';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(toPxX(facility.x), toPxY(facility.y));
          ctx.lineTo(toPxX(rally.x), toPxY(rally.y)); ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(toPxX(rally.x), toPxY(rally.y), 7, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        const movesByUnit = new Map();
        for (const o of state.futurePlans[p].filter(o => o.type === 'MOVE')) {
          ctx.save();
          ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2; ctx.setLineDash([2, 5]);
          ctx.beginPath(); ctx.moveTo(toPxX(o.fromX), toPxY(o.fromY));
          ctx.lineTo(toPxX(o.toX), toPxY(o.toY)); ctx.stroke();
          ctx.restore();
        }
        for (const o of getOrdersForTurn(p)) {
          if (o.type === 'MOVE') {
            if (!movesByUnit.has(o.unitId)) movesByUnit.set(o.unitId, []);
            movesByUnit.get(o.unitId).push(o);
          } else if (o.type === 'MISSILE') {
            const tx = toPxX(o.targetX), ty = toPxY(o.targetY);
            ctx.save();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(tx, ty, MISSILE_BLAST_RADIUS * ppi, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(tx - 20, ty); ctx.lineTo(tx + 20, ty); ctx.moveTo(tx, ty - 20); ctx.lineTo(tx, ty + 20); ctx.stroke();
            ctx.restore();
          } else if (o.type === 'BARRAGE') {
            const unit = getEntityById(o.unitId);
            if (unit) {
              ctx.save();
              ctx.strokeStyle = '#f97316';
              ctx.lineWidth = 2;
              ctx.beginPath(); ctx.arc(toPxX(o.x), toPxY(o.y), UNIT_DEFS[unit.type].blastRadius * ppi, 0, Math.PI * 2); ctx.stroke();
              ctx.restore();
            }
          } else if (o.type === 'DEPLOY_AD') {
            const dx = toPxX(o.x), dy = toPxY(o.y);
            ctx.save();
            ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(dx, dy, 12, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
          } else if (o.type === 'ROADBLOCK') {
            ctx.save();
            ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(toPxX(o.x1), toPxY(o.y1)); ctx.lineTo(toPxX(o.x2), toPxY(o.y2)); ctx.stroke();
            ctx.restore();
          }
        }
        if ((state.mode === 'MISSILE' || state.mode === 'BARRAGE') && state.hoverMap) {
          const unit = getEntityById(state.selectedId);
          const radius = state.mode === 'MISSILE' ? MISSILE_BLAST_RADIUS : unit && UNIT_DEFS[unit.type].blastRadius;
          if (radius) {
            ctx.save();
            ctx.strokeStyle = '#fbbf24'; ctx.fillStyle = 'rgba(251, 191, 36, 0.12)';
            ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.arc(toPxX(state.hoverMap.x), toPxY(state.hoverMap.y), radius * ppi, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
            ctx.restore();
          }
        }
        if (state.mode === 'ROADBLOCK_END' && state.pendingRoadblockStart && state.hoverMap) {
          const start = state.pendingRoadblockStart;
          ctx.save();
          ctx.strokeStyle = distIn(start.x, start.y, state.hoverMap.x, state.hoverMap.y) <= UNIT_DEFS.roadblock.maxBarrierLength + 1e-9 ? '#34d399' : '#ef4444';
          ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(toPxX(start.x), toPxY(start.y));
          ctx.lineTo(toPxX(state.hoverMap.x), toPxY(state.hoverMap.y)); ctx.stroke();
          ctx.restore();
        }

        for (const [unitId, legs] of movesByUnit.entries()) {
          const unit = getEntityById(unitId);
          if (!unit) continue;
          ctx.save();
          ctx.strokeStyle = getPlanningTurn() === state.turn ? '#fbbf24' : '#a78bfa';
          ctx.lineWidth = 2.5;
          ctx.setLineDash(getPlanningTurn() === state.turn ? [6, 4] : [2, 5]);
          ctx.beginPath();
          ctx.moveTo(toPxX(legs[0].fromX), toPxY(legs[0].fromY));
          for (const leg of legs) {
            ctx.lineTo(toPxX(leg.toX), toPxY(leg.toY));
          }
          ctx.stroke();
          ctx.setLineDash([]);

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

          const finalLeg = legs[legs.length - 1];
          drawEntityShape(unit, toPxX(finalLeg.toX), toPxY(finalLeg.toY), 0.42);
          ctx.restore();
        }
      }

      // 8. Entities
      for (const e of renderEntities) {
        if (!isEntityVisible(e, fogViewer(), renderEntities, renderDestroyedBuildings, renderDrones)) continue;
        const px = toPxX(e.x), py = toPxY(e.y);
        if (state.selectedId === e.id || state.selectedUnitIds.includes(e.id)) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(px, py, Math.max(14, Math.min(26, ppi * 0.36)), 0, Math.PI * 2);
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.restore();
        }

        drawEntityShape(e, px, py, 1.0);

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

      for (const drone of renderDrones) {
        if (fogViewer() !== null && drone.owner !== fogViewer()) continue;
        ctx.save();
        ctx.strokeStyle = pColor(drone.owner);
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(toPxX(drone.x), toPxY(drone.y), drone.revealRange * ppi, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = pColor(drone.owner);
        ctx.font = 'bold 12px monospace';
        ctx.fillText('◆', toPxX(drone.x), toPxY(drone.y));
        ctx.restore();
      }

      // 9. Live Movement Range Ring, Inch Ruler & Building Collision Preview
      if (state.phase === 'PLANNING') {
        const sel = getEntityById(state.selectedId);
        if (sel && sel.kind === 'unit' && UNIT_DEFS[sel.type].speed > 0 && sel.owner === state.activePlayer &&
            !hasUnitFullTurnOrder(sel.id, state.activePlayer) &&
            !getOrdersForTurn(state.activePlayer).some(o => o.type === 'BARRAGE' && o.unitId === sel.id)) {
          const from = getPlannedPos(sel, state.activePlayer);
          const def = UNIT_DEFS[sel.type];
          const spd = state.hoverMap ? getLegSpeed(sel, from.x, from.y, state.hoverMap.x, state.hoverMap.y) : getLegSpeed(sel, from.x, from.y);
          ctx.save();
          ctx.beginPath();
          ctx.arc(toPxX(from.x), toPxY(from.y), spd * ppi, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(250, 204, 21, 0.08)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)';
          ctx.lineWidth = 1.6;
          ctx.setLineDash([5, 4]);
          ctx.stroke();
          ctx.setLineDash([]);

          if (state.hoverMap) {
            const d = distIn(from.x, from.y, state.hoverMap.x, state.hoverMap.y);
            let blockInfo = { blocked: false };
            if (def.category === 'land') {
              blockInfo = traceLandPath(from.x, from.y, state.hoverMap.x, state.hoverMap.y, !!def.canEnterBuilding, sel, true);
            } else if (def.category === 'sea') {
              blockInfo = traceSeaPath(from.x, from.y, state.hoverMap.x, state.hoverMap.y);
            }

            const validLeg = !blockInfo.blocked && d <= spd + 0.05;
            ctx.beginPath();
            ctx.moveTo(toPxX(from.x), toPxY(from.y));
            ctx.lineTo(toPxX(state.hoverMap.x), toPxY(state.hoverMap.y));
            ctx.strokeStyle = blockInfo.blocked ? '#ef4444' : (validLeg ? '#34d399' : '#fb7185');
            ctx.lineWidth = blockInfo.blocked ? 2.4 : 1.8;
            ctx.stroke();

            // Draw bright red X & tooltip pill at exact building/water collision point
            if (blockInfo.blocked) {
              const bx = toPxX(blockInfo.x);
              const by = toPxY(blockInfo.y);
              ctx.strokeStyle = '#ef4444';
              ctx.lineWidth = 2.6;
              ctx.beginPath();
              ctx.moveTo(bx - 6, by - 6); ctx.lineTo(bx + 6, by + 6);
              ctx.moveTo(bx + 6, by - 6); ctx.lineTo(bx - 6, by + 6);
              ctx.stroke();

              const label = blockInfo.reason === 'BUILDING' ? 'BLOCKED: BUILDING' : `BLOCKED: ${blockInfo.reason}`;
              ctx.font = 'bold 10px "JetBrains Mono", monospace';
              const tw = ctx.measureText(label).width;
              const pillX = bx - (tw + 10) / 2;
              const pillY = by - 25;
              ctx.fillStyle = 'rgba(127, 29, 29, 0.94)';
              ctx.beginPath();
              if (ctx.roundRect) ctx.roundRect(pillX, pillY, tw + 10, 17, 4);
              else ctx.rect(pillX, pillY, tw + 10, 17);
              ctx.fill();
              ctx.strokeStyle = '#f87171';
              ctx.lineWidth = 1;
              ctx.stroke();
              ctx.fillStyle = '#fecaca';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(label, bx, pillY + 9);
            }
          }
          ctx.restore();
        }
      }

      // 10. Visual Combat & Resupply Effects
      if (!replayFrame) state.effects = state.effects.filter(fx => now - fx.createdAt < fx.duration);
      const renderEffects = replayFrame ? replayFrame.effects : state.effects;
      for (const fx of renderEffects) {
        if (fx.viewers && !fx.viewers.includes(fogViewer())) continue;
        const p = (visualNow - fx.createdAt) / fx.duration;
        if (p < 0 || p >= 1) continue;
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

      if (state.selectionDrag && Math.hypot(state.selectionDrag.endX - state.selectionDrag.startX,
          state.selectionDrag.endY - state.selectionDrag.startY) > 4) {
        const rect = canvas.getBoundingClientRect();
        const x = state.selectionDrag.startX - rect.left, y = state.selectionDrag.startY - rect.top;
        const width = state.selectionDrag.endX - state.selectionDrag.startX;
        const height = state.selectionDrag.endY - state.selectionDrag.startY;
        ctx.save();
        ctx.fillStyle = 'rgba(45, 212, 191, 0.12)'; ctx.strokeStyle = '#2dd4bf';
        ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
        ctx.fillRect(x, y, width, height); ctx.strokeRect(x, y, width, height);
        ctx.restore();
      }
      requestAnimationFrame(renderFrame);
    }
