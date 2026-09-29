/* Pickleball Motion Lab — 分析核心（找擊球、球種、指標、診斷、矯正骨架）
 * 座標：three.js 慣例，y 朝上；每格 33 個關節 × (x,y,z)，單位公尺，以骨盆為原點。
 */
(function () {
  'use strict';
  const FPS = 30;
  const J = { nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lPi: 17, rPi: 18, lIn: 19, rIn: 20,
    lTh: 21, rTh: 22, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lHe: 29, rHe: 30, lFt: 31, rFt: 32 };
  // 網頁端只用這 19 個關節
  const KEEP = [0, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

  // ---------- 向量 ----------
  const V = {
    get: (F, j) => [F[j * 3], F[j * 3 + 1], F[j * 3 + 2]],
    set: (F, j, p) => { F[j * 3] = p[0]; F[j * 3 + 1] = p[1]; F[j * 3 + 2] = p[2]; },
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    mid: (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    horiz: (a) => [a[0], 0, a[2]],
    angle: (a, b) => { const d = V.dot(V.norm(a), V.norm(b)); return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI; },
    // Rodrigues：p 繞單位軸 k 旋轉 ang（弧度）
    rot: (p, k, ang) => {
      const c = Math.cos(ang), s = Math.sin(ang), kd = V.dot(k, p), kx = V.cross(k, p);
      return [p[0] * c + kx[0] * s + k[0] * kd * (1 - c), p[1] * c + kx[1] * s + k[1] * kd * (1 - c), p[2] * c + kx[2] * s + k[2] * kd * (1 - c)];
    },
  };
  const UP = [0, 1, 0];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const bump = (t, a, m, b) => (t <= m ? smoothstep(a, m, t) : 1 - smoothstep(m, b, t));
  const median = (arr) => { const s = arr.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
  const mean = (arr) => { const s = arr.filter(Number.isFinite); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN; };

  // ---------- 單格量測 ----------
  const shMid = (F) => V.mid(V.get(F, J.lSh), V.get(F, J.rSh));
  const hipMid = (F) => V.mid(V.get(F, J.lHip), V.get(F, J.rHip));
  function fwdOf(F) {
    const f = V.horiz(V.sub(V.get(F, J.nose), shMid(F)));
    if (V.len(f) > 1e-4) return V.norm(f);
    // 備援：肩線的法向量
    return V.norm(V.cross(V.horiz(V.sub(V.get(F, J.lSh), V.get(F, J.rSh))), UP));
  }
  function fwdAround(S, c) {
    let acc = [0, 0, 0];
    for (let f = Math.max(0, c - 3); f <= Math.min(S.length - 1, c + 3); f++) acc = V.add(acc, fwdOf(S[f]));
    return V.norm(V.horiz(acc));
  }
  const leanOf = (F) => V.angle(V.sub(shMid(F), hipMid(F)), UP);
  function kneeAng(F, side) {
    const h = V.get(F, side === 'L' ? J.lHip : J.rHip), k = V.get(F, side === 'L' ? J.lKn : J.rKn), a = V.get(F, side === 'L' ? J.lAn : J.rAn);
    return V.angle(V.sub(h, k), V.sub(a, k));
  }
  const kneeMinOf = (F) => Math.min(kneeAng(F, 'L'), kneeAng(F, 'R'));
  function stanceOf(F) {
    const aw = V.len(V.horiz(V.sub(V.get(F, J.lAn), V.get(F, J.rAn))));
    const sw = V.len(V.horiz(V.sub(V.get(F, J.lSh), V.get(F, J.rSh))));
    return sw > 0.05 ? aw / sw : NaN;
  }
  const shoulderYaw = (F) => { const d = V.sub(V.get(F, J.lSh), V.get(F, J.rSh)); return Math.atan2(d[2], d[0]) * 180 / Math.PI; };
  const angDiff = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

  function handIdx(hand) {
    return hand === 'L'
      ? { sh: J.lSh, el: J.lEl, wr: J.lWr, pi: J.lPi, in: J.lIn, th: J.lTh, osh: J.rSh, oel: J.rEl, owr: J.rWr, opi: J.rPi, oin: J.rIn, oth: J.rTh }
      : { sh: J.rSh, el: J.rEl, wr: J.rWr, pi: J.rPi, in: J.rIn, th: J.rTh, osh: J.lSh, oel: J.lEl, owr: J.lWr, opi: J.lPi, oin: J.lIn, oth: J.lTh };
  }
  // 持拍側的水平單位向量
  const racketSide = (F, H) => V.norm(V.horiz(V.sub(V.get(F, H.sh), V.get(F, H.osh))));

  // ---------- 前處理 ----------
  function movingAvg(frames, win) {
    const n = frames.length, h = win >> 1, out = new Array(n);
    for (let f = 0; f < n; f++) {
      const o = new Float32Array(99);
      const a = Math.max(0, f - h), b = Math.min(n - 1, f + h), m = b - a + 1;
      for (let g = a; g <= b; g++) { const F = frames[g]; for (let i = 0; i < 99; i++) o[i] += F[i]; }
      for (let i = 0; i < 99; i++) o[i] /= m;
      out[f] = o;
    }
    return out;
  }
  function speedSeries(S, j) {
    const n = S.length, sp = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      const a = Math.max(0, f - 1), b = Math.min(n - 1, f + 1);
      if (b === a) continue;
      sp[f] = V.len(V.sub(V.get(S[b], j), V.get(S[a], j))) * FPS / (b - a);
    }
    return sp;
  }

  // ---------- 找擊球 ----------
  function findPeaks(sp, lo) {
    const peaks = [];
    for (let f = 0; f < sp.length; f++) {
      if (sp[f] < lo) continue;
      let isMax = true;
      for (let g = Math.max(0, f - 8); g <= Math.min(sp.length - 1, f + 8); g++) if (sp[g] > sp[f] || (sp[g] === sp[f] && g < f)) { isMax = false; break; }
      if (isMax) peaks.push(f);
    }
    return peaks;
  }

  function detectHits(S, handPref, imgHipMotion) {
    const spL = speedSeries(S, J.lWr), spR = speedSeries(S, J.rWr);
    let hand = handPref;
    let handAuto = false;
    if (hand !== 'L' && hand !== 'R') {
      handAuto = true;
      let score = 0;
      for (const p of findPeaks(spR, 2.2)) score += spR[p] - spL[p];
      for (const p of findPeaks(spL, 2.2)) score -= spL[p] - spR[p];
      hand = score >= 0 ? 'R' : 'L';
    }
    const sp = hand === 'L' ? spL : spR, osp = hand === 'L' ? spR : spL;
    const raw = findPeaks(sp, 1.2);
    const hits = [];
    for (const p of raw) {
      const v = sp[p];
      const big = v >= 3;
      if (!big) {
        // 輕打：要明顯高於附近的動作量，排除單純移動拍子
        const win = [];
        for (let g = Math.max(0, p - 30); g <= Math.min(sp.length - 1, p + 30); g++) win.push(sp[g]);
        if (v < 1.8 * median(win)) continue;
      }
      if (v < 0.85 * osp[p]) continue; // 另一隻手動得更快，不是持拍手在擊球
      const prev = hits[hits.length - 1];
      if (prev && p - prev.peak < 12) { if (v > prev.speed) hits.pop(); else continue; }
      hits.push({ peak: p, speed: v, big });
    }
    for (const h of hits) { h.c = Math.min(S.length - 1, h.peak + 1); h.estimated = true; }
    return { hits, hand, handAuto, spL, spR };
  }

  // ---------- 球種 ----------
  const TYPES = {
    serve: { name: '發球', short: '發球', pre: 32, post: 16 },
    drive: { name: '抽球', short: '抽球', pre: 26, post: 16 },
    dink: { name: '放小球', short: '小球', pre: 20, post: 12 },
    drop: { name: '第三拍吊球', short: '吊球', pre: 26, post: 16 },
    volley: { name: '截擊', short: '截擊', pre: 20, post: 12 },
    overhead: { name: '高壓扣殺', short: '扣殺', pre: 26, post: 16 },
    lob: { name: '挑高球', short: '挑高', pre: 26, post: 16 },
  };

  function classify(S, hit, H, idx, hits, hipMotion) {
    const c = hit.c, F = S[c], n = S.length;
    const sm = shMid(F), hm = hipMid(F), navelY = hm[1] + 0.10;
    const wr = V.get(F, H.wr), owr = V.get(F, H.owr), nose = V.get(F, J.nose);
    const side = racketSide(F, H);
    const lat = V.dot(V.horiz(V.sub(wr, sm)), side);
    const a = Math.max(0, c - 2), b = Math.min(n - 1, c + 2);
    const vy = (S[b][H.wr * 3 + 1] - S[a][H.wr * 3 + 1]) * FPS / Math.max(1, b - a);
    let bs = 0;
    for (let f = Math.max(0, c - 15); f <= c; f++) bs = Math.max(bs, V.len(V.sub(V.get(S[f], H.wr), wr)));
    let topAfter = -9;
    for (let f = c; f <= Math.min(n - 1, c + 12); f++) topAfter = Math.max(topAfter, S[f][H.wr * 3 + 1] - sm[1]);
    const backhand = lat < -0.02;
    const twoHanded = backhand && V.len(V.sub(wr, owr)) < 0.18;
    const prevHit = idx > 0 ? hits[idx - 1].c : -999;
    const stillBefore = hipMotion ? hipMotion(Math.max(0, c - 45), Math.max(0, c - 12)) < 0.15 : false;

    let type;
    if (wr[1] > nose[1] + 0.05 && hit.speed >= 2.5) type = 'overhead';
    else if ((idx === 0 || c - prevHit > 60) && stillBefore && wr[1] < navelY + 0.05 && vy > 0 && hit.speed >= 2.2 && bs >= 0.35) type = 'serve';
    else if (hit.speed >= 2.2 && vy / hit.speed > 0.6 && topAfter > 0.15 && wr[1] < sm[1] - 0.1) type = 'lob';
    else if (hit.speed >= 3) type = 'drive';
    else if (wr[1] >= sm[1] - 0.35 && bs <= 0.35) type = 'volley';
    else if (bs > 0.30 && vy > 0 && wr[1] < navelY + 0.10) type = 'drop';
    else type = 'dink';
    return { type, backhand, twoHanded };
  }

  // ---------- 指標 ----------
  const METRICS = {
    lean: { label: '上身前傾', unit: '°', dec: 0 },
    knee: { label: '擊球時膝蓋', unit: '°', dec: 0 },
    front: { label: '擊球點在身前', unit: 'cm', dec: 0 },
    backswing: { label: '引拍幅度', unit: 'cm', dec: 0 },
    turn: { label: '轉肩', unit: '°', dec: 0 },
    ready: { label: '準備時拍子高度', unit: 'cm', dec: 0 },
    offhand: { label: '非持拍手', unit: 'cm', dec: 0 },
    follow: { label: '收拍最高點', unit: 'cm', dec: 0 },
    serveH: { label: '發球擊球點高度', unit: 'cm', dec: 0 },
    serveVy: { label: '發球揮拍方向', unit: 'm/s', dec: 1 },
    stance: { label: '站距', unit: '×肩寬', dec: 2 },
  };
  const SOFT = (t) => t === 'dink' || t === 'drop';
  function target(metric, type) {
    switch (metric) {
      case 'lean': return (SOFT(type) || type === 'serve') ? '≤ 20°' : '≤ 15°';
      case 'knee': return (SOFT(type) || type === 'volley') ? '120–145°' : type === 'serve' ? '125–155°' : '125–150°';
      case 'front': return '≥ 20 cm';
      case 'backswing': return type === 'drive' ? '50–90 cm' : '≤ 30 cm';
      case 'turn': return '≥ 40°';
      case 'ready': return '肩下 10–35 cm';
      case 'offhand': return '≥ −5 cm';
      case 'follow': return type === 'drive' ? '收到非持拍側' : '≤ 肩膀高度';
      case 'serveH': return '< 0（腰以下）';
      case 'serveVy': return '> 0（由下往上）';
      case 'stance': return '1.3–1.8×';
    }
    return '';
  }
  function status(metric, type, v, extra) {
    if (!Number.isFinite(v)) return 'na';
    switch (metric) {
      case 'lean': { const lim = (SOFT(type) || type === 'serve') ? 20 : 15; return v <= lim ? 'ok' : v <= 25 ? 'warn' : 'bad'; }
      case 'knee': {
        const [lo, hi] = (SOFT(type) || type === 'volley') ? [120, 145] : type === 'serve' ? [125, 155] : [125, 150];
        if (v > 155) return 'bad';
        return v >= lo && v <= hi ? 'ok' : 'warn';
      }
      case 'front': return v >= 20 ? 'ok' : v >= 5 ? 'warn' : 'bad';
      case 'backswing':
        if (type === 'drive') return v >= 50 && v <= 90 ? 'ok' : 'warn';
        return v <= 30 ? 'ok' : v <= 45 ? 'warn' : 'bad';
      case 'turn': return v >= 40 ? 'ok' : v >= 25 ? 'warn' : 'bad';
      case 'ready': {
        if (v < -45) return 'bad';
        const inFront = extra && Number.isFinite(extra.readyF) ? extra.readyF >= 5 : true;
        return v >= -35 && v <= -10 && inFront ? 'ok' : 'warn';
      }
      case 'offhand': return v >= -5 ? 'ok' : v >= -15 ? 'warn' : 'bad';
      case 'follow':
        if (type === 'drive') return extra && extra.followCross ? 'ok' : 'warn';
        if (v > 0) return 'bad';
        return extra && extra.followAng > 60 ? 'warn' : 'ok';
      case 'serveH': return v < 0 ? 'ok' : 'bad';
      case 'serveVy': return v > 0 ? 'ok' : 'warn';
      case 'stance': return v < 1.1 ? 'bad' : v >= 1.3 && v <= 1.8 ? 'ok' : 'warn';
    }
    return 'na';
  }
  function applies(metric, type) {
    switch (metric) {
      case 'backswing': return type === 'dink' || type === 'volley' || type === 'drive';
      case 'turn': return type === 'drive';
      case 'offhand': return type !== 'serve';
      case 'follow': return type === 'dink' || type === 'drop' || type === 'drive';
      case 'serveH': case 'serveVy': return type === 'serve';
    }
    return true;
  }

  function shotMetrics(S, shot, H, prevC, nextC) {
    const n = S.length, c = shot.c, F = S[c], type = shot.type;
    const sm = shMid(F), hm = hipMid(F), fwd = fwdAround(S, c), side = racketSide(F, H);
    const wr = V.get(F, H.wr);
    const m = {}, x = { fwd, side };
    m.lean = leanOf(F);
    let kn = 999; for (let f = Math.max(0, c - 15); f <= c; f++) kn = Math.min(kn, kneeMinOf(S[f]));
    m.knee = kn;
    m.front = V.dot(V.horiz(V.sub(wr, hm)), fwd) * 100;
    let bs = 0; for (let f = Math.max(0, c - 15); f <= c; f++) bs = Math.max(bs, V.len(V.sub(V.get(S[f], H.wr), wr)));
    m.backswing = bs * 100;
    let turn = 0; const y0 = shoulderYaw(F);
    for (let f = Math.max(0, c - 20); f <= Math.max(0, c - 3); f++) turn = Math.max(turn, Math.abs(angDiff(shoulderYaw(S[f]), y0)));
    m.turn = turn;
    // 準備姿勢：前一拍 +15 到這一拍 −15
    const r0 = prevC != null ? prevC + 15 : Math.max(0, c - 60), r1 = c - 15;
    if (r1 - r0 >= 5) {
      const hs = [], fs = [];
      for (let f = Math.max(0, r0); f <= r1; f++) {
        const G = S[f], s2 = shMid(G), w2 = V.get(G, H.wr);
        hs.push((w2[1] - s2[1]) * 100); fs.push(V.dot(V.horiz(V.sub(w2, s2)), fwdOf(G)) * 100);
      }
      m.ready = mean(hs); x.readyF = mean(fs);
    } else { m.ready = NaN; x.readyF = NaN; }
    m.offhand = V.dot(V.horiz(V.sub(V.get(F, H.owr), sm)), fwd) * 100;
    // 收拍
    const f1 = Math.min(n - 1, c + 2), f2 = Math.min(n - 1, c + 12);
    const disp = V.sub(V.get(S[f2], H.wr), V.get(S[f1], H.wr));
    x.followAng = V.len(V.horiz(disp)) > 0.02 ? V.angle(V.horiz(disp), fwd) : 0;
    let top = -9; for (let f = f1; f <= f2; f++) top = Math.max(top, S[f][H.wr * 3 + 1] - shMid(S[f])[1]);
    const endLat = V.dot(V.horiz(V.sub(V.get(S[f2], H.wr), shMid(S[f2]))), racketSide(S[f2], H));
    x.followCross = endLat < 0.05;
    x.followLat = endLat * 100;
    m.follow = type === 'drive' ? endLat * 100 : top * 100;
    m.serveH = (wr[1] - (hm[1] + 0.10)) * 100;
    const a = Math.max(0, c - 2), b = Math.min(n - 1, c + 2);
    m.serveVy = (S[b][H.wr * 3 + 1] - S[a][H.wr * 3 + 1]) * FPS / Math.max(1, b - a);
    m.stance = stanceOf(F);
    const st = {};
    for (const k of Object.keys(METRICS)) {
      if (!applies(k, type)) { m[k] = NaN; st[k] = 'na'; continue; }
      st[k] = status(k, type, m[k], x);
    }
    return { m, st, x };
  }

  // ---------- 診斷 ----------
  const PROBLEMS = [
    { id: 'bend', metric: 'lean', weight: 1.0, view: 'side', parts: ['torso'],
      title: '用彎腰代替蹲低', short: '彎腰',
      why: '上半身往前折，拍面很難穩住，小球容易飄高，對手就有機會往下扣。',
      fix: '屁股往後坐、膝蓋彎，讓胸口保持「抬頭看對手」的角度；用腿把身體降下去，不是用腰。',
      drill: '廚房線對放小球 30 球：每一球擊球時停一下，確認背是直的、膝蓋有彎，再回到準備姿勢。' },
    { id: 'legs', metric: 'knee', weight: 0.9, view: 'side', parts: ['legs'],
      title: '腿打太直、重心太高', short: '腿太直',
      why: '腿伸直時只能用手去撈低球，力道和方向都不穩，也來不及移動。',
      fix: '兩腳比肩寬一點、膝蓋像坐高腳椅一樣微彎，擊球時用腿降低高度。',
      drill: '靠牆半蹲 3 組 × 30 秒；接著對放小球 20 球，每球都要感覺大腿有出力。' },
    { id: 'late', metric: 'front', weight: 1.0, view: 'side', parts: ['arm', 'paddle'],
      title: '擊球點太晚、在身體旁邊才打', short: '擊球太晚',
      why: '球跑到身體旁邊或後面才碰到，拍面角度來不及調整，方向和深度都會亂。',
      fix: '拍子提早放在身體前方等球，想像在身前一個手臂距離的地方「接」球。',
      drill: '截擊牆練習 3 組 × 20 球：拍子不准退到肚子後面，每球都在身前碰到。' },
    { id: 'swing', metric: 'backswing', weight: 0.8, view: 'side', parts: ['arm', 'paddle'],
      title: '小球／截擊引拍太大', short: '引拍太大',
      why: '小動作的球時間很短，引拍太大會來不及，而且力量難控制，球容易出界或太高。',
      fix: '拍子幾乎不往後拉，用肩膀帶手「推」出去，手腕固定。',
      drill: '雙人快速截擊 3 組 × 1 分鐘：拍子始終留在自己視線範圍內。' },
    { id: 'turn', metric: 'turn', weight: 0.8, view: 'top', parts: ['torso'],
      title: '抽球沒有轉肩', short: '沒轉肩',
      why: '只用手臂打，力量小又容易受傷；轉身才能用到身體的力量，球又快又穩。',
      fix: '看到球來先轉肩膀，讓持拍側的肩膀往後，揮拍時再把肩膀轉回來。',
      drill: '底線抽球 30 球：每球先說「轉」再揮拍，確認非持拍手指向來球。' },
    { id: 'drop', metric: 'ready', weight: 0.9, view: 'front', parts: ['arm', 'paddle'],
      title: '拍子在兩拍之間掉到腰下', short: '拍子掉下去',
      why: '拍子掉下去，下一球來時要花時間再舉起來，快速截擊或對手打身體時會來不及。',
      fix: '每打完一拍就把拍頭收回胸口前方、拍頭微微朝上，像拿著一面盾牌。',
      drill: '廚房線對放小球 30 球：每球打完回到拍子在胸前，夥伴隨時可以突然抽球測試。' },
    { id: 'offhand', metric: 'offhand', weight: 0.5, view: 'front', parts: ['offarm'],
      title: '非持拍手甩到身後', short: '手甩後面',
      why: '另一隻手甩到後面，身體會跟著轉開，平衡變差，下一拍準備也會慢。',
      fix: '非持拍手留在身體前方、大約胸口高度，像在幫忙扶著球拍。',
      drill: '空拍揮拍 2 組 × 20 下：非持拍手輕扶拍喉開始，擊球後手還在身前。' },
    { id: 'follow', metric: 'follow', weight: 0.6, view: 'side', parts: ['arm', 'paddle'],
      title: '小球收拍太大、拍子收過肩', short: '收拍太大',
      why: '小球收拍太高代表出手太用力或往上撈，球容易彈高、落點太深。',
      fix: '往目標方向輕輕往前、往上送，收在胸口高度就停。',
      drill: '對放小球 30 球：收拍後拍頭停在胸前，數一秒再回準備位置。' },
    { id: 'serve', metric: 'serveH', weight: 1.0, view: 'side', parts: ['arm', 'paddle'],
      title: '發球擊球點偏高（當參考）', short: '發球偏高',
      why: '規則要求發球擊球點在腰以下，太高有被判違例的風險。',
      fix: '球放低一點、膝蓋彎，拍子由下往上揮，碰球時手腕在肚臍下面。',
      drill: '發球 20 球：擊球前看一下手腕有沒有在褲頭以下。' },
    { id: 'stance', metric: 'stance', weight: 0.6, view: 'front', parts: ['legs'],
      title: '站距太窄、重心不穩', short: '站太窄',
      why: '兩腳太近時很難往左右移動，擊球時身體也容易晃。',
      fix: '兩腳打開比肩膀寬一點、腳尖微微朝前，重心放在腳掌前半。',
      drill: '左右滑步 3 組 × 20 秒，停下時兩腳一定要比肩寬。' },
  ];
  // [標題, 每一拍都做到時的說明, 大部分做到時的說明]
  const STRENGTHS = {
    lean: ['上身保持挺直', '擊球時上半身前傾都在目標內，看球穩、拍面好控制。', '大部分擊球時上半身都保持挺直，看球穩、拍面好控制。'],
    knee: ['膝蓋有彎、姿勢夠低', '擊球前膝蓋角度都落在建議範圍，是用腿在降低高度。', '大部分擊球前膝蓋角度落在建議範圍，有用腿降低高度。'],
    front: ['擊球點在身體前方', '每一拍都在身前碰到球，拍面角度比較好控制。', '大部分的球都在身前碰到，拍面角度比較好控制。'],
    backswing: ['引拍精簡', '引拍幅度都在範圍內，動作小、來得及。', '大部分的球引拍幅度在範圍內，動作小、來得及。'],
    turn: ['抽球有轉肩', '抽球前肩膀有轉開，有用到身體的力量。', '大部分抽球前肩膀有轉開，有用到身體的力量。'],
    ready: ['兩拍之間拍子維持在胸前', '準備時拍子一直在胸口附近，下一球反應得快。', '大部分時候準備時拍子在胸口附近，下一球反應得快。'],
    offhand: ['非持拍手留在身前', '另一隻手有留在身前幫忙平衡。', '大部分的球另一隻手有留在身前幫忙平衡。'],
    follow: ['收拍乾淨', '收拍方向和高度都控制得很好。', '大部分的球收拍方向和高度都控制得不錯。'],
    stance: ['站距夠寬、下盤穩', '擊球時兩腳都比肩膀寬，重心穩。', '大部分擊球時兩腳比肩膀寬，重心穩。'],
  };

  function diagnose(shots) {
    const active = shots.filter((s) => !s.excluded);
    const probs = [];
    for (const P of PROBLEMS) {
      const bad = active.filter((s) => s.st[P.metric] === 'bad');
      const appl = active.filter((s) => s.st[P.metric] !== 'na');
      if (!bad.length) continue;
      // 示範球：最超標的那一拍
      let demo = bad[0];
      const worse = (a, b) => {
        const va = a.m[P.metric], vb = b.m[P.metric];
        switch (P.metric) {
          case 'front': case 'offhand': case 'ready': case 'turn': case 'stance': case 'serveVy': return va < vb;
          default: return va > vb;
        }
      };
      for (const s of bad) if (worse(s, demo)) demo = s;
      const primary = bad.length >= 2;
      const score = P.weight * bad.length * (primary ? 1 : 0.4) + P.weight * 0.2 * (bad.length / Math.max(1, appl.length));
      probs.push({ ...P, shots: bad.map((s) => s.idx), applicable: appl.length, demo: demo.idx, primary, score,
        severity: !primary ? '參考' : (bad.length >= 3 && P.weight >= 0.8) ? '高' : '中' });
    }
    probs.sort((a, b) => (b.primary - a.primary) || (b.score - a.score));
    const primary = probs.filter((p) => p.primary).slice(0, 4);
    const secondary = probs.filter((p) => !p.primary || !primary.includes(p)).filter((p) => !primary.includes(p));

    // 優點
    const strengths = [];
    for (const k of Object.keys(STRENGTHS)) {
      const appl = active.filter((s) => s.st[k] !== 'na');
      if (appl.length < 2) continue;
      const ok = appl.filter((s) => s.st[k] === 'ok');
      if (ok.length === appl.length) strengths.push({ metric: k, title: STRENGTHS[k][0], text: STRENGTHS[k][1], count: ok.length, of: appl.length, all: true });
      else if (appl.length >= 3 && ok.length / appl.length >= 0.7) strengths.push({ metric: k, title: STRENGTHS[k][0], text: STRENGTHS[k][2], count: ok.length, of: appl.length, all: false });
    }
    strengths.sort((a, b) => (b.all - a.all) || (b.count / b.of - a.count / a.of) || (b.count - a.count));

    // 最標準的一拍、最亂的一拍
    const scoreShot = (s) => Object.values(s.st).reduce((a, v) => a + (v === 'bad' ? 2 : v === 'warn' ? 1 : 0), 0);
    let best = null, worst = null;
    for (const s of active) {
      s.issueScore = scoreShot(s);
      s.badCount = Object.values(s.st).filter((v) => v === 'bad').length;
      if (!best || s.issueScore < best.issueScore) best = s;
      if (!worst || s.issueScore > worst.issueScore) worst = s;
    }
    const top = strengths.slice(0, 3);
    if (best && top.length < 3) {
      top.push({ metric: null, title: `第 ${best.idx + 1} 拍最標準`, text: `${TYPES[best.type].name}（${fmtTime(best.c / FPS)}）幾乎每一項都在建議範圍內，可以當作自己的標準動作來記。`, count: 1, of: 1, all: false, shot: best.idx });
    }
    return { primary, secondary, strengths: top, best, worst };
  }
  const fmtTime = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };

  // ---------- 矯正版骨架 ----------
  function correct(S, shots, H, diag) {
    const n = S.length;
    const C = S.map((F) => new Float32Array(F));
    const active = shots.filter((s) => !s.excluded);
    if (!active.length) return { C, applied: [] };
    const on = new Set([...diag.primary, ...diag.secondary].map((p) => p.id));
    const applied = new Set();
    const nearest = new Int32Array(n);
    for (let f = 0; f < n; f++) {
      let bi = 0, bd = 1e9;
      active.forEach((s, i) => { const d = Math.abs(f - s.c); if (d < bd) { bd = d; bi = i; } });
      nearest[f] = bi;
    }
    const flag = (s, metric) => s.st[metric] === 'bad' || s.st[metric] === 'warn';
    const UPPER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
    const moveHand = (F, wrJ, delta, joints) => { for (const j of joints) V.set(F, j, V.add(V.get(F, j), delta)); };

    // 1) 腿太直：降髖 + 兩段式 IK
    if (on.has('legs')) {
      for (let f = 0; f < n; f++) {
        const s = active[nearest[f]], t = f - s.c;
        if (!flag(s, 'knee') || t < -18 || t > 3) continue;
        const need = clamp((s.m.knee - 135) / 20, 0.4, 1);
        const d = 0.10 * bump(t, -18, -6, 3) * need;
        if (d <= 1e-4) continue;
        const F = C[f], O = S[f];
        for (let j = 0; j <= 24; j++) F[j * 3 + 1] -= d;
        for (const [hj, kj, aj] of [[J.lHip, J.lKn, J.lAn], [J.rHip, J.rKn, J.rAn]]) {
          const H0 = V.get(O, hj), K0 = V.get(O, kj), A0 = V.get(O, aj), Hn = V.get(F, hj), A = V.get(F, aj);
          const L1 = V.len(V.sub(K0, H0)), L2 = V.len(V.sub(A0, K0));
          const u0 = V.norm(V.sub(A0, H0));
          let b = V.sub(V.sub(K0, H0), V.mul(u0, V.dot(V.sub(K0, H0), u0)));
          if (V.len(b) < 1e-3) b = fwdOf(O);
          let D = V.len(V.sub(A, Hn)); D = Math.min(D, L1 + L2 - 1e-4);
          const u = V.norm(V.sub(A, Hn));
          const aa = (L1 * L1 - L2 * L2 + D * D) / (2 * D), hh = Math.sqrt(Math.max(0, L1 * L1 - aa * aa));
          let bp = V.norm(V.sub(b, V.mul(u, V.dot(b, u))));
          V.set(F, kj, V.add(V.add(Hn, V.mul(u, aa)), V.mul(bp, hh)));
        }
        applied.add('legs');
      }
    }
    // 2) 彎腰：上半身繞髖中點扶正
    if (on.has('bend')) {
      const ex = new Float32Array(n);
      for (let f = 0; f < n; f++) {
        const s = active[nearest[f]];
        const tgt = s.type === 'drive' || s.type === 'volley' ? 12 : SOFT(s.type) ? 18 : 15;
        ex[f] = Math.max(0, leanOf(C[f]) - tgt);
      }
      for (let f = 0; f < n; f++) {
        let acc = 0, m = 0;
        for (let g = Math.max(0, f - 3); g <= Math.min(n - 1, f + 3); g++) { acc += ex[g]; m++; }
        const ang = Math.min(ex[f], acc / m) * Math.PI / 180;
        if (ang < 0.005) continue;
        const F = C[f], hm = hipMid(F), torso = V.sub(shMid(F), hm);
        const k = V.cross(torso, UP); if (V.len(k) < 1e-5) continue;
        const kn = V.norm(k);
        for (const j of UPPER) V.set(F, j, V.add(hm, V.rot(V.sub(V.get(F, j), hm), kn, ang)));
        applied.add('bend');
      }
    }
    // 3) 抽球轉身不足
    if (on.has('turn')) {
      for (const s of active) {
        if (s.type !== 'drive' || !flag(s, 'turn')) continue;
        const extra = clamp(45 - s.m.turn, 0, 30) * Math.PI / 180;
        const ref = C[Math.max(0, s.c - 9)], hm0 = hipMid(ref);
        const p = V.sub(V.get(ref, H.sh), hm0);
        const sign = V.dot(V.cross(UP, p), V.mul(s.x.fwd, -1)) >= 0 ? 1 : -1;
        for (let f = Math.max(0, s.c - 20); f <= Math.min(n - 1, s.c - 2); f++) {
          if (active[nearest[f]] !== s) continue;
          const w = bump(f - s.c, -20, -9, -2); if (w < 1e-3) continue;
          const F = C[f], hm = hipMid(F), th = sign * extra * w;
          const rotJ = (j, a) => V.set(F, j, V.add(hm, V.rot(V.sub(V.get(F, j), hm), UP, a)));
          for (const j of UPPER) rotJ(j, th);
          rotJ(J.lHip, th * 0.4); rotJ(J.rHip, th * 0.4); rotJ(J.lKn, th * 0.2); rotJ(J.rKn, th * 0.2);
        }
        applied.add('turn');
      }
    }
    const handJ = [H.wr, H.pi, H.in, H.th];
    // 4) 擊球點太後面
    if (on.has('late')) {
      for (const s of active) {
        if (!flag(s, 'front')) continue;
        const shift = Math.max(0, 0.25 - s.m.front / 100);
        for (let f = Math.max(0, s.c - 6); f <= Math.min(n - 1, s.c + 2); f++) {
          const w = bump(f - s.c, -6, 0, 2); const d = V.mul(s.x.fwd, shift * w);
          moveHand(C[f], H.wr, d, handJ); V.set(C[f], H.el, V.add(V.get(C[f], H.el), V.mul(d, 0.5)));
        }
        applied.add('late');
      }
    }
    // 5) 小球／截擊引拍太大
    if (on.has('swing')) {
      for (const s of active) {
        if (!(s.type === 'dink' || s.type === 'volley') || !flag(s, 'backswing')) continue;
        const P = V.get(C[s.c], H.wr), sc = Math.min(1, 25 / s.m.backswing);
        for (let f = Math.max(0, s.c - 15); f <= s.c - 1; f++) {
          const w = smoothstep(-16, -12, f - s.c);
          const W0 = V.get(C[f], H.wr), Wn = V.add(P, V.mul(V.sub(W0, P), 1 - (1 - sc) * w));
          const d = V.sub(Wn, W0);
          moveHand(C[f], H.wr, d, handJ); V.set(C[f], H.el, V.add(V.get(C[f], H.el), V.mul(d, 0.5)));
        }
        applied.add('swing');
      }
    }
    // 6) 非持拍手甩到身後
    if (on.has('offhand')) {
      for (const s of active) {
        if (!flag(s, 'offhand')) continue;
        for (let f = Math.max(0, s.c - 5); f <= Math.min(n - 1, s.c + 3); f++) {
          const w = bump(f - s.c, -5, 0, 3); if (w < 1e-3) continue;
          const F = C[f], sm = shMid(F), osd = V.mul(racketSide(F, H), -1), fw = s.x.fwd;
          const tw = V.add(V.add(V.add(sm, V.mul(fw, 0.25)), V.mul(osd, 0.15)), [0, -0.25, 0]);
          const te = V.add(V.add(V.add(V.get(F, H.osh), [0, -0.24, 0]), V.mul(fw, 0.10)), V.mul(osd, 0.02));
          const W0 = V.get(F, H.owr), d = V.mul(V.sub(tw, W0), w);
          for (const j of [H.owr, H.opi, H.oin, H.oth]) V.set(F, j, V.add(V.get(F, j), d));
          V.set(F, H.oel, V.lerp(V.get(F, H.oel), te, w));
        }
        applied.add('offhand');
      }
    }
    // 7) 小球／吊球收拍太大
    if (on.has('follow')) {
      for (const s of active) {
        if (!SOFT(s.type) || !flag(s, 'follow')) continue;
        for (let f = s.c + 1; f <= Math.min(n - 1, s.c + 14); f++) {
          const t = f - s.c, w = smoothstep(0, 5, t) * (1 - smoothstep(10, 14, t));
          const F = C[f], sm = shMid(F), W0 = V.get(F, H.wr);
          let Wn = [W0[0], Math.min(W0[1], sm[1] - 0.12), W0[2]];
          Wn = V.add(Wn, V.mul(s.x.fwd, 0.08 * Math.min(1, t / 10)));
          const d = V.mul(V.sub(Wn, W0), w);
          moveHand(F, H.wr, d, handJ); V.set(F, H.el, V.add(V.get(F, H.el), V.mul(d, 0.5)));
        }
        applied.add('follow');
      }
    }
    // 8) 準備時拍子掉下去
    if (on.has('drop')) {
      active.forEach((s, i) => {
        if (!flag(s, 'ready')) return;
        const a = i > 0 ? active[i - 1].c + 12 : Math.max(0, s.c - 60), b = s.c - 15;
        if (b - a < 8) return;
        for (let f = a; f <= b; f++) {
          const w = smoothstep(a, a + 6, f) * (1 - smoothstep(b - 6, b, f)); if (w < 1e-3) continue;
          const F = C[f], sm = shMid(F), fw = fwdOf(F), sd = racketSide(F, H);
          const tw = V.add(V.add(V.add(sm, V.mul(fw, 0.30)), V.mul(sd, 0.10)), [0, -0.22, 0]);
          const sh = V.get(F, H.sh);
          const te = V.add(V.add(V.lerp(sh, tw, 0.5), [0, -0.10, 0]), V.mul(sd, 0.05));
          const d = V.mul(V.sub(tw, V.get(F, H.wr)), w);
          moveHand(F, H.wr, d, handJ);
          V.set(F, H.el, V.lerp(V.get(F, H.el), te, w));
        }
        applied.add('drop');
      });
    }
    // 9) 發球擊球點在腰以下
    if (on.has('serve')) {
      for (const s of active) {
        if (s.type !== 'serve' || s.st.serveH !== 'bad') continue;
        for (let f = Math.max(0, s.c - 4); f <= Math.min(n - 1, s.c + 2); f++) {
          const F = C[f], lim = hipMid(F)[1] + 0.10 - 0.08, W0 = V.get(F, H.wr);
          if (W0[1] <= lim) continue;
          const w = bump(f - s.c, -4, 0, 2), d = [0, (lim - W0[1]) * w, 0];
          moveHand(F, H.wr, d, handJ); V.set(F, H.el, V.add(V.get(F, H.el), V.mul(d, 0.5)));
        }
        applied.add('serve');
      }
    }
    return { C, applied: [...applied] };
  }

  // ---------- 逐格即時數據（HUD 用） ----------
  function live(F, H, fwd) {
    const sm = shMid(F), hm = hipMid(F), fw = fwd || fwdOf(F);
    return {
      lean: leanOf(F), knee: kneeMinOf(F),
      front: V.dot(V.horiz(V.sub(V.get(F, H.wr), hm)), fw) * 100,
      ready: (F[H.wr * 3 + 1] - sm[1]) * 100,
      offhand: V.dot(V.horiz(V.sub(V.get(F, H.owr), sm)), fw) * 100,
      stance: stanceOf(F),
    };
  }

  // ---------- 主流程 ----------
  /**
   * @param {object} raw {world: Float32Array[], img: Float32Array[], detected: Uint8Array, W, H}
   * @param {object} opt {hand: 'auto'|'R'|'L', overrides: {[peak]: {type?, excluded?}}}
   */
  function run(raw, opt) {
    opt = opt || {};
    const S = movingAvg(raw.world, 5);
    const n = S.length;
    // 影像上髖部移動量（相對身高），用來判斷發球前是否站定
    const hipPx = raw.img.map((F) => [(F[23 * 3] + F[24 * 3]) / 2, (F[23 * 3 + 1] + F[24 * 3 + 1]) / 2]);
    const bodyPx = raw.img.map((F) => Math.abs((F[27 * 3 + 1] + F[28 * 3 + 1]) / 2 - F[1]) || 1);
    const hipMotion = (a, b) => {
      if (b <= a) return 1;
      let mx = 0; for (let f = a; f <= b; f++) mx = Math.max(mx, Math.hypot(hipPx[f][0] - hipPx[a][0], hipPx[f][1] - hipPx[a][1]));
      return mx / (bodyPx[a] || 1);
    };
    const det = detectHits(S, opt.hand, hipMotion);
    const H = handIdx(det.hand);
    const ov = opt.overrides || {};
    const shots = det.hits.map((h, i) => {
      const cl = classify(S, h, H, i, det.hits, hipMotion);
      const o = ov[h.peak] || {};
      return { idx: i, peak: h.peak, c: h.c, speed: h.speed, big: h.big, estimated: true,
        type: o.type || cl.type, autoType: cl.type, backhand: cl.backhand, twoHanded: cl.twoHanded, excluded: !!o.excluded };
    });
    const act = shots.filter((s) => !s.excluded);
    act.forEach((s, i) => {
      const r = shotMetrics(S, s, H, i > 0 ? act[i - 1].c : null, i < act.length - 1 ? act[i + 1].c : null);
      Object.assign(s, r);
    });
    shots.filter((s) => s.excluded).forEach((s) => Object.assign(s, { m: {}, st: {}, x: { fwd: fwdAround(S, s.c), side: racketSide(S[s.c], H) } }));
    const diag = diagnose(shots);
    const { C, applied } = correct(S, shots, H, diag);
    act.forEach((s, i) => {
      const r = shotMetrics(C, s, H, i > 0 ? act[i - 1].c : null, null);
      s.cm = r.m; s.cst = r.st;
    });
    for (const s of shots) {
      const tt = TYPES[s.type];
      s.start = Math.max(0, s.c - tt.pre); s.end = Math.min(n - 1, s.c + tt.post);
    }
    return { S, C, shots, hand: det.hand, handAuto: det.handAuto, H, diag, applied, spL: det.spL, spR: det.spR, n };
  }

  window.PBAnalyze = { run, live, TYPES, METRICS, PROBLEMS, target, status, applies, J, KEEP, V, fwdOf, fwdAround, shMid, hipMid, leanOf, kneeAng, racketSide, handIdx, fmtTime, FPS, smoothstep };
})();
