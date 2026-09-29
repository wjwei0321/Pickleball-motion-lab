// Pickleball Motion Lab — 瀏覽器端姿勢偵測（MediaPipe Pose Landmarker，IMAGE 模式逐格 + 裁切追蹤）
// 一般 script（不用 ES module）：Artifact 的 sandbox iframe 裡，module 與 crossOrigin 載入可能被擋而卡住
(function () {
'use strict';
const PoseLandmarker = window.MPVision && window.MPVision.PoseLandmarker;
const rel = (p) => new URL(p, document.baseURI).href;
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

const FPS = 30;
const CROP = 768;
// 模型檔拆成 ≤15 MB 的片段；副檔名用 .wasm 只是為了讓靜態主機（含 Artifact）以二進位原樣提供，內容是 .task 模型
const MODELS = {
  heavy: ['models/heavy.part0.wasm', 'models/heavy.part1.wasm', 'models/heavy.part2.wasm'],
  full: ['models/full.part0.wasm'],
};
let landmarker = null, loadedKind = null, delegateUsed = null;

const SIZES = { heavy: 30664242, full: 9398198 };
// 逐塊讀取並回報 MB；30 秒沒有收到任何資料就判定卡住
async function fetchModel(kind, onStatus) {
  const parts = MODELS[kind];
  const bufs = [];
  let total = 0;
  const all = SIZES[kind];
  for (let i = 0; i < parts.length; i++) {
    const ctl = new AbortController();
    let idle;
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(), 30000); };
    arm();
    let r;
    try { r = await fetch(rel(parts[i]), { signal: ctl.signal }); }
    catch (e) { clearTimeout(idle); throw new Error(`模型下載失敗：${ctl.signal.aborted ? '30 秒沒有回應，網路可能太慢或被擋' : e.message}`); }
    if (!r.ok) { clearTimeout(idle); throw new Error(`模型檔讀取失敗（HTTP ${r.status}）`); }
    const chunks = [];
    let got = 0;
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader();
      for (;;) {
        let x;
        try { x = await rd.read(); } catch (e) { clearTimeout(idle); throw new Error(ctl.signal.aborted ? '模型下載停住超過 30 秒，請檢查網路後重試' : `模型下載中斷：${e.message}`); }
        if (x.done) break;
        arm(); chunks.push(x.value); got += x.value.length;
        const done = total + got;
        onStatus && onStatus(`下載模型 ${(done / 1048576).toFixed(1)} / ${(all / 1048576).toFixed(1)} MB`, Math.min(1, done / all));
      }
    } else {
      chunks.push(new Uint8Array(await r.arrayBuffer()));
    }
    clearTimeout(idle);
    const len = chunks.reduce((a, c) => a + c.length, 0), b = new Uint8Array(len);
    let o = 0; for (const c of chunks) { b.set(c, o); o += c.length; }
    bufs.push(b); total += b.length;
  }
  const out = new Uint8Array(total);
  let o = 0; for (const b of bufs) { out.set(b, o); o += b.length; }
  return out;
}

let pending = null, pendingKind = null;
const listeners = new Set();
function init(kind, onStatus) {
  if (landmarker && loadedKind === kind) return Promise.resolve({ delegate: delegateUsed });
  if (onStatus) listeners.add(onStatus);
  if (pending && pendingKind === kind) return pending;
  const report = (m, f) => listeners.forEach((fn) => fn(m, f));
  pendingKind = kind;
  pending = load(kind, report).finally(() => { pending = null; listeners.clear(); });
  return pending;
}
async function load(kind, onStatus) {
  if (landmarker) { landmarker.close(); landmarker = null; }
  const buf = await fetchModel(kind, onStatus);
  onStatus && onStatus('啟動偵測引擎', 1);
  if (!PoseLandmarker) throw new Error('偵測程式庫沒有載入（vendor/mediapipe/vision_bundle.js）');
  if (!window.__MPFactory) throw new Error('WASM 載入器沒有載入（vendor/mediapipe/wasm/vision_wasm_internal.js）');
  if (typeof WebAssembly !== 'object') throw new Error('這個瀏覽器不支援 WebAssembly');
  const fileset = {
    wasmLoaderPath: rel('vendor/mediapipe/wasm/vision_wasm_internal.js'),
    wasmBinaryPath: rel('vendor/mediapipe/wasm/vision_wasm_internal.wasm'),
  };
  const opts = (delegate) => ({
    baseOptions: { modelAssetBuffer: buf, delegate },
    runningMode: 'IMAGE', numPoses: 2,
    minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  try {
    landmarker = await withTimeout(PoseLandmarker.createFromOptions(fileset, opts('GPU')), 45000, 'GPU 啟動逾時');
    delegateUsed = 'GPU';
  } catch (e) {
    console.warn('GPU 失敗，改用 CPU', e);
    onStatus && onStatus('GPU 無法使用，改用 CPU 啟動', 1);
    try {
      landmarker = await withTimeout(PoseLandmarker.createFromOptions(fileset, opts('CPU')), 60000, '啟動逾時');
    } catch (e2) {
      console.error(e2);
      const msg = String(e2 && e2.message || e2);
      if (/Content Security|unsafe-eval|CompileError/i.test(msg)) throw new Error('這個網頁環境不允許執行 WebAssembly（偵測引擎需要），請改用本機或自己的網站開啟');
      throw new Error(`偵測引擎無法啟動：${msg.slice(0, 120)}`);
    }
    delegateUsed = 'CPU';
  }
  loadedKind = kind;
  return { delegate: delegateUsed };
}

function seek(video, t) {
  const target = Math.min(t, Math.max(0, video.duration - 0.001));
  if (Math.abs(video.currentTime - target) < 1e-4 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    let to;
    const done = () => { clearTimeout(to); video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    to = setTimeout(done, 4000);
    video.currentTime = target;
  });
}

const frameCv = document.createElement('canvas');
const frameCtx = frameCv.getContext('2d', { willReadFrequently: false });
const cropCv = document.createElement('canvas');
cropCv.width = cropCv.height = CROP;
const cropCtx = cropCv.getContext('2d');

function drawFrame(video) {
  const W = video.videoWidth, H = video.videoHeight;
  const s = Math.min(1, 1920 / Math.max(W, H));
  const w = Math.round(W * s), h = Math.round(H * s);
  if (frameCv.width !== w || frameCv.height !== h) { frameCv.width = w; frameCv.height = h; }
  frameCtx.drawImage(video, 0, 0, w, h);
  return s;
}

// 在影格（frameCv 座標）的正方形區域偵測，回傳換算回「原影片像素」的結果
function detectRegion(cx, cy, side, s0, numPoses) {
  const sx = cx - side / 2, sy = cy - side / 2;
  cropCtx.fillStyle = '#000';
  cropCtx.fillRect(0, 0, CROP, CROP);
  cropCtx.drawImage(frameCv, sx, sy, side, side, 0, 0, CROP, CROP);
  const res = landmarker.detect(cropCv);
  const out = [];
  for (let k = 0; k < res.landmarks.length && k < numPoses; k++) {
    const lm = res.landmarks[k], wl = res.worldLandmarks[k];
    const img = new Float32Array(99), world = new Float32Array(99);
    for (let j = 0; j < 33; j++) {
      img[j * 3] = (sx + lm[j].x * side) / s0;
      img[j * 3 + 1] = (sy + lm[j].y * side) / s0;
      img[j * 3 + 2] = lm[j].visibility ?? 1;
      // three.js 慣例：y、z 乘 −1
      world[j * 3] = wl[j].x; world[j * 3 + 1] = -wl[j].y; world[j * 3 + 2] = -wl[j].z;
    }
    out.push({ img, world });
  }
  return out;
}

function boxOf(img) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let j = 0; j < 33; j++) {
    if (img[j * 3 + 2] < 0.2 && j !== 23 && j !== 24) continue;
    const x = img[j * 3], y = img[j * 3 + 1];
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const hx = (img[23 * 3] + img[24 * 3]) / 2, hy = (img[23 * 3 + 1] + img[24 * 3 + 1]) / 2;
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, long: Math.max(x1 - x0, y1 - y0), hx, hy, h: y1 - y0 };
}

// 找畫面中的人（最多 4 位）：整張 + 重疊分塊
async function findCandidates(video, t) {
  await seek(video, t);
  const s0 = drawFrame(video);
  const w = frameCv.width, h = frameCv.height;
  landmarker.setOptions({ numPoses: 4 });
  const regions = [[w / 2, h / 2, Math.max(w, h)]];
  const side = Math.min(w, h) * 0.7;
  for (const fy of [0.3, 0.7]) for (const fx of [0.2, 0.5, 0.8]) regions.push([w * fx, h * fy, side]);
  if (h > w) for (const fy of [0.2, 0.5, 0.8]) regions.push([w / 2, h * fy, w * 0.8]);
  const found = [];
  for (const [cx, cy, sd] of regions) {
    for (const p of detectRegion(cx, cy, sd, s0, 4)) {
      const b = boxOf(p.img);
      if (b.h < 20) continue;
      const dup = found.find((q) => Math.hypot(q.box.hx - b.hx, q.box.hy - b.hy) < Math.max(q.box.h, b.h) * 0.3);
      if (dup) { if (b.h > dup.box.h) { dup.box = b; dup.img = p.img; } continue; }
      found.push({ box: b, img: p.img });
    }
  }
  landmarker.setOptions({ numPoses: 2 });
  found.sort((a, b) => a.box.cx - b.box.cx);
  return found.slice(0, 6);
}

async function grabFrame(video, t, canvas, crop) {
  await seek(video, t);
  const ctx = canvas.getContext('2d');
  if (crop) ctx.drawImage(video, crop.x, crop.y, crop.side, crop.side, 0, 0, canvas.width, canvas.height);
  else ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

/**
 * 逐格追蹤目標球員
 * @param seed {cx, cy, long} 原影片像素，使用者在 t0 選的人
 */
async function track(video, seed, t0, onProgress, shouldStop) {
  const N = Math.max(1, Math.floor(video.duration * FPS));
  const img = new Array(N), world = new Array(N), detected = new Uint8Array(N);
  const f0 = Math.min(N - 1, Math.max(0, Math.round(t0 * FPS)));
  let done = 0; const tStart = performance.now();
  let jumps = 0, retries = 0;

  async function pass(from, to, step, init) {
    let st = { ...init, lostFor: 0, prev: null, last: init.last || null };
    for (let f = from; step > 0 ? f < to : f > to; f += step) {
      if (shouldStop && shouldStop()) throw new Error('已取消');
      await seek(video, f / FPS);
      const s0 = drawFrame(video);
      const minSide = 260 * s0;
      const tryAt = (cx, cy, side) => detectRegion(cx * s0, cy * s0, Math.max(side * s0, minSide), s0, 2);
      let cands = tryAt(st.cx, st.cy, st.side);
      if (!cands.length) { retries++; cands = tryAt(st.lastCx ?? st.cx, st.lastCy ?? st.cy, st.side * (st.lostFor % 5 === 4 ? 2.6 : 1.7)); }
      let pick = null;
      if (cands.length) {
        const px = st.lastHx, py = st.lastHy;
        let best = null, bd = 1e9;
        for (const c of cands) {
          const b = boxOf(c.img);
          const d = px == null ? 0 : Math.hypot(b.hx - px, b.hy - py);
          if (d < bd) { bd = d; best = { ...c, b }; }
        }
        const gap = Math.max(1, st.lostFor + 1);
        const lim = 0.4 * (st.lastH || best.b.h) * Math.max(1, gap * 0.5);
        if (px == null || bd <= lim) pick = best; else jumps++;
      }
      if (pick) {
        img[f] = pick.img; world[f] = pick.world; detected[f] = 1;
        const b = pick.b;
        st.cx = b.cx; st.cy = b.cy; st.side = Math.max(b.long * 2.2, 260);
        st.lastCx = b.cx; st.lastCy = b.cy; st.lastHx = b.hx; st.lastHy = b.hy; st.lastH = b.h; st.lostFor = 0;
      } else st.lostFor++;
      done++;
      if (done % 3 === 0 || done === N) {
        const el = (performance.now() - tStart) / 1000;
        onProgress && onProgress(done, N, el / done * (N - done));
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return st;
  }
  const init = { cx: seed.cx, cy: seed.cy, side: Math.max(seed.long * 2.2, 260), lastHx: seed.hx, lastHy: seed.hy, lastH: seed.h, lastCx: seed.cx, lastCy: seed.cy };
  await pass(f0, N, 1, init);
  // 從選人的那一格往回追
  const st0 = { ...init };
  if (detected[f0]) { const b = boxOf(img[f0]); Object.assign(st0, { cx: b.cx, cy: b.cy, side: Math.max(b.long * 2.2, 260), lastHx: b.hx, lastHy: b.hy, lastH: b.h }); }
  await pass(f0 - 1, -1, -1, st0);

  // 插值補齊
  const got = []; for (let f = 0; f < N; f++) if (detected[f]) got.push(f);
  if (!got.length) throw new Error('整支影片都沒有偵測到這位球員');
  let filled = 0;
  for (let f = 0; f < N; f++) {
    if (detected[f]) continue;
    filled++;
    let a = -1, b = -1;
    for (let g = f - 1; g >= 0; g--) if (detected[g]) { a = g; break; }
    for (let g = f + 1; g < N; g++) if (detected[g]) { b = g; break; }
    if (a < 0) { img[f] = new Float32Array(img[b]); world[f] = new Float32Array(world[b]); continue; }
    if (b < 0) { img[f] = new Float32Array(img[a]); world[f] = new Float32Array(world[a]); continue; }
    const t = (f - a) / (b - a), I = new Float32Array(99), Wd = new Float32Array(99);
    for (let i = 0; i < 99; i++) { I[i] = img[a][i] + (img[b][i] - img[a][i]) * t; Wd[i] = world[a][i] + (world[b][i] - world[a][i]) * t; }
    img[f] = I; world[f] = Wd;
  }
  return { img, world, detected, N, filled, jumps, retries, W: video.videoWidth, H: video.videoHeight, seconds: (performance.now() - tStart) / 1000 };
}

window.PBPose = { init, findCandidates, track, seek, grabFrame, get delegate() { return delegateUsed; } };
window.dispatchEvent(new Event('pbpose-ready'));
})();
