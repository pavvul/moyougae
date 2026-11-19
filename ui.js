// iOS 風の部品：確認の窓（アラート）、メニュー、指で動かせる下のシート、横にスワイプする行
const UI = (() => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // ドラッグの直後に指を離した所の click が走らないようにする
  let noClickUntil = 0;
  const swallow = () => { noClickUntil = performance.now() + 350; };
  document.addEventListener('click', e => { if (performance.now() < noClickUntil) { e.stopPropagation(); e.preventDefault(); } }, true);

  // ---------- アラート ----------
  // buttons: [{label, role: 'cancel' | 'destructive' | 'default', value}]
  function dialog({ title, message = '', input = null, buttons }) {
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'alert-back';
      back.innerHTML = `<div class="alert" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="alert-body"><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}
        ${input !== null ? `<input type="text" class="alert-input" value="${esc(input)}" maxlength="40" enterkeyhint="done">` : ''}</div>
        <div class="alert-btns${buttons.length > 2 ? ' col' : ''}">${buttons.map((b, i) =>
          `<button data-i="${i}" class="${b.role || ''}">${esc(b.label)}</button>`).join('')}</div></div>`;
      document.body.appendChild(back);
      const box = back.querySelector('.alert'), inp = back.querySelector('input'), prev = document.activeElement;
      M.anim(back, [{ opacity: 0 }, { opacity: 1 }], 'quick');
      M.anim(box, [{ opacity: 0, transform: 'scale(1.18)' }, { opacity: 1, transform: 'none' }], 'snappy');
      const finish = b => {
        document.removeEventListener('keydown', key, true);
        const val = b.role === 'cancel' ? (input !== null ? null : false) : input !== null ? inp.value : (b.value ?? true);
        const a = back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: M.reduce.matches ? 1 : 160, fill: 'forwards' });
        a.finished.then(() => back.remove());
        if (prev && prev.focus) prev.focus({ preventScroll: true });
        resolve(val);
      };
      const key = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const c = buttons.find(b => b.role === 'cancel'); if (c) finish(c); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(buttons.find(b => b.role !== 'cancel') || buttons[0]); }
      };
      document.addEventListener('keydown', key, true);
      back.querySelectorAll('.alert-btns button').forEach(el => { el.onclick = () => finish(buttons[el.dataset.i]); });
      if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 60);
      else back.querySelector('.alert-btns button:last-child').focus({ preventScroll: true });
    });
  }
  const alert = (title, message) => dialog({ title, message, buttons: [{ label: 'OK', role: 'default' }] });
  const confirm = (title, message, ok = 'OK', destructive = false) =>
    dialog({ title, message, buttons: [{ label: 'キャンセル', role: 'cancel' }, { label: ok, role: destructive ? 'destructive' : 'default' }] });
  const prompt = (title, message, value) =>
    dialog({ title, message, input: value, buttons: [{ label: 'キャンセル', role: 'cancel' }, { label: 'OK', role: 'default' }] });

  // ---------- メニュー（ボタンから下に開く） ----------
  // sections: [[{label, sub, icon(svg 文字列), check, danger, disabled, run}]], 指を押したまま滑らせて選ぶこともできる
  let openMenu = null;
  function menu(anchor, sections, { title = '' } = {}) {
    if (openMenu) { openMenu(); return; }
    const back = document.createElement('div');
    back.className = 'menu-back';
    // 区切りの先頭に文字列を置くと、その区切りの見出しになる
    const items = sections.flatMap(sec => sec.filter(x => typeof x !== 'string'));
    back.innerHTML = `<div class="menu" role="menu">${title ? `<p class="menu-title">${esc(title)}</p>` : ''}${sections.map(sec => `<div class="menu-sec">${sec.map(it => typeof it === 'string' ? `<p class="menu-head">${esc(it)}</p>` :
      `<button role="menuitem" class="menu-item${it.danger ? ' danger' : ''}" data-i="${items.indexOf(it)}" ${it.disabled ? 'disabled' : ''}>
        <span class="mi-check">${it.check ? '<svg class="ico" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>' : ''}</span>
        <span class="mi-label">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.icon || ''}</button>`).join('')}</div>`).join('')}</div>`;
    document.body.appendChild(back);
    const m = back.querySelector('.menu'), r = anchor.getBoundingClientRect(), vw = innerWidth, mw = Math.min(280, vw - 16);
    m.style.width = mw + 'px';
    const left = r.left + r.width / 2 < vw / 2 ? Math.max(8, r.left) : Math.min(vw - 8 - mw, r.right - mw);
    m.style.left = left + 'px'; m.style.top = (r.bottom + 6) + 'px';
    m.style.maxHeight = `calc(100dvh - ${r.bottom + 20}px)`;
    // 押したボタンの位置から広がる
    m.style.transformOrigin = `${r.left + r.width / 2 - left}px -6px`;
    M.anim(m, [{ opacity: 0, transform: 'scale(.25)' }, { opacity: 1, transform: 'none' }], 'bouncy');
    anchor.classList.add('menu-open');
    const close = () => {
      if (!openMenu) return;
      openMenu = null; anchor.classList.remove('menu-open');
      document.removeEventListener('keydown', key, true);
      const a = m.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.9)' }], { duration: M.reduce.matches ? 1 : 180, easing: 'ease-out', fill: 'forwards' });
      a.finished.then(() => back.remove());
    };
    openMenu = close;
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    let hot = null;
    const hit = e => { const el = document.elementFromPoint(e.clientX, e.clientY); const b = el && el.closest('.menu-item'); return b && !b.disabled ? b : null; };
    const setHot = b => { if (hot === b) return; if (hot) hot.classList.remove('hot'); hot = b; if (b) b.classList.add('hot'); };
    back.addEventListener('pointerdown', e => {
      if (!e.target.closest('.menu')) { e.preventDefault(); close(); return; }
      setHot(hit(e));
    });
    back.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') setHot(hit(e)); });
    back.addEventListener('pointerup', e => {
      const b = hit(e); setHot(null);
      if (!b) return;
      const it = items[b.dataset.i];
      close();
      // メニューが閉じ始めてから実行する（次に開く窓と重ならないように）
      setTimeout(() => it.run && it.run(), 60);
    });
    back.addEventListener('pointercancel', () => setHot(null));
    back.querySelectorAll('.menu-item').forEach(b => {
      b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const it = items[b.dataset.i]; close(); setTimeout(() => it.run && it.run(), 60); } });
    });
    const first = back.querySelector('.menu-item:not(:disabled)'); if (first) first.focus({ preventScroll: true });
    return close;
  }

  // ---------- 下のシート（スマホ） ----------
  // 2 段（mid と large）。つかみ・見出しはいつでも、中身は「一番上までスクロールしているとき」に下へ引くとシートが動く
  // mid のときに中身を上へ引くと large に広がる（iOS と同じ）
  function sheet(el, { onDismiss, onSettle }) {
    const body = el.querySelector('.sheet-body');
    let y = 0, H = 0, detent = null, stop = null, g = null;
    const midH = () => Math.round(Math.max(260, H * 0.5));
    const posOf = d => (d === 'large' ? 0 : d === 'mid' ? H - midH() : H + 24);
    const set = v => { y = v; el.style.transform = `translate3d(0, ${v}px, 0)`; };
    const measure = () => { H = el.offsetHeight; };
    const visible = () => (detent ? Math.max(0, H - posOf(detent)) : 0);
    function go(d, v = 0, k = 'snappy') {
      if (stop) stop();
      measure();
      const target = posOf(d);
      detent = d === 'closed' ? null : d;
      el.dataset.detent = d;
      if (d !== 'closed') el.classList.add('shown');
      stop = M.springTo({ from: y, to: target, v, k, frame: set, done: () => {
        stop = null;
        if (d === 'closed') { el.classList.remove('shown'); onDismiss && onDismiss(); }
        else onSettle && onSettle(visible());
      } });
      if (onSettle) onSettle(visible(), true);
    }
    const open = (d = 'mid') => {
      measure();
      if (!detent) { set(H + 24); el.classList.add('shown'); }
      if (detent === d) return;
      go(d);
    };
    const close = () => { if (detent || el.classList.contains('shown')) go('closed', 0, 'smooth'); };
    // 一番上までスクロールしているときは、中身の上下の動きを自分で受け持つ（下へ引けばシートが動く）
    const atTop = () => body.classList.toggle('at-top', body.scrollTop <= 0);
    body.addEventListener('scroll', atTop, { passive: true });
    let inertia = null;
    el.addEventListener('pointerdown', e => {
      if (!detent || e.button > 0) return;
      if (inertia) { inertia(); inertia = null; }
      const inBody = body.contains(e.target);
      // large で中身をスクロールしているときはブラウザに任せる
      if (inBody && detent === 'large' && body.scrollTop > 0) return;
      if (e.target.closest('input,select,textarea')) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, y0: y, s0: body.scrollTop, mode: null, inBody, t: M.tracker() };
      g.t.add(e.clientX, e.clientY);
    });
    // 動きと離した瞬間は window で受ける（マウスがシートの外に出ても追えるように）
    addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      g.t.add(e.clientX, e.clientY);
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.mode) {
        if (Math.hypot(dx, dy) < 8) return;
        if (Math.abs(dx) > Math.abs(dy)) { g = null; return; } // 横は行のスワイプに任せる
        // 中身の上での上向き：large なら中身をスクロール、mid ならシートを広げる
        g.mode = g.inBody && dy < 0 && detent === 'large' ? 'scroll' : 'sheet';
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        if (stop) { stop(); stop = null; }
        g.y0 = y; g.y = e.clientY; g.x = e.clientX;
        el.classList.add('dragging');
        return;
      }
      const d = e.clientY - g.y;
      if (g.mode === 'scroll') { body.scrollTop = g.s0 - d; return; }
      let v = g.y0 + d;
      if (v < 0) v = -M.rubber(-v, H); // 一番上より上はゴムのように
      set(v);
    });
    const end = e => {
      if (!g || e.pointerId !== g.id) return;
      const mode = g.mode, [, vy] = g.t.v(); g = null;
      el.classList.remove('dragging');
      if (!mode) return;
      swallow();
      if (mode === 'scroll') {
        inertia = M.decay({ v: -vy, frame: dx => { const b = body.scrollTop; body.scrollTop += dx; return body.scrollTop !== b; } });
        return;
      }
      // 速さで先の位置を見込み、一番近い段へ
      const proj = y + vy * 180, cands = [['large', posOf('large')], ['mid', posOf('mid')], ['closed', posOf('closed')]];
      let best = cands.reduce((a, c) => (Math.abs(c[1] - proj) < Math.abs(a[1] - proj) ? c : a))[0];
      if (best === 'closed' && vy < 1.2 && y < posOf('mid') + midH() * 0.3) best = 'mid';
      go(best, vy);
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
    return {
      open, close, go, visible, get detent() { return detent; },
      toggle: () => go(detent === 'large' ? 'mid' : 'large'),
      relayout: () => { if (!detent) return; measure(); if (stop) stop(); set(posOf(detent)); },
      resetScroll: () => { body.scrollTop = 0; atTop(); },
    };
  }

  // ---------- 横にスワイプして操作を出す行 ----------
  // .swipe の中に .swipe-acts（後ろに隠れたボタン）と .swipe-face（表の行）を置く。左へ大きく引ききると最初の操作を実行
  let openRow = null;
  const shut = (row, v = 0) => {
    const face = row.querySelector('.swipe-face');
    M.springTo({ from: row._x || 0, to: 0, v, k: 'snappy', frame: x => { row._x = x; face.style.transform = `translateX(${x}px)`; } });
    if (openRow === row) openRow = null;
  };
  function swipeRows(container) {
    container.addEventListener('pointerdown', e => {
      const row = e.target.closest('.swipe');
      if (openRow && openRow !== row) shut(openRow);
      if (!row) return;
      const face = row.querySelector('.swipe-face'), acts = row.querySelector('.swipe-acts');
      const aw = acts.offsetWidth, x0 = row._x || 0, t = M.tracker();
      let mode = null;
      t.add(e.clientX, 0);
      const mv = ev => {
        if (ev.pointerId !== e.pointerId) return;
        t.add(ev.clientX, 0);
        const dx = ev.clientX - e.clientX, dy = ev.clientY - e.clientY;
        if (!mode) {
          if (Math.hypot(dx, dy) < 8) return;
          mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'none';
          if (mode === 'swipe') { try { row.setPointerCapture(ev.pointerId); } catch (err) {} }
          return;
        }
        if (mode !== 'swipe') return;
        let x = x0 + dx;
        if (x > 0) x = M.rubber(x, row.offsetWidth);
        const full = row.offsetWidth * 0.62;
        row.classList.toggle('full', -x > full);
        row._x = x; face.style.transform = `translateX(${x}px)`;
      };
      const up = ev => {
        if (ev.pointerId !== e.pointerId) return;
        removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        if (mode !== 'swipe') return;
        swallow();
        const [vx] = t.v(), x = row._x || 0;
        if (row.classList.contains('full')) {
          row.classList.remove('full');
          noClickUntil = 0; row.querySelector('.swipe-acts button').click(); swallow();
          return;
        }
        const openIt = x + vx * 120 < -aw / 2;
        M.springTo({ from: x, to: openIt ? -aw : 0, v: vx, k: 'snappy', frame: v => { row._x = v; face.style.transform = `translateX(${v}px)`; } });
        openRow = openIt ? row : null;
      };
      addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
  }
  return { dialog, alert, confirm, prompt, menu, sheet, swipeRows, closeMenu: () => openMenu && openMenu(), swallow };
})();
