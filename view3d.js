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
    const b = G.bbox(plan.rooms), D = Math.max(b.w, b.h), scene = new THREE.Scene(), { bad } = G.issues(plan);
    scene.background = new THREE.Color(css('--bg') || '#f4f1ea');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8170, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(b.x + b.w * 0.3, 720, b.y + b.h * 1.2); scene.add(sun);

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
    // 壁に沿った板：辺の始点 a から向き u に s0〜s1、外向き out に o0〜o1 の厚み、高さ y0〜y1
    function slab(a, u, out, s0, s1, o0, o1, y0, y1, material, edges, parent) {
      if (s1 - s0 <= 0.01 || y1 - y0 <= 0.01) return;
      const g = new THREE.BoxGeometry(s1 - s0, y1 - y0, o1 - o0), m = new THREE.Mesh(g, material);
      const sm = (s0 + s1) / 2, om = (o0 + o1) / 2;
      m.position.set(a[0] + u[0] * sm + out[0] * om, (y0 + y1) / 2, a[1] + u[1] * sm + out[1] * om);
      m.rotation.y = Math.atan2(-u[1], u[0]); parent.add(m);
      if (edges) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(g), lineMat); l.position.copy(m.position); l.rotation.copy(m.rotation); parent.add(l); }
    }

    const floorMat = mat(0xe8dcc4, { side: THREE.DoubleSide }), wallMat = mat(0xf7f4ee), walls = [], gridPts = [];
    for (const room of plan.rooms) {
      const HT = room.ht, pts = room.pts, n = pts.length;
      // 床（多角形）。ShapeGeometry は XY 平面なので、x 軸で倒して y を -z にする
      const shape = new THREE.Shape(pts.map(q => new THREE.Vector2(q[0], -q[1])));
      const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMat);
      floor.rotation.x = -Math.PI / 2; scene.add(floor);
      // 床に 50cm ごとの線（部屋の中の部分だけ）
      const scan = (c, vert) => {
        const xs = [];
        pts.forEach((a, k) => {
          const q = pts[(k + 1) % n], [a0, a1, q0, q1] = vert ? [a[0], a[1], q[0], q[1]] : [a[1], a[0], q[1], q[0]];
          if ((a0 - c) * (q0 - c) < 0) xs.push(a1 + (c - a0) * (q1 - a1) / (q0 - a0));
        });
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) gridPts.push(...(vert ? [c, 0.2, xs[i], c, 0.2, xs[i + 1]] : [xs[i], 0.2, c, xs[i + 1], 0.2, c]));
      };
      const rb = G.bbox([room]);
      for (let x = Math.ceil(rb.x / 50) * 50; x < rb.x + rb.w; x += 50) scan(x, true);
      for (let z = Math.ceil(rb.y / 50) * 50; z < rb.y + rb.h; z += 50) scan(z, false);
      // 壁：辺ごとに、ドアと窓の部分をくり抜いて塊に分けて組む。外へ出っ張る角では壁を厚みの分だけ伸ばしてすき間をふさぐ
      const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
      for (let k = 0; k < n; k++) {
        const e = G.edge(room, k), out = [-e.n[0], -e.n[1]], grp = new THREE.Group(); scene.add(grp);
        walls.push({ grp, a: e.a, n: e.n });
        const prev = G.edge(room, (k - 1 + n) % n), next = G.edge(room, (k + 1) % n);
        const s0 = cross(prev.u, e.u) > 0 ? -T : 0, s1 = e.len + (cross(e.u, next.u) > 0 ? T : 0);
        const piece = (p0, p1, y0, y1) => slab(e.a, e.u, out, p0, p1, 0, T, y0, y1, wallMat, true, grp);
        const ops = plan.items.filter(i => i.t !== 'f' && i.room === room.id && i.edge === k)
          .map(i => ({ a: i.pos, b: i.pos + i.w, lo: i.t === 'win' ? i.sill : 0, hi: Math.min(HT, (i.t === 'win' ? i.sill : 0) + i.h), it: i }))
          .sort((p, q) => p.a - q.a);
        let cur = s0;
        for (const o of ops) {
          if (o.a > cur) piece(cur, o.a, 0, HT);
          const a = Math.max(cur, o.a);
          if (o.b > a) { piece(a, o.b, 0, o.lo); piece(a, o.b, o.hi, HT); }
          cur = Math.max(cur, o.b);
        }
        piece(cur, s1, 0, HT);
        // 戸とガラス（閉じた状態で描く）
        for (const o of ops) {
          const isWin = o.it.t === 'win', m = isWin ? mat(0x9cc8e0, { transparent: true, opacity: 0.35 }) : mat(bad.has(o.it.id) ? 0xc2412d : 0xa58a64);
          const th = isWin ? 1 : 3, off = isWin ? T / 2 : (o.it.kind === 'slide' ? 2 : T / 2);
          slab(e.a, e.u, out, o.a, o.b, off - th / 2, off + th / 2, o.lo, o.hi, m, !isWin, grp);
        }
      }
    }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    scene.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xcfc7b5 })));

    // 家具
    for (const it of plan.items.filter(i => i.t === 'f')) {
      // 選んだ色はそのまま使い、注意が出ている家具は赤い縁で示す（色を付けていなければ赤く塗る）
      const r = G.fp(it), isBad = bad.has(it.id), color = it.col ? new THREE.Color(it.col) : isBad ? 0xe58a78 : 0xd9c6a5;
      box(r.x, r.y, r.w, r.h, 0, it.h, mat(color), isBad ? badLine : true);
      // 前の面に細い帯を付けて向きが分かるようにする
      const q = (it.rot / 90) % 4, s = 3, fm = mat(0x8a7350);
      const fr = [[r.x, r.y + r.h - s, r.w, s], [r.x, r.y, s, r.h], [r.x, r.y, r.w, s], [r.x + r.w - s, r.y, s, r.h]][q];
      box(fr[0], fr[1], fr[2], fr[3], it.h - Math.min(6, it.h), it.h + 0.3, fm, false);
      scene.add(label(it.name, r.x + r.w / 2, it.h + 14, r.y + r.h / 2, D));
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
    // 全画面の画面として下からせり上がる（iOS の全画面表示と同じ）
    M.anim(ov, [{ transform: 'translateY(100%)' }, { transform: 'none' }], 'snappy');
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
      document.body.style.overflow = '';
      const a = ov.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: M.reduce.matches ? 1 : 320, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'forwards' });
      a.finished.then(() => ov.remove());
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
    const bb = G.bbox(plan.rooms), W = bb.w, H = bb.h, X = bb.x + W / 2, Z = bb.y + H / 2;
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
      iso: () => { cam.position.set(X + D * 0.6, D * 1.1, Z + D * 1.0); ctl.target.set(X, 40, Z); },
      top: () => { cam.position.set(X, D * 1.6, Z + 1); ctl.target.set(X, 0, Z); },
      eye: () => { cam.position.set(X, 150, bb.y + H - 20); ctl.target.set(X, 110, Z - 40); },
    };
    for (const k in views) if (k !== 'close') ov.querySelector(`[data-v="${k}"]`).onclick = () => { views[k](); ctl.update(); };
    views.iso(); ctl.update();
    addEventListener('resize', fit); fit();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      ctl.update();
      // カメラ側の壁は隠して中が見えるようにする（部屋の中にいるときは全部の壁を出す）
      const p = cam.position;
      for (const w of walls) w.grp.visible = (p.x - w.a[0]) * w.n[0] + (p.z - w.a[1]) * w.n[1] > 0;
      renderer.render(scene, cam);
    };
    loop();
  }
  return { open };
})();
