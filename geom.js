// 計算部分（画面に依存しない）。index.html と test.mjs の両方から使う。単位はすべて cm
// 部屋は多角形（rooms[].pts、画面の向きで時計回り）。案は複数の部屋を持てる。ドア・窓は「どの部屋のどの辺か」で付ける
const G = (() => {
  const EPS = 0.01;
  // 家具の床に占める範囲を囲む四角（x, y はこの四角の左上）。回すと大きさが変わる。90° ごとなら幅と奥行きが入れ替わるだけ
  const RAD = Math.PI / 180;
  function dims(it) {
    const r = (((it.rot || 0) % 360) + 360) % 360;
    if (r % 90 === 0) return r % 180 ? [it.d, it.w] : [it.w, it.d];
    const c = Math.abs(Math.cos(r * RAD)), s = Math.abs(Math.sin(r * RAD));
    return [it.w * c + it.d * s, it.w * s + it.d * c];
  }
  const fp = it => { const [w, h] = dims(it); return { x: it.x, y: it.y, w, h }; };
  const center = it => { const [w, h] = dims(it); return [it.x + w / 2, it.y + h / 2]; };
  const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const corners = r => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];

  // ---------- 多角形 ----------
  const sarea = pts => pts.reduce((s, a, k) => { const b = pts[(k + 1) % pts.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
  // 辺 k の情報。u は辺の向き、n は部屋の内側を向く
  function edge(room, k) {
    const n = room.pts.length, a = room.pts[k % n], b = room.pts[(k + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9, u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    return { a, b, len, u, n: [-u[1], u[0]] };
  }
  const bbox = rooms => {
    const ps = rooms.flatMap(r => r.pts), xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  // 点が多角形の中（辺の上も中とみなす）
  function onSeg(p, a, b, e = EPS) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) <= e;
  }
  function inPoly(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if (onSeg(p, a, b)) return true;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  // 線分が四角の内側（縁は含まない）を通るか（Liang–Barsky）
  function segCrossRect(a, b, r) {
    const x0 = r.x + EPS, x1 = r.x + r.w - EPS, y0 = r.y + EPS, y1 = r.y + r.h - EPS;
    if (x0 >= x1 || y0 >= y1) return false;
    let t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t0 < t1;
  }
  const rectInRoom = (r, room) => corners(r).every(c => inPoly(c, room.pts)) &&
    !room.pts.some((a, k) => segCrossRect(a, room.pts[(k + 1) % room.pts.length], r));
  const rectInAny = (r, rooms) => rooms.some(room => rectInRoom(r, room));
  const distSeg = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const roomAt = (rooms, x, y) => rooms.find(room => inPoly([x, y], room.pts)) || null;
  // 2 本の線分が交わるか（端どうしが触れるだけは含まない）
  function segX(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  }
  // 辺どうしが交差しない、面積がある、点が重ならない
  function simple(pts) {
    const n = pts.length;
    if (n < 3 || Math.abs(sarea(pts)) < 1) return false;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) return false;
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segX(a, b, pts[j], pts[(j + 1) % n])) return false;
      }
    }
    return true;
  }
  // 凸多角形どうしの重なり（分離軸）。接しているだけは重ならない
  function polyOv(P, Q) {
    for (const S of [P, Q]) for (let i = 0; i < S.length; i++) {
      const a = S[i], b = S[(i + 1) % S.length], ax = -(b[1] - a[1]), ay = b[0] - a[0];
      if (!ax && !ay) continue;
      const pr = T => T.map(p => p[0] * ax + p[1] * ay), pp = pr(P), qq = pr(Q), l = Math.hypot(ax, ay) * EPS;
      if (Math.max(...pp) <= Math.min(...qq) + l || Math.max(...qq) <= Math.min(...pp) + l) return false;
    }
    return true;
  }
  // 凸多角形を半平面 dot(p - o, v) >= 0 で切る
  function clip(poly, o, v) {
    const out = [], f = p => (p[0] - o[0]) * v[0] + (p[1] - o[1]) * v[1];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length], fp_ = f(p), fq = f(q);
      if (fp_ >= 0) out.push(p);
      if ((fp_ >= 0) !== (fq >= 0)) { const t = fp_ / (fp_ - fq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
    });
    return out;
  }
  // ---------- 家具・ドア・窓 ----------
  const HORIZ = ['top', 'bottom'];
  // 前の空き（引き出し・扉を開ける場所）。回す前は下が前。多角形で返す（四角い家具だけ）
  function front(it) {
    const c = it.c || 0;
    if (!c || (it.shape && it.shape !== 'rect')) return null;
    return [[0, it.d], [it.w, it.d], [it.w, it.d + c], [0, it.d + c]].map(toPlan(it));
  }
  // 家具の形。「回す前の幅×奥行きの箱」の中の座標で作る（左上が 0,0、前は下）
  const armOf = it => Math.max(5, Math.min(it.a || 60, it.w - 5, it.d - 5));
  const isL = it => it.shape === 'L' && it.w > 10 && it.d > 10;
  // 凸の部品に分ける（重なりの計算は凸どうしでする）
  function localParts(it) {
    const w = it.w, d = it.d;
    if (it.shape === 'round') return [Array.from({ length: 24 }, (_, k) => [w / 2 + w / 2 * Math.cos(k * Math.PI / 12), d / 2 + d / 2 * Math.sin(k * Math.PI / 12)])];
    if (isL(it)) {
      // 奥（上）の辺に沿った帯と、左の辺に沿った帯（mir なら右）
      const a = armOf(it), m = q => (it.mir ? q.map(([x, y]) => [w - x, y]) : q);
      return [m([[0, 0], [w, 0], [w, a], [0, a]]), m([[0, a], [a, a], [a, d], [0, d]])];
    }
    return [[[0, 0], [w, 0], [w, d], [0, d]]];
  }
  // 外形（図に描く線）
  function localOutline(it) {
    if (isL(it)) {
      const w = it.w, d = it.d, a = armOf(it), q = [[0, 0], [w, 0], [w, a], [a, a], [a, d], [0, d]];
      return it.mir ? q.map(([x, y]) => [w - x, y]) : q;
    }
    return localParts(it)[0];
  }
  // 箱の中の座標を図の座標へ
  function toPlan(it) {
    const [cx, cy] = center(it), t = (it.rot || 0) * RAD, c = Math.cos(t), s = Math.sin(t);
    return ([x, y]) => { const lx = x - it.w / 2, ly = y - it.d / 2; return [cx + lx * c - ly * s, cy + lx * s + ly * c]; };
  }
  const parts = it => { const f = toPlan(it); return localParts(it).map(q => q.map(f)); };
  const outline = it => localOutline(it).map(toPlan(it));
  // 線分が凸多角形の内側（縁は含まない）を通るか
  function segCrossPoly(a, b, P) {
    const sg = Math.sign(sarea(P)) || 1; let t0 = 0, t1 = 1;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l < 1e-9) continue;
      const nx = -(q[1] - p[1]) * sg / l, ny = (q[0] - p[0]) * sg / l;
      const fa = (a[0] - p[0]) * nx + (a[1] - p[1]) * ny - EPS, fb = (b[0] - p[0]) * nx + (b[1] - p[1]) * ny - EPS;
      if (fa <= 0 && fb <= 0) return false;
      if (fa < 0 || fb < 0) { const t = fa / (fa - fb); if (fa < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t); }
      if (t0 >= t1) return false;
    }
    return t0 < t1;
  }
  const polyInRoom = (P, room) => P.every(c => inPoly(c, room.pts)) && !room.pts.some((a, k) => segCrossPoly(a, room.pts[(k + 1) % room.pts.length], P));
  const itemIn = (it, rooms) => { const ps = parts(it); return rooms.some(room => ps.every(P => polyInRoom(P, room))); };
  const itemsOv = (a, b) => ov(fp(a), fp(b)) && parts(a).some(P => parts(b).some(Q => polyOv(P, Q)));
  // 名前を置く点（L 字は奥の帯の真ん中）
  const labelAt = it => { if (!isL(it)) return center(it); const P = parts(it)[0]; return [P.reduce((s, q) => s + q[0], 0) / 4, P.reduce((s, q) => s + q[1], 0) / 4]; };
  const roomOf = (p, it) => p.rooms.find(r => r.id === it.room) || null;
  // ドア・窓の形。hinge は吊り元、leaf は開いた扉の先、n は扉が開く側（ふつうは部屋の内側、out なら外側）
  function door(it, p) {
    const room = roomOf(p, it); if (!room) return null;
    const e = edge(room, it.edge), a = [e.a[0] + e.u[0] * it.pos, e.a[1] + e.u[1] * it.pos];
    const b = [a[0] + e.u[0] * it.w, a[1] + e.u[1] * it.w];
    const hinge = it.hinge === 'b' ? b : a, tip = it.hinge === 'b' ? a : b, n = it.out ? [-e.n[0], -e.n[1]] : e.n;
    return { hinge, tip, leaf: [hinge[0] + n[0] * it.w, hinge[1] + n[1] * it.w], r: it.w, a, b, n, u: e.u, e, room };
  }
  // 開口から n の向きへ depth だけ伸ばした四角（多角形）
  function strip(it, p, depth) {
    const d = door(it, p); if (!d) return null;
    const n = it.t === 'win' ? d.e.n : d.n;
    return [d.a, d.b, [d.b[0] + n[0] * depth, d.b[1] + n[1] * depth], [d.a[0] + n[0] * depth, d.a[1] + n[1] * depth]];
  }
  // 凸多角形が扇形（開き戸の開く範囲）に入るか：扇の向きの 2 つの半平面で切り、残りで吊り元に一番近い点が半径の内側か
  function arcHit(P, d) {
    const t = [(d.tip[0] - d.hinge[0]) / d.r, (d.tip[1] - d.hinge[1]) / d.r];
    const c = clip(clip(P, d.hinge, d.n), d.hinge, t);
    if (c.length < 3 || Math.abs(sarea(c)) < EPS) return false;
    if (inPoly(d.hinge, c)) return true;
    return Math.min(...c.map((a, i) => distSeg(d.hinge, a, c[(i + 1) % c.length]))) < d.r - EPS;
  }
  const SLIDE_CLEAR = 50, WIN_CLEAR = 30;
  // 上下左右それぞれ、壁か一番近い家具までの距離（壁は中心を通る線で測る。壁が無い向きは Infinity）
  function gaps(r, obs, rooms) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let left = Infinity, right = Infinity, up = Infinity, down = Infinity;
    for (const room of rooms) room.pts.forEach((a, k) => {
      const b = room.pts[(k + 1) % room.pts.length];
      if ((a[1] - cy) * (b[1] - cy) <= 0 && a[1] !== b[1]) {
        const x = a[0] + (cy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
        if (x <= r.x + EPS) left = Math.min(left, Math.max(0, r.x - x));
        if (x >= r.x + r.w - EPS) right = Math.min(right, Math.max(0, x - r.x - r.w));
      }
      if ((a[0] - cx) * (b[0] - cx) <= 0 && a[0] !== b[0]) {
        const y = a[1] + (cx - a[0]) * (b[1] - a[1]) / (b[0] - a[0]);
        if (y <= r.y + EPS) up = Math.min(up, Math.max(0, r.y - y));
        if (y >= r.y + r.h - EPS) down = Math.min(down, Math.max(0, y - r.y - r.h));
      }
    });
    for (const o of obs) {
      if (o.y < r.y + r.h && r.y < o.y + o.h) {
        if (o.x + o.w <= r.x) left = Math.min(left, r.x - o.x - o.w);
        if (o.x >= r.x + r.w) right = Math.min(right, o.x - r.x - r.w);
      }
      if (o.x < r.x + r.w && r.x < o.x + o.w) {
        if (o.y + o.h <= r.y) up = Math.min(up, r.y - o.y - o.h);
        if (o.y >= r.y + r.h) down = Math.min(down, o.y - r.y - r.h);
      }
    }
    return { left, right, up, down };
  }
  // 壁（room の辺 k）に重なる、ほかの部屋の辺に付いた開口。壁の始点からの範囲 s0〜s1 で返す（3D で両側の壁をくり抜くため）
  function sharedOpenings(p, room, k) {
    const e = edge(room, k), out = [];
    for (const it of p.items) {
      if (it.t === 'f' || it.room === room.id) continue;
      const d = door(it, p); if (!d) continue;
      // 向かい合う辺で、同じ線の上にあるもの
      if (d.e.n[0] * e.n[0] + d.e.n[1] * e.n[1] > -0.99) continue;
      const off = q => (q[0] - e.a[0]) * e.n[0] + (q[1] - e.a[1]) * e.n[1], along = q => (q[0] - e.a[0]) * e.u[0] + (q[1] - e.a[1]) * e.u[1];
      if (Math.abs(off(d.a)) > 1 || Math.abs(off(d.b)) > 1) continue;
      const s0 = Math.max(0, Math.min(along(d.a), along(d.b))), s1 = Math.min(e.len, Math.max(along(d.a), along(d.b)));
      if (s1 - s0 > 1) out.push({ it, s0, s1 });
    }
    return out;
  }
  // 部屋 room の辺 k のうち、ほかの部屋の辺とぴったり接している範囲（辺の始点からの s0〜s1、相手の部屋 other）
  function sharedSpans(rooms, room, k) {
    const e = edge(room, k), out = [];
    const off = q => (q[0] - e.a[0]) * e.n[0] + (q[1] - e.a[1]) * e.n[1], along = q => (q[0] - e.a[0]) * e.u[0] + (q[1] - e.a[1]) * e.u[1];
    for (const r of rooms) if (r !== room) r.pts.forEach((_, j) => {
      const f = edge(r, j);
      if (f.n[0] * e.n[0] + f.n[1] * e.n[1] > -0.99 || Math.abs(off(f.a)) > 1 || Math.abs(off(f.b)) > 1) return;
      const s0 = Math.max(0, Math.min(along(f.a), along(f.b))), s1 = Math.min(e.len, Math.max(along(f.a), along(f.b)));
      if (s1 - s0 > 1) out.push({ s0, s1, other: r });
    });
    return out.sort((a, b) => a.s0 - b.s0);
  }
  // room の壁と、ほかの部屋の向かい合う平行な壁のうち、一番近いもの（すき間 gap、重なりは負）。
  // 横に重なる部分がある壁だけを見る。move はその壁どうしをぴったり付けるために room を動かす量
  function nearGap(rooms, room, maxGap) {
    let best = null;
    room.pts.forEach((_, k) => {
      const e = edge(room, k);
      const off = q => (q[0] - e.a[0]) * e.n[0] + (q[1] - e.a[1]) * e.n[1], along = q => (q[0] - e.a[0]) * e.u[0] + (q[1] - e.a[1]) * e.u[1];
      for (const r of rooms) if (r !== room) r.pts.forEach((_, j) => {
        const f = edge(r, j);
        if (f.n[0] * e.n[0] + f.n[1] * e.n[1] > -0.99 || Math.abs(off(f.a) - off(f.b)) > 1) return;
        const o = (off(f.a) + off(f.b)) / 2, gap = -o;
        if (Math.abs(gap) < 0.5 || Math.abs(gap) > maxGap) return;
        const s0 = Math.max(0, Math.min(along(f.a), along(f.b))), s1 = Math.min(e.len, Math.max(along(f.a), along(f.b)));
        if (s1 - s0 < 10) return;
        if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { gap, other: r, move: [-e.n[0] * gap, -e.n[1] * gap] };
      });
    });
    return best;
  }
  // 部屋を動かす（中の家具も。ロックした家具は動かさない）
  function moveRoom(p, room, mx, my) {
    mx = Math.round(mx); my = Math.round(my);
    const furn = p.items.filter(i => i.t === 'f' && !i.lock && inPoly(center(i), room.pts));
    room.pts = room.pts.map(q => [q[0] + mx, q[1] + my]);
    for (const i of furn) { i.x += mx; i.y += my; }
  }
  const GAP_WARN = 30;
  // 点 c に一番近い壁（部屋と辺の番号、辺の上の位置 t、距離 d）
  function nearestWall(rooms, c) {
    let best = null;
    for (const room of rooms) room.pts.forEach((a, k) => {
      const d = distSeg(c, a, room.pts[(k + 1) % room.pts.length]);
      if (!best || d < best.d - EPS) { const e = edge(room, k); best = { room, k, d, t: (c[0] - e.a[0]) * e.u[0] + (c[1] - e.a[1]) * e.u[1], len: e.len }; }
    });
    return best;
  }
  function issues(p) {
    // out は注意の文、ids はその注意に関わる部品の id、keys は注意を見分ける名前（無視するのに使う）
    // p.ign に入っている注意は ign に回し、件数や赤い表示には入れない
    const out = [], ids = [], keys = [], bad = new Set(), ign = [], skip = new Set(p.ign || []);
    const add = (key, msg, ...xs) => {
      if (skip.has(key)) { ign.push({ key, msg, ids: xs }); return; }
      out.push(msg); ids.push(xs); keys.push(key); xs.forEach(x => bad.add(x));
    };
    const rooms = p.rooms, fs = p.items.filter(i => i.t === 'f');
    const ds = p.items.filter(i => i.t === 'door' && roomOf(p, i)), wins = p.items.filter(i => i.t === 'win' && roomOf(p, i));
    const maxHt = Math.max(...rooms.map(r => r.ht));
    fs.forEach((a, i) => {
      const pa = parts(a), ca = center(a);
      if (!itemIn(a, rooms)) add(`out:${a.id}`, `${a.name} が部屋からはみ出しています`, a.id);
      const home = roomAt(rooms, ca[0], ca[1]);
      if ((a.h || 0) > (home ? home.ht : maxHt)) add(`ceil:${a.id}`, `${a.name} が天井より高いです`, a.id);
      fs.slice(i + 1).forEach(b => {
        if (itemsOv(a, b)) add(`ov:${a.id}:${b.id}`, `${a.name} と ${b.name} が重なっています`, a.id, b.id);
      });
      ds.forEach(d => {
        const hit = d.kind === 'slide' ? pa.some(P => polyOv(P, strip(d, p, SLIDE_CLEAR))) : pa.some(P => arcHit(P, door(d, p)));
        if (hit) add(`door:${a.id}:${d.id}`, d.kind === 'slide' ? `${a.name} が引き戸の前をふさいでいます` : `${a.name} がドアの開く範囲にあります`, a.id, d.id);
      });
      // 窓の下端より高い家具が窓の前にあると、窓をふさぐ
      wins.forEach(w => {
        if ((a.h || 0) > (w.sill || 0) && pa.some(P => polyOv(P, strip(w, p, WIN_CLEAR)))) add(`win:${a.id}:${w.id}`, `${a.name} が窓をふさいでいます`, a.id, w.id);
      });
      const z = front(a);
      if (z) {
        if (!rooms.some(room => polyInRoom(z, room))) add(`front:${a.id}`, `${a.name} の前の空きが壁で足りません`, a.id);
        fs.forEach(b => {
          if (b !== a && parts(b).some(Q => polyOv(z, Q))) add(`fz:${a.id}:${b.id}`, `${a.name} の前の空きに ${b.name} があります`, a.id);
        });
      }
    });
    // 片引き戸は、引く側に戸の幅だけ壁が要る
    ds.filter(d => d.kind === 'slide').forEach(d => {
      const len = edge(roomOf(p, d), d.edge).len;
      if (d.hinge === 'b' ? d.pos + 2 * d.w > len + EPS : d.pos < d.w - EPS) add(`slide:${d.id}`, '引き戸を引き込む分の壁が足りません', d.id);
    });
    // 部屋どうしの壁の間の小さなすき間（並べたつもりで離れている）。部屋の間のドアがつながらない原因になる
    rooms.forEach((a, i) => rooms.slice(i + 1).forEach(b => {
      const g = nearGap([a, b], a, GAP_WARN);
      if (g && g.gap > 0) add(`gap:${a.id}:${b.id}`, `${a.name} と ${b.name} の壁の間に ${Math.round(g.gap)}cm のすき間があります`);
    }));
    const ws = ds.concat(wins), label = i => i.t === 'door' ? (i.kind === 'slide' ? '引き戸' : 'ドア') : '窓';
    ws.forEach((a, i) => ws.slice(i + 1).forEach(b => {
      if (a.room === b.room && a.edge === b.edge && a.pos < b.pos + b.w && b.pos < a.pos + a.w) {
        add(`op:${a.id}:${b.id}`, `${label(a)}と${label(b)}が同じ壁で重なっています`, a.id, b.id);
      }
    }));
    return { out, ids, keys, bad, ign };
  }
  // 近い候補（th 以内）に吸い付け、なければ 5cm 単位に丸める
  function snap(v, cands, th) {
    let best = null;
    for (const c of cands) if (Math.abs(c - v) <= th && (best === null || Math.abs(c - v) < Math.abs(best - v))) best = c;
    return best !== null ? best : Math.round(v / 5) * 5;
  }
  // 吸い付きの候補にする壁の線（縦の壁の x、横の壁の y）
  function wallLines(rooms) {
    const xs = [], ys = [];
    for (const r of rooms) r.pts.forEach((a, k) => {
      const b = r.pts[(k + 1) % r.pts.length];
      if (Math.abs(a[0] - b[0]) < EPS) xs.push(a[0]);
      if (Math.abs(a[1] - b[1]) < EPS) ys.push(a[1]);
    });
    return { xs, ys };
  }
  // 1 畳 = 1.62㎡（中京間あたり。地域で差があるので「約」で出す）
  const area = rooms => { const a = [].concat(rooms).reduce((s, r) => s + Math.abs(sarea(r.pts)), 0); return { m2: a / 10000, jo: a / 16200 }; };

  // ---------- 部屋の形を変える ----------
  // 形の雛形。w・h は外側の四角の大きさ
  const SHAPES = {
    rect: (w, h) => [[0, 0], [w, 0], [w, h], [0, h]],
    L: (w, h) => { const a = Math.round(w * 0.55 / 5) * 5, b = Math.round(h * 0.45 / 5) * 5; return [[0, 0], [a, 0], [a, b], [w, b], [w, h], [0, h]]; },
    U: (w, h) => { const a = Math.round(w / 3 / 5) * 5, b = Math.round(h * 0.3 / 5) * 5; return [[0, 0], [a, 0], [a, b], [w - a, b], [w - a, 0], [w, 0], [w, h], [0, h]]; },
    cut: (w, h) => { const c = Math.round(Math.min(w, h) * 0.3 / 5) * 5; return [[0, 0], [w - c, 0], [w, c], [w, h], [0, h]]; },
  };
  // 形を変えたあと、ドア・窓を新しい辺に付け直す。map は「古い辺の番号 → 新しい辺の番号」
  // 開口の真ん中を新しい辺に投影して位置を決め、辺に収める
  function reshape(p, room, pts, map = k => k) {
    if (!simple(pts)) return false;
    if (sarea(pts) < 0) return false;
    const old = { ...room, pts: room.pts };
    const moved = p.items.filter(i => i.t !== 'f' && i.room === room.id).map(i => {
      const e = edge(old, i.edge), m = i.pos + i.w / 2;
      return [i, [e.a[0] + e.u[0] * m, e.a[1] + e.u[1] * m], m];
    });
    room.pts = pts.map(q => [Math.round(q[0]), Math.round(q[1])]);
    for (const [i, c, m] of moved) {
      // map が null なら一番近い辺へ（形をまるごと変えたとき）
      i.edge = map === null ? nearest(pts, c) : ((map(i.edge, m) % pts.length) + pts.length) % pts.length;
      const e = edge(room, i.edge), t = (c[0] - e.a[0]) * e.u[0] + (c[1] - e.a[1]) * e.u[1];
      i.w = Math.min(i.w, Math.floor(e.len));
      i.pos = Math.round(Math.max(0, Math.min(e.len - i.w, t - i.w / 2)));
    }
    return true;
  }
  const nearest = (pts, c) => pts.reduce((best, a, k) => {
    const d = distSeg(c, a, pts[(k + 1) % pts.length]); return d < best[1] ? [k, d] : best;
  }, [0, Infinity])[0];
  // 辺 k の長さを変える：辺の終わりの角と、その次の角を辺の向きにずらす（長方形なら向かいの壁ごと動く）
  // ほかの部屋のうち、動く壁より先（辺の向き u の側）に丸ごとある部屋は、中の家具ごと同じだけ動かす（隣の部屋と離れたり重なったりしないように）
  function setEdgeLen(p, room, k, len) {
    const n = room.pts.length, e = edge(room, k), d = len - e.len, pts = room.pts.map(q => [...q]), c0 = room.pts[(k + 1) % n];
    for (const j of [(k + 1) % n, (k + 2) % n]) { pts[j][0] += e.u[0] * d; pts[j][1] += e.u[1] * d; }
    const rooms = p.rooms || [];
    const ahead = rooms.filter(r => r !== room && r.pts.every(q => (q[0] - c0[0]) * e.u[0] + (q[1] - c0[1]) * e.u[1] >= -1));
    const furn = (p.items || []).filter(i => i.t === 'f' && !i.lock && (c => ahead.some(r => inPoly(c, r.pts)) && !inPoly(c, room.pts))(center(i)));
    if (!reshape(p, room, pts)) return false;
    const mx = Math.round(e.u[0] * d), my = Math.round(e.u[1] * d);
    for (const r of ahead) r.pts = r.pts.map(q => [q[0] + mx, q[1] + my]);
    for (const i of furn) { i.x += mx; i.y += my; }
    return true;
  }
  function addCorner(p, room, k) {
    const e = edge(room, k), pts = room.pts.map(q => [...q]);
    pts.splice(k + 1, 0, [Math.round((e.a[0] + e.b[0]) / 2), Math.round((e.a[1] + e.b[1]) / 2)]);
    // 辺 k の後半に付いていた開口は新しい辺 k+1 へ移る
    return reshape(p, room, pts, (j, m) => (j < k ? j : j > k ? j + 1 : m > e.len / 2 ? k + 1 : k));
  }
  function removeCorner(p, room, k) {
    const n = room.pts.length; if (n <= 3) return false;
    const pts = room.pts.filter((_, j) => j !== k);
    // 角 k を消すと、辺 k-1 と辺 k が 1 本（新しい辺 k-1）になる
    return reshape(p, room, pts, j => (j < k ? j : j === k ? k - 1 : j - 1));
  }
  const fitEdge = (room, i) => { const e = edge(room, i.edge); i.w = Math.max(10, Math.min(i.w, Math.floor(e.len))); i.pos = Math.max(0, Math.min(Math.round(e.len - i.w), i.pos)); };

  // ---------- 保存・読み込みしたデータの検査 ----------
  // おかしければ null（画面に出す値はここを通ったものだけ）。高さなど後から足した値は、無ければ既定値を入れる
  // 前の版（部屋が長方形 1 つで room: {w, h}、ドア・窓が wall: 'top' など）も読める
  const num = v => typeof v === 'number' && isFinite(v);
  const n_ = (v, lo = -1e4, hi = 1e4) => num(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : NaN;
  const opt = (v, def, lo, hi) => v === undefined ? def : n_(v, lo, hi);
  const newId = () => Math.random().toString(36).slice(2, 9);
  const OLDWALL = { top: 0, right: 1, bottom: 2, left: 3 };
  function clean(s) {
    if (!s || !Array.isArray(s.plans) || !s.plans.length) return null;
    const plans = [];
    for (const p of s.plans) {
      if (!p || typeof p.name !== 'string' || !Array.isArray(p.items)) return null;
      const used = new Set(), keepId = v => {
        const id = typeof v === 'string' && /^[a-z0-9]{1,12}$/i.test(v) && !used.has(v) ? v : newId();
        used.add(id); return id;
      };
      let rooms = [], legacy = null;
      // 部屋ごとに、向きを直したときの辺の付け替え
      const flip = {};
      if (Array.isArray(p.rooms)) {
        if (!p.rooms.length || p.rooms.length > 20) return null;
        for (const r of p.rooms) {
          if (!r || !Array.isArray(r.pts) || r.pts.length < 3 || r.pts.length > 64) return null;
          let pts = r.pts.map(q => Array.isArray(q) ? [n_(q[0]), n_(q[1])] : [NaN, NaN]);
          if (pts.some(q => isNaN(q[0] + q[1]))) return null;
          const a = sarea(pts); if (Math.abs(a) < 1) return null;
          const id = keepId(r.id);
          if (a < 0) { pts = pts.reverse(); flip[id] = pts.length; }
          const ht = opt(r.ht, 240, 100, 1000); if (isNaN(ht)) return null;
          rooms.push({ id, name: String(r.name ?? '部屋').slice(0, 40), ht, pts });
          if (typeof r.id === 'string' && r.id !== id) flip['@' + r.id] = id;
        }
      } else if (p.room) {
        const w = n_(p.room.w, 50), h = n_(p.room.h, 50), ht = opt(p.room.ht, 240, 100, 1000);
        if (isNaN(w + h + ht)) return null;
        rooms = [{ id: keepId('r1'), name: '部屋', ht, pts: SHAPES.rect(w, h) }];
        legacy = { w, h };
      } else return null;
      const items = [];
      for (const i of p.items) {
        if (!i) return null;
        const id = keepId(i.id);
        if (i.t === 'f') {
          const it = { id, t: 'f', name: String(i.name ?? '家具').slice(0, 40), x: n_(i.x), y: n_(i.y), w: n_(i.w, 1), d: n_(i.d, 1),
                       h: opt(i.h, 60, 1), c: opt(i.c, 0, 0), rot: opt(i.rot, 0, -720, 720) };
          if (isNaN(it.x + it.y + it.w + it.d + it.h + it.c + it.rot)) return null;
          it.rot = ((it.rot % 360) + 360) % 360;
          if (i.shape === 'round' || i.shape === 'L') it.shape = i.shape;
          if (it.shape === 'L') { it.a = opt(i.a, 60, 5, 1e4); if (isNaN(it.a)) return null; if (i.mir === true) it.mir = true; }
          if (i.col !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(i.col)) return null; it.col = i.col; }
          if (i.lock === true) it.lock = true;
          items.push(it);
        } else if (i.t === 'door' || i.t === 'win') {
          const it = { id, t: i.t, pos: n_(i.pos, 0), w: n_(i.w, 1), hinge: i.hinge === 'b' ? 'b' : 'a' };
          let room;
          if (legacy) {
            if (!(i.wall in OLDWALL)) return null;
            room = rooms[0]; it.room = room.id; it.edge = OLDWALL[i.wall];
            // 前の版の下の壁・左の壁は、右端・下端からではなく左端・上端から測っていた
            if (i.wall === 'bottom' || i.wall === 'left') {
              const len = i.wall === 'bottom' ? legacy.w : legacy.h;
              it.pos = len - it.pos - it.w; it.hinge = it.hinge === 'a' ? 'b' : 'a';
            }
          } else {
            const rid = flip['@' + i.room] || i.room;
            room = rooms.find(r => r.id === rid);
            if (!room || !Number.isInteger(i.edge) || i.edge < 0 || i.edge >= room.pts.length) return null;
            it.room = room.id; it.edge = i.edge;
            if (flip[room.id]) {
              // 向きを逆にした部屋：辺 k は n-2-k 番になり、測る端も逆になる
              const nn = flip[room.id], len0 = edge(room, (nn - 2 - i.edge + nn) % nn).len;
              it.edge = (nn - 2 - i.edge + nn) % nn; it.pos = Math.round(len0 - it.pos - it.w); it.hinge = it.hinge === 'a' ? 'b' : 'a';
            }
          }
          if (i.t === 'door') {
            it.kind = i.kind === 'slide' ? 'slide' : 'swing';
            it.h = opt(i.h, 200, 1);
            if (i.out === true) it.out = true;
          } else {
            delete it.hinge;
            it.sill = opt(i.sill, 90, 0);
            it.h = opt(i.h, 110, 1);
          }
          if (isNaN(it.pos + it.w + it.h + (it.sill ?? 0))) return null;
          // 壁の長さと天井の高さに収める（3D で壁の外に浮かないように）
          const len = edge(room, it.edge).len;
          it.w = Math.min(it.w, Math.floor(len)); it.pos = Math.max(0, Math.min(it.pos, Math.floor(len - it.w)));
          if (it.t === 'win') it.sill = Math.min(it.sill, room.ht - 1);
          if (i.lock === true) it.lock = true;
          items.push(it);
        } else return null;
      }
      const ign = Array.isArray(p.ign) ? p.ign.filter(k => typeof k === 'string' && /^[a-z]+(:[a-z0-9]{1,12}){1,2}$/i.test(k)).slice(0, 500) : [];
      plans.push({ name: p.name.slice(0, 40), rooms, items, ign });
    }
    return { plans, cur: num(s.cur) && s.cur >= 0 && s.cur < plans.length ? s.cur : 0 };
  }
  return { nearGap, moveRoom, GAP_WARN, sharedSpans, center, dims, parts, outline, localOutline, localParts, toPlan, itemIn, itemsOv, labelAt, polyInRoom, sharedOpenings, nearestWall, armOf, fp, ov, corners, edge, bbox, inPoly, rectInRoom, rectInAny, roomAt, simple, polyOv, sarea, front, roomOf, door, strip, arcHit,
           gaps, issues, snap, wallLines, area, SHAPES, reshape, setEdgeLen, addCorner, removeCorner, fitEdge, clean, HORIZ, SLIDE_CLEAR, WIN_CLEAR };
})();
