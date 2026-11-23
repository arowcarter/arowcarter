    // Campaign reset, event wiring, and application startup.
    // --- RESET CAMPAIGN ---
    function resetCampaign(logMsg = true) {
      clearOnlineReview();
      nextEntityId = 1;
      nextOrderId = 1;
      nextGroupId = 1;
      nextGroupRouteId = 1;
      state.phase = 'SETUP';
      state.setupStep = 0;
      state.turn = 1;
      state.activePlayer = 1;
      state.missiles = { 1: STARTING_MISSILES, 2: STARTING_MISSILES };
      state.orders = { 1: [], 2: [] };
      state.futurePlans = { 1: [], 2: [] };
      state.standingEngage = { 1: [], 2: [] };
      state.unitGroups = { 1: [], 2: [] };
      state.rallyPoints = { 1: {}, 2: {} };
      state.pendingRallies = { 1: [], 2: [] };
      state.selectedUnitIds = [];
      state.selectionDrag = null;
      document.getElementById('group-name').value = '';
      state.planTurnOffset = 1;
      state.planCurrent = true;
      state.entities = [];
      state.ruins = [];
      state.destroyedBuildings = [];
      state.buildingDamage = {};
      state.drones = [];
      state.selectedId = null;
      state.mode = 'IDLE';
      state.pendingRoadblockStart = null;
      state.effects = [];
      resolutionReplay.frames = [];
      resolutionReplay.playback = null;
      NET.locked = { 1: false, 2: false };
      NET.autoPassAttemptTurn = null;
      NET.peerOrders = [];
      NET.nextReady = { 1: false, 2: false };
      state.stats = { kills: { 1: 0, 2: 0 }, missilesFired: { 1: 0, 2: 0 } };
      document.getElementById('victory-modal').classList.add('hidden');
      document.getElementById('resolution-banner').classList.add('hidden');
      document.getElementById('setup-banner').classList.remove('hidden');
      document.getElementById('combat-log').innerHTML = '';
      if (logMsg) {
        addLog('New v2.2 WEGO campaign initialized. Deploy 2 Original Main Bases per player.', 'amber');
      }
      updateUI();
    }

    // --- CUSTOM MAP MODAL HANDLERS ---
    const mapModal = document.getElementById('map-upload-modal');
    const mapDropZone = document.getElementById('map-drop-zone');
    const mapFileInput = document.getElementById('map-file-input');
    const mapPasteTextarea = document.getElementById('map-paste-textarea');

    function openMapModal() {
      if (netActive() && NET.role === 2) {
        showToast('Only the host can change the map.', 'warn');
        return;
      }
      mapModal.classList.remove('hidden');
      SFX.play('click');
    }

    function closeMapModal() {
      mapModal.classList.add('hidden');
    }

    function handleMapFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result || '');
          const parsed = parseAnyMapText(text, file.name);
          lastMapSrc = { text, name: file.name, kind: 'any' };
          applyCustomMap(parsed);
          closeMapModal();
          SFX.play('lock');
        } catch (err) {
          console.error(err);
          showToast(err.message || 'Failed to parse map file.', 'danger');
          SFX.play('miss');
        }
      };
      reader.onerror = () => {
        showToast('Could not read the selected file.', 'danger');
      };
      reader.readAsText(file);
    }

    document.getElementById('btn-open-map-hud').addEventListener('click', openMapModal);
    document.getElementById('btn-open-map-setup').addEventListener('click', openMapModal);
    document.getElementById('btn-close-map-modal').addEventListener('click', closeMapModal);

    mapDropZone.addEventListener('click', () => mapFileInput.click());
    mapDropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        mapFileInput.click();
      }
    });
    mapFileInput.addEventListener('change', (e) => {
      if (e.target.files?.[0]) handleMapFile(e.target.files[0]);
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach(evt => {
      mapDropZone.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
        mapDropZone.classList.add('border-teal-400', 'bg-teal-950/30');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      mapDropZone.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
        mapDropZone.classList.remove('border-teal-400', 'bg-teal-950/30');
      });
    });
    mapDropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) handleMapFile(file);
    });

    document.getElementById('btn-load-pasted-map').addEventListener('click', () => {
      try {
        const parsed = parseAnyMapText(mapPasteTextarea.value, 'pasted-map.txt');
        lastMapSrc = { text: mapPasteTextarea.value, name: 'pasted-map.txt', kind: 'any' };
        applyCustomMap(parsed);
        closeMapModal();
        SFX.play('lock');
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Could not parse pasted map text.', 'danger');
        SFX.play('miss');
      }
    });

    document.getElementById('btn-load-nyc-sample').addEventListener('click', () => {
      try {
        const nycTxt = generateSampleNYCConvertedTxt();
        const parsed = parseCompactTxtMap(nycTxt, 'nyc-manhattan-sample.3mf');
        lastMapSrc = { text: nycTxt, name: 'nyc-manhattan-sample.3mf', kind: 'compact' };
        applyCustomMap(parsed);
        closeMapModal();
        SFX.play('lock');
      } catch (err) {
        console.error(err);
        showToast('Failed to load NYC sample map.', 'danger');
      }
    });

    document.getElementById('btn-reset-default-map').addEventListener('click', () => {
      resetToDefaultMap();
      closeMapModal();
      SFX.play('click');
    });

    // --- EVENT LISTENERS (INCLUDING 1x-8x PAN & ZOOM) ---
    window.addEventListener('resize', resizeCanvas);
    canvas.addEventListener('click', handleCanvasClick);

    document.getElementById('group-save').addEventListener('click', () => {
      const p = state.activePlayer;
      if (state.phase !== 'PLANNING' || !state.selectedUnitIds.length || (netActive() && NET.locked[p])) return;
      const name = document.getElementById('group-name').value.trim();
      if (!name) { showToast('Enter a group name.', 'warn'); return; }
      if (state.unitGroups[p].some(group => group.name.toLowerCase() === name.toLowerCase())) {
        showToast('A group with that name already exists.', 'warn');
        return;
      }
      const group = { id: nextGroupId++, name, unitIds: state.selectedUnitIds.slice() };
      state.unitGroups[p].push(group);
      document.getElementById('group-name').value = '';
      updateUI();
      document.getElementById('group-list').value = String(group.id);
      showToast(`Saved group ${name}.`, 'success');
    });
    document.getElementById('group-load').addEventListener('click', () => {
      const group = state.unitGroups[state.activePlayer].find(g => String(g.id) === document.getElementById('group-list').value);
      if (!group || state.phase !== 'PLANNING' || (netActive() && NET.locked[state.activePlayer])) return;
      setMode('IDLE');
      setSelectedUnits(group.unitIds);
    });
    document.getElementById('group-delete').addEventListener('click', () => {
      const p = state.activePlayer, id = document.getElementById('group-list').value;
      if (state.phase !== 'PLANNING' || (netActive() && NET.locked[p])) return;
      state.unitGroups[p] = state.unitGroups[p].filter(group => String(group.id) !== id);
      updateUI();
    });
    document.getElementById('group-move').addEventListener('click', () => {
      if (state.phase !== 'PLANNING' || !state.selectedUnitIds.length ||
          (netActive() && NET.locked[state.activePlayer])) return;
      setMode('GROUP_ROUTE', 'CLICK THE DESTINATION FOR THE GROUP CENTER');
    });

    function finishSelectionDrag() {
      const drag = state.selectionDrag;
      state.selectionDrag = null;
      if (!drag || Math.hypot(drag.endX - drag.startX, drag.endY - drag.startY) <= 4) return false;
      const rect = canvas.getBoundingClientRect();
      const x1 = toMapX(drag.startX - rect.left), x2 = toMapX(drag.endX - rect.left);
      const y1 = toMapY(drag.startY - rect.top), y2 = toMapY(drag.endY - rect.top);
      setSelectedUnits(state.entities.filter(unit => unit.kind === 'unit' && unit.owner === state.activePlayer &&
        unit.x >= Math.min(x1, x2) && unit.x <= Math.max(x1, x2) &&
        unit.y >= Math.min(y1, y2) && unit.y <= Math.max(y1, y2)).map(unit => unit.id));
      return true;
    }

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      zoomAtPoint(factor, e.clientX, e.clientY);
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      if (state.panToolActive || state.spaceDown || e.button === 1) {
        e.preventDefault();
        state.isPanning = true;
        state.didDragPan = false;
        state.dragStartX = e.clientX;
        state.dragStartY = e.clientY;
        state.panStartX = state.panX;
        state.panStartY = state.panY;
        canvas.style.cursor = 'grabbing';
      } else if (e.button === 0 && state.phase === 'PLANNING' && state.mode === 'IDLE' &&
          !(netActive() && NET.locked[state.activePlayer])) {
        state.selectionDrag = { startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY };
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (state.isPanning) {
        const dx = e.clientX - state.dragStartX;
        const dy = e.clientY - state.dragStartY;
        if (Math.hypot(dx, dy) > 3) state.didDragPan = true;
        state.panX = state.panStartX + dx;
        state.panY = state.panStartY + dy;
        updateCameraTransform();
        return;
      }
      if (state.selectionDrag) {
        state.selectionDrag.endX = e.clientX;
        state.selectionDrag.endY = e.clientY;
      }
      const rect = canvas.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        handleCanvasMove(e);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (state.isPanning) {
        state.isPanning = false;
        canvas.style.cursor = (state.panToolActive || state.spaceDown) ? 'grab' : 'crosshair';
      }
      if (state.selectionDrag) {
        state.selectionDrag.endX = e.clientX;
        state.selectionDrag.endY = e.clientY;
        if (finishSelectionDrag()) {
          state.didDragPan = true;
          setTimeout(() => { state.didDragPan = false; }, 0);
        }
      }
    });

    // Pan & Zoom Toolbar Buttons
    const panBtn = document.getElementById('btn-pan-mode');
    panBtn.addEventListener('click', () => {
      state.panToolActive = !state.panToolActive;
      panBtn.classList.toggle('bg-teal-600', state.panToolActive);
      panBtn.classList.toggle('text-white', state.panToolActive);
      panBtn.classList.toggle('text-slate-300', !state.panToolActive);
      canvas.style.cursor = state.panToolActive ? 'grab' : 'crosshair';
    });
    document.getElementById('btn-zoom-in').addEventListener('click', () => zoomAtPoint(1.35));
    document.getElementById('btn-zoom-out').addEventListener('click', () => zoomAtPoint(1 / 1.35));
    document.getElementById('btn-reset-view').addEventListener('click', resetCameraView);

    // Touch support (tap to act/select, drag when Pan mode is active)
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0];
        if (state.panToolActive) {
          state.isPanning = true;
          state.dragStartX = t.clientX;
          state.dragStartY = t.clientY;
          state.panStartX = state.panX;
          state.panStartY = state.panY;
        } else if (state.phase === 'PLANNING' && state.mode === 'IDLE' &&
            !(netActive() && NET.locked[state.activePlayer])) {
          state.selectionDrag = { startX: t.clientX, startY: t.clientY, endX: t.clientX, endY: t.clientY };
        } else state.selectionDrag = { startX: t.clientX, startY: t.clientY, endX: t.clientX, endY: t.clientY, tapOnly: true };
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0];
        if (state.isPanning) {
          state.panX = state.panStartX + (t.clientX - state.dragStartX);
          state.panY = state.panStartY + (t.clientY - state.dragStartY);
          updateCameraTransform();
        } else {
          if (state.selectionDrag) {
            state.selectionDrag.endX = t.clientX;
            state.selectionDrag.endY = t.clientY;
          }
          updateTelemetryAt(t.clientX, t.clientY);
        }
      }
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
      const drag = state.selectionDrag;
      if (drag && drag.tapOnly) state.selectionDrag = null;
      if (drag && (drag.tapOnly || !finishSelectionDrag())) {
        const touch = e.changedTouches[0];
        if (touch) processMapClick(touch.clientX, touch.clientY);
      }
      state.isPanning = false;
    });

    document.getElementById('btn-auto-deploy').addEventListener('click', () => {
      if (netActive()) {
        if (state.phase !== 'SETUP') return;
        if (NET.role !== 1) { showToast('Only the host can auto-deploy.', 'warn'); return; }
        netSend({ t: 'autodeploy' });
      }
      autoDeploySetup();
    });
    document.getElementById('btn-lock-orders').addEventListener('click', lockActivePlayerOrders);
    document.getElementById('btn-auto-pass').addEventListener('click', () => {
      if (!netActive()) return;
      NET.autoPass = !NET.autoPass;
      NET.autoPassAttemptTurn = null;
      netSend({ t: 'auto-pass', enabled: NET.autoPass });
      updateUI();
      netMaybeAutoPass();
    });
    document.getElementById('btn-warn-unused-ap').addEventListener('click', () => {
      if (!netActive()) return;
      NET.warnUnusedAP = !NET.warnUnusedAP;
      updateUI();
    });
    document.getElementById('btn-review-player').addEventListener('click', () => {
      if (netActive() || resolutionReplay.playback || (state.phase !== 'POST_RESOLUTION' && state.phase !== 'GAMEOVER')) return;
      const nextPlayer = state.activePlayer === 1 ? 2 : 1;
      const modal = document.getElementById('handoff-modal');
      document.getElementById('handoff-title').textContent = 'Resolution Review';
      document.getElementById('handoff-subtitle').textContent = `Pass the device to ${pName(nextPlayer)} to review their view of the turn.`;
      const btn = document.getElementById('btn-handoff-ready');
      btn.textContent = `${pName(nextPlayer)} Ready — Review`;
      btn.className = nextPlayer === 1
        ? 'tac-btn w-full py-3 rounded-xl bg-gradient-to-b from-sky-500 to-blue-700 hover:from-sky-400 hover:to-blue-600 text-white font-extrabold uppercase tracking-wider text-sm'
        : 'tac-btn w-full py-3 rounded-xl bg-gradient-to-b from-rose-500 to-rose-700 hover:from-rose-400 hover:to-rose-600 text-white font-extrabold uppercase tracking-wider text-sm';
      btn.onclick = () => {
        state.activePlayer = nextPlayer;
        state.selectedId = null;
        modal.classList.add('hidden');
        SFX.play('click');
        updateUI();
        startResolutionReplay();
      };
      modal.classList.remove('hidden');
    });
    document.getElementById('btn-replay-resolution').addEventListener('click', startResolutionReplay);
    document.getElementById('btn-next-turn').addEventListener('click', readyForNextTurn);
    document.getElementById('btn-open-net').addEventListener('click', () => document.getElementById('net-modal').classList.remove('hidden'));
    document.getElementById('btn-close-net').addEventListener('click', () => document.getElementById('net-modal').classList.add('hidden'));
    document.getElementById('btn-net-host').addEventListener('click', netHost);
    document.getElementById('btn-net-join').addEventListener('click', () => netJoin(document.getElementById('net-code-input').value));
    document.getElementById('btn-net-disconnect').addEventListener('click', netDisconnect);
    document.getElementById('btn-undo-order').addEventListener('click', undoLastOrder);
    document.getElementById('btn-clear-orders').addEventListener('click', clearAllOrders);
    document.getElementById('btn-cancel-mode').addEventListener('click', () => setMode('IDLE'));
    document.getElementById('btn-play-again').addEventListener('click', () => {
      netSend({ t: 'reset' });
      resetCampaign(true);
    });
    document.getElementById('btn-review-battlefield').addEventListener('click', () => {
      document.getElementById('victory-modal').classList.add('hidden');
    });
    document.getElementById('btn-victory-result').addEventListener('click', () => {
      document.getElementById('victory-modal').classList.remove('hidden');
    });
    document.getElementById('btn-clear-log').addEventListener('click', () => {
      const log = document.getElementById('combat-log');
      const viewer = fogViewer();
      if (netActive() || viewer === null) {
        log.innerHTML = '';
        return;
      }
      const other = viewer === 1 ? '2' : '1';
      for (const entry of Array.from(log.children)) {
        const viewers = entry.dataset.viewers ? entry.dataset.viewers.split(',') : ['1', '2'];
        if (viewers.includes(other)) {
          entry.dataset.viewers = other;
          entry.hidden = true;
        } else {
          entry.remove();
        }
      }
    });

    document.getElementById('btn-launch-missile').addEventListener('click', () => {
      if (state.phase === 'PLANNING') {
        setMode('MISSILE', 'CLICK A MISSILE TARGET (1 AP, 1.5" BLAST, FRIENDLY FIRE)');
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

    document.getElementById('btn-toggle-pins').addEventListener('click', (e) => {
      state.showPins = !state.showPins;
      e.target.textContent = `Pins: ${state.showPins ? 'ON' : 'OFF'}`;
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
      if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        state.spaceDown = true;
        if (!state.isPanning) canvas.style.cursor = 'grab';
      }
      if (e.key === 'Escape') {
        setMode('IDLE');
        document.getElementById('rules-modal').classList.add('hidden');
        closeMapModal();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        state.spaceDown = false;
        if (!state.isPanning) canvas.style.cursor = state.panToolActive ? 'grab' : 'crosshair';
      }
    });

    // --- BOOT ---
    window.onload = function () {
      resizeCanvas();
      const reference = document.getElementById('unit-reference-body');
      for (const def of Object.values(UNIT_DEFS)) {
        const row = document.createElement('tr');
        const values = [def.name, def.shape, `${def.speed}"`, def.hp, def.atk, `${def.range}"`, `${def.prodCooldown}t`, def.notes];
        values.forEach((value, i) => {
          const cell = document.createElement('td');
          cell.className = i === 0 ? 'py-1 pr-2 text-slate-100' : (i === 7 ? 'pl-2 text-slate-400' : 'px-2');
          cell.textContent = value;
          row.appendChild(cell);
        });
        reference.appendChild(row);
      }
      addLog('Welcome to <strong>Tactical Map War Game v2.2 (4× Scale 68"×44")</strong>. Place Main Bases, click Quick Auto-Deploy, or click <strong>🗺️ Map</strong> to upload a converted map.', 'amber');
      updateUI();
      requestAnimationFrame(renderFrame);
    };
