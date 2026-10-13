// iLoveImages Forge: crop, edit and export to many viewports, 100% client-side.
//
// Pipeline
//   source bitmap ──(rotate/flip/straighten/filters/vignette)──▶ edited canvas
//   edited canvas ──(crop rect)──▶ crop region ──(fit per viewport)──▶ output
//
// Two render tiers keep it live:
//   1. LIVE: every edit redraws the stage and every viewport screen from a
//      downscaled "preview" edited canvas (cheap, runs per animation frame).
//   2. ENCODE: once edits pause, each viewport is rebuilt at full resolution,
//      encoded with the chosen format/quality (or a target size), and the real
//      encoded pixels + byte size replace the live preview.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------
const BUILTIN_VIEWPORTS = [
  { id: 'master', group: 'Master', name: 'Master crop', w: null, h: null, kind: 'frame' },
  { id: 'desktop', group: 'Screens', name: 'Desktop', w: 1920, h: 1080, kind: 'monitor' },
  { id: 'laptop', group: 'Screens', name: 'Laptop', w: 1366, h: 768, kind: 'monitor' },
  { id: 'tablet', group: 'Screens', name: 'Tablet', w: 768, h: 1024, kind: 'tablet' },
  { id: 'mobile', group: 'Screens', name: 'Mobile', w: 390, h: 844, kind: 'phone' },
  { id: 'ig-post', group: 'Social', name: 'Insta post', w: 1080, h: 1080, kind: 'frame' },
  { id: 'ig-portrait', group: 'Social', name: 'Insta portrait', w: 1080, h: 1350, kind: 'frame' },
  { id: 'story', group: 'Social', name: 'Story / Reel', w: 1080, h: 1920, kind: 'phone' },
  { id: 'og', group: 'Social', name: 'Link preview', w: 1200, h: 630, kind: 'frame' },
  { id: 'yt-thumb', group: 'Social', name: 'YouTube thumb', w: 1280, h: 720, kind: 'frame' },
  { id: 'thumb', group: 'Web', name: 'Thumbnail', w: 300, h: 300, kind: 'frame' },
  { id: 'icon', group: 'Web', name: 'App icon', w: 512, h: 512, kind: 'frame' },
];
const DEFAULT_ENABLED = ['master', 'desktop', 'laptop', 'tablet', 'mobile', 'ig-post', 'story', 'og'];

const FORMATS = [
  { type: 'image/jpeg', label: 'JPEG', ext: 'jpg', lossy: true, alpha: false },
  { type: 'image/webp', label: 'WebP', ext: 'webp', lossy: true, alpha: true },
  { type: 'image/png', label: 'PNG', ext: 'png', lossy: false, alpha: true },
  { type: 'image/avif', label: 'AVIF', ext: 'avif', lossy: true, alpha: true },
];

const ADJUSTMENTS = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 200, def: 100, unit: '%' },
  { key: 'contrast', label: 'Contrast', min: 0, max: 200, def: 100, unit: '%' },
  { key: 'saturation', label: 'Saturation', min: 0, max: 300, def: 100, unit: '%' },
  { key: 'hue', label: 'Hue', min: -180, max: 180, def: 0, unit: '°' },
  { key: 'grayscale', label: 'Mono', min: 0, max: 100, def: 0, unit: '%' },
  { key: 'sepia', label: 'Sepia', min: 0, max: 100, def: 0, unit: '%' },
  { key: 'blur', label: 'Blur', min: 0, max: 20, def: 0, unit: '', step: 0.5 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100, def: 0, unit: '%' },
];
const DEFAULT_ADJ = Object.fromEntries(ADJUSTMENTS.map(a => [a.key, a.def]));

const LOOKS = {
  None: {},
  Vivid: { contrast: 115, saturation: 145 },
  Noir: { grayscale: 100, contrast: 135, brightness: 95, vignette: 45 },
  Warm: { sepia: 35, saturation: 120, brightness: 104 },
  Fade: { contrast: 82, brightness: 110, saturation: 70 },
  Neon: { saturation: 190, contrast: 120, hue: -12, vignette: 35 },
  Matrix: { grayscale: 100, sepia: 100, hue: 70, saturation: 260, contrast: 115, vignette: 40 },
  Ice: { sepia: 60, hue: 165, saturation: 130, brightness: 106 },
};

const PREVIEW_MAX = 1400; // long side of the live-preview working image

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'iloveimages:forge:v1';
const outDefaults = {
  format: 'image/jpeg', mode: 'quality', quality: 82, targetKB: 200, allowDownscale: true,
  fit: 'cover', bg: '#05070d', transparent: false, noUpscale: true,
  enabled: DEFAULT_ENABLED, custom: [],
};
function loadOut() {
  try { return { ...outDefaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return { ...outDefaults }; }
}
// Landing pages pass a starting setup via <body data-config> (see scripts/build.mjs).
const pageConfig = (() => {
  try { return JSON.parse(document.body.dataset.config || '{}'); } catch { return {}; }
})();

const out = loadOut();
for (const key of ['format', 'mode', 'quality', 'targetKB', 'allowDownscale', 'fit']) {
  if (key in pageConfig) out[key] = pageConfig[key];
}
const enabled = new Set(pageConfig.enabled || out.enabled);
function saveOut() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...out, enabled: [...enabled] })); } catch { /* ignore */ }
}

const freshEdit = () => ({
  rot: 0, flipH: false, flipV: false, straighten: 0,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  aspect: pageConfig.aspect ?? 'free', // 'free' | 'orig' | number (w/h in pixels)
  adj: { ...DEFAULT_ADJ },
});
let edit = freshEdit();

const src = { file: null, bitmap: null, preview: null, name: 'image' };
let previewEdited = null, previewDirty = true;
let fullEdited = null, fullDirty = true;
let editVersion = 0;

const results = new Map(); // viewport id → { blob, width, height, quality, flags }
const composeCache = new Map();
let encodeGen = 0, encodeTimer = 0, liveFrame = 0;
let filterSupported = true;
const supportedFormats = new Set();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function toBlob(canvas, type, quality) {
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Encoding failed'))), type, quality));
}
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}
const fmt = type => FORMATS.find(f => f.type === type);
const allViewports = () => [...BUILTIN_VIEWPORTS, ...out.custom];
const activeViewports = () => allViewports().filter(v => enabled.has(v.id));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

function detectFilterSupport() {
  const ctx = makeCanvas(1, 1).getContext('2d');
  if (!('filter' in ctx)) return false;
  ctx.filter = 'blur(1px)';
  return ctx.filter === 'blur(1px)';
}
async function detectFormats() {
  const c = makeCanvas(2, 2);
  for (const f of FORMATS) {
    try { if ((await toBlob(c, f.type, 0.8)).type === f.type) supportedFormats.add(f.type); } catch { /* no */ }
  }
  if (!supportedFormats.has(out.format)) out.format = 'image/jpeg';
}

// Halve repeatedly before the final draw → much sharper large downscales.
function resample(img, sx, sy, sw, sh, dw, dh) {
  dw = Math.max(1, Math.round(dw)); dh = Math.max(1, Math.round(dh));
  let cur = img, cx = sx, cy = sy, cW = sw, cH = sh;
  while (cW / 2 >= dw && cH / 2 >= dh) {
    const w = Math.round(cW / 2), h = Math.round(cH / 2);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, cx, cy, cW, cH, 0, 0, w, h);
    cur = c; cx = 0; cy = 0; cW = w; cH = h;
  }
  const o = makeCanvas(dw, dh);
  const ctx = o.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, cx, cy, cW, cH, 0, 0, dw, dh);
  return o;
}

// ---------------------------------------------------------------------------
// Editing pipeline
// ---------------------------------------------------------------------------
function editedDims() {
  const { width: w, height: h } = src.bitmap;
  return edit.rot % 180 ? { ew: h, eh: w } : { ew: w, eh: h };
}

function filterString(longSide) {
  const a = edit.adj;
  const parts = [];
  if (a.grayscale) parts.push(`grayscale(${a.grayscale}%)`);
  if (a.sepia) parts.push(`sepia(${a.sepia}%)`);
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.saturation !== 100) parts.push(`saturate(${a.saturation}%)`);
  if (a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`);
  if (a.contrast !== 100) parts.push(`contrast(${a.contrast}%)`);
  // Blur is defined relative to a 1000px long side so preview and export match.
  if (a.blur) parts.push(`blur(${(a.blur * longSide / 1000).toFixed(2)}px)`);
  return parts.join(' ') || 'none';
}

// Render the source (or its preview copy) with every edit except crop.
function buildEdited(img) {
  const turned = edit.rot % 180 !== 0;
  const W = turned ? img.height : img.width;
  const H = turned ? img.width : img.height;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (filterSupported) ctx.filter = filterString(Math.max(W, H));

  // Straighten: rotate by a fine angle and zoom just enough to hide empty corners.
  const t = Math.abs(edit.straighten) * Math.PI / 180;
  const k = Math.max(Math.cos(t) + (H / W) * Math.sin(t), Math.cos(t) + (W / H) * Math.sin(t));

  ctx.translate(W / 2, H / 2);
  ctx.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
  ctx.rotate((edit.rot + edit.straighten) * Math.PI / 180);
  ctx.scale(k, k);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';

  if (edit.adj.vignette) {
    const r = Math.hypot(W, H) / 2;
    const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.35, W / 2, H / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(edit.adj.vignette / 100) * 0.9})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  return c;
}

function cropPx() {
  const { ew, eh } = editedDims();
  const c = edit.crop;
  return {
    x: c.x * ew, y: c.y * eh,
    w: Math.max(1, Math.round(c.w * ew)), h: Math.max(1, Math.round(c.h * eh)),
  };
}

// Mark that pixels changed (not just the crop rect).
function pixelsChanged() {
  previewDirty = true;
  fullDirty = true;
  editVersion++;
  composeCache.clear();
}

// ---------------------------------------------------------------------------
// Viewport geometry: where the crop lands in an output of a given size
// ---------------------------------------------------------------------------
function computeGeometry(vp, sw, sh) {
  const full = { sx: 0, sy: 0, sw, sh };
  if (vp.w == null) return { cw: sw, ch: sh, src: full, dst: { x: 0, y: 0, w: sw, h: sh }, capped: false };

  let W = vp.w, H = vp.h, capped = false;
  const { fit, noUpscale } = out;

  if (fit === 'contain') {
    let s = Math.min(W / sw, H / sh);
    if (noUpscale && s > 1) { s = 1; capped = true; }
    const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    return { cw: w, ch: h, src: full, dst: { x: 0, y: 0, w, h }, capped };
  }
  if (fit === 'cover') {
    let s = Math.max(W / sw, H / sh);
    if (noUpscale && s > 1) { W = Math.max(1, Math.round(W / s)); H = Math.max(1, Math.round(H / s)); s = 1; capped = true; }
    const cw = W / s, ch = H / s;
    return { cw: W, ch: H, src: { sx: (sw - cw) / 2, sy: (sh - ch) / 2, sw: cw, sh: ch }, dst: { x: 0, y: 0, w: W, h: H }, capped };
  }
  if (fit === 'pad') {
    let s = Math.min(W / sw, H / sh);
    if (noUpscale && s > 1) { W = Math.max(1, Math.round(W / s)); H = Math.max(1, Math.round(H / s)); s = 1; capped = true; }
    const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    return { cw: W, ch: H, src: full, dst: { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h }, capped };
  }
  // stretch
  if (noUpscale) {
    const k = Math.min(1, sw / W, sh / H);
    if (k < 1) { W = Math.max(1, Math.round(W * k)); H = Math.max(1, Math.round(H * k)); capped = true; }
  }
  return { cw: W, ch: H, src: full, dst: { x: 0, y: 0, w: W, h: H }, capped };
}

const opaqueBg = () => !fmt(out.format).alpha || !out.transparent;

// ---------------------------------------------------------------------------
// Tier 1: LIVE rendering (stage + every viewport screen)
// ---------------------------------------------------------------------------
function requestLive() {
  if (!src.bitmap) return;
  cancelAnimationFrame(liveFrame);
  liveFrame = requestAnimationFrame(renderLive);
  setStatus('live');
  clearTimeout(encodeTimer);
  encodeGen++; // any in-flight encode is now stale
  encodeTimer = setTimeout(encodeAll, 450);
}

function renderLive() {
  if (!src.bitmap) return;
  if (previewDirty || !previewEdited) {
    previewEdited = buildEdited(src.preview);
    previewDirty = false;
  }
  layoutStage();
  for (const vp of activeViewports()) drawViewportLive(vp);
  updateReadouts();
}

let stageRect = null; // css px box of the image inside the stage

function layoutStage() {
  const stage = $('#stage');
  const box = $('#canvas-box');
  const { ew, eh } = editedDims();
  const pad = 46;
  const availW = Math.max(40, stage.clientWidth - pad * 2);
  const availH = Math.max(40, stage.clientHeight - pad * 2);
  const s = Math.min(availW / ew, availH / eh);
  const w = Math.round(ew * s), h = Math.round(eh * s);
  const left = Math.round((stage.clientWidth - w) / 2), top = Math.round((stage.clientHeight - h) / 2);
  Object.assign(box.style, { width: `${w}px`, height: `${h}px`, left: `${left}px`, top: `${top}px` });
  stageRect = { w, h };

  const canvas = $('#stage-canvas');
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, bw, bh);
  ctx.drawImage(previewEdited, 0, 0, bw, bh);
  positionCropBox();
}

function positionCropBox() {
  const c = edit.crop;
  Object.assign($('#crop-box').style, {
    left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%`,
  });
  const p = cropPx();
  $('#crop-tag').textContent = `${p.w} × ${p.h}`;
}

// Size a viewport's screen to fit its slot at the output's aspect ratio.
function sizeScreen(card, cw, ch) {
  const slot = $('.vp-slot', card);
  const screen = $('.vp-screen', card);
  const canvas = $('canvas', card);
  const bezel = screen.offsetWidth - screen.clientWidth; // left+right border
  const maxW = Math.max(20, slot.clientWidth - bezel - 4);
  const maxH = Math.max(20, slot.clientHeight - bezel - (screen.classList.contains('k-monitor') ? 14 : 4));
  const s = Math.min(maxW / cw, maxH / ch);
  const w = Math.max(8, Math.round(cw * s)), h = Math.max(8, Math.round(ch * s));
  screen.style.width = `${w + bezel}px`;
  screen.style.height = `${h + bezel}px`;
  const dpr = window.devicePixelRatio || 1;
  // Never allocate more backing pixels than the real output has.
  const bw = Math.max(1, Math.min(Math.round(w * dpr), cw)), bh = Math.max(1, Math.min(Math.round(h * dpr), ch));
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  return canvas;
}

function drawViewportLive(vp) {
  const card = document.getElementById(`vp-${vp.id}`);
  if (!card) return;
  const crop = cropPx();
  const geo = computeGeometry(vp, crop.w, crop.h);
  const canvas = sizeScreen(card, geo.cw, geo.ch);
  const ctx = canvas.getContext('2d');
  const k = canvas.width / geo.cw;
  const ps = previewEdited.width / editedDims().ew; // preview px per full-res px

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (opaqueBg()) { ctx.fillStyle = out.bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(previewEdited,
    (crop.x + geo.src.sx) * ps, (crop.y + geo.src.sy) * ps, geo.src.sw * ps, geo.src.sh * ps,
    geo.dst.x * k, geo.dst.y * k, geo.dst.w * k, geo.dst.h * k);

  $('.vp-screen', card).classList.remove('empty');
  $('.led', card).className = 'led live';
  $('.dims', card).textContent = `${geo.cw}×${geo.ch}`;
  card.classList.toggle('flagged', geo.capped);
}

// ---------------------------------------------------------------------------
// Tier 2: full-resolution encode
// ---------------------------------------------------------------------------
function compose(geo, crop) {
  const bgKey = opaqueBg() ? out.bg : 'transparent';
  const key = JSON.stringify([editVersion, crop, geo.cw, geo.ch, geo.src, geo.dst, bgKey]);
  const hit = composeCache.get(key);
  if (hit) return hit;
  const scaled = resample(fullEdited, crop.x + geo.src.sx, crop.y + geo.src.sy, geo.src.sw, geo.src.sh, geo.dst.w, geo.dst.h);
  const c = makeCanvas(geo.cw, geo.ch);
  const ctx = c.getContext('2d');
  if (bgKey !== 'transparent') { ctx.fillStyle = bgKey; ctx.fillRect(0, 0, geo.cw, geo.ch); }
  ctx.drawImage(scaled, geo.dst.x, geo.dst.y);
  if (composeCache.size > 30) composeCache.clear();
  composeCache.set(key, c);
  return c;
}

// Highest quality whose output fits under targetBytes (binary search).
async function encodeUnder(canvas, type, targetBytes, stale) {
  if (!fmt(type).lossy) {
    const blob = await toBlob(canvas, type);
    return { blob, quality: null, met: blob.size <= targetBytes };
  }
  const top = await toBlob(canvas, type, 1);
  if (top.size <= targetBytes) return { blob: top, quality: 1, met: true };
  let lo = 0.02, hi = 1, best = null;
  for (let i = 0; i < 8; i++) {
    if (stale()) return null;
    const q = (lo + hi) / 2;
    const blob = await toBlob(canvas, type, q);
    if (blob.size <= targetBytes) { best = { blob, quality: q }; lo = q; } else hi = q;
  }
  if (best) return { ...best, met: true };
  const blob = await toBlob(canvas, type, 0.02);
  return { blob, quality: 0.02, met: blob.size <= targetBytes };
}

async function encodeViewport(vp, stale) {
  const crop = cropPx();
  const geo = computeGeometry(vp, crop.w, crop.h);
  let canvas = compose(geo, crop);
  const type = out.format, lossy = fmt(type).lossy;
  const flags = [];
  if (geo.capped) flags.push('capped at source');

  if (out.mode === 'quality') {
    const q = out.quality / 100;
    const blob = await toBlob(canvas, type, lossy ? q : undefined);
    return { blob, width: canvas.width, height: canvas.height, quality: lossy ? q : null, flags };
  }

  const target = Math.max(1, out.targetKB) * 1024;
  let res = await encodeUnder(canvas, type, target, stale);
  if (!res) return null;
  let tries = 0;
  while (!res.met && out.allowDownscale && tries < 8 && canvas.width > 16 && canvas.height > 16) {
    const k = clamp(Math.sqrt(target / res.blob.size) * 0.95, 0.5, 0.9);
    canvas = resample(canvas, 0, 0, canvas.width, canvas.height, canvas.width * k, canvas.height * k);
    res = await encodeUnder(canvas, type, target, stale);
    if (!res) return null;
    tries++;
  }
  if (tries) flags.push('shrunk to fit');
  if (!res.met) flags.push('over target');
  return { blob: res.blob, width: canvas.width, height: canvas.height, quality: res.quality, flags };
}

async function encodeAll() {
  if (!src.bitmap) return;
  const gen = ++encodeGen;
  const stale = () => gen !== encodeGen;
  await nextFrame();
  if (stale()) return;
  if (fullDirty || !fullEdited) { fullEdited = buildEdited(src.bitmap); fullDirty = false; }

  for (const vp of activeViewports()) {
    await new Promise(r => setTimeout(r, 0)); // keep the UI responsive between encodes
    if (stale()) return;
    let res;
    try { res = await encodeViewport(vp, stale); } catch (err) { console.error(err); res = { error: err.message }; }
    if (stale() || !res) return;
    results.set(vp.id, res);
    await showEncoded(vp, res);
    if (stale()) return;
  }
  setStatus('ok');
  updateReadouts();
}

// Replace the live preview with the actual encoded pixels and stats.
async function showEncoded(vp, res) {
  const card = document.getElementById(`vp-${vp.id}`);
  if (!card) return;
  const led = $('.led', card);
  if (res.error) { led.className = 'led err'; $('.size', card).textContent = 'ERROR'; return; }

  const canvas = sizeScreen(card, res.width, res.height);
  try {
    const bmp = await createImageBitmap(res.blob);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
  } catch { /* keep live preview */ }

  led.className = 'led ok';
  $('.size', card).textContent = formatBytes(res.blob.size);
  const ratio = res.blob.size / src.file.size;
  const delta = $('.delta', card);
  delta.textContent = ratio <= 1 ? `−${Math.round((1 - ratio) * 100)}%` : `+${Math.round((ratio - 1) * 100)}%`;
  delta.className = `delta ${ratio <= 1 ? 'good' : 'bad'}`;
  $('.dims', card).textContent = `${res.width}×${res.height}${res.flags.length ? ' · ' + res.flags.join(', ') : ''}`;
  $('.dims', card).title = res.flags.join(', ');
  $('.q', card).textContent = res.quality == null ? 'LOSSLESS' : `Q${Math.round(res.quality * 100)}`;
  card.classList.toggle('flagged', res.flags.length > 0);
  $('.vp-dl', card).disabled = false;
}

// ---------------------------------------------------------------------------
// Deck (viewport cards)
// ---------------------------------------------------------------------------
const DL_ICON = '<svg viewBox="0 0 24 24"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>';

function buildDeck() {
  const deck = $('#deck');
  deck.textContent = '';
  activeViewports().forEach((vp, i) => {
    const card = document.createElement('article');
    card.className = 'vp-card';
    card.id = `vp-${vp.id}`;
    card.innerHTML = `
      <div class="vp-head">
        <span class="led"></span><span class="vp-id"></span><span class="vp-name"></span>
        <button type="button" class="vp-dl" disabled>${DL_ICON}</button>
      </div>
      <div class="vp-slot" role="button" tabindex="0">
        <div class="vp-screen empty checker k-${vp.kind || 'frame'}"><canvas></canvas><div class="nosignal">NO<br>SIGNAL</div></div>
      </div>
      <div class="vp-stats"><b class="size">—</b><b class="delta">—</b><span class="dims"></span><span class="q"></span></div>`;
    $('.vp-id', card).textContent = `VP${String(i + 1).padStart(2, '0')}`;
    $('.vp-name', card).textContent = vp.name;
    $('.vp-name', card).title = vp.name;
    $('.vp-dl', card).setAttribute('aria-label', `Download ${vp.name}`);
    $('.vp-slot', card).setAttribute('aria-label', `Inspect ${vp.name} at full size`);
    $('.dims', card).textContent = vp.w == null ? 'source crop' : `${vp.w}×${vp.h}`;
    $('.vp-dl', card).addEventListener('click', () => downloadOne(vp));
    $('.vp-slot', card).addEventListener('click', () => openLightbox(vp));
    $('.vp-slot', card).addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(vp); } });
    deck.appendChild(card);
  });
  // Empty screens still show each viewport's real shape.
  requestAnimationFrame(() => {
    for (const vp of activeViewports()) {
      const card = document.getElementById(`vp-${vp.id}`);
      if (!src.bitmap && card) sizeScreen(card, vp.w ?? 4, vp.h ?? 3);
    }
  });
}

// ---------------------------------------------------------------------------
// Crop interaction
// ---------------------------------------------------------------------------
function aspectRatioPx() {
  if (edit.aspect === 'free') return null;
  if (edit.aspect === 'orig') { const { ew, eh } = editedDims(); return ew / eh; }
  return edit.aspect;
}

// Largest rect of the locked aspect, centred on the current crop.
function applyAspect() {
  const r = aspectRatioPx();
  if (!r) return;
  const { ew, eh } = editedDims();
  const c = edit.crop;
  const cx = (c.x + c.w / 2) * ew, cy = (c.y + c.h / 2) * eh;
  let w = ew, h = ew / r;
  if (h > eh) { h = eh; w = eh * r; }
  const x = clamp(cx - w / 2, 0, ew - w), y = clamp(cy - h / 2, 0, eh - h);
  edit.crop = { x: x / ew, y: y / eh, w: w / ew, h: h / eh };
}

function bindCrop() {
  const layer = $('#crop-layer');
  let drag = null;

  layer.addEventListener('pointerdown', e => {
    const handle = e.target.dataset?.h;
    const inBox = e.target.closest('#crop-box');
    if (!handle && !inBox) return;
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    layer.classList.add('dragging');
    drag = { handle: handle || 'move', x: e.clientX, y: e.clientY, start: { ...edit.crop } };
  });
  layer.addEventListener('pointermove', e => {
    if (!drag || !stageRect) return;
    const dx = (e.clientX - drag.x) / stageRect.w;
    const dy = (e.clientY - drag.y) / stageRect.h;
    edit.crop = nextCrop(drag.start, drag.handle, dx, dy);
    positionCropBox();
    requestLive();
  });
  const end = () => { if (drag) { drag = null; layer.classList.remove('dragging'); } };
  layer.addEventListener('pointerup', end);
  layer.addEventListener('pointercancel', end);
  layer.addEventListener('dblclick', () => { edit.crop = { x: 0, y: 0, w: 1, h: 1 }; applyAspect(); requestLive(); });

  // Arrow keys nudge the crop when the stage has focus.
  $('#stage').addEventListener('keydown', e => {
    if (!src.bitmap || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) / Math.max(stageRect?.w || 500, 1);
    const c = edit.crop;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    edit.crop = { ...c, x: clamp(c.x + dx, 0, 1 - c.w), y: clamp(c.y + dy, 0, 1 - c.h) };
    requestLive();
  });
}

function nextCrop(r0, handle, dx, dy) {
  if (handle === 'move') {
    return { ...r0, x: clamp(r0.x + dx, 0, 1 - r0.w), y: clamp(r0.y + dy, 0, 1 - r0.h) };
  }
  const minW = 24 / stageRect.w, minH = 24 / stageRect.h;
  let L = r0.x, T = r0.y, R = r0.x + r0.w, B = r0.y + r0.h;
  if (handle.includes('w')) L = clamp(L + dx, 0, R - minW);
  if (handle.includes('e')) R = clamp(R + dx, L + minW, 1);
  if (handle.includes('n')) T = clamp(T + dy, 0, B - minH);
  if (handle.includes('s')) B = clamp(B + dy, T + minH, 1);

  const ratio = aspectRatioPx();
  if (!ratio) return { x: L, y: T, w: R - L, h: B - T };

  // Locked aspect, in normalised units: w / h = ar.
  const { ew, eh } = editedDims();
  const ar = ratio * eh / ew;
  let w = R - L, h = B - T;
  const corner = handle.length === 2;
  if (corner) {
    if (w / h > ar) w = h * ar; else h = w / ar;
    const ax = handle.includes('w') ? r0.x + r0.w : r0.x; // anchor = opposite corner
    const ay = handle.includes('n') ? r0.y + r0.h : r0.y;
    const maxW = handle.includes('w') ? ax : 1 - ax;
    const maxH = handle.includes('n') ? ay : 1 - ay;
    const s = Math.min(1, maxW / w, maxH / h);
    w *= s; h *= s;
    return { x: handle.includes('w') ? ax - w : ax, y: handle.includes('n') ? ay - h : ay, w, h };
  }
  if (handle === 'e' || handle === 'w') {
    h = w / ar;
    const cy = r0.y + r0.h / 2;
    const maxH = 2 * Math.min(cy, 1 - cy);
    if (h > maxH) { h = maxH; w = h * ar; }
    const x = handle === 'w' ? r0.x + r0.w - w : r0.x;
    return { x, y: cy - h / 2, w, h };
  }
  w = h * ar;
  const cx = r0.x + r0.w / 2;
  const maxW = 2 * Math.min(cx, 1 - cx);
  if (w > maxW) { w = maxW; h = w / ar; }
  const y = handle === 'n' ? r0.y + r0.h - h : r0.y;
  return { x: cx - w / 2, y, w, h };
}

// ---------------------------------------------------------------------------
// Transform actions (keep the crop on the same part of the picture)
// ---------------------------------------------------------------------------
function rotate(dir) {
  const c = edit.crop;
  edit.crop = dir > 0
    ? { x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w }
    : { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w };
  edit.rot = (edit.rot + (dir > 0 ? 90 : 270)) % 360;
  if (typeof edit.aspect === 'number') edit.aspect = 1 / edit.aspect;
  syncAspectChips();
  pixelsChanged();
  requestLive();
}
function flip(axis) {
  const c = edit.crop;
  if (axis === 'h') { edit.flipH = !edit.flipH; edit.crop = { ...c, x: 1 - c.x - c.w }; }
  else { edit.flipV = !edit.flipV; edit.crop = { ...c, y: 1 - c.y - c.h }; }
  $('#flip-h').setAttribute('aria-pressed', String(edit.flipH));
  $('#flip-v').setAttribute('aria-pressed', String(edit.flipV));
  pixelsChanged();
  requestLive();
}

// ---------------------------------------------------------------------------
// Readouts & status
// ---------------------------------------------------------------------------
function setStatus(state) {
  const led = $('#status-led');
  led.className = `led ${state === 'live' ? 'live' : state === 'ok' ? 'ok' : ''}`;
  $('#ro-status').textContent = state === 'live' ? 'RENDERING' : state === 'ok' ? 'SYNCED' : 'STANDBY';
  $('#download-all').disabled = state !== 'ok';
}

function updateReadouts() {
  if (!src.bitmap) return;
  const p = cropPx();
  $('#ro-src').textContent = `${src.bitmap.width}×${src.bitmap.height} · ${formatBytes(src.file.size)}`;
  $('#ro-crop').textContent = `${p.w}×${p.h}`;
  const done = activeViewports().map(v => results.get(v.id)).filter(r => r?.blob);
  $('#ro-out').textContent = done.length ? `${done.length} files · ${formatBytes(done.reduce((s, r) => s + r.blob.size, 0))}` : '—';

  const ratio = aspectRatioPx();
  $('#stage-tl').textContent = `EDITOR // ${src.name.slice(0, 28)}`;
  $('#stage-tr').textContent = `CROP ${p.w}×${p.h}${ratio ? ' · LOCK ' + ratioLabel(ratio) : ''}`;
  $('#stage-bl').textContent = `ROT ${edit.rot}° · STR ${edit.straighten > 0 ? '+' : ''}${edit.straighten}°${edit.flipH ? ' · FLIP-H' : ''}${edit.flipV ? ' · FLIP-V' : ''}`;
}
function ratioLabel(r) {
  const known = { 1: '1:1', 0.8: '4:5', 1.3333: '4:3', 1.5: '3:2', 1.7778: '16:9', 0.5625: '9:16', 1.25: '5:4', 0.75: '3:4', 0.6667: '2:3' };
  const hit = Object.entries(known).find(([k]) => Math.abs(+k - r) < 0.002);
  return hit ? hit[1] : r.toFixed(2);
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
const fileNameFor = (vp, r) => `${slug(src.name)}-${slug(vp.name)}-${r.width}x${r.height}.${fmt(out.format).ext}`;

function triggerDownload(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function downloadOne(vp) {
  const r = results.get(vp.id);
  if (r?.blob) triggerDownload(r.blob, fileNameFor(vp, r));
}

let jszip = null;
function loadJSZip() {
  jszip ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => { jszip = null; reject(new Error('JSZip unavailable')); };
    document.head.appendChild(s);
  });
  return jszip;
}
async function downloadAll() {
  const items = activeViewports().map(v => [v, results.get(v.id)]).filter(([, r]) => r?.blob);
  if (!items.length) return;
  const btn = $('#download-all');
  btn.disabled = true;
  try {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    for (const [v, r] of items) zip.file(fileNameFor(v, r), r.blob);
    triggerDownload(await zip.generateAsync({ type: 'blob' }), `${slug(src.name)}-viewports.zip`);
  } catch {
    for (const [v] of items) { downloadOne(v); await new Promise(r => setTimeout(r, 250)); }
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Lightbox: fits the screen; click the image to toggle 1:1
// ---------------------------------------------------------------------------
let lbUrl = null;
function openLightbox(vp) {
  const r = results.get(vp.id);
  if (!r?.blob) return;
  if (lbUrl) URL.revokeObjectURL(lbUrl);
  lbUrl = URL.createObjectURL(r.blob);
  const img = $('#lb-img');
  img.src = lbUrl;
  img.classList.remove('actual');
  $('#lb-title').textContent = `${vp.name.toUpperCase()} · ${r.width}×${r.height} · ${formatBytes(r.blob.size)} · click image for 1:1`;
  $('#lightbox').showModal();
}

// ---------------------------------------------------------------------------
// Source loading
// ---------------------------------------------------------------------------
async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      bmp = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('Unsupported image'));
        img.src = URL.createObjectURL(file);
      });
    } catch (err) { alert(err.message); return; }
  }
  src.bitmap?.close?.();
  src.file = file;
  src.bitmap = bmp;
  src.name = (file.name || 'image').replace(/\.[^.]+$/, '');
  const s = Math.min(1, PREVIEW_MAX / Math.max(bmp.width, bmp.height));
  src.preview = s < 1 ? resample(bmp, 0, 0, bmp.width, bmp.height, bmp.width * s, bmp.height * s) : bmp;

  edit = freshEdit();
  applyAspect(); // landing pages may start with a locked ratio
  results.clear();
  pixelsChanged();
  fullEdited = null;
  syncEditControls();

  $('#intake').hidden = true;
  $('#canvas-box').hidden = false;
  $('#reset-all').hidden = false;
  $('#stage').tabIndex = 0;
  buildDeck();
  requestAnimationFrame(requestLive);
}

async function loadSample() {
  const c = makeCanvas(2400, 1600);
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 1600);
  sky.addColorStop(0, '#0b0630'); sky.addColorStop(0.55, '#5b1a7a'); sky.addColorStop(0.75, '#ff4f8b'); sky.addColorStop(1, '#ffb36b');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 2400, 1600);
  for (let i = 0; i < 260; i++) { // stars
    ctx.fillStyle = `rgba(255,255,255,${0.3 + (i % 7) / 10})`;
    ctx.fillRect((i * 937) % 2400, (i * 571) % 800, 2 + (i % 3), 2 + (i % 3));
  }
  const sun = ctx.createLinearGradient(0, 700, 0, 1180); // synthwave sun
  sun.addColorStop(0, '#ffe66d'); sun.addColorStop(1, '#ff3dcb');
  ctx.fillStyle = sun;
  ctx.beginPath(); ctx.arc(1200, 1000, 360, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#5b1a7a';
  for (let y = 760, h = 6; y < 1000; y += 34, h += 4) ctx.fillRect(840, y, 720, h);
  ctx.fillStyle = '#12082e'; // mountains
  ctx.beginPath(); ctx.moveTo(0, 1060);
  [[220, 860], [430, 1010], [640, 820], [900, 1040], [1500, 1040], [1720, 840], [1950, 990], [2180, 870], [2400, 1020]].forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(2400, 1600); ctx.lineTo(0, 1600); ctx.fill();
  ctx.fillStyle = '#07031a'; ctx.fillRect(0, 1040, 2400, 560); // grid floor
  ctx.strokeStyle = '#40e8ff'; ctx.lineWidth = 3; ctx.shadowColor = '#40e8ff'; ctx.shadowBlur = 12;
  for (let i = -30; i <= 30; i++) { ctx.beginPath(); ctx.moveTo(1200 + i * 30, 1040); ctx.lineTo(1200 + i * 260, 1600); ctx.stroke(); }
  for (let y = 1040, g = 8; y < 1600; y += g, g *= 1.35) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(2400, y); ctx.stroke(); }
  ctx.shadowBlur = 0;
  loadFile(new File([await toBlob(c, 'image/jpeg', 0.94)], 'synthwave.jpg', { type: 'image/jpeg' }));
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function setRangeFill(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--p', `${p}%`);
}

function buildAdjustSliders() {
  const wrap = $('#adjust-sliders');
  for (const a of ADJUSTMENTS) {
    const div = document.createElement('div');
    div.className = 'slider';
    div.dataset.adj = a.key;
    div.innerHTML = '<label><span></span><output></output></label><input type="range">';
    $('span', div).textContent = a.label;
    const input = $('input', div);
    Object.assign(input, { min: a.min, max: a.max, step: a.step || 1, value: a.def });
    input.setAttribute('aria-label', a.label);
    if (!filterSupported && a.key !== 'vignette') input.disabled = true;
    input.addEventListener('input', () => {
      edit.adj[a.key] = +input.value;
      syncAdjust();
      pixelsChanged();
      requestLive();
    });
    input.addEventListener('dblclick', () => { edit.adj[a.key] = a.def; syncAdjust(); pixelsChanged(); requestLive(); });
    wrap.appendChild(div);
  }

  const looks = $('#look-chips');
  for (const name of Object.keys(LOOKS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.dataset.look = name;
    b.disabled = !filterSupported && name !== 'None';
    b.addEventListener('click', () => {
      edit.adj = { ...DEFAULT_ADJ, ...LOOKS[name] };
      syncAdjust();
      pixelsChanged();
      requestLive();
    });
    looks.appendChild(b);
  }
  $('#filter-note').hidden = filterSupported;
}

function syncAdjust() {
  for (const a of ADJUSTMENTS) {
    const div = $(`[data-adj="${a.key}"]`);
    const input = $('input', div);
    input.value = edit.adj[a.key];
    setRangeFill(input);
    const v = edit.adj[a.key];
    $('output', div).textContent = `${a.key === 'hue' && v > 0 ? '+' : ''}${v}${a.unit}`;
    div.classList.toggle('changed', v !== a.def);
  }
  const match = Object.entries(LOOKS).find(([, look]) =>
    ADJUSTMENTS.every(a => (look[a.key] ?? a.def) === edit.adj[a.key]));
  $$('#look-chips button').forEach(b => b.setAttribute('aria-pressed', String(match?.[0] === b.dataset.look)));
}

function syncAspectChips() {
  $$('#aspect-chips button').forEach(b => {
    const v = b.dataset.aspect;
    const on = v === edit.aspect || (typeof edit.aspect === 'number' && Math.abs(+v - edit.aspect) < 0.002);
    b.setAttribute('aria-pressed', String(on));
  });
}

function syncEditControls() {
  const st = $('[data-key="straighten"]');
  $('input', st).value = edit.straighten;
  setRangeFill($('input', st));
  $('output', st).textContent = `${edit.straighten > 0 ? '+' : ''}${edit.straighten}°`;
  st.classList.toggle('changed', edit.straighten !== 0);
  $('#flip-h').setAttribute('aria-pressed', String(edit.flipH));
  $('#flip-v').setAttribute('aria-pressed', String(edit.flipV));
  syncAspectChips();
  syncAdjust();
}

function buildFormatSeg() {
  const seg = $('#format-seg');
  for (const f of FORMATS) {
    if (f.type === 'image/avif' && !supportedFormats.has(f.type)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.format = f.type;
    b.textContent = f.label;
    b.setAttribute('role', 'radio');
    seg.appendChild(b);
  }
}

function syncOutControls() {
  const f = fmt(out.format);
  $$('[data-format]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.format === out.format)));
  $$('[data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === out.mode)));
  const q = $('#quality');
  q.value = out.quality; q.disabled = !f.lossy; setRangeFill(q);
  $('#quality-out').textContent = f.lossy ? `${out.quality}%` : 'N/A';
  $('#quality-field').hidden = out.mode !== 'quality';
  $('#png-note').hidden = f.lossy || out.mode !== 'quality';
  $('#target-field').hidden = out.mode !== 'target';
  $('#target-kb').value = out.targetKB;
  $('#allow-downscale').checked = out.allowDownscale;
  $('#fit').value = out.fit;
  $('#bg').value = out.bg;
  $('#transparent').checked = out.transparent && f.alpha;
  $('#transparent').disabled = !f.alpha;
  $('#bg').disabled = f.alpha && out.transparent;
  $('#no-upscale').checked = out.noUpscale;
}

function buildViewportToggles() {
  const wrap = $('#vp-toggles');
  wrap.textContent = '';
  let group = null;
  for (const vp of allViewports()) {
    const g = vp.group || 'Custom';
    if (g !== group) {
      group = g;
      const lbl = document.createElement('div');
      lbl.className = 'vp-group-label';
      lbl.textContent = g.toUpperCase();
      wrap.appendChild(lbl);
    }
    const row = document.createElement('label');
    row.className = 'vp-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = enabled.has(vp.id);
    input.addEventListener('change', () => {
      input.checked ? enabled.add(vp.id) : enabled.delete(vp.id);
      onViewportsChanged();
    });
    const box = document.createElement('span'); box.className = 'box';
    const name = document.createElement('span'); name.textContent = vp.name;
    const dims = document.createElement('small'); dims.textContent = vp.w == null ? 'crop' : `${vp.w}×${vp.h}`;
    row.append(input, box, name, dims);
    if (g === 'Custom') {
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'rm'; rm.textContent = '×';
      rm.setAttribute('aria-label', `Remove ${vp.name}`);
      rm.addEventListener('click', e => {
        e.preventDefault();
        out.custom = out.custom.filter(c => c.id !== vp.id);
        enabled.delete(vp.id);
        results.delete(vp.id);
        buildViewportToggles();
        onViewportsChanged();
      });
      row.appendChild(rm);
    } else {
      row.appendChild(document.createElement('span'));
    }
    wrap.appendChild(row);
  }
}

function onViewportsChanged() {
  saveOut();
  buildDeck();
  if (src.bitmap) requestAnimationFrame(requestLive);
}

function onOutChanged() {
  syncOutControls();
  saveOut();
  requestLive();
}

function bindControls() {
  // tabs
  $$('.tabs button').forEach(tab => tab.addEventListener('click', () => {
    const rail = tab.closest('.rail');
    $$('.tabs button', rail).forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      $(`#${t.dataset.tab}`).hidden = !on;
    });
  }));

  // file input / drop / paste
  const input = $('#file-input');
  input.addEventListener('change', () => { loadFile(input.files[0]); input.value = ''; });
  const stage = $('#stage');
  document.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('dragging'); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) stage.classList.remove('dragging'); });
  document.addEventListener('drop', e => {
    e.preventDefault();
    stage.classList.remove('dragging');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });
  $('#sample-btn').addEventListener('click', e => { e.preventDefault(); loadSample(); });

  // crop & transform
  $('#aspect-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-aspect]');
    if (!b) return;
    const v = b.dataset.aspect;
    edit.aspect = v === 'free' || v === 'orig' ? v : +v;
    syncAspectChips();
    if (src.bitmap) { applyAspect(); requestLive(); }
  });
  $('#crop-reset').addEventListener('click', () => {
    const adj = edit.adj;
    edit = { ...freshEdit(), adj };
    syncEditControls();
    pixelsChanged();
    requestLive();
  });
  $('#rot-left').addEventListener('click', () => src.bitmap && rotate(-1));
  $('#rot-right').addEventListener('click', () => src.bitmap && rotate(1));
  $('#flip-h').addEventListener('click', () => src.bitmap && flip('h'));
  $('#flip-v').addEventListener('click', () => src.bitmap && flip('v'));
  const st = $('[data-key="straighten"] input');
  st.addEventListener('input', () => {
    edit.straighten = +st.value;
    syncEditControls();
    pixelsChanged();
    requestLive();
  });
  st.addEventListener('dblclick', () => { edit.straighten = 0; syncEditControls(); pixelsChanged(); requestLive(); });
  $('#adjust-reset').addEventListener('click', () => { edit.adj = { ...DEFAULT_ADJ }; syncAdjust(); pixelsChanged(); requestLive(); });
  $('#reset-all').addEventListener('click', () => { edit = freshEdit(); syncEditControls(); pixelsChanged(); requestLive(); });

  // output
  $('#format-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-format]');
    if (!b) return;
    out.format = b.dataset.format;
    composeCache.clear();
    onOutChanged();
  });
  $$('[data-mode]').forEach(b => b.addEventListener('click', () => { out.mode = b.dataset.mode; onOutChanged(); }));
  $('#quality').addEventListener('input', e => { out.quality = +e.target.value; onOutChanged(); });
  $('#target-kb').addEventListener('input', e => { const v = +e.target.value; if (v > 0) { out.targetKB = v; saveOut(); requestLive(); } });
  $('#allow-downscale').addEventListener('change', e => { out.allowDownscale = e.target.checked; onOutChanged(); });
  $('#fit').addEventListener('change', e => { out.fit = e.target.value; onOutChanged(); });
  $('#bg').addEventListener('input', e => { out.bg = e.target.value; onOutChanged(); });
  $('#transparent').addEventListener('change', e => { out.transparent = e.target.checked; onOutChanged(); });
  $('#no-upscale').addEventListener('change', e => { out.noUpscale = e.target.checked; onOutChanged(); });

  $('#custom-form').addEventListener('submit', e => {
    e.preventDefault();
    const w = Math.round(+$('#custom-w').value), h = Math.round(+$('#custom-h').value);
    if (!(w > 0 && h > 0)) return;
    const name = $('#custom-name').value.trim() || `Custom ${w}×${h}`;
    const id = `custom-${Date.now().toString(36)}`;
    out.custom.push({ id, group: 'Custom', name, w, h, kind: 'frame' });
    enabled.add(id);
    e.target.reset();
    buildViewportToggles();
    onViewportsChanged();
  });

  // Guide: a slide-over drawer on desktop, inline content on small screens.
  const guide = $('#guide');
  const drawerMode = () => matchMedia('(min-width: 1001px) and (min-height: 601px)').matches;
  const setGuide = open => {
    guide.classList.toggle('open', open);
    $('#guide-toggle').setAttribute('aria-expanded', String(open));
    if (open) $('#guide-close').focus();
  };
  $('#guide-toggle').addEventListener('click', e => {
    if (!drawerMode()) return; // plain anchor link scrolls to the guide
    e.preventDefault();
    setGuide(!guide.classList.contains('open'));
  });
  $('#guide-close').addEventListener('click', () => { setGuide(false); $('#guide-toggle').focus(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && guide.classList.contains('open')) setGuide(false); });
  if (location.hash === '#guide' && drawerMode()) setGuide(true);

  $('#download-all').addEventListener('click', downloadAll);
  $('#lb-close').addEventListener('click', () => $('#lightbox').close());
  $('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') e.target.close(); });
  $('#lb-img').addEventListener('click', e => e.target.classList.toggle('actual'));

  // Re-layout the stage and screens whenever the window changes size.
  let resizeRaf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (!src.bitmap) { buildDeck(); return; }
      renderLive();
      for (const vp of activeViewports()) { const r = results.get(vp.id); if (r?.blob && !r.error) showEncoded(vp, r); }
    });
  }).observe(document.body);
}

// ---------------------------------------------------------------------------
async function init() {
  filterSupported = detectFilterSupport();
  buildAdjustSliders();
  buildViewportToggles();
  buildDeck();
  syncEditControls();
  await detectFormats();
  buildFormatSeg();
  syncOutControls();
  bindControls();
  bindCrop();
  if (pageConfig.tab) $(`[data-tab="${pageConfig.tab}"]`)?.click();
}

init();
