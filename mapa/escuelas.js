/* Modo "Escuelas": conectividad estratégica. Datos reales: escuelas de Giga (UNICEF/UIT) y celdas observadas de OpenCelliD.
   La cobertura es la OBSERVADA por teléfonos, no la cobertura oficial de los operadores. */
(function () {
  const fmt = d3.format(',');
  const fmt1 = d3.format(',.1f');
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const sinTilde = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CAT = [
    ['4G', 'Cubierta · 4G', '#22c55e'], ['3G', 'Cubierta · 3G', '#38bdf8'], ['2G', 'Solo 2G', '#c084fc'],
    ['borde', 'Borde de cobertura', '#f59e0b'], ['sin', 'Sin cobertura observada', '#ef4444'],
  ];
  const CATC = Object.fromEntries(CAT.map((c) => [c[0], c]));
  const E = { vista: 'mapa', metrica: 'pct_cubiertas', cats: new Set(CAT.map((c) => c[0])), escuelasOn: true, potOn: false, sitiosOn: false, celdasOn: false, nivel: '', sel: null, orden: ['sin', 'desc'], filtro: '' };
  let D = null, iniciado = false;

  async function cargar() {
    const [geo, bordesGeo, esc, munis, sitios, meta, celdas, mun] = await Promise.all([
      d3.json('data/limites_municipales.json'), d3.json('data/bordes.json'), d3.json('data/escuelas.json'), d3.json('data/escuelas_municipios.json'),
      d3.json('data/escuelas_sitios_candidatos.json'), d3.json('data/escuelas_meta.json'), d3.json('data/celdas_opencellid.json'), d3.json('data/municipios.json'),
    ]);
    geo.features.forEach((f) => {
      if (d3.geoArea(f) > 2 * Math.PI) {
        const g = f.geometry;
        if (g.type === 'Polygon') g.coordinates.forEach((r) => r.reverse());
        if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => p.forEach((r) => r.reverse()));
      }
    });
    const c = esc.campos;
    const escuelas = esc.filas.map((f) => Object.fromEntries(c.map((k, i) => [k, f[i]])));
    const ultimo = [...new Set(mun.map((r) => r.periodo))].filter((p) => mun.some((r) => r.periodo === p && r.radiobases !== null)).sort().pop();
    const sit = new Map(mun.filter((r) => r.periodo === ultimo).map((r) => [r.codigo_ine, r]));
    Object.values(munis).forEach((m) => { const r = sit.get(m.codigo_ine); m.rb_sit = r ? r.radiobases : null; m.rb_10k = r ? r.radiobases_10k_hab : null; });
    D = { geo, bordesGeo, escuelas, munis, lista: Object.values(munis), sitios, meta, celdas, periodoSit: ultimo };
  }

  const METRICAS = {
    pct_cubiertas: { nombre: '% de escuelas con cobertura', fmt: (v) => `${fmt1(v)} %`, umbrales: [20, 40, 60, 80], colores: ['#7f1d1d', '#b45309', '#a16207', '#15803d', '#166534'], extremos: ['Pocas cubiertas', 'Casi todas'] },
    sin: { nombre: 'Escuelas sin cobertura observada', fmt: fmt, umbrales: [10, 30, 60, 120], colores: ['#1f2937', '#5b2333', '#8f2a3a', '#c2394a', '#ef4444'], extremos: ['Pocas', 'Muchas'] },
    pot_nuevo: { nombre: 'Escuelas para un sitio nuevo', fmt: fmt, umbrales: [5, 20, 50, 100], colores: ['#1f2937', '#3b2a5c', '#6b3fa0', '#a35bd6', '#d8a7ff'], extremos: ['Pocas', 'Muchas'] },
  };
  const colorM = (id, v) => (v === null || v === undefined ? 'url(#ehatch)' : d3.scaleThreshold(METRICAS[id].umbrales, METRICAS[id].colores)(v));
  const visibleEscuela = (e) => E.cats.has(e.cat) && (!E.nivel || e.niveles.includes(E.nivel));

  // ---------------- mapa ----------------
  let svg, gZoom, munisSel, zoom, proj, path, W = 0, H = 0, tAct = d3.zoomIdentity, pxKm = 0, cv, cx, base = [], baseSit = [], baseCel = [];
  const cont = () => document.getElementById('emap');

  function construirMapa() {
    const c = cont();
    svg = d3.select(c).append('svg');
    const pat = svg.append('defs').append('pattern').attr('id', 'ehatch').attr('patternUnits', 'userSpaceOnUse').attr('width', 5).attr('height', 5).attr('patternTransform', 'rotate(45)');
    pat.append('rect').attr('width', 5).attr('height', 5).attr('fill', '#1b2537');
    pat.append('line').attr('x2', 0).attr('y2', 5).attr('stroke', '#2f3d5a').attr('stroke-width', 2);
    gZoom = svg.append('g');
    proj = d3.geoMercator(); path = d3.geoPath(proj);
    munisSel = gZoom.append('g').selectAll('path').data(D.geo.features.filter((f) => !f.properties.lake)).join('path').attr('class', 'muni');
    gZoom.append('g').selectAll('path').data(D.geo.features.filter((f) => f.properties.lake)).join('path').attr('class', 'lake');
    gZoom.append('path').attr('class', 'dept-borders').datum({ type: 'FeatureCollection', features: D.bordesGeo.features.filter((f) => f.properties.tipo === 'departamento') });
    gZoom.append('path').attr('class', 'country').datum(D.bordesGeo.features.find((f) => f.properties.tipo === 'pais'));
    cv = d3.select(c).append('canvas').attr('class', 'puntos').node(); cx = cv.getContext('2d');
    zoom = d3.zoom().scaleExtent([1, 60]).on('zoom', (ev) => { tAct = ev.transform; gZoom.attr('transform', ev.transform); pedir(); });
    svg.call(zoom).on('dblclick.zoom', null);

    const tip = document.getElementById('etip');
    munisSel.on('mousemove', (ev, f) => {
      const m = D.munis[f.properties.id]; if (!m) return;
      tip.replaceChildren(el('b', null, m.municipio), el('small', null, m.departamento), el('div', 'v', `${fmt1(m.pct_cubiertas)} %`),
        el('small', null, `de ${fmt(m.total)} escuelas con cobertura observada`), el('div', null, `Sin cobertura observada: ${fmt(m.sin)} · borde: ${fmt(m.borde)}`));
      if (m.sin && m.rb_10k !== null) tip.append(el('div', null, `Radiobases SIT: ${fmt(m.rb_sit)} (${fmt1(m.rb_10k)} por 10 mil hab.)`));
      tip.hidden = false;
      const r = c.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top;
      tip.style.left = `${Math.min(x + 16, W - tip.offsetWidth - 8)}px`; tip.style.top = `${Math.min(y + 16, H - tip.offsetHeight - 8)}px`;
    }).on('mouseleave', () => { tip.hidden = true; });
    svg.on('click', (ev) => {
      const [mx, my] = d3.pointer(ev, c);
      const cerca = (bx, by) => (tAct.x + bx * tAct.k - mx) ** 2 + (tAct.y + by * tAct.k - my) ** 2;
      if (E.sitiosOn) {
        let best = null, dm = 100;
        D.sitios.forEach((s, i) => { const d = cerca(baseSit[i][0], baseSit[i][1]); if (d < dm) { dm = d; best = s; } });
        if (best) { fichaSitio(best); return; }
      }
      if (E.escuelasOn || E.potOn) {
        let best = null, dm = 49;
        D.escuelas.forEach((e, i) => { if (!visibleEscuela(e) || (!E.escuelasOn && !e.pot)) return; const d = cerca(base[i][0], base[i][1]); if (d < dm) { dm = d; best = e; } });
        if (best) { fichaEscuela(best); return; }
      }
      const f = ev.target.__data__;
      if (f && f.properties && D.munis[f.properties.id]) fichaMuni(f.properties.id);
    });
    window.addEventListener('resize', () => { if (visible() && E.vista === 'mapa') encuadre(); });
  }

  function encuadre() {
    const c = cont(); if (!c.clientWidth) return;
    W = c.clientWidth; H = c.clientHeight;
    svg.attr('viewBox', `0 0 ${W} ${H}`);
    proj.fitExtent(window.SITMAP.extent(W, H, { izq: 370, der: 30, arr: 70, aba: 40 }), { type: 'FeatureCollection', features: D.geo.features.filter((f) => !f.properties.lake) });
    gZoom.selectAll('path').attr('d', path);
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    base = D.escuelas.map((e) => proj([e.lon, e.lat]));
    baseSit = D.sitios.map((s) => proj([s.lon, s.lat]));
    baseCel = D.celdas.map((x) => proj([x[0], x[1]]));
    pxKm = Math.abs(proj([-90.5, 15])[1] - proj([-90.5, 15.009])[1]);
    pintar(); pedir();
  }

  let pend = false;
  function pedir() { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; dibujar(); }); }
  function dibujar() {
    const dpr = window.devicePixelRatio || 1;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, W, H);
    const t = tAct, k = t.k, dep = document.getElementById('depto').value;
    const fuera = (x, y, m = 6) => x < -m || y < -m || x > W + m || y > H + m;
    if (E.celdasOn) {
      cx.fillStyle = '#94a3b8'; cx.globalAlpha = 0.35;
      for (let i = 0; i < baseCel.length; i++) { const x = t.x + baseCel[i][0] * k, y = t.y + baseCel[i][1] * k; if (fuera(x, y)) continue; cx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6); }
    }
    const r = window.SITMAP.movil() ? Math.min(3.6, 0.7 + k * 0.28) : Math.min(4.2, 1.1 + k * 0.22);
    if (E.escuelasOn) {
      for (let i = 0; i < D.escuelas.length; i++) {
        const e = D.escuelas[i]; if (!visibleEscuela(e)) continue;
        const x = t.x + base[i][0] * k, y = t.y + base[i][1] * k; if (fuera(x, y)) continue;
        cx.globalAlpha = dep && e.cod.slice(0, 4) !== dep ? 0.12 : 0.9;
        cx.fillStyle = CATC[e.cat][2];
        cx.beginPath(); cx.arc(x, y, r, 0, 6.2832); cx.fill();
      }
    }
    if (E.potOn) {
      cx.lineWidth = 1.4;
      for (let i = 0; i < D.escuelas.length; i++) {
        const e = D.escuelas[i]; if (!e.pot || !visibleEscuela(e)) continue;
        const x = t.x + base[i][0] * k, y = t.y + base[i][1] * k; if (fuera(x, y)) continue;
        cx.globalAlpha = dep && e.cod.slice(0, 4) !== dep ? 0.12 : 0.95;
        cx.strokeStyle = e.pot === 'extension' ? '#22d3ee' : '#e879f9';
        cx.beginPath(); cx.arc(x, y, r + 2.2, 0, 6.2832); cx.stroke();
      }
    }
    if (E.sitiosOn) {
      D.sitios.forEach((s, i) => {
        const x = t.x + baseSit[i][0] * k, y = t.y + baseSit[i][1] * k;
        const rr = 3 * pxKm * k; // radio de 3 km
        if (fuera(x, y, rr + 10)) return;
        cx.globalAlpha = dep && s.cod.slice(0, 4) !== dep ? 0.15 : 1;
        if (k >= 3) { cx.globalAlpha *= 0.5; cx.strokeStyle = '#e879f9'; cx.setLineDash([4, 3]); cx.lineWidth = 1.2; cx.beginPath(); cx.arc(x, y, rr, 0, 6.2832); cx.stroke(); cx.setLineDash([]); cx.globalAlpha = dep && s.cod.slice(0, 4) !== dep ? 0.15 : 1; }
        const sz = Math.min(9, 3 + Math.sqrt(s.escuelas) * 0.8) * Math.min(1.6, 0.8 + k * 0.08);
        cx.fillStyle = '#e879f9'; cx.strokeStyle = '#1a0b24'; cx.lineWidth = 1.2;
        cx.beginPath(); cx.moveTo(x, y - sz); cx.lineTo(x + sz, y); cx.lineTo(x, y + sz); cx.lineTo(x - sz, y); cx.closePath(); cx.fill(); cx.stroke();
        if (E.sel && E.sel.tipo === 'sitio' && E.sel.id === s.id) { cx.strokeStyle = '#f2b84b'; cx.lineWidth = 2.5; cx.beginPath(); cx.arc(x, y, sz + 5, 0, 6.2832); cx.stroke(); }
      });
    }
    if (E.sel && E.sel.tipo === 'escuela') {
      const i = D.escuelas.indexOf(E.sel.obj);
      if (i >= 0) { const x = t.x + base[i][0] * k, y = t.y + base[i][1] * k; cx.globalAlpha = 1; cx.strokeStyle = '#f2b84b'; cx.lineWidth = 2.5; cx.beginPath(); cx.arc(x, y, r + 5, 0, 6.2832); cx.stroke(); }
    }
    cx.globalAlpha = 1;
  }

  function pintar() {
    const dep = document.getElementById('depto').value; const m = METRICAS[E.metrica];
    munisSel.attr('fill', (f) => { const x = D.munis[f.properties.id]; return colorM(E.metrica, x ? x[E.metrica] : null); })
      .classed('dim', (f) => dep && f.properties.id.slice(0, 4) !== dep)
      .classed('sel', (f) => E.sel && E.sel.tipo === 'muni' && E.sel.id === f.properties.id);
    document.querySelectorAll('#emetrics [data-m]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.m === E.metrica)));
    const lg = document.getElementById('elegend'); lg.replaceChildren(el('span', 'label', m.nombre));
    const rp = el('div', 'ramp'); m.colores.forEach((c) => { const s = el('span'); s.style.background = c; rp.append(s); });
    const sc = el('div', 'scale'); sc.append(...['', ...m.umbrales.map((u) => (E.metrica === 'pct_cubiertas' ? `${u} %` : fmt(u))), ''].map((v) => el('span', null, v)));
    const ex = el('div', 'ends'); m.extremos.forEach((x) => ex.append(el('span', null, x)));
    lg.append(rp, sc, ex);
    kpisMapa(); pedir();
  }

  function contar(filtroDep) {
    const L = D.escuelas.filter((e) => (!filtroDep || e.cod.slice(0, 4) === filtroDep) && (!E.nivel || e.niveles.includes(E.nivel)));
    const c = d3.rollup(L, (v) => v.length, (e) => e.cat);
    return { L, n: L.length, c: (k) => c.get(k) || 0, ext: L.filter((e) => e.pot === 'extension').length, nuevo: L.filter((e) => e.pot === 'nuevo').length };
  }
  function kpisMapa() {
    const dep = document.getElementById('depto').value; const s = contar(dep);
    const cub = s.c('4G') + s.c('3G') + s.c('2G');
    const items = [[fmt(s.n), 'escuelas'], [`${fmt1(cub / Math.max(1, s.n) * 100)} %`, 'con cobertura observada'], [fmt(s.c('sin')), 'sin cobertura observada'], [fmt(s.ext + s.nuevo), 'con potencial de conexión']];
    document.getElementById('ekpis').replaceChildren(...items.map(([v, t]) => { const k = el('div', 'kpi'); k.append(el('b', null, v), el('span', null, t)); return k; }));
  }

  function controles() {
    const mc = document.getElementById('emetrics');
    Object.entries(METRICAS).forEach(([id, m]) => {
      const b = el('button', 'metric'); b.type = 'button'; b.dataset.m = id; b.setAttribute('role', 'radio');
      const sw = el('span', 'sw'); sw.style.background = `linear-gradient(90deg, ${m.colores.join(',')})`;
      b.append(sw, el('span', 't', m.nombre)); b.onclick = () => { E.metrica = id; pintar(); }; mc.append(b);
    });
    const tot = D.meta.por_categoria;
    const lc = document.getElementById('ecats');
    CAT.forEach(([id, nom, col]) => {
      const l = el('label', 'cat chk'); const i = el('input'); i.type = 'checkbox'; i.checked = true; i.id = `ecat-${id}`;
      i.onchange = () => { if (i.checked) E.cats.add(id); else E.cats.delete(id); pedir(); if (E.vista === 'tablero') tablero(); };
      const sw = el('i'); sw.style.background = col;
      l.append(i, sw, document.createTextNode(nom), el('b', null, fmt(tot[id] || 0))); lc.append(l);
    });
    const chk = (id, key, opts) => { const c = document.getElementById(id); c.checked = E[key]; c.onchange = () => { E[key] = c.checked; if (opts) document.getElementById(opts).hidden = !c.checked; pedir(); }; if (opts) document.getElementById(opts).hidden = !c.checked; };
    chk('ecapa-escuelas', 'escuelasOn', 'ecats');
    chk('ecapa-pot', 'potOn', 'epot-ley');
    chk('ecapa-sitios', 'sitiosOn', 'esitios-ley');
    chk('ecapa-celdas', 'celdasOn');
    document.getElementById('epot-ley').replaceChildren(
      (() => { const d = el('div', 'cat'); const i = el('i'); i.style.border = '2px solid #22d3ee'; i.style.borderRadius = '50%'; d.append(i, document.createTextNode(`Extensión: celda observada a 5 km o menos`), el('b', null, fmt(D.meta.potencial_extension))); return d; })(),
      (() => { const d = el('div', 'cat'); const i = el('i'); i.style.border = '2px solid #e879f9'; i.style.borderRadius = '50%'; d.append(i, document.createTextNode('Sitio nuevo: lejos de toda celda observada'), el('b', null, fmt(D.meta.potencial_nuevo_sitio))); return d; })());
    document.getElementById('esitios-ley').textContent = `${fmt(D.sitios.length)} puntos donde una radiobase nueva alcanzaría 5 o más escuelas sin cobertura en un radio de 3 km. Rombo más grande = más escuelas.`;
    const sn = document.getElementById('enivel');
    sn.onchange = () => { E.nivel = sn.value; pintar(); if (E.vista === 'tablero') tablero(); };
    document.getElementById('depto').addEventListener('change', () => { if (!visible()) return; if (E.vista === 'mapa') { zoomDep(); pintar(); } else tablero(); });
    document.querySelectorAll('#et-tabla th[data-sort]').forEach((th) => {
      th.tabIndex = 0;
      const o = () => { const k = th.dataset.sort; E.orden = [k, E.orden[0] === k && E.orden[1] === 'desc' ? 'asc' : 'desc']; tablaMunis(); };
      th.onclick = o; th.onkeydown = (e) => { if (e.key === 'Enter') o(); };
    });
    document.getElementById('et-filtro').oninput = (e) => { E.filtro = sinTilde(e.target.value).trim(); tablaMunis(); };
    document.getElementById('eclose').onclick = () => { E.sel = null; document.getElementById('edetail').hidden = true; pintar(); };
  }
  function zoomDep() {
    const dep = document.getElementById('depto').value;
    if (!dep) { svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity); return; }
    zoomA({ type: 'FeatureCollection', features: D.geo.features.filter((f) => !f.properties.lake && f.properties.id.slice(0, 4) === dep) });
  }
  function zoomA(feature, maxK = 30) {
    const [[x0, y0], [x1, y1]] = path.bounds(feature);
    const k = Math.min(maxK, 0.75 / Math.max((x1 - x0) / W || 0.001, (y1 - y0) / H || 0.001));
    svg.transition().duration(reducido() ? 0 : 750).call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
  }

  // ---------------- fichas ----------------
  const facts = (pares) => pares.map(([t, v]) => { const d = el('div'); d.append(el('dt', null, t), el('dd', null, v)); return d; });
  const abrir = () => { document.getElementById('edetail').hidden = false; };
  function fichaEscuela(e) {
    E.sel = { tipo: 'escuela', obj: e };
    const m = D.munis[e.cod] || {};
    document.getElementById('ed-sub').textContent = `${m.municipio || ''}, ${m.departamento || ''}`;
    document.getElementById('ed-nombre').textContent = e.nombre;
    const cat = CATC[e.cat];
    const pill = el('span', 'pill', cat[1]); pill.style.color = cat[2];
    document.getElementById('ed-estado').replaceChildren(pill);
    document.getElementById('ed-facts').replaceChildren(...facts([
      ['Niveles', e.niveles.replaceAll('/', ', ')],
      ['Celda observada más cercana', e.dist_m === null ? 'ninguna cerca' : e.dist_m >= 1000 ? `${fmt1(e.dist_m / 1000)} km` : `${fmt(e.dist_m)} m`],
      ['Potencial', e.pot === 'extension' ? 'Extensión de red cercana' : e.pot === 'nuevo' ? `Sitio nuevo (${e.sitio})` : 'no aplica'],
      ['Coordenadas', `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}`],
    ]));
    const ex = document.getElementById('ed-extra'); ex.replaceChildren();
    if (e.sitio) { const b = el('button', 'link-btn', `Ver sitio candidato ${e.sitio} →`); b.type = 'button'; b.onclick = () => { const s = D.sitios.find((x) => x.id === e.sitio); if (s) fichaSitio(s, true); }; ex.append(b); }
    const b2 = el('button', 'link-btn', `Ver resumen de ${m.municipio} →`); b2.type = 'button'; b2.onclick = () => fichaMuni(e.cod); ex.append(b2);
    abrir(); pedir();
  }
  function fichaSitio(s, acercar) {
    E.sel = { tipo: 'sitio', id: s.id };
    document.getElementById('ed-sub').textContent = `${s.municipio}, ${s.departamento}`;
    document.getElementById('ed-nombre').textContent = `Sitio candidato ${s.id}`;
    document.getElementById('ed-estado').replaceChildren(el('span', 'pill', 'Propuesta para análisis'));
    document.getElementById('ed-facts').replaceChildren(...facts([
      ['Escuelas sin cobertura a 3 km', fmt(s.escuelas)],
      ['Celda observada más cercana', `${fmt1(s.dist_celda_km)} km`],
      ['Coordenadas', `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`],
    ]));
    const ex = document.getElementById('ed-extra');
    ex.replaceChildren(el('p', 'fine', 'Punto calculado para alcanzar el mayor número de escuelas sin cobertura observada. Antes de decidir hay que verificar la cobertura en campo y con los operadores.'));
    abrir();
    if (acercar && E.vista === 'mapa') { const i = D.sitios.indexOf(s); const [x, y] = baseSit[i]; svg.transition().duration(reducido() ? 0 : 750).call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(12).translate(-x, -y)); }
    pedir();
  }
  function fichaMuni(cod) {
    const m = D.munis[cod]; if (!m) return;
    E.sel = { tipo: 'muni', id: cod };
    document.getElementById('ed-sub').textContent = m.departamento;
    document.getElementById('ed-nombre').textContent = m.municipio;
    const pill = el('span', 'pill', `${fmt1(m.pct_cubiertas)} % de escuelas con cobertura`); pill.style.color = colorM('pct_cubiertas', m.pct_cubiertas);
    document.getElementById('ed-estado').replaceChildren(pill);
    document.getElementById('ed-facts').replaceChildren(...facts([
      ['Escuelas', fmt(m.total)], ['Cubiertas 4G / 3G', `${fmt(m['4G'])} / ${fmt(m['3G'])}`], ['Solo 2G', fmt(m['2G'])], ['Borde', fmt(m.borde)],
      ['Sin cobertura observada', fmt(m.sin)], ['Potencial extensión', fmt(m.pot_extension)], ['Potencial sitio nuevo', fmt(m.pot_nuevo)],
      [`Radiobases SIT (${D.periodoSit})`, m.rb_sit === null ? 'sin dato' : `${fmt(m.rb_sit)} · ${fmt1(m.rb_10k)} por 10 mil hab.`],
    ]));
    const ex = document.getElementById('ed-extra'); ex.replaceChildren();
    const bars = el('div', 'bars');
    CAT.forEach(([id, nom, col]) => { const d = el('div', 'bar'); const tr = el('span', 'track'); const f = el('span', 'fill'); f.style.display = 'block'; f.style.width = `${m[id] / m.total * 100}%`; f.style.background = col; tr.append(f); d.append(el('span', null, nom), tr, el('b', null, fmt(m[id]))); bars.append(d); });
    ex.append(bars);
    if (m.sin && m.rb_10k !== null && m.rb_10k >= 10) ex.append(el('p', 'fine', `La SIT reporta ${fmt(m.rb_sit)} radiobases aquí: parte de las escuelas "sin cobertura observada" puede tener señal que nadie ha medido.`));
    abrir(); pintar(); if (E.vista === 'tablero') tablaMunis();
  }

  // ---------------- tablero ----------------
  function barrasH(c, items, opts = {}) {
    c.replaceChildren();
    const w = Math.max(300, c.clientWidth), fila = 22, mg = { l: opts.ml || 130, r: 60, t: 4 };
    const h = mg.t + items.length * fila;
    const x = d3.scaleLinear([0, opts.max || d3.max(items, (d) => d.v) || 1], [mg.l, w - mg.r]);
    const s = d3.select(c).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', opts.aria || '');
    const g = s.selectAll('g').data(items).join('g').attr('transform', (d, i) => `translate(0,${mg.t + i * fila})`);
    g.append('text').attr('x', mg.l - 8).attr('y', 15).attr('text-anchor', 'end').text((d) => d.n);
    g.append('rect').attr('x', mg.l).attr('y', 5).attr('height', 13).attr('rx', 3).attr('width', (d) => Math.max(1, x(d.v) - mg.l)).attr('fill', (d) => d.c);
    g.append('text').attr('class', 'num-l').attr('x', (d) => x(d.v) + 6).attr('y', 16).text((d) => (opts.fmt || fmt)(d.v));
  }
  function tablero() {
    const dep = document.getElementById('depto').value; const s = contar(dep);
    const cub = s.c('4G') + s.c('3G') + s.c('2G');
    const ambito = dep ? (D.lista.find((m) => m.codigo_ine.slice(0, 4) === dep) || {}).departamento : 'el país';
    const sitios = dep ? D.sitios.filter((x) => x.cod.slice(0, 4) === dep) : D.sitios;
    document.getElementById('et-lead').replaceChildren(document.createTextNode(`En ${ambito}, `), el('b', null, `${fmt1(cub / Math.max(1, s.n) * 100)} %`),
      document.createTextNode(` de ${fmt(s.n)} escuelas${E.nivel ? ` de ${E.nivel.toLowerCase()}` : ''} está dentro del alcance de una celda observada; solo `), el('b', null, fmt(s.c('4G'))),
      document.createTextNode(' tiene 4G observado. '), el('b', null, fmt(s.c('sin'))), document.createTextNode(' no tiene ninguna celda observada cerca, y '),
      el('b', null, fmt(sitios.length)), document.createTextNode(' sitios nuevos alcanzarían a '), el('b', null, fmt(d3.sum(sitios, (x) => x.escuelas))), document.createTextNode(' escuelas sin cobertura o en el borde que hoy están a más de 5 km de toda celda observada.'));
    const k = [
      [fmt(s.n), 'escuelas (Giga)'], [fmt(cub), `con cobertura observada (${fmt1(cub / Math.max(1, s.n) * 100)} %)`], [fmt(s.c('4G')), 'con 4G observado'],
      [fmt(s.c('2G')), 'solo con 2G (sin datos móviles útiles)'], [fmt(s.c('borde')), 'en el borde del alcance'], [fmt(s.c('sin')), 'sin cobertura observada'],
      [fmt(s.ext), 'con potencial de extensión (celda a 5 km o menos)'], [fmt(sitios.length), 'sitios candidatos para escuelas lejanas'],
    ];
    document.getElementById('et-kpis').replaceChildren(...k.map(([v, t]) => { const d = el('div', 't-kpi'); d.append(el('b', null, v), el('span', null, t)); return d; }));
    barrasH(document.getElementById('et-cat'), CAT.map(([id, nom, col]) => ({ n: nom, v: s.c(id), c: col })), { ml: 170, aria: 'Escuelas por categoría de cobertura' });
    const porDep = d3.rollups(s.L, (v) => { const c = v.filter((e) => ['4G', '3G', '2G'].includes(e.cat)).length; return c / v.length * 100; }, (e) => (D.munis[e.cod] || {}).departamento || '—')
      .map(([n, v]) => ({ n, v, c: colorM('pct_cubiertas', v) })).sort((a, b) => a.v - b.v);
    barrasH(document.getElementById('et-dep'), porDep, { ml: 130, max: 100, fmt: (v) => `${fmt1(v)} %`, aria: 'Porcentaje de escuelas con cobertura por departamento' });
    const ts = document.querySelector('#et-sitios tbody');
    ts.replaceChildren(...sitios.slice().sort((a, b) => b.escuelas - a.escuelas).slice(0, 15).map((x) => {
      const tr = el('tr'); tr.tabIndex = 0;
      tr.append(el('td', null, x.id), el('td', null, `${x.municipio}, ${x.departamento}`), el('td', 'num', fmt(x.escuelas)), el('td', 'num', `${fmt1(x.dist_celda_km)} km`));
      tr.onclick = () => fichaSitio(x); return tr;
    }));
    tablaMunis();
  }
  function tablaMunis() {
    const dep = document.getElementById('depto').value;
    let f = D.lista.slice();
    if (dep) f = f.filter((m) => m.codigo_ine.slice(0, 4) === dep);
    if (E.filtro) f = f.filter((m) => sinTilde(m.municipio).includes(E.filtro) || sinTilde(m.departamento).includes(E.filtro));
    const [k, dir] = E.orden;
    f.sort((a, b) => (dir === 'asc' ? d3.ascending : d3.descending)(k === 'municipio' ? a.municipio : a[k], k === 'municipio' ? b.municipio : b[k]));
    document.querySelectorAll('#et-tabla th[data-sort]').forEach((th) => th.setAttribute('aria-sort', th.dataset.sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'));
    document.querySelector('#et-tabla tbody').replaceChildren(...f.slice(0, E.filtro ? 400 : 60).map((m) => {
      const tr = el('tr'); tr.tabIndex = 0; if (E.sel && E.sel.tipo === 'muni' && E.sel.id === m.codigo_ine) tr.className = 'sel';
      const mu = el('td'); mu.append(document.createTextNode(m.municipio), el('small', null, m.departamento));
      const pc = el('td', 'num'); const w = el('span', 'idm'); const sw = el('i'); sw.style.background = colorM('pct_cubiertas', m.pct_cubiertas); w.append(sw, document.createTextNode(`${fmt1(m.pct_cubiertas)} %`)); pc.append(w);
      tr.append(mu, el('td', 'num', fmt(m.total)), pc, el('td', 'num', fmt(m['4G'])), el('td', 'num', fmt(m['3G'])), el('td', 'num', fmt(m['2G'])), el('td', 'num', fmt(m.borde)), el('td', 'num', fmt(m.sin)),
        el('td', 'num', fmt(m.pot_extension)), el('td', 'num', fmt(m.pot_nuevo)));
      tr.onclick = () => fichaMuni(m.codigo_ine); tr.onkeydown = (e) => { if (e.key === 'Enter') fichaMuni(m.codigo_ine); };
      return tr;
    }));
  }

  // ---------------- API ----------------
  const visible = () => !document.getElementById('vista-emapa').hidden || !document.getElementById('vista-etablero').hidden;
  async function mostrar(v) {
    E.vista = v;
    if (!iniciado) {
      if (!window.__escuelasInit) {
        window.__escuelasInit = (async () => {
          const ld = document.getElementById('loading'); ld.hidden = false; ld.textContent = 'Cargando escuelas…';
          await cargar(); construirMapa(); controles(); iniciado = true; ld.hidden = true;
        })();
      }
      await window.__escuelasInit;
      if (E.vista !== v) return; // otra llamada más reciente ya eligió la vista
    }
    document.getElementById('vista-emapa').hidden = v !== 'mapa';
    document.getElementById('vista-etablero').hidden = v !== 'tablero';
    document.getElementById('edetail').hidden = !E.sel;
    if (v === 'mapa') encuadre(); else tablero();
  }
  function ocultar() { ['vista-emapa', 'vista-etablero', 'edetail'].forEach((id) => { document.getElementById(id).hidden = true; }); }
  window.Escuelas = {
    mostrar: (v) => mostrar(v).catch((e) => { const l = document.getElementById('loading'); l.hidden = false; l.textContent = `No se pudieron cargar las escuelas (${e.message}).`; console.error(e); }),
    ocultar,
  };
}());
