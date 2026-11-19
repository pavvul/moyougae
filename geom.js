// 計算部分（画面に依存しない）。index.html と test.mjs の両方から使う。単位はすべて cm
const G = (() => {
  // 家具の床に占める四角（回転 90°/270° で幅と奥行きが入れ替わる）
  const fp = it => it.rot % 180 ? { x: it.x, y: it.y, w: it.d, h: it.w } : { x: it.x, y: it.y, w: it.w, h: it.d };
  const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inRoom = (r, room) => r.x >= 0 && r.y >= 0 && r.x + r.w <= room.w && r.y + r.h <= room.h;
  const horiz = wall => wall === 'top' || wall === 'bottom';
  // 前の空き（引き出し・扉を開ける場所）。回転 0 は下向き、時計回りに 90° ずつ
  function front(it) {
    const r = fp(it), c = it.c || 0;
    if (!c) return null;
    return [{ x: r.x, y: r.y + r.h, w: r.w, h: c }, { x: r.x - c, y: r.y, w: c, h: r.h },
            { x: r.x, y: r.y - c, w: r.w, h: c }, { x: r.x + r.w, y: r.y, w: c, h: r.h }][(it.rot / 90) % 4];
  }
  // 壁の開口から部屋の内側へ depth だけ伸ばした四角
  function strip(it, room, depth) {
    const p = it.pos, w = it.w;
    return { top: { x: p, y: 0, w, h: depth }, bottom: { x: p, y: room.h - depth, w, h: depth },
             left: { x: 0, y: p, w: depth, h: w }, right: { x: room.w - depth, y: p, w: depth, h: w } }[it.wall];
  }
  // ドア・窓の形。sq は開き戸の開く範囲を囲む四角、hinge は吊り元、leaf は開いた扉の先
  function door(it, room) {
    const p = it.pos, w = it.w, hz = horiz(it.wall);
    const c = { top: 0, bottom: room.h, left: 0, right: room.w }[it.wall];
    const a = hz ? [p, c] : [c, p], b = hz ? [p + w, c] : [c, p + w];
    const hinge = it.hinge === 'b' ? b : a, tip = it.hinge === 'b' ? a : b;
    const n = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] }[it.wall];
    return { sq: strip(it, room, w), hinge, tip, leaf: [hinge[0] + n[0] * w, hinge[1] + n[1] * w], r: w, a, b, n };
  }
  // 四角が扇形（開き戸の開く範囲）に入るか：四角の重なり部分で吊り元に一番近い点が半径の内側か
  function arcHit(r, d) {
    const s = d.sq, x1 = Math.max(r.x, s.x), y1 = Math.max(r.y, s.y),
          x2 = Math.min(r.x + r.w, s.x + s.w), y2 = Math.min(r.y + r.h, s.y + s.h);
    if (x1 >= x2 || y1 >= y2) return false;
    const cx = Math.min(Math.max(d.hinge[0], x1), x2), cy = Math.min(Math.max(d.hinge[1], y1), y2);
    return Math.hypot(cx - d.hinge[0], cy - d.hinge[1]) < d.r - 0.01;
  }
  const SLIDE_CLEAR = 50, WIN_CLEAR = 30;
  // 上下左右それぞれ、壁か一番近い家具までの距離
  function gaps(r, obs, room) {
    let left = r.x, right = room.w - r.x - r.w, up = r.y, down = room.h - r.y - r.h;
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
  function issues(p) {
    // out は注意の文、ids は同じ順でその注意に関わる部品の id（一覧から部品へ飛ぶのに使う）
    const out = [], ids = [], bad = new Set();
    const add = (msg, ...xs) => { out.push(msg); ids.push(xs); xs.forEach(x => bad.add(x)); };
    const fs = p.items.filter(i => i.t === 'f'), ds = p.items.filter(i => i.t === 'door'), wins = p.items.filter(i => i.t === 'win');
    fs.forEach((a, i) => {
      const ra = fp(a);
      if (!inRoom(ra, p.room)) { add(`${a.name} が部屋からはみ出しています`, a.id); }
      if ((a.h || 0) > (p.room.ht || Infinity)) { add(`${a.name} が天井より高いです`, a.id); }
      fs.slice(i + 1).forEach(b => {
        if (ov(ra, fp(b))) { add(`${a.name} と ${b.name} が重なっています`, a.id, b.id); }
      });
      ds.forEach(d => {
        const hit = d.kind === 'slide' ? ov(ra, strip(d, p.room, SLIDE_CLEAR)) : arcHit(ra, door(d, p.room));
        if (hit) { add(d.kind === 'slide' ? `${a.name} が引き戸の前をふさいでいます` : `${a.name} がドアの開く範囲にあります`, a.id, d.id); }
      });
      // 窓の下端より高い家具が窓の前にあると、窓をふさぐ
      wins.forEach(w => {
        if ((a.h || 0) > (w.sill || 0) && ov(ra, strip(w, p.room, WIN_CLEAR))) { add(`${a.name} が窓をふさいでいます`, a.id, w.id); }
      });
      const z = front(a);
      if (z) {
        if (!inRoom(z, p.room)) { add(`${a.name} の前の空きが壁で足りません`, a.id); }
        fs.forEach(b => {
          if (b !== a && ov(z, fp(b))) { add(`${a.name} の前の空きに ${b.name} があります`, a.id); }
        });
      }
    });
    // 片引き戸は、引く側に戸の幅だけ壁が要る
    ds.filter(d => d.kind === 'slide').forEach(d => {
      const len = horiz(d.wall) ? p.room.w : p.room.h;
      if (d.hinge === 'b' ? d.pos + 2 * d.w > len : d.pos < d.w) { add('引き戸を引き込む分の壁が足りません', d.id); }
    });
    const ws = p.items.filter(i => i.t !== 'f'), label = i => i.t === 'door' ? (i.kind === 'slide' ? '引き戸' : 'ドア') : '窓';
    ws.forEach((a, i) => ws.slice(i + 1).forEach(b => {
      if (a.wall === b.wall && a.pos < b.pos + b.w && b.pos < a.pos + a.w) {
        add(`${label(a)}と${label(b)}が同じ壁で重なっています`, a.id, b.id);
      }
    }));
    return { out, ids, bad };
  }
  // 近い候補（th 以内）に吸い付け、なければ 5cm 単位に丸める
  function snap(v, cands, th) {
    let best = null;
    for (const c of cands) if (Math.abs(c - v) <= th && (best === null || Math.abs(c - v) < Math.abs(best - v))) best = c;
    return best !== null ? best : Math.round(v / 5) * 5;
  }
  // 1 畳 = 1.62㎡（中京間あたり。地域で差があるので「約」で出す）
  const area = room => ({ m2: room.w * room.h / 10000, jo: room.w * room.h / 16200 });
  // 保存・読み込みしたデータを検査して作り直す。おかしければ null（画面に出す値はここを通ったものだけ）
  // 高さなど後から足した値は、無ければ既定値を入れる（前の版で書き出したファイルも読める）
  const num = v => typeof v === 'number' && isFinite(v);
  const n = (v, lo = -1e4, hi = 1e4) => num(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : NaN;
  const opt = (v, def, lo, hi) => v === undefined ? def : n(v, lo, hi);
  function clean(s) {
    if (!s || !Array.isArray(s.plans) || !s.plans.length) return null;
    const plans = [];
    for (const p of s.plans) {
      if (!p || typeof p.name !== 'string' || !p.room || !Array.isArray(p.items)) return null;
      const room = { w: n(p.room.w, 50), h: n(p.room.h, 50), ht: opt(p.room.ht, 240, 100, 1000) };
      if (isNaN(room.w + room.h + room.ht)) return null;
      const items = [];
      for (const i of p.items) {
        if (!i) return null;
        const id = Math.random().toString(36).slice(2, 9);
        if (i.t === 'f') {
          const it = { id, t: 'f', name: String(i.name ?? '家具').slice(0, 40), x: n(i.x), y: n(i.y), w: n(i.w, 1), d: n(i.d, 1),
                       h: opt(i.h, 60, 1), c: opt(i.c, 0, 0), rot: opt(i.rot, 0, 0, 270) };
          if (isNaN(it.x + it.y + it.w + it.d + it.h + it.c) || it.rot % 90) return null;
          if (i.col !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(i.col)) return null; it.col = i.col; }
          if (i.lock === true) it.lock = true;
          items.push(it);
        } else if (i.t === 'door' || i.t === 'win') {
          if (!['top', 'bottom', 'left', 'right'].includes(i.wall)) return null;
          const it = { id, t: i.t, wall: i.wall, pos: n(i.pos, 0), w: n(i.w, 1) };
          if (i.t === 'door') {
            it.hinge = i.hinge === 'b' ? 'b' : 'a';
            it.kind = i.kind === 'slide' ? 'slide' : 'swing';
            it.h = opt(i.h, 200, 1);
          } else {
            it.sill = opt(i.sill, 90, 0);
            it.h = opt(i.h, 110, 1);
          }
          if (isNaN(it.pos + it.w + it.h + (it.sill ?? 0))) return null;
          // 壁の長さと天井の高さに収める（3D で壁の外に浮かないように）
          const len = horiz(it.wall) ? room.w : room.h;
          it.w = Math.min(it.w, len); it.pos = Math.min(it.pos, len - it.w);
          if (it.t === 'win') it.sill = Math.min(it.sill, room.ht - 1);
          if (i.lock === true) it.lock = true;
          items.push(it);
        } else return null;
      }
      plans.push({ name: p.name.slice(0, 40), room, items });
    }
    return { plans, cur: num(s.cur) && s.cur >= 0 && s.cur < plans.length ? s.cur : 0 };
  }
  return { fp, ov, inRoom, horiz, front, strip, door, arcHit, gaps, issues, snap, area, clean, SLIDE_CLEAR, WIN_CLEAR };
})();
