/**
 * ===================================================================
 * MẪU 1 · FLYTHROUGH — đường lửa Three.js
 * Một đường cong CatmullRom duy nhất: camera bay theo cuộn,
 * đường lửa chính là đường cong đó và chỉ hiện đến vị trí đang cuộn.
 *
 * Nguyên tắc chấp nhận lần 2 (mục 1):
 * - Ống lửa là MỘT đường mảnh liền, dày ~9px trên màn hình,
 *   ĐỔI ĐỒ về mọi khoảng cách: bán kính trong shader tính theo
 *   khoảng cách tới camera (r = uComp * d), pixel trên màn hình không đổi.
 * - Lõi sáng + quầng mềm: hai lớp ống (lõi đậm, quầng rộng mờ).
 * - Đầu lửa sáng nhất, phần đã qua mờ dần thành đường than mảnh.
 * - Đoạn nhỏ dò nhìn trước (lead-ahead) chỉ đúng hướng đi tiếp.
 * - Tách 2 sợi nhập lại (#core) và 5 sợi bện (#evolution) dùng
 *   cùng shader, đọc rõ nhờ cửa sổ hiện riêng cho từng khoảng chặng.
 * Một vòng requestAnimationFrame duy nhất (do js/main.js quản lý).
 * ===================================================================
 */
window.FlyScene = (function () {
  'use strict';

  let renderer = null;
  let scene = null;
  let camera = null;
  let curve = null;

  // Vật liệu và đạo cụ
  let tubeMat = null;
  let auraMat = null;
  let leadMat = null;   // đoạn dò nhìn trước đầu lửa
  let headGlow = null;
  let emberMat = null;
  let emberPoints = null;

  // Vật liệu có uComp phải cập nhật mỗi khung (mọi ống lửa)
  const screenTubes = [];

  // Đạo cụ theo cảnh
  let sealMesh = null;
  let sealGlow = null;
  let seal2Mesh = null;
  let rackPlane = null;
  let workerPlane = null;
  let photoPlanes = [];      // 3 ảnh #challenge
  let branchMats = [];       // 2 tách sống #core
  let braidMats = [];        // 5 sợi #evolution
  let ringMat = null;
  let ringHead = null;
  let pinGlow = null;

  // Mốc cung tròn (arc fractions) của từng trạm dừng
  let stationArc = [];       // 6 trạm: hero, origins, challenge, core, evolution, epilogue
  let arcSeal = 0;
  let arcPin = 0;
  let arcPhoto = [0, 0, 0];
  let arcUnionEnd = 0;
  let arcBraidStart = 0;
  let arcRingEnter = 0;
  let arcSplitStart = 0;

  let phone = false;
  let inited = false;
  let clock = 0;

  // Hàng đợi texture: tải lần lượt, upload chủ động ngoài khung cuộn
  const texQueue = [];
  let texBusy = false;

  const FLAME_CORE = [1.0, 0.915, 0.72];  // lõi sáng (không cháy trắng)
  const FLAME_MID = [0.96, 0.65, 0.14];   // #f5a623
  const FLAME_DEEP = [0.78, 0.31, 0.12];  // #c8501e

  function clamp01(x) { return Math.min(1, Math.max(0, x)); }

  function smooth(a, b, x) {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  }

  /* =========================================================
     Shader ống lửa — độ dày không đổi theo màn hình
     ========================================================= */
  const TUBE_VERT = [
    'uniform float uComp;',   // px mỗi đơn vị thế giới → bán kính
    'uniform float uMult;',   // hệ số riêng của từng lớp (lõi/quầng/sợi)
    'uniform float uRMin;',
    'uniform float uRMax;',
    'varying float vT;',
    'varying vec3 vNv;',
    'varying float vDist;',
    'void main() {',
    '  vT = uv.x;',
    '  vNv = normalize(normalMatrix * normal);',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  float d = distance(cameraPosition, wp.xyz);',
    '  vDist = d;',
    // Mọi ống dựng sẵn bán kính 0.001; đẩy mặt ra tới bán kính thực:
    // r * (h màn hình) / (d * tanHalf) = số px cần → r = d * uComp.
    '  float r = clamp(uComp * d * uMult, uRMin, uRMax);',
    '  wp.xyz += normalize(normal) * r;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  const TUBE_FRAG = [
    'precision mediump float;',
    'varying float vT;',
    'varying vec3 vNv;',
    'varying float vDist;',
    'uniform float uHead;',
    'uniform float uWinA;',
    'uniform float uWinB;',
    'uniform float uFwd;',     // >0.5: chỉnh đoạn dò nhìn trước
    'uniform float uFwdLen;',
    'uniform float uAlpha;',
    'uniform float uBoost;',
    'uniform float uWinMode;',
    'uniform vec3 uColDeep;',
    'uniform vec3 uColMid;',
    'uniform vec3 uColCore;',
    'void main() {',
    '  float behind = uHead - vT;',
    '  float vis = 0.0;',
    '  vec3 col = uColMid;',
    '  if (uFwd > 0.5) {',
    // Đoạn dò: hiện phía TRƯỚC đầu lửa để đọc hướng đi tiếp
    '    float ahead = vT - uHead;',
    '    if (ahead < 0.0 || ahead > uFwdLen) { discard; }',
    '    float f = 1.0 - ahead / uFwdLen;',
    '    vis = (0.3 + 0.7 * f) * 0.5;',
    '    col = mix(uColMid, uColCore, 0.35 * f);',
    '  } else {',
    '    if (behind < 0.0) { discard; }',
    // Phần đã bay qua: vệt than mảnh vẫn liền, gần đầu sáng dần
    '    float fresh = 1.0 - smoothstep(0.0, 0.3, behind);',
    '    vis = 0.15 + 0.85 * fresh;',
    '    float hot = exp(-behind * 110.0);',
    '    col = mix(uColDeep, uColMid, smoothstep(0.04, 0.42, fresh));',
    '    col = mix(col, uColCore, clamp(hot * 1.15 + smoothstep(0.72, 1.0, fresh) * 0.4, 0.0, 1.0));',
    '  }',
    // Sợi tách/bện/vòng: sáng đều cả thân, độ hiện do uAlpha điều khiển
    '  if (uWinMode > 0.5) {',
    '    vis = 1.0;',
    '    col = mix(uColDeep, uColMid, 0.8);',
    '  }',
    // Cửa sổ hiện theo chặng (tách sống / bện / vòng tròn)
    '  float win = smoothstep(uWinA, uWinA + 0.009, vT) * (1.0 - smoothstep(uWinB, uWinB + 0.005, vT));',
    '  vis *= win;',
    // Mặt cắt tròn mềm: giữa sáng hơn mép nhưng mép không chết (tránh "ống rỗng")
    '  float centerW = abs(vNv.z);',
    '  float shape = 0.55 + 0.45 * pow(centerW, 1.3);',
    '  float a = vis * uAlpha * uBoost * shape;',
    // Mờ dần khi sát camera: đường lửa "chạy ra khỏi màn hình" thay vì bị cắt ngang
    '  a *= smoothstep(0.45, 1.9, vDist);',
    '  if (a < 0.005) { discard; }',
    '  gl_FragColor = vec4(col, a);',
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
    '  float inBand = step(0.0, life) * step(life, 0.14);',
    '  float drift = fract(aSeed * 7.13 + uTime * (0.05 + 0.12 * aSeed));',
    '  float flick = 0.55 + 0.45 * sin(uTime * (3.0 + 5.0 * aSeed) + aSeed * 31.0);',
    '  vA = inBand * (1.0 - life / 0.14) * flick;',
    '  vSeed = aSeed;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  mv.xy += vec2(drift - 0.5, drift * drift - 0.5) * aAmp * 1.1;',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = (1.3 + 1.8 * aSeed) * (120.0 / max(-mv.z, 2.0));',
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
    '  gl_FragColor = vec4(col, shape * vA * 0.8);',
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
    grd.addColorStop(0, 'rgba(255, 238, 205, 0.95)');
    grd.addColorStop(0.28, 'rgba(255, 205, 125, 0.7)');
    grd.addColorStop(0.58, 'rgba(240, 158, 40, 0.26)');
    grd.addColorStop(1, 'rgba(190, 75, 28, 0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  /* ---------- Nối thêm tia phụ dọc theo đoạn cong chính ---------- */
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
        const amp = twist.radius * (1 - smooth(0.9, 1.0, t));
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

  function makeTubeMaterial(mult, rMin, rMax, alpha) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uComp: { value: 0.006 },
        uMult: { value: mult },
        uRMin: { value: rMin },
        uRMax: { value: rMax },
        uHead: { value: 0 },
        uWinA: { value: 0 },
        uWinB: { value: 1 },
        uFwd: { value: 0 },
        uFwdLen: { value: 0.045 },
        uAlpha: { value: alpha },
        uBoost: { value: 1 },
        uWinMode: { value: 0 },
        uColDeep: { value: new THREE.Vector3(FLAME_DEEP[0], FLAME_DEEP[1], FLAME_DEEP[2]) },
        uColMid: { value: new THREE.Vector3(FLAME_MID[0], FLAME_MID[1], FLAME_MID[2]) },
        uColCore: { value: new THREE.Vector3(FLAME_CORE[0], FLAME_CORE[1], FLAME_CORE[2]) }
      },
      vertexShader: TUBE_VERT,
      fragmentShader: TUBE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    screenTubes.push(mat);
    return mat;
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

  /* Kiểm tra WebGL TRƯỚC khi dựng renderer — không in lỗi đỏ ra console */
  function webglAvailable(canvas) {
    try {
      const gl = canvas.getContext('webgl2') ||
        canvasgetContextAlias(canvas) ||
        canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  }
  function canvasgetContextAlias(canvas) {
    try { return canvas.getContext('webgl'); } catch (e) { return null; }
  }

  /* =========================================================
     Khởi tạo
     ========================================================= */
  function init(canvas, opts) {
    opts = opts || {};
    phone = !!opts.phone;
    if (typeof THREE === 'undefined') return false;
    if (!webglAvailable(canvas)) return false;

    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: !phone,
        alpha: false,
        powerPreference: 'high-performance'
      });
    } catch (e) {
      renderer = null;
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

    const glowTex = makeGlowTexture();

    /* --- Ống lõi mảnh (một đường liền) --- */
    const tubeSeg = phone ? 340 : 560;
    const tubeGeo = new THREE.TubeGeometry(curve, tubeSeg, 0.001, 7, false);
    tubeMat = makeTubeMaterial(1.0, 0.0026, 0.09, 0.9);
    scene.add(new THREE.Mesh(tubeGeo, tubeMat));

    /* --- Quầng mềm quanh lõi (rộng hơn, mờ hơn) --- */
    const auraGeo = new THREE.TubeGeometry(curve, phone ? 220 : 400, 0.001, 6, false);
    auraMat = makeTubeMaterial(3.6, 0.024, 0.6, 0.2);
    scene.add(new THREE.Mesh(auraGeo, auraMat));

    /* --- Đoạn dò nhìn trước: hướng đi tiếp của đường lửa --- */
    leadMat = makeTubeMaterial(0.9, 0.002, 0.08, 0.4);
    leadMat.uniforms.uFwd.value = 1;
    scene.add(new THREE.Mesh(tubeGeo, leadMat));

    /* --- Điểm sáng đầu lửa (kích thước ổn định trên màn hình) --- */
    headGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    headGlow.scale.set(0.5, 0.5, 1);
    scene.add(headGlow);

    /* --- Con dấu bắt lửa (cảnh hero) — mặt ĐỨNG, đọc đúng chữ, giữ màu ảnh --- */
    const sealMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      alphaTest: 0.04,
      side: THREE.DoubleSide
    });
    sealMesh = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 4.9), sealMat);
    sealMesh.visible = false;
    queueTexture('assets/seal-3d.webp', function (tex) {
      sealMat.map = tex;
      sealMat.needsUpdate = true;
      sealMesh.visible = true;
    });
    sealMesh.position.set(0, -0.2, 0.6);
    /* Camera nhìn từ phía -Z: lật mặt phẳng để THẤY MẶT TRƯỚC (chữ đọc đúng) */
    sealMesh.rotation.y = Math.PI;
    scene.add(sealMesh);

    sealGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    sealGlow.position.copy(sealMesh.position);
    sealGlow.scale.set(6.4, 6.4, 1);
    scene.add(sealGlow);

    /* --- Phên bánh + người làm nghề (cảnh #origins phẳng 3D) ---
       Lùi rộng ra hai bên, mờ — không chui vào vùng chữ */
    rackPlane = loadPlaneTexture('assets/racks-3d.webp', 20, 11.25, { rotY: -0.62, opacity: 0.3 });
    rackPlane.position.set(10.4, 2.0, 40);
    rackPlane.userData.reveal = arcOf(new THREE.Vector3(3.5, 2.1, 22));
    rackPlane.userData.maxOpacity = 0.22;
    scene.add(rackPlane);

    workerPlane = loadPlaneTexture('assets/worker-3d.webp', 12.6, 8.4, { rotY: 0.6, opacity: 0.3 });
    workerPlane.position.set(-9.2, 1.2, 52);
    workerPlane.userData.reveal = arcOf(new THREE.Vector3(4.5, 1.9, 34));
    workerPlane.userData.maxOpacity = 0.22;
    scene.add(workerPlane);

    /* --- Ghim Phú Hòa Đông (điểm glow thấp, nơi đường lửa hạ xuống) --- */
    pinGlow = new THREE.Sprite(new THREE.SpriteMaterial({
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

    /* --- 3 ảnh #challenge — dựng đứng đúng chiều ảnh gốc ---
       mm: ảnh gốc chụp ngang (trang gốc hiển thị xoay) → mặt phẳng đứng,
           texture xoay -(90°) khớp thẻ HTML .challenge-photo-sideways.
       mmmm: nén lại theo EXIF orientation 8, upright sẵn → không xoay.
       Lùi xa khỏi dải chữ, mờ — không đè lên panel nội dung. */
    photoPlanes.push(loadPlaneTexture('assets/mm-3d.webp', 5.73, 8.6, {
      texRot: Math.PI / 2,
      rotY: 0.65,
      opacity: 0.42,
      position: [-7.6, 1.3, 101]
    }));
    photoPlanes.push(loadPlaneTexture('assets/mmm-3d.webp', 5.1, 9.18, {
      rotY: -0.62,
      opacity: 0.42,
      position: [7.4, 1.4, 119]
    }));
    photoPlanes.push(loadPlaneTexture('assets/mmmm-3d.webp', 6.27, 9.4, {
      rotY: 0.65,
      opacity: 0.42,
      position: [-7.0, 1.3, 137]
    }));
    photoPlanes.forEach(function (mesh, i) {
      mesh.userData.u = arcPhoto[i];
      scene.add(mesh);
    });

    /* --- Tách sống (cảnh #core): 2 sợi rời khỏi thân, nhập lại ở "KẾT NỐI" --- */
    const unionPad = 0.03;   // kéo dài qua điểm nhập → nhìn rõ khoảnh khắc nhập lại
    branchMats.push(makeBranchMaterial(arcSplitStart, arcUnionEnd + unionPad, 2.3, -0.55, 0.95));
    branchMats.push(makeBranchMaterial(arcSplitStart, arcUnionEnd + unionPad, -2.3, 0.62, 0.95));

    /* --- Bện 5 sợi (cảnh #evolution): mỗi sợi ląc cọng nghề bện vào nhau --- */
    const braidEnd = arcOf(new THREE.Vector3(-2.2, 1.4, 254));
    for (let i = 0; i < 5; i++) {
      braidMats.push(makeBraidMaterial(
        arcBraidStart - 0.004 * (4 - i),
        braidEnd + (1 - arcBraidStart) * (i * 0.018),
        i,
        0.8
      ));
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

  /* =========================================================
     Tải texture lần lượt từng cái một + upload chủ động
     (renderer.initTexture) trong khe rảnh — không để decode/texImage2D
     rơi vào khung hình lúc người dùng đang cuộn (nguyên nhân khung dài).
     ========================================================= */
  function queueTexture(url, onTex) {
    texQueue.push({ url: url, cb: onTex });
    pumpTextures();
  }

  function pumpTextures() {
    if (texBusy || !texQueue.length || !renderer) return;
    texBusy = true;
    const item = texQueue.shift();
    new THREE.TextureLoader().load(item.url, function (tex) {
      tex.encoding = THREE.sRGBEncoding;
      try {
        if (renderer.initTexture) renderer.initTexture(tex);   // upload ngay, ngoài khung cuộn
      } catch (e) { /* bỏ qua */ }
      item.cb(tex);
      texBusy = false;
      setTimeout(pumpTextures, 120);   // giãn cách: mỗi texture một khe rảnh
    }, undefined, function () {
      texBusy = false;
      setTimeout(pumpTextures, 120);
    });
  }

  function loadPlaneTexture(url, w, h, opts) {
    opts = opts || {};
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x453d33,
      transparent: true,
      opacity: opts.opacity !== undefined ? opts.opacity : 0.4,
      side: THREE.DoubleSide
    });
    queueTexture(url, function (tex) {
      if (opts.texRot) {
        tex.center.set(0.5, 0.5);
        tex.rotation = opts.texRot;
      }
      mat.map = tex;
      mat.needsUpdate = true;
    });
    const mesh = new THREE.Mesh(geo, mat);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    if (opts.position) mesh.position.set(opts.position[0], opts.position[1], opts.position[2]);
    mesh.userData.lit = 0;
    return mesh;
  }

  function makeBranchMaterial(uA, uB, xAmp, yAmp, mult) {
    const geo = buildBranch(uA, uB, xAmp, yAmp, 0.001, 80, null);
    if (!geo) return null;
    const mat = makeTubeMaterial(mult, 0.0022, 0.08, 0);
    mat.uniforms.uHead.value = 1.2;    // luôn "sau đầu"; hiển thị chỉnh bằng uAlpha
    mat.uniforms.uWinMode.value = 1;
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    return mat;
  }

  function makeBraidMaterial(uA, uB, index, mult) {
    const twist = { phase: index * Math.PI * 2 / 5, turns: 2.3, radius: 0.66 };
    const geo = buildBranch(uA, uB, 0, 0, 0.001, 110, twist);
    if (!geo) return null;
    const mat = makeTubeMaterial(mult, 0.0022, 0.08, 0);
    mat.uniforms.uHead.value = 1.2;
    mat.uniforms.uWinMode.value = 1;
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
    const geo = new THREE.TubeGeometry(spline, 96, 0.001, 5, true);
    ringMat = makeTubeMaterial(0.95, 0.0022, 0.08, 0);
    ringMat.uniforms.uHead.value = 1.2;
    ringMat.uniforms.uWinMode.value = 1;
    scene.add(new THREE.Mesh(geo, ringMat));

    // Con dấu ở tâm vòng tròn — lật mặt như con dấu hero để chữ đọc đúng
    const sealMat2 = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      alphaTest: 0.04,
      side: THREE.DoubleSide
    });
    seal2Mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.0), sealMat2);
    seal2Mesh.visible = false;
    queueTexture('assets/seal-3d.webp', function (tex) {
      sealMat2.map = tex;
      sealMat2.needsUpdate = true;
      seal2Mesh.visible = true;
    });
    seal2Mesh.position.set(center.x, center.y, center.z - 1.2);
    seal2Mesh.rotation.y = Math.PI;
    scene.add(seal2Mesh);

    ringHead = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    ringHead.scale.set(0.4, 0.4, 1);
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
    cam.set(camPos.x, camPos.y + 0.5, camPos.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(camLook.x + 0.3, camLook.y + 0.1, camLook.z);

    /* uComp recal theo khung: dày không đổi theo màn hình */
    const tanHalf = Math.tan(camera.fov * 0.5 * Math.PI / 180);
    const linePx = phone ? 7.5 : 9;
    const comp = (linePx * tanHalf) / Math.max(1, canvasHeight());
    screenTubes.forEach(function (mat) { mat.uniforms.uComp.value = comp; });

    /* ống lửa + quầng */
    const stageFlicker = 0.92 + 0.08 * Math.sin(clock * 7.3) * Math.sin(clock * 3.1);
    tubeMat.uniforms.uHead.value = head;
    tubeMat.uniforms.uAlpha.value = (paused ? 0.74 + 0.24 * sub : 0.86) * stageFlicker;
    // xung sáng khi 2 sợi nhập lại — khoảnh khắc "KẾT NỐI" được nhấn
    tubeMat.uniforms.uBoost.value = 1 + 0.5 * Math.exp(-Math.abs(head - arcUnionEnd) * 150);
    auraMat.uniforms.uHead.value = head;
    auraMat.uniforms.uAlpha.value = (paused ? 0.19 + 0.05 * sub : 0.22) * stageFlicker;
    leadMat.uniforms.uHead.value = head;
    leadMat.uniforms.uAlpha.value = paused ? 0.4 : 0.5;

    /* điểm sáng đầu lửa — giữ ổn định theo màn hình, không phình khi camera tới gần */
    const hp = curve.getPointAt(clamp01(head));
    headGlow.position.copy(hp);
    const pxWorld = (2 * tanHalf * camera.position.distanceTo(hp)) / Math.max(1, canvasHeight());
    const coreMerge = 1 + 0.3 * Math.exp(-Math.abs(head - arcUnionEnd) * 150);
    const gs = THREE.MathUtils.clamp(64 * pxWorld * coreMerge, 0.1, 0.55);
    headGlow.scale.set(gs, gs, 1);
    headGlow.material.opacity = paused ? 0.8 : 0.68;

    /* con dấu bắt lửa — giữ màu ảnh gốc, không cháy trắng */
    if (sealMesh) {
      const ignite = smooth(arcSeal - 0.02, arcSeal + 0.02, head);
      sealMesh.material.opacity = 0.4 + 0.45 * ignite;
      sealGlow.material.opacity = 0.08 + 0.12 * ignite;   // quầng hạ thấp: chữ con dấu vẫn đọc được
    }

    /* đạo cụ phên/người: ẩn trước khi tới gần #origins (tránh khung ảnh lơ lửng ở hero) */
    [rackPlane, workerPlane].forEach(function (mesh) {
      if (!mesh) return;
      const rv = mesh.userData.reveal || 0;
      const t = smooth(rv - 0.015, rv + 0.02, head);
      mesh.material.opacity = t * (mesh.userData.maxOpacity || 0.3);
    });

    /* ghim Phú Hòa Đông sáng khi lửa hạ xuống (cảnh 1 gần cuối) */
    if (pinGlow) {
      const lit = smooth(arcPin - 0.02, arcPin + 0.012, head);
      pinGlow.material.opacity = 0.85 * lit;
    }

    /* 3 ảnh #challenge nghĩa lửa khi tới */
    photoPlanes.forEach(function (mesh, i) {
      const au = mesh.userData.u;
      const t = smooth(au - 0.022, au + 0.008, head);
      mesh.userData.lit = t;
      mesh.material.opacity = 0.14 + 0.4 * t;
      const warm = 0.62 + 0.5 * t;
      mesh.material.color.setRGB(warm, warm * 0.95, warm * 0.87);
    });

    /* tách sống #core: hiện trong cửa sổ, còn sáng thêm chút sau khi nhập */
    branchMats.forEach(function (mat) {
      if (!mat) return;
      const inWin =
        smooth(arcSplitStart, arcSplitStart + 0.02, head) *
        (1 - smooth(arcUnionEnd + 0.022, arcUnionEnd + 0.075, head));
      mat.uniforms.uAlpha.value = Math.max(0, inWin) * 0.85 * stageFlicker;
    });

    /* bện 5 sợi #evolution */
    braidMats.forEach(function (mat, i) {
      if (!mat) return;
      const startArc = stationArc[4] - 0.008 - 0.004 * i;
      const inWin = smooth(startArc, startArc + 0.015, head) * 0.9;
      mat.uniforms.uAlpha.value = Math.max(0, inWin) * stageFlicker;
    });

    /* Con dấu #epilogue: chỉ hiện khi lửa gần tới (không lơ lửng giữa hành trình) */
    if (seal2Mesh) {
      seal2Mesh.material.opacity = 0.55 * smooth(arcRingEnter - 0.09, arcRingEnter - 0.01, head);
    }

    /* Vòng tròn #epilogue */
    if (ringMat) {
      const lit = smooth(arcRingEnter - 0.008, arcRingEnter + 0.02, head);
      const settled = 1 - smooth(arcRingEnter + 0.02, arcRingEnter + 0.05, head);
      ringMat.uniforms.uAlpha.value = clamp01(0.8 * lit * (0.45 + 0.55 * (1 - settled))) * (0.8 + 0.2 * Math.sin(clock * 1.9));
      if (ringHead) {
        const a = clock * 0.5;
        ringHead.position.set(3.6 * Math.sin(a), 1.3 + 2.23 * Math.cos(a), 279 + 0.9 * Math.sin(a));
        ringHead.material.opacity = 0.42 * lit;
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
