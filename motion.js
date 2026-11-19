// 動きの土台。iOS と同じく「ばね」で動かす（時間ではなく、ばねの強さと揺れの止まりやすさで決める）
const M = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  // response は 1 往復の時間（秒）、damping は 1 で揺れなし、小さいほど弾む
  function spring(response, damping) {
    const w0 = 2 * Math.PI / response, z = damping;
    const f = z < 1
      ? t => { const wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + z * w0 / wd * Math.sin(wd * t)); }
      : t => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    let T = 0.1;
    while (T < 4 && [0, 0.03, 0.06].some(d => Math.abs(1 - f(T + d)) > 0.002)) T += 0.01;
    const pts = Array.from({ length: 48 }, (_, i) => +f(T * i / 47).toFixed(4)); pts[47] = 1;
    return { f: t => (t >= T ? 1 : f(t)), ms: Math.round(T * 1000), css: `linear(${pts.join(',')})`, w0, z };
  }
  // iOS の既定に近い 3 種類：smooth（揺れなし）・snappy（ほぼ揺れなし）・bouncy（少し弾む）
  const S = { smooth: spring(0.5, 1), snappy: spring(0.42, 0.86), bouncy: spring(0.5, 0.7), quick: spring(0.3, 1) };
  const root = document.documentElement.style;
  for (const k in S) { root.setProperty(`--sp-${k}`, S[k].css); root.setProperty(`--sp-${k}-ms`, S[k].ms + 'ms'); }

  // WAAPI に渡す設定。動きを減らす設定の人には一瞬で終える
  const opt = (k = 'smooth', extra = {}) => ({ duration: reduce.matches ? 1 : S[k].ms, easing: S[k].css, fill: 'both', ...extra });
  // 要素を動かす（終わったら最後の状態を style に書いて、アニメーションは消す）
  function anim(el, kf, k = 'smooth', extra) {
    if (!el) return null;
    const a = el.animate(kf, opt(k, extra));
    a.finished.then(() => { try { a.commitStyles(); } catch (e) {} a.cancel(); }, () => {});
    return a;
  }
  // 数値を 0→1 で動かす（JS で毎フレーム描き直すもの用）。止める関数を返す
  function tween(k, frame, done) {
    if (reduce.matches) { frame(1); done && done(); return () => {}; }
    const s = S[k], t0 = performance.now(); let id = 0, live = true;
    const step = now => {
      if (!live) return;
      const t = (now - t0) / 1000, v = s.f(t);
      frame(v);
      if (v === 1) { live = false; done && done(); } else id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => { live = false; cancelAnimationFrame(id); };
  }
  // 指を離したときの速さを引き継ぐばね（シートなど）。x を to へ、初速 v（px/ms）
  function springTo({ from, to, v = 0, k = 'snappy', frame, done }) {
    if (reduce.matches) { frame(to); done && done(); return () => {}; }
    const { w0, z } = S[k];
    let x = from - to, vel = v * 1000, last = performance.now(), id = 0, live = true;
    const step = now => {
      if (!live) return;
      let dt = Math.min(0.064, (now - last) / 1000); last = now;
      // 細かく刻んで計算する（半陰的オイラー）
      while (dt > 0) {
        const h = Math.min(dt, 0.004);
        vel += (-w0 * w0 * x - 2 * z * w0 * vel) * h; x += vel * h; dt -= h;
      }
      if (Math.abs(x) < 0.3 && Math.abs(vel) < 20) { live = false; frame(to); done && done(); return; }
      frame(to + x); id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => { live = false; cancelAnimationFrame(id); };
  }
  // 指で投げたあとの惰性（iOS のスクロールと同じ減り方：1ms ごとに 0.998 倍）
  function decay({ v, frame, done, rate = 0.998 }) {
    if (reduce.matches || Math.abs(v) < 0.05) { done && done(); return () => {}; }
    let last = performance.now(), id = 0, live = true;
    const step = now => {
      if (!live) return;
      const dt = Math.min(64, now - last); last = now;
      const nv = v * Math.pow(rate, dt), dx = (v - nv) / -Math.log(rate);
      v = nv;
      if (frame(dx) === false || Math.abs(v) < 0.02) { live = false; done && done(); return; }
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => { live = false; cancelAnimationFrame(id); };
  }
  // 端を越えて引っぱったときのゴムのような抵抗（iOS の式）
  const rubber = (x, dim, c = 0.55) => (1 - 1 / (x * c / dim + 1)) * dim;
  // 指の速さを測る（最後の 100ms から）
  function tracker() {
    const pts = [];
    return {
      add(x, y) { const t = performance.now(); pts.push([t, x, y]); while (pts.length > 2 && t - pts[0][0] > 100) pts.shift(); },
      v() {
        if (pts.length < 2) return [0, 0];
        const a = pts[0], b = pts[pts.length - 1], dt = b[0] - a[0];
        return dt < 8 || performance.now() - b[0] > 80 ? [0, 0] : [(b[1] - a[1]) / dt, (b[2] - a[2]) / dt];
      },
    };
  }
  return { S, opt, anim, tween, springTo, decay, rubber, tracker, reduce };
})();
