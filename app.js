// iLoveImages: multi-size resize & compress, 100% client-side.
// Pipeline per preset: source bitmap → geometry (fit mode) → high-quality
// resample (cached) → encode with chosen format/quality (or binary-search
// quality to hit a target size) → live preview + stats.

const $ = (sel, root = document) => root.querySelector(sel);

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
const BUILTIN_PRESETS = [
  { id: 'original', group: 'Original', name: 'Original size', w: null, h: null },
  { id: 'desktop', group: 'Viewports', name: 'Desktop', w: 1920, h: 1080 },
  { id: 'laptop', group: 'Viewports', name: 'Laptop', w: 1366, h: 768 },
  { id: 'tablet', group: 'Viewports', name: 'Tablet', w: 768, h: 1024 },
  { id: 'mobile', group: 'Viewports', name: 'Mobile', w: 390, h: 844 },
  { id: 'ig-post', group: 'Social', name: 'Instagram post', w: 1080, h: 1080 },
  { id: 'ig-portrait', group: 'Social', name: 'Instagram portrait', w: 1080, h: 1350 },
  { id: 'story', group: 'Social', name: 'Story / Reel', w: 1080, h: 1920 },
  { id: 'og', group: 'Social', name: 'Link preview', w: 1200, h: 630 },
  { id: 'yt-thumb', group: 'Social', name: 'YouTube thumbnail', w: 1280, h: 720 },
  { id: 'thumb', group: 'Web', name: 'Thumbnail', w: 300, h: 300 },
  { id: 'icon', group: 'Web', name: 'App icon', w: 512, h: 512 },
];
const DEFAULT_ENABLED = ['original', 'desktop', 'tablet', 'mobile', 'ig-post', 'story', 'og', 'thumb'];

const FORMATS = [
  { type: 'image/jpeg', label: 'JPEG', ext: 'jpg', lossy: true, alpha: false },
  { type: 'image/webp', label: 'WebP', ext: 'webp', lossy: true, alpha: true },
  { type: 'image/png', label: 'PNG', ext: 'png', lossy: false, alpha: true },
  { type: 'image/avif', label: 'AVIF', ext: 'avif', lossy: true, alpha: true },
];

// ---------------------------------------------------------------------------
// State (settings persisted per-browser as a convenience)
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'iloveimages:v1';
const defaults = {
  format: 'image/jpeg',
  mode: 'quality',
  quality: 80,
  targetKB: 200,
  allowDownscale: true,
  fit: 'cover',
  bg: '#ffffff',
  transparent: false,
  noUpscale: true,
  enabled: DEFAULT_ENABLED,
  custom: [],
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...defaults, ...saved };
  } catch {
    return { ...defaults };
  }
}
function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, enabled: [...enabled] }));
  } catch { /* storage unavailable: ignore */ }
}

const settings = loadSettings();
const enabled = new Set(settings.enabled);
const supportedFormats = new Set();

const source = { file: null, bitmap: null, name: 'image', url: null };
const results = new Map();      // presetId → { blob, url, width, height, quality, flags }
const resampleCache = new Map(); // geometry key → canvas
let generation = 0;
let renderTimer = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality);
  });
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const formatInfo = type => FORMATS.find(f => f.type === type);
const allPresets = () => [...BUILTIN_PRESETS, ...settings.custom];
const activePresets = () => allPresets().filter(p => enabled.has(p.id));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';

async function detectFormats() {
  const c = makeCanvas(2, 2);
  for (const f of FORMATS) {
    try {
      const b = await toBlob(c, f.type, 0.8);
      if (b.type === f.type) supportedFormats.add(f.type);
    } catch { /* unsupported */ }
  }
  if (!supportedFormats.has(settings.format)) settings.format = 'image/jpeg';
}

// ---------------------------------------------------------------------------
// Geometry: where the source lands in the output canvas for each fit mode
// ---------------------------------------------------------------------------
function computeGeometry(preset, sw, sh) {
  const { fit, noUpscale } = settings;
  const full = { sx: 0, sy: 0, sw, sh };

  if (preset.w == null) {
    return { cw: sw, ch: sh, src: full, dst: { x: 0, y: 0, w: sw, h: sh }, capped: false };
  }

  let W = preset.w, H = preset.h, capped = false;

  if (fit === 'contain') {
    let s = Math.min(W / sw, H / sh);
    if (noUpscale && s > 1) { s = 1; capped = true; }
    const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    return { cw: w, ch: h, src: full, dst: { x: 0, y: 0, w, h }, capped };
  }

  if (fit === 'cover') {
    let s = Math.max(W / sw, H / sh);
    if (noUpscale && s > 1) {
      // Keep the preset's aspect ratio but shrink the canvas so no pixel is upsampled.
      W = Math.max(1, Math.round(W / s)); H = Math.max(1, Math.round(H / s)); s = 1; capped = true;
    }
    const cropW = W / s, cropH = H / s;
    return {
      cw: W, ch: H,
      src: { sx: (sw - cropW) / 2, sy: (sh - cropH) / 2, sw: cropW, sh: cropH },
      dst: { x: 0, y: 0, w: W, h: H }, capped,
    };
  }

  if (fit === 'pad') {
    let s = Math.min(W / sw, H / sh);
    if (noUpscale && s > 1) {
      W = Math.max(1, Math.round(W / s)); H = Math.max(1, Math.round(H / s)); s = 1; capped = true;
    }
    const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    return {
      cw: W, ch: H, src: full,
      dst: { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h }, capped,
    };
  }

  // stretch
  if (noUpscale) {
    const k = Math.min(1, sw / W, sh / H);
    if (k < 1) { W = Math.max(1, Math.round(W * k)); H = Math.max(1, Math.round(H * k)); capped = true; }
  }
  return { cw: W, ch: H, src: full, dst: { x: 0, y: 0, w: W, h: H }, capped };
}

// ---------------------------------------------------------------------------
// Resampling: halve repeatedly before the final draw for sharper downscales
// ---------------------------------------------------------------------------
function resample(img, sx, sy, sw, sh, dw, dh) {
  let cur = img, cx = sx, cy = sy, cW = sw, cH = sh;
  while (cW / 2 >= dw && cH / 2 >= dh) {
    const w = Math.max(1, Math.round(cW / 2)), h = Math.max(1, Math.round(cH / 2));
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, cx, cy, cW, cH, 0, 0, w, h);
    cur = c; cx = 0; cy = 0; cW = w; cH = h;
  }
  const out = makeCanvas(dw, dh);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, cx, cy, cW, cH, 0, 0, dw, dh);
  return out;
}

function needsOpaqueBg() {
  return !formatInfo(settings.format).alpha || !settings.transparent;
}

function compose(geo) {
  const bgKey = needsOpaqueBg() ? settings.bg : 'transparent';
  const key = JSON.stringify([geo.cw, geo.ch, geo.src, geo.dst, bgKey]);
  const hit = resampleCache.get(key);
  if (hit) return hit;

  const scaled = resample(source.bitmap, geo.src.sx, geo.src.sy, geo.src.sw, geo.src.sh, geo.dst.w, geo.dst.h);
  const out = makeCanvas(geo.cw, geo.ch);
  const ctx = out.getContext('2d');
  if (bgKey !== 'transparent') {
    ctx.fillStyle = bgKey;
    ctx.fillRect(0, 0, geo.cw, geo.ch);
  }
  ctx.drawImage(scaled, geo.dst.x, geo.dst.y);

  if (resampleCache.size > 40) resampleCache.clear();
  resampleCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------
// Binary-search the highest quality whose output fits under targetBytes.
async function encodeUnder(canvas, type, targetBytes, isStale) {
  if (!formatInfo(type).lossy) {
    const blob = await toBlob(canvas, type);
    return { blob, quality: null, met: blob.size <= targetBytes };
  }
  const top = await toBlob(canvas, type, 1);
  if (top.size <= targetBytes) return { blob: top, quality: 1, met: true };

  let lo = 0.02, hi = 1, best = null;
  for (let i = 0; i < 8; i++) {
    if (isStale()) return null;
    const q = (lo + hi) / 2;
    const blob = await toBlob(canvas, type, q);
    if (blob.size <= targetBytes) { best = { blob, quality: q }; lo = q; } else { hi = q; }
  }
  if (best) return { ...best, met: true };
  const blob = await toBlob(canvas, type, lo);
  return { blob, quality: lo, met: false };
}

async function encodePreset(preset, isStale) {
  const geo = computeGeometry(preset, source.bitmap.width, source.bitmap.height);
  let canvas = compose(geo);
  const type = settings.format;
  const flags = [];
  if (geo.capped) flags.push('Capped at source resolution');

  if (settings.mode === 'quality') {
    const q = settings.quality / 100;
    const blob = await toBlob(canvas, type, formatInfo(type).lossy ? q : undefined);
    return { blob, width: canvas.width, height: canvas.height, quality: formatInfo(type).lossy ? q : null, flags };
  }

  const target = Math.max(1, settings.targetKB) * 1024;
  let res = await encodeUnder(canvas, type, target, isStale);
  if (!res) return null;

  // Still too big at the lowest quality: shrink dimensions until it fits.
  let tries = 0;
  while (!res.met && settings.allowDownscale && tries < 8 && canvas.width > 16 && canvas.height > 16) {
    const k = Math.min(0.9, Math.max(0.5, Math.sqrt(target / res.blob.size) * 0.95));
    canvas = resample(canvas, 0, 0, canvas.width, canvas.height,
      Math.max(1, Math.round(canvas.width * k)), Math.max(1, Math.round(canvas.height * k)));
    res = await encodeUnder(canvas, type, target, isStale);
    if (!res) return null;
    tries++;
  }
  if (tries) flags.push('Shrunk to hit target');
  if (!res.met) flags.push('Could not reach target');
  return { blob: res.blob, width: canvas.width, height: canvas.height, quality: res.quality, flags };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function scheduleRender(delay = 150) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAll, delay);
}

async function renderAll() {
  if (!source.bitmap) return;
  const gen = ++generation;
  const isStale = () => gen !== generation;
  const presets = activePresets();

  presets.forEach(p => cardFor(p)?.querySelector('.frame').classList.add('busy'));
  updateSummary(true);

  for (const preset of presets) {
    // Yield so slider drags stay smooth between heavy encodes.
    await new Promise(r => setTimeout(r, 0));
    if (isStale()) return;
    let res;
    try {
      res = await encodePreset(preset, isStale);
    } catch (err) {
      console.error(err);
      res = { error: err.message };
    }
    if (isStale() || !res) return;
    const prev = results.get(preset.id);
    if (prev?.url) URL.revokeObjectURL(prev.url);
    if (res.blob) res.url = URL.createObjectURL(res.blob);
    results.set(preset.id, res);
    updateCard(preset);
  }
  updateSummary(false);
}

function cardFor(preset) {
  return document.getElementById(`card-${preset.id}`);
}

function targetLabel(p) {
  return p.w == null ? (source.bitmap ? `${source.bitmap.width} × ${source.bitmap.height}` : 'Source') : `${p.w} × ${p.h}`;
}

function buildGrid() {
  const grid = $('#grid');
  grid.textContent = '';
  for (const p of activePresets()) {
    const card = document.createElement('article');
    card.className = 'card';
    card.id = `card-${p.id}`;
    card.innerHTML = `
      <div class="card-head">
        <span class="card-title"></span>
        <span class="card-target"></span>
      </div>
      <div class="frame-wrap">
        <div class="frame checker" tabindex="0" role="button" aria-label="Open full-size preview">
          <img alt="" hidden>
          <div class="placeholder"></div>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><span>Output</span><b class="s-dims">–</b></div>
        <div class="stat"><span>File size</span><b class="s-size">–</b></div>
        <div class="stat"><span>Vs original</span><b class="s-saving saving">–</b></div>
        <div class="stat"><span>Quality</span><b class="s-quality">–</b></div>
      </div>
      <div class="badges"></div>
      <div class="card-foot"><button type="button" class="btn small dl" disabled>Download</button></div>`;
    $('.card-title', card).textContent = p.name;
    $('.card-target', card).textContent = targetLabel(p);

    // Before an image is loaded, show the empty frame at the preset's shape.
    const r = p.w == null ? 4 / 3 : p.w / p.h;
    $('.frame', card).style.setProperty('--r', r);
    $('.placeholder', card).textContent = p.w == null ? 'Original' : `${p.w} × ${p.h}`;

    $('.frame', card).addEventListener('click', () => openLightbox(p));
    $('.frame', card).addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(p); } });
    $('.dl', card).addEventListener('click', () => downloadOne(p));
    grid.appendChild(card);
    if (results.has(p.id)) updateCard(p);
  }
}

function updateCard(preset) {
  const card = cardFor(preset);
  if (!card) return;
  const res = results.get(preset.id);
  const frame = $('.frame', card);
  frame.classList.remove('busy');
  $('.card-target', card).textContent = targetLabel(preset);
  if (!res) return;

  if (res.error) {
    $('.placeholder', card).textContent = `Error: ${res.error}`;
    $('.placeholder', card).hidden = false;
    return;
  }

  frame.style.setProperty('--r', res.width / res.height);
  const img = $('img', card);
  img.src = res.url;
  img.hidden = false;
  $('.placeholder', card).hidden = true;

  $('.s-dims', card).textContent = `${res.width} × ${res.height}`;
  $('.s-size', card).textContent = formatBytes(res.blob.size);
  const ratio = res.blob.size / source.file.size;
  const saving = $('.s-saving', card);
  saving.textContent = ratio <= 1 ? `−${Math.round((1 - ratio) * 100)}%` : `+${Math.round((ratio - 1) * 100)}%`;
  saving.classList.toggle('good', ratio <= 1);
  saving.classList.toggle('bad', ratio > 1);
  $('.s-quality', card).textContent = res.quality == null ? 'Lossless' : `${Math.round(res.quality * 100)}%`;

  const badges = $('.badges', card);
  badges.textContent = '';
  for (const f of res.flags) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = f;
    badges.appendChild(b);
  }
  $('.dl', card).disabled = false;
  $('.dl', card).textContent = `Download ${formatInfo(settings.format).label}`;
}

function updateSummary(busy) {
  const el = $('#summary');
  const presets = activePresets();
  if (!source.bitmap) {
    el.textContent = 'Choose an image to see live previews.';
    $('#download-all').disabled = true;
    return;
  }
  const done = presets.map(p => results.get(p.id)).filter(r => r?.blob);
  const total = done.reduce((s, r) => s + r.blob.size, 0);
  el.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = `${presets.length} size${presets.length === 1 ? '' : 's'}`;
  el.append(strong, ` · ${formatBytes(total)} total${busy ? ' · updating…' : ''}`);
  $('#download-all').disabled = busy || done.length === 0;
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
function fileNameFor(preset, res) {
  return `${slug(source.name)}-${slug(preset.name)}-${res.width}x${res.height}.${formatInfo(settings.format).ext}`;
}

function triggerDownload(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadOne(preset) {
  const res = results.get(preset.id);
  if (res?.blob) triggerDownload(res.blob, fileNameFor(preset, res));
}

let jszipPromise = null;
function loadJSZip() {
  jszipPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => { jszipPromise = null; reject(new Error('Could not load JSZip')); };
    document.head.appendChild(s);
  });
  return jszipPromise;
}

async function downloadAll() {
  const items = activePresets().map(p => [p, results.get(p.id)]).filter(([, r]) => r?.blob);
  if (!items.length) return;
  const btn = $('#download-all');
  btn.disabled = true;
  try {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    for (const [p, r] of items) zip.file(fileNameFor(p, r), r.blob);
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, `${slug(source.name)}-resized.zip`);
  } catch {
    // Offline or CDN blocked: fall back to individual downloads.
    for (const [p] of items) { downloadOne(p); await new Promise(r => setTimeout(r, 250)); }
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------
function openLightbox(preset) {
  const res = results.get(preset.id);
  if (!res?.url) return;
  $('#lb-img').src = res.url;
  $('#lb-title').textContent = `${preset.name} · ${res.width} × ${res.height} · ${formatBytes(res.blob.size)} (shown at 100%)`;
  $('#lightbox').showModal();
}

// ---------------------------------------------------------------------------
// Source loading
// ---------------------------------------------------------------------------
async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Fallback for browsers without ImageBitmap options or for SVG.
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Unsupported image'));
      img.src = URL.createObjectURL(file);
    }).catch(err => { alert(err.message); return null; });
    if (!bitmap) return;
  }
  if (source.bitmap?.close) source.bitmap.close();
  if (source.url) URL.revokeObjectURL(source.url);

  source.file = file;
  source.bitmap = bitmap;
  source.name = (file.name || 'image').replace(/\.[^.]+$/, '');
  source.url = URL.createObjectURL(file);
  resampleCache.clear();
  for (const r of results.values()) if (r.url) URL.revokeObjectURL(r.url);
  results.clear();

  $('#source-preview').src = source.url;
  $('#source-preview').hidden = false;
  $('#dropzone').classList.add('has-image');
  $('#source-meta').hidden = false;
  $('#src-name').textContent = file.name || 'Pasted image';
  $('#src-dims').textContent = `${bitmap.width} × ${bitmap.height}`;
  $('#src-size').textContent = `${formatBytes(file.size)} · ${file.type.replace('image/', '').toUpperCase()}`;

  buildGrid();
  scheduleRender(0);
}

async function makeSample() {
  const c = makeCanvas(2400, 1600);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 2400, 1600);
  g.addColorStop(0, '#ff7e5f');
  g.addColorStop(0.5, '#feb47b');
  g.addColorStop(1, '#6a82fb');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2400, 1600);
  for (let i = 0; i < 140; i++) {
    ctx.beginPath();
    ctx.fillStyle = `hsla(${(i * 37) % 360}, 75%, ${45 + (i % 4) * 10}%, 0.55)`;
    ctx.arc((i * 523) % 2400, (i * 311) % 1600, 30 + ((i * 17) % 120), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 180px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('iLoveImages', 1200, 860);
  const blob = await toBlob(c, 'image/jpeg', 0.95);
  loadFile(new File([blob], 'sample.jpg', { type: 'image/jpeg' }));
}

// ---------------------------------------------------------------------------
// Settings UI
// ---------------------------------------------------------------------------
function buildFormatSeg() {
  const seg = $('#format-seg');
  seg.textContent = '';
  for (const f of FORMATS) {
    const ok = supportedFormats.has(f.type);
    if (!ok && f.type === 'image/avif') continue; // hide rather than show a dead option
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.dataset.format = f.type;
    b.textContent = f.label;
    b.disabled = !ok;
    b.setAttribute('role', 'radio');
    if (!ok) b.title = 'Not supported by this browser';
    seg.appendChild(b);
  }
}

function syncControls() {
  document.querySelectorAll('[data-format]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.format === settings.format)));
  document.querySelectorAll('[data-mode]').forEach(b => {
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode));
  });
  const fmt = formatInfo(settings.format);
  $('#quality').value = settings.quality;
  $('#quality-out').textContent = `${settings.quality}%`;
  $('#quality').disabled = !fmt.lossy;
  $('#quality-field').hidden = settings.mode !== 'quality';
  $('#target-field').hidden = settings.mode !== 'target';
  $('#png-note').hidden = fmt.lossy || settings.mode !== 'quality';
  $('#target-kb').value = settings.targetKB;
  $('#allow-downscale').checked = settings.allowDownscale;
  $('#fit').value = settings.fit;
  $('#bg').value = settings.bg;
  $('#transparent').checked = settings.transparent && fmt.alpha;
  $('#transparent').disabled = !fmt.alpha;
  $('#bg').disabled = fmt.alpha && settings.transparent;
  $('#no-upscale').checked = settings.noUpscale;
}

function buildPresetChips() {
  const wrap = $('#preset-groups');
  wrap.textContent = '';
  const groups = new Map();
  for (const p of allPresets()) {
    const g = p.group || 'Custom';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  for (const [name, list] of groups) {
    const section = document.createElement('div');
    section.className = 'preset-group';
    const h = document.createElement('h3');
    h.textContent = name;
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const p of list) {
      const label = document.createElement('label');
      label.className = 'chip';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = enabled.has(p.id);
      input.addEventListener('change', () => {
        input.checked ? enabled.add(p.id) : enabled.delete(p.id);
        onPresetsChanged();
      });
      const small = document.createElement('small');
      small.textContent = p.w == null ? '' : `${p.w}×${p.h}`;
      label.append(input, p.name + ' ', small);
      if (p.group === 'Custom') {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'remove';
        x.setAttribute('aria-label', `Remove ${p.name}`);
        x.textContent = '×';
        x.addEventListener('click', e => {
          e.preventDefault();
          settings.custom = settings.custom.filter(c => c.id !== p.id);
          enabled.delete(p.id);
          results.delete(p.id);
          buildPresetChips();
          onPresetsChanged();
        });
        label.appendChild(x);
      }
      chips.appendChild(label);
    }
    section.append(h, chips);
    wrap.appendChild(section);
  }
}

function onPresetsChanged() {
  saveSettings();
  buildGrid();
  updateSummary(false);
  // Only newly enabled presets lack results; render fills them in.
  if (activePresets().some(p => !results.has(p.id))) scheduleRender(0);
}

function onSettingsChanged(delay) {
  syncControls();
  saveSettings();
  scheduleRender(delay);
}

function bindEvents() {
  const input = $('#file-input');
  input.addEventListener('change', () => { loadFile(input.files[0]); input.value = ''; });

  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('dragging')));
  dz.addEventListener('drop', e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });
  // Allow dropping anywhere on the page.
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });

  $('#sample-btn').addEventListener('click', makeSample);

  $('#format-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-format]');
    if (!b || b.disabled) return;
    settings.format = b.dataset.format;
    resampleCache.clear(); // background fill depends on format alpha support
    onSettingsChanged(0);
  });
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    settings.mode = b.dataset.mode;
    onSettingsChanged(0);
  }));
  $('#quality').addEventListener('input', e => { settings.quality = +e.target.value; onSettingsChanged(120); });
  $('#target-kb').addEventListener('input', e => {
    const v = +e.target.value;
    if (v > 0) { settings.targetKB = v; saveSettings(); scheduleRender(400); }
  });
  $('#allow-downscale').addEventListener('change', e => { settings.allowDownscale = e.target.checked; onSettingsChanged(0); });
  $('#fit').addEventListener('change', e => { settings.fit = e.target.value; onSettingsChanged(0); });
  $('#bg').addEventListener('input', e => { settings.bg = e.target.value; onSettingsChanged(150); });
  $('#transparent').addEventListener('change', e => { settings.transparent = e.target.checked; onSettingsChanged(0); });
  $('#no-upscale').addEventListener('change', e => { settings.noUpscale = e.target.checked; onSettingsChanged(0); });

  $('#custom-form').addEventListener('submit', e => {
    e.preventDefault();
    const w = Math.round(+$('#custom-w').value), h = Math.round(+$('#custom-h').value);
    if (!(w > 0 && h > 0)) return;
    const name = $('#custom-name').value.trim() || `Custom ${w}×${h}`;
    const id = `custom-${Date.now().toString(36)}`;
    settings.custom.push({ id, group: 'Custom', name, w, h });
    enabled.add(id);
    e.target.reset();
    buildPresetChips();
    onPresetsChanged();
  });

  $('#download-all').addEventListener('click', downloadAll);
  $('#lb-close').addEventListener('click', () => $('#lightbox').close());
  $('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') e.target.close(); });
}

// ---------------------------------------------------------------------------
async function init() {
  buildPresetChips();
  buildGrid();
  await detectFormats();
  buildFormatSeg();
  syncControls();
  bindEvents();
}

init();
