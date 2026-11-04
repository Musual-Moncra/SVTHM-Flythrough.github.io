/**
 * ===================================================================
 * MẪU 1 · FLYTHROUGH — đường lửa Three.js
 * Một đường cong CatmullRom duy nhất: camera bay theo cuộn,
 * đường lửa chính là đường cong đó và chỉ hiện đến vị trí đang cuộn.
 * Một vòng requestAnimationFrame duy nhất (do js/main.js quản lý).
 * ===================================================================
 */
window.FlyScene = (function () {
  'use strict';

  let renderer = null;
  let scene = null;
  let camera = null;
  let curve = null;
  let curveLength = 1;

  // Vật liệu và ánh sáng
  let tubeMat = null;
  let auraMat = null;
  let headGlow = null;
  let emberMat = null;
  let emberPoints = null;

  // Đạo cụ theo cảnh
  let sealMesh = null;
  let sealGlow = null;
  let rackPlane = null;
  let workerPlane = null;
  let photoPlanes = [];      // 3 ảnh #challenge
  let branchMatA = null;
  let branchMatB = null;
  let braidMats = [];        // 5 sợi #evolution
  let ringMat = null;
  let ringHead = null;

  // Mốc cung tròn (arc fractions) của từng trạm dừng
  let stationArc = [];       // 6 trạm: hero, origins, challenge, core, evolution, epilogue
  let arcSeal = 0;
  let arcPin = 0;
  let arcPhoto = [0, 0, 0];
  let arcUnionEnd = 0;
  let arcBraidStart = 0;
  let arcRingEnter = 0;
  let arcSplitStart = 0;
  let arcEnd = 1;

  let phone = false;
  let inited = false;
  let clock = 0;

  const FLAME_CORE = { r: 1.0, g: 0.89, b: 0.64 };   // #ffe3a3
  const FLAME_MID = { r: 0.96, g: 0.65, b: 0.14 };  // #f5a623
  const FLAME_EMBER = { r: 0.78, g: 0.31, b: 0.12 }; // #c8501e

  /* ---------- Bộ shader đường lửa ---------- */
  const TUBE_VERT = [
    'varying float vT;',
    'varying vec3 vNrm;',
    'void main() {',
    '  vT = uv.x;',
    '  vNrm = normalize(normalMatrix * normal);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  const TUBE_FRAG = [
    'precision mediump float;',
    'varying float vT;',
    'varying vec3 vNrm;',
    'uniform float uHead;',
    'uniform float uGlow;',
    'uniform float uBase;',
    'void main() {',
    '  float behind = step(vT, uHead);',
    '  if (behind < 0.5) { discard; }',
    '  float behindDist = uHead - vT;',
    '  float tail = clamp(1.0 - behindDist / 0.22, 0.0, 1.0);',
    '  float head = exp(-behindDist * 260.0);',
    '  vec3 col = mix(' +
    '    vec3(0.78, 0.31, 0.12),' +
    '    mix(vec3(0.96, 0.65, 0.14), vec3(1.0, 0.89, 0.64), min(head * 6.0, 1.0)),' +
    '    smoothstep(0.02, 0.3, tail));',
    '  float alpha = (0.28 + 0.72 * tail) * (0.75 + 0.85 * head);',
    '  alpha *= uBase * (1.0 + uGlow * (0.35 + 1.9 * head));',
    '  float rim = 1.0 - abs(dot(vNrm, vec3(0.0, 0.0, 1.0)));',
    '  alpha *= mix(0.55, 1.0, rim);',
    '  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));',
    '}'
  ].join('\n');

  /* ---------- Shader tàn lửa (Points) ---------- */
  const EMBER_VERT = [
    'attribute float aU;',
    'attribute float aSeed;',
    'attribute float aAmp;',
    'uniform float uHead;',
    'uniform float uTime;',
    'varying float vA;',
    'varying float vSeed;',
    'void main() {',
    '  float life = uHead - aU;',
    '  float inBand = step(0.0, life) * step(life, 0.16);',
    '  float drift = fract(aSeed * 7.13 + uTime * (0.05 + 0.12 * aSeed));',
    '  float flick = 0.55 + 0.45 * sin(uTime * (3.0 + 5.0 * aSeed) + aSeed * 31.0);',
    '  vA = inBand * (1.0 - life / 0.16) * flick;',
    '  vSeed = aSeed;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  mv.xy += vec2(drift - 0.5, drift * drift - 0.5) * aAmp * 1.4;',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = (1.6 + 2.4 * aSeed) * (140.0 / max(-mv.z, 2.0));',
    '}'
  ].join('\n');

  const EMBER_FRAG = [
    'precision mediump float;',
    'varying float vA;',
    'varying float vSeed;',
    'void main() {',
    '  float d = distance(gl_PointCoord, vec2(0.5));',
    '  float shape = smoothstep(0.5, 0.08, d);',
    '  vec3 col = mix(vec3(0.78, 0.31, 0.12), vec3(1.0, 0.89, 0.64), vSeed * 0.8);',
    '  gl_FragColor = vec4(col, shape * vA * 0.9);',
    '}'
  ].join('\n');

  /* ---------- Hình tròn phát sáng (texture cho điểm sáng đầu đường lửa) ---------- */
  function makeGlowTexture() {
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d');
    const grd = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(255, 240, 210, 1)');
    grd.addColorStop(0.25, 'rgba(255, 210, 130, 0.85)');
    grd.addColorStop(0.55, 'rgba(245, 166, 35, 0.35)');
    grd.addColorStop(1, 'rgba(200, 80, 30, 0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function clamp01(x) { return Math.min(1, Math.max(0, x)); }

  function smooth(a, b, x) {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  }

  /* ---------- Lưới văn bản texture ảnh (nạp từ assets_webp) ---------- */
  function loadPlaneTexture(url, w, h, litOffset, side) {
    const loader = new THREE.TextureLoader();
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4a4136,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide
    });
    loader.load(url, function (tex) {
      tex.encoding = THREE.sRGBEncoding;
      mat.map = tex;
      mat.needsUpdate = true;
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { lit: 0, threshold: litOffset, side: side };
    return mesh;
  }

  /* ---------- Nối thêm tia phụOffset theo đoạn cong chính ---------- */
  function buildBranch(uA, uB, xAmp, yAmp, radius, segments, twist) {
    if (uB - uA < 1e-4) return null;
    const frames = curve.computeFrenetFrames(Math.min(240, Math.round(segments * 4)), false);
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const u = uA + (uB - uA) * t;
      const p = curve.getPointAt(clamp01(u));
      const idx = Math.min(frames.normals.length - 1, Math.round(u * frames.normals.length));
      const N = frames.normals[idx];
      const B = frames.binormals[idx];
      const pulse = Math.sin(Math.PI * t);
      let ox = 0, oy = 0;
      if (twist) {
        const ang = twist.phase + twist.turns * Math.PI * 2 * t;
        const amp = twist.radius * (1 - smooth(0.86, 1.0, t));
        ox = Math.cos(ang) * amp;
        oy = Math.sin(ang) * amp;
      } else {
        ox = xAmp * pulse;
        oy = yAmp * pulse;
      }
      pts.push(new THREE.Vector3(
        p.x + N.x * ox + B.x * oy,
        p.y + N.y * ox + B.y * oy,
        p.z + N.z * ox + B.z * oy
      ));
    }
    const spline = new THREE.CatmullRomCurve3(pts);
    return new THREE.TubeGeometry(spline, segments, radius, 5, false);
  }

  /* ---------- Đường cong chính: thiết kế cảnh ---------- */
  function buildCurve() {
    const pts = [
      new THREE.Vector3(-0.4, 0.6, -10),   // camera bắt đầu (trước con dấu)
      new THREE.Vector3(0, 0.3, 0),        // TRẠM 0: con dấu bắt lửa
      new THREE.Vector3(0.8, 2.6, 10),     // lửa chạy ra khỏi khung hero
      new THREE.Vector3(5.5, 2.2, 30),     // TRẠM 1: chạy dọc phên bánh (bên phải)
      new THREE.Vector3(2.0, 1.4, 46),
      new THREE.Vector3(-4.5, 1.0, 58),    // uốn qua phên bánh (bên trái)
      new THREE.Vector3(-1.0, -1.6, 72),
      new THREE.Vector3(0, -3.0, 80),      // hạ xuống đúng ghim Phú Hòa Đông
      new THREE.Vector3(1.4, -2.2, 94),
      new THREE.Vector3(-4.2, 0.6, 104),   // TRẠM 2: ảnh 1 (mm)
      new THREE.Vector3(3.4, 1.0, 122),    // ảnh 2 (mmm)
      new THREE.Vector3(-3.2, 0.8, 140),   // ảnh 3 (mmmm)
      new THREE.Vector3(0, 1.0, 160),      // TRẠM 3: vào vùng tách sống
      new THREE.Vector3(2.8, 1.5, 178),    // tách phải
      new THREE.Vector3(-2.8, 1.1, 200),   // tách trái
      new THREE.Vector3(0, 1.0, 214),      // nhập lại tại trụ "KẾT NỐI"
      new THREE.Vector3(2.2, 1.2, 236),    // TRẠM 4: vùng bện 5 sợi
      new THREE.Vector3(-2.2, 1.4, 254),
      new THREE.Vector3(0.4, 1.2, 268),
      new THREE.Vector3(0, 1.3, 279)       // TRẠM 5: nhập vòng tròn quanh con dấu
    ];
    curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    curveLength = curve.getLength();
  }

  function resamplePolyFor(geoSegments) {
    // Làm giàu chi tiết đường cong cho tube dài
    return curve.getPoints(geoSegments * 2);
  }

  /* Tìm mốc arc fraction gần một điểm của mỗi TRẠM (dựa trên control point) */
  function arcOf(point3) {
    let best = 0;
    let bestD = Infinity;
    const N = 720;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const d = curve.getPointAt(u).distanceToSquared(point3);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  /* ---------- Khởi tạo ---------- */
  function init(canvas, opts) {
    opts = opts || {};
    phone = !!opts.phone;
    if (typeof THREE === 'undefined') return false;

    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: !phone,
        alpha: false,
        powerPreference: 'high-performance'
      });
    } catch (e) {
      return false;
    }

    const dprCap = phone ? 1.5 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    renderer.setClearColor(0x120d08, 1);
    renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x120d08, 0.0062);
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 420);

    buildCurve();

    // 6 TRẠM dừng (một cho mỗi cảnh #hero → #epilogue)

    const stations = [
      curve.getPoint(0.05),
      new THREE.Vector3(5.5, 2.2, 30),
      new THREE.Vector3(-3.2, 0.8, 140),
      new THREE.Vector3(0, 1.0, 214),
      new THREE.Vector3(2.2, 1.2, 236),
      new THREE.Vector3(0, 1.3, 279)
    ];
    stationArc = stations.map(arcOf);

    arcSeal = arcOf(new THREE.Vector3(0, 0.3, 0));
    arcPin = arcOf(new THREE.Vector3(0, -3.0, 80));
    arcPhoto[0] = arcOf(new THREE.Vector3(-4.2, 0.6, 104));
    arcPhoto[1] = arcOf(new THREE.Vector3(3.4, 1.0, 122));
    arcPhoto[2] = arcOf(new THREE.Vector3(-3.2, 0.8, 140));
    arcUnionEnd = arcOf(new THREE.Vector3(0, 1.0, 214));
    arcBraidStart = arcOf(new THREE.Vector3(2.2, 1.2, 236));
    arcRingEnter = arcOf(new THREE.Vector3(0.4, 1.2, 268));
    arcSplitStart = arcOf(new THREE.Vector3(0, 1.0, 160));
    arcEnd = 1;

    /* --- Ống lửa chính --- */
    const tubeGeo = new THREE.TubeGeometry(curve, phone ? 340 : 520, 0.085, 7, false);
    tubeMat = new THREE.ShaderMaterial({
      uniforms: {
        uHead: { value: 0 },
        uGlow: { value: 0 },
        uBase: { value: 1 }
      },
      vertexShader: TUBE_VERT,
      fragmentShader: TUBE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    scene.add(new THREE.Mesh(tubeGeo, tubeMat));

    /* --- Quầng mờ quanh lửa --- */
    const auraGeo = new THREE.TubeGeometry(curve, phone ? 200 : 360, 0.34, 6, false);
    auraMat = new THREE.ShaderMaterial({
      uniforms: {
        uHead: { value: 0 },
        uGlow: { value: 0 },
        uBase: { value: 0.16 }
      },
      vertexShader: TUBE_VERT,
      fragmentShader: TUBE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    scene.add(new THREE.Mesh(auraGeo, auraMat));

    /* --- Điểm sáng đầu lửa --- */
    const glowTex = makeGlowTexture();
    headGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    headGlow.scale.set(2.6, 2.6, 1);
    scene.add(headGlow);

    /* --- Con dấu bắt lửa (cảnh hero) --- */
    const sealLoader = new THREE.TextureLoader();
    const sealMat = new THREE.MeshBasicMaterial({
      color: 0x9a8a74,
      transparent: true,
      opacity: 0.66,
      alphaTest: 0.04,
      side: THREE.DoubleSide
    });
    sealLoader.load('assets/project-seal.webp', function (tex) {
      tex.encoding = THREE.sRGBEncoding;
      sealMat.map = tex;
      sealMat.needsUpdate = true;
    });
    sealMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 6.2), sealMat);
    sealMesh.position.set(0, 0.3, 0.6);
    scene.add(sealMesh);

    const drawGlow = makeGlowTexture();
    sealGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: drawGlow,
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    sealGlow.position.copy(sealMesh.position);
    sealGlow.scale.set(13, 13, 1);
    scene.add(sealGlow);

    /* --- Phên bánh + người làm nghề (cảnh #origins phẳng 3D) --- */
    rackPlane = loadPlaneTexture('assets/story-rice-racks.webp', 20, 11.25, null, 1);
    rackPlane.position.set(4.6, 1.7, 40);
    rackPlane.rotation.y = -0.55;
    scene.add(rackPlane);

    workerPlane = loadPlaneTexture('assets/story-worker.webp', 12.6, 8.4, null, -1);
    workerPlane.position.set(-3.4, 0.9, 52);
    workerPlane.rotation.y = 0.6;
    scene.add(workerPlane);

    /* --- Ghim Phú Hòa Đông (điểm glow thấp, nơi đường lửa hạ xuống) --- */
    const pinGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0x7fdca4,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    pinGlow.position.set(0, -3.4, 80.4);
    pinGlow.scale.set(4.2, 4.2, 1);
    scene.add(pinGlow);
    scene.userDataPinGlow = pinGlow;

    /* --- 3 ảnh #challenge --- */
    photoPlanes.push(loadPlaneTexture('assets/mm.webp', 8.6, 5.73, 0, 1));
    photoPlanes.push(loadPlaneTexture('assets/mmm.webp', 5.1, 9.18, 1, -1));
    photoPlanes.push(loadPlaneTexture('assets/mmmm.webp', 9.4, 6.27, 2, 1));
    placePhotos();

    /* --- Tách sống (cảnh #core) --- */
    const uSplitStart = arcOf(new THREE.Vector3(0, 1.0, 160));
    branchMatA = makeBranchMaterials(uSplitStart, arcUnionEnd, 2.3, -0.55, 0.034, 70);
    branchMatB = makeBranchMaterials(uSplitStart, arcUnionEnd, -2.3, 0.62, 0.034, 70);

    /* --- Bện 5 sợi (cảnh #evolution) --- */
    const braidEnd = arcOf(new THREE.Vector3(-2.2, 1.4, 254));
    for (let i = 0; i < 5; i++) {
      const m = makeBraidMaterial(arcBraidStart, braidEnd + (arcEnd - arcBraidStart) * (i * 0.02), i, 0.026);
      braidMats.push(m);
    }

    /* --- Vòng tròn #epilogue quanh con dấu --- */
    buildRing(new THREE.Vector3(0, 1.3, 279), 3.6, glowTex);
    arcRingEnter = Math.max(arcRingEnter, stationArc[5] - 0.010);

    /* --- Tàn lửa --- */
    buildEmbers();

    resize();
    window.addEventListener('resize', resize);

    inited = true;
    return true;
  }

  function placePhotos() {
    const positions = [
      [-4.2, 0.9, 102],  // mm (bên trái)
      [3.6, 1.1, 120],   // mmm (bên phải)
      [-3.5, 1.0, 138]   // mmmm (bên trái)
    ];
    const rots = [0.52, -0.5, 0.5];
    photoPlanes.forEach(function (mesh, i) {
      mesh.position.set(positions[i][0], positions[i][1], positions[i][2]);
      mesh.rotation.y = rots[i];
      mesh.userData.u = arcPhoto[i];
      scene.add(mesh);
    });
  }

  function makeBranchMaterials(uA, uB, xAmp, yAmp, radius, segments) {
    const geo = buildBranch(uA, uB, xAmp, yAmp, radius, segments, null);
    if (!geo) return null;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uHead: { value: 0 },
        uGlow: { value: 0 },
        uBase: { value: 0.0 },
        uWinA: { value: uA },
        uWinB: { value: uB }
      },
      vertexShader: TUBE_VERT,
      fragmentShader: TUBE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    return mat;
  }

  function makeBraidMaterial(uA, uB, index, radius) {
    const twist = { phase: index * Math.PI * 2 / 5, turns: 2.2, radius: 0.62 };
    const geo = buildBranch(uA, uB, 0, 0, radius, 110, twist);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uHead: { value: 0 },
        uGlow: { value: 0 },
        uBase: { value: 0.0 },
        uWinA: { value: uA },
        uWinB: { value: uB }
      },
      vertexShader: TUBE_VERT,
      fragmentShader: TUBE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    return mat;
  }

  function buildRing(center, radius, glowTex) {
    const pts = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push(new THREE.Vector3(center.x + Math.sin(a) * radius, center.y + Math.cos(a) * radius * 0.62, center.z + Math.sin(a) * 0.9));
    }
    const spline = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    const geo = new THREE.TubeGeometry(spline, 96, 0.05, 5, true);
    ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uHead: { value: 1.2 },
        uGlow: { value: 0 },
        uBase: { value: 0.0 },
        uWinA: { value: 0 },
        uWinB: { value: 1 }
      },
      vertexShader: TUBE_VERT,
      fragmentShader: TUBE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    scene.add(new THREE.Mesh(geo, ringMat));

    // Con dấu ở tâm vòng tròn
    const sealMat2 = new THREE.MeshBasicMaterial({
      color: 0xbfa78a,
      transparent: true,
      opacity: 0.8,
      alphaTest: 0.04,
      side: THREE.DoubleSide
    });
    new THREE.TextureLoader().load('assets/project-seal.webp', function (tex) {
      tex.encoding = THREE.sRGBEncoding;
      sealMat2.map = tex;
      sealMat2.needsUpdate = true;
    });
    const seal2 = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.2), sealMat2);
    seal2.position.set(center.x, center.y, center.z - 1.2);
    scene.add(seal2);

    ringHead = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    ringHead.scale.set(2.2, 2.2, 1);
    scene.add(ringHead);
  }

  function buildEmbers() {
    const count = phone ? 90 : 250;
    const frames = curve.computeFrenetFrames(300, false);
    const positions = new Float32Array(count * 3);
    const uArr = new Float32Array(count);
    const seedArr = new Float32Array(count);
    const ampArr = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const idx = Math.min(frames.normals.length - 1, Math.round(u * frames.normals.length));
      const p = curve.getPointAt(u);
      const r = 0.4 + Math.random() * 1.7;
      const ang = Math.random() * Math.PI * 2;
      const N = frames.normals[idx];
      const B = frames.binormals[idx];
      positions[i * 3] = p.x + (N.x * Math.cos(ang) + B.x * Math.sin(ang)) * r;
      positions[i * 3 + 1] = p.y + (N.y * Math.cos(ang) + B.y * Math.sin(ang)) * r;
      positions[i * 3 + 2] = p.z + (N.z * Math.cos(ang) + B.z * Math.sin(ang)) * r;
      uArr[i] = u;
      seedArr[i] = Math.random();
      ampArr[i] = 0.4 + Math.random() * 1.3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aU', new THREE.BufferAttribute(uArr, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seedArr, 1));
    geo.setAttribute('aAmp', new THREE.BufferAttribute(ampArr, 1));

    emberMat = new THREE.ShaderMaterial({
      uniforms: {
        uHead: { value: 0 },
        uTime: { value: 0 }
      },
      vertexShader: EMBER_VERT,
      fragmentShader: EMBER_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    emberPoints = new THREE.Points(geo, emberMat);
    emberPoints.frustumCulled = false;
    scene.add(emberPoints);
  }

  function resize() {
    if (!renderer || !camera) return;
    const w = Math.max(1, canvasWidth());
    const h = Math.max(1, canvasHeight());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function canvasWidth() {
    const el = renderer.domElement;
    return el.clientWidth || el.parentElement.clientWidth || window.innerWidth;
  }

  function canvasHeight() {
    const el = renderer.domElement;
    return el.clientHeight || el.parentElement.clientHeight || window.innerHeight;
  }

  /* Chuyển "tiến trình trạm" (số học từ main.js) thành mốc arc tròn đường cong */
  function progToArc(prog) {
    const n = stationArc.length - 1; // 5
    let i = Math.floor(prog);
    i = Math.min(Math.max(0, i), n);
    const frac = clamp01(prog - i);
    const a0 = stationArc[i];
    const a1 = stationArc[Math.min(i + 1, n)];
    return a0 + (a1 - a0) * frac;
  }

  /* ---------- Cập nhật một khung hình ---------- */
  function update(dt, state) {
    if (!inited) return;
    dt = Math.min(dt, 0.05);
    clock += dt;

    const head = progToArc(state.prog);
    const paused = !!state.paused;
    const sub = clamp01(state.sub || 0);

    /* camera đi dọc cùng một đường cong; dừng hoàn toàn khi đang đọc */
    const cam = camera.position;
    const camLook = curve.getPointAt(clamp01(Math.min(head + 0.016, 1)));
    const camPos = curve.getPointAt(clamp01(Math.max(head - 0.028, 0)));
    const sideOff = 0;
    cam.set(
      camPos.x + sideOff,
      camPos.y + 0.35,
      camPos.z
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(camLook.x + 0.4, camLook.y + 0.15, camLook.z);

    /* ống lửa + quầng */
    const stageFlicker = 0.9 + 0.1 * Math.sin(clock * 7.3) * Math.sin(clock * 3.1);
    tubeMat.uniforms.uHead.value = head;
    tubeMat.uniforms.uGlow.value = paused ? 0.55 + 0.35 * sub : 1.0;
    tubeMat.uniforms.uBase.value = stageFlicker;
    auraMat.uniforms.uHead.value = head;
    auraMat.uniforms.uGlow.value = paused ? 0.3 + 0.25 * sub : 0.6;
    auraMat.uniforms.uBase.value = stageFlicker;

    /* điểm sáng đầu lửa */
    const hp = curve.getPointAt(clamp01(head));
    headGlow.position.copy(hp);
    headGlow.material.opacity = (paused ? 0.9 : 0.75);
    const pulse = 2.15 + 0.5 * Math.sin(clock * 5.1);
    headGlow.scale.set(pulse, pulse, 1);

    /* con dấu bắt lửa */
    if (sealMesh) {
      const ignite = smooth(arcSeal - 0.02, arcSeal + 0.02, head);
      const breathe = 0.86 + 0.14 * Math.sin(clock * 1.7);
      sealMesh.material.color.setRGB(0.9 * breathe + 0.25 * ignite, 0.8 * breathe + 0.18 * ignite, 0.66 * breathe + 0.1 * ignite);
      sealMesh.material.opacity = 0.5 + 0.42 * Math.max(ignite, 0.18);
      sealGlow.material.opacity = 0.12 + 0.5 * ignite * breathe;
    }

    /* ghim Phú Hòa Đông sáng khi lửa hạ xuống (cảnh 1 gần cuối) */
    if (scene.userDataPinGlow) {
      const lit = smooth(arcPin - 0.02, arcPin + 0.012, head);
      scene.userDataPinGlow.material.opacity = 0.85 * lit;
    }

    /* 3 ảnh #challenge nghĩa lửa khi tới */
    photoPlanes.forEach(function (mesh, i) {
      const au = mesh.userData.u;
      const t = smooth(au - 0.022, au + 0.008, head);
      mesh.userData.lit = t;
      mesh.material.opacity = 0.5 + 0.5 * t;
      const warm = 0.55 + 0.72 * t;
      mesh.material.color.setRGB(warm, warm * 0.94, warm * 0.85);
    });

    /* tách sống #core: hiện dần trong cửa sổ [arcSplitStart, arcUnionEnd] */
    if (branchMatA && branchMatB) {
      const inWin = smooth(arcSplitStart, arcSplitStart + 0.02, head) * (1 - smooth(arcUnionEnd - 0.012, arcUnionEnd + 0.005, head)) +
                    smooth(arcUnionEnd - 0.012, arcUnionEnd, head) * 0.25;
      branchMatA.uniforms.uBase.value = Math.max(0, inWin) * 0.9;
      branchMatB.uniforms.uBase.value = Math.max(0, inWin) * 0.9;
    }

    /* bện 5 sợi #evolution */
    braidMats.forEach(function (mat, i) {
      const startArc = stationArc[4] - 0.006;
      const inWin = smooth(startArc, startArc + 0.015, head) * 0.95;
      mat.uniforms.uBase.value = Math.max(0, inWin);
      mat.uniforms.uHead.value = 1.2;
    });

    /* Vòng tròn #epilogue */
    if (ringMat) {
      const lit = smooth(arcRingEnter - 0.008, arcRingEnter + 0.02, head);
      const settled = 1 - smooth(arcRingEnter + 0.02, arcRingEnter + 0.05, head);
      ringMat.uniforms.uBase.value = clamp01(0.85 * lit * (0.45 + 0.55 * (1 - settled))) * (0.8 + 0.2 * Math.sin(clock * 1.9));
      if (ringHead) {
        const a = clock * 0.5;
        ringHead.position.set(3.6 * Math.sin(a), 1.3 + 2.23 * Math.cos(a), 279 + 0.9 * Math.sin(a));
        ringHead.material.opacity = 0.5 * lit;
      }
    }

    /* tàn lửa */
    if (emberMat) {
      emberMat.uniforms.uHead.value = head;
      emberMat.uniforms.uTime.value = clock;
    }

    renderer.render(scene, camera);
  }

  /* ===== API công khai ===== */
  return {
    init: init,
    update: update,
    isReady: function () { return inited; },
    stationCount: function () { return stationArc.length; },
    dispose: function () {
      if (renderer) {
        renderer.dispose();
        renderer = null;
      }
      inited = false;
    }
  };
})();
