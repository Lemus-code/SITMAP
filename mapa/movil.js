/* SITMAP · comportamiento en teléfono: hojas inferiores plegables, búsqueda desplegable y márgenes del mapa. */
(function () {
  const BP = 820; // ancho máximo del diseño de teléfono (igual que movil.css)
  const movil = () => window.innerWidth <= BP;

  // Rectángulo libre para encuadrar el mapa, sin quedar debajo de la barra superior, la hoja inferior ni la línea de tiempo.
  function extent(W, H, esc) {
    if (!movil()) {
      const aba = H - esc.aba - esc.arr < 160 ? Math.max(10, H - esc.arr - 160) : esc.aba;
      return [[esc.izq, esc.arr], [Math.max(esc.izq + 100, W - esc.der), Math.max(esc.arr + 100, H - aba)]];
    }
    const top = document.querySelector('.panel-top');
    const arr = top ? Math.round(top.getBoundingClientRect().bottom) + 10 : 110;
    let aba = 86; // hoja plegada
    const tl = document.querySelector('.timeline');
    if (tl && getComputedStyle(tl).display !== 'none') aba += Math.round(tl.getBoundingClientRect().height) + 8;
    const y1 = Math.max(arr + 120, H - aba);
    return [[10, arr], [W - 10, y1]];
  }

  function hojas() {
    document.querySelectorAll('.panel-left').forEach((p) => {
      if (p.querySelector('.sheet-toggle')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sheet-toggle'; b.setAttribute('aria-expanded', 'false');
      const t = document.createElement('span'); t.textContent = 'Indicadores, capas y cifras';
      const i = document.createElement('i'); i.setAttribute('aria-hidden', 'true');
      b.append(t, i);
      b.onclick = () => {
        const abierto = p.classList.toggle('abierto');
        b.setAttribute('aria-expanded', String(abierto));
        t.textContent = abierto ? 'Ocultar opciones' : 'Indicadores, capas y cifras';
        if (abierto) p.scrollTop = 0;
      };
      p.prepend(b);
    });
  }

  function buscador() {
    const btn = document.getElementById('btn-buscar');
    const top = document.querySelector('.panel-top');
    const inp = document.getElementById('search');
    if (!btn || !top || !inp) return;
    const cerrar = () => { top.classList.remove('buscando'); btn.setAttribute('aria-expanded', 'false'); };
    btn.onclick = () => {
      const on = top.classList.toggle('buscando');
      btn.setAttribute('aria-expanded', String(on));
      if (on) setTimeout(() => inp.focus(), 30);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') setTimeout(cerrar, 60); });
    inp.addEventListener('blur', () => setTimeout(() => { if (movil() && document.activeElement !== inp) cerrar(); }, 220));
  }

  // Al abrir una ficha en el teléfono, plegar la hoja de opciones para que no se encimen.
  function fichas() {
    const obs = new MutationObserver(() => {
      if (!movil()) return;
      const abierta = [...document.querySelectorAll('.panel-right')].some((d) => !d.hidden);
      if (abierta) document.querySelectorAll('.panel-left.abierto').forEach((p) => p.querySelector('.sheet-toggle')?.click());
    });
    document.querySelectorAll('.panel-right').forEach((d) => obs.observe(d, { attributes: true, attributeFilter: ['hidden'] }));
  }

  window.SITMAP = { movil, extent };
  document.addEventListener('DOMContentLoaded', () => { hojas(); buscador(); fichas(); });
}());
