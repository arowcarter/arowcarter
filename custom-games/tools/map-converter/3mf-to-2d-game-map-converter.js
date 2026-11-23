/**
 * =========================================================================
 * 3MF to 2D Game Map Converter (Full Spatial & Location Edition)
 *
 * Core Modules:
 *  1. State & Constants (4 Tile Types: W, G, R, B)
 *  2. Full 3MF Scene-Graph & External p:path Archive Parser (JSZip)
 *  3. Procedural NYC Demo Terrain Generator (Manhattan, Rivers, Bridges, Skyscrapers)
 *  4. High-Resolution Aspect-True 2x2 Supersampled Z-Buffer Rasterizer
 *  5. Morphological Local Ground-Plane Estimator & Urban Classifier
 *  6. Hardware-Smooth Pan & Zoom (1x-16x) 2D GIS Canvas Renderer
 *  7. Georeferencing (Lat/Lon + m/tile) & Named Location Pin System
 *  8. Rich Metadata Text / CSV / JSON Exporter
 * =========================================================================
 */

const TYPE_GROUND   = 0;
const TYPE_WATER    = 1;
const TYPE_BUILDING = 2;
const TYPE_ROAD     = 3;

const TYPE_CHAR  = ['G', 'W', 'B', 'R'];
const TYPE_LABEL = ['Ground (G)', 'Water (W)', 'Building (B)', 'Road (R)'];

// Application State
const state = {
  model: null, // { fileName, objects, bbox, totalVertices, totalTriangles }
  longestEdge: 256,
  cols: 180,
  rows: 256,
  lockAspect: true,
  supersample: true,

  // Rasterized Buffers (cols * rows)
  zBuffer: null,          // Float32Array: total elevation
  groundBuffer: null,     // Float32Array: estimated local ground/street elevation
  bldgHeightBuffer: null, // Float32Array: structure height above ground
  objBuffer: null,        // Int32Array: winning 3MF object index
  autoTypes: null,        // Uint8Array: auto-classified tile types
  manualOverrides: null,  // Int8Array: -1 = none, else TYPE_*
  finalTypes: null,       // Uint8Array: final tile types

  // Classification Thresholds
  waterLevelPct: 8,
  bldgHeightPct: 4.5,
  morphRadius: 6,
  roadSensPct: 45,

  // View & Camera (Pan/Zoom)
  viewMode: 'combined', // 'combined' | 'heightmap' | 'buildings' | 'contours'
  zoom: 1,
  panX: 0,
  panY: 0,
  isDraggingPan: false,
  isPainting: false,
  spaceDown: false,
  dragStartX: 0,
  dragStartY: 0,
  panStartX: 0,
  panStartY: 0,
  offscreenMap: null, // Cached offscreen canvas for smooth 60fps pan/zoom

  // Tools & Brushes
  tool: 'pan', // 'pan' | 'pin' | 'water' | 'ground' | 'road' | 'building'
  brushSize: 1,
  hoverCell: null,
  pendingPinCell: null,

  // Georeferencing & Location Pins
  geo: { nwLat: null, nwLon: null, seLat: null, seLon: null },
  pins: [], // [{ id, name, col, row }]

  // Export Settings
  exportFormat: 'compact',
  cellFormat: 'split', // 'split' | 'total'
  elevScale: '0-99',
  delimiter: ' ',
};

// DOM Element Cache
const el = {
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  btnLoadDemoHeader: document.getElementById('btnLoadDemoHeader'),
  btnLoadDemoEmpty: document.getElementById('btnLoadDemoEmpty'),
  progressWrapper: document.getElementById('progressWrapper'),
  progressLabel: document.getElementById('progressLabel'),
  progressPct: document.getElementById('progressPct'),
  progressBar: document.getElementById('progressBar'),
  diagnosticsBar: document.getElementById('diagnosticsBar'),
  diagFile: document.getElementById('diagFile'),
  diagObjects: document.getElementById('diagObjects'),
  diagTris: document.getElementById('diagTris'),
  diagDims: document.getElementById('diagDims'),
  diagGrid: document.getElementById('diagGrid'),
  objectTaggingSection: document.getElementById('objectTaggingSection'),
  objCountBadge: document.getElementById('objCountBadge'),
  objectList: document.getElementById('objectList'),
  lockAspect: document.getElementById('lockAspect'),
  longestEdgeSlider: document.getElementById('longestEdgeSlider'),
  longestEdgeVal: document.getElementById('longestEdgeVal'),
  gridCols: document.getElementById('gridCols'),
  gridRows: document.getElementById('gridRows'),
  supersampleToggle: document.getElementById('supersampleToggle'),
  btnRasterize: document.getElementById('btnRasterize'),
  waterLevelSlider: document.getElementById('waterLevelSlider'),
  waterLevelVal: document.getElementById('waterLevelVal'),
  bldgHeightSlider: document.getElementById('bldgHeightSlider'),
  bldgHeightVal: document.getElementById('bldgHeightVal'),
  morphRadiusSlider: document.getElementById('morphRadiusSlider'),
  morphRadiusVal: document.getElementById('morphRadiusVal'),
  roadSensSlider: document.getElementById('roadSensSlider'),
  roadSensVal: document.getElementById('roadSensVal'),
  countWater: document.getElementById('countWater'),
  countGround: document.getElementById('countGround'),
  countRoad: document.getElementById('countRoad'),
  countBuilding: document.getElementById('countBuilding'),
  geoNwLat: document.getElementById('geoNwLat'),
  geoNwLon: document.getElementById('geoNwLon'),
  geoSeLat: document.getElementById('geoSeLat'),
  geoSeLon: document.getElementById('geoSeLon'),
  btnPresetNYC: document.getElementById('btnPresetNYC'),
  btnClearGeo: document.getElementById('btnClearGeo'),
  geoScaleReadout: document.getElementById('geoScaleReadout'),
  pinCount: document.getElementById('pinCount'),
  pinList: document.getElementById('pinList'),
  pinModal: document.getElementById('pinModal'),
  pinModalCoords: document.getElementById('pinModalCoords'),
  pinNameInput: document.getElementById('pinNameInput'),
  btnSavePin: document.getElementById('btnSavePin'),
  btnCancelPin: document.getElementById('btnCancelPin'),
  btnCancelPinX: document.getElementById('btnCancelPinX'),
  canvasContainer: document.getElementById('canvasContainer'),
  mapCanvas: document.getElementById('mapCanvas'),
  emptyOverlay: document.getElementById('emptyOverlay'),
  btnZoomIn: document.getElementById('btnZoomIn'),
  btnZoomOut: document.getElementById('btnZoomOut'),
  btnResetView: document.getElementById('btnResetView'),
  zoomReadout: document.getElementById('zoomReadout'),
  brushSize: document.getElementById('brushSize'),
  btnResetEdits: document.getElementById('btnResetEdits'),
  hudGrid: document.getElementById('hudGrid'),
  hudType: document.getElementById('hudType'),
  hudElev: document.getElementById('hudElev'),
  hudBldg: document.getElementById('hudBldg'),
  hudModel: document.getElementById('hudModel'),
  hudLatLon: document.getElementById('hudLatLon'),
  exportFormat: document.getElementById('exportFormat'),
  cellFormat: document.getElementById('cellFormat'),
  cellFormatWrapper: document.getElementById('cellFormatWrapper'),
  elevScale: document.getElementById('elevScale'),
  compactDelimiter: document.getElementById('compactDelimiter'),
  delimiterWrapper: document.getElementById('delimiterWrapper'),
  exportPreview: document.getElementById('exportPreview'),
  exportMeta: document.getElementById('exportMeta'),
  btnCopy: document.getElementById('btnCopy'),
  btnDownload: document.getElementById('btnDownload'),
  toastContainer: document.getElementById('toastContainer'),
};

const ctx = el.mapCanvas.getContext('2d');

/**
 * =========================================================================
 * 1. Toast Notifications & Async Yield
 * =========================================================================
 */
function showToast(message, type = 'info') {
  const styles = {
    info: 'bg-slate-800 border-slate-700 text-slate-100',
    success: 'bg-emerald-950/95 border-emerald-700/80 text-emerald-200',
    error: 'bg-rose-950/95 border-rose-700/80 text-rose-200',
  };
  const div = document.createElement('div');
  div.className = `pointer-events-auto px-4 py-2.5 rounded-xl border text-xs font-medium shadow-2xl transition-all duration-300 opacity-0 translate-y-2 ${styles[type] || styles.info}`;
  div.textContent = message;
  el.toastContainer.appendChild(div);
  requestAnimationFrame(() => div.classList.remove('opacity-0', 'translate-y-2'));
  setTimeout(() => {
    div.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => div.remove(), 300);
  }, 3400);
}

function setProgress(visible, label = '', pct = 0) {
  if (!visible) {
    el.progressWrapper.classList.add('hidden');
    return;
  }
  el.progressWrapper.classList.remove('hidden');
  el.progressLabel.textContent = label;
  el.progressPct.textContent = `${Math.round(pct)}%`;
  el.progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function yieldFrame() {
  return new Promise((resolve) => setTimeout(resolve, 16));
}

/**
 * =========================================================================
 * 2. Complete 3MF Archive & Scene-Graph Parser (Production Extension Ready)
 * =========================================================================
 */
function identityMatrix() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
}

function parseTransform(str) {
  if (!str) return identityMatrix();
  const nums = str.trim().split(/\s+/).map(Number);
  if (nums.length !== 12 || nums.some(Number.isNaN)) return identityMatrix();
  return nums;
}

function multiplyMatrices(a, b) {
  const out = new Array(12);
  for (let r = 0; r < 3; r++) {
    const a0 = a[r * 3], a1 = a[r * 3 + 1], a2 = a[r * 3 + 2];
    out[r * 3]     = a0 * b[0] + a1 * b[3] + a2 * b[6];
    out[r * 3 + 1] = a0 * b[1] + a1 * b[4] + a2 * b[7];
    out[r * 3 + 2] = a0 * b[2] + a1 * b[5] + a2 * b[8];
  }
  const tx = a[9], ty = a[10], tz = a[11];
  out[9]  = tx * b[0] + ty * b[3] + tz * b[6] + b[9];
  out[10] = tx * b[1] + ty * b[4] + tz * b[7] + b[10];
  out[11] = tx * b[2] + ty * b[5] + tz * b[8] + b[11];
  return out;
}

function transformVertices(verts, mat) {
  const out = new Float32Array(verts.length);
  const m0 = mat[0], m1 = mat[1], m2 = mat[2];
  const m3 = mat[3], m4 = mat[4], m5 = mat[5];
  const m6 = mat[6], m7 = mat[7], m8 = mat[8];
  const m9 = mat[9], m10 = mat[10], m11 = mat[11];
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    out[i]     = x * m0 + y * m3 + z * m6 + m9;
    out[i + 1] = x * m1 + y * m4 + z * m7 + m10;
    out[i + 2] = x * m2 + y * m5 + z * m8 + m11;
  }
  return out;
}

function extractAttr(tagStr, attrName) {
  const re = new RegExp(`(?:^|\\s)(?:[a-zA-Z0-9_-]+:)?${attrName}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = re.exec(tagStr);
  return m ? m[1] : null;
}

function parseMeshBlock(meshXml) {
  const vChunks = [];
  const vertexRe = /<vertex\b([^>]*)\/?>/gi;
  const numRe = /\b([xyz])\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = vertexRe.exec(meshXml)) !== null) {
    const attrs = m[1];
    let x = 0, y = 0, z = 0;
    numRe.lastIndex = 0;
    let nm;
    while ((nm = numRe.exec(attrs)) !== null) {
      const k = nm[1].toLowerCase();
      const val = parseFloat(nm[2]);
      if (k === 'x') x = val;
      else if (k === 'y') y = val;
      else if (k === 'z') z = val;
    }
    vChunks.push(x, y, z);
  }

  const tChunks = [];
  const triRe = /<triangle\b([^>]*)\/?>/gi;
  const idxRe = /\bv([123])\s*=\s*["'](\d+)["']/gi;
  while ((m = triRe.exec(meshXml)) !== null) {
    const attrs = m[1];
    let v1 = 0, v2 = 0, v3 = 0;
    idxRe.lastIndex = 0;
    let im;
    while ((im = idxRe.exec(attrs)) !== null) {
      const k = im[1];
      const val = parseInt(im[2], 10);
      if (k === '1') v1 = val;
      else if (k === '2') v2 = val;
      else if (k === '3') v3 = val;
    }
    tChunks.push(v1, v2, v3);
  }

  return {
    vertices: new Float32Array(vChunks),
    triangles: new Uint32Array(tChunks),
  };
}

function parseModelXml(xmlText) {
  const rawObjects = new Map();
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
  let m;
  while ((m = objRe.exec(xmlText)) !== null) {
    const openTag = m[1];
    const inner = m[2];
    const id = extractAttr(openTag, 'id') || String(rawObjects.size + 1);
    const name = extractAttr(openTag, 'name') || `Object #${id}`;

    const meshMatch = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/i.exec(inner);
    const compMatch = /<components\b[^>]*>([\s\S]*?)<\/components>/i.exec(inner);

    const objEntry = { id, name, mesh: null, components: [] };
    if (meshMatch) objEntry.mesh = parseMeshBlock(meshMatch[1]);

    if (compMatch) {
      const cRe = /<component\b([^>]*)\/?>/gi;
      let cm;
      while ((cm = cRe.exec(compMatch[1])) !== null) {
        const cAttrs = cm[1];
        const refId = extractAttr(cAttrs, 'objectid');
        const refPath = extractAttr(cAttrs, 'path'); // Matches both path="..." and p:path="..."
        const mat = parseTransform(extractAttr(cAttrs, 'transform'));
        if (refId) {
          objEntry.components.push({ objectid: refId, path: refPath, transform: mat });
        }
      }
    }
    rawObjects.set(id, objEntry);
  }

  const buildItems = [];
  const buildMatch = /<build\b[^>]*>([\s\S]*?)<\/build>/i.exec(xmlText);
  if (buildMatch) {
    const itemRe = /<item\b([^>]*)\/?>/gi;
    let im;
    while ((im = itemRe.exec(buildMatch[1])) !== null) {
      const attrs = im[1];
      const objectid = extractAttr(attrs, 'objectid');
      const itemPath = extractAttr(attrs, 'path');
      const mat = parseTransform(extractAttr(attrs, 'transform'));
      if (objectid) buildItems.push({ objectid, path: itemPath, transform: mat });
    }
  }

  return { rawObjects, buildItems };
}

function inferInitialTag(name) {
  const lower = (name || '').toLowerCase();
  if (/(water|river|lake|ocean|sea|bay|harbor|canal)/.test(lower)) return 'water';
  if (/(build|house|tower|skyscraper|struct|roof)/.test(lower)) return 'building';
  if (/(road|street|highway|bridge|avenue|path)/.test(lower)) return 'road';
  if (/(park|terrain|ground|land|base)/.test(lower)) return 'auto';
  return 'auto';
}

async function parse3MFFile(file) {
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip library failed to load.');
  }

  setProgress(true, 'Unzipping .3mf archive...', 10);
  await yieldFrame();

  const zip = await JSZip.loadAsync(file);
  const modelPaths = Object.keys(zip.files).filter(
    (p) => !zip.files[p].dir && p.toLowerCase().endsWith('.model')
  );

  if (modelPaths.length === 0) {
    throw new Error('No .model files found inside this .3mf archive.');
  }

  let primaryPath =
    modelPaths.find((p) => p.toLowerCase() === '3d/3dmodel.model') ||
    modelPaths.find((p) => p.toLowerCase().startsWith('3d/')) ||
    modelPaths[0];

  const parsedFiles = new Map();
  for (let i = 0; i < modelPaths.length; i++) {
    const p = modelPaths[i];
    const normPath = '/' + p.replace(/^\/+/, '').toLowerCase();
    setProgress(true, `Parsing ${p} (${i + 1}/${modelPaths.length})...`, 15 + ((i + 1) / modelPaths.length) * 55);
    await yieldFrame();
    const text = await zip.files[p].async('string');
    parsedFiles.set(normPath, parseModelXml(text));
  }

  const normPrimary = '/' + primaryPath.replace(/^\/+/, '').toLowerCase();
  const primaryData = parsedFiles.get(normPrimary);

  const resolvedObjects = [];

  function resolveObject(fileNormPath, objId, parentMat, parentName = null, depth = 0) {
    if (depth > 20) return;
    const fData = parsedFiles.get(fileNormPath);
    if (!fData) return;
    const obj = fData.rawObjects.get(objId);
    if (!obj) return;

    const cleanName = obj.name && !obj.name.startsWith('Object #') ? obj.name : (parentName || obj.name);

    if (obj.mesh && obj.mesh.triangles.length > 0) {
      const worldVerts = transformVertices(obj.mesh.vertices, parentMat);
      resolvedObjects.push({
        id: `${resolvedObjects.length + 1}`,
        name: cleanName,
        vertices: worldVerts,
        triangles: obj.mesh.triangles,
        vertexCount: worldVerts.length / 3,
        triangleCount: obj.mesh.triangles.length / 3,
        tag: inferInitialTag(cleanName),
      });
    }

    if (obj.components && obj.components.length > 0) {
      for (const comp of obj.components) {
        const nextMat = multiplyMatrices(comp.transform, parentMat);
        const nextPath = comp.path
          ? '/' + comp.path.replace(/^\/+/, '').toLowerCase()
          : fileNormPath;
        resolveObject(nextPath, comp.objectid, nextMat, cleanName, depth + 1);
      }
    }
  }

  if (primaryData.buildItems.length > 0) {
    for (const item of primaryData.buildItems) {
      const targetPath = item.path
        ? '/' + item.path.replace(/^\/+/, '').toLowerCase()
        : normPrimary;
      resolveObject(targetPath, item.objectid, item.transform);
    }
  } else {
    for (const [fPath, fData] of parsedFiles.entries()) {
      for (const [id] of fData.rawObjects) {
        resolveObject(fPath, id, identityMatrix());
      }
    }
  }

  if (resolvedObjects.length === 0) {
    throw new Error('No triangles could be resolved from this .3mf archive.');
  }

  return finalizeModelData(file.name, resolvedObjects);
}

function finalizeModelData(fileName, objects) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let totalVertices = 0;
  let totalTriangles = 0;

  for (const obj of objects) {
    totalVertices += obj.vertexCount;
    totalTriangles += obj.triangleCount;
    const v = obj.vertices;
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i], y = v[i + 1], z = v[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  return {
    fileName,
    objects,
    bbox: { minX, maxX, minY, maxY, minZ, maxZ },
    totalVertices,
    totalTriangles,
  };
}

/**
 * =========================================================================
 * 3. Procedural NYC Demo Terrain Generator (Non-Square Manhattan Model)
 *    Dimensions: 140 x 200 units (Exact 0.70 aspect ratio)
 *    Includes: Hudson & East Rivers, Lower/Midtown Manhattan, Brooklyn Shore,
 *    Governors Island, Central Park, Bridges, Street Grid & Skyscrapers.
 * =========================================================================
 */
function generateNYCDemoModel() {
  const sizeX = 140;
  const sizeY = 200;
  const nxGrid = 96;
  const nyGrid = 136;

  // Signed-distance helpers for Manhattan & Brooklyn shorelines
  function isManhattanLand(x, y) {
    // Manhattan tilts slightly NE; tapers cleanly to Battery Park at south
    const center = 58 + (y - 30) * 0.08;
    let halfW = 24;
    if (y < 42) {
      // Lower Manhattan tip tapering to Battery Park (y ~ 22)
      const t = Math.max(0, (y - 20) / 22);
      halfW = 24 * Math.pow(t, 0.72);
    } else if (y > 165) {
      halfW = 25;
    }
    // Subtle Hudson & East River bends
    const westEdge = center - halfW + 2.2 * Math.sin(y * 0.045);
    const eastEdge = center + halfW + 3.0 * Math.cos(y * 0.038);
    return x >= westEdge && x <= eastEdge && y >= 20;
  }

  function isBrooklynLand(x, y) {
    // Brooklyn / Queens shoreline across the East River
    const shore = 98 + (y - 30) * 0.12 + 4.5 * Math.sin(y * 0.05 + 1.1);
    return x >= shore && y >= 14;
  }

  function isJerseyShore(x, y) {
    const shore = 17 + (y - 30) * 0.06 + 2.5 * Math.sin(y * 0.06);
    return x <= shore && y >= 25;
  }

  function isGovernorsIsland(x, y) {
    return Math.hypot((x - 58) / 8.5, (y - 11) / 5.5) <= 1.0;
  }

  function terrainZ(x, y) {
    if (isManhattanLand(x, y)) {
      // Gentle urban topography rising north toward Midtown / Upper West Side
      let z = 3.2 + (y / sizeY) * 2.6 + 0.6 * Math.sin(x * 0.08) * Math.cos(y * 0.05);
      // Central Park basin in upper middle (x: 56..74, y: 145..188)
      if (x > 55 && x < 75 && y > 144 && y < 188) {
        z += 0.9 * Math.sin((x - 55) * 0.25) * Math.sin((y - 144) * 0.18);
      }
      return z;
    }
    if (isBrooklynLand(x, y)) {
      return 3.4 + (x - 98) * 0.06 + 0.5 * Math.sin(y * 0.07);
    }
    if (isJerseyShore(x, y)) {
      return 3.0 + (18 - x) * 0.07;
    }
    if (isGovernorsIsland(x, y)) {
      return 2.9;
    }
    return 0.6; // Riverbed below water plane
  }

  // 1. Terrain Mesh
  const tVerts = new Float32Array((nxGrid + 1) * (nyGrid + 1) * 3);
  let ptr = 0;
  for (let j = 0; j <= nyGrid; j++) {
    const y = (j / nyGrid) * sizeY;
    for (let i = 0; i <= nxGrid; i++) {
      const x = (i / nxGrid) * sizeX;
      tVerts[ptr++] = x;
      tVerts[ptr++] = y;
      tVerts[ptr++] = terrainZ(x, y);
    }
  }
  const tTris = new Uint32Array(nxGrid * nyGrid * 6);
  let tPtr = 0;
  for (let j = 0; j < nyGrid; j++) {
    for (let i = 0; i < nxGrid; i++) {
      const a = j * (nxGrid + 1) + i;
      const b = a + 1;
      const c = (j + 1) * (nxGrid + 1) + i;
      const d = c + 1;
      tTris[tPtr++] = a; tTris[tPtr++] = b; tTris[tPtr++] = d;
      tTris[tPtr++] = a; tTris[tPtr++] = d; tTris[tPtr++] = c;
    }
  }

  // 2. Water Plane Mesh (Hudson + East River + Harbor at z = 1.9)
  const waterZ = 1.9;
  const wVerts = new Float32Array([
    0, 0, waterZ,
    sizeX, 0, waterZ,
    sizeX, sizeY, waterZ,
    0, sizeY, waterZ,
  ]);
  const wTris = new Uint32Array([0, 1, 2, 0, 2, 3]);

  // Helper to push a 3D box into vertex/triangle arrays
  function addBox(vList, tList, x0, y0, x1, y1, z0, z1) {
    const base = vList.length / 3;
    vList.push(
      x0, y0, z0,  x1, y0, z0,  x1, y1, z0,  x0, y1, z0,
      x0, y0, z1,  x1, y0, z1,  x1, y1, z1,  x0, y1, z1
    );
    const f = [
      4, 5, 6,  4, 6, 7,
      0, 1, 5,  0, 5, 4,
      1, 2, 6,  1, 6, 5,
      2, 3, 7,  2, 7, 6,
      3, 0, 4,  3, 4, 7,
    ];
    for (const k of f) tList.push(base + k);
  }

  // 3. Manhattan & Brooklyn Dense Building Blocks (respecting street corridors & Central Park)
  const bVerts = [];
  const bTris = [];

  // Deterministic pseudo-random for repeatable NYC skyline
  let seed = 42109;
  function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  // Grid of Manhattan city blocks (leaving narrow streets between blocks)
  for (let by = 26; by < 192; by += 7.5) {
    for (let bx = 34; bx < 134; bx += 7.0) {
      const cx = bx + 2.6;
      const cy = by + 2.7;

      // Keep Central Park open & green
      if (cx > 55 && cx < 75 && cy > 144 && cy < 188) continue;
      // Keep Battery Park green at the southern tip
      if (cy < 28 && cx < 63) continue;

      const onManh = isManhattanLand(bx + 0.5, by + 0.5) && isManhattanLand(bx + 4.8, by + 5.0);
      const onBkln = isBrooklynLand(bx + 0.5, by + 0.5) && isBrooklynLand(bx + 4.8, by + 5.0);
      if (!onManh && !onBkln) continue;

      // Skyline height profile: Financial District (y~34..52) & Midtown (y~105..140)
      const dFiDi = Math.hypot((cx - 57) / 14, (cy - 40) / 14);
      const dMidtown = Math.hypot((cx - 64) / 17, (cy - 122) / 19);
      const dBklnDT = Math.hypot((cx - 110) / 14, (cy - 38) / 14);

      let height = 3.2 + rand() * 3.5;
      if (onManh) {
        height += 26 * Math.exp(-(dFiDi * dFiDi)) * (0.65 + rand() * 0.7);
        height += 29 * Math.exp(-(dMidtown * dMidtown)) * (0.65 + rand() * 0.75);
      } else if (onBkln) {
        height += 12 * Math.exp(-(dBklnDT * dBklnDT)) * (0.5 + rand() * 0.8);
      }

      const gZ = terrainZ(cx, cy);
      const bw = 4.6 + rand() * 0.9;
      const bd = 4.8 + rand() * 1.0;
      addBox(bVerts, bTris, bx, by, bx + bw, by + bd, gZ - 0.5, gZ + height);
    }
  }

  // Iconic Landmark Towers: One WTC & Empire State Building
  addBox(bVerts, bTris, 51, 37, 56.5, 42.5, 3.0, 44.0);   // One WTC
  addBox(bVerts, bTris, 61, 114, 67, 120, 4.0, 42.0);     // Empire State

  // 4. Bridges & Piers Mesh (East River Bridges: Brooklyn, Manhattan, Williamsburg)
  const brVerts = [];
  const brTris = [];
  addBox(brVerts, brTris, 68, 38, 104, 41.2, 2.2, 5.2);   // Brooklyn Bridge
  addBox(brVerts, brTris, 72, 47, 106, 50.2, 2.2, 5.4);   // Manhattan Bridge
  addBox(brVerts, brTris, 80, 66, 112, 69.2, 2.2, 5.3);   // Williamsburg Bridge
  // Hudson Piers
  for (let py = 65; py <= 135; py += 14) {
    addBox(brVerts, brTris, 29, py, 41, py + 2.4, 1.5, 3.3);
  }

  const objects = [
    {
      id: '1',
      name: 'NYC_Terrain_Base',
      vertices: tVerts,
      triangles: tTris,
      vertexCount: tVerts.length / 3,
      triangleCount: tTris.length / 3,
      tag: 'auto',
    },
    {
      id: '2',
      name: 'Hudson_East_Rivers_Water',
      vertices: wVerts,
      triangles: wTris,
      vertexCount: wVerts.length / 3,
      triangleCount: wTris.length / 3,
      tag: 'water',
    },
    {
      id: '3',
      name: 'Manhattan_Brooklyn_Buildings',
      vertices: new Float32Array(bVerts),
      triangles: new Uint32Array(bTris),
      vertexCount: bVerts.length / 3,
      triangleCount: bTris.length / 3,
      tag: 'auto',
    },
    {
      id: '4',
      name: 'Bridges_And_Piers_Road',
      vertices: new Float32Array(brVerts),
      triangles: new Uint32Array(brTris),
      vertexCount: brVerts.length / 3,
      triangleCount: brTris.length / 3,
      tag: 'road',
    },
  ];

  return finalizeModelData('nyc-manhattan-demo.3mf', objects);
}

/**
 * =========================================================================
 * 4. High-Resolution Aspect-Ratio-True 2x2 Supersampled Z-Buffer Rasterizer
 * =========================================================================
 */
function rasterizeModelToGrid() {
  if (!state.model) return;

  const { objects, bbox } = state.model;
  const cols = state.cols;
  const rows = state.rows;
  const totalCells = cols * rows;

  const ss = state.supersample ? 2 : 1;
  const sCols = cols * ss;
  const sRows = rows * ss;
  const sTotal = sCols * sRows;

  const sZBuf = new Float32Array(sTotal);
  const sObjBuf = new Int32Array(sTotal);
  sZBuf.fill(-Infinity);
  sObjBuf.fill(-1);

  const spanX = Math.max(1e-6, bbox.maxX - bbox.minX);
  const spanY = Math.max(1e-6, bbox.maxY - bbox.minY);
  const scaleX = sCols / spanX;
  const scaleY = sRows / spanY;
  const minX = bbox.minX;
  const maxY = bbox.maxY;

  let rasterizedTris = 0;

  for (let objIdx = 0; objIdx < objects.length; objIdx++) {
    const obj = objects[objIdx];
    if (obj.tag === 'ignore') continue;

    const verts = obj.vertices;
    const tris = obj.triangles;
    const triLen = tris.length;
    rasterizedTris += obj.triangleCount;

    for (let t = 0; t < triLen; t += 3) {
      const i0 = tris[t] * 3;
      const i1 = tris[t + 1] * 3;
      const i2 = tris[t + 2] * 3;

      const gx0 = (verts[i0] - minX) * scaleX;
      const gy0 = (maxY - verts[i0 + 1]) * scaleY;
      const z0 = verts[i0 + 2];

      const gx1 = (verts[i1] - minX) * scaleX;
      const gy1 = (maxY - verts[i1 + 1]) * scaleY;
      const z1 = verts[i1 + 2];

      const gx2 = (verts[i2] - minX) * scaleX;
      const gy2 = (maxY - verts[i2 + 1]) * scaleY;
      const z2 = verts[i2 + 2];

      const minC = Math.max(0, Math.floor(Math.min(gx0, gx1, gx2)));
      const maxC = Math.min(sCols - 1, Math.floor(Math.max(gx0, gx1, gx2)));
      const minR = Math.max(0, Math.floor(Math.min(gy0, gy1, gy2)));
      const maxR = Math.min(sRows - 1, Math.floor(Math.max(gy0, gy1, gy2)));

      if (minC > maxC || minR > maxR) continue;

      const denom = (gy1 - gy2) * (gx0 - gx2) + (gx2 - gx1) * (gy0 - gy2);
      if (Math.abs(denom) < 1e-9) continue;
      const invDenom = 1 / denom;

      const a0 = gy1 - gy2;
      const b0 = gx2 - gx1;
      const a1 = gy2 - gy0;
      const b1 = gx0 - gx2;

      for (let r = minR; r <= maxR; r++) {
        const dy = (r + 0.5) - gy2;
        const rowOffset = r * sCols;

        for (let c = minC; c <= maxC; c++) {
          const dx = (c + 0.5) - gx2;
          const w0 = (a0 * dx + b0 * dy) * invDenom;
          if (w0 < -1e-5) continue;
          const w1 = (a1 * dx + b1 * dy) * invDenom;
          if (w1 < -1e-5) continue;
          const w2 = 1 - w0 - w1;
          if (w2 < -1e-5) continue;

          const z = w0 * z0 + w1 * z1 + w2 * z2;
          const idx = rowOffset + c;
          if (z > sZBuf[idx]) {
            sZBuf[idx] = z;
            sObjBuf[idx] = objIdx;
          }
        }
      }
    }
  }

  // Downsample 2x2 sub-cells into final (cols x rows) grid
  const zBuf = new Float32Array(totalCells);
  const objBuf = new Int32Array(totalCells);

  if (ss === 1) {
    zBuf.set(sZBuf);
    objBuf.set(sObjBuf);
  } else {
    for (let r = 0; r < rows; r++) {
      const sr = r * 2;
      const outRow = r * cols;
      for (let c = 0; c < cols; c++) {
        const sc = c * 2;
        const idx0 = sr * sCols + sc;
        const idx1 = idx0 + 1;
        const idx2 = idx0 + sCols;
        const idx3 = idx2 + 1;

        const idxs = [idx0, idx1, idx2, idx3];
        let bestZ = -Infinity;
        let bestObj = -1;
        let waterHits = 0;
        let waterZ = -Infinity;
        let waterObj = -1;

        for (let k = 0; k < 4; k++) {
          const si = idxs[k];
          const sz = sZBuf[si];
          const so = sObjBuf[si];
          if (sz > bestZ) {
            bestZ = sz;
            bestObj = so;
          }
          if (so >= 0 && objects[so] && objects[so].tag === 'water') {
            waterHits++;
            if (sz > waterZ) { waterZ = sz; waterObj = so; }
          }
        }

        // Preserve explicit water channels if >= 3 of 4 subsamples are water
        if (waterHits >= 3 && bestObj >= 0 && objects[bestObj].tag !== 'road') {
          zBuf[outRow + c] = waterZ;
          objBuf[outRow + c] = waterObj;
        } else {
          zBuf[outRow + c] = bestZ;
          objBuf[outRow + c] = bestObj;
        }
      }
    }
  }

  // Fill any unhit micro-gaps from neighbors
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (zBuf[idx] === -Infinity) {
        let sum = 0, cnt = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
              const nz = zBuf[nr * cols + nc];
              if (nz > -Infinity) { sum += nz; cnt++; }
            }
          }
        }
        zBuf[idx] = cnt > 0 ? sum / cnt : bbox.minZ;
      }
    }
  }

  state.zBuffer = zBuf;
  state.objBuffer = objBuf;
  state.groundBuffer = new Float32Array(totalCells);
  state.bldgHeightBuffer = new Float32Array(totalCells);
  state.autoTypes = new Uint8Array(totalCells);
  state.manualOverrides = new Int8Array(totalCells);
  state.manualOverrides.fill(-1);
  state.finalTypes = new Uint8Array(totalCells);

  el.diagTris.textContent = rasterizedTris.toLocaleString();
  el.diagGrid.textContent = `${cols}×${rows}${state.supersample ? ' (2×SS)' : ''}`;

  classifyUrbanFeatures();
}

/**
 * =========================================================================
 * 5. Morphological Local Ground-Plane Estimator & Urban Classifier (W/G/R/B)
 *    Separates underlying street/terrain elevation from building height so
 *    entire city blocks & skyscrapers are preserved cleanly.
 * =========================================================================
 */
function classifyUrbanFeatures() {
  if (!state.model || !state.zBuffer) return;

  const cols = state.cols;
  const rows = state.rows;
  const total = cols * rows;
  const zBuf = state.zBuffer;
  const objBuf = state.objBuffer;
  const objects = state.model.objects;
  const { minZ, maxZ } = state.model.bbox;
  const zRange = Math.max(1e-6, maxZ - minZ);

  const waterCutoff = minZ + (state.waterLevelPct / 100) * zRange;
  const bldgMinH = (state.bldgHeightPct / 100) * zRange;
  const rad = state.morphRadius;

  // Separable 2D Morphological Opening (Erosion -> Dilation) for bare-earth ground plane
  const tmp1 = new Float32Array(total);
  const eroded = new Float32Array(total);
  const tmp2 = new Float32Array(total);
  const opened = state.groundBuffer;

  // Clamp water cells to waterCutoff during erosion so rivers don't drag down adjacent piers/streets
  const landZ = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    landZ[i] = Math.max(zBuf[i], waterCutoff);
  }

  // Horizontal Erosion
  for (let r = 0; r < rows; r++) {
    const ro = r * cols;
    for (let c = 0; c < cols; c++) {
      let m = Infinity;
      const c0 = Math.max(0, c - rad);
      const c1 = Math.min(cols - 1, c + rad);
      for (let k = c0; k <= c1; k++) {
        const v = landZ[ro + k];
        if (v < m) m = v;
      }
      tmp1[ro + c] = m;
    }
  }
  // Vertical Erosion
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      let m = Infinity;
      const r0 = Math.max(0, r - rad);
      const r1 = Math.min(rows - 1, r + rad);
      for (let k = r0; k <= r1; k++) {
        const v = tmp1[k * cols + c];
        if (v < m) m = v;
      }
      eroded[r * cols + c] = m;
    }
  }
  // Horizontal Dilation
  for (let r = 0; r < rows; r++) {
    const ro = r * cols;
    for (let c = 0; c < cols; c++) {
      let m = -Infinity;
      const c0 = Math.max(0, c - rad);
      const c1 = Math.min(cols - 1, c + rad);
      for (let k = c0; k <= c1; k++) {
        const v = eroded[ro + k];
        if (v > m) m = v;
      }
      tmp2[ro + c] = m;
    }
  }
  // Vertical Dilation
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      let m = -Infinity;
      const r0 = Math.max(0, r - rad);
      const r1 = Math.min(rows - 1, r + rad);
      for (let k = r0; k <= r1; k++) {
        const v = tmp2[k * cols + c];
        if (v > m) m = v;
      }
      const idx = r * cols + c;
      // Ground elevation cannot exceed actual surface elevation
      opened[idx] = Math.min(zBuf[idx], m);
    }
  }

  // First pass: assign Water, Building, Ground, and compute Building Height
  const auto = state.autoTypes;
  const bldgH = state.bldgHeightBuffer;

  for (let i = 0; i < total; i++) {
    const objIdx = objBuf[i];
    const tag = objIdx >= 0 && objects[objIdx] ? objects[objIdx].tag : 'auto';
    const z = zBuf[i];
    const g = opened[i];
    const diff = Math.max(0, z - g);

    if (tag === 'water') {
      auto[i] = TYPE_WATER;
      bldgH[i] = 0;
    } else if (tag === 'building') {
      auto[i] = TYPE_BUILDING;
      bldgH[i] = diff > 0.1 ? diff : Math.max(0, z - waterCutoff);
    } else if (tag === 'road') {
      auto[i] = TYPE_ROAD;
      bldgH[i] = 0;
    } else if (tag === 'ground') {
      auto[i] = TYPE_GROUND;
      bldgH[i] = 0;
    } else {
      // Auto urban classification
      if (z <= waterCutoff + 1e-5) {
        auto[i] = TYPE_WATER;
        bldgH[i] = 0;
      } else if (diff >= bldgMinH) {
        auto[i] = TYPE_BUILDING;
        bldgH[i] = diff;
      } else {
        auto[i] = TYPE_GROUND;
        bldgH[i] = 0;
      }
    }
  }

  // Second pass: Urban Road / Flat Corridor detection (streets between buildings)
  if (state.roadSensPct > 0) {
    const flatSlopeMax = (0.015 + (state.roadSensPct / 100) * 0.035) * zRange;
    const searchR = state.roadSensPct >= 60 ? 3 : 2;

    // Precompute building proximity mask
    const nearBldg = new Uint8Array(total);
    for (let r = 0; r < rows; r++) {
      const ro = r * cols;
      for (let c = 0; c < cols; c++) {
        if (auto[ro + c] === TYPE_BUILDING) {
          const r0 = Math.max(0, r - searchR), r1 = Math.min(rows - 1, r + searchR);
          const c0 = Math.max(0, c - searchR), c1 = Math.min(cols - 1, c + searchR);
          for (let rr = r0; rr <= r1; rr++) {
            const rro = rr * cols;
            for (let cc = c0; cc <= c1; cc++) {
              nearBldg[rro + cc] = 1;
            }
          }
        }
      }
    }

    for (let r = 1; r < rows - 1; r++) {
      const ro = r * cols;
      for (let c = 1; c < cols - 1; c++) {
        const idx = ro + c;
        if (auto[idx] !== TYPE_GROUND || !nearBldg[idx]) continue;

        // Check if cell is locally flat relative to non-building neighbors
        const z = zBuf[idx];
        let maxDiff = 0;
        const nIdxs = [idx - 1, idx + 1, idx - cols, idx + cols];
        let validLandNeighbors = 0;
        for (let k = 0; k < 4; k++) {
          const ni = nIdxs[k];
          if (auto[ni] !== TYPE_BUILDING && auto[ni] !== TYPE_WATER) {
            validLandNeighbors++;
            const d = Math.abs(z - zBuf[ni]);
            if (d > maxDiff) maxDiff = d;
          }
        }
        if (validLandNeighbors >= 1 && maxDiff <= flatSlopeMax) {
          auto[idx] = TYPE_ROAD;
        }
      }
    }
  }

  applyManualOverridesAndRefresh();
}

function applyManualOverridesAndRefresh() {
  if (!state.autoTypes) return;
  const total = state.cols * state.rows;
  let cW = 0, cG = 0, cR = 0, cB = 0;

  for (let i = 0; i < total; i++) {
    const t = state.manualOverrides[i] !== -1 ? state.manualOverrides[i] : state.autoTypes[i];
    state.finalTypes[i] = t;
    if (t === TYPE_WATER) cW++;
    else if (t === TYPE_BUILDING) cB++;
    else if (t === TYPE_ROAD) cR++;
    else cG++;
  }

  el.countWater.textContent = cW.toLocaleString();
  el.countGround.textContent = cG.toLocaleString();
  el.countRoad.textContent = cR.toLocaleString();
  el.countBuilding.textContent = cB.toLocaleString();

  buildOffscreenMap();
  drawViewport();
  updateExportPreview();
}

/**
 * =========================================================================
 * 6. Offscreen Map Builder & Pan/Zoom (1x-16x) Viewport Renderer
 * =========================================================================
 */
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
  // Amber -> Orange -> Coral -> Bright Yellow-White for skyscrapers
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

function buildOffscreenMap() {
  if (!state.model || !state.zBuffer) return;

  const cols = state.cols;
  const rows = state.rows;
  const zBuf = state.zBuffer;
  const bldgH = state.bldgHeightBuffer;
  const types = state.finalTypes;
  const { minZ, maxZ } = state.model.bbox;
  const zRange = Math.max(1e-6, maxZ - minZ);
  const waterNorm = state.waterLevelPct / 100;

  // Max building height for scaling building view
  let maxBldgH = 1e-6;
  for (let i = 0; i < cols * rows; i++) {
    if (bldgH[i] > maxBldgH) maxBldgH = bldgH[i];
  }

  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const octx = off.getContext('2d');
  const imgData = octx.createImageData(cols, rows);
  const data = imgData.data;

  const lx = -0.58, ly = -0.58, lz = 0.57;
  const reliefScale = (Math.max(cols, rows) / zRange) * 0.25;
  const contourStep = zRange / 14;

  for (let r = 0; r < rows; r++) {
    const ro = r * cols;
    for (let c = 0; c < cols; c++) {
      const idx = ro + c;
      const p = idx * 4;
      const z = zBuf[idx];
      const normZ = Math.max(0, Math.min(1, (z - minZ) / zRange));
      const type = types[idx];

      // Hillshade calculation
      const zL = zBuf[ro + Math.max(0, c - 1)];
      const zR = zBuf[ro + Math.min(cols - 1, c + 1)];
      const zU = zBuf[Math.max(0, r - 1) * cols + c];
      const zD = zBuf[Math.min(rows - 1, r + 1) * cols + c];
      const dzdx = (zR - zL) * reliefScale;
      const dzdy = (zD - zU) * reliefScale;
      const invLen = 1 / Math.hypot(dzdx, dzdy, 1);
      const shade = Math.max(0.52, Math.min(1.28, (-dzdx * lx - dzdy * ly + lz) * invLen * 1.18));

      let R = 0, G = 0, B = 0;

      if (state.viewMode === 'heightmap') {
        const gVal = Math.round(normZ * 255);
        R = gVal; G = gVal; B = gVal;
      } else if (state.viewMode === 'buildings') {
        if (type === TYPE_BUILDING) {
          const bt = Math.min(1, bldgH[idx] / maxBldgH);
          const [br, bg, bb] = sampleBuildingHeat(bt);
          R = br; G = bg; B = bb;
        } else if (type === TYPE_WATER) {
          R = 12; G = 28; B = 52;
        } else if (type === TYPE_ROAD) {
          R = 45; G = 52; B = 64;
        } else {
          R = 24; G = 34; B = 32;
        }
      } else if (state.viewMode === 'contours') {
        const base = type === TYPE_WATER ? [22, 68, 118] : [182, 192, 202];
        R = base[0] * shade;
        G = base[1] * shade;
        B = base[2] * shade;

        // Detect contour line crossing
        const band = Math.floor((z - minZ) / contourStep);
        const bandR = Math.floor((zR - minZ) / contourStep);
        const bandD = Math.floor((zD - minZ) / contourStep);
        if (type !== TYPE_WATER && (band !== bandR || band !== bandD)) {
          R *= 0.42; G *= 0.42; B *= 0.42;
        }
      } else {
        // Combined Urban + Topographic Map
        if (type === TYPE_WATER) {
          const depthF = waterNorm > 0 ? Math.min(1, normZ / waterNorm) : 0.5;
          R = 14 + depthF * 24;
          G = 74 + depthF * 88;
          B = 152 + depthF * 80;
        } else if (type === TYPE_BUILDING) {
          const bt = Math.min(1, bldgH[idx] / maxBldgH);
          const [br, bg, bb] = sampleBuildingHeat(bt);
          R = Math.min(255, br * shade);
          G = Math.min(255, bg * shade);
          B = Math.min(255, bb * shade);
        } else if (type === TYPE_ROAD) {
          R = Math.min(255, 118 * shade);
          G = Math.min(255, 128 * shade);
          B = Math.min(255, 144 * shade);
        } else {
          const landT = Math.max(0, (normZ - waterNorm) / Math.max(0.05, 1 - waterNorm));
          const [tr, tg, tb] = sampleTopoColor(landT);
          R = Math.min(255, tr * shade);
          G = Math.min(255, tg * shade);
          B = Math.min(255, tb * shade);
        }
      }

      data[p] = R;
      data[p + 1] = G;
      data[p + 2] = B;
      data[p + 3] = 255;
    }
  }

  octx.putImageData(imgData, 0, 0);
  state.offscreenMap = off;
}

function getMapRenderRect() {
  const cw = el.mapCanvas.width;
  const ch = el.mapCanvas.height;
  const pad = 20;
  const baseScale = Math.min((cw - pad * 2) / state.cols, (ch - pad * 2) / state.rows);
  const scale = baseScale * state.zoom;
  const w = state.cols * scale;
  const h = state.rows * scale;
  const x = (cw - w) / 2 + state.panX;
  const y = (ch - h) / 2 + state.panY;
  return { x, y, w, h, scale };
}

function drawViewport() {
  const rect = el.canvasContainer.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(200, Math.floor(rect.width));
  const ch = Math.max(200, Math.floor(rect.height));

  if (el.mapCanvas.width !== cw * dpr || el.mapCanvas.height !== ch * dpr) {
    el.mapCanvas.width = cw * dpr;
    el.mapCanvas.height = ch * dpr;
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, el.mapCanvas.width, el.mapCanvas.height);

  // Subtle cartographic dot-grid background
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, el.mapCanvas.width, el.mapCanvas.height);

  if (!state.model || !state.offscreenMap) {
    ctx.restore();
    return;
  }

  const mr = getMapRenderRect();

  // Map border shadow
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeRect(mr.x - 1, mr.y - 1, mr.w + 2, mr.h + 2);

  // Draw crisp nearest-neighbor grid map
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(state.offscreenMap, mr.x, mr.y, mr.w, mr.h);

  // Draw cell grid lines when zoomed in enough (>= 10px per cell)
  if (mr.scale >= 10 * dpr) {
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startC = Math.max(0, Math.floor(-mr.x / mr.scale));
    const endC = Math.min(state.cols, Math.ceil((el.mapCanvas.width - mr.x) / mr.scale));
    const startR = Math.max(0, Math.floor(-mr.y / mr.scale));
    const endR = Math.min(state.rows, Math.ceil((el.mapCanvas.height - mr.y) / mr.scale));

    for (let c = startC; c <= endC; c++) {
      const px = Math.round(mr.x + c * mr.scale) + 0.5;
      ctx.moveTo(px, Math.max(0, mr.y));
      ctx.lineTo(px, Math.min(el.mapCanvas.height, mr.y + mr.h));
    }
    for (let r = startR; r <= endR; r++) {
      const py = Math.round(mr.y + r * mr.scale) + 0.5;
      ctx.moveTo(Math.max(0, mr.x), py);
      ctx.lineTo(Math.min(el.mapCanvas.width, mr.x + mr.w), py);
    }
    ctx.stroke();
  }

  // Draw Named Location Pins
  for (const pin of state.pins) {
    const px = mr.x + (pin.col + 0.5) * mr.scale;
    const py = mr.y + (pin.row + 0.5) * mr.scale;
    const rOuter = 6 * dpr;

    // Pin drop shadow & dot
    ctx.beginPath();
    ctx.arc(px, py, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = '#f43f5e';
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Crisp Pill Label
    ctx.font = `600 ${Math.round(11 * dpr)}px Inter, sans-serif`;
    const textW = ctx.measureText(pin.name).width;
    const padX = 6 * dpr;
    const boxH = 18 * dpr;
    const boxW = textW + padX * 2;
    const bx = px - boxW / 2;
    const by = py - rOuter - boxH - 4 * dpr;

    ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 5 * dpr);
    ctx.fill();
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.7)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pin.name, px, by + boxH / 2 + 0.5);
  }

  // Draw Hover / Brush Footprint Cursor
  if (state.hoverCell) {
    const { c, r } = state.hoverCell;
    const isPaintTool = ['water', 'ground', 'road', 'building'].includes(state.tool);
    const bRad = isPaintTool ? state.brushSize - 1 : 0;
    const x0 = mr.x + Math.max(0, c - bRad) * mr.scale;
    const y0 = mr.y + Math.max(0, r - bRad) * mr.scale;
    const x1 = mr.x + Math.min(state.cols, c + bRad + 1) * mr.scale;
    const y1 = mr.y + Math.min(state.rows, r + bRad + 1) * mr.scale;

    ctx.strokeStyle = state.tool === 'pin' ? '#fb7185' : '#ffffff';
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(x0, y0, Math.max(2, x1 - x0), Math.max(2, y1 - y0));
  }

  ctx.restore();
  el.zoomReadout.textContent = `${Math.round(state.zoom * 100)}%`;
}

function resetCameraView() {
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  drawViewport();
}

function zoomAtPoint(factor, clientX = null, clientY = null) {
  if (!state.model) return;
  const oldZoom = state.zoom;
  const newZoom = Math.max(1, Math.min(16, oldZoom * factor));
  if (Math.abs(newZoom - oldZoom) < 1e-4) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = el.mapCanvas.getBoundingClientRect();
  const cx = clientX !== null ? (clientX - rect.left) * dpr : el.mapCanvas.width / 2;
  const cy = clientY !== null ? (clientY - rect.top) * dpr : el.mapCanvas.height / 2;

  const ratio = newZoom / oldZoom;
  const centerX = el.mapCanvas.width / 2;
  const centerY = el.mapCanvas.height / 2;

  state.panX = (cx - centerX) - ((cx - centerX) - state.panX) * ratio;
  state.panY = (cy - centerY) - ((cy - centerY) - state.panY) * ratio;
  state.zoom = newZoom;

  if (state.zoom <= 1.01) {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
  }
  drawViewport();
}

/**
 * =========================================================================
 * 7. Georeferencing (Lat/Lon & m/tile) + Named Location Pins
 * =========================================================================
 */
function hasValidGeo() {
  const g = state.geo;
  return (
    g.nwLat !== null && !Number.isNaN(g.nwLat) &&
    g.nwLon !== null && !Number.isNaN(g.nwLon) &&
    g.seLat !== null && !Number.isNaN(g.seLat) &&
    g.seLon !== null && !Number.isNaN(g.seLon)
  );
}

function cellToLatLon(col, row) {
  if (!hasValidGeo()) return null;
  const u = (col + 0.5) / state.cols;
  const v = (row + 0.5) / state.rows;
  const lat = state.geo.nwLat + (state.geo.seLat - state.geo.nwLat) * v;
  const lon = state.geo.nwLon + (state.geo.seLon - state.geo.nwLon) * u;
  return { lat, lon };
}

function cellToModelXY(col, row) {
  if (!state.model) return { x: 0, y: 0 };
  const { minX, maxX, minY, maxY } = state.model.bbox;
  const x = minX + ((col + 0.5) / state.cols) * (maxX - minX);
  const y = maxY - ((row + 0.5) / state.rows) * (maxY - minY);
  return { x, y };
}

function getTileScaleMeters() {
  if (!hasValidGeo()) return null;
  const avgLatRad = ((state.geo.nwLat + state.geo.seLat) / 2) * (Math.PI / 180);
  const metersY = Math.abs(state.geo.nwLat - state.geo.seLat) * 111320;
  const metersX = Math.abs(state.geo.seLon - state.geo.nwLon) * 111320 * Math.cos(avgLatRad);
  return {
    mPerTileX: metersX / state.cols,
    mPerTileY: metersY / state.rows,
    totalMetersX: metersX,
    totalMetersY: metersY,
  };
}

function updateGeoScaleUI() {
  const scale = getTileScaleMeters();
  if (!scale) {
    el.geoScaleReadout.innerHTML = 'Scale: <span class="text-slate-500">Enter Lat/Lon for m/tile</span>';
  } else {
    el.geoScaleReadout.innerHTML = `Scale: <span class="text-teal-300 font-semibold">${scale.mPerTileX.toFixed(1)}m &times; ${scale.mPerTileY.toFixed(1)}m / tile</span> <span class="text-slate-500">(${(scale.totalMetersX / 1000).toFixed(2)}&times;${(scale.totalMetersY / 1000).toFixed(2)} km)</span>`;
  }
  updateExportPreview();
}

function renderPinList() {
  el.pinCount.textContent = String(state.pins.length);
  if (state.pins.length === 0) {
    el.pinList.innerHTML = '<p class="text-[11px] text-slate-500 italic">No pins dropped yet.</p>';
    return;
  }
  el.pinList.innerHTML = '';
  state.pins.forEach((pin) => {
    const ll = cellToLatLon(pin.col, pin.row);
    const llTxt = ll ? `${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}` : `(${pin.col}, ${pin.row})`;
    const item = document.createElement('div');
    item.className = 'flex items-center justify-between gap-2 bg-slate-950/80 border border-slate-800 rounded-lg px-2.5 py-1.5';
    item.innerHTML = `
      <button type="button" class="pin-jump text-left min-w-0 flex-1 hover:text-teal-300 transition-colors" data-pin-id="${pin.id}">
        <div class="text-xs font-semibold text-slate-200 truncate">${pin.name}</div>
        <div class="text-[10px] font-mono text-slate-500 truncate">c:${pin.col}, r:${pin.row} &bull; ${llTxt}</div>
      </button>
      <button type="button" class="pin-del text-slate-500 hover:text-rose-400 px-1.5 py-0.5 text-sm leading-none" data-pin-id="${pin.id}" title="Delete Pin">&times;</button>
    `;
    el.pinList.appendChild(item);
  });

  el.pinList.querySelectorAll('.pin-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pinId;
      state.pins = state.pins.filter((p) => p.id !== id);
      renderPinList();
      drawViewport();
      updateExportPreview();
    });
  });

  el.pinList.querySelectorAll('.pin-jump').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pin = state.pins.find((p) => p.id === btn.dataset.pinId);
      if (!pin || !state.model) return;
      state.zoom = Math.max(state.zoom, 3);
      const dpr = window.devicePixelRatio || 1;
      const cw = el.mapCanvas.width;
      const ch = el.mapCanvas.height;
      const pad = 20;
      const baseScale = Math.min((cw - pad * 2) / state.cols, (ch - pad * 2) / state.rows);
      const scale = baseScale * state.zoom;
      const w = state.cols * scale;
      const h = state.rows * scale;
      state.panX = w / 2 - (pin.col + 0.5) * scale;
      state.panY = h / 2 - (pin.row + 0.5) * scale;
      drawViewport();
    });
  });
}

function openPinModal(cell) {
  state.pendingPinCell = cell;
  const ll = cellToLatLon(cell.c, cell.r);
  el.pinModalCoords.textContent = ll
    ? `Cell (${cell.c}, ${cell.r}) • Lat ${ll.lat.toFixed(5)}, Lon ${ll.lon.toFixed(5)}`
    : `Cell (${cell.c}, ${cell.r})`;
  el.pinNameInput.value = '';
  el.pinModal.classList.remove('hidden');
  setTimeout(() => el.pinNameInput.focus(), 30);
}

function closePinModal() {
  state.pendingPinCell = null;
  el.pinModal.classList.add('hidden');
}

function savePendingPin() {
  if (!state.pendingPinCell) return;
  const name = el.pinNameInput.value.trim() || `Location ${state.pins.length + 1}`;
  state.pins.push({
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    name,
    col: state.pendingPinCell.c,
    row: state.pendingPinCell.r,
  });
  closePinModal();
  renderPinList();
  drawViewport();
  updateExportPreview();
  showToast(`Dropped pin "${name}"`, 'success');
}

/**
 * =========================================================================
 * 8. Rich Text / CSV / JSON Export Engine
 * =========================================================================
 */
function scaleValue(val, isRelativeHeight = false) {
  const { minZ, maxZ } = state.model.bbox;
  const zRange = Math.max(1e-6, maxZ - minZ);
  const norm = isRelativeHeight
    ? Math.max(0, Math.min(1, val / zRange))
    : Math.max(0, Math.min(1, (val - minZ) / zRange));

  if (state.elevScale === '0-99') return Math.round(norm * 99);
  if (state.elevScale === '0-255') return Math.round(norm * 255);
  return Number(val.toFixed(1));
}

function generateExportText(truncateForPreview = false) {
  if (!state.model || !state.zBuffer) return '';

  const cols = state.cols;
  const rows = state.rows;
  const zBuf = state.zBuffer;
  const gBuf = state.groundBuffer;
  const bBuf = state.bldgHeightBuffer;
  const types = state.finalTypes;
  const { minX, maxX, minY, maxY, minZ, maxZ } = state.model.bbox;
  const delim = state.delimiter === '\\t' ? '\t' : state.delimiter;

  if (state.exportFormat === 'compact') {
    const lines = [];
    lines.push(`# WIDTH ${cols}`);
    lines.push(`# HEIGHT ${rows}`);
    lines.push(`# SOURCE ${state.model.fileName}`);
    lines.push(`# ELEV_SCALE ${state.elevScale}`);
    lines.push(`# CELL_FORMAT ${state.cellFormat === 'split' ? 'Type:GroundElev:BldgHeight' : 'Type:TotalElev'}`);
    lines.push(`# LEGEND W=Water, G=Ground/Park, R=Road, B=Building`);
    lines.push(`# MODEL_BOUNDS X:[${minX.toFixed(2)},${maxX.toFixed(2)}] Y:[${minY.toFixed(2)},${maxY.toFixed(2)}] Z:[${minZ.toFixed(2)},${maxZ.toFixed(2)}]`);

    if (hasValidGeo()) {
      const sc = getTileScaleMeters();
      lines.push(`# GEO_BOUNDS NW:[${state.geo.nwLat},${state.geo.nwLon}] SE:[${state.geo.seLat},${state.geo.seLon}]`);
      lines.push(`# TILE_SCALE ${sc.mPerTileX.toFixed(2)}m_x_${sc.mPerTileY.toFixed(2)}m_per_tile`);
    } else {
      lines.push(`# GEO_BOUNDS NONE`);
    }

    if (state.pins.length > 0) {
      lines.push(`# LOCATIONS ${state.pins.length}`);
      for (const pin of state.pins) {
        const idx = Math.min(rows - 1, pin.row) * cols + Math.min(cols - 1, pin.col);
        const elev = scaleValue(zBuf[idx], false);
        const ll = cellToLatLon(pin.col, pin.row);
        const llStr = ll ? `${ll.lat.toFixed(6)},${ll.lon.toFixed(6)}` : 'null,null';
        lines.push(`# PIN "${pin.name}" col=${pin.col} row=${pin.row} elev=${elev} latlon=${llStr}`);
      }
    }
    lines.push(`# GRID_START`);

    const maxRows = truncateForPreview ? Math.min(rows, 18) : rows;
    for (let r = 0; r < maxRows; r++) {
      const ro = r * cols;
      const rowTokens = new Array(cols);
      for (let c = 0; c < cols; c++) {
        const idx = ro + c;
        const ch = TYPE_CHAR[types[idx]];
        if (state.cellFormat === 'split') {
          rowTokens[c] = `${ch}:${scaleValue(gBuf[idx], false)}:${scaleValue(bBuf[idx], true)}`;
        } else {
          rowTokens[c] = `${ch}:${scaleValue(zBuf[idx], false)}`;
        }
      }
      lines.push(rowTokens.join(delim));
    }
    if (truncateForPreview && rows > maxRows) {
      lines.push(`# ... (${rows - maxRows} more rows in full export)`);
    }
    return lines.join('\n');
  }

  if (state.exportFormat === 'csv') {
    const lines = ['col,row,type,total_elev,ground_elev,bldg_height,model_x,model_y,lat,lon'];
    const total = cols * rows;
    const limit = truncateForPreview ? Math.min(total, 50) : total;
    const geoOn = hasValidGeo();

    for (let i = 0; i < limit; i++) {
      const r = (i / cols) | 0;
      const c = i - r * cols;
      const mxy = cellToModelXY(c, r);
      const ll = geoOn ? cellToLatLon(c, r) : null;
      lines.push(
        `${c},${r},${TYPE_CHAR[types[i]]},${scaleValue(zBuf[i], false)},${scaleValue(gBuf[i], false)},${scaleValue(bBuf[i], true)},${mxy.x.toFixed(2)},${mxy.y.toFixed(2)},${ll ? ll.lat.toFixed(6) : ''},${ll ? ll.lon.toFixed(6) : ''}`
      );
    }
    if (truncateForPreview && total > limit) {
      lines.push(`# ... (${(total - limit).toLocaleString()} more rows in full CSV)`);
    }
    return lines.join('\n');
  }

  // Full JSON format (compact 2D arrays)
  const maxRows = truncateForPreview ? Math.min(rows, 6) : rows;
  const typeGrid = [];
  const totalElevGrid = [];
  const groundElevGrid = [];
  const bldgHeightGrid = [];

  for (let r = 0; r < maxRows; r++) {
    const ro = r * cols;
    const tRow = new Array(cols);
    const zRow = new Array(cols);
    const gRow = new Array(cols);
    const bRow = new Array(cols);
    for (let c = 0; c < cols; c++) {
      const idx = ro + c;
      tRow[c] = TYPE_CHAR[types[idx]];
      zRow[c] = scaleValue(zBuf[idx], false);
      gRow[c] = scaleValue(gBuf[idx], false);
      bRow[c] = scaleValue(bBuf[idx], true);
    }
    typeGrid.push(tRow.join(''));
    totalElevGrid.push(zRow);
    groundElevGrid.push(gRow);
    bldgHeightGrid.push(bRow);
  }

  const locations = state.pins.map((pin) => {
    const idx = Math.min(rows - 1, pin.row) * cols + Math.min(cols - 1, pin.col);
    const ll = cellToLatLon(pin.col, pin.row);
    return {
      name: pin.name,
      col: pin.col,
      row: pin.row,
      totalElev: scaleValue(zBuf[idx], false),
      groundElev: scaleValue(gBuf[idx], false),
      bldgHeight: scaleValue(bBuf[idx], true),
      lat: ll ? Number(ll.lat.toFixed(6)) : null,
      lon: ll ? Number(ll.lon.toFixed(6)) : null,
    };
  });

  const payload = {
    width: cols,
    height: rows,
    source: state.model.fileName,
    elevScale: state.elevScale,
    modelBounds: { minX, maxX, minY, maxY, minZ, maxZ },
    geoBounds: hasValidGeo() ? state.geo : null,
    tileScaleMeters: getTileScaleMeters(),
    locations,
    layers: {
      types: typeGrid,
      totalElev: totalElevGrid,
      groundElev: groundElevGrid,
      bldgHeight: bldgHeightGrid,
    },
  };

  const txt = JSON.stringify(payload, null, 2);
  if (truncateForPreview && rows > maxRows) {
    return txt.slice(0, 3200) + `\n  ... (${rows - maxRows} more rows in full JSON download)`;
  }
  return txt;
}

function updateExportPreview() {
  if (!state.model || !state.zBuffer) return;
  el.exportPreview.textContent = generateExportText(true);
  const cells = state.cols * state.rows;
  let bpc = state.cellFormat === 'split' ? 9 : 6;
  if (state.exportFormat === 'csv') bpc = 38;
  if (state.exportFormat === 'json') bpc = 16;
  const kb = ((cells * bpc) / 1024).toFixed(1);
  el.exportMeta.textContent = `${state.cols}×${state.rows} (${cells.toLocaleString()} tiles) • ~${kb} KB`;
}

/**
 * =========================================================================
 * 9. UI Synchronization, Pointer Mapping & Interactions
 * =========================================================================
 */
function syncGridDimensionsToAspect() {
  if (!state.model) return;
  const spanX = Math.max(1e-6, state.model.bbox.maxX - state.model.bbox.minX);
  const spanY = Math.max(1e-6, state.model.bbox.maxY - state.model.bbox.minY);
  const maxEdge = state.longestEdge;

  if (spanX >= spanY) {
    state.cols = maxEdge;
    state.rows = Math.max(16, Math.round(maxEdge * (spanY / spanX)));
  } else {
    state.rows = maxEdge;
    state.cols = Math.max(16, Math.round(maxEdge * (spanX / spanY)));
  }
  el.gridCols.value = state.cols;
  el.gridRows.value = state.rows;
}

function updateModelUI() {
  const m = state.model;
  el.emptyOverlay.classList.add('hidden');
  el.diagnosticsBar.classList.remove('hidden');

  el.diagFile.textContent = m.fileName;
  el.diagObjects.textContent = m.objects.length.toLocaleString();
  el.diagTris.textContent = m.totalTriangles.toLocaleString();
  const dx = (m.bbox.maxX - m.bbox.minX).toFixed(1);
  const dy = (m.bbox.maxY - m.bbox.minY).toFixed(1);
  const dz = (m.bbox.maxZ - m.bbox.minZ).toFixed(1);
  el.diagDims.textContent = `${dx} × ${dy} × ${dz}`;

  if (state.lockAspect) {
    syncGridDimensionsToAspect();
  }

  // Per-object layer tagging panel
  el.objectTaggingSection.classList.remove('hidden');
  el.objCountBadge.textContent = String(m.objects.length);
  el.objectList.innerHTML = '';

  m.objects.forEach((obj, idx) => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 bg-slate-950/75 border border-slate-800 rounded-lg px-2.5 py-1.5';
    row.innerHTML = `
      <div class="min-w-0">
        <div class="text-xs font-medium text-slate-200 truncate" title="${obj.name}">${obj.name}</div>
        <div class="text-[10px] font-mono text-slate-500">${obj.triangleCount.toLocaleString()} tris</div>
      </div>
      <select data-obj-idx="${idx}" class="obj-tag-select px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus:border-teal-500">
        <option value="auto" ${obj.tag === 'auto' ? 'selected' : ''}>Auto</option>
        <option value="ground" ${obj.tag === 'ground' ? 'selected' : ''}>Ground (G)</option>
        <option value="water" ${obj.tag === 'water' ? 'selected' : ''}>Water (W)</option>
        <option value="road" ${obj.tag === 'road' ? 'selected' : ''}>Road (R)</option>
        <option value="building" ${obj.tag === 'building' ? 'selected' : ''}>Building (B)</option>
        <option value="ignore" ${obj.tag === 'ignore' ? 'selected' : ''}>Ignore</option>
      </select>
    `;
    el.objectList.appendChild(row);
  });

  el.objectList.querySelectorAll('.obj-tag-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.objIdx, 10);
      const prev = state.model.objects[idx].tag;
      state.model.objects[idx].tag = e.target.value;
      // If toggling Ignore or Water (affects supersample), re-rasterize; otherwise re-classify immediately
      if (prev === 'ignore' || e.target.value === 'ignore' || prev === 'water' || e.target.value === 'water') {
        rasterizeModelToGrid();
      } else {
        classifyUrbanFeatures();
      }
    });
  });

  updateGeoScaleUI();
}

function screenToCell(clientX, clientY) {
  if (!state.model) return null;
  const rect = el.mapCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const sx = (clientX - rect.left) * dpr;
  const sy = (clientY - rect.top) * dpr;
  const mr = getMapRenderRect();
  const c = Math.floor((sx - mr.x) / mr.scale);
  const r = Math.floor((sy - mr.y) / mr.scale);
  if (c < 0 || c >= state.cols || r < 0 || r >= state.rows) return null;
  return { c, r };
}

function updateHoverHUD(cell) {
  if (!cell || !state.zBuffer) return;
  const idx = cell.r * state.cols + cell.c;
  const t = state.finalTypes[idx];
  const z = state.zBuffer[idx];
  const g = state.groundBuffer[idx];
  const b = state.bldgHeightBuffer[idx];
  const mxy = cellToModelXY(cell.c, cell.r);
  const ll = cellToLatLon(cell.c, cell.r);

  el.hudGrid.textContent = `(${cell.c}, ${cell.r})`;
  el.hudType.textContent = TYPE_LABEL[t];
  el.hudType.className =
    t === TYPE_WATER ? 'text-sky-400 font-semibold' :
    t === TYPE_BUILDING ? 'text-amber-400 font-semibold' :
    t === TYPE_ROAD ? 'text-slate-300 font-semibold' : 'text-emerald-400 font-semibold';

  el.hudElev.textContent = `${scaleValue(z, false)} / ${scaleValue(g, false)}`;
  el.hudBldg.textContent = b > 0.05 ? `+${scaleValue(b, true)} (${b.toFixed(1)}u)` : '0';
  el.hudModel.textContent = `${mxy.x.toFixed(1)}, ${mxy.y.toFixed(1)}, ${z.toFixed(1)}`;
  el.hudLatLon.textContent = ll ? `${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}` : 'Not set';
}

function paintAtCell(cell) {
  if (!cell || !state.manualOverrides) return;
  const mapTool = { water: TYPE_WATER, ground: TYPE_GROUND, road: TYPE_ROAD, building: TYPE_BUILDING };
  const target = mapTool[state.tool];
  if (target === undefined) return;

  const rad = state.brushSize - 1;
  let changed = false;
  for (let dr = -rad; dr <= rad; dr++) {
    for (let dc = -rad; dc <= rad; dc++) {
      const nr = cell.r + dr;
      const nc = cell.c + dc;
      if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) {
        const idx = nr * state.cols + nc;
        if (state.manualOverrides[idx] !== target) {
          state.manualOverrides[idx] = target;
          changed = true;
        }
      }
    }
  }
  if (changed) applyManualOverridesAndRefresh();
}

/**
 * =========================================================================
 * 10. File Upload & NYC Demo Handlers
 * =========================================================================
 */
async function handleFileUpload(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.3mf')) {
    showToast('Please select a valid .3mf file.', 'error');
    return;
  }

  try {
    const model = await parse3MFFile(file);
    state.model = model;
    state.pins = [];
    setProgress(true, 'Rasterizing aspect-true 2×2 supersampled grid...', 85);
    await yieldFrame();

    updateModelUI();
    resetCameraView();
    rasterizeModelToGrid();
    renderPinList();

    setProgress(true, 'Complete!', 100);
    setTimeout(() => setProgress(false), 350);
    showToast(`Loaded ${model.fileName} (${model.objects.length} obj, ${model.totalTriangles.toLocaleString()} tris)`, 'success');
  } catch (err) {
    console.error(err);
    setProgress(false);
    showToast(err.message || 'Failed to parse .3mf archive.', 'error');
  }
}

async function loadNYCDemo() {
  setProgress(true, 'Generating NYC Manhattan 3D mesh...', 35);
  await yieldFrame();

  state.model = generateNYCDemoModel();

  // Apply Manhattan / NYC Geo-Bounds preset
  state.geo = { nwLat: 40.7830, nwLon: -74.0220, seLat: 40.6980, seLon: -73.9520 };
  el.geoNwLat.value = state.geo.nwLat;
  el.geoNwLon.value = state.geo.nwLon;
  el.geoSeLat.value = state.geo.seLat;
  el.geoSeLon.value = state.geo.seLon;

  setProgress(true, 'Rasterizing 256-tile 2×2 supersampled map...', 80);
  await yieldFrame();

  updateModelUI();
  resetCameraView();
  rasterizeModelToGrid();

  // Drop 4 iconic NYC location pins
  const c = state.cols;
  const r = state.rows;
  state.pins = [
    { id: 'nyc1', name: 'Battery Park', col: Math.round(c * 0.40), row: Math.round(r * 0.87) },
    { id: 'nyc2', name: 'Brooklyn Bridge', col: Math.round(c * 0.61), row: Math.round(r * 0.80) },
    { id: 'nyc3', name: 'Midtown', col: Math.round(c * 0.46), row: Math.round(r * 0.41) },
    { id: 'nyc4', name: 'Central Park', col: Math.round(c * 0.47), row: Math.round(r * 0.18) },
  ];
  renderPinList();
  drawViewport();
  updateExportPreview();

  setProgress(false);
  showToast('Loaded NYC Demo Terrain (180×256 aspect-true grid + 4 pins)', 'success');
}

/**
 * =========================================================================
 * 11. Event Listeners
 * =========================================================================
 */
// Drop zone & file input
el.dropZone.addEventListener('click', () => el.fileInput.click());
el.dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
});
el.fileInput.addEventListener('change', (e) => {
  if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
  e.target.value = '';
});
['dragenter', 'dragover'].forEach((evt) => {
  el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    el.dropZone.classList.add('border-teal-500', 'bg-teal-500/10');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    el.dropZone.classList.remove('border-teal-500', 'bg-teal-500/10');
  });
});
el.dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFileUpload(file);
});

el.btnLoadDemoHeader.addEventListener('click', loadNYCDemo);
el.btnLoadDemoEmpty.addEventListener('click', loadNYCDemo);

// Grid & Supersampling controls
el.longestEdgeSlider.addEventListener('input', () => {
  state.longestEdge = parseInt(el.longestEdgeSlider.value, 10);
  el.longestEdgeVal.textContent = `${state.longestEdge} tiles`;
  if (state.lockAspect && state.model) syncGridDimensionsToAspect();
});
el.lockAspect.addEventListener('change', () => {
  state.lockAspect = el.lockAspect.checked;
  if (state.lockAspect && state.model) syncGridDimensionsToAspect();
});
el.gridCols.addEventListener('input', () => {
  const v = parseInt(el.gridCols.value, 10);
  if (!Number.isNaN(v)) {
    state.cols = Math.max(16, Math.min(512, v));
    if (state.lockAspect && state.model) {
      const sx = Math.max(1e-6, state.model.bbox.maxX - state.model.bbox.minX);
      const sy = Math.max(1e-6, state.model.bbox.maxY - state.model.bbox.minY);
      state.rows = Math.max(16, Math.min(512, Math.round(state.cols * (sy / sx))));
      el.gridRows.value = state.rows;
    }
  }
});
el.gridRows.addEventListener('input', () => {
  const v = parseInt(el.gridRows.value, 10);
  if (!Number.isNaN(v)) {
    state.rows = Math.max(16, Math.min(512, v));
    if (state.lockAspect && state.model) {
      const sx = Math.max(1e-6, state.model.bbox.maxX - state.model.bbox.minX);
      const sy = Math.max(1e-6, state.model.bbox.maxY - state.model.bbox.minY);
      state.cols = Math.max(16, Math.min(512, Math.round(state.rows * (sx / sy))));
      el.gridCols.value = state.cols;
    }
  }
});
el.supersampleToggle.addEventListener('change', () => {
  state.supersample = el.supersampleToggle.checked;
});
el.btnRasterize.addEventListener('click', async () => {
  if (!state.model) { showToast('Load a .3mf model or NYC Demo first.', 'info'); return; }
  const oldCols = state.cols;
  const oldRows = state.rows;
  state.cols = Math.max(16, Math.min(512, parseInt(el.gridCols.value, 10) || 256));
  state.rows = Math.max(16, Math.min(512, parseInt(el.gridRows.value, 10) || 256));
  el.gridCols.value = state.cols;
  el.gridRows.value = state.rows;

  // Rescale existing pins proportionally to new grid resolution
  if (oldCols > 0 && oldRows > 0) {
    state.pins.forEach((p) => {
      p.col = Math.min(state.cols - 1, Math.round((p.col / oldCols) * state.cols));
      p.row = Math.min(state.rows - 1, Math.round((p.row / oldRows) * state.rows));
    });
    renderPinList();
  }

  setProgress(true, `Rasterizing ${state.cols}×${state.rows}...`, 65);
  await yieldFrame();
  rasterizeModelToGrid();
  updateGeoScaleUI();
  setProgress(false);
  showToast(`Rasterized ${state.cols}×${state.rows} grid`, 'success');
});

// Urban Feature Sliders
el.waterLevelSlider.addEventListener('input', () => {
  state.waterLevelPct = parseFloat(el.waterLevelSlider.value);
  el.waterLevelVal.textContent = `${state.waterLevelPct}%`;
  classifyUrbanFeatures();
});
el.bldgHeightSlider.addEventListener('input', () => {
  state.bldgHeightPct = parseFloat(el.bldgHeightSlider.value);
  el.bldgHeightVal.textContent = `${state.bldgHeightPct}%`;
  classifyUrbanFeatures();
});
el.morphRadiusSlider.addEventListener('input', () => {
  state.morphRadius = parseInt(el.morphRadiusSlider.value, 10);
  el.morphRadiusVal.textContent = `${state.morphRadius} tiles`;
  classifyUrbanFeatures();
});
el.roadSensSlider.addEventListener('input', () => {
  state.roadSensPct = parseInt(el.roadSensSlider.value, 10);
  el.roadSensVal.textContent = `${state.roadSensPct}%`;
  classifyUrbanFeatures();
});

// Georeferencing Inputs & Presets
function syncGeoFromInputs() {
  const p = (v) => (v === '' ? null : parseFloat(v));
  state.geo.nwLat = p(el.geoNwLat.value);
  state.geo.nwLon = p(el.geoNwLon.value);
  state.geo.seLat = p(el.geoSeLat.value);
  state.geo.seLon = p(el.geoSeLon.value);
  updateGeoScaleUI();
  renderPinList();
}
[el.geoNwLat, el.geoNwLon, el.geoSeLat, el.geoSeLon].forEach((inp) => {
  inp.addEventListener('input', syncGeoFromInputs);
});
el.btnPresetNYC.addEventListener('click', () => {
  el.geoNwLat.value = '40.7830';
  el.geoNwLon.value = '-74.0220';
  el.geoSeLat.value = '40.6980';
  el.geoSeLon.value = '-73.9520';
  syncGeoFromInputs();
  showToast('Applied Manhattan / NYC geo-bounds preset', 'info');
});
el.btnClearGeo.addEventListener('click', () => {
  el.geoNwLat.value = '';
  el.geoNwLon.value = '';
  el.geoSeLat.value = '';
  el.geoSeLon.value = '';
  syncGeoFromInputs();
});

// Pin Modal Controls
el.btnSavePin.addEventListener('click', savePendingPin);
el.btnCancelPin.addEventListener('click', closePinModal);
el.btnCancelPinX.addEventListener('click', closePinModal);
el.pinNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') savePendingPin();
  else if (e.key === 'Escape') closePinModal();
});

// View Mode Tabs
document.querySelectorAll('.view-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.viewMode = btn.dataset.view;
    document.querySelectorAll('.view-tab').forEach((b) => {
      const active = b.dataset.view === state.viewMode;
      b.className = active
        ? 'view-tab px-2.5 py-1.5 rounded-lg text-xs font-medium bg-teal-600 text-white transition-colors'
        : 'view-tab px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-colors';
    });
    buildOffscreenMap();
    drawViewport();
  });
});

// Tool Buttons
document.querySelectorAll('.tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.tool = btn.dataset.tool;
    document.querySelectorAll('.tool-btn').forEach((b) => {
      const active = b.dataset.tool === state.tool;
      b.classList.toggle('border-teal-500', active);
      b.classList.toggle('bg-slate-800', active);
      b.classList.toggle('border-slate-800', !active);
      b.classList.toggle('bg-slate-950', !active);
    });
    el.mapCanvas.style.cursor = state.tool === 'pan' ? 'grab' : 'crosshair';
  });
});
el.brushSize.addEventListener('change', () => {
  state.brushSize = parseInt(el.brushSize.value, 10) || 1;
});
el.btnResetEdits.addEventListener('click', () => {
  if (!state.manualOverrides) return;
  state.manualOverrides.fill(-1);
  applyManualOverridesAndRefresh();
  showToast('Manual paint overrides cleared', 'info');
});

// Zoom Buttons & Keyboard Space-Pan
el.btnZoomIn.addEventListener('click', () => zoomAtPoint(1.4));
el.btnZoomOut.addEventListener('click', () => zoomAtPoint(1 / 1.4));
el.btnResetView.addEventListener('click', resetCameraView);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    state.spaceDown = true;
    el.mapCanvas.style.cursor = 'grab';
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    state.spaceDown = false;
    el.mapCanvas.style.cursor = state.tool === 'pan' ? 'grab' : 'crosshair';
  }
});

// Canvas Mouse Pan, Zoom, Pin & Paint
el.mapCanvas.addEventListener('wheel', (e) => {
  if (!state.model) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
  zoomAtPoint(factor, e.clientX, e.clientY);
}, { passive: false });

el.mapCanvas.addEventListener('mousedown', (e) => {
  if (!state.model) return;
  const cell = screenToCell(e.clientX, e.clientY);
  state.hoverCell = cell;
  updateHoverHUD(cell);

  // Pan if Pan tool, Spacebar held, or Middle-click
  if (state.tool === 'pan' || state.spaceDown || e.button === 1) {
    state.isDraggingPan = true;
    state.dragStartX = e.clientX;
    state.dragStartY = e.clientY;
    state.panStartX = state.panX;
    state.panStartY = state.panY;
    el.mapCanvas.style.cursor = 'grabbing';
    return;
  }

  if (state.tool === 'pin' && cell) {
    openPinModal(cell);
    return;
  }

  // Paint tool
  state.isPainting = true;
  paintAtCell(cell);
});

window.addEventListener('mousemove', (e) => {
  if (!state.model) return;
  if (state.isDraggingPan) {
    const dpr = window.devicePixelRatio || 1;
    state.panX = state.panStartX + (e.clientX - state.dragStartX) * dpr;
    state.panY = state.panStartY + (e.clientY - state.dragStartY) * dpr;
    drawViewport();
    return;
  }
  const rect = el.mapCanvas.getBoundingClientRect();
  if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
    const cell = screenToCell(e.clientX, e.clientY);
    state.hoverCell = cell;
    updateHoverHUD(cell);
    if (state.isPainting) paintAtCell(cell);
    else drawViewport();
  }
});

window.addEventListener('mouseup', () => {
  if (state.isDraggingPan) {
    state.isDraggingPan = false;
    el.mapCanvas.style.cursor = (state.tool === 'pan' || state.spaceDown) ? 'grab' : 'crosshair';
  }
  state.isPainting = false;
});

el.mapCanvas.addEventListener('mouseleave', () => {
  if (!state.isDraggingPan) {
    state.hoverCell = null;
    drawViewport();
  }
});

// Touch Support for Mobile/Tablet
el.mapCanvas.addEventListener('touchstart', (e) => {
  if (!state.model || e.touches.length !== 1) return;
  e.preventDefault();
  const t = e.touches[0];
  const cell = screenToCell(t.clientX, t.clientY);
  state.hoverCell = cell;
  updateHoverHUD(cell);

  if (state.tool === 'pan') {
    state.isDraggingPan = true;
    state.dragStartX = t.clientX;
    state.dragStartY = t.clientY;
    state.panStartX = state.panX;
    state.panStartY = state.panY;
  } else if (state.tool === 'pin' && cell) {
    openPinModal(cell);
  } else {
    state.isPainting = true;
    paintAtCell(cell);
  }
}, { passive: false });

el.mapCanvas.addEventListener('touchmove', (e) => {
  if (!state.model || e.touches.length !== 1) return;
  e.preventDefault();
  const t = e.touches[0];
  if (state.isDraggingPan) {
    const dpr = window.devicePixelRatio || 1;
    state.panX = state.panStartX + (t.clientX - state.dragStartX) * dpr;
    state.panY = state.panStartY + (t.clientY - state.dragStartY) * dpr;
    drawViewport();
  } else if (state.isPainting) {
    const cell = screenToCell(t.clientX, t.clientY);
    state.hoverCell = cell;
    updateHoverHUD(cell);
    paintAtCell(cell);
  }
}, { passive: false });

el.mapCanvas.addEventListener('touchend', () => {
  state.isDraggingPan = false;
  state.isPainting = false;
});

// Responsive Resize Redraw
window.addEventListener('resize', () => {
  if (state.model) drawViewport();
});

// Export Options & Actions
function updateExportControlStates() {
  const isCompact = state.exportFormat === 'compact';
  el.cellFormatWrapper.classList.toggle('opacity-40', !isCompact);
  el.cellFormatWrapper.classList.toggle('pointer-events-none', !isCompact);
  el.delimiterWrapper.classList.toggle('opacity-40', !isCompact);
  el.delimiterWrapper.classList.toggle('pointer-events-none', !isCompact);
}
el.exportFormat.addEventListener('change', () => {
  state.exportFormat = el.exportFormat.value;
  updateExportControlStates();
  updateExportPreview();
});
el.cellFormat.addEventListener('change', () => {
  state.cellFormat = el.cellFormat.value;
  updateExportPreview();
});
el.elevScale.addEventListener('change', () => {
  state.elevScale = el.elevScale.value;
  updateExportPreview();
  if (state.hoverCell) updateHoverHUD(state.hoverCell);
});
el.compactDelimiter.addEventListener('change', () => {
  state.delimiter = el.compactDelimiter.value;
  updateExportPreview();
});

// Copy to Clipboard (iframe-safe document.execCommand)
el.btnCopy.addEventListener('click', () => {
  if (!state.model || !state.zBuffer) {
    showToast('Load a model first to copy map data.', 'info');
    return;
  }
  const fullText = generateExportText(false);
  const ta = document.createElement('textarea');
  ta.value = fullText;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast(`Copied ${fullText.length.toLocaleString()} chars to clipboard!`, 'success');
  } catch (err) {
    showToast('Clipboard blocked — use Download File instead.', 'error');
  }
  document.body.removeChild(ta);
});

// Download File
el.btnDownload.addEventListener('click', () => {
  if (!state.model || !state.zBuffer) {
    showToast('Load a model first to download.', 'info');
    return;
  }
  const fullText = generateExportText(false);
  const ext = state.exportFormat === 'csv' ? 'csv' : state.exportFormat === 'json' ? 'json' : 'txt';
  const mime = state.exportFormat === 'json' ? 'application/json' : 'text/plain';
  const base = state.model.fileName.replace(/\.3mf$/i, '');
  const fileName = `${base}_${state.cols}x${state.rows}.${ext}`;

  const blob = new Blob([fullText], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${fileName}`, 'success');
});

// Initial render of empty canvas size
window.addEventListener('load', () => {
  updateExportControlStates();
  drawViewport();
});
