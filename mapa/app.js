/* Mapa y tablero telecom de Guatemala: municipios por semestre (Boletines SIT) + celdas observadas (OpenCelliD). */
(async function () {
  const fmt = d3.format(',');
  const fmt1 = d3.format(',.1f');
  const perLargo = (p) => { const m = /^(\d{4})S([12])$/.exec(p || ''); return m ? `${m[2] === '1' ? '1.er' : '2.º'} semestre ${m[1]}` : p; };
  const perCorto = (p) => { const m = /^(\d{4})S([12])$/.exec(p || ''); return m ? `${m[1].slice(2)}·${m[2] === '1' ? 'I' : 'II'}` : p; };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // =====================================================================
  // DATOS
  // =====================================================================
  const [municipios, operadores, geo, calidad, bordesGeo, lugares, lugaresMuni, celdas, celdasMuni, celdasMeta] = await Promise.all([
    d3.json('data/municipios.json'), d3.json('data/operadores_fijos.json'),
    d3.json('data/limites_municipales.json'), d3.json('data/calidad.json'),
    d3.json('data/bordes.json'), d3.json('data/lugares_poblados.json'), d3.json('data/lugares_por_municipio.json'),
    d3.json('data/celdas_opencellid.json'), d3.json('data/celdas_por_municipio.json'), d3.json('data/celdas_meta.json'),
  ]);
  // Los polígonos vienen en orientación GeoJSON; d3 espera la contraria.
  geo.features.forEach((f) => {
    if (d3.geoArea(f) > 2 * Math.PI) {
      const g = f.geometry;
      if (g.type === 'Polygon') g.coordinates.forEach((r) => r.reverse());
      if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => p.forEach((r) => r.reverse()));
    }
  });
  const periodos = [...new Set(municipios.map((r) => r.periodo))].sort();
  const porPeriodo = d3.group(municipios, (r) => r.periodo);
  const porMuni = d3.group(municipios, (r) => r.codigo_ine);
  const opsIdx = d3.group(operadores, (r) => r.periodo, (r) => r.codigo_ine);
  const info = new Map(municipios.map((r) => [r.codigo_ine, { municipio: r.municipio, departamento: r.departamento }]));
  const saltos = new Map(calidad.filter((c) => c.tipo === 'Salto en la serie').map((c) => [c.periodo, c.nota]));
  const tieneRb = (p) => porPeriodo.get(p).some((r) => r.radiobases !== null);
  const tieneFx = (p) => porPeriodo.get(p).some((r) => r.lineas_fijas_total !== null);
  const MNC = celdasMeta.mnc; // {"01": "Claro", ...}

  // IDM · Índice de desarrollo por municipio = 100 − promedio de posiciones relativas (0 mejor del país, 100 peor)
  const posicion = (valores, v, peorEsBajo) => {
    if (v === null || valores.length < 2) return null;
    let mejor = 0, igual = 0;
    for (const x of valores) { if (x === v) igual++; else if (peorEsBajo ? x > v : x < v) mejor++; }
    return ((mejor + (igual - 1) / 2) / (valores.length - 1)) * 100;
  };
  const IDM = new Map(); // `${periodo}|${codigo}` -> {idm, rank (1 = menor IDM), n, comps}
  for (const p of periodos) {
    if (!tieneRb(p) || !tieneFx(p)) continue;
    const filas = porPeriodo.get(p);
    const conFijo = (r) => r.lineas_fijas_total > 0;
    const ant = filas.map((r) => r.radiobases_10k_hab).filter((v) => v !== null);
    const red = filas.filter(conFijo).map((r) => r.lineas_fijas_100_hab);
    const hhi = filas.filter(conFijo).map((r) => r.hhi_fijo);
    const res = filas.map((r) => {
      const c = [posicion(ant, r.radiobases_10k_hab, true), conFijo(r) ? posicion(red, r.lineas_fijas_100_hab, true) : null, conFijo(r) ? posicion(hhi, r.hhi_fijo, false) : null].filter((x) => x !== null);
      return { codigo: r.codigo_ine, idm: c.length ? 100 - d3.mean(c) : null, comps: c.length };
    }).sort((a, b) => d3.ascending(a.idm ?? 999, b.idm ?? 999));
    res.forEach((r, i) => IDM.set(`${p}|${r.codigo}`, { ...r, rank: i + 1, n: res.length }));
  }
  const idmDe = (cod, p = estado.periodo) => IDM.get(`${p}|${cod}`) || null;

  // =====================================================================
  // INDICADORES DEL MAPA
  // =====================================================================
  const OPCOL = { 'Telgua (Claro)': '#e5484d', 'Comcel (Tigo)': '#3b82f6', 'Telefónica (Movistar)': '#22c3a6', 'Teléfonos del Norte': '#a78bfa', 'A-Tel': '#f59e0b', 'Liberty (Columbus)': '#ec4899', Cablenet: '#84cc16', Guatel: '#94a3b8', 'Claro Guatemala': '#f97316' };
  const todos = (campo, filtro = (v) => v !== null) => municipios.map((r) => r[campo]).filter(filtro).sort(d3.ascending);
  const cuantiles = (vals, k) => d3.range(1, k).map((i) => d3.quantileSorted(vals, i / k));
  const METRICAS = [
    { id: 'idm', nombre: 'IDM · Índice de desarrollo', desc: 'Índice de desarrollo por municipio, de 0 a 100. Combina antenas por habitante, red fija por habitante y competencia en telefonía fija. Más bajo = menos desarrollo = auditar primero.',
      valor: (r, p) => IDM.get(`${p}|${r.codigo_ine}`)?.idm ?? null, umbrales: [20, 35, 50, 65],
      colores: ['#e2434f', '#ec8a45', '#d9c27a', '#3f8f8a', '#1c6f8a'], extremos: ['Menor desarrollo', 'Mayor desarrollo'], fmt: fmt1, unidad: 'IDM', disponible: (p) => tieneRb(p) && tieneFx(p) },
    { id: 'antenas', nombre: 'Antenas por 10 mil hab.', desc: 'Radiobases de telefonía móvil por cada 10 mil habitantes (SIT). Más alto = más infraestructura móvil.',
      valor: (r) => r.radiobases_10k_hab, umbrales: cuantiles(todos('radiobases_10k_hab'), 5),
      colores: ['#3a1d3f', '#6b2a5c', '#a8446b', '#e07a6a', '#f9c88a'], extremos: ['Pocas antenas', 'Muchas antenas'], fmt: fmt1, unidad: 'por 10 mil hab.', disponible: tieneRb },
    { id: 'lineas', nombre: 'Líneas fijas por 100 hab.', desc: 'Líneas de telefonía fija en operación por cada 100 habitantes: aproxima la red fija (e internet fijo) disponible.',
      valor: (r) => (r.lineas_fijas_total > 0 ? r.lineas_fijas_100_hab : null), umbrales: cuantiles(todos('lineas_fijas_100_hab', (v) => v > 0), 5),
      colores: ['#14313a', '#1c5a5e', '#2b8c80', '#5cc39a', '#c3f0c8'], extremos: ['Poca red fija', 'Mucha red fija'], fmt: fmt1, unidad: 'por 100 hab.', disponible: tieneFx },
    { id: 'operadores', nombre: 'Operadores de telefonía fija', desc: 'Cuántas empresas tienen líneas fijas en el municipio. Con una sola, el usuario no tiene alternativa si el servicio falla.',
      valor: (r) => (r.lineas_fijas_total > 0 ? Math.min(r.operadores_fijos, 3) : null), categorias: [[1, 'Un operador', '#e2434f'], [2, 'Dos operadores', '#ecb54a'], [3, 'Tres o más', '#4fb0cf']], fmt: (v) => (v >= 3 ? '3 o más' : String(v)), unidad: 'operadores', disponible: tieneFx },
    { id: 'principal', nombre: 'Operador fijo principal', desc: 'La empresa con más líneas fijas en el municipio.',
      valor: (r) => (r.lineas_fijas_total > 0 ? r.operador_fijo_principal : null), categorias: null, fmt: (v) => v, unidad: '', disponible: tieneFx },
  ];
  const opsPresentes = [...new Set(municipios.map((r) => r.operador_fijo_principal).filter(Boolean))];
  METRICAS[4].categorias = opsPresentes.sort((a, b) => d3.descending(municipios.filter((r) => r.operador_fijo_principal === a).length, municipios.filter((r) => r.operador_fijo_principal === b).length)).map((o) => [o, o, OPCOL[o] || '#94a3b8']);
  const colorDe = (m, v) => {
    if (v === null || v === undefined) return 'url(#hatch)';
    if (m.categorias) return (m.categorias.find((c) => c[0] === v) || [0, 0, '#94a3b8'])[2];
    return d3.scaleThreshold(m.umbrales, m.colores)(v);
  };
  const colorIdm = (v) => (v === null || v === undefined ? '#3a4660' : d3.scaleThreshold(METRICAS[0].umbrales, METRICAS[0].colores)(v));

  // =====================================================================
  // ESTADO
  // =====================================================================
  const ultimoCompleto = periodos.filter((p) => tieneRb(p) && tieneFx(p)).pop();
  const estado = { modo: 'actual', periodo: ultimoCompleto, metrica: METRICAS[0], sel: null, depto: '', vista: 'mapa', celdasModo: 'tec', orden: ['rank', 'asc'], filtro: '', todos: false };
  try { const h = location.hash.slice(1); if (periodos.includes(h)) estado.periodo = h; } catch (e) { /* sin hash */ }
  try { const v = localStorage.getItem('sit-vista'); if (v === 'mapa' || v === 'tablero') estado.vista = v; } catch (e) { /* sin almacenamiento */ }
  try { const v = localStorage.getItem('sit-modo'); if (v === 'actual' || v === 'proximo' || v === 'escuelas') estado.modo = v; } catch (e) { /* sin almacenamiento */ }

  // =====================================================================
  // MAPA
  // =====================================================================
  const cont = document.getElementById('map');
  const svg = d3.select(cont).append('svg');
  const defs = svg.append('defs');
  const pat = defs.append('pattern').attr('id', 'hatch').attr('patternUnits', 'userSpaceOnUse').attr('width', 5).attr('height', 5).attr('patternTransform', 'rotate(45)');
  pat.append('rect').attr('width', 5).attr('height', 5).attr('fill', '#1b2537');
  pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5).attr('stroke', '#2f3d5a').attr('stroke-width', 2);
  const gZoom = svg.append('g');
  const gMun = gZoom.append('g');
  const gBorders = gZoom.append('g');
  const gLabels = gZoom.append('g');

  const tierra = geo.features.filter((f) => !f.properties.lake);
  const lagos = geo.features.filter((f) => f.properties.lake);
  const bordesDep = { type: 'FeatureCollection', features: bordesGeo.features.filter((f) => f.properties.tipo === 'departamento') };
  const pais = bordesGeo.features.find((f) => f.properties.tipo === 'pais');
  const deptos = d3.groups(tierra, (f) => f.properties.id.slice(0, 4)).map(([cod, fs]) => ({
    cod, nombre: info.get(fs[0].properties.id)?.departamento ?? cod, feature: { type: 'FeatureCollection', features: fs },
  }));

  const proj = d3.geoMercator();
  const path = d3.geoPath(proj);
  const munis = gMun.selectAll('path.muni').data(tierra, (f) => f.properties.id).join('path').attr('class', 'muni');
  const lagosSel = gMun.selectAll('path.lake').data(lagos).join('path').attr('class', 'lake');
  const bordes = gBorders.append('path').attr('class', 'dept-borders').datum(bordesDep);
  const contorno = gBorders.append('path').attr('class', 'country').datum(pais);
  const etiquetas = gLabels.selectAll('text').data(deptos).join('text').attr('class', 'dept-label').attr('text-anchor', 'middle').text((d) => d.nombre);

  // ---- capas de puntos en canvas (no capturan el mouse) ----
  const LUG = {
    CIUDAD: [3.2, '#fff4d6', 1, 'Ciudad, villa o pueblo'], VILLA: [2.6, '#ffe2a3', 1], PUEBLO: [2.6, '#ffe2a3', 1],
    ALDEA: [1.8, '#f2b84b', 0.9, 'Aldea'], COLONIA: [1.4, '#9ad1ff', 0.75, 'Colonia'], CASERIO: [1.2, '#d98a3a', 0.6, 'Caserío'],
  };
  const LUG_OTRO = [1, '#8fa3bf', 0.45, 'Finca, paraje y otros'];
  const CEL_TEC = { '2G': ['#c084fc', '2G (GSM)'], '3G': ['#38bdf8', '3G (UMTS)'], '4G': ['#4ade80', '4G (LTE)'], '5G': ['#facc15', '5G (NR)'] };
  const CEL_OP = { '01': ['#f43f5e', `${MNC['01']} (red 01)`], '02': ['#60a5fa', `${MNC['02']} (red 02)`], '03': ['#2dd4bf', `${MNC['03']} (red 03)`] };
  const celColor = (c) => (estado.celdasModo === 'tec' ? (CEL_TEC[c[2]] || ['#cbd5e1'])[0] : (CEL_OP[c[3]] || ['#cbd5e1'])[0]);
  const canvas = d3.select(cont).append('canvas').attr('class', 'puntos').node();
  const ctx = canvas.getContext('2d');
  let baseLug = [], baseCel = [], pxPorMetro = 0, tActual = d3.zoomIdentity;
  const capas = { lugares: false, celdas: false };
  let W = 0, H = 0;

  function dibujarPuntos() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t = tActual, k = t.k, dep = estado.depto;
    const visible = (x, y) => x > -6 && y > -6 && x < W + 6 && y < H + 6;
    if (capas.lugares) {
      const esc = Math.min(2.2, 0.75 + k * 0.18);
      for (let i = 0; i < baseLug.length; i++) {
        const x = t.x + baseLug[i][0] * k, y = t.y + baseLug[i][1] * k;
        if (!visible(x, y)) continue;
        const st = LUG[lugares[i][2]] || LUG_OTRO;
        if (k < 2.5 && st === LUG_OTRO) continue;
        ctx.globalAlpha = st[2] * (dep && lugares[i][4].slice(0, 4) !== dep ? 0.2 : 1);
        ctx.fillStyle = st[1];
        ctx.beginPath(); ctx.arc(x, y, st[0] * esc, 0, 6.2832); ctx.fill();
      }
    }
    if (capas.celdas) {
      const anillos = k >= 12;
      if (anillos) {
        ctx.lineWidth = 1;
        for (let i = 0; i < baseCel.length; i++) {
          const x = t.x + baseCel[i][0] * k, y = t.y + baseCel[i][1] * k;
          const r = Math.max(500, celdas[i][4]) * pxPorMetro * k;
          if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue;
          ctx.globalAlpha = 0.09;
          ctx.strokeStyle = celColor(celdas[i]);
          ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
        }
      }
      const rad = Math.min(3.2, 1 + k * 0.12);
      for (let i = 0; i < baseCel.length; i++) {
        const x = t.x + baseCel[i][0] * k, y = t.y + baseCel[i][1] * k;
        if (!visible(x, y)) continue;
        ctx.globalAlpha = (dep && celdas[i][7].slice(0, 4) !== dep ? 0.15 : 0.85);
        ctx.fillStyle = celColor(celdas[i]);
        ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.2832); ctx.fill();
      }
    }
    if (capas.lugares && k >= 5) {
      ctx.globalAlpha = 1; ctx.font = `500 ${k >= 8 ? 11 : 10}px Inter, Segoe UI, sans-serif`;
      const cs = getComputedStyle(document.documentElement); ctx.lineWidth = 3; ctx.strokeStyle = cs.getPropertyValue('--etiqueta-borde').trim() || 'rgba(20,21,23,0.9)'; ctx.fillStyle = cs.getPropertyValue('--fg').trim() || '#ededee';
      for (let i = 0; i < baseLug.length; i++) {
        const c = lugares[i][2];
        if (!(c === 'CIUDAD' || c === 'PUEBLO' || c === 'VILLA' || (k >= 8 && c === 'ALDEA'))) continue;
        const x = t.x + baseLug[i][0] * k, y = t.y + baseLug[i][1] * k;
        if (x < 0 || y < 0 || x > W || y > H) continue;
        ctx.strokeText(lugares[i][3], x + 5, y - 4); ctx.fillText(lugares[i][3], x + 5, y - 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  const zoom = d3.zoom().scaleExtent([1, 40]).on('zoom', (ev) => {
    tActual = ev.transform;
    dibujarPuntos();
    gZoom.attr('transform', ev.transform);
    etiquetas.style('font-size', `${11 / ev.transform.k}px`).style('stroke-width', `${3 / ev.transform.k}px`).attr('opacity', ev.transform.k > 3.5 || (window.SITMAP.movil() && ev.transform.k < 2.2) ? 0 : 1);
  });
  svg.call(zoom).on('dblclick.zoom', null);

  function encuadre() {
    if (!cont.clientWidth) return;
    W = cont.clientWidth; H = cont.clientHeight;
    svg.attr('viewBox', `0 0 ${W} ${H}`);
    proj.fitExtent(window.SITMAP.extent(W, H, { izq: 370, der: 30, arr: 70, aba: 120 }), { type: 'FeatureCollection', features: tierra });
    munis.attr('d', path); lagosSel.attr('d', path); bordes.attr('d', path); contorno.attr('d', path);
    etiquetas.attr('transform', (d) => { const c = path.centroid(d.feature); return `translate(${c[0]},${c[1]})`; }).attr('opacity', window.SITMAP.movil() && tActual.k < 2.2 ? 0 : 1);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    baseLug = lugares.map((l) => proj([l[0], l[1]]));
    baseCel = celdas.map((c) => proj([c[0], c[1]]));
    pxPorMetro = Math.abs(proj([-90.5, 15])[1] - proj([-90.5, 15.009])[1]) / 1000;
    dibujarPuntos();
  }
  encuadre();
  window.addEventListener('resize', () => { encuadre(); if (estado.vista === 'tablero') tablero(); });

  function zoomA(feature, ms = 750) {
    const [[x0, y0], [x1, y1]] = path.bounds(feature);
    const k = Math.min(30, 0.75 / Math.max((x1 - x0) / W, (y1 - y0) / H));
    const t = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    svg.transition().duration(reducido() ? 0 : ms).call(zoom.transform, t);
  }
  document.getElementById('reset').onclick = () => {
    estado.depto = ''; document.getElementById('depto').value = '';
    svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity); pintar();
  };

  // ---- tooltip ----
  const tip = document.getElementById('tip');
  const fila = (cod, p = estado.periodo) => (porPeriodo.get(p) || []).find((r) => r.codigo_ine === cod) || null;
  munis.on('mousemove', (ev, f) => {
    const r = fila(f.properties.id); const i = info.get(f.properties.id); if (!i) return;
    const m = estado.metrica; const v = r ? m.valor(r, estado.periodo) : null;
    tip.replaceChildren(el('b', null, i.municipio), el('small', null, i.departamento),
      el('div', 'v', v === null ? 'sin dato' : m.fmt(v)), el('small', null, `${m.nombre}${m.unidad && v !== null && m.unidad !== 'IDM' ? ` · ${m.unidad}` : ''}`));
    const ix = idmDe(f.properties.id);
    if (ix && m.id !== 'idm') tip.append(el('div', null, `IDM ${fmt1(ix.idm)} · puesto ${ix.rank} de ${ix.n}`));
    const lp = lugaresMuni[f.properties.id];
    if (lp) tip.append(el('div', null, `${fmt(lp.total)} lugares poblados`));
    const cm = celdasMuni[f.properties.id];
    tip.append(el('div', null, `${cm ? fmt(cm.total) : 0} celdas observadas (OpenCelliD)`));
    tip.hidden = false;
    const rect = cont.getBoundingClientRect(); const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    tip.style.left = `${Math.min(x + 16, W - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(y + 16, H - tip.offsetHeight - 8)}px`;
  }).on('mouseleave', () => { tip.hidden = true; })
    .on('click', (ev, f) => { seleccionar(f.properties.id, false); });

  // =====================================================================
  // CONTROLES
  // =====================================================================
  const metEl = document.getElementById('metrics');
  METRICAS.forEach((m) => {
    const b = el('button', 'metric'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.id = m.id;
    const sw = el('span', 'sw');
    const cols = m.colores || m.categorias.map((c) => c[2]);
    sw.style.background = `linear-gradient(90deg, ${cols.join(',')})`;
    b.append(sw, el('span', 't', m.nombre));
    b.onclick = () => { estado.metrica = m; pintar(); };
    metEl.append(b);
  });

  const selDep = document.getElementById('depto');
  deptos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).forEach((d) => selDep.append(new Option(d.nombre, d.cod)));
  selDep.onchange = () => {
    estado.depto = selDep.value;
    if (estado.vista === 'mapa') {
      const d = deptos.find((x) => x.cod === estado.depto);
      if (d) zoomA(d.feature); else svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity);
    }
    pintar();
  };

  // capas
  const chkLug = document.getElementById('capa-lugares');
  chkLug.onchange = () => { capas.lugares = chkLug.checked; document.getElementById('leyenda-lugares').hidden = !chkLug.checked; dibujarPuntos(); };
  document.getElementById('leyenda-lugares').replaceChildren(...[LUG.CIUDAD, LUG.ALDEA, LUG.COLONIA, LUG.CASERIO, LUG_OTRO].map((st) => {
    const d = el('div', 'cat'); const i = el('i'); i.style.background = st[1]; i.style.borderRadius = '50%'; i.style.width = i.style.height = `${6 + st[0] * 2}px`;
    d.append(i, document.createTextNode(st[3])); return d;
  }));
  const chkCel = document.getElementById('capa-celdas');
  document.getElementById('celdas-n').textContent = `(${fmt(celdasMeta.celdas)} · OpenCelliD)`;
  chkCel.onchange = () => { capas.celdas = chkCel.checked; document.getElementById('celdas-opts').hidden = !chkCel.checked; dibujarPuntos(); };
  document.querySelectorAll('#celdas-opts [data-modo]').forEach((b) => {
    b.onclick = () => {
      estado.celdasModo = b.dataset.modo;
      document.querySelectorAll('#celdas-opts [data-modo]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      leyendaCeldas(); dibujarPuntos();
    };
  });
  function leyendaCeldas() {
    const tabla = estado.celdasModo === 'tec' ? CEL_TEC : CEL_OP;
    const cuenta = estado.celdasModo === 'tec' ? celdasMeta.por_tecnologia : celdasMeta.por_mnc;
    document.getElementById('leyenda-celdas').replaceChildren(...Object.entries(tabla).filter(([k]) => cuenta[k]).map(([k, [col, nom]]) => {
      const d = el('div', 'cat'); const i = el('i'); i.style.background = col; i.style.width = i.style.height = '10px';
      d.append(i, document.createTextNode(nom), el('b', null, fmt(cuenta[k]))); return d;
    }));
  }
  leyendaCeldas();

  // búsqueda
  const inp = document.getElementById('search'); const res = document.getElementById('results');
  const sinTilde = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const lista = [...info].map(([cod, v]) => ({ cod, ...v, k: sinTilde(v.municipio) }));
  let act = 0, encontrados = [];
  inp.oninput = () => {
    const q = sinTilde(inp.value).trim();
    encontrados = q ? lista.filter((x) => x.k.includes(q)).slice(0, 8) : [];
    act = 0;
    res.replaceChildren(...encontrados.map((x, i) => { const d = el('div', i === 0 ? 'act' : '', x.municipio); d.append(el('small', null, x.departamento)); d.onmousedown = () => elegirBusqueda(x); return d; }));
    res.hidden = !encontrados.length;
  };
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + encontrados.length) % Math.max(1, encontrados.length); [...res.children].forEach((c, i) => c.classList.toggle('act', i === act)); }
    if (e.key === 'Enter' && encontrados[act]) elegirBusqueda(encontrados[act]);
    if (e.key === 'Escape') { res.hidden = true; inp.blur(); }
    e.stopPropagation();
  };
  inp.onblur = () => setTimeout(() => { res.hidden = true; }, 150);
  function elegirBusqueda(x) { inp.value = x.municipio; res.hidden = true; seleccionar(x.cod, estado.vista === 'mapa'); }

  // línea de tiempo
  const ticksEl = document.getElementById('ticks');
  periodos.forEach((p) => {
    const b = el('button', 'tick'); b.dataset.p = p; b.title = perLargo(p);
    b.append(el('i'), document.createTextNode(perCorto(p)));
    b.onclick = () => irA(p);
    ticksEl.append(b);
  });
  function irA(p) { estado.periodo = p; try { history.replaceState(null, '', `#${p}`); } catch (e) { /* sin historial */ } pintar(); }
  let timer = null;
  const playBtn = document.getElementById('play'); const playIcon = document.getElementById('play-icon');
  function parar() { clearInterval(timer); timer = null; playIcon.setAttribute('d', 'M6 4l10 6-10 6z'); playBtn.setAttribute('aria-label', 'Reproducir la serie'); }
  playBtn.onclick = () => {
    if (timer) { parar(); return; }
    playIcon.setAttribute('d', 'M5 4h4v12H5zM11 4h4v12h-4z'); playBtn.setAttribute('aria-label', 'Pausar');
    const disp = periodos.filter((p) => estado.metrica.disponible(p));
    if (estado.periodo === disp[disp.length - 1]) irA(disp[0]);
    timer = setInterval(() => {
      const d = periodos.filter((p) => estado.metrica.disponible(p));
      const i = d.indexOf(estado.periodo);
      if (i < 0 || i >= d.length - 1) { parar(); return; }
      irA(d[i + 1]);
    }, 1100);
  };
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (estado.modo !== 'actual') return;
    const i = periodos.indexOf(estado.periodo);
    if (e.key === 'ArrowRight' && i < periodos.length - 1) { parar(); irA(periodos[i + 1]); }
    if (e.key === 'ArrowLeft' && i > 0) { parar(); irA(periodos[i - 1]); }
    if (e.key === 'Escape') cerrarFicha();
  });

  // cambio de vista
  function cambiarVista(v, ancla) {
    estado.vista = v;
    try { localStorage.setItem('sit-vista', v); localStorage.setItem('sit-modo', estado.modo); } catch (e) { /* sin almacenamiento */ }
    const app = document.getElementById('app');
    app.dataset.vista = v; app.dataset.modo = estado.modo;
    const actual = estado.modo === 'actual';
    document.getElementById('vista-mapa').hidden = !(actual && v === 'mapa');
    document.getElementById('vista-tablero').hidden = !(actual && v === 'tablero');
    document.querySelectorAll('.panel-top [data-vista]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vista === v)));
    document.querySelectorAll('.panel-top [data-modo]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.modo === estado.modo)));
    tip.hidden = true;
    if (!actual) {
      det.hidden = true; parar();
      const [mostrar, ocultar] = estado.modo === 'proximo' ? [window.Proximo, window.Escuelas] : [window.Escuelas, window.Proximo];
      if (ocultar) ocultar.ocultar();
      if (mostrar) mostrar.mostrar(v);
      return;
    }
    if (window.Proximo) window.Proximo.ocultar();
    if (window.Escuelas) window.Escuelas.ocultar();
    det.hidden = !estado.sel;
    if (v === 'mapa') encuadre();
    pintar();
    if (ancla) { const a = document.getElementById(ancla); if (a) a.scrollIntoView({ behavior: reducido() ? 'auto' : 'smooth', block: 'start' }); }
  }
  document.querySelectorAll('.panel-top [data-vista]').forEach((b) => { b.onclick = () => cambiarVista(b.dataset.vista); });
  document.querySelectorAll('.panel-top [data-modo]').forEach((b) => { b.onclick = () => { estado.modo = b.dataset.modo; cambiarVista(estado.vista); }; });
  document.querySelectorAll('[data-ir]').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.ir; cambiarVista(v, b.dataset.ancla);
      if (v === 'mapa' && estado.sel) { const f = tierra.find((x) => x.properties.id === estado.sel); if (f) zoomA(f, 900); }
    };
  });

  // =====================================================================
  // FICHA DEL MUNICIPIO (compartida)
  // =====================================================================
  const det = document.getElementById('detail');
  document.getElementById('close-detail').onclick = cerrarFicha;
  function cerrarFicha() { estado.sel = null; det.hidden = true; pintar(); }
  function seleccionar(cod, acercar) {
    estado.sel = cod; det.hidden = false;
    if (acercar) { const f = tierra.find((x) => x.properties.id === cod); if (f) zoomA(f, 900); }
    pintar();
  }
  const barras = (cont2, items, vacio) => {
    if (!items.length) { cont2.replaceChildren(el('p', 'empty', vacio)); return; }
    const total = d3.sum(items, (o) => o.v);
    cont2.replaceChildren(...items.map((o) => {
      const d = el('div', 'bar'); const t = el('span', 'track'); const f = el('span', 'fill');
      f.style.display = 'block'; f.style.width = `${(o.v / total) * 100}%`; f.style.background = o.c; t.append(f);
      d.append(el('span', null, o.n), t, el('b', null, fmt(o.v))); return d;
    }));
  };

  function ficha() {
    if (!estado.sel) return;
    const cod = estado.sel; const i = info.get(cod); const r = fila(cod); const p = estado.periodo;
    document.getElementById('d-depto').textContent = i.departamento;
    document.getElementById('d-nombre').textContent = i.municipio;
    const rk = document.getElementById('d-rank'); rk.replaceChildren();
    const ix = idmDe(cod);
    if (ix && ix.idm !== null) {
      const s = el('span', 'score', fmt1(ix.idm)); s.style.color = colorIdm(ix.idm);
      const pill = el('span', 'pill', `IDM · puesto ${ix.rank} de ${ix.n}`); pill.style.color = colorIdm(ix.idm);
      rk.append(s, pill);
      if (ix.comps === 1) rk.append(el('small', 'empty', 'Solo con antenas: no reporta líneas fijas.'));
    } else rk.append(el('p', 'empty', `Sin IDM en el ${perLargo(p)}.`));
    const lp = lugaresMuni[cod]; const cm = celdasMuni[cod];
    const facts = [
      ['Población (2024)', r ? fmt(r.poblacion) : '—'],
      ['Radiobases (SIT)', r && r.radiobases !== null ? fmt(r.radiobases) : 'sin dato'],
      ['Antenas / 10 mil hab.', r && r.radiobases_10k_hab !== null ? fmt1(r.radiobases_10k_hab) : 'sin dato'],
      ['Celdas observadas', cm ? fmt(cm.total) : '0'],
      ['Líneas fijas', r && r.lineas_fijas_total !== null ? fmt(r.lineas_fijas_total) : 'sin dato'],
      ['Líneas / 100 hab.', r && r.lineas_fijas_total > 0 ? fmt1(r.lineas_fijas_100_hab) : 'sin dato'],
      ['Operadores fijos', r && r.operadores_fijos !== null ? String(r.operadores_fijos) : 'sin dato'],
      ['Lugares poblados', lp ? fmt(lp.total) : '—'],
      ['Lugares por radiobase', lp && r && r.radiobases ? fmt1(lp.total / r.radiobases) : 'sin dato'],
      ['Aldeas / caseríos', lp ? `${fmt(lp.ALDEA || 0)} / ${fmt(lp.CASERIO || 0)}` : '—'],
    ];
    document.getElementById('d-facts').replaceChildren(...facts.map(([t, v]) => { const d = el('div'); d.append(el('dt', null, t), el('dd', null, v)); return d; }));

    const m = estado.metrica.categorias ? METRICAS[2] : estado.metrica;
    document.getElementById('d-spark-title').textContent = `${m.nombre} por semestre`;
    const serie = (porMuni.get(cod) || []).map((x) => ({ p: x.periodo, v: m.valor(x, x.periodo) })).filter((x) => x.v !== null).sort((a, b) => d3.ascending(a.p, b.p));
    const sp = d3.select('#d-spark'); sp.selectAll('*').remove();
    const w = sp.node().clientWidth || 280, h = 90;
    sp.attr('viewBox', `0 0 ${w} ${h}`).attr('aria-label', `${m.nombre} de ${i.municipio} por semestre`);
    if (serie.length > 1) {
      const x = d3.scalePoint(serie.map((s) => s.p), [6, w - 6]);
      const y = d3.scaleLinear([0, d3.max(serie, (s) => s.v) * 1.15 || 1], [h - 18, 8]);
      sp.append('path').attr('class', 'ar').attr('d', d3.area((s) => x(s.p), h - 18, (s) => y(s.v))(serie));
      sp.append('path').attr('class', 'ln').attr('d', d3.line((s) => x(s.p), (s) => y(s.v))(serie));
      sp.selectAll('circle').data(serie).join('circle').attr('class', (s) => (s.p === p ? 'cur' : 'dot')).attr('r', (s) => (s.p === p ? 5 : 2.2)).attr('cx', (s) => x(s.p)).attr('cy', (s) => y(s.v))
        .style('cursor', 'pointer').on('click', (ev, s) => irA(s.p)).append('title').text((s) => `${perLargo(s.p)}: ${m.fmt(s.v)}`);
      sp.append('text').attr('x', 6).attr('y', h - 3).text(perCorto(serie[0].p));
      sp.append('text').attr('x', w - 6).attr('y', h - 3).attr('text-anchor', 'end').text(perCorto(serie[serie.length - 1].p));
      const cur = serie.find((s) => s.p === p);
      if (cur) sp.append('text').attr('x', Math.min(Math.max(x(cur.p), 20), w - 20)).attr('y', Math.max(10, y(cur.v) - 10)).attr('text-anchor', 'middle').style('fill', '#fff').text(m.fmt(cur.v));
    } else sp.append('text').attr('x', 0).attr('y', 20).text('Sin serie suficiente.');

    const ops = ((opsIdx.get(p) || new Map()).get(cod) || []).slice().sort((a, b) => b.lineas_fijas - a.lineas_fijas);
    barras(document.getElementById('d-ops'), ops.map((o) => ({ n: o.operador, v: o.lineas_fijas, c: OPCOL[o.operador] || '#94a3b8' })), 'El boletín no reporta líneas fijas aquí en este semestre.');
    const itemsCel = cm ? [
      ...Object.entries(CEL_TEC).filter(([k]) => cm[k]).map(([k, [c, n]]) => ({ n, v: cm[k], c })),
      ...Object.entries(CEL_OP).filter(([k]) => cm[`mnc${k}`]).map(([k, [c, n]]) => ({ n, v: cm[`mnc${k}`], c })),
    ] : [];
    const dc = document.getElementById('d-celdas');
    if (cm) {
      const g1 = el('div', 'bars'), g2 = el('div', 'bars');
      barras(g1, itemsCel.slice(0, Object.keys(CEL_TEC).filter((k) => cm[k]).length), '');
      barras(g2, itemsCel.slice(Object.keys(CEL_TEC).filter((k) => cm[k]).length), '');
      dc.replaceChildren(g1, g2);
    } else dc.replaceChildren(el('p', 'empty', 'Sin celdas observadas en la muestra de OpenCelliD. No significa que no haya servicio: hay pocas mediciones fuera de las ciudades.'));
    document.getElementById('d-ver-mapa').hidden = estado.vista === 'mapa';
  }

  // =====================================================================
  // RESUMEN DEL MAPA
  // =====================================================================
  function resumen(p) {
    const filas = porPeriodo.get(p); const i = periodos.indexOf(p);
    const antFx = periodos.slice(0, i).filter(tieneFx).pop();
    const fx = tieneFx(p) ? d3.sum(filas, (r) => r.lineas_fijas_total ?? 0) : null;
    const fxA = antFx ? d3.sum(porPeriodo.get(antFx), (r) => r.lineas_fijas_total ?? 0) : null;
    return {
      rb: tieneRb(p) ? d3.sum(filas, (r) => r.radiobases ?? 0) : null,
      fx, dfx: fx !== null && fxA ? (fx - fxA) / fxA * 100 : null, antFx,
      unop: tieneFx(p) ? filas.filter((r) => r.operadores_fijos === 1).length : null,
      sinfx: tieneFx(p) ? filas.filter((r) => !r.lineas_fijas_total).length : null,
    };
  }
  function kpis() {
    const s = resumen(estado.periodo);
    const items = [
      [s.rb === null ? 'sin dato' : fmt(s.rb), 'radiobases móviles', null],
      [s.fx === null ? 'sin dato' : fmt(s.fx), 'líneas fijas', s.dfx],
      [s.unop === null ? 'sin dato' : fmt(s.unop), 'municipios con un solo operador fijo', null],
      [s.sinfx === null ? 'sin dato' : fmt(s.sinfx), 'municipios sin líneas fijas reportadas', null],
    ];
    document.getElementById('kpis').replaceChildren(...items.map(([v, t, d]) => {
      const k = el('div', 'kpi'); k.append(el('b', null, v), el('span', null, t));
      if (d !== null) k.append(el('span', `delta ${d >= 0 ? 'up' : 'down'}`, `${d >= 0 ? '+' : ''}${fmt1(d)} % vs. semestre anterior`));
      return k;
    }));
    const cav = document.getElementById('caveat'); const sal = saltos.get(estado.periodo); const m = estado.metrica;
    if (!m.disponible(estado.periodo)) { cav.hidden = false; cav.textContent = `El boletín del ${perLargo(estado.periodo)} no trae los datos para "${m.nombre}".`; }
    else if (sal && (m.id === 'antenas' || m.id === 'idm')) { cav.hidden = false; cav.textContent = `Ojo: el conteo nacional de radiobases da un salto en este semestre: ${sal.split('.')[0]}. Probable cambio de método; compare con cautela.`; }
    else cav.hidden = true;
  }
  function leyenda() {
    const m = estado.metrica; const lg = document.getElementById('legend');
    lg.replaceChildren(el('span', 'label', m.nombre));
    if (m.categorias) {
      const c = el('div', 'cats');
      [...m.categorias, [null, 'Sin dato', null]].forEach(([, n, col]) => { const d = el('div', 'cat'); const i = el('i'); if (col) i.style.background = col; else i.className = 'null-swatch'; d.append(i, document.createTextNode(n)); c.append(d); });
      lg.append(c);
    } else {
      const r = el('div', 'ramp'); m.colores.forEach((col) => { const s = el('span'); s.style.background = col; r.append(s); });
      const sc = el('div', 'scale'); sc.append(...['', ...m.umbrales.map((u) => m.fmt(u)), ''].map((v) => el('span', null, v)));
      const ex = el('div', 'ends'); m.extremos.forEach((x) => ex.append(el('span', null, x)));
      const nd = el('div', 'cat'); const ni = el('i', 'null-swatch'); nd.append(ni, document.createTextNode('Sin dato'));
      lg.append(r, sc, ex, nd);
    }
  }

  // =====================================================================
  // TABLERO
  // =====================================================================
  const tbody = document.querySelector('#t-tabla tbody');
  document.querySelectorAll('#t-tabla th[data-sort]').forEach((th) => {
    th.tabIndex = 0;
    const ordenar = () => {
      const k = th.dataset.sort;
      estado.orden = [k, estado.orden[0] === k && estado.orden[1] === 'asc' ? 'desc' : 'asc'];
      tablaTablero();
    };
    th.onclick = ordenar; th.onkeydown = (e) => { if (e.key === 'Enter') ordenar(); };
  });
  document.getElementById('t-filtro').oninput = (e) => { estado.filtro = sinTilde(e.target.value).trim(); tablaTablero(); };
  document.getElementById('t-mas').onclick = () => { estado.todos = !estado.todos; tablaTablero(); };

  function filasTablero() {
    const p = estado.periodo;
    return (porPeriodo.get(p) || []).map((r) => {
      const ix = idmDe(r.codigo_ine);
      return {
        cod: r.codigo_ine, municipio: r.municipio, departamento: r.departamento,
        rank: ix ? ix.rank : 9999, idm: ix ? ix.idm : null, comps: ix ? ix.comps : 0,
        antenas: r.radiobases_10k_hab, lineas: r.lineas_fijas_total > 0 ? r.lineas_fijas_100_hab : null,
        ops: r.lineas_fijas_total > 0 ? r.operadores_fijos : null, principal: r.lineas_fijas_total > 0 ? r.operador_fijo_principal : null,
        pct: r.participacion_principal_pct, celdas: celdasMuni[r.codigo_ine]?.total ?? 0,
      };
    });
  }
  function tablaTablero() {
    const [k, dir] = estado.orden;
    let filas = filasTablero();
    if (estado.depto) filas = filas.filter((f) => f.cod.slice(0, 4) === estado.depto);
    if (estado.filtro) filas = filas.filter((f) => sinTilde(f.municipio).includes(estado.filtro) || sinTilde(f.departamento).includes(estado.filtro));
    const val = (f) => (k === 'municipio' || k === 'principal' ? (f[k] || '') : (f[k] ?? (dir === 'asc' ? Infinity : -Infinity)));
    filas.sort((a, b) => (dir === 'asc' ? d3.ascending : d3.descending)(val(a), val(b)) || d3.ascending(a.rank, b.rank));
    document.querySelectorAll('#t-tabla th[data-sort]').forEach((th) => th.setAttribute('aria-sort', th.dataset.sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'));
    const total = filas.length;
    if (!estado.todos && !estado.filtro) filas = filas.slice(0, 25);
    tbody.replaceChildren(...filas.map((f) => {
      const tr = el('tr'); tr.tabIndex = 0; if (f.cod === estado.sel) tr.className = 'sel';
      const mun = el('td'); mun.append(document.createTextNode(f.municipio), el('small', null, f.departamento));
      const idm = el('td', 'num'); const wrap = el('span', 'idm'); const sw = el('i'); sw.style.background = colorIdm(f.idm);
      wrap.append(sw, document.createTextNode(f.idm === null ? '—' : fmt1(f.idm))); idm.append(wrap);
      if (f.comps === 1) idm.append(el('small', null, 'solo antenas'));
      const pr = el('td');
      if (f.principal) { pr.append(document.createTextNode(f.principal)); pr.append(el('small', null, f.ops === 1 ? 'único operador' : `${fmt1(f.pct)} % de las líneas`)); }
      else pr.append(el('span', 'tag warn', 'sin líneas reportadas'));
      const ce = el('td', 'num', fmt(f.celdas)); if (!f.celdas) ce.append(el('small', null, 'sin muestra'));
      tr.append(el('td', 'num', f.rank === 9999 ? '—' : String(f.rank)), mun, idm,
        el('td', 'num', f.antenas === null ? 'sin dato' : fmt1(f.antenas)), el('td', 'num', f.lineas === null ? 'sin dato' : fmt1(f.lineas)),
        el('td', 'num', f.ops === null ? 'sin dato' : String(f.ops)), pr, ce);
      tr.onclick = () => seleccionar(f.cod, false);
      tr.onkeydown = (e) => { if (e.key === 'Enter') seleccionar(f.cod, false); };
      return tr;
    }));
    const btn = document.getElementById('t-mas');
    btn.hidden = !!estado.filtro || total <= 25;
    btn.textContent = estado.todos ? 'Ver solo los primeros 25' : `Ver los ${fmt(total)} municipios`;
  }

  function graficoBarrasH(id, items, fmtV, colorF) {
    const c = document.getElementById(id); c.replaceChildren();
    if (!items.length) { c.append(el('p', 'empty', 'Sin datos para este semestre.')); return; }
    const w = Math.max(280, c.clientWidth), fila = 22, mg = { l: 120, r: 46, t: 4 };
    const h = mg.t + items.length * fila;
    const x = d3.scaleLinear([0, d3.max(items, (d) => d.v) || 1], [mg.l, w - mg.r]);
    const s = d3.select(c).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', id);
    const g = s.selectAll('g').data(items).join('g').attr('transform', (d, i) => `translate(0,${mg.t + i * fila})`);
    g.append('text').attr('x', mg.l - 8).attr('y', 14).attr('text-anchor', 'end').text((d) => d.n);
    g.append('rect').attr('x', mg.l).attr('y', 4).attr('height', 13).attr('rx', 3).attr('width', (d) => Math.max(1, x(d.v) - mg.l)).attr('fill', (d) => colorF(d));
    g.append('text').attr('class', 'num-l').attr('x', (d) => x(d.v) + 6).attr('y', 15).text((d) => fmtV(d.v));
  }

  function graficoSerie(id, campo) {
    const c = document.getElementById(id); c.replaceChildren();
    const serie = periodos.map((p) => ({ p, v: (campo === 'radiobases' ? tieneRb(p) : tieneFx(p)) ? d3.sum(porPeriodo.get(p), (r) => r[campo] ?? 0) : null })).filter((d) => d.v !== null);
    const w = Math.max(280, c.clientWidth), h = 130, mg = { l: 54, r: 14, t: 10, b: 20 };
    const x = d3.scalePoint(serie.map((d) => d.p), [mg.l, w - mg.r]).padding(0.3);
    const y = d3.scaleLinear([0, d3.max(serie, (d) => d.v) * 1.1], [h - mg.b, mg.t]).nice();
    const s = d3.select(c).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', `${campo} por semestre`);
    s.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(3)).join('line').attr('x1', mg.l).attr('x2', w - mg.r).attr('y1', y).attr('y2', y);
    s.append('g').selectAll('text').data(y.ticks(3).filter((v) => v > 0)).join('text').attr('x', mg.l - 6).attr('y', (v) => y(v) + 4).attr('text-anchor', 'end').text(d3.format('~s'));
    s.append('path').datum(serie).attr('d', d3.line((d) => x(d.p), (d) => y(d.v))).attr('fill', 'none').attr('stroke', campo === 'radiobases' ? '#38bdf8' : '#5cc39a').attr('stroke-width', 2);
    const cada = Math.ceil(serie.length / Math.max(2, Math.floor((w - mg.l) / 46)));
    s.append('g').selectAll('text').data(serie).join('text').attr('x', (d) => x(d.p)).attr('y', h - 4).attr('text-anchor', 'middle')
      .text((d, i) => (i === serie.length - 1 || (i % cada === 0 && serie.length - 1 - i >= cada) ? perCorto(d.p) : ''));
    s.append('g').selectAll('circle').data(serie).join('circle').attr('cx', (d) => x(d.p)).attr('cy', (d) => y(d.v))
      .attr('r', (d) => (d.p === estado.periodo ? 5 : campo === 'radiobases' && saltos.has(d.p) ? 4 : 2.5))
      .attr('fill', (d) => (d.p === estado.periodo ? '#fff' : campo === 'radiobases' && saltos.has(d.p) ? '#f2b84b' : (campo === 'radiobases' ? '#38bdf8' : '#5cc39a')))
      .attr('stroke', (d) => (d.p === estado.periodo ? (campo === 'radiobases' ? '#38bdf8' : '#5cc39a') : 'none')).attr('stroke-width', 2)
      .style('cursor', 'pointer').on('click', (ev, d) => irA(d.p))
      .append('title').text((d) => `${perLargo(d.p)}: ${fmt(d.v)}${campo === 'radiobases' && saltos.has(d.p) ? ' · salto en la serie' : ''}`);
    const cur = serie.find((d) => d.p === estado.periodo);
    if (cur) s.append('text').attr('class', 'num-l').attr('x', Math.min(x(cur.p), w - 60)).attr('y', Math.max(12, y(cur.v) - 9)).attr('text-anchor', 'middle').text(fmt(cur.v));
  }

  function tablero() {
    const p = estado.periodo; const s = resumen(p);
    const filas = filasTablero().filter((f) => f.idm !== null).sort((a, b) => a.rank - b.rank);
    const lead = document.getElementById('t-lead'); lead.replaceChildren();
    if (filas.length) {
      const deps = d3.rollups(filas.slice(0, 25), (v) => v.length, (f) => f.departamento).sort((a, b) => b[1] - a[1]).slice(0, 3).map((d) => d[0]);
      lead.append(document.createTextNode(`En el ${perLargo(p)}, los municipios con menor IDM se concentran en `), el('b', null, deps.join(', ').replace(/, ([^,]*)$/, ' y $1')),
        document.createTextNode('. '), el('b', null, fmt(s.unop)), document.createTextNode(` de ${filas.length} municipios dependen de un solo operador de telefonía fija.`));
    } else lead.textContent = `El boletín del ${perLargo(p)} no trae datos suficientes para calcular el IDM. Elija otro semestre en la línea de tiempo.`;

    const tk = [
      [s.rb === null ? 'sin dato' : fmt(s.rb), 'radiobases móviles (SIT)', saltos.has(p) ? 'Salto en la serie: posible cambio de método' : null, 'warn'],
      [s.fx === null ? 'sin dato' : fmt(s.fx), 'líneas fijas en operación', s.dfx === null ? null : `${s.dfx >= 0 ? '+' : ''}${fmt1(s.dfx)} % frente al ${perLargo(s.antFx)}`, s.dfx >= 0 ? 'up' : 'down'],
      [s.unop === null ? 'sin dato' : fmt(s.unop), 'municipios con un solo operador fijo', null],
      [s.sinfx === null ? 'sin dato' : fmt(s.sinfx), 'municipios sin líneas fijas reportadas', null],
      [fmt(celdasMeta.celdas), 'celdas observadas por teléfonos (OpenCelliD, últimos 18 meses)', `Última observación: ${celdasMeta.ultima_observacion}`, ''],
    ];
    document.getElementById('t-kpis').replaceChildren(...tk.map(([v, t, d, cls]) => { const k = el('div', 't-kpi'); k.append(el('b', null, v), el('span', null, t)); if (d) k.append(el('span', `delta ${cls === 'warn' ? 'rt-warn' : cls}`, d)); return k; }));

    tablaTablero();

    const porDep = d3.rollups(filas, (v) => d3.mean(v, (f) => f.idm), (f) => f.departamento).map(([n, v]) => ({ n, v })).sort((a, b) => a.v - b.v);
    graficoBarrasH('t-chart-deptos', porDep, fmt1, (d) => colorIdm(d.v));
    graficoSerie('t-chart-rbs', 'radiobases');
    graficoSerie('t-chart-fx', 'lineas_fijas_total');

    const pt = celdasMeta.por_tecnologia, pm = celdasMeta.por_mnc;
    document.getElementById('t-celdas-sub').textContent = `${fmt(celdasMeta.celdas)} celdas dentro de Guatemala, observadas por última vez entre ${celdasMeta.primera_observacion} y ${celdasMeta.ultima_observacion}. Muestran dónde los teléfonos han medido señal; complementan, no reemplazan, las radiobases que reporta la SIT.`;
    barras(document.getElementById('t-celdas-tec'), Object.entries(CEL_TEC).filter(([k]) => pt[k]).map(([k, [c, n]]) => ({ n, v: pt[k], c })), '');
    barras(document.getElementById('t-celdas-op'), Object.entries(CEL_OP).filter(([k]) => pm[k]).map(([k, [c, n]]) => ({ n, v: pm[k], c })), '');
    const conCel = Object.keys(celdasMuni).length;
    const tot = celdasMeta.celdas;
    const capital = celdasMuni.GT0101?.total ?? 0;
    const cob = [
      [`${conCel} de 340`, 'municipios tienen al menos una celda observada'],
      [`${340 - conCel}`, 'municipios sin ninguna medición: ahí no se puede usar esta fuente'],
      [`${fmt1(capital / tot * 100)} %`, 'de las celdas están en el municipio de Guatemala: la muestra se concentra en zonas urbanas'],
    ];
    document.getElementById('t-celdas-cob').replaceChildren(...cob.map(([b, t]) => { const d = el('div'); d.append(el('b', null, b), el('span', null, t)); return d; }));

  }

  // =====================================================================
  // PINTAR
  // =====================================================================
  function pintar() {
    const p = estado.periodo; const m = estado.metrica;
    document.getElementById('period-label').textContent = perLargo(p);
    document.querySelectorAll('.tick').forEach((b) => {
      b.classList.toggle('on', b.dataset.p === p);
      b.classList.toggle('nodata', estado.vista === 'mapa' ? !m.disponible(b.dataset.p) : !(tieneRb(b.dataset.p) && tieneFx(b.dataset.p)));
    });
    const on = document.querySelector('.tick.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (estado.vista === 'mapa') {
      const filas = new Map((porPeriodo.get(p) || []).map((r) => [r.codigo_ine, r]));
      munis
        .classed('sel', (f) => f.properties.id === estado.sel)
        .classed('dim', (f) => estado.depto && f.properties.id.slice(0, 4) !== estado.depto)
        .attr('fill', (f) => { const r = filas.get(f.properties.id); return colorDe(m, r ? m.valor(r, p) : null); });
      munis.filter((f) => f.properties.id === estado.sel).raise();
      document.querySelectorAll('.metric').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === m.id)));
      document.getElementById('metric-desc').textContent = m.desc;
      leyenda(); kpis(); dibujarPuntos();
    } else {
      tablero();
    }
    ficha();
  }

  window.SIT = { cambiarModo: (m) => { estado.modo = m; cambiarVista(estado.vista); } };
  cambiarVista(estado.vista);
  document.getElementById('loading').hidden = true;
})().catch((e) => {
  const l = document.getElementById('loading');
  l.hidden = false;
  l.textContent = `No se pudieron cargar los datos (${e.message}). Abra la app desde el servidor local, no como archivo.`;
  console.error(e);
});
