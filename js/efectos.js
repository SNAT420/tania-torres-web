// Transiciones y detalles de la página: aparición al hacer scroll, contadores, barra de progreso,
// línea de pasos, profundidad en tarjetas y mapa de zonas. Respeta "reducir movimiento" del sistema.
(function () {
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const raiz = document.documentElement;

  // ── Barra de progreso y navbar compacta
  const barra = document.createElement('div'); barra.className = 'progreso-scroll'; document.body.appendChild(barra);
  const nav = document.getElementById('navbar');
  let pendiente = false;
  function alScroll() {
    pendiente = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    barra.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
    nav && nav.classList.toggle('compacta', scrollY > 40);
    lineaPasos();
  }
  addEventListener('scroll', () => { if (!pendiente) { pendiente = true; requestAnimationFrame(alScroll); } }, { passive: true });

  // ── Aparición al hacer scroll
  const SEL = '.section-label, .section-title, .section-subtitle, .about-img-wrap, .about-grid > div:last-child > p, .stat-card, .zonas-mapa-wrap, .zone-card, .step, .sell-form, .credit-card, .calc, .reviews-carrusel, .review-form-wrap, .faq-list details, .contact-card, .prop-card, .credits-cta';
  const io = !reducido && 'IntersectionObserver' in window ? new IntersectionObserver(entradas => {
    for (const e of entradas) if (e.isIntersecting) { mostrar(e.target); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: .08 }) : null;
  function mostrar(el) {
    el.classList.add('vis');
    const limpiar = () => { el.classList.remove('rv', 'vis'); el.style.transitionDelay = ''; };
    el.addEventListener('transitionend', limpiar, { once: true });
    setTimeout(limpiar, 1600);
  }
  function preparar(contexto) {
    if (!io) return;
    contexto.querySelectorAll(SEL).forEach(el => {
      if (el.dataset.rvListo) return; el.dataset.rvListo = 1;
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight * .92 && r.bottom > 0 && contexto === document) return;   // ya visible al cargar
      const hermanos = [...el.parentElement.children].filter(h => h.matches(SEL));
      el.style.transitionDelay = Math.min(hermanos.indexOf(el), 6) * 80 + 'ms';
      el.classList.add('rv'); io.observe(el);
    });
  }
  if (io) raiz.classList.add('anim');
  preparar(document);
  // las propiedades y opiniones llegan después desde Firestore
  for (const id of ['props-grid', 'reviews-list']) {
    const el = document.getElementById(id);
    if (el) new MutationObserver(() => { preparar(el); profundidad(); }).observe(el, { childList: true });
  }

  // ── Contadores (+100, +5, 100%)
  const ioNum = new IntersectionObserver(entradas => {
    for (const e of entradas) if (e.isIntersecting) { contar(e.target); ioNum.unobserve(e.target); }
  }, { threshold: .6 });
  document.querySelectorAll('.stat-number').forEach(el => {
    const m = el.textContent.trim().match(/^(\D*)(\d+)(\D*)$/);
    if (!m || reducido) return;
    el.dataset.pre = m[1]; el.dataset.num = m[2]; el.dataset.suf = m[3];
    el.textContent = m[1] + '0' + m[3]; ioNum.observe(el);
  });
  function contar(el) {
    const fin = +el.dataset.num, t0 = performance.now(), dur = 1400;
    (function paso(t) {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = el.dataset.pre + Math.round(fin * e) + el.dataset.suf;
      if (k < 1) requestAnimationFrame(paso);
    })(t0);
  }

  // ── Línea dorada que avanza en los pasos de "Vender"
  const pasos = document.querySelector('.steps');
  if (pasos) { pasos.classList.add('con-linea'); const l = document.createElement('div'); l.className = 'steps-linea'; pasos.prepend(l); }
  function lineaPasos() {
    if (!pasos) return;
    const r = pasos.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (innerHeight * .62 - r.top) / r.height));
    pasos.style.setProperty('--p', reducido ? 1 : p);
    pasos.querySelectorAll('.step').forEach(st => {
      const sr = st.getBoundingClientRect();
      st.classList.toggle('activo', reducido || sr.top + 24 < innerHeight * .62);
    });
  }

  // ── Profundidad en tarjetas (solo con mouse)
  function profundidad() {
    if (reducido || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    document.querySelectorAll('.prop-card, .zone-card, .credit-card').forEach(c => {
      if (c.dataset.tilt) return; c.dataset.tilt = 1;
      c.addEventListener('pointermove', e => {
        const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        c.style.setProperty('--rx', (-y * 6).toFixed(2) + 'deg'); c.style.setProperty('--ry', (x * 8).toFixed(2) + 'deg');
        c.style.setProperty('--gx', (x + .5) * 100 + '%'); c.style.setProperty('--gy', (y + .5) * 100 + '%');
        c.classList.add('tilt');
      });
      c.addEventListener('pointerleave', () => { c.classList.remove('tilt'); c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); });
    });
  }
  profundidad();

  // ── Mapa de zonas: tarjeta ↔ municipio
  const mapa = document.querySelector('.zonas-mapa');
  if (mapa) {
    const activar = (id, on) => {
      mapa.querySelectorAll(`[data-zona="${id}"]`).forEach(el => el.classList.toggle('activa', on));
      document.querySelectorAll(`.zone-card[data-zona="${id}"]`).forEach(el => el.classList.toggle('activa', on));
    };
    document.querySelectorAll('[data-zona]').forEach(el => {
      el.addEventListener('pointerenter', () => activar(el.dataset.zona, true));
      el.addEventListener('pointerleave', () => activar(el.dataset.zona, false));
      el.addEventListener('focus', () => activar(el.dataset.zona, true));
      el.addEventListener('blur', () => activar(el.dataset.zona, false));
    });
    mapa.querySelectorAll('.zona-path, .zona-pin').forEach(el => el.addEventListener('click', () => {
      const card = document.querySelector(`.zone-card[data-zona="${el.dataset.zona}"]`);
      if (card) { card.focus({ preventScroll: true }); card.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'nearest' }); }
    }));
    const ioMapa = new IntersectionObserver(([e]) => { if (e.isIntersecting) { mapa.classList.add('dibujado'); ioMapa.disconnect(); } }, { threshold: .3 });
    ioMapa.observe(mapa);
    // si el hero manda a una zona, se ilumina al llegar
    document.addEventListener('click', e => {
      const pin = e.target.closest('.hero-pin'); if (!pin) return;
      setTimeout(() => { activar(pin.dataset.zona, true); setTimeout(() => activar(pin.dataset.zona, false), 2200); }, 700);
    });
  }

  alScroll();
})();
