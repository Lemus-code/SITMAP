/* Modo "Próximamente": qué podría analizar la SIT con métricas por radiobase.
   TODAS las métricas de este modo son SIMULADAS (scripts/simular_proximamente.py).
   Lo único real: posiciones/operador/tecnología de celdas observadas (OpenCelliD), límites, población y lugares poblados. */
(function () {
  const fmt = d3.format(',');
  const fmt1 = d3.format(',.1f');
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const sinTilde = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const E = { vista: 'mapa', metrica: null, calor: true, calorModo: 'obs', sitios: false, sel: null, orden: ['ocupacion_pico_pct', 'desc'], filtro: '' };
  let D = null; // datos
  let iniciado = false;

  // ---------------- datos ----------------
  async function cargar() {
    const [geo, bordesGeo, celdas, celMeta, sitiosRaw, munis, meta] = await Promise.all([
      d3.json('data/limites_municipales.json'), d3.json('data/bordes.json'), d3.json('data/celdas_opencellid.json'),
      d3.json('data/celdas_meta.json'), d3.json('data/sim_sitios.json'), d3.json('data/sim_municipios.json'), d3.json('data/sim_meta.json'),
    ]);
    geo.features.forEach((f) => {
      if (d3.geoArea(f) > 2 * Math.PI) {
        const g = f.geometry;
        if (g.type === 'Polygon') g.coordinates.forEach((r) => r.reverse());
        if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => p.forEach((r) => r.reverse()));
      }
    });
    const c = sitiosRaw.campos;
    const sitios = sitiosRaw.filas.map((f) => Object.fromEntries(c.map((k, i) => [k, f[i]])));
    const porId = new Map(sitios.map((s) => [s.id, s]));
    D = { geo, bordesGeo, celdas, celMeta, sitios, porId, munis, meta, lista: Object.values(munis) };
  }

  // ---------------- catálogo de métricas a solicitar (no existen hoy) ----------------
  const CATALOGO = [
    ['Infraestructura de cada radiobase', [
      ['Ubicación exacta de cada radiobase', 'Coordenadas y código único de cada sitio, con su historial de altas y bajas', 'Por sitio', 'Semestral y en cada cambio', 'Operadores', 'Mapa real de la red; detectar duplicidad y sitios mal ubicados'],
      ['Sectores y orientación', 'Número de sectores, azimut y altura de cada antena', 'Por sector', 'Semestral', 'Operadores', 'Cobertura real por dirección; usuarios soportados por radiobase'],
      ['Tecnologías activas', '2G, 3G, 4G y 5G activas en cada sector', 'Por sector', 'Mensual', 'Operadores', 'Brecha tecnológica por municipio; plan de apagado de 2G/3G'],
      ['Bandas de frecuencia', 'Bandas y ancho de canal en uso por sector', 'Por sector (MHz)', 'Semestral', 'Operadores; contrastar con el registro de espectro', 'Capacidad máxima de tráfico por radiobase'],
      ['Capacidad y tipo de enlace', 'Tipo de transmisión (fibra, microondas, satelital) y capacidad contratada', 'Por sitio (Mbps)', 'Semestral', 'Operadores', 'Cuellos de botella y latencia; capacidad máxima por radiobase'],
    ]],
    ['Tráfico y uso de la red', [
      ['Tráfico cursado promedio y pico', 'Voz (minutos) y datos (GB y Mbps en hora pico)', 'Por sitio', 'Mensual (ideal: diario)', 'Operadores', 'Saturación en hora pico; capacidad promedio de uso por usuario'],
      ['Usuarios conectados por radiobase', 'Promedio y máximo de usuarios simultáneos', 'Por sitio', 'Mensual', 'Operadores', 'Usuarios soportados frente a usuarios atendidos'],
      ['Ocupación de recursos de radio', 'Porcentaje de uso de los recursos de radio en hora pico', 'Por sector (%)', 'Mensual', 'Operadores', 'Confirmar saturación técnica antes de auditar'],
    ]],
    ['Calidad del servicio', [
      ['Velocidad de descarga y subida', 'Velocidades medidas (mediana y percentiles)', 'Por municipio o zona (Mbps)', 'Trimestral', 'Pruebas de campo de la SIT o mediciones de usuarios', 'Calidad que realmente recibe el usuario'],
      ['Latencia', 'Tiempo de respuesta de la red', 'Por sitio o zona (ms)', 'Mensual', 'Operadores (indicadores de red) o pruebas de campo', 'Zonas con red lenta; efecto de enlaces satelitales'],
      ['Llamadas caídas y sesiones interrumpidas', 'Porcentaje de llamadas y sesiones de datos que se cortan', 'Por sitio (%)', 'Mensual', 'Operadores', 'Tipos de fallas en la conexión'],
      ['Intentos de conexión fallidos', 'Porcentaje de llamadas o sesiones que no logran conectarse', 'Por sitio (%)', 'Mensual', 'Operadores', 'Accesibilidad de la red'],
      ['Disponibilidad y registro de fallas', 'Horas fuera de servicio por sitio y causa (energía, transmisión, equipo)', 'Por sitio y evento', 'Mensual', 'Operadores', 'Tipos de fallas; sitios críticos que dejan sin servicio a una zona'],
    ]],
    ['Cobertura', [
      ['Área de cobertura por tecnología', 'Polígonos o mapas de nivel de señal declarados por sitio', 'Por sitio', 'Semestral', 'Operadores', 'Cobertura declarada frente a la observada; escuelas y comunidades cubiertas'],
      ['Mediciones de señal en campo', 'Nivel de señal medido en recorridos (dBm)', 'Por ruta o punto', 'Anual', 'SIT', 'Verificar lo que declaran los operadores'],
    ]],
    ['Usuarios y consumo', [
      ['Usuarios por tipo de dispositivo y plan', 'Usuarios por perfil: teléfono básico, smartphone, módem; prepago o pospago', 'Por municipio', 'Semestral', 'Operadores', 'Perfil de usuarios'],
      ['Consumo de datos por perfil', 'GB al mes por usuario según perfil', 'Por municipio (GB/mes)', 'Semestral', 'Operadores', 'Capacidad de consumo de datos por dispositivo'],
      ['Tarifas efectivas por zona', 'Precio pagado por GB y por minuto', 'Por municipio (Q)', 'Semestral', 'Operadores y Boletín de Tarifas de la SIT', 'Asequibilidad del servicio'],
    ]],
    ['Escuelas (conectividad estratégica)', [
      ['Conectividad de cada escuela', 'Si tiene internet, tipo de conexión (fija, móvil, satelital) y proveedor', 'Por escuela', 'Anual', 'MINEDUC, Giga y operadores', 'Validar la cobertura observada; escuelas a conectar primero'],
      ['Velocidad contratada y medida en escuelas', 'Mbps contratados y medidos', 'Por escuela (Mbps)', 'Trimestral', 'MINEDUC y Giga', 'Calidad de la conexión escolar'],
      ['Matrícula y energía eléctrica', 'Número de estudiantes y si la escuela tiene electricidad', 'Por escuela', 'Anual', 'MINEDUC', 'Priorizar inversiones por alumnos beneficiados'],
    ]],
  ];
  function catalogo() {
    const tb = document.querySelector('#pt-metricas-tabla tbody');
    let n = 0;
    const filas = [];
    CATALOGO.forEach(([grupo, items]) => {
      const g = el('tr', 'px-grupo'); const td = el('td', null, grupo); td.colSpan = 7; g.append(td); filas.push(g);
      items.forEach((it) => { n += 1; const tr = el('tr'); tr.append(el('td', 'num', String(n)), el('td', 'px-nom', it[0]), ...it.slice(1).map((x) => el('td', null, x))); filas.push(tr); });
    });
    tb.replaceChildren(...filas);
    document.getElementById('pt-metricas-tit').textContent = `${n} métricas a solicitar, en ${CATALOGO.length} grupos`;
  }

  // ---------------- métricas simuladas por municipio ----------------
  const verdeRojo = ['#2f9e6e', '#9cc36a', '#e9c35a', '#ec8a45', '#e2434f'];
  const rojoVerde = verdeRojo.slice().reverse();
  const q = (campo, k = 5) => { const v = D.lista.map((m) => m[campo]).filter((x) => x !== null && x !== undefined).sort(d3.ascending); return d3.range(1, k).map((i) => d3.quantileSorted(v, i / k)); };
  let METRICAS = [];
  function definirMetricas() {
    METRICAS = [
      { id: 'ocupacion_pico_pct', nombre: 'Ocupación en hora pico', unidad: '%', fmt: (v) => `${fmt1(v)} %`, umbrales: [30, 50, 70, 85], colores: verdeRojo, extremos: ['Holgada', 'Saturada'],
        desc: 'Qué parte de la capacidad máxima de las radiobases se usa en la hora de más tráfico. Arriba de 85 % la red se satura y el servicio se degrada.',
        req: ['Capacidad del enlace', 'Tráfico cursado (prom/pico)', 'Sectores', 'Bandas utilizadas'], extra: [] },
      { id: 'usuarios_por_sitio', nombre: 'Usuarios por radiobase', unidad: 'usuarios', fmt: fmt, umbrales: q('usuarios_por_sitio'), colores: verdeRojo, extremos: ['Pocos', 'Muchos'],
        desc: 'Usuarios atendidos por cada radiobase del municipio, para comparar con lo que cada sitio puede soportar.',
        req: ['Sectores', 'Tecnologías utilizadas', 'Capacidad del enlace'], extra: ['Usuarios por radiobase'] },
      { id: 'uso_prom_usuario_kbps', nombre: 'Uso promedio por usuario', unidad: 'kbps', fmt: (v) => `${fmt1(v)} kbps`, umbrales: q('uso_prom_usuario_kbps'), colores: rojoVerde, extremos: ['Poco ancho de banda', 'Mucho'],
        desc: 'Ancho de banda promedio que recibe cada usuario: tráfico promedio dividido entre usuarios atendidos.',
        req: ['Tráfico cursado (prom/pico)', 'Capacidad del enlace'], extra: ['Usuarios por radiobase'] },
      { id: 'latencia_mediana_ms', nombre: 'Latencia', unidad: 'ms', fmt: (v) => `${fmt(v)} ms`, umbrales: [30, 45, 70, 150], colores: verdeRojo, extremos: ['Rápida', 'Lenta'],
        desc: 'Tiempo de respuesta mediano de la red. Sube con enlaces satelitales y con sitios congestionados.',
        req: ['Ubicación exacta de cada radiobase', 'Capacidad del enlace'], extra: ['Mediciones de latencia'] },
      { id: 'fallas_sesion_datos', nombre: 'Sesiones de datos cortadas', unidad: 'por 1,000', fmt: (v) => `${fmt1(v)} por 1,000`, umbrales: q('fallas_sesion_datos'), colores: verdeRojo, extremos: ['Pocas fallas', 'Muchas'],
        desc: 'Sesiones de datos interrumpidas por cada 1,000. En la ficha también se ven caídas de llamada y horas fuera de servicio.',
        req: ['Ubicación exacta de cada radiobase'], extra: ['Registro de fallas o indicadores de red'] },
      { id: 'gb_usuario_mes', nombre: 'Consumo por usuario', unidad: 'GB/mes', fmt: (v) => `${fmt1(v)} GB/mes`, umbrales: q('gb_usuario_mes'), colores: ['#24163f', '#4b2a7b', '#7c4bb8', '#a985e0', '#dcc9ff'], extremos: ['Bajo', 'Alto'],
        desc: 'Datos consumidos al mes por usuario, según la mezcla de perfiles (teléfono básico, smartphone, módem).',
        req: ['Tráfico cursado (prom/pico)', 'Tecnologías utilizadas'], extra: ['Tipo de dispositivo o plan'] },
      { id: 'tecnologia_4g_pct', nombre: 'Radiobases con 4G', unidad: '%', fmt: (v) => `${fmt1(v)} %`, umbrales: [20, 40, 60, 80], colores: rojoVerde, extremos: ['Poco 4G', 'Mucho 4G'],
        desc: 'Porcentaje de radiobases del municipio que tienen 4G activo.',
        req: ['Tecnologías utilizadas', 'Bandas utilizadas'], extra: [] },
      { id: 'posibles_duplicados', nombre: 'Posibles duplicados', unidad: 'radiobases', fmt: fmt, categorias: [[0, 'Ninguno', '#2f9e6e'], [1, '1 o 2', '#e9c35a'], [3, '3 o más', '#e2434f']],
        desc: 'Radiobases del mismo operador reportadas a menos de 80 m de otra: candidatas a registro duplicado.',
        req: ['Ubicación exacta de cada radiobase', 'Sectores'], extra: [] },
    ];
    E.metrica = METRICAS[0];
  }
  const colorDe = (m, v) => {
    if (v === null || v === undefined) return 'url(#phatch)';
    if (m.categorias) return v >= 3 ? m.categorias[2][2] : v >= 1 ? m.categorias[1][2] : m.categorias[0][2];
    return d3.scaleThreshold(m.umbrales, m.colores)(v);
  };
  const colorOcup = (v) => (v >= 85 ? '#e2434f' : v >= 50 ? '#e9c35a' : '#2f9e6e');
  const reqPills = (cont, req, extra, etiqueta = 'Requiere:') => {
    cont.replaceChildren(el('span', 'lbl', etiqueta));
    req.forEach((x) => cont.append(el('em', null, x)));
    extra.forEach((x) => { const e = el('em', 'extra', `+ ${x}`); e.title = 'Dato adicional, fuera de la lista de métricas propuestas'; cont.append(e); });
  };

  // ---------------- mapa ----------------
  let svg, gZoom, munisSel, zoom, proj, path, W = 0, H = 0, tAct = d3.zoomIdentity, pxM = 0;
  let cvCalor, cxCalor, off, cxOff, cvSit, cxSit, sprite, baseObs = [], baseSim = [];
  const cont = () => document.getElementById('pmap');

  function construirMapa() {
    const c = cont();
    svg = d3.select(c).append('svg');
    const pat = svg.append('defs').append('pattern').attr('id', 'phatch').attr('patternUnits', 'userSpaceOnUse').attr('width', 5).attr('height', 5).attr('patternTransform', 'rotate(45)');
    pat.append('rect').attr('width', 5).attr('height', 5).attr('fill', '#1b2537');
    pat.append('line').attr('x2', 0).attr('y2', 5).attr('stroke', '#2f3d5a').attr('stroke-width', 2);
    gZoom = svg.append('g');
    const tierra = D.geo.features.filter((f) => !f.properties.lake);
    proj = d3.geoMercator(); path = d3.geoPath(proj);
    munisSel = gZoom.append('g').selectAll('path').data(tierra).join('path').attr('class', 'muni');
    gZoom.append('g').selectAll('path').data(D.geo.features.filter((f) => f.properties.lake)).join('path').attr('class', 'lake');
    gZoom.append('path').attr('class', 'dept-borders').datum({ type: 'FeatureCollection', features: D.bordesGeo.features.filter((f) => f.properties.tipo === 'departamento') });
    gZoom.append('path').attr('class', 'country').datum(D.bordesGeo.features.find((f) => f.properties.tipo === 'pais'));
    cvCalor = d3.select(c).append('canvas').attr('class', 'puntos-calor').node(); cxCalor = cvCalor.getContext('2d');
    cvSit = d3.select(c).append('canvas').attr('class', 'puntos').node(); cxSit = cvSit.getContext('2d');
    off = document.createElement('canvas'); cxOff = off.getContext('2d', { willReadFrequently: true });
    sprite = document.createElement('canvas'); sprite.width = sprite.height = 64;
    const sg = sprite.getContext('2d'); const gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64);

    zoom = d3.zoom().scaleExtent([1, 40]).on('zoom', (ev) => { tAct = ev.transform; gZoom.attr('transform', ev.transform); pedirDibujo(); });
    svg.call(zoom).on('dblclick.zoom', null);

    const tip = document.getElementById('ptip');
    munisSel.on('mousemove', (ev, f) => {
      const m = D.munis[f.properties.id]; if (!m) return;
      const v = m[E.metrica.id];
      tip.replaceChildren(el('b', null, m.municipio), el('small', null, `${m.departamento} · ${m.tipo_zona}`), el('div', 'v', v === null || v === undefined ? 'sin dato' : E.metrica.fmt(v)),
        el('small', null, `${E.metrica.nombre} · simulado`), el('div', null, `${fmt(m.sitios)} radiobases simuladas`));
      tip.hidden = false;
      const r = c.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top;
      tip.style.left = `${Math.min(x + 16, W - tip.offsetWidth - 8)}px`; tip.style.top = `${Math.min(y + 16, H - tip.offsetHeight - 8)}px`;
    }).on('mouseleave', () => { tip.hidden = true; });
    svg.on('click', (ev) => {
      if (E.sitios) {
        const [mx, my] = d3.pointer(ev, c);
        let mejor = null, dmin = 49;
        D.sitios.forEach((s, i) => { const x = tAct.x + baseSim[i][0] * tAct.k, y = tAct.y + baseSim[i][1] * tAct.k; const d = (x - mx) ** 2 + (y - my) ** 2; if (d < dmin) { dmin = d; mejor = s; } });
        if (mejor) { fichaSitio(mejor); return; }
      }
      const f = ev.target.__data__;
      if (f && f.properties && D.munis[f.properties.id]) fichaMuni(f.properties.id);
    });
    window.addEventListener('resize', () => { if (E.vista === 'mapa' && !document.getElementById('vista-pmapa').hidden) encuadre(); });
  }

  function encuadre() {
    const c = cont(); if (!c.clientWidth) return;
    W = c.clientWidth; H = c.clientHeight;
    svg.attr('viewBox', `0 0 ${W} ${H}`);
    proj.fitExtent(window.SITMAP.extent(W, H, { izq: 370, der: 30, arr: 70, aba: 70 }), { type: 'FeatureCollection', features: D.geo.features.filter((f) => !f.properties.lake) });
    gZoom.selectAll('path').attr('d', path);
    const dpr = window.devicePixelRatio || 1;
    [cvCalor, cvSit].forEach((cv) => { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`; });
    off.width = W; off.height = H;
    baseObs = D.celdas.map((x) => proj([x[0], x[1]]));
    baseSim = D.sitios.map((s) => proj([s.lon, s.lat]));
    pxM = Math.abs(proj([-90.5, 15])[1] - proj([-90.5, 15.009])[1]) / 1000;
    pintarMapa(); pedirDibujo();
  }

  let pendiente = false;
  function pedirDibujo() { if (pendiente) return; pendiente = true; requestAnimationFrame(() => { pendiente = false; dibujarCalor(); dibujarSitios(); }); }

  const LUT = (() => {
    const cols = ['#1d1347', '#5b1f7a', '#a8306b', '#e2583e', '#f6a635', '#fbe87d'].map((c) => d3.rgb(c));
    const sc = d3.scaleLinear(d3.range(cols.length).map((i) => i / (cols.length - 1)), cols).interpolate(d3.interpolateRgb);
    return d3.range(256).map((i) => d3.rgb(sc(i / 255)));
  })();
  function dibujarCalor() {
    const dpr = window.devicePixelRatio || 1;
    cxCalor.setTransform(1, 0, 0, 1, 0, 0); cxCalor.clearRect(0, 0, cvCalor.width, cvCalor.height);
    if (!E.calor || !W) return;
    cxOff.globalCompositeOperation = 'source-over'; cxOff.clearRect(0, 0, W, H);
    cxOff.globalCompositeOperation = 'lighter';
    const t = tAct, k = t.k, dep = document.getElementById('depto').value;
    const obs = E.calorModo === 'obs';
    const n = obs ? D.celdas.length : D.sitios.length;
    const base = obs ? baseObs : baseSim;
    cxOff.globalAlpha = obs ? 0.09 : 0.11;
    for (let i = 0; i < n; i++) {
      const x = t.x + base[i][0] * k, y = t.y + base[i][1] * k;
      const metros = obs ? Math.max(400, D.celdas[i][4]) : D.sitios[i].radio_cobertura_m;
      const r = Math.max(3, metros * pxM * k * 1.3);
      if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue;
      if (dep) { const cod = obs ? D.celdas[i][7] : D.sitios[i].cod; if (cod.slice(0, 4) !== dep) continue; }
      cxOff.drawImage(sprite, x - r, y - r, 2 * r, 2 * r);
    }
    const img = cxOff.getImageData(0, 0, W, H); const d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      const a = d[p + 3];
      if (!a) continue;
      const c = LUT[Math.min(255, a)];
      d[p] = c.r; d[p + 1] = c.g; d[p + 2] = c.b; d[p + 3] = Math.min(235, 40 + a * 1.4);
    }
    cxOff.putImageData(img, 0, 0);
    cxCalor.setTransform(dpr, 0, 0, dpr, 0, 0);
    cxCalor.drawImage(off, 0, 0, W, H);
  }
  function dibujarSitios() {
    const dpr = window.devicePixelRatio || 1;
    cxSit.setTransform(dpr, 0, 0, dpr, 0, 0); cxSit.clearRect(0, 0, W, H);
    if (!E.sitios || !W) return;
    const t = tAct, k = t.k, dep = document.getElementById('depto').value;
    const rad = Math.min(4, 1.4 + k * 0.15);
    D.sitios.forEach((s, i) => {
      const x = t.x + baseSim[i][0] * k, y = t.y + baseSim[i][1] * k;
      if (x < -5 || y < -5 || x > W + 5 || y > H + 5) return;
      cxSit.globalAlpha = dep && s.cod.slice(0, 4) !== dep ? 0.15 : 0.9;
      cxSit.fillStyle = colorOcup(s.ocupacion_pico_pct);
      cxSit.beginPath(); cxSit.arc(x, y, rad, 0, 6.2832); cxSit.fill();
      if (s.duplicado_de && k >= 4) { cxSit.strokeStyle = '#fff'; cxSit.lineWidth = 1.2; cxSit.beginPath(); cxSit.arc(x, y, rad + 2.5, 0, 6.2832); cxSit.stroke(); }
      if (!s.posicion_real && k >= 4) { cxSit.strokeStyle = '#94a3b8'; cxSit.lineWidth = 1; cxSit.setLineDash([2, 2]); cxSit.beginPath(); cxSit.arc(x, y, rad + 1.5, 0, 6.2832); cxSit.stroke(); cxSit.setLineDash([]); }
      if (E.sel && E.sel.tipo === 'sitio' && E.sel.id === s.id) { cxSit.globalAlpha = 1; cxSit.strokeStyle = '#f2b84b'; cxSit.lineWidth = 2.5; cxSit.beginPath(); cxSit.arc(x, y, rad + 5, 0, 6.2832); cxSit.stroke(); }
    });
    cxSit.globalAlpha = 1;
  }

  function pintarMapa() {
    const m = E.metrica, dep = document.getElementById('depto').value;
    munisSel
      .attr('fill', (f) => { const x = D.munis[f.properties.id]; return colorDe(m, x ? x[m.id] : null); })
      .classed('dim', (f) => dep && f.properties.id.slice(0, 4) !== dep)
      .classed('sel', (f) => E.sel && E.sel.tipo === 'muni' && E.sel.id === f.properties.id);
    document.querySelectorAll('#pmetrics .metric').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === m.id)));
    document.getElementById('pmetric-desc').textContent = m.desc;
    reqPills(document.getElementById('pmetric-req'), m.req, m.extra);
    const lg = document.getElementById('plegend');
    lg.replaceChildren(el('span', 'label', `${m.nombre} · simulado`));
    if (m.categorias) {
      const c = el('div', 'cats');
      m.categorias.forEach(([, n, col]) => { const d = el('div', 'cat'); const i = el('i'); i.style.background = col; d.append(i, document.createTextNode(n)); c.append(d); });
      lg.append(c);
    } else {
      const r = el('div', 'ramp'); m.colores.forEach((col) => { const s = el('span'); s.style.background = col; r.append(s); });
      const fx = m.unidad === '%' || m.unidad === 'ms' ? fmt : (v) => (v >= 100 ? fmt(Math.round(v)) : fmt1(v));
      const sc = el('div', 'scale'); sc.append(...['', ...m.umbrales.map((u) => fx(u)), ''].map((v) => el('span', null, v)));
      const ex = el('div', 'ends'); m.extremos.forEach((x) => ex.append(el('span', null, x)));
      lg.append(r, sc, ex);
    }
    const obs = E.calorModo === 'obs';
    document.getElementById('pcalor-nota').textContent = obs
      ? `Real: ${fmt(D.celMeta.celdas)} celdas observadas por teléfonos (OpenCelliD) con su alcance estimado. Concentrado en ciudades; donde no hay color puede haber servicio sin medir.`
      : `Simulado: ${fmt(D.sitios.length)} radiobases con un área de cobertura declarada inventada. Así se vería si cada operador reportara el área de cobertura de sus sitios.`;
    pedirDibujo();
  }

  function controlesMapa() {
    const c = document.getElementById('pmetrics');
    METRICAS.forEach((m) => {
      const b = el('button', 'metric'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.id = m.id;
      const sw = el('span', 'sw'); sw.style.background = `linear-gradient(90deg, ${(m.colores || m.categorias.map((x) => x[2])).join(',')})`;
      b.append(sw, el('span', 't', m.nombre)); b.onclick = () => { E.metrica = m; pintarMapa(); }; c.append(b);
    });
    const chC = document.getElementById('pcapa-calor');
    chC.onchange = () => { E.calor = chC.checked; document.getElementById('pcalor-opts').hidden = !chC.checked; pedirDibujo(); };
    document.querySelectorAll('[data-calor]').forEach((b) => { b.onclick = () => { E.calorModo = b.dataset.calor; document.querySelectorAll('[data-calor]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); pintarMapa(); }; });
    const chS = document.getElementById('pcapa-sitios');
    document.getElementById('psitios-n').textContent = `(${fmt(D.sitios.length)})`;
    chS.onchange = () => { E.sitios = chS.checked; document.getElementById('psitios-opts').hidden = !chS.checked; pedirDibujo(); };
    const n85 = D.sitios.filter((s) => s.ocupacion_pico_pct >= 85).length, n50 = D.sitios.filter((s) => s.ocupacion_pico_pct >= 50 && s.ocupacion_pico_pct < 85).length;
    document.getElementById('psitios-leyenda').replaceChildren(...[
      ['#2f9e6e', 'Ocupación pico menor a 50 %', D.sitios.length - n85 - n50], ['#e9c35a', '50 a 85 %', n50], ['#e2434f', '85 % o más (saturada)', n85],
    ].map(([col, t, n]) => { const d = el('div', 'cat'); const i = el('i'); i.style.background = col; i.style.width = i.style.height = '10px'; d.append(i, document.createTextNode(t), el('b', null, fmt(n))); return d; }),
    (() => { const d = el('div', 'cat'); const i = el('i'); i.style.border = '1.5px solid #fff'; i.style.width = i.style.height = '10px'; d.append(i, document.createTextNode('Posible duplicado (anillo blanco, al acercarse)')); return d; })(),
    (() => { const d = el('div', 'cat'); const i = el('i'); i.style.border = '1.5px dashed #94a3b8'; i.style.width = i.style.height = '10px'; d.append(i, document.createTextNode('Posición simulada (borde punteado)')); return d; })());
    document.getElementById('depto').addEventListener('change', () => { if (!estaVisible()) return; if (E.vista === 'mapa') { zoomDepto(); pintarMapa(); } else tablero(); });
  }
  function zoomDepto() {
    const dep = document.getElementById('depto').value;
    if (!dep) { svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity); return; }
    const fc = { type: 'FeatureCollection', features: D.geo.features.filter((f) => !f.properties.lake && f.properties.id.slice(0, 4) === dep) };
    const [[x0, y0], [x1, y1]] = path.bounds(fc);
    const k = Math.min(30, 0.75 / Math.max((x1 - x0) / W, (y1 - y0) / H));
    svg.transition().duration(reducido() ? 0 : 750).call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
  }

  // ---------------- fichas ----------------
  const facts = (pares) => pares.map(([t, v]) => { const d = el('div'); d.append(el('dt', null, t), el('dd', null, v)); return d; });
  function abrirFicha() { document.getElementById('pdetail').hidden = false; }
  function fichaMuni(cod) {
    const m = D.munis[cod]; if (!m) return;
    E.sel = { tipo: 'muni', id: cod };
    document.getElementById('pd-sub').textContent = `${m.departamento} · zona ${m.tipo_zona}`;
    document.getElementById('pd-nombre').textContent = m.municipio;
    document.getElementById('pd-facts').replaceChildren(...facts([
      ['Radiobases', `${fmt(m.sitios)} (${fmt(m.sitios_posicion_real)} con posición real)`],
      ['Usuarios soportados', fmt(m.usuarios_soportados)], ['Usuarios atendidos', fmt(m.usuarios_atendidos)],
      ['Ocupación pico', `${fmt1(m.ocupacion_pico_pct)} %`], ['Radiobases saturadas', fmt(m.sitios_saturados)],
      ['Uso por usuario', `${fmt1(m.uso_prom_usuario_kbps)} kbps`], ['Latencia mediana', `${fmt(m.latencia_mediana_ms)} ms`],
      ['Caídas de llamada', `${fmt1(m.fallas_caida_llamada)} por 1,000`], ['Sesiones cortadas', `${fmt1(m.fallas_sesion_datos)} por 1,000`],
      ['Fuera de servicio', `${fmt1(m.fallas_fuera_servicio_h)} h/mes por sitio`], ['Con 4G', `${fmt1(m.tecnologia_4g_pct)} %`],
      ['Consumo por usuario', `${fmt1(m.gb_usuario_mes)} GB/mes`], ['Posibles duplicados', fmt(m.posibles_duplicados)],
    ]));
    const ex = document.getElementById('pd-extra'); ex.replaceChildren();
    const sec = el('div', 'pd-sec'); sec.append(el('span', 'label', 'Perfil de consumo por dispositivo'));
    const bars = el('div', 'bars');
    m.perfil_consumo.forEach((p) => {
      const d = el('div', 'bar'); const tr = el('span', 'track'); const f = el('span', 'fill'); f.style.display = 'block'; f.style.width = `${p.participacion_pct}%`; f.style.background = '#a985e0'; tr.append(f);
      d.append(el('span', null, p.perfil), tr, el('b', null, `${fmt1(p.participacion_pct)} % · ${fmt1(p.gb_mes)} GB`)); bars.append(d);
    });
    sec.append(bars); ex.append(sec);
    abrirFicha(); pintarMapa(); if (E.vista === 'tablero') tablaMunis();
  }
  function fichaSitio(s) {
    E.sel = { tipo: 'sitio', id: s.id };
    const m = D.munis[s.cod];
    const op = D.celMeta.mnc[s.mnc] || `red ${s.mnc}`;
    document.getElementById('pd-sub').textContent = `${m ? m.municipio : s.cod} · ${op}`;
    document.getElementById('pd-nombre').textContent = `Radiobase ${s.id}`;
    document.getElementById('pd-facts').replaceChildren(...facts([
      ['Posición', s.posicion_real ? 'Real (OpenCelliD, estimada)' : 'Simulada'], ['Tecnologías', s.tec.replaceAll('/', ', ')],
      ['Sectores', String(s.sectores)], ['Bandas', s.bandas], ['Enlace', `${s.enlace_tipo} · ${fmt(s.enlace_mbps)} Mbps`],
      ['Capacidad máxima', `${fmt1(s.capacidad_max_mbps)} Mbps`], ['Usuarios soportados', fmt(s.usuarios_soportados)], ['Usuarios atendidos', fmt(s.usuarios_atendidos)],
      ['Tráfico promedio', `${fmt1(s.trafico_prom_mbps)} Mbps`], ['Tráfico pico', `${fmt1(s.trafico_pico_mbps)} Mbps`],
      ['Ocupación pico', `${fmt1(s.ocupacion_pico_pct)} %`], ['Uso por usuario', `${fmt1(s.uso_prom_usuario_kbps)} kbps`],
      ['Latencia', `${fmt(s.latencia_ms)} ms`], ['Radio de cobertura', `${fmt(s.radio_cobertura_m)} m`],
      ['Caídas de llamada', `${fmt1(s.caida_llamada)} por 1,000`], ['Sesiones cortadas', `${fmt1(s.sesion_datos_interrumpida)} por 1,000`],
      ['Fuera de servicio', `${fmt1(s.fuera_servicio_h_mes)} h/mes`], ['Posible duplicado de', s.duplicado_de || 'no'],
    ]));
    const ex = document.getElementById('pd-extra'); ex.replaceChildren();
    if (m) { const b = el('button', 'link-btn', `Ver resumen de ${m.municipio} →`); b.type = 'button'; b.onclick = () => fichaMuni(s.cod); ex.append(b); }
    abrirFicha(); pedirDibujo();
  }
  document.getElementById('pclose').onclick = () => { E.sel = null; document.getElementById('pdetail').hidden = true; if (D) { pintarMapa(); if (E.vista === 'tablero') tablaMunis(); } };

  // ---------------- tablero ----------------
  function barrasH(cont2, items, opts = {}) {
    cont2.replaceChildren();
    const w = Math.max(300, cont2.clientWidth), fila = opts.fila || 24, mg = { l: opts.ml || 150, r: 70, t: 6 };
    const h = mg.t + items.length * fila + (opts.ref !== undefined ? 14 : 0);
    const max = opts.max ?? d3.max(items, (d) => d.v) ?? 1;
    const x = d3.scaleLinear([0, max || 1], [mg.l, w - mg.r]);
    const s = d3.select(cont2).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', opts.aria || 'gráfico simulado');
    const g = s.selectAll('g.b').data(items).join('g').attr('class', 'b').attr('transform', (d, i) => `translate(0,${mg.t + i * fila})`);
    g.append('text').attr('x', mg.l - 8).attr('y', fila / 2 + 4).attr('text-anchor', 'end').text((d) => d.n);
    g.append('rect').attr('x', mg.l).attr('y', fila / 2 - 7).attr('height', 14).attr('rx', 3).attr('width', (d) => Math.max(1, x(d.v) - mg.l)).attr('fill', (d) => d.c || '#4fb0cf');
    g.append('text').attr('class', 'num-l').attr('x', (d) => x(d.v) + 6).attr('y', fila / 2 + 4).text((d) => (opts.fmt || fmt)(d.v));
    if (opts.ref !== undefined) {
      s.append('line').attr('class', 'ref').attr('x1', x(opts.ref)).attr('x2', x(opts.ref)).attr('y1', 0).attr('y2', h - 12);
      s.append('text').attr('x', x(opts.ref)).attr('y', h - 1).attr('text-anchor', 'middle').text(opts.refTxt || '');
    }
  }
  function histograma(cont2, valores, bins, colorF, etiqueta) {
    cont2.replaceChildren();
    const w = Math.max(300, cont2.clientWidth), h = 170, mg = { l: 40, r: 10, t: 16, b: 24 };
    const hb = d3.bin().domain([0, 100]).thresholds(bins)(valores);
    const x = d3.scaleLinear([0, 100], [mg.l, w - mg.r]);
    const y = d3.scaleLinear([0, d3.max(hb, (b) => b.length)], [h - mg.b, mg.t]).nice();
    const s = d3.select(cont2).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', etiqueta);
    s.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(3)).join('line').attr('x1', mg.l).attr('x2', w - mg.r).attr('y1', y).attr('y2', y);
    s.append('g').selectAll('text').data(y.ticks(3).filter((v) => v > 0)).join('text').attr('x', mg.l - 6).attr('y', (v) => y(v) + 4).attr('text-anchor', 'end').text(d3.format('~s'));
    s.append('g').selectAll('rect').data(hb).join('rect').attr('x', (b) => x(b.x0) + 1).attr('width', (b) => Math.max(1, x(b.x1) - x(b.x0) - 2)).attr('y', (b) => y(b.length)).attr('height', (b) => y(0) - y(b.length)).attr('rx', 2).attr('fill', (b) => colorF(b.x0))
      .append('title').text((b) => `${b.x0}–${b.x1} %: ${fmt(b.length)} radiobases`);
    s.append('g').selectAll('text').data(d3.range(0, 101, 20)).join('text').attr('x', (v) => x(v)).attr('y', h - 6).attr('text-anchor', 'middle').text((v) => `${v} %`);
  }

  function tarjeta(titulo, pregunta, req, extra) {
    const c = el('section', 'pt-card'); c.append(el('h3', null, titulo), el('p', 'preg', pregunta));
    const ch = el('div', 'pt-chart'); const hz = el('p', 'hallazgo'); const r = el('div', 'req'); reqPills(r, req, extra, 'Datos que requiere:');
    c.append(ch, hz, r); document.getElementById('pt-analisis').append(c);
    return { ch, hz };
  }
  const hallazgo = (hz, partes) => { hz.replaceChildren(...partes.map((p) => (Array.isArray(p) ? el('b', null, p[0]) : document.createTextNode(p)))); };

  function tablero() {
    const dep = document.getElementById('depto').value;
    const S = dep ? D.sitios.filter((s) => s.cod.slice(0, 4) === dep) : D.sitios;
    const L = dep ? D.lista.filter((m) => m.codigo_ine.slice(0, 4) === dep) : D.lista;
    const ambito = dep ? (L[0] ? L[0].departamento : '') : 'el país';
    const sat = S.filter((s) => s.ocupacion_pico_pct >= 85).length;
    const kp = [
      [fmt(S.length), `radiobases simuladas en ${ambito}`, `${fmt(S.filter((s) => s.posicion_real).length)} con posición real de OpenCelliD`],
      [fmt(d3.sum(S, (s) => s.usuarios_soportados)), 'usuarios que podrían soportar', null],
      [`${fmt1(d3.median(S, (s) => s.ocupacion_pico_pct))} %`, 'ocupación mediana en hora pico', null],
      [fmt(sat), 'radiobases saturadas (85 % o más)', `${fmt1(sat / Math.max(1, S.length) * 100)} % del total`],
      [`${fmt(d3.median(S, (s) => s.latencia_ms))} ms`, 'latencia mediana', null],
      [fmt(S.filter((s) => s.duplicado_de).length), 'posibles registros duplicados', null],
    ];
    document.getElementById('pt-kpis').replaceChildren(...kp.map(([v, t, n]) => { const k = el('div', 't-kpi'); k.append(el('b', null, v), el('span', null, t)); if (n) k.append(el('span', 'delta', n)); k.append(el('span', 'simtag', 'simulado')); return k; }));

    const cont2 = document.getElementById('pt-analisis'); cont2.replaceChildren();
    const porDep = d3.groups(L, (m) => m.departamento);

    // 1. Usuarios soportados por radiobase
    let t = tarjeta('Cantidad de usuarios soportados por cada radiobase', '¿Dónde hay más usuarios que los que las radiobases pueden atender?', ['Capacidad del enlace', 'Sectores', 'Bandas utilizadas', 'Tecnologías utilizadas'], ['Usuarios por radiobase']);
    const conc = D.meta.supuestos.concurrencia_pico;
    const carga = porDep.map(([n, ms]) => ({ n, v: d3.sum(ms, (m) => m.usuarios_atendidos * conc) / Math.max(1, d3.sum(ms, (m) => m.usuarios_soportados)) * 100 })).sort((a, b) => b.v - a.v).slice(0, 12);
    carga.forEach((d) => { d.c = d.v >= 100 ? '#e2434f' : d.v >= 70 ? '#e9c35a' : '#2f9e6e'; });
    barrasH(t.ch, carga, { fmt: (v) => `${fmt(Math.round(v))} %`, ref: 100, refTxt: 'capacidad', max: Math.max(110, d3.max(carga, (d) => d.v)), aria: 'Usuarios simultáneos en hora pico como porcentaje de los soportados, por departamento' });
    const sobre = L.filter((m) => m.usuarios_atendidos * conc > m.usuarios_soportados).length;
    const sitiosSobre = S.filter((s) => s.usuarios_atendidos * conc > s.usuarios_soportados).length;
    hallazgo(t.hz, ['En hora pico, ', [fmt(sitiosSobre)], ' radiobases tendrían más usuarios conectados a la vez de los que soportan; en ', [fmt(sobre)], ` de ${fmt(L.length)} municipios pasa con el total de sus radiobases. Barras: usuarios simultáneos como % de los soportados (12 departamentos más cargados).`]);

    // 2. Capacidad máxima de tráfico
    t = tarjeta('Capacidad máxima de tráfico por radiobase', '¿Qué radiobases llegan a su techo de tráfico en la hora pico?', ['Capacidad del enlace', 'Bandas utilizadas', 'Sectores', 'Tecnologías utilizadas'], []);
    histograma(t.ch, S.map((s) => s.ocupacion_pico_pct), 10, (x0) => colorOcup(x0 + 5), 'Distribución de la ocupación en hora pico');
    const satSin4g = S.filter((s) => s.ocupacion_pico_pct >= 85 && !s.tec.includes('4G')).length;
    hallazgo(t.hz, [[`${fmt1(sat / Math.max(1, S.length) * 100)} %`], ' de las radiobases trabajaría al 85 % o más de su capacidad en hora pico; ', [`${fmt1(satSin4g / Math.max(1, sat) * 100)} %`], ' de esas no tiene 4G.']);

    // 3. Uso promedio por usuario
    t = tarjeta('Capacidad promedio de uso por usuario', '¿Cuánto ancho de banda usa en promedio cada usuario registrado a lo largo del día, según la zona?', ['Tráfico cursado (prom/pico)', 'Capacidad del enlace'], ['Usuarios por radiobase']);
    const zonas = ['urbano', 'intermedio', 'rural'];
    const usoZ = zonas.map((z) => ({ n: z[0].toUpperCase() + z.slice(1), v: d3.median(S.filter((s) => (D.munis[s.cod] || {}).tipo_zona === z), (s) => s.uso_prom_usuario_kbps) || 0, c: '#4fb0cf' }));
    barrasH(t.ch, usoZ, { fmt: (v) => `${fmt1(v)} kbps`, ml: 100, aria: 'Uso mediano por usuario según tipo de zona' });
    hallazgo(t.hz, ['Promedio de todo el día por usuario registrado (incluye ratos sin uso): ', [`${fmt1(usoZ[2].v)} kbps`], ' en zonas rurales frente a ', [`${fmt1(usoZ[0].v)} kbps`], ' en urbanas.']);

    // 4. Tipos de fallas
    t = tarjeta('Tipos de fallas en la conexión', '¿Qué falla más y dónde?', ['Ubicación exacta de cada radiobase'], ['Registro de fallas o indicadores de red']);
    const fz = zonas.flatMap((z) => {
      const ss = S.filter((s) => (D.munis[s.cod] || {}).tipo_zona === z);
      const nom = z[0].toUpperCase() + z.slice(1);
      return [{ n: `${nom} · llamadas caídas`, v: d3.mean(ss, (s) => s.caida_llamada) || 0, c: '#ec8a45' }, { n: `${nom} · sesiones cortadas`, v: d3.mean(ss, (s) => s.sesion_datos_interrumpida) || 0, c: '#e2434f' }];
    });
    barrasH(t.ch, fz, { fmt: (v) => `${fmt1(v)} /1,000`, ml: 190, fila: 22, aria: 'Fallas por cada 1,000 llamadas o sesiones, según zona' });
    const fsH = d3.mean(S, (s) => s.fuera_servicio_h_mes);
    hallazgo(t.hz, ['Las sesiones de datos cortadas superarían a las llamadas caídas en todas las zonas; cada radiobase estaría en promedio ', [`${fmt1(fsH)} horas al mes`], ' fuera de servicio.']);

    // 5. Perfil de consumo
    t = tarjeta('Consumo de datos por dispositivo (perfil de usuarios)', '¿Quién consume los datos y cuánto?', ['Tráfico cursado (prom/pico)', 'Tecnologías utilizadas'], ['Tipo de dispositivo o plan']);
    const perf = ['Teléfono básico', 'Smartphone', 'Módem o router móvil'].map((p, i) => {
      const w = d3.sum(L, (m) => m.usuarios_atendidos);
      const part = d3.sum(L, (m) => m.usuarios_atendidos * m.perfil_consumo[i].participacion_pct) / Math.max(1, w);
      const gb = d3.sum(L, (m) => m.usuarios_atendidos * m.perfil_consumo[i].gb_mes) / Math.max(1, w);
      return { p, part, gb };
    });
    const tot = d3.sum(perf, (x) => x.part * x.gb);
    barrasH(t.ch, perf.map((x) => ({ n: `${x.p} (${fmt1(x.part)} % usuarios)`, v: (x.part * x.gb) / tot * 100, c: '#a985e0' })), { fmt: (v) => `${fmt1(v)} % del tráfico`, ml: 230, aria: 'Participación de cada perfil en el tráfico de datos' });
    hallazgo(t.hz, ['Los módems serían ', [`${fmt1(perf[2].part)} %`], ' de los usuarios pero ', [`${fmt1(perf[2].part * perf[2].gb / tot * 100)} %`], ' del tráfico: consumen unos ', [`${fmt(Math.round(perf[2].gb))} GB/mes`], ' cada uno.']);

    // 6. Latencia
    t = tarjeta('Latencia', '¿Dónde responde más lento la red?', ['Ubicación exacta de cada radiobase', 'Capacidad del enlace'], ['Mediciones de latencia']);
    const lat = ['Fibra', 'Microondas', 'Satelital'].map((e) => ({ n: e, v: d3.median(S.filter((s) => s.enlace_tipo === e), (s) => s.latencia_ms) || 0, cnt: S.filter((s) => s.enlace_tipo === e).length }))
      .filter((d) => d.cnt);
    lat.forEach((d) => { d.c = d.v >= 150 ? '#e2434f' : d.v >= 45 ? '#e9c35a' : '#2f9e6e'; d.n = `${d.n} (${fmt(d.cnt)})`; });
    barrasH(t.ch, lat, { fmt: (v) => `${fmt(v)} ms`, ml: 140, aria: 'Latencia mediana por tipo de enlace' });
    const satel = S.filter((s) => s.enlace_tipo === 'Satelital');
    const latFib = d3.median(S.filter((s) => s.enlace_tipo === 'Fibra'), (s) => s.latencia_ms) || 0;
    const latSat = d3.median(satel, (s) => s.latencia_ms) || 0;
    hallazgo(t.hz, satel.length && latFib
      ? [[fmt(satel.length)], ' radiobases con enlace satelital tendrían una latencia mediana de ', [`${fmt(latSat)} ms`], ', unas ', [`${fmt(Math.round(latSat / latFib))} veces`], ` la de fibra (${fmt(latFib)} ms).`]
      : ['No hay radiobases con enlace satelital en este ámbito.']);

    // 7. Duplicidad
    t = tarjeta('Identificar duplicidad en la data', '¿Hay radiobases reportadas dos veces o mal ubicadas?', ['Ubicación exacta de cada radiobase', 'Sectores'], []);
    const dups = S.filter((s) => s.duplicado_de).map((s) => {
      const o = D.porId.get(s.duplicado_de);
      const dist = o ? Math.hypot((s.lon - o.lon) * 111320 * Math.cos(s.lat * Math.PI / 180), (s.lat - o.lat) * 110570) : null;
      return { s, o, dist };
    }).sort((a, b) => a.dist - b.dist);
    const tb = el('table', 'mini-table');
    const th = el('thead'); const trh = el('tr'); ['Radiobase', 'Duplicado de', 'Municipio', 'Operador', 'Distancia'].forEach((x, i) => trh.append(el('th', i === 4 ? 'num' : '', x))); th.append(trh);
    const bd = el('tbody');
    dups.slice(0, 8).forEach(({ s, dist }) => {
      const tr = el('tr'); tr.style.cursor = 'pointer';
      tr.append(el('td', null, s.id), el('td', null, s.duplicado_de), el('td', null, (D.munis[s.cod] || {}).municipio || s.cod), el('td', null, D.celMeta.mnc[s.mnc] || s.mnc), el('td', 'num', dist === null ? '—' : `${fmt(Math.round(dist))} m`));
      tr.onclick = () => fichaSitio(s); bd.append(tr);
    });
    tb.append(th, bd); t.ch.append(tb);
    hallazgo(t.hz, [[fmt(dups.length)], ' radiobases quedarían marcadas para revisión por estar a menos de 80 m de otra del mismo operador.']);

    tablaMunis();
    const sup = D.meta.supuestos;
    const body = document.getElementById('pt-supuestos-body'); body.replaceChildren();
    const ul = el('ul', 'sup-list');
    ul.append(el('li', null, D.meta.aviso));
    const real = el('li'); real.append(el('b', null, 'Real: '), document.createTextNode(D.meta.real.join('; ') + '.')); ul.append(real);
    const sim = el('li'); sim.append(el('b', null, 'Simulado: '), document.createTextNode(D.meta.simulado.join('; ') + '.')); ul.append(sim);
    const su = el('li'); su.append(el('b', null, 'Supuestos: '), document.createTextNode(`capacidad por sector ${JSON.stringify(sup.capacidad_por_sector_mbps)} Mbps; usuarios por sector ${JSON.stringify(sup.usuarios_por_sector)}; ${sup.penetracion_movil} líneas móviles por habitante; ${sup.concurrencia_pico * 100} % de usuarios activos en hora pico a ${sup.mbps_por_usuario_pico} Mbps; duplicado si el mismo operador tiene otra radiobase a menos de ${sup.duplicado_si_mismo_operador_a_menos_de_m} m.`)); ul.append(su);
    const se = el('li'); se.append(el('b', null, 'Reproducible: '), document.createTextNode(`semilla ${D.meta.semilla}, generado ${D.meta.generado} con scripts/simular_proximamente.py.`)); ul.append(se);
    body.append(ul);
  }

  function tablaMunis() {
    const dep = document.getElementById('depto').value;
    let filas = D.lista.slice();
    if (dep) filas = filas.filter((m) => m.codigo_ine.slice(0, 4) === dep);
    if (E.filtro) filas = filas.filter((m) => sinTilde(m.municipio).includes(E.filtro) || sinTilde(m.departamento).includes(E.filtro));
    const [k, dir] = E.orden;
    filas.sort((a, b) => (dir === 'asc' ? d3.ascending : d3.descending)(a[k], b[k]));
    document.querySelectorAll('#pt-tabla th[data-sort]').forEach((th) => th.setAttribute('aria-sort', th.dataset.sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'));
    const tb = document.querySelector('#pt-tabla tbody');
    tb.replaceChildren(...filas.slice(0, E.filtro ? 400 : 60).map((m) => {
      const tr = el('tr'); tr.tabIndex = 0; if (E.sel && E.sel.tipo === 'muni' && E.sel.id === m.codigo_ine) tr.className = 'sel';
      const mun = el('td'); mun.append(document.createTextNode(m.municipio), el('small', null, `${m.departamento} · ${m.tipo_zona}`));
      const oc = el('td', 'num'); const w = el('span', 'idm'); const sw = el('i'); sw.style.background = colorOcup(m.ocupacion_pico_pct); w.append(sw, document.createTextNode(`${fmt1(m.ocupacion_pico_pct)} %`)); oc.append(w);
      tr.append(mun, el('td', 'num', fmt(m.sitios)), el('td', 'num', fmt(m.usuarios_por_sitio)), oc, el('td', 'num', `${fmt1(m.uso_prom_usuario_kbps)} kbps`),
        el('td', 'num', `${fmt(m.latencia_mediana_ms)} ms`), el('td', 'num', `${fmt1(m.fallas_sesion_datos)} /1,000`), el('td', 'num', `${fmt1(m.gb_usuario_mes)}`), el('td', 'num', fmt(m.posibles_duplicados)));
      tr.onclick = () => fichaMuni(m.codigo_ine); tr.onkeydown = (e) => { if (e.key === 'Enter') fichaMuni(m.codigo_ine); };
      return tr;
    }));
  }
  function controlesTablero() {
    document.querySelectorAll('#pt-tabla th[data-sort]').forEach((th) => {
      th.tabIndex = 0;
      const ord = () => { const k = th.dataset.sort; E.orden = [k, E.orden[0] === k && E.orden[1] === 'desc' ? 'asc' : 'desc']; tablaMunis(); };
      th.onclick = ord; th.onkeydown = (e) => { if (e.key === 'Enter') ord(); };
    });
    document.getElementById('pt-filtro').oninput = (e) => { E.filtro = sinTilde(e.target.value).trim(); tablaMunis(); };
    catalogo();
    document.getElementById('pir-metricas').onclick = () => {
      document.querySelectorAll('.panel-top [data-vista="tablero"]').forEach((b) => b.click());
      setTimeout(() => { const s = document.getElementById('pt-metricas'); if (s) s.scrollIntoView({ behavior: reducido() ? 'auto' : 'smooth', block: 'start' }); }, 60);
    };
    window.addEventListener('resize', () => { if (E.vista === 'tablero' && estaVisible()) tablero(); });
  }

  // ---------------- API para app.js ----------------
  const estaVisible = () => !document.getElementById('vista-pmapa').hidden || !document.getElementById('vista-ptablero').hidden;
  async function mostrar(vista) {
    E.vista = vista;
    const ld = document.getElementById('loading');
    if (!iniciado) {
      if (!window.__proximoInit) {
        window.__proximoInit = (async () => {
          ld.hidden = false; ld.textContent = 'Cargando datos simulados…';
          await cargar(); definirMetricas(); construirMapa(); controlesMapa(); controlesTablero(); iniciado = true;
          ld.hidden = true;
        })();
      }
      await window.__proximoInit;
      if (E.vista !== vista) return; // otra llamada más reciente ya eligió la vista
    }
    document.getElementById('vista-pmapa').hidden = vista !== 'mapa';
    document.getElementById('vista-ptablero').hidden = vista !== 'tablero';
    document.getElementById('pdetail').hidden = !E.sel;
    if (vista === 'mapa') encuadre(); else tablero();
  }
  function ocultar() {
    ['vista-pmapa', 'vista-ptablero', 'pdetail'].forEach((id) => { document.getElementById(id).hidden = true; });
  }
  window.Proximo = {
    mostrar: (v) => mostrar(v).catch((e) => { const l = document.getElementById('loading'); l.hidden = false; l.textContent = `No se pudieron cargar los datos simulados (${e.message}).`; console.error(e); }),
    ocultar,
  };
}());
