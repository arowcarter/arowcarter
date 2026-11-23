    // Camera transforms, custom maps, terrain geometry, and route finding.
    // --- CANVAS SETUP & CAMERA TRANSFORM ---
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const wrapper = document.getElementById('canvas-wrapper');
    let basePpi = 12;
    let ppi = 12;
    let offsetX = 24;
    let offsetY = 24;

    function updateCameraTransform() {
      const rect = wrapper.getBoundingClientRect();
      const pad = 26;
      const availW = Math.max(120, rect.width - pad * 2);
      const availH = Math.max(120, rect.height - pad * 2);
      basePpi = Math.min(availW / MAP_W, availH / MAP_H);
      ppi = basePpi * state.zoom;
      offsetX = (rect.width - MAP_W * ppi) / 2 + state.panX;
      offsetY = (rect.height - MAP_H * ppi) / 2 + state.panY;
      const zr = document.getElementById('zoom-readout');
      if (zr) zr.textContent = `${Math.round(state.zoom * 100)}%`;
    }

    function resizeCanvas() {
      const rect = wrapper.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(300, Math.floor(rect.width * dpr));
      canvas.height = Math.max(240, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      updateCameraTransform();
    }

    function resetCameraView() {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      updateCameraTransform();
    }

    function zoomAtPoint(factor, clientX = null, clientY = null) {
      const oldZoom = state.zoom;
      const newZoom = Math.max(1, Math.min(8, oldZoom * factor));
      if (Math.abs(newZoom - oldZoom) < 1e-4) return;

      const rect = canvas.getBoundingClientRect();
      const cx = clientX !== null ? (clientX - rect.left) : rect.width / 2;
      const cy = clientY !== null ? (clientY - rect.top) : rect.height / 2;

      const ratio = newZoom / oldZoom;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      state.panX = (cx - centerX) - ((cx - centerX) - state.panX) * ratio;
      state.panY = (cy - centerY) - ((cy - centerY) - state.panY) * ratio;
      state.zoom = newZoom;

      if (state.zoom <= 1.01) {
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
      }
      updateCameraTransform();
    }

    function toPxX(inX) { return offsetX + inX * ppi; }
    function toPxY(inY) { return offsetY + inY * ppi; }
    function toMapX(pxX) { return (pxX - offsetX) / ppi; }
    function toMapY(pxY) { return (pxY - offsetY) / ppi; }

    // =========================================================================
    // CUSTOM MAP PARSER (.txt, .json, .csv) & OFFSCREEN TOPOGRAPHIC RENDERER
    // =========================================================================
    function sampleTopoColor(t) {
      const stops = [
        [0.00,  32,  98,  66],
        [0.30,  62, 138,  82],
        [0.60, 146, 162, 102],
        [0.82, 152, 128,  98],
        [1.00, 226, 232, 240],
      ];
      const clamped = Math.max(0, Math.min(1, t));
      for (let i = 0; i < stops.length - 1; i++) {
        const s0 = stops[i], s1 = stops[i + 1];
        if (clamped >= s0[0] && clamped <= s1[0]) {
          const f = (clamped - s0[0]) / (s1[0] - s0[0]);
          return [
            s0[1] + (s1[1] - s0[1]) * f,
            s0[2] + (s1[2] - s0[2]) * f,
            s0[3] + (s1[3] - s0[3]) * f,
          ];
        }
      }
      return [226, 232, 240];
    }

    function sampleBuildingHeat(t) {
      const stops = [
        [0.00, 180,  83,   9],
        [0.35, 245, 158,  11],
        [0.70, 249, 115,  22],
        [1.00, 254, 240, 138],
      ];
      const clamped = Math.max(0, Math.min(1, t));
      for (let i = 0; i < stops.length - 1; i++) {
        const s0 = stops[i], s1 = stops[i + 1];
        if (clamped >= s0[0] && clamped <= s1[0]) {
          const f = (clamped - s0[0]) / (s1[0] - s0[0]);
          return [
            s0[1] + (s1[1] - s0[1]) * f,
            s0[2] + (s1[2] - s0[2]) * f,
            s0[3] + (s1[3] - s0[3]) * f,
          ];
        }
      }
      return [254, 240, 138];
    }

    function normalizeTileChar(ch) {
      const u = String(ch || 'G').trim().toUpperCase().charAt(0);
      if (u === 'W' || u === 'G' || u === 'R' || u === 'B') return u;
      return 'G';
    }

    function buildCustomMapOffscreen(mapObj) {
      const { cols, rows, types, totalElev, bldgHeight, minElev, maxElev, maxBldg } = mapObj;
      const zRange = Math.max(1e-5, maxElev - minElev);
      const bRange = Math.max(1e-5, maxBldg);

      const off = document.createElement('canvas');
      off.width = cols;
      off.height = rows;
      const octx = off.getContext('2d');
      const imgData = octx.createImageData(cols, rows);
      const data = imgData.data;

      // Hillshade vector
      const lx = -0.58, ly = -0.58, lz = 0.57;
      const reliefScale = (Math.max(cols, rows) / zRange) * 0.22;

      for (let r = 0; r < rows; r++) {
        const ro = r * cols;
        for (let c = 0; c < cols; c++) {
          const idx = ro + c;
          const p = idx * 4;
          const t = types[idx];
          const z = totalElev[idx];
          const normZ = Math.max(0, Math.min(1, (z - minElev) / zRange));

          // Hillshade from neighboring elevations
          const zL = totalElev[ro + Math.max(0, c - 1)];
          const zR = totalElev[ro + Math.min(cols - 1, c + 1)];
          const zU = totalElev[Math.max(0, r - 1) * cols + c];
          const zD = totalElev[Math.min(rows - 1, r + 1) * cols + c];
          const dzdx = (zR - zL) * reliefScale;
          const dzdy = (zD - zU) * reliefScale;
          const invLen = 1 / Math.hypot(dzdx, dzdy, 1);
          const shade = Math.max(0.56, Math.min(1.24, (-dzdx * lx - dzdy * ly + lz) * invLen * 1.15));

          let R = 0, G = 0, B = 0;
          if (t === 'W') {
            const depthF = Math.min(1, normZ * 2.5);
            R = 12 + depthF * 20;
            G = 66 + depthF * 74;
            B = 138 + depthF * 76;
          } else if (t === 'B') {
            const bt = Math.min(1, (bldgHeight[idx] > 0 ? bldgHeight[idx] / bRange : normZ));
            const [br, bg, bb] = sampleBuildingHeat(bt);
            // Distinct architectural border where a B tile meets walkable G/R or W
            const isEdge =
              (c > 0 && types[idx - 1] !== 'B') ||
              (c < cols - 1 && types[idx + 1] !== 'B') ||
              (r > 0 && types[idx - cols] !== 'B') ||
              (r < rows - 1 && types[idx + cols] !== 'B');
            if (isEdge) {
              R = Math.max(25, br * 0.48);
              G = Math.max(18, bg * 0.42);
              B = Math.max(15, bb * 0.38);
            } else {
              R = Math.min(255, br * shade * 0.96);
              G = Math.min(255, bg * shade * 0.92);
              B = Math.min(255, bb * shade * 0.88);
            }
          } else if (t === 'R') {
            R = Math.min(255, 108 * shade);
            G = Math.min(255, 118 * shade);
            B = Math.min(255, 134 * shade);
          } else {
            const [tr, tg, tb] = sampleTopoColor(normZ);
            R = Math.min(255, tr * shade * 0.9);
            G = Math.min(255, tg * shade * 0.9);
            B = Math.min(255, tb * shade * 0.9);
          }

          data[p] = R;
          data[p + 1] = G;
          data[p + 2] = B;
          data[p + 3] = 255;
        }
      }

      octx.putImageData(imgData, 0, 0);
      mapObj.offscreenCanvas = off;
    }

    function finalizeCustomMap(name, cols, rows, types, totalElev, groundElev, bldgHeight, pins) {
      if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 8 || rows < 8) {
        throw new Error(`Invalid map dimensions (${cols}×${rows}). Minimum grid size is 8×8.`);
      }
      const total = cols * rows;
      if (types.length !== total) {
        throw new Error(`Grid cell mismatch: expected ${total} cells (${cols}×${rows}), got ${types.length}.`);
      }

      let minElev = Infinity, maxElev = -Infinity, maxBldg = 0;
      const counts = { W: 0, G: 0, R: 0, B: 0 };
      for (let i = 0; i < total; i++) {
        const t = types[i];
        if (counts[t] !== undefined) counts[t]++;
        if (totalElev[i] < minElev) minElev = totalElev[i];
        if (totalElev[i] > maxElev) maxElev = totalElev[i];
        if (bldgHeight[i] > maxBldg) maxBldg = bldgHeight[i];
      }
      if (!Number.isFinite(minElev)) { minElev = 0; maxElev = 100; }

      const bldgTier = new Uint8Array(total);
      const bldgHp = new Uint8Array(total);
      for (let i = 0; i < total; i++) {
        if (types[i] !== 'B') continue;
        const ratio = maxBldg > 0 ? bldgHeight[i] / maxBldg : 0;
        bldgTier[i] = ratio <= 0.25 ? 1 : ratio <= 0.6 ? 2 : 3;
        bldgHp[i] = bldgTier[i];
      }

      const validPins = (pins || []).filter(p =>
        p && typeof p.name === 'string' &&
        Number.isFinite(p.col) && Number.isFinite(p.row) &&
        p.col >= 0 && p.col < cols && p.row >= 0 && p.row < rows
      );

      const mapObj = {
        name: name || 'Custom Map',
        cols,
        rows,
        types,
        totalElev,
        groundElev,
        bldgHeight,
        bldgTier,
        bldgHp,
        minElev,
        maxElev,
        maxBldg,
        pins: validPins,
        counts,
        offscreenCanvas: null
      };
      buildCustomMapOffscreen(mapObj);
      return mapObj;
    }

    function parseCompactTxtMap(text, fallbackName = 'custom-map.txt') {
      const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      let metaWidth = null;
      let metaHeight = null;
      let metaSource = fallbackName;
      const pins = [];
      const dataLines = [];
      let seenGridStart = false;

      for (const raw of rawLines) {
        const line = raw.trim();
        if (!line) continue;

        if (line.startsWith('#')) {
          const wMatch = /^#\s*WIDTH\s+(\d+)/i.exec(line);
          if (wMatch) { metaWidth = parseInt(wMatch[1], 10); continue; }

          const hMatch = /^#\s*HEIGHT\s+(\d+)/i.exec(line);
          if (hMatch) { metaHeight = parseInt(hMatch[1], 10); continue; }

          const sMatch = /^#\s*SOURCE\s+(.+)/i.exec(line);
          if (sMatch) { metaSource = sMatch[1].trim(); continue; }

          const pinMatch = /^#\s*PIN\s+"([^"]+)"\s+col=(\d+)\s+row=(\d+)/i.exec(line);
          if (pinMatch) {
            pins.push({
              name: pinMatch[1],
              col: parseInt(pinMatch[2], 10),
              row: parseInt(pinMatch[3], 10)
            });
            continue;
          }

          if (/^#\s*GRID_START/i.test(line)) {
            seenGridStart = true;
          }
          continue;
        }

        // Ignore truncated preview footers if pasted from preview box
        if (line.startsWith('...')) continue;
        dataLines.push(line);
      }

      if (dataLines.length < 8) {
        throw new Error('Not enough grid rows found in Compact .txt map (need at least 8 rows).');
      }

      // Auto-detect delimiter from first data row
      const sample = dataLines[0];
      let splitFn;
      if (sample.includes('\t')) {
        splitFn = (l) => l.split('\t').map(s => s.trim()).filter(Boolean);
      } else if (sample.includes(',')) {
        splitFn = (l) => l.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        splitFn = (l) => l.split(/\s+/).filter(Boolean);
      }

      const firstTokens = splitFn(sample);
      const cols = metaWidth && metaWidth === firstTokens.length ? metaWidth : firstTokens.length;
      const rows = dataLines.length;
      const total = cols * rows;

      const types = new Array(total);
      const totalElev = new Float32Array(total);
      const groundElev = new Float32Array(total);
      const bldgHeight = new Float32Array(total);

      for (let r = 0; r < rows; r++) {
        const tokens = splitFn(dataLines[r]);
        const ro = r * cols;
        for (let c = 0; c < cols; c++) {
          const tok = tokens[c] || 'G:0';
          const parts = tok.split(':');
          const t = normalizeTileChar(parts[0]);
          let g = 0, b = 0, z = 0;
          if (parts.length >= 3) {
            // Type:GroundElev:BldgHeight (e.g., B:4:38)
            g = parseFloat(parts[1]) || 0;
            b = parseFloat(parts[2]) || 0;
            z = g + b;
          } else if (parts.length === 2) {
            // Type:TotalElev (e.g., B:42)
            z = parseFloat(parts[1]) || 0;
            g = t === 'B' ? Math.max(0, z * 0.25) : z;
            b = t === 'B' ? Math.max(0, z - g) : 0;
          } else {
            // Single-letter W / G / R / B
            g = t === 'W' ? 0 : 10;
            b = t === 'B' ? 25 : 0;
            z = g + b;
          }
          types[ro + c] = t;
          groundElev[ro + c] = g;
          bldgHeight[ro + c] = b;
          totalElev[ro + c] = z;
        }
      }

      return finalizeCustomMap(metaSource, cols, rows, types, totalElev, groundElev, bldgHeight, pins);
    }

    function parseJsonMap(text, fallbackName = 'custom-map.json') {
      const obj = JSON.parse(text);
      const cols = parseInt(obj.width, 10);
      const rows = parseInt(obj.height, 10);
      if (!cols || !rows || !obj.layers || !Array.isArray(obj.layers.types)) {
        throw new Error('JSON file is missing required width, height, or layers.types fields.');
      }

      const total = cols * rows;
      const types = new Array(total);
      const totalElev = new Float32Array(total);
      const groundElev = new Float32Array(total);
      const bldgHeight = new Float32Array(total);

      const typeRows = obj.layers.types;
      const zRows = obj.layers.totalElev || [];
      const gRows = obj.layers.groundElev || [];
      const bRows = obj.layers.bldgHeight || [];

      for (let r = 0; r < rows; r++) {
        const ro = r * cols;
        const tRow = typeRows[r] || '';
        const zRow = zRows[r] || [];
        const gRow = gRows[r] || [];
        const bRow = bRows[r] || [];

        for (let c = 0; c < cols; c++) {
          const ch = typeof tRow === 'string' ? tRow.charAt(c) : tRow[c];
          const t = normalizeTileChar(ch);
          const g = Number(gRow[c]) || 0;
          const b = Number(bRow[c]) || 0;
          const z = zRow[c] !== undefined ? (Number(zRow[c]) || 0) : (g + b);
          types[ro + c] = t;
          groundElev[ro + c] = g;
          bldgHeight[ro + c] = b;
          totalElev[ro + c] = z;
        }
      }

      const pins = (obj.locations || []).map(loc => ({
        name: String(loc.name || 'Pin'),
        col: parseInt(loc.col, 10),
        row: parseInt(loc.row, 10)
      }));

      return finalizeCustomMap(obj.source || fallbackName, cols, rows, types, totalElev, groundElev, bldgHeight, pins);
    }

    function parseCsvMap(text, fallbackName = 'custom-map.csv') {
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      if (lines.length < 2) {
        throw new Error('CSV map file has no data rows.');
      }

      const header = lines[0].toLowerCase().split(',').map(s => s.trim());
      const iCol = header.indexOf('col');
      const iRow = header.indexOf('row');
      const iType = header.indexOf('type');
      const iTotal = header.indexOf('total_elev');
      const iGround = header.indexOf('ground_elev');
      const iBldg = header.indexOf('bldg_height');

      if (iCol < 0 || iRow < 0 || iType < 0) {
        throw new Error('CSV header must include col,row,type columns.');
      }

      let maxCol = -1, maxRow = -1;
      const parsed = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 3) continue;
        const c = parseInt(parts[iCol], 10);
        const r = parseInt(parts[iRow], 10);
        if (Number.isNaN(c) || Number.isNaN(r)) continue;
        if (c > maxCol) maxCol = c;
        if (r > maxRow) maxRow = r;
        const t = normalizeTileChar(parts[iType]);
        const z = iTotal >= 0 ? (parseFloat(parts[iTotal]) || 0) : 0;
        const g = iGround >= 0 ? (parseFloat(parts[iGround]) || 0) : z;
        const b = iBldg >= 0 ? (parseFloat(parts[iBldg]) || 0) : 0;
        parsed.push({ c, r, t, z, g, b });
      }

      const cols = maxCol + 1;
      const rows = maxRow + 1;
      const total = cols * rows;
      const types = new Array(total).fill('G');
      const totalElev = new Float32Array(total);
      const groundElev = new Float32Array(total);
      const bldgHeight = new Float32Array(total);

      for (const item of parsed) {
        const idx = item.r * cols + item.c;
        types[idx] = item.t;
        totalElev[idx] = item.z;
        groundElev[idx] = item.g;
        bldgHeight[idx] = item.b;
      }

      return finalizeCustomMap(fallbackName, cols, rows, types, totalElev, groundElev, bldgHeight, []);
    }

    function parseAnyMapText(text, fileName = 'pasted-map.txt') {
      const trimmed = (text || '').trim();
      if (!trimmed) throw new Error('Map text is empty.');

      const lowerName = (fileName || '').toLowerCase();
      if (lowerName.endsWith('.json') || trimmed.startsWith('{')) {
        return parseJsonMap(trimmed, fileName);
      }
      if (lowerName.endsWith('.csv') || /^col\s*,\s*row\s*,\s*type/i.test(trimmed)) {
        return parseCsvMap(trimmed, fileName);
      }
      return parseCompactTxtMap(trimmed, fileName);
    }

    /**
     * Generates a rich, authentic Compact Game Map (.txt) representing NYC Manhattan,
     * Hudson & East Rivers, Bridges/Roads, Financial District & Midtown Skyscrapers,
     * Central Park, and 4 # PIN landmarks — then parses it via parseCompactTxtMap().
     */
    function generateSampleNYCConvertedTxt() {
      const cols = 70;
      const rows = 100;
      const lines = [
        `# WIDTH ${cols}`,
        `# HEIGHT ${rows}`,
        `# SOURCE nyc-manhattan-sample.3mf`,
        `# ELEV_SCALE 0-99`,
        `# CELL_FORMAT Type:GroundElev:BldgHeight`,
        `# LEGEND W=Water, G=Ground/Park, R=Road, B=Building`,
        `# MODEL_BOUNDS X:[0.00,140.00] Y:[0.00,200.00] Z:[0.60,44.00]`,
        `# GEO_BOUNDS NW:[40.783,-74.022] SE:[40.698,-73.952]`,
        `# TILE_SCALE 84.10m_x_94.60m_per_tile`,
        `# LOCATIONS 4`,
        `# PIN "Central Park" col=33 row=18 elev=12 latlon=40.771200,-73.974200`,
        `# PIN "Midtown" col=32 row=41 elev=85 latlon=40.754900,-73.984000`,
        `# PIN "Brooklyn Bridge" col=43 row=80 elev=11 latlon=40.706100,-73.996900`,
        `# PIN "Battery Park" col=28 row=87 elev=8 latlon=40.703300,-74.017000`,
        `# GRID_START`
      ];

      let seed = 918273;
      function rand() {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      }

      for (let r = 0; r < rows; r++) {
        const y = (1 - (r + 0.5) / rows) * 200; // north = 200, south = 0
        const rowTokens = new Array(cols);

        for (let c = 0; c < cols; c++) {
          const x = ((c + 0.5) / cols) * 140;

          // Landmass shapes
          const mCenter = 58 + (y - 30) * 0.08;
          const mHalfW = y < 42 ? 24 * Math.pow(Math.max(0, (y - 20) / 22), 0.72) : 24.5;
          const mWest = mCenter - mHalfW + 2.0 * Math.sin(y * 0.045);
          const mEast = mCenter + mHalfW + 2.8 * Math.cos(y * 0.038);
          const inManh = x >= mWest && x <= mEast && y >= 20;

          const bkShore = 98 + (y - 30) * 0.12 + 4.0 * Math.sin(y * 0.05 + 1.1);
          const inBkln = x >= bkShore && y >= 14;

          const njShore = 17 + (y - 30) * 0.06 + 2.2 * Math.sin(y * 0.06);
          const inNJ = x <= njShore && y >= 24;

          const inGov = Math.hypot((x - 58) / 8.5, (y - 11) / 5.5) <= 1.0;

          // East River Bridges & Hudson Crossing
          const onBridge =
            (y >= 38 && y <= 41.5 && x >= 68 && x <= 105) || // Brooklyn Bridge
            (y >= 47 && y <= 50.5 && x >= 72 && x <= 107) || // Manhattan Bridge
            (y >= 66 && y <= 69.5 && x >= 80 && x <= 113) || // Williamsburg Bridge
            (y >= 112 && y <= 115.5 && x >= 12 && x <= 44);  // Lincoln Tunnel / West Crossing

          if (onBridge) {
            rowTokens[c] = 'R:10:0';
            continue;
          }

          if (!inManh && !inBkln && !inNJ && !inGov) {
            rowTokens[c] = 'W:2:0';
            continue;
          }

          const gElev = Math.round(7 + (y / 200) * 6 + Math.sin(x * 0.09) * 1.5);

          // Central Park & Battery Park
          const inCentralPark = x > 55 && x < 75 && y > 144 && y < 188;
          const inBatteryPark = inManh && y < 29 && x < 63;
          if (inCentralPark || inBatteryPark || inGov) {
            rowTokens[c] = `G:${gElev}:0`;
            continue;
          }

          // Major Avenues & Cross-Streets (Road corridors granting +1" bonus)
          const isAve = (c % 6 === 0);
          const isStreet = (r % 7 === 0);
          if (isAve || isStreet) {
            rowTokens[c] = `R:${gElev}:0`;
            continue;
          }

          // Urban Buildings with realistic Midtown / Financial District heights
          const dFiDi = Math.hypot((x - 57) / 14, (y - 40) / 14);
          const dMidtown = Math.hypot((x - 64) / 17, (y - 122) / 19);
          const dBklnDT = Math.hypot((x - 112) / 15, (y - 40) / 15);

          let bH = 6 + rand() * 8;
          if (inManh) {
            bH += 56 * Math.exp(-(dFiDi * dFiDi)) * (0.65 + rand() * 0.65);
            bH += 64 * Math.exp(-(dMidtown * dMidtown)) * (0.65 + rand() * 0.7);
          } else if (inBkln) {
            bH += 24 * Math.exp(-(dBklnDT * dBklnDT)) * (0.5 + rand() * 0.7);
          }

          // Parks/yards scattered on NJ/Brooklyn outer edges
          if ((inNJ || inBkln) && rand() < 0.32) {
            rowTokens[c] = `G:${gElev}:0`;
          } else {
            rowTokens[c] = `B:${gElev}:${Math.min(88, Math.round(bH))}`;
          }
        }
        lines.push(rowTokens.join(' '));
      }

      return lines.join('\n');
    }

    function applyCustomMap(mapObj) {
      state.customMap = mapObj;
      state.showPins = true;

      // 4x Aspect-True Inch Scaling: longest edge = 68", shortest edge >= 28"
      if (mapObj.cols >= mapObj.rows) {
        MAP_W = 68;
        MAP_H = Math.max(28, Number((68 * (mapObj.rows / mapObj.cols)).toFixed(2)));
      } else {
        MAP_H = 68;
        MAP_W = Math.max(28, Number((68 * (mapObj.cols / mapObj.rows)).toFixed(2)));
      }

      document.getElementById('hud-map-scale-sub').textContent =
        `v2.2 • 4× CUSTOM MAP (${MAP_W.toFixed(1)}"×${MAP_H.toFixed(1)}", ${mapObj.cols}×${mapObj.rows} GRID)`;
      document.getElementById('tel-map-name').textContent = `${mapObj.name} (${mapObj.cols}×${mapObj.rows})`;
      document.getElementById('tel-elev-wrap').classList.remove('hidden');

      const pinBtn = document.getElementById('btn-toggle-pins');
      if (mapObj.pins.length > 0) {
        pinBtn.classList.remove('hidden');
        pinBtn.textContent = 'Pins: ON';
      } else {
        pinBtn.classList.add('hidden');
      }

      resetCampaign(false);
      resetCameraView();
      resizeCanvas();

      const c = mapObj.counts;
      const summary = `Loaded "${mapObj.name}" (${mapObj.cols}×${mapObj.rows} → ${MAP_W.toFixed(1)}"×${MAP_H.toFixed(1)}") • W:${c.W} G:${c.G} R:${c.R} B:${c.B} (Impassable) • ${mapObj.pins.length} Pin(s)`;
      showToast(summary, 'success');
      addLog(`🗺️ <strong>CUSTOM MAP LOADED:</strong> ${summary}`, 'emerald');
      netOnMapChanged();
    }

    function resetToDefaultMap() {
      if (!NET.applyingRemote) lastMapSrc = null;
      state.customMap = null;
      MAP_W = 68;
      MAP_H = 44;
      document.getElementById('hud-map-scale-sub').textContent =
        'v2.2 • 4× SCALE WEGO, ORDERED ENGAGE & MULTI-ACTION (68"×44")';
      document.getElementById('tel-map-name').textContent = 'Default 68"×44"';
      document.getElementById('tel-elev-wrap').classList.add('hidden');
      document.getElementById('btn-toggle-pins').classList.add('hidden');

      resetCampaign(false);
      resetCameraView();
      resizeCanvas();
      showToast('Restored Default 68"×44" Tactical Map.', 'info');
      addLog('🗺️ Restored Default 68"×44" Tactical Map.', 'amber');
      netOnMapChanged();
    }

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

    function getCustomCellAt(x, y, destroyedBuildings = state.destroyedBuildings) {
      const cm = state.customMap;
      if (!cm) return null;
      const col = Math.max(0, Math.min(cm.cols - 1, Math.floor((x / MAP_W) * cm.cols)));
      const row = Math.max(0, Math.min(cm.rows - 1, Math.floor((y / MAP_H) * cm.rows)));
      const idx = row * cm.cols + col;
      return {
        col,
        row,
        idx,
        type: cm.types[idx] === 'B' && destroyedBuildings.includes(idx) ? 'G' : cm.types[idx],
        totalElev: cm.types[idx] === 'B' && destroyedBuildings.includes(idx) ? cm.groundElev[idx] : cm.totalElev[idx],
        groundElev: cm.groundElev[idx],
        bldgHeight: cm.types[idx] === 'B' && destroyedBuildings.includes(idx) ? 0 : cm.bldgHeight[idx],
        bldgTier: cm.types[idx] === 'B' && !destroyedBuildings.includes(idx) ? cm.bldgTier[idx] || 1 : 0,
        bldgHp: cm.types[idx] === 'B' && !destroyedBuildings.includes(idx)
          ? Math.max(0, (cm.bldgHp[idx] || 1) - (state.buildingDamage[idx] || 0)) : 0
      };
    }

    function isPointInWater(x, y) {
      if (state.customMap) {
        const cell = getCustomCellAt(x, y);
        return cell ? cell.type === 'W' : false;
      }
      for (const poly of WATER_POLYS) {
        if (pointInPoly(x, y, poly)) return true;
      }
      return false;
    }

    function isBuildingAt(x, y) {
      if (!state.customMap) return false;
      const cell = getCustomCellAt(x, y);
      return cell ? cell.type === 'B' : false;
    }

    function isPointOnBridge(x, y) {
      if (state.entities.some(e => e.kind === 'structure' && e.type === 'pontoon_bridge' &&
          distToSegment(x, y, e.x1, e.y1, e.x2, e.y2) <= 0.3)) return true;
      if (state.customMap) return false;
      for (const b of BRIDGES) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
      }
      return false;
    }

    function isLandForUnit(x, y) {
      if (isPointOnBridge(x, y)) return true;
      if (state.customMap) {
        const cell = getCustomCellAt(x, y);
        return cell ? (cell.type !== 'W' && cell.type !== 'B') : false;
      }
      return !isPointInWater(x, y);
    }

    function isLandForBase(x, y) {
      if (state.customMap) {
        const cell = getCustomCellAt(x, y);
        return cell ? (cell.type !== 'W' && cell.type !== 'B') : false;
      }
      return !isPointInWater(x, y);
    }

    function buildingTransition(x1, y1, x2, y2) {
      const start = getCustomCellAt(x1, y1), end = getCustomCellAt(x2, y2);
      return !!start && !!end && start.idx !== end.idx && (start.type === 'B' || end.type === 'B');
    }

    function buildingMoveWait(unit, x1, y1, x2, y2, turn, includePlans = true) {
      const start = getCustomCellAt(x1, y1), end = getCustomCellAt(x2, y2);
      if (!start || !end || start.type !== 'B' || start.idx === end.idx) return false;
      if (start.bldgTier !== 3 || ['specops', 'breacher', 'breacher_squad'].includes(unit.type)) return false;
      let entered = unit.buildingEnteredTurn ?? (state.turn - 1);
      if (includePlans) {
        for (const { order, turn: plannedTurn } of allQueuedOrders(unit.owner)) {
          if (plannedTurn >= turn || order.invalid || order.type !== 'MOVE' || order.unitId !== unit.id) continue;
          const from = getCustomCellAt(order.fromX, order.fromY), to = getCustomCellAt(order.toX, order.toY);
          if (to && to.type === 'B' && from?.idx !== to.idx) entered = plannedTurn;
        }
      }
      return turn <= entered + 1;
    }

    /**
     * Fine-grained segment raycast for land units.
     * Detects Building (B) collisions and unbridged Water (W) crossings along the entire leg.
     */
    function traceLandPath(x1, y1, x2, y2, canEnterBuilding = false, unit = null, visibleOnly = false) {
      const dist = distIn(x1, y1, x2, y2);
      const cm = state.customMap;
      const stepSize = cm ? Math.min(0.08, MAP_W / cm.cols / 4, MAP_H / cm.rows / 4) : 0.08;
      const steps = Math.max(24, Math.ceil(dist / stepSize));
      let prevX = x1, prevY = y1;
      const start = getCustomCellAt(x1, y1), end = getCustomCellAt(x2, y2);
      const startBuilding = start?.type === 'B', endBuilding = end?.type === 'B';
      if (startBuilding || endBuilding) {
        if (!canEnterBuilding || Math.abs(start.col - end.col) > 1 || Math.abs(start.row - end.row) > 1 ||
            (startBuilding && endBuilding && start.idx !== end.idx) ||
            (startBuilding && !endBuilding && !['G', 'R'].includes(end.type)) ||
            (endBuilding && !startBuilding && !['G', 'R'].includes(start.type))) {
          return { blocked: true, reason: 'BUILDING', x: x1, y: y1 };
        }
      }
      const roadblocks = unit ? state.entities.filter(e => e.kind === 'unit' && UNIT_DEFS[e.type].blocksRoad &&
        (!visibleOnly || isEntityVisible(e, unit.owner))) : [];
      const leaving = new Set(roadblocks.filter(e => distanceToEntity(x1, y1, e) <= 0.08).map(e => e.id));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const sx = x1 + (x2 - x1) * t;
        const sy = y1 + (y2 - y1) * t;
        for (const roadblock of roadblocks) {
          const near = distanceToEntity(sx, sy, roadblock) <= 0.08;
          if (!near) leaving.delete(roadblock.id);
          else if (!leaving.has(roadblock.id)) {
            return { blocked: true, reason: 'ROADBLOCK', x: sx, y: sy, prevX, prevY };
          }
        }
        const cell = getCustomCellAt(sx, sy);
        const building = cell?.type === 'B';
        if (building && (!canEnterBuilding ||
            ((!startBuilding || cell.idx !== start.idx) && (!endBuilding || cell.idx !== end.idx)))) {
          return { blocked: true, reason: 'BUILDING', x: sx, y: sy };
        }
        if (!building && !isLandForUnit(sx, sy)) {
          return { blocked: true, reason: 'WATER', x: sx, y: sy };
        }
        prevX = sx; prevY = sy;
      }
      return { blocked: false, reason: null, x: x2, y: y2 };
    }

    function pathHitsBuilding(x1, y1, x2, y2) {
      const res = traceLandPath(x1, y1, x2, y2);
      return res.blocked && res.reason === 'BUILDING' ? res : null;
    }

    function traceSeaPath(x1, y1, x2, y2) {
      const dist = distIn(x1, y1, x2, y2);
      const steps = Math.max(20, Math.ceil(dist / 0.1));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const sx = x1 + (x2 - x1) * t;
        const sy = y1 + (y2 - y1) * t;
        if (!isWaterForShip(sx, sy)) {
          return { blocked: true, reason: isBuildingAt(sx, sy) ? 'BUILDING' : 'LAND', x: sx, y: sy };
        }
      }
      return { blocked: false, reason: null, x: x2, y: y2 };
    }

    function isWaterForShip(x, y) {
      return isPointInWater(x, y);
    }

    function isNearWater(x, y, radius = 0.85) {
      if (isPointInWater(x, y)) return true;
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const sx = Math.max(0.05, Math.min(MAP_W - 0.05, x + Math.cos(ang) * radius));
        const sy = Math.max(0.05, Math.min(MAP_H - 0.05, y + Math.sin(ang) * radius));
        if (isPointInWater(sx, sy)) return true;
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

    function distanceToEntity(x, y, entity) {
      if (entity.kind === 'unit' && UNIT_DEFS[entity.type].blocksRoad &&
          entity.x1 != null && entity.y1 != null && entity.x2 != null && entity.y2 != null) {
        return distToSegment(x, y, entity.x1, entity.y1, entity.x2, entity.y2);
      }
      return distIn(x, y, entity.x, entity.y);
    }

    function isOnRoad(x, y, tolerance = 0.65) {
      if (state.customMap) {
        const cm = state.customMap;
        const cell = getCustomCellAt(x, y);
        if (!cell) return false;
        if (cell.type === 'R') return true;
        // Check immediate 8-neighbors so narrow 1-tile custom roads reliably trigger the +1" bonus
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = cell.row + dr;
            const nc = cell.col + dc;
            if (nr >= 0 && nr < cm.rows && nc >= 0 && nc < cm.cols) {
              if (cm.types[nr * cm.cols + nc] === 'R') return true;
            }
          }
        }
        return false;
      }
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
      const steps = state.customMap ? 10 : 6;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const sx = x1 + (x2 - x1) * t;
        const sy = y1 + (y2 - y1) * t;
        if (isOnRoad(sx, sy, 0.65)) return true;
      }
      return false;
    }

    function findPathAStar(startX, startY, goalX, goalY, unitType, opts = {}) {
      const def = UNIT_DEFS[unitType];
      if (!def || def.speed <= 0 || [startX, goalX].some(x => x < 0 || x > MAP_W) ||
          [startY, goalY].some(y => y < 0 || y > MAP_H)) return null;
      const cols = Math.max(120, state.customMap ? state.customMap.cols : 0);
      const rows = Math.max(80, state.customMap ? state.customMap.rows : 0);
      const indexAt = (x, y) => Math.min(rows - 1, Math.floor(y / MAP_H * rows)) * cols +
        Math.min(cols - 1, Math.floor(x / MAP_W * cols));
      const start = indexAt(startX, startY), goal = indexAt(goalX, goalY);
      const unit = { owner: opts.player || state.activePlayer, type: unitType };
      const formation = opts.formation || [{ unit, dx: 0, dy: 0 }];
      const point = idx => idx === start ? { x: startX, y: startY } :
        idx === goal ? { x: goalX, y: goalY } :
        { x: ((idx % cols) + 0.5) * MAP_W / cols, y: (Math.floor(idx / cols) + 0.5) * MAP_H / rows };
      function memberPassable(member, x, y) {
        const memberDef = UNIT_DEFS[member.unit.type];
        if (x < 0 || x > MAP_W || y < 0 || y > MAP_H) return false;
        if (memberDef.category === 'air') return true;
        if (memberDef.category === 'sea') return isPointInWater(x, y);
        if (isBuildingAt(x, y)) return !!memberDef.canEnterBuilding;
        return !isPointInWater(x, y) || isPointOnBridge(x, y) || memberDef.amphibious || opts.allowWater;
      }
      function passable(x, y) {
        return formation.every(member => memberPassable(member, x + member.dx, y + member.dy));
      }
      function memberClear(member, a, b) {
        const memberDef = UNIT_DEFS[member.unit.type];
        const from = { x: a.x + member.dx, y: a.y + member.dy };
        const to = { x: b.x + member.dx, y: b.y + member.dy };
        if (!memberPassable(member, from.x, from.y) || !memberPassable(member, to.x, to.y)) return false;
        if (memberDef.category === 'air') return true;
        if (memberDef.category === 'sea') return !traceSeaPath(from.x, from.y, to.x, to.y).blocked;
        if (!memberDef.amphibious && !opts.allowWater) {
          return !traceLandPath(from.x, from.y, to.x, to.y, !!memberDef.canEnterBuilding, member.unit, true).blocked;
        }
        const steps = Math.max(24, Math.ceil(distIn(from.x, from.y, to.x, to.y) / 0.08));
        for (let i = 1; i <= steps; i++) {
          const x = from.x + (to.x - from.x) * i / steps, y = from.y + (to.y - from.y) * i / steps;
          if (!memberPassable(member, x, y) || state.entities.some(e => e.kind === 'unit' && UNIT_DEFS[e.type].blocksRoad &&
              isEntityVisible(e, member.unit.owner) && distanceToEntity(x, y, e) <= 0.08)) return false;
        }
        return true;
      }
      function clear(a, b) {
        return formation.every(member => memberClear(member, a, b));
      }
      if (!passable(startX, startY) || !passable(goalX, goalY)) return null;
      if (start === goal) return clear({ x: startX, y: startY }, { x: goalX, y: goalY })
        ? [{ x: startX, y: startY }, { x: goalX, y: goalY }] : null;

      const count = cols * rows, scores = new Float64Array(count), previous = new Int32Array(count);
      scores.fill(Infinity); previous.fill(-1); scores[start] = 0;
      const heap = [];
      function push(item) {
        let i = heap.length;
        heap.push(item);
        while (i > 0) {
          const parent = Math.floor((i - 1) / 2);
          if (heap[parent].f <= item.f) break;
          heap[i] = heap[parent]; i = parent;
        }
        heap[i] = item;
      }
      function pop() {
        const first = heap[0], last = heap.pop();
        if (heap.length) {
          let i = 0;
          while (i * 2 + 1 < heap.length) {
            let child = i * 2 + 1;
            if (child + 1 < heap.length && heap[child + 1].f < heap[child].f) child++;
            if (heap[child].f >= last.f) break;
            heap[i] = heap[child]; i = child;
          }
          heap[i] = last;
        }
        return first;
      }
      const goalCol = goal % cols, goalRow = Math.floor(goal / cols);
      const heuristic = idx => Math.hypot(goalCol - idx % cols, goalRow - Math.floor(idx / cols)) *
        (def.category === 'land' ? 0.75 : def.category === 'air' ? 0.95 : 1);
      push({ idx: start, g: 0, f: heuristic(start) });
      while (heap.length) {
        const current = pop(), idx = current.idx;
        if (current.g !== scores[idx]) continue;
        if (idx === goal) {
          const path = [];
          for (let i = goal; i !== -1; i = previous[i]) path.push(point(i));
          return path.reverse();
        }
        const col = idx % cols, row = Math.floor(idx / cols), from = point(idx);
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          const c = col + dc, r = row + dr;
          if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
          const next = r * cols + c, to = point(next);
          if (dc && dr) {
            const horizontal = point(row * cols + c), vertical = point(r * cols + col);
            if (!passable(horizontal.x, horizontal.y) || !passable(vertical.x, vertical.y)) continue;
          }
          if (!passable(to.x, to.y) || !clear(from, to)) continue;
          const road = isOnRoad(to.x, to.y);
          const cost = def.category === 'land' && road ? 0.75 : def.category === 'air' && road ? 0.95 : 1;
          const candidate = current.g + Math.hypot(dc, dr) * cost;
          if (candidate < scores[next]) {
            scores[next] = candidate; previous[next] = idx;
            push({ idx: next, g: candidate, f: candidate + heuristic(next) });
          }
        }
      }
      return null;
    }

    function queueRoute(unit, goalX, goalY) {
      selectAutomaticTurn(state.activePlayer, 'MOVE', MOVE_AP_COST, unit);
      const player = state.activePlayer, startTurn = getPlanningTurn();
      if (state.phase !== 'PLANNING' || unit.owner !== player || (netActive() && NET.locked[player])) return false;
      if (state.futurePlans[player].some(o => o.type === 'MOVE' && o.unitId === unit.id && o.targetTurn > startTurn)) {
        showToast('Clear this unit’s later move plans before plotting a new route.', 'warn');
        return false;
      }
      const start = getProjectedPosAtTurn(unit, player, startTurn);
      if (distIn(start.x, start.y, goalX, goalY) < 0.12 &&
          !buildingTransition(start.x, start.y, goalX, goalY)) {
        showToast('The unit is already at the target.', 'info');
        setMode('IDLE');
        return true;
      }
      const path = findPathAStar(start.x, start.y, goalX, goalY, unit.type, { player });
      if (!path) {
        showToast('No traversable route to that target.', 'warn');
        return false;
      }
      const oldOrders = state.orders[player].slice(), oldFuture = state.futurePlans[player].slice();
      const oldCurrent = state.planCurrent, oldOffset = state.planTurnOffset;
      let turn = startTurn, index = 1, pos = start, legs = 0, failure = '', lastLeg = null, lastTurn = startTurn;
      const def = UNIT_DEFS[unit.type];
      while (index < path.length && legs < 2000) {
        state.planCurrent = turn === state.turn;
        if (!state.planCurrent) state.planTurnOffset = turn - state.turn;
        if (hasUnitMovedThisTurn(unit.id, player, turn) || hasUnitFullTurnOrder(unit.id, player) ||
            (def.indirectFire && getOrdersForTurn(player).some(o => o.type === 'BARRAGE' && o.unitId === unit.id))) {
          turn++;
          continue;
        }
        while (index < path.length - 1 && distIn(pos.x, pos.y, path[index].x, path[index].y) < 0.12 &&
               !buildingTransition(pos.x, pos.y, path[index].x, path[index].y)) index++;
        const next = path[index];
        if (buildingMoveWait(unit, pos.x, pos.y, next.x, next.y, turn)) {
          turn++;
          continue;
        }
        const speed = getLegSpeed(unit, pos.x, pos.y, next.x, next.y);
        const d = distIn(pos.x, pos.y, next.x, next.y);
        if (d < 0.12 && !buildingTransition(pos.x, pos.y, next.x, next.y)) {
          if (index === path.length - 1) {
            state.planCurrent = lastTurn === state.turn;
            if (!state.planCurrent) state.planTurnOffset = lastTurn - state.turn;
            const from = lastLeg && { x: lastLeg.fromX, y: lastLeg.fromY };
            const clear = from && (def.category === 'land'
              ? !traceLandPath(from.x, from.y, next.x, next.y, !!def.canEnterBuilding, unit, true).blocked
              : def.category === 'sea' ? !traceSeaPath(from.x, from.y, next.x, next.y).blocked : true);
            if (clear && distIn(from.x, from.y, next.x, next.y) <= getLegSpeed(unit, from.x, from.y, next.x, next.y) + 0.05) {
              lastLeg.toX = next.x; lastLeg.toY = next.y;
              lastLeg.roadBonus = def.category === 'land' && segmentTouchesRoad(from.x, from.y, next.x, next.y);
              lastLeg.label = `${def.name} Move → (${next.x.toFixed(1)}", ${next.y.toFixed(1)}")${lastLeg.roadBonus ? ' [ROAD +1"]' : ''}`;
              index++;
            } else {
              failure = 'The final route leg is too short to schedule.';
            }
            break;
          }
          index++;
          continue;
        }
        let target = d > speed ? { x: pos.x + (next.x - pos.x) * speed / d, y: pos.y + (next.y - pos.y) * speed / d } : next;
        const actualSpeed = getLegSpeed(unit, pos.x, pos.y, target.x, target.y);
        if (distIn(pos.x, pos.y, target.x, target.y) > actualSpeed) {
          target = { x: pos.x + (next.x - pos.x) * actualSpeed / d, y: pos.y + (next.y - pos.y) * actualSpeed / d };
        }
        if (d <= speed) {
          for (let j = index + 1; j < path.length; j++) {
            const candidate = path[j];
            const clear = def.category === 'land' ? !traceLandPath(pos.x, pos.y, candidate.x, candidate.y, !!def.canEnterBuilding, unit, true).blocked :
              def.category === 'sea' ? !traceSeaPath(pos.x, pos.y, candidate.x, candidate.y).blocked : true;
            if (!clear) break;
            const distance = distIn(pos.x, pos.y, candidate.x, candidate.y);
            const maxSpeed = getLegSpeed(unit, pos.x, pos.y, candidate.x, candidate.y);
            if (distance > maxSpeed + 0.05) {
              let partial = { x: pos.x + (candidate.x - pos.x) * maxSpeed / distance,
                y: pos.y + (candidate.y - pos.y) * maxSpeed / distance };
              const partialSpeed = getLegSpeed(unit, pos.x, pos.y, partial.x, partial.y);
              if (partialSpeed < maxSpeed) {
                partial = { x: pos.x + (candidate.x - pos.x) * partialSpeed / distance,
                  y: pos.y + (candidate.y - pos.y) * partialSpeed / distance };
              }
              if (distIn(pos.x, pos.y, partial.x, partial.y) > distIn(pos.x, pos.y, target.x, target.y)) {
                target = partial; index = j;
              }
              break;
            }
            target = candidate; index = j;
          }
        }
        if (buildingMoveWait(unit, pos.x, pos.y, target.x, target.y, turn)) {
          turn++;
          continue;
        }
        if (!queueMoveLeg(unit, target.x, target.y, false)) { failure = 'A route leg is no longer valid.'; break; }
        legs++;
        const orders = getOrdersForTurn(player);
        lastLeg = orders[orders.length - 1];
        lastTurn = turn;
        pos = target;
        if (distIn(pos.x, pos.y, next.x, next.y) < 1e-8 || target === path[index]) index++;
      }
      state.planCurrent = oldCurrent;
      state.planTurnOffset = oldOffset;
      if (failure || legs >= 2000 || index < path.length) {
        state.orders[player] = oldOrders;
        state.futurePlans[player] = oldFuture;
        showToast(failure || 'Could not schedule the complete route.', 'warn');
        updateUI();
        return false;
      }
      showToast(legs ? `Scheduled ${legs} route leg(s) through turn ${turn}.` : 'The unit is already at the target.', 'success');
      setMode('IDLE');
      return true;
    }

    function rememberProducedRally(player, facility, unit) {
      if (netActive() && NET.role !== player) return;
      const target = state.rallyPoints[player][facility.id];
      if (target) state.pendingRallies[player].push({ unitId: unit.id, x: target.x, y: target.y });
    }

    function applyPendingRallies(player) {
      const pending = state.pendingRallies[player];
      state.pendingRallies[player] = [];
      for (const target of pending) {
        const unit = getEntityById(target.unitId);
        if (!unit || unit.owner !== player) continue;
        if (!queueRoute(unit, target.x, target.y)) {
          logPlan(player, `Could not route ${UNIT_DEFS[unit.type].name} to its rally point; choose a reachable destination.`, true);
          showToast(`Could not route ${UNIT_DEFS[unit.type].name} to its rally point.`, 'warn');
        }
      }
      resetPlanningTurn();
    }

    function formationSegmentClear(members, from, to) {
      return members.every(({ unit, dx, dy }) => {
        const a = { x: from.x + dx, y: from.y + dy };
        const b = { x: to.x + dx, y: to.y + dy };
        if ([a.x, b.x].some(x => x < 0 || x > MAP_W) || [a.y, b.y].some(y => y < 0 || y > MAP_H)) return false;
        const def = UNIT_DEFS[unit.type];
        if (def.category === 'air') return true;
        if (def.category === 'sea') return !traceSeaPath(a.x, a.y, b.x, b.y).blocked;
        return !traceLandPath(a.x, a.y, b.x, b.y, !!def.canEnterBuilding, unit, true).blocked;
      });
    }

    function queueGroupRoute(units, goalX, goalY) {
      const p = state.activePlayer;
      if (state.phase !== 'PLANNING' || (netActive() && NET.locked[p])) return false;
      if (!units.length || units.some(u => !u || u.kind !== 'unit' || u.owner !== p || UNIT_DEFS[u.type].speed <= 0)) {
        showToast('Select movable friendly units for the group route.', 'warn');
        return false;
      }
      const oldOrders = state.orders[p].slice(), oldFuture = state.futurePlans[p].slice();
      const oldCurrent = state.planCurrent, oldOffset = state.planTurnOffset;
      const groupRouteId = nextGroupRouteId++;
      let turn = state.turn;
      let changed;
      do {
        changed = false;
        for (const unit of units) {
          const next = selectAutomaticTurn(p, 'MOVE', MOVE_AP_COST, unit, null, turn);
          if (next > turn) { turn = next; changed = true; }
        }
      } while (changed);
      const positions = units.map(unit => getProjectedPosAtTurn(unit, p, turn));
      const center = {
        x: positions.reduce((sum, pos) => sum + pos.x, 0) / positions.length,
        y: positions.reduce((sum, pos) => sum + pos.y, 0) / positions.length
      };
      const start = positions[0];
      const goal = { x: start.x + goalX - center.x, y: start.y + goalY - center.y };
      const formation = units.map((unit, i) => ({ unit, dx: positions[i].x - start.x, dy: positions[i].y - start.y }));
      const path = findPathAStar(start.x, start.y, goal.x, goal.y, units[0].type, { player: p, formation });
      if (!path) {
        state.planCurrent = oldCurrent; state.planTurnOffset = oldOffset;
        showToast('No route keeps the whole formation on traversable terrain.', 'warn');
        return false;
      }
      let pos = start, index = 1, legs = 0, failure = '';
      while (index < path.length && legs < 2000) {
        state.planCurrent = turn === state.turn;
        if (!state.planCurrent) state.planTurnOffset = turn - state.turn;
        let target = null, nextIndex = index;
        for (let j = index; j < path.length; j++) {
          const candidate = path[j], distance = distIn(pos.x, pos.y, candidate.x, candidate.y);
          const crossesBuilding = formation.some(({ dx, dy }) =>
            buildingTransition(pos.x + dx, pos.y + dy, candidate.x + dx, candidate.y + dy));
          if (distance < 0.12 && !crossesBuilding) { if (j === path.length - 1) nextIndex = j + 1; continue; }
          if (!formationSegmentClear(formation, pos, candidate)) break;
          let speed = Math.min(...formation.map(({ unit, dx, dy }) =>
            getLegSpeed(unit, pos.x + dx, pos.y + dy, candidate.x + dx, candidate.y + dy)));
          if (distance > speed + 0.05) {
            if (j === path.length - 1 && distance - speed < 0.12) speed = distance / 2;
            let partial = { x: pos.x + (candidate.x - pos.x) * speed / distance,
              y: pos.y + (candidate.y - pos.y) * speed / distance };
            const partialSpeed = Math.min(...formation.map(({ unit, dx, dy }) =>
              getLegSpeed(unit, pos.x + dx, pos.y + dy, partial.x + dx, partial.y + dy)));
            if (partialSpeed < speed) {
              speed = partialSpeed;
              partial = { x: pos.x + (candidate.x - pos.x) * speed / distance,
                y: pos.y + (candidate.y - pos.y) * speed / distance };
            }
            if (formationSegmentClear(formation, pos, partial) &&
                (!target || distIn(pos.x, pos.y, partial.x, partial.y) > distIn(pos.x, pos.y, target.x, target.y))) {
              target = partial; nextIndex = j;
            }
            break;
          }
          target = candidate; nextIndex = j + 1;
        }
        if (!target) {
          if (nextIndex >= path.length && distIn(pos.x, pos.y, goal.x, goal.y) < 1e-8) break;
          failure = 'The formation cannot fit a valid move along this route.';
          break;
        }
        if (formation.some(({ unit, dx, dy }) => buildingMoveWait(unit,
            pos.x + dx, pos.y + dy, target.x + dx, target.y + dy, turn))) {
          turn++;
          continue;
        }
        for (const member of formation) {
          if (!queueMoveLeg(member.unit, target.x + member.dx, target.y + member.dy, false)) {
            failure = 'A group move is no longer valid.';
            break;
          }
          const order = getOrdersForTurn(p).slice(-1)[0];
          order.groupRouteId = groupRouteId;
          order.groupStep = legs;
        }
        if (failure) break;
        pos = target; index = nextIndex; legs++; turn++;
      }
      state.planCurrent = oldCurrent; state.planTurnOffset = oldOffset;
      if (failure || index < path.length || legs >= 2000) {
        state.orders[p] = oldOrders; state.futurePlans[p] = oldFuture;
        showToast(failure || 'Could not schedule the complete group route.', 'warn');
        updateUI();
        return false;
      }
      showToast(`Scheduled ${legs} group move(s) for ${units.length} units.`, 'success');
      setMode('IDLE');
      return true;
    }

    function isWithinOutskirts(x, y) {
      return x >= 0.6 && x <= MAP_W - 0.6 && y >= 0.6 && y <= MAP_H - 0.6 &&
        (x <= EDGE_DEPLOY_IN || x >= MAP_W - EDGE_DEPLOY_IN || y <= EDGE_DEPLOY_IN || y >= MAP_H - EDGE_DEPLOY_IN);
    }

    function rollDie(sides) {
      return Math.floor((netActive() ? netRand() : Math.random()) * Math.max(1, sides)) + 1;
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
