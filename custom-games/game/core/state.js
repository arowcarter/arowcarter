    // Core constants, built-in terrain, audio, and mutable game state.
    /**
     * ============================================================================
     * TACTICAL MAP WAR GAME v2.2 — WEGO, ORDERED ENGAGEMENT & MULTI-ACTION
     * With Full Custom Map Uploading (.txt, .json, .csv from 3MF-to-2D Converter)
     * ============================================================================
     */

    // Mutable map inch dimensions (4x scaled default 68" x 44"; custom maps scale to 68" longest edge)
    let MAP_W = 68;
    let MAP_H = 44;

    const ONLINE_REVIEW_MS = 10000;
    const SECONDARY_BASE_TYPES = new Set(['major_base', 'minor_base', 'port', 'air_base']);
    const PLAYABLE_UNITS = new Set(['infantry', 'specops', 'light_veh', 'heavy_veh', 'air_def', 'plane', 'ship', 'artillery', 'sniper_team', 'strategic_bomber', 'drone_operator', 'aircraft_carrier', 'asw_corvette', 'attack_submarine', 'roadblock', 'ammo_convoy', 'bridgelayer']);

    // Gameplay values and definitions live in game/balance/.

    // Default 68"x44" Built-in Terrain Geometry (4x scale of 17"x11")
    const WATER_POLYS = [
      [
        { x: 24.8, y: 0.0 }, { x: 43.2, y: 0.0 }, { x: 42.0, y: 6.4 },
        { x: 38.4, y: 10.8 }, { x: 29.6, y: 10.8 }, { x: 26.0, y: 6.0 }
      ],
      [
        { x: 31.2, y: 9.6 }, { x: 36.8, y: 9.6 }, { x: 37.2, y: 34.4 }, { x: 30.8, y: 34.4 }
      ],
      [
        { x: 29.2, y: 33.2 }, { x: 38.8, y: 33.2 }, { x: 43.6, y: 38.4 },
        { x: 44.4, y: 44.0 }, { x: 23.6, y: 44.0 }, { x: 24.4, y: 38.0 }
      ]
    ];

    const BRIDGES = [
      { x: 29.8, y: 13.8, w: 8.4, h: 2.88 },
      { x: 29.8, y: 27.4, w: 8.4, h: 2.88 }
    ];

    const ROADS = [
      [{ x: 3.2, y: 10.4 }, { x: 18.0, y: 15.2 }, { x: 50.0, y: 15.2 }, { x: 64.8, y: 10.4 }],
      [{ x: 3.2, y: 33.6 }, { x: 18.0, y: 28.8 }, { x: 50.0, y: 28.8 }, { x: 64.8, y: 33.6 }],
      [{ x: 13.6, y: 4.8 }, { x: 18.0, y: 15.2 }, { x: 18.0, y: 28.8 }, { x: 13.6, y: 39.2 }],
      [{ x: 54.4, y: 4.8 }, { x: 50.0, y: 15.2 }, { x: 50.0, y: 28.8 }, { x: 54.4, y: 39.2 }]
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
    let nextGroupId = 1;
    let nextGroupRouteId = 1;

    const state = {
      phase: 'SETUP', // 'SETUP' | 'PLANNING' | 'RESOLVING' | 'POST_RESOLUTION' | 'GAMEOVER'
      setupStep: 0,   // 0: P1 Base 1, 1: P2 Base 1, 2: P1 Base 2, 3: P2 Base 2
      turn: 1,
      _ap: 1,
      missiles: { 1: STARTING_MISSILES, 2: STARTING_MISSILES },
      orders: { 1: [], 2: [] },
      futurePlans: { 1: [], 2: [] },
      standingEngage: { 1: [], 2: [] },
      unitGroups: { 1: [], 2: [] },
      rallyPoints: { 1: {}, 2: {} },
      pendingRallies: { 1: [], 2: [] },
      selectedUnitIds: [],
      selectionDrag: null,
      planTurnOffset: 1,
      planCurrent: true,
      entities: [],
      ruins: [],
      selectedId: null,
      mode: 'IDLE',   // 'IDLE' | 'MOVE' | 'MISSILE' | 'DEPLOY_AD_ZONE'
      pendingAdBaseId: null,
      pendingRoadblockStart: null,
      showZones: true,
      showRanges: true,
      showPins: true,
      hoverMap: null,
      effects: [],
      destroyedBuildings: [],
      buildingDamage: {},
      drones: [],
      stats: { kills: { 1: 0, 2: 0 }, missilesFired: { 1: 0, 2: 0 } },

      // Camera Pan & Zoom (1x - 8x)
      zoom: 1,
      panX: 0,
      panY: 0,
      panToolActive: false,
      isPanning: false,
      spaceDown: false,
      dragStartX: 0,
      dragStartY: 0,
      panStartX: 0,
      panStartY: 0,
      didDragPan: false,

      // Custom Uploaded Map State (null = built-in 68"x44" map)
      customMap: null
    };
