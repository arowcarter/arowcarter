    // Online connections, deterministic synchronization, and replay state.
    // --- ONLINE MULTIPLAYER (PeerJS, deterministic lockstep + host snapshot) ---
    const NET = {
      peer: null, conn: null, role: 0, seed: 1,
      locked: { 1: false, 2: false },
      peerOrders: [],
      pendingSync: null, syncResolve: null,
      nextReady: { 1: false, 2: false },
      autoPass: false, peerAutoPass: false, warnUnusedAP: true, autoPassAttemptTurn: null,
      applyingRemote: false, handshakePending: false, handshakeTimer: null, rejectionReason: null
    };
    let lastMapSrc = null; // {text, name, kind:'any'|'compact'} or null for the default map
    let rngState = 1;
    const resolutionReplay = { frames: [], start: 0, playback: null, step: 1 };
    const onlineReview = { timer: null, deadline: null, turn: null };

    function netActive() { return !!(NET.conn && NET.conn.open); }
    // Online, the acting player is always the local role (except during alternating setup placement).
    Object.defineProperty(state, 'activePlayer', {
      get() { return netActive() && this.phase !== 'SETUP' ? NET.role : this._ap; },
      set(v) { this._ap = v; }
    });
    function netSend(msg) {
      if (!netActive()) return false;
      if (NET.conn.serialization === 'json' &&
          new TextEncoder().encode(JSON.stringify(msg)).length >= 16300) {
        NET.conn.close();
        netSetStatus('Disconnected: both players need the updated game for large maps or game states.');
        showToast('Both players need the updated game for large maps or game states.', 'danger');
        return false;
      }
      NET.conn.send(msg);
      return true;
    }
    function netPeerRole() { return NET.role === 1 ? 2 : 1; }

    function netBalanceSignature() {
      return JSON.stringify({
        buildingRulesVersion: 5,
        rules: [MAX_AP, AP_GAIN_INTERVAL, MOVE_AP_COST, MISSILE_AP_COST, MAX_FACILITY_QUEUE,
          MAX_SECONDARY_BASES, MAIN_BASE_EXCLUSION_IN, MAX_MOVES_PER_UNIT_PER_TURN, EDGE_DEPLOY_IN,
          ESTABLISHED_ZONE_IN, RESUPPLY_TOUCH_IN, RUIN_REPAIR_TURNS, STARTING_MISSILES, MISSILE_ATK,
          MISSILE_BLAST_RADIUS, MISSILE_RESTOCK_TURNS, ENGAGE_AP_COST],
        units: UNIT_DEFS, structures: STRUCTURE_DEFS
      });
    }

    function netRejectBalance() {
      NET.rejectionReason = 'Disconnected: both players need the same game and balance settings.';
      if (NET.conn) NET.conn.close();
      netSetStatus(NET.rejectionReason);
      showToast(NET.rejectionReason, 'danger');
    }

    function netFinishHandshake() {
      NET.handshakePending = false;
      if (NET.handshakeTimer !== null) clearTimeout(NET.handshakeTimer);
      NET.handshakeTimer = null;
    }

    function netRand() { // mulberry32
      rngState = (rngState + 0x6D2B79F5) >>> 0;
      let t = rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function netSetStatus(text) {
      document.getElementById('net-status').textContent = text;
      const btn = document.getElementById('btn-open-net');
      btn.textContent = netActive() ? `🌐 Online: ${NET.role === 1 ? 'Blue' : 'Red'}` : '🌐 Online';
    }

    function netSnapshot() {
      return JSON.parse(JSON.stringify({
        entities: state.entities, ruins: state.ruins, missiles: state.missiles,
        destroyedBuildings: state.destroyedBuildings, buildingDamage: state.buildingDamage,
        drones: state.drones,
        stats: state.stats, nextEntityId
      }));
    }

    function netApplySnapshot(s) {
      state.entities = s.entities;
      state.ruins = s.ruins;
      state.missiles = s.missiles;
      state.stats = s.stats;
      state.destroyedBuildings = s.destroyedBuildings;
      state.buildingDamage = s.buildingDamage || {};
      state.drones = s.drones;
      nextEntityId = s.nextEntityId;
    }

    // Host sends the authoritative post-turn state; the joiner waits for it so animation drift cannot desync.
    async function netSyncPoint() {
      if (!netActive()) return;
      if (NET.role === 1) {
        netSend({ t: 'sync', snap: netSnapshot() });
        return;
      }
      if (!NET.pendingSync) await new Promise(r => { NET.syncResolve = r; });
      netApplySnapshot(NET.pendingSync);
      NET.pendingSync = null;
    }

    function netMaybeResolve() {
      if (!netActive() || state.phase !== 'PLANNING') return;
      if (!NET.locked[1] || !NET.locked[2]) return;
      state.orders[netPeerRole()] = NET.peerOrders;
      NET.peerOrders = [];
      NET.locked = { 1: false, 2: false };
      runSimultaneousResolution();
    }

    function netMaybeAutoPass() {
      if (!netActive() || !NET.autoPass || state.phase !== 'PLANNING' ||
          NET.locked[NET.role] || (!NET.locked[netPeerRole()] && !NET.peerAutoPass) ||
          NET.autoPassAttemptTurn === state.turn) return;
      NET.autoPassAttemptTurn = state.turn;
      lockActivePlayerOrders();
    }

    function clearOnlineReview() {
      if (onlineReview.timer !== null) clearInterval(onlineReview.timer);
      onlineReview.timer = null;
      onlineReview.deadline = null;
      onlineReview.turn = null;
    }

    function readyForNextTurn() {
      if (state.phase !== 'POST_RESOLUTION' || resolutionReplay.playback) return;
      if (netActive()) {
        if (NET.nextReady[NET.role]) return;
        clearOnlineReview();
        NET.nextReady[NET.role] = true;
        netSend({ t: 'next', turn: state.turn });
        if (!NET.nextReady[netPeerRole()]) {
          updateUI();
          return;
        }
      }
      beginNextTurn();
    }

    function updateOnlineReview() {
      if (!netActive() || state.phase !== 'POST_RESOLUTION' || state.turn !== onlineReview.turn) {
        clearOnlineReview();
        return;
      }
      if (performance.now() >= onlineReview.deadline && !resolutionReplay.playback) {
        readyForNextTurn();
      } else {
        updateUI();
      }
    }

    function startOnlineReview() {
      clearOnlineReview();
      if (!netActive() || state.phase !== 'POST_RESOLUTION' || NET.nextReady[NET.role]) return;
      onlineReview.turn = state.turn;
      onlineReview.deadline = performance.now() + ONLINE_REVIEW_MS;
      onlineReview.timer = setInterval(updateOnlineReview, 250);
    }

    function netApplyMap(src) {
      NET.applyingRemote = true;
      try {
        lastMapSrc = src;
        if (!src) resetToDefaultMap();
        else applyCustomMap(src.kind === 'compact' ? parseCompactTxtMap(src.text, src.name) : parseAnyMapText(src.text, src.name));
      } catch (err) {
        console.error(err);
        showToast('Could not load the opponent\'s map.', 'danger');
      } finally {
        NET.applyingRemote = false;
      }
    }

    function netOnMapChanged() {
      if (!NET.applyingRemote) netSend({ t: 'map', src: lastMapSrc });
    }

    function netHandle(msg) {
      if (NET.handshakePending && !['hello', 'balance-ack'].includes(msg.t)) return;
      switch (msg.t) {
        case 'hello':
          if (msg.balance !== netBalanceSignature()) { netRejectBalance(); break; }
          NET.role = 2;
          NET.seed = msg.seed;
          netApplyMap(msg.src);
          resetCampaign(false);
          netFinishHandshake();
          netSend({ t: 'balance-ack', balance: netBalanceSignature() });
          netSend({ t: 'auto-pass', enabled: NET.autoPass });
          netSetStatus('Connected — you are Red (Player 2).');
          showToast('Connected! You are Red (Player 2). Blue deploys first.', 'success');
          document.getElementById('net-modal').classList.add('hidden');
          break;
        case 'balance-ack':
          if (NET.role !== 1 || !NET.handshakePending || msg.balance !== netBalanceSignature()) {
            netRejectBalance();
            break;
          }
          netFinishHandshake();
          resetCampaign(false);
          netSetStatus('Connected — you are Blue (Player 1).');
          showToast('Opponent connected! You are Blue (Player 1) and deploy first.', 'success');
          document.getElementById('net-modal').classList.add('hidden');
          netSend({ t: 'auto-pass', enabled: NET.autoPass });
          updateUI();
          break;
        case 'map':
          netApplyMap(msg.src);
          break;
        case 'setup': {
          const before = state.setupStep;
          if (state.phase === 'SETUP') handleSetupClick(msg.x, msg.y);
          if (state.setupStep === before) showToast('Desync: setup placement rejected.', 'danger');
          break;
        }
        case 'autodeploy':
          autoDeploySetup();
          break;
        case 'orders':
          NET.peerOrders = msg.orders;
          NET.locked[netPeerRole()] = true;
          if (state.phase === 'PLANNING' && !NET.locked[NET.role]) showToast('Opponent has locked their orders.', 'info');
          netMaybeAutoPass();
          netMaybeResolve();
          break;
        case 'auto-pass':
          if (typeof msg.enabled !== 'boolean') break;
          NET.peerAutoPass = msg.enabled;
          updateUI();
          netMaybeAutoPass();
          break;
        case 'sync':
          NET.pendingSync = msg.snap;
          if (NET.syncResolve) { const r = NET.syncResolve; NET.syncResolve = null; r(); }
          break;
        case 'next':
          if (msg.turn !== state.turn) break;
          NET.nextReady[netPeerRole()] = true;
          if (state.phase === 'POST_RESOLUTION' && NET.nextReady[NET.role]) beginNextTurn();
          else updateUI();
          break;
        case 'reset':
          resetCampaign(true);
          break;
      }
    }

    function netAttach(conn) {
      NET.conn = conn;
      conn.on('open', () => {
        NET.rejectionReason = null;
        NET.handshakePending = true;
        NET.handshakeTimer = setTimeout(netRejectBalance, 12000);
        if (NET.role === 1) {
          NET.seed = (Math.random() * 4294967296) >>> 0;
          if (!netSend({ t: 'hello', seed: NET.seed, src: lastMapSrc, balance: netBalanceSignature() })) return;
        }
        netSetStatus('Checking game balance with opponent…');
        document.getElementById('btn-net-disconnect').classList.remove('hidden');
        updateUI();
      });
      conn.on('data', msg => { try { netHandle(msg); } catch (err) { console.error(err); } });
      conn.on('close', () => {
        const wasLive = NET.conn === conn;
        if (wasLive) NET.conn = null;
        if (wasLive) netFinishHandshake();
        if (wasLive) clearOnlineReview();
        if (wasLive) { NET.autoPass = false; NET.peerAutoPass = false; NET.autoPassAttemptTurn = null; }
        NET.locked = { 1: false, 2: false };
        if (NET.syncResolve) { const r = NET.syncResolve; NET.syncResolve = null; NET.pendingSync = NET.pendingSync || netSnapshot(); r(); }
        netSetStatus(NET.rejectionReason || 'Disconnected.');
        if (wasLive && !NET.rejectionReason) showToast('Opponent disconnected. Hot-seat play continues locally.', 'warn');
        updateUI();
      });
      conn.on('error', err => { console.error(err); netSetStatus('Connection error: ' + (err.type || err)); });
    }

    function netDisconnect() {
      clearOnlineReview();
      netFinishHandshake();
      if (NET.conn) NET.conn.close();
      if (NET.peer) NET.peer.destroy();
      NET.conn = null; NET.peer = null; NET.role = 0;
      NET.rejectionReason = null;
      NET.autoPass = false; NET.peerAutoPass = false; NET.autoPassAttemptTurn = null;
      document.getElementById('net-code-box').classList.add('hidden');
      document.getElementById('net-idle').classList.remove('hidden');
      document.getElementById('btn-net-disconnect').classList.add('hidden');
      netSetStatus('Not connected.');
      updateUI();
    }

    function netHost() {
      if (typeof Peer === 'undefined') { netSetStatus('PeerJS failed to load (check your internet connection).'); return; }
      netDisconnect();
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      NET.role = 1;
      NET.peer = new Peer('tacwar-' + code);
      NET.peer.on('open', () => {
        document.getElementById('net-code-display').textContent = code;
        document.getElementById('net-code-box').classList.remove('hidden');
        document.getElementById('net-idle').classList.add('hidden');
        document.getElementById('btn-net-disconnect').classList.remove('hidden');
        netSetStatus('Waiting for opponent to join…');
      });
      NET.peer.on('connection', c => {
        if (netActive()) { c.on('open', () => c.close()); return; }
        netAttach(c);
      });
      NET.peer.on('error', err => netSetStatus('Network error: ' + err.type));
    }

    function netJoin(code) {
      if (typeof Peer === 'undefined') { netSetStatus('PeerJS failed to load (check your internet connection).'); return; }
      code = code.trim().toUpperCase();
      if (code.length !== 5) { netSetStatus('Enter the 5-character room code.'); return; }
      netDisconnect();
      NET.role = 2;
      NET.peer = new Peer();
      NET.peer.on('open', () => {
        netSetStatus('Connecting…');
        netAttach(NET.peer.connect('tacwar-' + code, { reliable: true, serialization: 'binary' }));
      });
      NET.peer.on('error', err => netSetStatus(err.type === 'peer-unavailable' ? 'Room not found.' : 'Network error: ' + err.type));
    }
