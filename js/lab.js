/* Pickleball Motion Lab — 3D 實驗室、播放同步、介面 */
(function () {
  'use strict';
  const A = window.PBAnalyze, V = A.V, J = A.J, FPS = 30;
  const $ = (id) => document.getElementById(id);
  const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COL = { player: 0xFFD23F, fix: 0x5FE3F0, bad: 0xFF4D6D, ok: 0x7BE0A8, warn: 0xFF9F43, kitchen: 0xB9F227, line: 0x1D3243, sub: 0x7F97A6 };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ================= 狀態 =================
  const st = {
    hand: 'auto', model: 'full', file: null, url: null,
    raw: null, res: null, overrides: {}, shot: 0, mode: 'overlay', view: 'cam',
    speed: 0.5, freeze: true, frozen: false, freezeEnd: 0, lastF: -1, playing: false,
    videoOk: true, clockT: 0, cancel: false, thumbs: {}, filter: 'all',
    pickT: 0, cands: [], seed: null,
  };
  const vP = $('vP'), vA = $('vA');

  // ================= three.js 場景 =================
  const canvas = $('gl'), host = $('v3d');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x081017, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x081017, 7, 24);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 80);
  camera.position.set(0, 1.35, 4.6);
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.target.set(0, 0.95, 0);
  controls.enableDamping = !RM; controls.dampingFactor = 0.08;
  controls.minDistance = 1.5; controls.maxDistance = 12; controls.maxPolarAngle = Math.PI * 0.495;
  const composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.45, 0.22);
  composer.addPass(bloom);

  // 地面格線
  const grid = new THREE.GridHelper(40, 80, COL.line, 0x10202b);
  grid.material.transparent = true; grid.material.opacity = 0.55; grid.material.depthWrite = false;
  scene.add(grid);

  // 球場（依擊球方向擺在球員前方）
  const court = new THREE.Group(); scene.add(court);
  (function buildCourt() {
    const W = 6.10, HALF = 6.705, K = 2.13, xo = -1.25;
    const lm = new THREE.LineBasicMaterial({ color: 0xa9c3d1, transparent: true, opacity: 0.32, depthWrite: false });
    const pts = [];
    const L = (x1, z1, x2, z2) => pts.push(new THREE.Vector3(x1, 0.004, z1), new THREE.Vector3(x2, 0.004, z2));
    // 本地座標：+z 往網子方向，網子在 z = 0（整組再往前平移）
    for (const s of [-1, 1]) {
      L(xo - W / 2, s * HALF, xo + W / 2, s * HALF);           // 底線
      L(xo - W / 2, s * K, xo + W / 2, s * K);                  // 廚房線
      L(xo, s * K, xo, s * HALF);                               // 中線
    }
    L(xo - W / 2, -HALF, xo - W / 2, HALF); L(xo + W / 2, -HALF, xo + W / 2, HALF);
    court.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lm));
    const km = new THREE.MeshBasicMaterial({ color: COL.kitchen, transparent: true, opacity: 0.075, depthWrite: false, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const k = new THREE.Mesh(new THREE.PlaneGeometry(W, K), km);
      k.rotation.x = -Math.PI / 2; k.position.set(xo, 0.002, s * K / 2); court.add(k);
      const edge = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xo - W / 2, 0.006, s * K), new THREE.Vector3(xo + W / 2, 0.006, s * K)]),
        new THREE.LineBasicMaterial({ color: COL.kitchen, transparent: true, opacity: 0.55 }));
      court.add(edge);
    }
    // 球網：中央 0.86 m、柱子 0.914 m
    const np = [], post = W / 2 + 0.3;
    const hAt = (x) => 0.86 + (0.914 - 0.86) * Math.pow((x - xo) / post, 2);
    for (let x = -post; x <= post + 1e-6; x += 0.25) np.push(new THREE.Vector3(xo + x, 0, 0), new THREE.Vector3(xo + x, hAt(xo + x), 0));
    for (let y = 0.15; y < 0.86; y += 0.15) np.push(new THREE.Vector3(xo - post, y, 0), new THREE.Vector3(xo + post, y, 0));
    for (let x = -post; x < post; x += 0.25) np.push(new THREE.Vector3(xo + x, hAt(xo + x), 0), new THREE.Vector3(xo + x + 0.25, hAt(xo + x + 0.25), 0));
    court.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(np),
      new THREE.LineBasicMaterial({ color: 0xcfe3ee, transparent: true, opacity: 0.13, depthWrite: false })));
  })();
  function placeCourt(fwd, type) {
    const d = type === 'dink' || type === 'volley' ? 2.6 : type === 'overhead' ? 3.6 : type === 'serve' ? 7.0 : 6.3;
    court.rotation.y = Math.atan2(fwd[0], fwd[2]);
    court.position.set(fwd[0] * d, 0, fwd[2] * d);
  }

  // 腳下呼吸光圈
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.40, 0.44, 72), new THREE.MeshBasicMaterial({ color: COL.player, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.003; scene.add(ring);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(0.4, 48), new THREE.MeshBasicMaterial({ color: COL.player, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
  disk.rotation.x = -Math.PI / 2; disk.position.y = 0.002; scene.add(disk);
  // 擊球方向箭頭
  const arrow = (function () {
    const s = new THREE.Shape();
    s.moveTo(-0.025, 0.55); s.lineTo(0.025, 0.55); s.lineTo(0.025, 1.05); s.lineTo(0.08, 1.05); s.lineTo(0, 1.25); s.lineTo(-0.08, 1.05); s.lineTo(-0.025, 1.05); s.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color: COL.player, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = Math.PI / 2; // shape 的 +y → 世界 +z
    const g = new THREE.Group(); g.add(m); g.position.y = 0.005; scene.add(g); return g;
  })();
  ring.visible = disk.visible = arrow.visible = false;
  placeCourt([0, 0, -1], 'dink');

  // ---------- 發光人形 ----------
  const VS = `varying vec3 vN; varying vec3 vV;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
  const FS = `uniform vec3 uColor; uniform vec3 uAlertColor; uniform float uAlert; uniform float uBase; uniform float uRim; uniform float uOpacity;
    varying vec3 vN; varying vec3 vV;
    void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float I = uBase + uRim * pow(f, 2.4);
      vec3 c = mix(uColor, uAlertColor, uAlert); gl_FragColor = vec4(c * I * uOpacity, 1.0); }`;
  function fresnel(color) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlertColor: { value: new THREE.Color(COL.bad) }, uAlert: { value: 0 }, uBase: { value: 0.035 }, uRim: { value: 0.62 }, uOpacity: { value: 1 } },
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }
  const Y = new THREE.Vector3(0, 1, 0);
  const tv = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const LIMBS = [
    // [a, b, r_a, r_b, part]
    [12, 14, 0.05, 0.04, 'armR'], [14, 16, 0.04, 0.03, 'armR'], [11, 13, 0.05, 0.04, 'armL'], [13, 15, 0.04, 0.03, 'armL'],
    [24, 26, 0.08, 0.06, 'legs'], [26, 28, 0.056, 0.042, 'legs'], [23, 25, 0.08, 0.06, 'legs'], [25, 27, 0.056, 0.042, 'legs'],
    [30, 32, 0.035, 0.028, 'legs'], [29, 31, 0.035, 0.028, 'legs'],
  ];
  const JOINTS = [[11, 0.055, 'armL'], [12, 0.055, 'armR'], [13, 0.042, 'armL'], [14, 0.042, 'armR'], [15, 0.032, 'armL'], [16, 0.032, 'armR'],
    [25, 0.06, 'legs'], [26, 0.06, 'legs'], [27, 0.045, 'legs'], [28, 0.045, 'legs'], [23, 0.07, 'torso'], [24, 0.07, 'torso']];
  const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [15, 19], [16, 20], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];
  const sphereG = new THREE.SphereGeometry(1, 20, 14);

  class Figure {
    constructor(color) {
      this.color = color;
      this.root = new THREE.Group(); scene.add(this.root);
      this.parts = {}; this.mats = [];
      const mat = (part) => { const m = fresnel(color); m.userData.part = part; this.mats.push(m); return m; };
      this.limbs = LIMBS.map(([a, b, ra, rb, part]) => {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, 1, 18, 1, true), mat(part));
        this.root.add(mesh); return { a, b, mesh, part };
      });
      this.joints = JOINTS.map(([j, r, part]) => { const m = new THREE.Mesh(sphereG, mat(part)); m.scale.setScalar(r); this.root.add(m); return { j, m, part }; });
      this.hands = [16, 15].map((w) => { const m = new THREE.Mesh(sphereG, mat(w === 16 ? 'armR' : 'armL')); m.scale.setScalar(0.036); this.root.add(m); return { w, m }; });
      this.torso = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.78, 1, 28, 1, true), mat('torso')); this.torso.matrixAutoUpdate = false; this.root.add(this.torso);
      this.pelvis = new THREE.Mesh(sphereG, mat('torso')); this.pelvis.matrixAutoUpdate = false; this.root.add(this.pelvis);
      this.neck = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 1, 14, 1, true), mat('torso')); this.root.add(this.neck);
      this.head = new THREE.Mesh(sphereG, mat('head')); this.head.scale.set(0.095, 0.115, 0.1); this.root.add(this.head);
      // 骨架線與關節光點
      this.bonesGeo = new THREE.BufferGeometry();
      this.bonesGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((BONES.length + 1) * 6), 3));
      this.bones = new THREE.LineSegments(this.bonesGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.1), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.root.add(this.bones);
      this.ptsGeo = new THREE.BufferGeometry();
      this.ptsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(A.KEEP.length * 3), 3));
      this.pts = new THREE.Points(this.ptsGeo, new THREE.PointsMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3), size: 0.026, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.root.add(this.pts);
      // 匹克球拍：實心板拍
      this.paddle = new THREE.Group(); this.paddle.matrixAutoUpdate = false; this.root.add(this.paddle);
      const hm = mat('paddle');
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.017, 0.13, 12, 1, true), hm); handle.position.y = 0.065; this.paddle.add(handle);
      const shp = new THREE.Shape(), w = 0.10, y0 = 0.13, y1 = 0.39, r = 0.045;
      shp.moveTo(-w, y0 + 0.012); shp.lineTo(-w, y1 - r); shp.quadraticCurveTo(-w, y1, -w + r, y1); shp.lineTo(w - r, y1); shp.quadraticCurveTo(w, y1, w, y1 - r);
      shp.lineTo(w, y0 + 0.012); shp.quadraticCurveTo(w, y0, w - 0.012, y0); shp.lineTo(-w + 0.012, y0); shp.quadraticCurveTo(-w, y0, -w, y0 + 0.012);
      const faceGeo = new THREE.ExtrudeGeometry(shp, { depth: 0.015, bevelEnabled: false, curveSegments: 10 }); faceGeo.translate(0, 0, -0.0075);
      this.faceMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.paddle.add(new THREE.Mesh(faceGeo, this.faceMat));
      this.edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
      const outline = shp.getPoints(12).map((p) => new THREE.Vector3(p.x, p.y, 0));
      for (const z of [-0.0075, 0.0075]) { const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outline.map((p) => p.clone().setZ(z))), this.edgeMat); this.paddle.add(l); }
      // 手腕軌跡
      this.trailN = 18;
      this.trailGeo = new THREE.BufferGeometry();
      this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailN * 3), 3));
      const tc = new Float32Array(this.trailN * 3), cc = new THREE.Color(color);
      for (let i = 0; i < this.trailN; i++) { const a = Math.pow(i / (this.trailN - 1), 1.6); tc[i * 3] = cc.r * a; tc[i * 3 + 1] = cc.g * a; tc[i * 3 + 2] = cc.b * a; }
      this.trailGeo.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      this.trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.trail.frustumCulled = false;
      this.root.add(this.trail);
      this.root.visible = false;
    }
    setAlert(parts, amount, hand) {
      const map = (p) => {
        if (p === 'armR' || p === 'armL') { const racket = (hand === 'R') === (p === 'armR'); return racket ? 'arm' : 'offarm'; }
        return p;
      };
      for (const m of this.mats) m.uniforms.uAlert.value = parts.has(map(m.userData.part)) ? amount : 0;
      const pa = parts.has('paddle') ? amount : 0;
      this.faceMat.color.set(this.color).lerp(new THREE.Color(COL.bad), pa);
      this.edgeMat.color.set(this.color).lerp(new THREE.Color(0xffffff), 0.25).lerp(new THREE.Color(COL.bad), pa);
    }
    update(P, fwd, hand, trailPts) {
      const g = (j) => tv([P[j * 3], P[j * 3 + 1], P[j * 3 + 2]]);
      for (const L of this.limbs) {
        const a = g(L.a), b = g(L.b), d = b.clone().sub(a), len = d.length() || 1e-3;
        L.mesh.position.copy(a).add(b).multiplyScalar(0.5);
        L.mesh.quaternion.setFromUnitVectors(Y, d.divideScalar(len));
        L.mesh.scale.set(1, len, 1);
      }
      for (const q of this.joints) q.m.position.copy(g(q.j));
      for (const h of this.hands) { const w = g(h.w), idx = g(h.w + 4); h.m.position.copy(w).lerp(idx, 0.55); }
      const lS = g(11), rS = g(12), lH = g(23), rH = g(24);
      const sm = lS.clone().add(rS).multiplyScalar(0.5), hm = lH.clone().add(rH).multiplyScalar(0.5);
      // 軀幹：上寬下窄橢圓柱
      const up = sm.clone().sub(hm); const spine = up.length(); up.normalize();
      let X = lS.clone().sub(rS); const sw = X.length(); X.sub(up.clone().multiplyScalar(X.dot(up))).normalize();
      const Z = new THREE.Vector3().crossVectors(X, up).normalize();
      const tc = hm.clone().add(sm).multiplyScalar(0.5).add(up.clone().multiplyScalar(-0.02));
      this.torso.matrix.makeBasis(X.clone().multiplyScalar(sw * 0.53), up.clone().multiplyScalar(spine * 1.05), Z.clone().multiplyScalar(0.115)).setPosition(tc);
      const hw = lH.distanceTo(rH);
      let HX = lH.clone().sub(rH).normalize();
      const pz = new THREE.Vector3().crossVectors(HX, up).normalize();
      this.pelvis.matrix.makeBasis(HX.multiplyScalar(hw * 0.5 + 0.05), up.clone().multiplyScalar(0.095), pz.multiplyScalar(0.105)).setPosition(hm);
      const nose = g(0);
      const headC = nose.clone().add(Z.clone().multiplyScalar(-0.075)).add(up.clone().multiplyScalar(0.035));
      const neckB = sm.clone().add(up.clone().multiplyScalar(0.02)), neckT = headC.clone().add(up.clone().multiplyScalar(-0.08));
      const nd = neckT.clone().sub(neckB); const nl = Math.max(0.02, nd.length());
      this.neck.position.copy(neckB).add(neckT).multiplyScalar(0.5); this.neck.quaternion.setFromUnitVectors(Y, nd.normalize()); this.neck.scale.set(1, nl, 1);
      this.head.position.copy(headC);
      this.head.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, up, Z));
      // 骨架線
      const bp = this.bonesGeo.attributes.position.array; let o = 0;
      for (const [a, b] of BONES) { bp.set([P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], o); o += 6; }
      bp.set([sm.x, sm.y, sm.z, nose.x, nose.y, nose.z], o);
      this.bonesGeo.attributes.position.needsUpdate = true;
      const pp = this.ptsGeo.attributes.position.array;
      A.KEEP.forEach((j, i) => { pp[i * 3] = P[j * 3]; pp[i * 3 + 1] = P[j * 3 + 1]; pp[i * 3 + 2] = P[j * 3 + 2]; });
      this.ptsGeo.attributes.position.needsUpdate = true;
      // 球拍：前臂 55% + 手掌 45%
      const wr = g(hand === 'L' ? 15 : 16), el = g(hand === 'L' ? 13 : 14), ix = g(hand === 'L' ? 19 : 20);
      const fore = wr.clone().sub(el).normalize(), palm = ix.clone().sub(wr).normalize();
      const axis = fore.multiplyScalar(0.55).add(palm.multiplyScalar(0.45)).normalize();
      const fw = tv(fwd); let nrm = fw.clone().sub(axis.clone().multiplyScalar(fw.dot(axis)));
      if (nrm.length() < 0.05) nrm = new THREE.Vector3().crossVectors(axis, Y);
      nrm.normalize();
      const wdir = new THREE.Vector3().crossVectors(axis, nrm).normalize();
      this.paddle.matrix.makeBasis(wdir, axis, nrm).setPosition(wr);
      // 軌跡
      const ta = this.trailGeo.attributes.position.array;
      for (let i = 0; i < this.trailN; i++) { const p = trailPts[Math.min(i, trailPts.length - 1)]; ta[i * 3] = p[0]; ta[i * 3 + 1] = p[1]; ta[i * 3 + 2] = p[2]; }
      this.trailGeo.attributes.position.needsUpdate = true;
    }
  }
  const figP = new Figure(COL.player), figC = new Figure(COL.fix);
  // 矯正版稍微暗一點，兩個疊在一起才分得出來
  figC.mats.forEach((m) => { m.uniforms.uRim.value = 0.42; m.uniforms.uBase.value = 0.025; });

  // ---------- 標註（3D） ----------
  const annP = new THREE.Group(), annC = new THREE.Group();
  figP.root.add(annP); figC.root.add(annC);
  function clearGroup(g) { while (g.children.length) { const c = g.children.pop(); c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); } }
  function arc(group, center, u0, u1, radius, color, fillOp) {
    const a = tv(u0).normalize(), b = tv(u1).normalize();
    const ang = a.angleTo(b); if (ang < 0.01) return;
    const axis = new THREE.Vector3().crossVectors(a, b).normalize();
    const pts = [], fan = [center.clone()];
    for (let i = 0; i <= 24; i++) { const p = a.clone().applyAxisAngle(axis, ang * i / 24).multiplyScalar(radius).add(center); pts.push(p); fan.push(p); }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false })));
    const idx = []; for (let i = 1; i < fan.length - 1; i++) idx.push(0, i, i + 1);
    const fg = new THREE.BufferGeometry().setFromPoints(fan); fg.setIndex(idx);
    group.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: fillOp, side: THREE.DoubleSide, depthWrite: false })));
  }
  function dashed(group, a, b, color, op) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color, dashSize: 0.045, gapSize: 0.03, transparent: true, opacity: op || 0.9, depthWrite: false }));
    l.computeLineDistances(); group.add(l);
  }
  const targetRings = [];
  function targetRing(group, pos, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.068, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.copy(pos); group.add(m); targetRings.push(m);
  }

  // ================= 資料工具 =================
  function frameAt(arr, f) {
    const n = arr.length; f = Math.max(0, Math.min(n - 1, f));
    const i = Math.floor(f), t = f - i, a = arr[i], b = arr[Math.min(n - 1, i + 1)];
    if (t < 1e-4) return a;
    const o = new Float32Array(99); for (let k = 0; k < 99; k++) o[k] = a[k] + (b[k] - a[k]) * t; return o;
  }
  function groundSeries(arr) {
    const n = arr.length, raw = new Float32Array(n), out = new Float32Array(n);
    for (let f = 0; f < n; f++) { let m = 9; for (let j = 27; j <= 32; j++) m = Math.min(m, arr[f][j * 3 + 1]); raw[f] = m; }
    for (let f = 0; f < n; f++) { let s = 0, c = 0; for (let g = Math.max(0, f - 4); g <= Math.min(n - 1, f + 4); g++) { s += raw[g]; c++; } out[f] = -s / c; }
    return out;
  }
  const lift = (F, dy) => { const o = new Float32Array(F); for (let j = 0; j < 33; j++) o[j * 3 + 1] += dy; return o; };
  const valAt = (arr, f) => { f = Math.max(0, Math.min(arr.length - 1, f)); const i = Math.floor(f), t = f - i; return arr[i] + ((arr[Math.min(arr.length - 1, i + 1)] ?? arr[i]) - arr[i]) * t; };

  // ================= 上傳流程 =================
  const STEPS = ['影片前處理', '載入偵測模型', '選擇球員', '逐格姿勢偵測', '品質檢查', '找出擊球', '計算指標', '診斷', '矯正版骨架', '建置實驗室'];
  let stepT0 = 0, stepIdx = -1, stepMsg = '';
  setInterval(() => {
    if ($('proc').hidden || stepIdx < 0 || !$('picker').hidden || $('procMsg').querySelector('.err')) return;
    const s = Math.round((performance.now() - stepT0) / 1000);
    if (s >= 3) $('procMsg').textContent = `${stepMsg}（${s} 秒）`;
  }, 1000);
  function stepUI(i, msg, frac) {
    if (i !== stepIdx) { stepIdx = i; stepT0 = performance.now(); }
    if (msg != null) stepMsg = msg;
    $('steps').innerHTML = STEPS.map((s, k) => `<div class="step ${k < i ? 'done' : k === i ? 'run' : ''}">${s}</div>`).join('');
    if (msg != null) $('procMsg').textContent = msg;
    $('barI').style.width = `${Math.round((frac ?? 0) * 100)}%`;
  }
  function setSegPressed(seg, attr, val) { seg.querySelectorAll('.btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === val))); }
  // 分析進行中鎖住設定與選影片，避免中途切換造成錯誤
  function setBusy(on) {
    st.busy = on;
    document.querySelectorAll('[data-hand], [data-model]').forEach((b) => { b.disabled = on; });
    $('file').disabled = on;
    $('fileLbl').setAttribute('aria-disabled', String(on)); $('fileLbl').tabIndex = on ? -1 : 0;
    $('fileLbl').style.pointerEvents = on ? 'none' : '';
    $('drop').classList.toggle('locked', on);
    $('lockMsg').hidden = !on;
  }
  document.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => { if (st.busy) return; st.hand = b.dataset.hand; setSegPressed(b.parentElement, 'hand', st.hand); }));
  document.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', () => { if (st.busy) return; st.model = b.dataset.model; setSegPressed(b.parentElement, 'model', st.model); }));
  $('fileLbl').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
  // iPhone 選完影片後會先轉檔／從 iCloud 下載，這段時間網頁收不到任何事件 → 一按「選擇影片」就顯示等待狀態
  let waitTimer = null, waitT0 = 0;
  function showPickWait() {
    waitT0 = performance.now(); $('pickWaitT').textContent = '';
    $('pickWait').hidden = false;
    clearInterval(waitTimer);
    waitTimer = setInterval(() => {
      const sec = Math.round((performance.now() - waitT0) / 1000);
      if (sec >= 2) $('pickWaitT').textContent = `${sec} 秒`;
      if (sec > 240) hidePickWait(); // 四分鐘都沒拿到檔案，多半是取消了
    }, 1000);
  }
  function hidePickWait() { clearInterval(waitTimer); waitTimer = null; $('pickWait').hidden = true; }
  $('file').addEventListener('click', showPickWait);
  $('file').addEventListener('cancel', hidePickWait); // Safari 16.4+、Chrome 113+ 取消選擇時會觸發
  $('pickWaitX').addEventListener('click', hidePickWait); // 舊瀏覽器沒有 cancel 事件，讓使用者自己收起
  $('file').addEventListener('change', (e) => { hidePickWait(); const f = e.target.files[0]; e.target.value = ''; if (f) startFile(f); });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (st.busy) return; const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(x.name)); if (f) startFile(f); });
  // 游標移進上傳區就先載入偵測引擎，選好影片時通常已經就緒
  function warmEngine() {
    const kind = st.model;
    $('engineStatus').textContent = '載入中…';
    waitPose().then((P) => P.init(kind, (m, f) => { $('engineStatus').textContent = `${m}（${Math.round(f * 100)}%）`; }))
      .then((r) => { $('engineStatus').textContent = `就緒（${kind}，${r.delegate}）`; })
      .catch((e) => { $('engineStatus').textContent = `無法啟動：${e.message || e}`; });
  }
  $('upload').addEventListener('pointerenter', warmEngine, { once: true });
  $('upload').addEventListener('focusin', warmEngine, { once: true });
  $('cancelBtn').addEventListener('click', () => { st.cancel = true; });
  $('newVid').addEventListener('click', () => { $('upload').hidden = false; $('upbar').hidden = true; $('proc').hidden = true; $('picker').hidden = true; $('file').value = ''; $('upload').scrollIntoView({ behavior: RM ? 'auto' : 'smooth' }); });

  function waitPose() {
    if (window.PBPose) return Promise.resolve(window.PBPose);
    return Promise.reject(new Error('偵測程式沒有載入成功（js/pose.js），請重新整理頁面'));
  }
  const BAD_FORMAT = '這個瀏覽器無法讀取這支影片的格式（iPhone 的 HEVC .MOV 在部分電腦上不支援，可以先轉成 H.264 MP4 再試）';
  // 先等 metadata（手機 Safari 不會預先載入影格），再用靜音播放一下讓第一格可以畫出來
  function loadVideo(v, url) {
    return new Promise((res, rej) => {
      let settled = false;
      const end = (err) => { if (settled) return; settled = true; clearTimeout(to); v.removeEventListener('error', bad); err ? rej(err) : res(); };
      const bad = () => end(new Error(BAD_FORMAT));
      const to = setTimeout(() => end(new Error('影片讀取超過 20 秒沒有反應。' + BAD_FORMAT)), 20000);
      v.addEventListener('error', bad);
      v.addEventListener('loadedmetadata', async () => {
        if (!v.videoWidth) return end(new Error(BAD_FORMAT));
        if (v.readyState < 2) {
          try { await v.play(); v.pause(); } catch (e) { /* 不能播也沒關係，後面用 seek 取格 */ }
          if (v.readyState < 2) await new Promise((r) => { const t = setTimeout(r, 3000); v.addEventListener('loadeddata', () => { clearTimeout(t); r(); }, { once: true }); });
        }
        end();
      }, { once: true });
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.src = url; v.load();
    });
  }

  async function startFile(file) {
    if (st.busy) return;
    setBusy(true);
    st.cancel = false; st.file = file;
    $('fileName').textContent = file.name;
    $('proc').hidden = false; $('picker').hidden = true; $('procLine').hidden = $('cancelRow').hidden = false;
    $('procEta').textContent = '';
    stepUI(0, '讀取影片…', 0.02);
    try {
      if (st.url) URL.revokeObjectURL(st.url);
      st.url = URL.createObjectURL(file);
      await loadVideo(vA, st.url);
      const dur = vA.duration;
      if (!Number.isFinite(dur) || dur <= 0) throw new Error('讀不到影片長度');
      stepUI(1, `影片 ${vA.videoWidth}×${vA.videoHeight}、${dur.toFixed(1)} 秒，統一換算成 30fps（${Math.floor(dur * FPS)} 格）。載入偵測模型…`, 0.05);
      const P = await waitPose();
      const eng = await P.init(st.model, (m, f) => stepUI(1, m + '…', 0.05 + f * 0.1));
      $('engineStatus').textContent = `就緒（${st.model}，${eng.delegate}）`;
      stepUI(2, '找畫面中的人…', 0.16);
      await showPicker(Math.min(dur * 0.1, 2));
    } catch (e) { fail(e); }
  }
  window.addEventListener('unhandledrejection', (e) => { if (!$('proc').hidden && $('picker').hidden) fail(e.reason || e); });
  window.addEventListener('error', (e) => { if (!$('proc').hidden && $('picker').hidden && e.message) fail(new Error(e.message)); });
  function fail(e) {
    setBusy(false);
    $('procLine').hidden = $('cancelRow').hidden = false;
    console.error(e);
    $('procMsg').innerHTML = `<span class="err">${esc(e.message || e)}</span>`;
    $('procEta').textContent = '';
    $('engineStatus').textContent = $('engineStatus').textContent.startsWith('就緒') ? $('engineStatus').textContent : `未就緒：${e.message || e}`;
    $('steps').querySelector('.run')?.classList.remove('run');
  }

  async function showPicker(t) {
    const P = window.PBPose;
    st.pickT = t;
    const cands = await P.findCandidates(vA, t);
    st.cands = cands; st.seed = null;
    const cv = $('pickCv'), W = vA.videoWidth, H = vA.videoHeight;
    const sc = Math.min(1, 960 / Math.max(W, H));
    cv.width = Math.round(W * sc); cv.height = Math.round(H * sc);
    cv.getContext('2d').drawImage(vA, 0, 0, cv.width, cv.height);
    $('picker').hidden = false;
    const wrap = $('pickWrap');
    wrap.querySelectorAll('.cand').forEach((n) => n.remove());
    cands.forEach((c, i) => {
      const d = document.createElement('div'); d.className = 'cand';
      const pad = c.box.h * 0.08;
      Object.assign(d.style, { left: `${(c.box.x0 - pad) / W * 100}%`, top: `${(c.box.y0 - pad) / H * 100}%`, width: `${(c.box.x1 - c.box.x0 + pad * 2) / W * 100}%`, height: `${(c.box.y1 - c.box.y0 + pad * 2) / H * 100}%` });
      d.innerHTML = `<span>${i + 1}</span>`; wrap.appendChild(d);
    });
    $('pickMsg').textContent = cands.length ? `找到 ${cands.length} 位，點選要分析的那一位。` : '這一格沒有自動找到人，直接點在球員身上，或換一個時間點。';
    const dur = vA.duration;
    $('pickTimes').innerHTML = '<span class="lbl">換時間點</span>' + [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => `<button class="btn" data-pt="${(dur * p).toFixed(2)}">${A.fmtTime(dur * p)}</button>`).join('');
    $('pickTimes').querySelectorAll('[data-pt]').forEach((b) => b.addEventListener('click', () => showPicker(parseFloat(b.dataset.pt)).catch(fail)));
    $('pickGo').disabled = true;
    stepUI(2, '請選擇要分析的球員', 0.18);
    $('procLine').hidden = $('cancelRow').hidden = true; // 選人時不需要狀態列和取消鍵
    $('picker').scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'nearest' });
  }
  $('pickWrap').addEventListener('click', (e) => {
    const r = $('pickCv').getBoundingClientRect(), W = vA.videoWidth, H = vA.videoHeight;
    const x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
    let pick = -1;
    st.cands.forEach((c, i) => { const p = c.box.h * 0.1; if (x >= c.box.x0 - p && x <= c.box.x1 + p && y >= c.box.y0 - p && y <= c.box.y1 + p) pick = i; });
    $('pickWrap').querySelectorAll('.cand').forEach((n, i) => n.classList.toggle('sel', i === pick));
    if (pick >= 0) { const b = st.cands[pick].box; st.seed = { cx: b.cx, cy: b.cy, long: b.long, hx: b.hx, hy: b.hy, h: b.h }; $('pickMsg').textContent = `已選第 ${pick + 1} 位。`; }
    else { const g = H * 0.28; st.seed = { cx: x, cy: y, long: g, hx: x, hy: y, h: g }; $('pickMsg').textContent = '已標記點選位置，會從這裡開始找人。'; }
    $('pickGo').disabled = false;
  });
  $('pickGo').addEventListener('click', () => runTracking().catch(fail));

  async function runTracking() {
    const P = window.PBPose;
    $('picker').hidden = true;
    $('procLine').hidden = $('cancelRow').hidden = false;
    stepUI(3, '逐格姿勢偵測中…', 0.2);
    const raw = await P.track(vA, st.seed, st.pickT, (d, n, eta) => {
      stepUI(3, `逐格姿勢偵測 ${d} / ${n} 格`, 0.2 + 0.7 * d / n);
      $('procEta').textContent = `剩約 ${Math.ceil(eta)} 秒`;
    }, () => st.cancel);
    $('procEta').textContent = '';
    raw.name = st.file.name; raw.duration = vA.duration; raw.srcW = vA.videoWidth; raw.srcH = vA.videoHeight;
    st.raw = raw; st.overrides = {}; st.thumbs = {}; resetZoom(); $('qcMsg').hidden = true;
    stepUI(4, `偵測完成：${raw.N - raw.filled} 格抓到、${raw.filled} 格用插值補齊`, 0.92);
    await new Promise((r) => setTimeout(r, 30));
    stepUI(5, '找出擊球…', 0.94);
    analyzeAndBuild(true);
  }

  // ================= 分析 → 介面 =================
  function analyzeAndBuild(first) {
    const raw = st.raw;
    const res = A.run(raw, { hand: st.hand === 'auto' ? null : st.hand, overrides: st.overrides });
    res.gP = groundSeries(res.S); res.gC = groundSeries(res.C);
    res.overlay = overlayTrack(raw);
    st.res = res;
    if (first) {
      setBusy(false);
      stepUI(9, '建置實驗室…', 1);
      $('upload').hidden = true; $('upbar').hidden = false;
      $('ubName').textContent = raw.name;
      $('ubInfo').textContent = `${raw.srcW}×${raw.srcH} · ${A.fmtTime(raw.duration)} · ${raw.N} 格`;
      setupPlayback();
    }
    buildAll();
    const act = res.shots.filter((s) => !s.excluded);
    selectShot(act.length ? (act.find((s) => s.idx === st.shot) ? st.shot : act[0].idx) : -1, first && !RM);
    if (first) { makeThumbs(); $('lab').scrollIntoView({ behavior: RM ? 'auto' : 'smooth' }); }
  }

  function overlayTrack(raw) {
    const n = raw.N, hx = new Float32Array(n), hy = new Float32Array(n), bh = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      const I = raw.img[f];
      hx[f] = (I[69] + I[72]) / 2; hy[f] = (I[70] + I[73]) / 2;
      let y0 = 1e9, y1 = -1e9; for (let j = 0; j < 33; j++) { if (I[j * 3 + 2] < 0.3 && j) continue; y0 = Math.min(y0, I[j * 3 + 1]); y1 = Math.max(y1, I[j * 3 + 1]); }
      bh[f] = Math.max(40, y1 - y0);
    }
    const sm = (a) => { const o = new Float32Array(n); for (let f = 0; f < n; f++) { let s = 0, c = 0; for (let g = Math.max(0, f - 15); g <= Math.min(n - 1, f + 15); g++) { s += a[g]; c++; } o[f] = s / c; } return o; };
    return { cx: sm(hx), cy: sm(hy), side: sm(bh).map((v) => v * 2.3) };
  }

  // ---------- 標頭 ----------
  function buildHeader() {
    const { res, raw } = st, act = res.shots.filter((s) => !s.excluded), d = res.diag;
    const counts = {}; act.forEach((s) => { counts[s.type] = (counts[s.type] || 0) + 1; });
    const typeStr = Object.entries(counts).map(([k, v]) => `${A.TYPES[k].short} ${v}`).join('・') || '沒有偵測到擊球';
    $('eyebrow').innerHTML = `<b>MOTION ANALYSIS · PICKLEBALL</b><span>${act.length} 拍：${esc(typeStr)}</span><span>${esc(raw.name)}</span><span>${A.fmtTime(raw.duration)}</span><span>${raw.N} 格</span>`;
    if (!act.length) {
      $('title').innerHTML = '這支影片<em>沒有抓到擊球</em>';
      $('summary').textContent = '手腕速度一直沒有出現明顯的揮拍峰值。可能是球員太小、被擋住，或是拍到的片段沒有擊球。可以到下方「擊球確認」看骨架有沒有對準，或換一支影片。';
      $('chips').innerHTML = ''; return;
    }
    const top = d.primary[0];
    $('title').innerHTML = top ? `${act.length} 拍分析：最需要改的是<em>${esc(top.title)}</em>` : `${act.length} 拍分析：<em>沒有重複出現的大問題</em>`;
    const bits = [];
    if (d.best) bits.push(`最標準的是第 ${d.best.idx + 1} 拍（${A.TYPES[d.best.type].short}，${A.fmtTime(d.best.c / FPS)}）`);
    if (d.worst && d.worst !== d.best && d.worst.issueScore > 0) {
      const probs = Object.entries(d.worst.st).filter(([, v]) => v === 'bad').map(([k]) => A.METRICS[k].label);
      bits.push(`最亂的一段在 ${A.fmtTime(Math.max(0, d.worst.start) / FPS)}–${A.fmtTime(d.worst.end / FPS)}（第 ${d.worst.idx + 1} 拍${probs.length ? '，' + probs.slice(0, 2).join('、') + '超標' : ''}）`);
    }
    const s1 = bits.join('；') + '。';
    const nums = (arr) => arr.map((i) => i + 1).join('、');
    const s2 = d.primary.length ? `主要問題：${d.primary.map((p) => `「${p.title}」（${p.applicable} 拍中有 ${p.shots.length} 拍：第 ${nums(p.shots)} 拍）`).join('、')}。` : '沒有任何問題在 2 拍以上重複出現。';
    $('summary').textContent = `${s1}${s2}擊球格是用手腕速度推估的，數字當作趨勢參考。`;
    const chips = [];
    d.primary.forEach((p) => chips.push(`<span class="chip bad">${esc(p.short)}<span class="mono">${p.applicable} 拍中 ${p.shots.length} 拍</span></span>`));
    d.secondary.slice(0, 2).forEach((p) => chips.push(`<span class="chip bad ref">${esc(p.short)}（參考）<span class="mono">${p.applicable} 拍中 ${p.shots.length} 拍</span></span>`));
    d.strengths.forEach((s) => chips.push(`<span class="chip ok">${esc(s.title)}${s.metric ? `<span class="mono">${s.of} 拍中 ${s.count} 拍</span>` : ''}</span>`));
    $('chips').innerHTML = chips.join('');
  }

  // ---------- 數值格式 ----------
  function fmtV(k, v, s) {
    if (!Number.isFinite(v)) return '—';
    if (k === 'follow' && s && s.type === 'drive') return v < 5 ? '非持拍側' : '持拍側';
    const M = A.METRICS[k];
    return (v > 0 && (k === 'serveH' || k === 'serveVy') ? '+' : '') + v.toFixed(M.dec) + (M.unit.startsWith('×') ? '×' : M.unit === '°' ? '°' : ' ' + M.unit);
  }
  const statusCls = (x) => (x === 'bad' ? 'bad' : x === 'warn' ? 'warn' : x === 'ok' ? 'ok' : 'na');

  // ---------- 選拍按鈕 / 表 / 卡片 ----------
  function buildShots() {
    const act = st.res.shots.filter((s) => !s.excluded);
    $('shots').innerHTML = act.map((s) => {
      const bad = s.badCount || 0, warn = Object.values(s.st).filter((v) => v === 'warn').length;
      const col = bad >= 2 ? 'var(--bad)' : bad === 1 || warn >= 2 ? 'var(--warn)' : 'var(--ok)';
      return `<button class="btn shotbtn" data-shot="${s.idx}" aria-pressed="false" title="${A.fmtTime(s.c / FPS)}"><span class="dot" style="background:${col}"></span><span class="n">#${s.idx + 1}</span>${A.TYPES[s.type].short}</button>`;
    }).join('') || '<span style="color:var(--sub);font-size:13px">沒有偵測到擊球</span>';
    $('shots').querySelectorAll('[data-shot]').forEach((b) => b.addEventListener('click', () => selectShot(+b.dataset.shot, true)));
  }
  const COLS = ['lean', 'knee', 'front', 'backswing', 'turn', 'ready', 'offhand', 'follow', 'stance'];
  function buildTable() {
    const act = st.res.shots.filter((s) => !s.excluded);
    const types = [...new Set(act.map((s) => s.type))];
    $('filters').innerHTML = [['all', '全部'], ...types.map((t) => [t, A.TYPES[t].name])].map(([k, l]) => `<button class="btn" data-f="${k}" aria-pressed="${st.filter === k}">${l}</button>`).join('');
    $('filters').querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { st.filter = b.dataset.f; buildTable(); }));
    const rows = act.filter((s) => st.filter === 'all' || s.type === st.filter);
    $('tbl').innerHTML = `<thead><tr><th>#</th><th>時間</th><th>球種</th><th>正／反手</th>${COLS.map((k) => `<th>${A.METRICS[k].label}</th>`).join('')}</tr></thead><tbody>` +
      rows.map((s) => `<tr data-shot="${s.idx}" class="${s.idx === st.shot ? 'cur' : ''}" tabindex="0"><td class="mono">${s.idx + 1}</td><td class="mono">${A.fmtTime(s.c / FPS)}</td><td>${A.TYPES[s.type].name}</td><td>${s.type === 'serve' ? '—' : s.backhand ? (s.twoHanded ? '雙手反手' : '反手') : '正手'}</td>` +
        COLS.map((k) => `<td class="${statusCls(s.st[k])}">${s.st[k] === 'na' ? '不適用' : fmtV(k, s.m[k], s)}</td>`).join('') + '</tr>').join('') + '</tbody>';
    $('tbl').querySelectorAll('tbody tr').forEach((tr) => {
      const go = () => { selectShot(+tr.dataset.shot, true); $('v3d').scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' }); };
      tr.addEventListener('click', go); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  }
  function buildShotCard(s) {
    if (!s) { $('scBody').textContent = '沒有可顯示的擊球。'; $('scTag').textContent = '—'; $('scSum').innerHTML = '<span class="tog"><span class="o">展開數據 ▾</span><span class="x">收合 ▴</span></span>'; return; }
    const cnt = { bad: 0, warn: 0, ok: 0 };
    Object.values(s.st).forEach((v) => { if (cnt[v] != null) cnt[v]++; });
    $('scSum').innerHTML = [['bad', '超標'], ['warn', '接近'], ['ok', '合格']].filter(([k]) => cnt[k]).map(([k, l]) => `<span class="c ${k}">${cnt[k]} ${l}</span>`).join('') + '<span class="tog"><span class="o">展開數據 ▾</span><span class="x">收合 ▴</span></span>';
    $('scTag').textContent = `#${s.idx + 1} ${A.TYPES[s.type].short}`;
    const hand = s.type === 'serve' ? '' : s.backhand ? (s.twoHanded ? '雙手反手' : '反手') : '正手';
    const keys = ['lean', 'knee', 'front', 'backswing', 'turn', 'ready', 'offhand', 'follow', 'serveH', 'serveVy', 'stance'].filter((k) => s.st[k] !== 'na');
    $('scBody').innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px"><span class="tag">${A.TYPES[s.type].name}${hand ? '・' + hand : ''}</span><span class="tag mono">${A.fmtTime(s.c / FPS)} · 第 ${s.c} 格</span><span class="tag est">擊球格推估</span></div>` +
      keys.map((k) => `<div class="mrow ${statusCls(s.st[k])}"><span class="nm">${A.METRICS[k].label}</span><span class="vv"><span class="p">${fmtV(k, s.m[k], s)}</span> → <span class="c">${fmtV(k, s.cm?.[k], s)}</span></span><span class="tg">目標 ${A.target(k, s.type)}</span></div>`).join('');
  }

  // ---------- 問題卡片 ----------
  const TGT_NUM = {
    lean: (s) => ((s.type === 'dink' || s.type === 'drop' || s.type === 'serve') ? 20 : 15),
    knee: (s) => ((s.type === 'dink' || s.type === 'drop' || s.type === 'volley') ? 145 : s.type === 'serve' ? 155 : 150),
    front: () => 20, backswing: (s) => (s.type === 'drive' ? 90 : 30), turn: () => 40, ready: () => -35, offhand: () => -5,
    follow: (s) => (s.type === 'drive' ? 5 : 0), serveH: () => 0, serveVy: () => 0, stance: () => 1.3,
  };
  function barChart(p) {
    const act = st.res.shots.filter((s) => !s.excluded);
    const W = 320, H = 110, padL = 30, padB = 18, padT = 10, n = act.length;
    const vals = act.map((s) => (s.st[p.metric] === 'na' ? NaN : s.m[p.metric]));
    const tg = act.map((s) => TGT_NUM[p.metric](s));
    const base0 = p.metric === 'knee' ? 90 : 0;
    const all = [...vals.filter(Number.isFinite), ...tg, base0];
    let lo = Math.min(...all), hi = Math.max(...all); const pad = (hi - lo) * 0.12 || 1; hi += pad; if (lo < 0) lo -= pad;
    const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
    const bw = (W - padL - 6) / Math.max(n, 1);
    let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(A.METRICS[p.metric].label)} 每一拍數值">`;
    out += `<line x1="${padL}" x2="${W - 4}" y1="${y(base0)}" y2="${y(base0)}" stroke="#2a4457" stroke-width="1"/>`;
    const ticks = [lo, hi].map((v) => Math.round(v));
    ticks.forEach((v) => { out += `<text x="${padL - 4}" y="${y(v) + 3}" text-anchor="end" font-size="8.5" fill="#7F97A6" font-family="IBM Plex Mono,monospace">${v}</text>`; });
    act.forEach((s, i) => {
      const x = padL + i * bw + bw * 0.18, w = bw * 0.64, v = vals[i], stt = s.st[p.metric];
      const cx = x + w / 2;
      if (!Number.isFinite(v)) {
        out += `<text x="${cx}" y="${y(base0) - 4}" text-anchor="middle" font-size="${n > 10 ? 6 : 8}" fill="#46606f">${n > 12 ? '–' : '不適用'}</text>`;
      } else {
        const col = stt === 'bad' ? '#FF4D6D' : stt === 'warn' ? '#FF9F43' : '#7BE0A8';
        const y0 = y(base0), y1 = y(v);
        out += `<rect x="${x}" y="${Math.min(y0, y1)}" width="${w}" height="${Math.max(1.5, Math.abs(y1 - y0))}" rx="2" fill="${col}" fill-opacity="${stt === 'ok' ? 0.55 : 0.9}"/>`;
      }
      out += `<line x1="${x - bw * 0.1}" x2="${x + w + bw * 0.1}" y1="${y(tg[i])}" y2="${y(tg[i])}" stroke="#DCE8EE" stroke-width="1.2" stroke-dasharray="3 2" opacity=".8"/>`;
      if (n <= 16 || i % 2 === 0) out += `<text x="${cx}" y="${H - 5}" text-anchor="middle" font-size="8.5" fill="${p.shots.includes(s.idx) ? '#FF4D6D' : '#7F97A6'}" font-family="IBM Plex Mono,monospace">${s.idx + 1}</text>`;
    });
    return out + `</svg><div style="font-size:12.5px;color:#9fb3c0">每根是一拍（下方數字是第幾拍）；白色虛線＝目標；單位 ${esc(A.METRICS[p.metric].unit)}</div>`;
  }
  function problemCard(p) {
    const act = st.res.shots.filter((s) => !s.excluded);
    const bad = act.filter((s) => p.shots.includes(s.idx));
    const cls = p.severity === '高' ? '' : p.severity === '中' ? 'mid' : 'ref';
    const vals = bad.map((s) => `第 ${s.idx + 1} 拍 <span class="mono">${fmtV(p.metric, s.m[p.metric], s)}</span>`).join('、');
    const tgts = [...new Set(bad.map((s) => A.target(p.metric, s.type)))].join(' / ');
    return `<article class="pcard ${cls}"><header><h3>${esc(p.title)}</h3><span class="sev ${cls}">${p.severity === '參考' ? '參考' : '影響 ' + p.severity}</span></header>
      <p class="data">${p.applicable} 拍中有 ${p.shots.length} 拍超標：${vals}。目標 ${esc(tgts)}。</p>
      ${barChart(p)}
      <dl><dt>為什麼</dt><dd>${esc(p.why)}</dd><dt>改法</dt><dd>${esc(p.fix)}</dd><dt>練習</dt><dd>${esc(p.drill)}</dd></dl>
      <div class="act"><button class="btn" data-demo="${p.id}">看示範（第 ${p.demo + 1} 拍）</button></div></article>`;
  }
  function buildProblems() {
    const d = st.res.diag;
    $('problems').innerHTML = d.primary.map(problemCard).join('') || '<p style="color:var(--sub)">沒有任何問題在 2 拍以上重複出現。下面的逐拍數據還是可以看看哪些項目接近邊界（<span style="color:var(--warn)">橘字</span>）。</p>';
    $('minor').innerHTML = d.secondary.length ? `<h3 style="font-size:15px;margin:10px 0">次要（只出現 1 拍，當參考）</h3><div class="grid2">${d.secondary.map(problemCard).join('')}</div>` : '';
    document.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => {
      const p = [...d.primary, ...d.secondary].find((x) => x.id === b.dataset.demo);
      setView(p.view); selectShot(p.demo, true);
      $('v3d').scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' });
    }));
  }
  function buildGoods() {
    const d = st.res.diag;
    $('goods').innerHTML = d.strengths.map((s) => `<article class="scard"><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p><span class="mono">${s.metric ? `${s.of} 拍中 ${s.count} 拍做到` : '整體最標準'}</span></article>`).join('') || '<p style="color:var(--sub)">拍數太少，還看不出穩定的好習慣。</p>';
  }
  function buildQC() {
    const res = st.res;
    const opts = Object.entries(A.TYPES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('');
    $('handSel').innerHTML = `<option value="auto">從影片判斷（${res.hand === 'R' ? '右手' : '左手'}）</option><option value="R">右手</option><option value="L">左手</option>`;
    $('handSel').value = st.hand;
    $('qc').innerHTML = res.shots.map((s) => `<div class="qcard ${s.excluded ? 'ex' : ''}" data-peak="${s.peak}">
      <canvas width="480" height="170" data-thumb="${s.peak}"></canvas>
      <div class="r"><b style="font-weight:500">#${s.idx + 1} · <span class="mono">${A.fmtTime(s.c / FPS)}</span>${s.excluded ? ' <span class="extag">已排除</span>' : ''}</b><span class="mono" style="color:var(--sub);font-size:11.5px">手腕 ${s.speed.toFixed(1)} m/s${s.big ? '' : '（輕打）'}</span></div>
      <div class="r"><select aria-label="第 ${s.idx + 1} 拍球種" data-type="${s.peak}" ${s.excluded ? 'disabled' : ''}>${opts}</select>
      <label><input type="checkbox" data-ex="${s.peak}" ${s.excluded ? 'checked' : ''}> 不是擊球</label></div></div>`).join('') || '<p style="color:var(--sub)">沒有偵測到擊球。</p>';
    res.shots.forEach((s) => { const sel = $('qc').querySelector(`[data-type="${s.peak}"]`); if (sel) sel.value = s.type; });
    $('qc').querySelectorAll('[data-type]').forEach((sel) => sel.addEventListener('change', () => { const k = sel.dataset.type; st.overrides[k] = { ...(st.overrides[k] || {}), type: sel.value };
      const n = res.shots.find((x) => String(x.peak) === k).idx + 1;
      st.qcMsg = `✓ 已更新：第 ${n} 拍改成「${A.TYPES[sel.value].name}」，所有數據已重新計算。`; analyzeAndBuild(false); }));
    $('qc').querySelectorAll('[data-ex]').forEach((cb) => cb.addEventListener('change', () => { const k = cb.dataset.ex; st.overrides[k] = { ...(st.overrides[k] || {}), excluded: cb.checked };
      const n = res.shots.find((x) => String(x.peak) === k).idx + 1;
      analyzeAndBuild(false);
      const left = st.res.shots.filter((x) => !x.excluded).length;
      $('qcMsg').textContent = cb.checked ? `✓ 已更新：第 ${n} 拍已排除，現在用 ${left} 拍重新計算所有數據（標頭、問題、逐拍數據、矯正版都已更新）。` : `✓ 已更新：第 ${n} 拍已加回，現在用 ${left} 拍重新計算所有數據。`;
      $('qcMsg').hidden = false; }));
    if (st.qcMsg) { $('qcMsg').textContent = st.qcMsg; $('qcMsg').hidden = false; st.qcMsg = null; }
    for (const [peak, bmp] of Object.entries(st.thumbs)) { const cv = $('qc').querySelector(`[data-thumb="${peak}"]`); if (cv) cv.getContext('2d').drawImage(bmp, 0, 0); }
  }
  $('handSel').addEventListener('change', () => { st.hand = $('handSel').value; st.overrides = {}; st.thumbs = {}; analyzeAndBuild(false); makeThumbs(); });

  function buildMethod() {
    const { res, raw } = st, act = res.shots.filter((s) => !s.excluded);
    const APPLIED = { bend: '上半身繞髖中點扶正到目標前傾', legs: '擊球前髖部下降最多 10 cm，腳踝固定、用大腿與小腿長度不變的兩段式反向運動學重算膝蓋', late: '擊球前 6 格到後 2 格，持拍手前移到離髖中點約 25 cm', swing: '小球／截擊的引拍路徑按比例縮短到 25 cm 內', turn: '抽球前上半身多轉到約 45°（髖跟著 40%、膝 20%）', drop: '兩拍之間持拍手移到胸口高度、身體前方約 30 cm', offhand: '擊球時非持拍手收回身體前方', follow: '小球／吊球收拍往前送、最高點限制在胸口', serve: '發球擊球點壓到肚臍以下' };
    const li = [
      `<b>影片</b>：${esc(raw.name)}，${raw.srcW}×${raw.srcH}，${raw.duration.toFixed(1)} 秒，瀏覽器自動轉正方向，統一以 30fps 取樣共 ${raw.N} 格。`,
      `<b>姿勢偵測</b>：MediaPipe Pose Landmarker（${st.model === 'heavy' ? 'heavy' : 'full'}，float16，${window.PBPose?.delegate || ''}），每格 33 個關節點（2D + 3D）。以上一格關節外框 ×2.2 的正方形裁切追蹤、放大到 768 px 再偵測；髖中點跳動超過身高 40% 視為追到別人，丟棄改用插值。`,
      `<b>偵測結果</b>：${raw.N - raw.filled} 格直接抓到、${raw.filled} 格（${(raw.filled / raw.N * 100).toFixed(1)}%）用前後格線性插值補齊；因疑似追到隊友而丟棄 ${raw.jumps} 次；處理時間 ${raw.seconds.toFixed(0)} 秒。`,
      `<b>找擊球</b>：3D 座標先做 5 格移動平均，找持拍手腕速度的局部最大值（±8 格）。> 3 m/s 算大動作（抽球、扣殺、發球），1.2–3 m/s 算小動作（小球、截擊、吊球）。慣用手${res.handAuto ? '由兩手速度自動判斷為' : '由你指定為'}${res.hand === 'R' ? '右手' : '左手'}。`,
      `<b>擊球格全部是推估</b>：匹克球是洞洞塑膠球，網頁無法確認球碰到拍面的那一格，一律用速度峰值 +1 格，並標「推估」。球種也是自動判斷，可以在「擊球確認」修改。`,
      `<b>單一鏡頭的 3D 誤差</b>：角度約 ±5–10°，距離約 ±5–10 cm。正面拍攝時，「轉肩」「擊球點在身前」這類水平轉動與前後距離的數字誤差更大，當參考就好。肚臍高度以髖中點往上 10 cm 估計。`,
      `<b>球拍位置是推估</b>：從手腕沿「前臂方向 55% + 手掌方向 45%」延伸畫出，不是真的偵測到球拍。`,
      `<b>場地只是背景</b>：單一鏡頭無法得知球員在場上的實際位置，球場依該拍的擊球方向擺在球員前方合理的位置。`,
      `<b>矯正版</b>：用你自己的動作資料修改，不是套模板，而且只修和診斷出的問題有關的部分（其他保留原本節奏），每段用平滑曲線過渡。這次做了：${res.applied.length ? res.applied.map((k) => APPLIED[k]).join('；') : '沒有需要修正的項目'}。`,
      `<b>原始影片（疊骨架）</b>：以髖中點為中心裁切（31 格移動平均避免晃動），裁切邊長＝身體像素高度 ×2.3，只畫目標球員的骨架；時間軸以影片時間 ×30 對齊每一格。`,
    ];
    $('method').innerHTML = li.map((x) => `<li>${x}</li>`).join('');
  }
  function buildAll() {
    buildHeader(); buildShots(); buildProblems(); buildGoods(); buildTable(); buildQC(); buildMethod();
    ['secProblems', 'secGood', 'secTable', 'secQC', 'secMethod'].forEach((id) => { $(id).hidden = false; });
    const has = st.res.shots.some((s) => !s.excluded);
    $('controls').hidden = false; $('hudL').hidden = !has; $('hudR').hidden = !has; $('empty3d').hidden = has;
    if (!has) { figP.root.visible = figC.root.visible = false; clearGroup(annP); clearGroup(annC); st.callouts?.forEach((c) => c.el.remove()); st.callouts = null; }
    ring.visible = disk.visible = arrow.visible = has;
  }

  // ---------- 品質檢查縮圖 ----------
  async function makeThumbs() {
    const res = st.res, raw = st.raw, P = window.PBPose;
    const token = (st.thumbToken = (st.thumbToken || 0) + 1);
    for (const s of res.shots) {
      if (st.thumbs[s.peak]) continue;
      const cv = document.createElement('canvas'); cv.width = 480; cv.height = 170;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#05090d'; ctx.fillRect(0, 0, 480, 170);
      const fr = [s.c - 4, s.c, s.c + 4].map((f) => Math.max(0, Math.min(raw.N - 1, f)));
      for (let i = 0; i < 3; i++) {
        if (token !== st.thumbToken) return;
        const f = fr[i], I = raw.img[f];
        const side = res.overlay.side[f] * 0.95, cx = res.overlay.cx[f], cy = res.overlay.cy[f] - side * 0.05;
        const crop = { x: cx - side / 2, y: cy - side / 2, side };
        const sub = document.createElement('canvas'); sub.width = sub.height = 160;
        await P.grabFrame(vA, f / FPS, sub, crop);
        const c2 = sub.getContext('2d');
        drawSkeleton(c2, I, crop, 160, res.hand, true, i === 1);
        ctx.drawImage(sub, i * 160, 5);
        ctx.fillStyle = i === 1 ? '#FFD23F' : '#7F97A6'; ctx.font = '11px IBM Plex Mono, monospace';
        ctx.fillText(i === 1 ? `擊球 ${f}` : `${f - s.c > 0 ? '+' : ''}${f - s.c}`, i * 160 + 6, 18);
      }
      st.thumbs[s.peak] = cv;
      const tgt = $('qc').querySelector(`[data-thumb="${s.peak}"]`); if (tgt) tgt.getContext('2d').drawImage(cv, 0, 0);
    }
  }
  function drawSkeleton(ctx, I, crop, size, hand, qc, emph, ref) {
    const lw = ref || size;
    const k = size / crop.side, px = (j) => [(I[j * 3] - crop.x) * k, (I[j * 3 + 1] - crop.y) * k];
    const racket = hand === 'L' ? new Set([11, 13, 15, 19, 23, 25, 27, 29, 31]) : new Set([12, 14, 16, 20, 24, 26, 28, 30, 32]);
    ctx.lineCap = 'round';
    for (const pass of [0, 1]) {
      for (const [a, b] of BONES) {
        const pa = px(a), pb = px(b);
        const rk = qc && racket.has(a) && racket.has(b);
        ctx.strokeStyle = pass === 0 ? 'rgba(255,210,63,0.28)' : rk ? '#FF9F43' : '#FFD23F';
        ctx.lineWidth = pass === 0 ? lw / 60 : Math.max(1.5, lw / 180);
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
      }
    }
    ctx.fillStyle = '#fff';
    for (const j of A.KEEP) { const p = px(j); ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(1.4, lw / 200), 0, Math.PI * 2); ctx.fill(); }
    if (emph) { ctx.strokeStyle = '#FFD23F'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, size - 2, size - 2); }
  }

  // ================= 播放 =================
  function setupPlayback() {
    vP.src = st.url; vP.muted = true; vP.playsInline = true;
    st.videoOk = true;
    vP.onerror = () => { if (vP.error && vP.error.code >= 3) st.videoOk = false; };
    vP.playbackRate = st.speed;
    // 以「畫面上實際顯示的那一格」的時間當主時鐘：iPhone Safari 播 HEVC 時 currentTime 可能卡住好幾秒，
    // 但影片畫面照樣在動，骨架就會對不上。requestVideoFrameCallback 回報的 mediaTime 是真正顯示中的格。
    st.vfTime = null;
    if (!st.vfHooked && 'requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      st.vfHooked = true;
      const onFrame = (now, meta) => { st.vfTime = meta.mediaTime; st.vfWall = performance.now(); vP.requestVideoFrameCallback(onFrame); };
      vP.requestVideoFrameCallback(onFrame);
    }
  }
  // 目前影片時間：播放中且有實際顯示格的回報時用它，否則（暫停、拖時間軸、剛跳格）用 currentTime
  function videoTime() {
    if (st.vfTime != null && !vP.paused && !vP.seeking && performance.now() - st.vfWall < 500) return st.vfTime;
    return vP.currentTime;
  }
  function curShot() { return st.res?.shots.find((s) => s.idx === st.shot && !s.excluded) || null; }
  function selectShot(i, autoplay) {
    st.shot = i;
    const s = curShot();
    document.querySelectorAll('#shots [data-shot]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.shot === i)));
    document.querySelectorAll('#tbl tbody tr').forEach((tr) => tr.classList.toggle('cur', +tr.dataset.shot === i));
    buildShotCard(s);
    if (!s) return;
    const fwd = s.x.fwd;
    placeCourt(fwd, s.type);
    arrow.rotation.y = Math.atan2(fwd[0], fwd[2]);
    buildTimeline(s); buildHudRows(s); buildAnnotations(s);
    applyView(true);
    st.frozen = false; st.frozeDone = false; $('impact').hidden = true;
    seekFrame(s.start);
    st.lastF = s.start;
    if (autoplay && !RM) play(); else pause();
  }
  function seekFrame(f) {
    st.clockT = f / FPS; st.vfTime = null; // 跳格後等新的一格顯示再用它的時間

    if (st.videoOk && vP.readyState >= 1) vP.currentTime = f / FPS;
  }
  function startVideo() {
    if (!st.videoOk) return;
    vP.playbackRate = st.speed;
    vP.play().catch((e) => {
      if (e && e.name === 'NotSupportedError') { st.videoOk = false; return; }
      if (e && e.name === 'NotAllowedError') { pause(); return; } // 瀏覽器擋自動播放，等使用者按播放
      // 還在載入（AbortError）：可以播時再試一次
      vP.addEventListener('canplay', () => { if (st.playing && !st.frozen && vP.paused) vP.play().catch(() => {}); }, { once: true });
    });
  }
  function play() { st.playing = true; $('playBtn').textContent = '❚❚ 暫停'; $('playBtn').setAttribute('aria-pressed', 'true'); startVideo(); }
  function pause() { st.playing = false; st.frozen = false; $('impact').hidden = true; $('playBtn').textContent = '▶ 播放'; $('playBtn').setAttribute('aria-pressed', 'false'); vP.pause(); }
  $('playBtn').addEventListener('click', () => (st.playing ? pause() : play()));
  $('speedSeg').querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { st.speed = +b.dataset.speed; vP.playbackRate = st.speed; setSegPressed($('speedSeg'), 'speed', b.dataset.speed); }));
  $('modeSeg').querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.mode; setSegPressed($('modeSeg'), 'mode', st.mode); applyMode(); }));
  $('viewSeg').querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('freezeBtn').addEventListener('click', () => { st.freeze = !st.freeze; $('freezeBtn').setAttribute('aria-pressed', String(st.freeze)); $('freezeBtn').textContent = `擊球定格：${st.freeze ? '開' : '關'}`; if (!st.freeze && st.frozen) { st.frozen = false; $('impact').hidden = true; if (st.playing) startVideo(); } });
  function setRatio(r, save) {
    $('stage').dataset.ratio = r; setSegPressed($('ratioSeg'), 'ratio', r);
    st.callouts?.forEach((c) => { c.w = 0; });
    if (save) { try { localStorage.setItem('pb-ratio', r); } catch (e) { /* 無法儲存就算了 */ } }
  }
  $('ratioSeg').querySelectorAll('[data-ratio]').forEach((b) => b.addEventListener('click', () => setRatio(b.dataset.ratio, true)));
  try { const r = localStorage.getItem('pb-ratio'); if (r && ['4:6', '5:5', '6:4'].includes(r)) setRatio(r, false); } catch (e) { /* 沒有儲存的偏好 */ }
  function setView(v) { st.view = v; setSegPressed($('viewSeg'), 'view', v); applyView(false); }

  let camTween = null;
  function applyView(instant) {
    const s = curShot(); if (!s) return;
    const fwd = tv(s.x.fwd), side = new THREE.Vector3().crossVectors(Y, fwd).normalize();
    const tgt = new THREE.Vector3(0, 0.95, 0);
    let pos;
    if (st.view === 'front') pos = tgt.clone().add(fwd.clone().multiplyScalar(4.4)).add(new THREE.Vector3(0, 0.35, 0));
    else if (st.view === 'side') pos = tgt.clone().add(side.clone().multiplyScalar(-4.4)).add(new THREE.Vector3(0, 0.3, 0));
    else if (st.view === 'top') pos = tgt.clone().add(new THREE.Vector3(0, 5.2, 0)).add(fwd.clone().multiplyScalar(-0.6));
    else pos = new THREE.Vector3(0, 1.3, 4.6);
    if (instant || RM) { camera.position.copy(pos); controls.target.copy(tgt); controls.update(); camTween = null; }
    else camTween = { from: camera.position.clone(), to: pos, ft: controls.target.clone(), tt: tgt, t0: performance.now(), dur: 650 };
    applyMode();
  }
  function applyMode() {
    const m = st.mode;
    figP.root.visible = m !== 'fix'; figC.root.visible = m !== 'player' && !!st.res;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const right = new THREE.Vector3().crossVectors(dir, Y).normalize();
    if (m === 'side') { figP.root.position.copy(right.clone().multiplyScalar(-0.55)); figC.root.position.copy(right.clone().multiplyScalar(0.55)); }
    else { figP.root.position.set(0, 0, 0); figC.root.position.set(0, 0, 0); }
  }
  // 時間軸
  function phaseOf(s, f) { const t = f - s.c; return t < -15 ? '準備' : t < -2 ? '引拍' : t <= 2 ? '擊球' : '收拍'; }
  function buildTimeline(s) {
    const span = s.end - s.start || 1;
    const segs = [['準備', s.start, Math.max(s.start, s.c - 15), '#1f3a4c'], ['引拍', Math.max(s.start, s.c - 15), s.c - 2, '#5a3a2e'], ['擊球', s.c - 2, Math.min(s.end, s.c + 2), '#8a6a1f'], ['收拍', Math.min(s.end, s.c + 2), s.end, '#1f4a44']];
    $('tlSegs').innerHTML = segs.map(([l, a, b, c]) => `<div style="width:${(b - a) / span * 100}%;background:${c}">${(b - a) / span > 0.12 ? `<span>${l}</span>` : ''}</div>`).join('');
    $('tlImp').style.left = `${(s.c - s.start) / span * 100}%`;
    const sc = $('scrub'); sc.min = s.start; sc.max = s.end; sc.value = s.start;
  }
  $('scrub').addEventListener('input', () => { if (st.playing) pause(); seekFrame(+$('scrub').value); });

  // ---------- HUD ----------
  const LIVE_FOR = { bend: 'lean', legs: 'knee', late: 'front', drop: 'ready', offhand: 'offhand', stance: 'stance' };
  function buildHudRows(s) {
    const probs = [...st.res.diag.primary, ...st.res.diag.secondary];
    const rows = [];
    for (const p of probs) { const k = LIVE_FOR[p.id] || p.metric; if (!rows.includes(k) && s.st[k] !== 'na') rows.push(k); }
    for (const k of ['lean', 'knee', 'front', 'ready']) if (rows.length < 4 && !rows.includes(k) && s.st[k] !== 'na') rows.push(k);
    st.hudRows = rows.slice(0, 4);
    $('hudL').innerHTML = `<table><thead><tr><th></th><th>球員</th><th>矯正</th></tr></thead><tbody>${st.hudRows.map((k) => `<tr data-k="${k}"><td>${A.METRICS[k].label}</td><td class="p">—</td><td class="c">—</td></tr>`).join('')}</tbody></table>`;
    st.hudCells = st.hudRows.map((k) => { const tr = $('hudL').querySelector(`tr[data-k="${k}"]`); return [tr.children[1], tr.children[2]]; });
  }
  const LIVE_KEYS = new Set(['lean', 'knee', 'front', 'ready', 'offhand', 'stance']);
  function liveHot(k, v, s, t) {
    if (!Number.isFinite(v)) return false;
    if (k === 'front' && Math.abs(t) > 3) return false;
    if (k === 'knee' && (t < -15 || t > 0)) return false;
    if (k === 'ready' && t >= -15 && t <= 12) return false;
    if (k === 'offhand' && Math.abs(t) > 4) return false;
    const x = A.status(k, s.type, v, { readyF: 10, followAng: 0, followCross: true });
    return x === 'bad' || (k === 'lean' && x === 'warn');
  }
  function updateHud(s, f, FP, FC) {
    const H = st.res.H, lp = A.live(FP, H, s.x.fwd), lc = A.live(FC, H, s.x.fwd), t = f - s.c;
    st.hudRows.forEach((k, i) => {
      const [cp, cc] = st.hudCells[i];
      let vp, vc;
      if (LIVE_KEYS.has(k)) { vp = lp[k]; vc = lc[k]; } else { vp = s.m[k]; vc = s.cm?.[k]; }
      cp.textContent = fmtV(k, vp, s); cc.textContent = fmtV(k, vc, s);
      cp.classList.toggle('hot', LIVE_KEYS.has(k) ? liveHot(k, vp, s, t) : s.st[k] === 'bad');
    });
    $('hudType').textContent = `#${s.idx + 1} ${A.TYPES[s.type].name}`;
    $('hudPhase').textContent = phaseOf(s, f);
    $('hudTc').textContent = `${A.fmtTime(f / FPS)} · F${String(Math.round(f)).padStart(4, '0')}`;
  }

  // ---------- 出問題部位 ----------
  const ALERT_WIN = { bend: [-8, 4], legs: [-15, 0], late: [-4, 2], swing: [-15, -1], turn: [-20, -3], offhand: [-5, 3], follow: [1, 12], serve: [-3, 2], stance: [-3, 3] };
  function alertParts(s, f) {
    const out = new Set(), t = f - s.c;
    for (const p of [...st.res.diag.primary, ...st.res.diag.secondary]) {
      if (!(s.st[p.metric] === 'bad' || s.st[p.metric] === 'warn')) continue;
      let on;
      if (p.id === 'drop') on = t < -15 || t > 12; else { const w = ALERT_WIN[p.id]; on = t >= w[0] && t <= w[1]; }
      if (on) p.parts.forEach((x) => out.add(x));
    }
    return out;
  }

  // ---------- 定格標註 ----------
  function buildAnnotations(s) {
    clearGroup(annP); clearGroup(annC); targetRings.length = 0;
    const res = st.res, H = res.H, c = s.c;
    const FP = lift(res.S[c], res.gP[c]), FC = lift(res.C[c], res.gC[c]);
    const g = (F, j) => tv(V.get(F, j));
    const hmP = tv(A.hipMid(FP)), hmC = tv(A.hipMid(FC));
    // 上身前傾
    arc(annP, hmP, [0, 1, 0], V.sub(A.shMid(FP), A.hipMid(FP)), 0.38, COL.player, 0.14);
    arc(annC, hmC, [0, 1, 0], V.sub(A.shMid(FC), A.hipMid(FC)), 0.31, COL.fix, 0.12);
    dashed(annP, hmP, hmP.clone().add(new THREE.Vector3(0, 0.68, 0)), 0xDCE8EE, 0.6);
    // 膝蓋
    const kneeSide = A.kneeAng(FP, 'L') < A.kneeAng(FP, 'R') ? 'L' : 'R';
    const kj = kneeSide === 'L' ? [23, 25, 27] : [24, 26, 28];
    for (const [F, grp, col] of [[FP, annP, COL.player], [FC, annC, COL.fix]]) {
      const k = g(F, kj[1]);
      arc(grp, k, V.sub(V.get(F, kj[0]), V.get(F, kj[1])), V.sub(V.get(F, kj[2]), V.get(F, kj[1])), 0.13, col, 0.16);
    }
    // 擊球點前後距離：地面虛線
    for (const [F, grp, col, hm] of [[FP, annP, COL.player, hmP], [FC, annC, COL.fix, hmC]]) {
      const w = g(F, H.wr);
      const a = new THREE.Vector3(hm.x, 0.012, hm.z), fw = tv(s.x.fwd), d = w.clone().sub(hm).dot(fw);
      dashed(grp, a, a.clone().add(fw.multiplyScalar(d)), col, 0.95);
    }
    // 發球：肚臍高度線
    if (s.type === 'serve') {
      const ny = hmP.y + 0.10, sd = tv(s.x.side);
      dashed(annP, new THREE.Vector3(hmP.x, ny, hmP.z).add(sd.clone().multiplyScalar(-0.45)), new THREE.Vector3(hmP.x, ny, hmP.z).add(sd.clone().multiplyScalar(0.45)), COL.player, 0.95);
    }
    // 目標圈：準備姿勢、收拍
    const fr = Math.max(0, c - 16), ff = Math.min(res.n - 1, c + 10);
    const wP = g(FP, H.wr);
    for (const f of [fr, ff]) {
      const Fc = lift(res.C[f], res.gC[f]);
      const pos = g(Fc, H.wr);
      targetRing(annC, pos, COL.fix);
      dashed(annC, pos, wP, COL.fix, 0.7);
    }
    // HTML 標註框
    const probMetrics = new Set([...res.diag.primary, ...res.diag.secondary].map((p) => p.metric));
    const cand = [
      ['lean', () => tv(A.shMid(FP))], ['knee', () => g(FP, kj[1])], ['front', () => g(FP, H.wr)], ['backswing', () => g(FP, H.el)],
      ['turn', () => g(FP, H.sh)], ['offhand', () => g(FP, H.owr)], ['serveH', () => g(FP, H.wr).add(new THREE.Vector3(0, -0.04, 0))],
      ['follow', () => g(FP, H.el).add(new THREE.Vector3(0, 0.05, 0))], ['stance', () => g(FP, kneeSide === 'L' ? 28 : 27)],
    ].filter(([k]) => s.st[k] !== 'na' && s.st[k] !== undefined);
    cand.sort((a, b) => (probMetrics.has(b[0]) - probMetrics.has(a[0])) || ((s.st[b[0]] !== 'ok') - (s.st[a[0]] !== 'ok')));
    const items = cand.slice(0, window.innerWidth < 560 ? 4 : 5);
    const layer = $('callouts');
    layer.querySelectorAll('.co').forEach((n) => n.remove());
    st.callouts = items.map(([k, anc]) => {
      const el = document.createElement('div'); el.className = `co ${statusCls(s.st[k])}`;
      el.innerHTML = `<span class="t">${A.METRICS[k].label} · 目標 ${esc(A.target(k, s.type))}</span><span class="v"><span class="p">${fmtV(k, s.m[k], s)}</span> → <span class="c">${fmtV(k, s.cm?.[k], s)}</span></span>`;
      el.hidden = true; layer.appendChild(el);
      return { el, anchor: anc(), k, w: 0, h: 0 };
    });
    annP.visible = annC.visible = false;
  }
  function project(v, w, h) {
    const p = v.clone().project(camera);
    return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h, p.z];
  }
  function layoutCallouts(show) {
    const svg = $('coSvg');
    if (!show || !st.callouts) { svg.innerHTML = ''; st.callouts?.forEach((c) => { c.el.hidden = true; }); return; }
    const w = host.clientWidth, h = host.clientHeight;
    const hostR = host.getBoundingClientRect();
    const rectOf = (el) => { if (el.hidden) return null; const r = el.getBoundingClientRect(); return { x0: r.left - hostR.left, y0: r.top - hostR.top, x1: r.right - hostR.left, y1: r.bottom - hostR.top }; };
    const hudL = rectOf($('hudL')), hudR = rectOf($('hudR')), leg = rectOf($('legend'));
    // 人形在螢幕上的範圍
    let x0 = 1e9, x1 = -1e9;
    const figs = [figP, figC].filter((f) => f.root.visible);
    for (const f of figs) for (const q of f.joints) { const p = project(q.m.getWorldPosition(new THREE.Vector3()), w, h); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
    for (const f of figs) { const p = project(f.head.getWorldPosition(new THREE.Vector3()), w, h); x0 = Math.min(x0, p[0] - 12); x1 = Math.max(x1, p[0] + 12); }
    x0 -= 16; x1 += 16;
    const off = figP.root.position;
    const items = st.callouts.map((c) => {
      c.el.hidden = false;
      if (!c.w) { c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; }
      const a = project(c.anchor.clone().add(off), w, h);
      return { c, ax: a[0], ay: a[1] };
    });
    const cx = (x0 + x1) / 2, G = 12, M = 8;
    const fits = (side, bw) => (side === 'L' ? x0 - G - bw >= M : x1 + G + bw <= w - M);
    const cols = { L: [], R: [] };
    for (const it of items) {
      let side = it.ax < cx ? 'L' : 'R';
      if (!fits(side, it.c.w)) side = fits(side === 'L' ? 'R' : 'L', it.c.w) ? (side === 'L' ? 'R' : 'L') : (x0 > w - x1 ? 'L' : 'R');
      cols[side].push(it);
    }
    const colX = (side, bw) => (side === 'L' ? Math.max(M, x0 - G - bw) : Math.min(w - M - bw, x1 + G));
    const overlapsX = (r, xa, xb) => r && xb > r.x0 && xa < r.x1;
    const bounds = (side, bw) => {
      const xa = colX(side, bw), xb = xa + bw;
      let top = M, bot = h - M;
      if (overlapsX(hudL, xa, xb)) top = Math.max(top, hudL.y1 + M);
      if (overlapsX(hudR, xa, xb)) top = Math.max(top, hudR.y1 + M);
      if (overlapsX(leg, xa, xb)) bot = Math.min(bot, leg.y0 - M);
      return [top, bot];
    };
    const need = (arr) => arr.reduce((a, it) => a + it.c.h + M, -M);
    for (const [a, b] of [['L', 'R'], ['R', 'L']]) {
      while (cols[a].length > 1) {
        const bw = Math.max(...cols[a].map((i) => i.c.w)), [t0, b0] = bounds(a, bw);
        if (need(cols[a]) <= b0 - t0) break;
        const other = [...cols[b], cols[a][0]], ow = Math.max(...other.map((i) => i.c.w)), [t1, b1] = bounds(b, ow);
        if (need(other) > b1 - t1) break;
        cols[a].sort((p, q) => Math.abs(p.ax - cx) - Math.abs(q.ax - cx));
        cols[b].push(cols[a].shift());
      }
    }
    let lines = '';
    for (const side of ['L', 'R']) {
      const arr = cols[side].sort((p, q) => p.ay - q.ay);
      if (!arr.length) continue;
      const bw = Math.max(...arr.map((i) => i.c.w));
      const [top, bot] = bounds(side, bw);
      let y = top;
      for (const it of arr) { it.y = Math.max(it.ay - it.c.h / 2, y); y = it.y + it.c.h + M; }
      let lim = bot;
      for (let i = arr.length - 1; i >= 0; i--) { const it = arr[i]; if (it.y + it.c.h > lim) it.y = lim - it.c.h; lim = it.y - M; }
      for (const it of arr) {
        const bx = side === 'L' ? colX(side, bw) + (bw - it.c.w) : colX(side, bw);
        it.c.el.style.left = `${bx}px`; it.c.el.style.top = `${it.y}px`;
        const ex = side === 'L' ? bx + it.c.w : bx, ey = it.y + it.c.h / 2, kx = side === 'L' ? ex + 10 : ex - 10;
        const col = it.c.el.classList.contains('bad') ? '#FF4D6D' : it.c.el.classList.contains('warn') ? '#FF9F43' : '#7BE0A8';
        lines += `<polyline points="${ex},${ey} ${kx},${ey} ${it.ax},${it.ay}" fill="none" stroke="${col}" stroke-width="1.2" opacity=".85"/><circle cx="${it.ax}" cy="${it.ay}" r="2.6" fill="${col}"/><circle cx="${it.ax}" cy="${it.ay}" r="6" fill="none" stroke="${col}" stroke-width="1" opacity=".6"/>`;
      }
    }
    svg.innerHTML = lines;
  }

  // ---------- 疊骨架影片 ----------
  const ovCv = $('ovCv'), ovCtx = ovCv.getContext('2d');
  // 縮放與拖曳：zoom 相對於「以球員為中心的預設裁切」，pan 是原影片像素的位移
  const ov = { zoom: 1, panX: 0, panY: 0, k: 1, W: 540, H: 540 };
  const clampZoom = (z) => Math.max(0.3, Math.min(6, z));
  function zoomAt(z, cx, cy) {
    // 讓 (cx, cy) 這個畫面位置下的影片內容維持不動
    const nz = clampZoom(z), k0 = ov.k, k1 = k0 * nz / ov.zoom;
    ov.panX += (cx - ov.W / 2) * (1 / k0 - 1 / k1);
    ov.panY += (cy - ov.H / 2) * (1 / k0 - 1 / k1);
    ov.zoom = nz; $('zVal').textContent = `${Math.round(nz * 100)}%`;
  }
  function resetZoom() { ov.zoom = 1; ov.panX = ov.panY = 0; $('zVal').textContent = '100%'; }
  $('zIn').addEventListener('click', () => zoomAt(ov.zoom * 1.25, ov.W / 2, ov.H / 2));
  $('zOut').addEventListener('click', () => zoomAt(ov.zoom / 1.25, ov.W / 2, ov.H / 2));
  $('zReset').addEventListener('click', resetZoom);
  ovCv.addEventListener('dblclick', resetZoom);
  const cvPos = (e) => { const r = ovCv.getBoundingClientRect(); return [(e.clientX - r.left) * ov.W / r.width, (e.clientY - r.top) * ov.H / r.height]; };
  ovCv.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = cvPos(e); zoomAt(ov.zoom * Math.exp(-e.deltaY * 0.0015), x, y); $('ovHint').hidden = true; }, { passive: false });
  const ptrs = new Map(); let pinch = null;
  ovCv.addEventListener('pointerdown', (e) => { ovCv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, cvPos(e)); ovCv.classList.add('drag'); $('ovHint').hidden = true;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: ov.zoom }; } });
  ovCv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId), cur = cvPos(e); ptrs.set(e.pointerId, cur);
    if (ptrs.size === 1) { ov.panX -= (cur[0] - prev[0]) / ov.k; ov.panY -= (cur[1] - prev[1]) / ov.k; }
    else if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); zoomAt(pinch.z * d / Math.max(10, pinch.d), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
  });
  const endPtr = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) ovCv.classList.remove('drag'); };
  ovCv.addEventListener('pointerup', endPtr); ovCv.addEventListener('pointercancel', endPtr);
  function sizeOverlay() {
    const r = ovCv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(50, Math.round(r.width * dpr)), H = Math.max(50, Math.round(r.height * dpr));
    if (ovCv.width !== W || ovCv.height !== H) { ovCv.width = W; ovCv.height = H; }
    ov.W = W; ov.H = H;
  }
  new ResizeObserver(sizeOverlay).observe($('ovWrap'));
  function drawOverlay(f) {
    const res = st.res, raw = st.raw; if (!res) return;
    const fi = Math.max(0, Math.min(raw.N - 1, Math.round(f)));
    const W = ov.W, H = ov.H;
    // 預設：身體像素高度 ×2.3 的範圍剛好放進畫面較短的一邊
    const base = Math.max(160, res.overlay.side[fi]);
    const k = Math.min(W, H) / base * ov.zoom; ov.k = k;
    const sw = W / k, sh = H / k;
    const cx = res.overlay.cx[fi] + ov.panX, cy = res.overlay.cy[fi] - base * 0.05 + ov.panY;
    const crop = { x: cx - sw / 2, y: cy - sh / 2, side: sw };
    ovCtx.fillStyle = '#05090d'; ovCtx.fillRect(0, 0, W, H);
    if (st.videoOk && vP.readyState >= 2) { try { ovCtx.drawImage(vP, crop.x, crop.y, sw, sh, 0, 0, W, H); } catch (e) { /* 影格還沒好 */ } }
    ovCtx.fillStyle = 'rgba(8,16,23,0.32)'; ovCtx.fillRect(0, 0, W, H);
    drawSkeleton(ovCtx, frameAt(raw.img, f), crop, W, res.hand, false, false, Math.min(W, H));
  }

  // ================= 主迴圈 =================
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    st.callouts?.forEach((c) => { c.w = 0; });
  }
  new ResizeObserver(resize).observe(host); resize();

  let lastNow = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
    if (camTween) {
      const k = Math.min(1, (now - camTween.t0) / camTween.dur), e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(camTween.from, camTween.to, e); controls.target.lerpVectors(camTween.ft, camTween.tt, e);
      if (k >= 1) { camTween = null; applyMode(); }
    }
    controls.update();
    if (!RM) { const b = 1 + 0.07 * Math.sin(now / 520); ring.scale.set(b, b, 1); ring.material.opacity = 0.35 + 0.2 * Math.sin(now / 520); }
    const s = curShot();
    if (st.res && s) {
      // 主時鐘：影片時間
      if (st.frozen) {
        const left = st.freezeEnd - now;
        $('impactBar').style.width = `${Math.max(0, left / 2600 * 100)}%`;
        if (left <= 0) { st.frozen = false; $('impact').hidden = true; if (st.playing) startVideo(); }
      } else if (st.playing && !st.videoOk) st.clockT += dt * st.speed;
      let t = st.videoOk ? videoTime() : st.clockT;
      let f = t * FPS;
      if (st.playing && !st.frozen) {
        if (f >= s.end || f < s.start - 3) { seekFrame(s.start); f = s.start; st.lastF = s.start - 1; st.frozeDone = false; }
        // 每一輪只定格一次（結束後顯示格的時間可能略早於擊球格，不能再觸發）
        if (st.freeze && !st.frozeDone && st.lastF < s.c && f >= s.c) {
          st.frozeDone = true;
          st.frozen = true; st.freezeEnd = now + 2600; f = s.c;
          if (st.videoOk) { vP.pause(); vP.currentTime = s.c / FPS; } else st.clockT = s.c / FPS;
          $('impact').hidden = false;
          if (!RM) { const fl = $('flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go'); }
        }
      }
      if (st.frozen) f = s.c;
      st.lastF = f;
      f = Math.max(0, Math.min(st.res.n - 1, f));
      const res = st.res;
      const FP = lift(frameAt(res.S, f), valAt(res.gP, f)), FC = lift(frameAt(res.C, f), valAt(res.gC, f));
      const trail = (arr, gs) => { const out = []; for (let i = 17; i >= 0; i--) { const g = Math.max(0, f - i), F = frameAt(arr, g), dy = valAt(gs, g); out.push([F[res.H.wr * 3], F[res.H.wr * 3 + 1] + dy, F[res.H.wr * 3 + 2]]); } return out; };
      figP.update(FP, s.x.fwd, res.hand, trail(res.S, res.gP));
      figC.update(FC, s.x.fwd, res.hand, trail(res.C, res.gC));
      const parts = alertParts(s, f);
      figP.setAlert(parts, RM ? 0.85 : 0.55 + 0.45 * Math.sin(now / 90), res.hand);
      figC.setAlert(new Set(), 0, res.hand);
      const showAnn = st.frozen || (!st.playing && Math.abs(f - s.c) <= 1.5);
      annP.visible = annC.visible = showAnn;
      for (const r of targetRings) r.quaternion.copy(camera.quaternion);
      updateHud(s, f, FP, FC);
      $('scrub').value = Math.round(f);
      const span = s.end - s.start || 1;
      $('tlHead').style.left = `${(f - s.start) / span * 100}%`;
      $('ovTag').textContent = `F${Math.round(f)} · ${phaseOf(s, f)}`;
      drawOverlay(f);
      composer.render();
      layoutCallouts(showAnn);
    } else {
      composer.render();
    }
  }
  requestAnimationFrame(loop);
  window.addEventListener('keydown', (e) => {
    if (!st.res || e.target.closest('input,select,textarea')) return;
    if (e.key === ' ' && e.target === document.body) { e.preventDefault(); st.playing ? pause() : play(); }
  });
  // ================= 手機下拉強制更新 =================
  // 在頁面最上方往下拉：出現旋轉圖示，拉過門檻放開就從伺服器重新載入（網址加時間戳避開快取）
  (function pullToRefresh() {
    // 在頁面最上方直接往下拉：整個版面跟著手指往下移，上方出現旋轉圖示；
    // 手指拉超過 TRIGGER（px）放開才更新，沒拉到就彈回去。
    const TRIGGER = 240, MAXSHIFT = 130;
    const sc = $('scroller'), wrap = sc.querySelector('.wrap');
    const el = document.createElement('div');
    el.className = 'ptr'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg><span class="ptr-t">下拉更新</span>';
    document.body.appendChild(el);
    const svg = el.querySelector('svg'), txt = el.querySelector('.ptr-t');
    const atTop = () => Math.max(sc.scrollTop, window.scrollY) <= 0;
    let y0 = null, dy = 0, pulling = false, busy = false;
    // 阻尼：越拉越重，版面最多往下移 MAXSHIFT
    const shiftOf = (v) => MAXSHIFT * (1 - Math.exp(-v / 260));
    const show = (shift, ready) => {
      wrap.style.transform = shift ? `translateY(${shift}px)` : '';
      el.style.transform = `translate(-50%, ${Math.max(-70, shift / 2 - 22)}px)`;
      el.classList.toggle('show', shift > 8); el.classList.toggle('ready', ready);
    };
    const snapBack = () => {
      pulling = false; y0 = null; dy = 0;
      wrap.classList.add('snap'); el.classList.add('back'); show(0, false);
      setTimeout(() => { wrap.classList.remove('snap'); el.classList.remove('back'); }, 320);
    };
    window.addEventListener('touchstart', (e) => {
      if (busy || !atTop() || e.touches.length !== 1 || e.target.closest('canvas, .v3d, .ovwrap, input, select, textarea, .tblwrap')) { y0 = null; return; }
      y0 = e.touches[0].clientY; dy = 0; wrap.classList.remove('snap'); el.classList.remove('back');
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (y0 == null || busy) return;
      dy = e.touches[0].clientY - y0;
      if (dy <= 0 || !atTop()) { if (pulling) snapBack(); y0 = dy <= 0 ? e.touches[0].clientY : null; return; }
      if (e.cancelable) e.preventDefault();
      pulling = true;
      const ready = dy >= TRIGGER, shift = shiftOf(dy);
      show(shift, ready);
      svg.style.transform = `rotate(${dy * 1.6}deg)`;
      txt.textContent = ready ? (st.res ? '放開更新（目前的分析會清除）' : '放開更新') : '繼續往下拉更新';
    }, { passive: false });
    window.addEventListener('touchend', () => {
      if (!pulling) { y0 = null; return; }
      if (dy >= TRIGGER) {
        busy = true; svg.style.transform = ''; el.classList.add('spin'); el.classList.remove('ready'); txt.textContent = '更新中…';
        wrap.classList.add('snap'); show(60, false); el.classList.add('show');
        const u = new URL(location.href); u.searchParams.set('r', Date.now());
        setTimeout(() => location.replace(u.href), 350);
      } else snapBack();
    });
    window.addEventListener('touchcancel', () => { if (pulling && !busy) snapBack(); });
    // 從瀏覽器的返回快取（bfcache）還原時重設狀態
    window.addEventListener('pageshow', (e) => { if (e.persisted) { busy = false; el.classList.remove('spin'); svg.style.transform = ''; txt.textContent = '下拉更新'; snapBack(); } });
    // 更新完把網址上的 ?r= 拿掉，讓更新後的頁面跟第一次打開完全一樣
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('r')) { u.searchParams.delete('r'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
    } catch (e) { /* 不支援就保留網址 */ }
  })();

  // 供除錯
  window.PBLab = { st, selectShot, setView, startFile, analyzeAndBuild, makeThumbs };
})();
