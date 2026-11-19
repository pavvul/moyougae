// 3D 表示。Three.js は「3D で見る」を押したときだけ読み込む（平面図はネットなしでも使える）
const View3D = (() => {
  const LIBS = ['https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
                'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'];
  let loading = null;
  const loadScript = src => new Promise((ok, ng) => {
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ng; document.head.appendChild(s);
  });
  const load = () => loading || (loading = LIBS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
    .catch(e => { loading = null; throw e; }));

  const T = 8; // 壁の厚さ（見た目だけ）
  const css = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();

  // 家具の上に浮かべる名札（いつもカメラの方を向く）
  function label(text, x, y, z, D) {
    const cv = document.createElement('canvas'), g = cv.getContext('2d'), fs = 40;
    g.font = `600 ${fs}px system-ui, sans-serif`;
    cv.width = Math.ceil(g.measureText(text).width) + 24; cv.height = fs + 20;
    g.font = `600 ${fs}px system-ui, sans-serif`;
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#2b2a26'; g.textBaseline = 'middle'; g.fillText(text, 12, cv.height / 2);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
    const h = D / 28; sp.scale.set(h * cv.width / cv.height, h, 1); sp.position.set(x, y, z); sp.renderOrder = 1;
    return sp;
  }

  function build(plan) {
    const { w: W, h: H, ht: HT } = plan.room, scene = new THREE.Scene(), { bad } = G.issues(plan);
    scene.background = new THREE.Color(css('--bg') || '#f4f1ea');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8170, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(W * 0.3, HT * 3, H * 1.2); scene.add(sun);

    const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
    const lineMat = new THREE.LineBasicMaterial({ color: 0x3a3832, transparent: true, opacity: 0.45 });
    const badLine = new THREE.LineBasicMaterial({ color: 0xc2412d });
    // 平面図の (x, y) を 3D の (x, z) に、高さを y に対応させる。box は床の四角と高さの範囲で置く
    function box(x, z, w, d, y0, y1, material, edges, parent = scene) {
      if (w <= 0 || d <= 0 || y1 <= y0) return;
      const g = new THREE.BoxGeometry(w, y1 - y0, d), m = new THREE.Mesh(g, material);
      m.position.set(x + w / 2, (y0 + y1) / 2, z + d / 2); parent.add(m);
      if (edges) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(g), edges === true ? lineMat : edges); l.position.copy(m.position); parent.add(l); }
    }

    // 床
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat(0xe8dcc4));
    floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, H / 2); scene.add(floor);
    // 床に 50cm ごとの線（平面図の太い方眼と同じ）
    const pts = [];
    for (let x = 50; x < W; x += 50) pts.push(x, 0.2, 0, x, 0.2, H);
    for (let z = 50; z < H; z += 50) pts.push(0, 0.2, z, W, 0.2, z);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xcfc7b5 })));

    // 壁：ドアと窓の部分をくり抜いて、上下左右の塊に分けて組む
    const wallMat = mat(0xf7f4ee), walls = {};
    for (const wall of ['top', 'bottom', 'left', 'right']) {
      const grp = new THREE.Group(); walls[wall] = grp; scene.add(grp);
      const hz = G.horiz(wall), len = hz ? W : H;
      // 壁に沿った区間 [a, b] と高さ [y0, y1] を、その壁の位置の塊にする
      const piece = (a, b, y0, y1) => {
        if (hz) box(a, wall === 'top' ? -T : H, b - a, T, y0, y1, wallMat, true, grp);
        else box(wall === 'left' ? -T : W, a, T, b - a, y0, y1, wallMat, true, grp);
      };
      const ops = plan.items.filter(i => i.t !== 'f' && i.wall === wall)
        .map(i => ({ a: i.pos, b: i.pos + i.w, lo: i.t === 'win' ? i.sill : 0, hi: Math.min(HT, (i.t === 'win' ? i.sill : 0) + i.h), it: i }))
        .sort((p, q) => p.a - q.a);
      let cur = hz ? -T : 0;
      for (const o of ops) {
        if (o.a > cur) piece(cur, o.a, 0, HT);
        const a = Math.max(cur, o.a);
        if (o.b > a) { piece(a, o.b, 0, o.lo); piece(a, o.b, o.hi, HT); }
        cur = Math.max(cur, o.b);
      }
      piece(cur, hz ? len + T : len, 0, HT);
      // 戸とガラス（閉じた状態で描く）
      for (const o of ops) {
        const isWin = o.it.t === 'win', m = isWin ? mat(0x9cc8e0, { transparent: true, opacity: 0.35 }) : mat(bad.has(o.it.id) ? 0xc2412d : 0xa58a64);
        const th = isWin ? 1 : 3, off = isWin ? T / 2 : (o.it.kind === 'slide' ? 2 : T / 2);
        if (hz) box(o.a, wall === 'top' ? -off - th / 2 : H + off - th / 2, o.b - o.a, th, o.lo, o.hi, m, !isWin, grp);
        else box(wall === 'left' ? -off - th / 2 : W + off - th / 2, o.a, th, o.b - o.a, o.lo, o.hi, m, !isWin, grp);
      }
    }

    // 家具
    for (const it of plan.items.filter(i => i.t === 'f')) {
      // 選んだ色はそのまま使い、注意が出ている家具は赤い縁で示す（色を付けていなければ赤く塗る）
      const r = G.fp(it), isBad = bad.has(it.id), color = it.col ? new THREE.Color(it.col) : isBad ? 0xe58a78 : 0xd9c6a5;
      box(r.x, r.y, r.w, r.h, 0, it.h, mat(color), isBad ? badLine : true);
      // 前の面に細い帯を付けて向きが分かるようにする
      const q = (it.rot / 90) % 4, s = 3, fm = mat(0x8a7350);
      const fr = [[r.x, r.y + r.h - s, r.w, s], [r.x, r.y, s, r.h], [r.x, r.y, r.w, s], [r.x + r.w - s, r.y, s, r.h]][q];
      box(fr[0], fr[1], fr[2], fr[3], it.h - Math.min(6, it.h), it.h + 0.3, fm, false);
      scene.add(label(it.name, r.x + r.w / 2, it.h + 14, r.y + r.h / 2, Math.max(W, H)));
    }
    return { scene, walls };
  }

  async function open(plan) {
    const ov = document.createElement('div');
    ov.className = 'v3d';
    ov.innerHTML = `<div class="v3d-bar"><button data-v="close" class="main">平面図に戻る</button>
      <button data-v="iso">斜めから</button><button data-v="top">真上から</button><button data-v="eye">目の高さ</button>
      <span class="hint">ドラッグで回す・ピンチやホイールで拡大・2 本指（右ドラッグ）で移動</span></div>
      <div class="v3d-msg">3D を読み込んでいます…</div>`;
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    let raf = 0, renderer = null, scene = null, ctl = null;
    // 開閉を繰り返しても重くならないよう、形・材質・名札の絵と WebGL の場所を返す
    const close = () => {
      cancelAnimationFrame(raf); removeEventListener('resize', fit);
      if (scene) scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
      if (ctl) ctl.dispose();
      if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
      ov.remove(); document.body.style.overflow = '';
    };
    const fit = () => {
      if (!renderer) return;
      const w = ov.clientWidth, h = ov.clientHeight - ov.querySelector('.v3d-bar').offsetHeight;
      renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    let cam;
    ov.querySelector('[data-v="close"]').onclick = close;
    try { await load(); } catch (e) {
      ov.querySelector('.v3d-msg').textContent = '3D の部品を読み込めませんでした。インターネットにつながっているときに開いてください。';
      return;
    }
    if (!ov.isConnected) return;
    const { w: W, h: H } = plan.room;
    let walls;
    try {
      ({ scene, walls } = build(plan));
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      console.error(e);
      ov.querySelector('.v3d-msg').textContent = '3D を表示できませんでした（この端末やブラウザで 3D が使えないようです）。';
      return;
    }
    ov.querySelector('.v3d-msg').remove();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    ov.appendChild(renderer.domElement);
    cam = new THREE.PerspectiveCamera(50, 1, 5, 20000);
    ctl = new THREE.OrbitControls(cam, renderer.domElement);
    ctl.maxPolarAngle = Math.PI / 2 - 0.02; ctl.enableDamping = true;
    const D = Math.max(W, H);
    const views = {
      iso: () => { cam.position.set(W / 2 + D * 0.6, D * 1.1, H / 2 + D * 1.0); ctl.target.set(W / 2, 40, H / 2); },
      top: () => { cam.position.set(W / 2, D * 1.6, H / 2 + 1); ctl.target.set(W / 2, 0, H / 2); },
      eye: () => { cam.position.set(W / 2, 150, H - 20); ctl.target.set(W / 2, 110, H / 2 - 40); },
    };
    for (const k in views) if (k !== 'close') ov.querySelector(`[data-v="${k}"]`).onclick = () => { views[k](); ctl.update(); };
    views.iso(); ctl.update();
    addEventListener('resize', fit); fit();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      ctl.update();
      // カメラ側の壁は隠して中が見えるようにする（部屋の中にいるときは全部の壁を出す）
      const p = cam.position;
      walls.top.visible = p.z > 0; walls.bottom.visible = p.z < H;
      walls.left.visible = p.x > 0; walls.right.visible = p.x < W;
      renderer.render(scene, cam);
    };
    loop();
  }
  return { open };
})();
