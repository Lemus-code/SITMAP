"""Extrae los datos de un Boletín Estadístico de Telefonía (SIT) a tablas limpias.

Uso:
    python scripts/extraer_boletin.py <boletin.pdf> [<boletin2.pdf> ...]

Por cada PDF escribe en datos/intermedio/:
    <periodo>_lineas_fijas.csv   municipio x operador (Anexo A)
    <periodo>_radiobases.csv     municipio (Anexo B)
    <periodo>_nacional.csv       tablas nacionales por operador (tablas 2-13)
    <periodo>_control.csv        totales de departamento declarados vs. suma de municipios

La extracción usa coordenadas de cada palabra (PyMuPDF), no el texto plano:
el texto plano desalinea nombres y cifras en los anexos.
"""
import csv
import re
import sys
import unicodedata
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "datos" / "intermedio"

# Palabra clave en el encabezado -> nombre corto del operador
OPERADORES = [
    ("Cablenet", "Cablenet"),
    ("Comunicaciones Celulares", "Comcel (Tigo)"),
    ("A-Tel", "A-Tel"),
    ("Telecomunicaciones de Guatemala", "Telgua (Claro)"),
    ("Teléfonos del Norte", "Teléfonos del Norte"),
    ("Claro Guatemala", "Claro Guatemala"),
    ("Empresa Guatemalteca", "Guatel"),
    ("GUATEL", "Guatel"),
    ("Liberty", "Liberty (Columbus)"),
    ("Columbus", "Liberty (Columbus)"),
    ("Telefónica", "Telefónica (Movistar)"),
    ("Telefonica", "Telefónica (Movistar)"),
    ("Unitel", "Unitel"),
    ("Navega", "Navega"),
    ("Telered", "Telered"),
    ("Americatel", "Americatel"),
]


# Para el encabezado del Anexo A (nombres partidos en varias líneas):
# (inicio de palabra normalizada, operador, palabra siguiente requerida o None)
PALABRA_OPERADOR = [
    ("cablenet", "Cablenet", None),
    ("comunicaciones", "Comcel (Tigo)", None),
    ("a tel", "A-Tel", None),
    ("telecomunicaciones", "Telgua (Claro)", "de"),
    ("telefonos", "Teléfonos del Norte", None),
    ("claro", "Claro Guatemala", None),
    ("empresa", "Guatel", None),
    ("guatel", "Guatel", None),
    ("liberty", "Liberty (Columbus)", None),
    ("columbus", "Liberty (Columbus)", None),
    ("telefonica", "Telefónica (Movistar)", None),
    ("unitel", "Unitel", None),
    ("navega", "Navega", None),
    ("telered", "Telered", None),
    ("americatel", "Americatel", None),
]


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def num(s):
    s = s.strip()
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?%?", s):      # formato 20.390.671 o 1.234,5
        s = s.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"-?\d+,\d{1,2}%?", s):                # formato 11,55 (coma decimal)
        s = s.replace(",", ".")
    s = s.replace(",", "").rstrip("%")
    try:
        return float(s)
    except ValueError:
        return None


def periodo_de(pdf_path, doc):
    nombre = pdf_path.name.lower()
    txt = (doc[0].get_text() + " " + doc[min(4, len(doc) - 1)].get_text()).lower()
    anio = re.findall(r"20[12]\d", nombre) or re.findall(r"20[12]\d", txt)
    if re.search(r"1er|primer", nombre):
        sem = "S1"
    elif re.search(r"2do|segundo", nombre):
        sem = "S2"
    else:
        sem = "S1" if re.search(r"1er|primer", txt) else "S2" if re.search(r"2do|segundo", txt) else "S?"
    return f"{anio[0]}{sem}" if anio else pdf_path.stem


def filas(page):
    """Agrupa palabras en filas por su centro vertical."""
    rows = []
    for w in sorted(page.get_text("words"), key=lambda w: ((w[1] + w[3]) / 2, w[0])):
        yc = (w[1] + w[3]) / 2
        if rows and abs(rows[-1]["y"] - yc) <= 1.2:
            rows[-1]["w"].append(w)
        else:
            rows.append({"y": yc, "w": [w]})
    return rows


def partir(row_words, x_max_nombre):
    nombre = [w for w in row_words if w[0] < x_max_nombre and num(w[4]) is None]
    valores = [w for w in row_words if num(w[4]) is not None and w[0] >= x_max_nombre - 5]
    return " ".join(w[4] for w in sorted(nombre, key=lambda w: w[0])).strip(), sorted(valores, key=lambda w: w[0])


def emparejar(rows, x_max_nombre, tol=3.5):
    """Devuelve [(nombre, [valores con x])] emparejando filas de nombre con filas de cifras cercanas."""
    nombres, cifras = [], []
    for r in rows:
        n, v = partir(r["w"], x_max_nombre)
        if n:
            nombres.append({"y": r["y"], "n": n, "v": v})
        elif v:
            cifras.append({"y": r["y"], "v": v, "usada": False})
    out = []
    for n in nombres:
        vals = n["v"]
        if not vals:
            cand = [c for c in cifras if not c["usada"] and abs(c["y"] - n["y"]) <= tol]
            if cand:
                c = min(cand, key=lambda c: abs(c["y"] - n["y"]))
                c["usada"] = True
                vals = c["v"]
        out.append((n["n"], vals))
    huerfanas = [c for c in cifras if not c["usada"]]
    return out, huerfanas


def es_departamento(nombre):
    letras = [c for c in nombre if c.isalpha()]
    return bool(letras) and all(c.isupper() for c in letras)


def columnas_operadores(page, y_header):
    """Ordena los operadores del encabezado de izquierda a derecha."""
    ws = [w for w in page.get_text("words") if abs((w[1] + w[3]) / 2 - y_header) < 14 and w[0] > 150]
    texto_x = sorted(ws, key=lambda w: w[0])
    lineas = {}
    for w in ws:
        lineas.setdefault(round((w[1] + w[3]) / 2), []).append(w)
    encontrados = {}
    for _, lw in lineas.items():
        lw = sorted(lw, key=lambda w: w[0])
        for i, w in enumerate(lw):
            sig = norm(lw[i + 1][4]) if i + 1 < len(lw) else ""
            corto = None
            for clave, c, cond in PALABRA_OPERADOR:
                if norm(w[4]).startswith(clave) and (cond is None or sig == cond):
                    corto = c
                    break
            if corto and (corto not in encontrados or w[0] < encontrados[corto]):
                encontrados[corto] = w[0]
    return [k for k, _ in sorted(encontrados.items(), key=lambda kv: kv[1])], texto_x


def anexo_a(doc):
    datos, avisos = [], []
    depto = None
    for p in doc:
        t = p.get_text()
        if "Fijas seg" not in t:
            continue
        hdr = [w for w in p.get_text("words") if w[4].startswith("L") and "Fijas" in t]
        y_hdr = next((((w[1] + w[3]) / 2) for w in p.get_text("words") if w[4] == "Fijas" and w[0] < 150), None)
        ops, _ = columnas_operadores(p, y_hdr)
        rows = [r for r in filas(p) if r["y"] > y_hdr + 10 and r["y"] < p.rect.height - 60]
        pares, huerf = emparejar(rows, x_max_nombre=250)
        for h in huerf:
            avisos.append(f"Anexo A p.{p.number + 1}: fila de cifras sin nombre en y={h['y']:.0f}")
        for nombre, vals in pares:
            if nombre.startswith("Fuente") or nombre.startswith("*"):
                continue
            if len(vals) != len(ops):
                avisos.append(f"Anexo A p.{p.number + 1}: '{nombre}' tiene {len(vals)} cifras y {len(ops)} operadores")
                continue
            if norm(nombre) in ("total", "total general"):
                tipo = "total"
            elif es_departamento(nombre):
                depto = nombre
                tipo = "departamento"
            else:
                tipo = "municipio"
            for op, v in zip(ops, vals):
                datos.append({"departamento_boletin": depto, "nombre_boletin": nombre, "tipo": tipo, "operador": op, "lineas_fijas": num(v[4])})
    return datos, avisos


def anexo_b(doc):
    datos, avisos = [], []
    depto = None
    for p in doc:
        t = p.get_text()
        if "Desglose del Total" not in t:
            continue
        y0 = max((w[3] for w in p.get_text("words") if w[4] == "Municipio"), default=200)
        rows = [r for r in filas(p) if r["y"] > y0 + 5 and r["y"] < p.rect.height - 60]
        pares, huerf = emparejar(rows, x_max_nombre=400)
        for h in huerf:
            avisos.append(f"Anexo B p.{p.number + 1}: cifra sin nombre en y={h['y']:.0f}")
        for nombre, vals in pares:
            if re.match(r"^[C-Z]\. ", nombre):
                break
            if nombre.startswith("Fuente") or nombre.startswith("|"):
                continue
            if len(vals) != 1:
                avisos.append(f"Anexo B p.{p.number + 1}: '{nombre}' tiene {len(vals)} cifras")
                continue
            if norm(nombre) in ("total", "total general"):
                tipo = "total"
            elif es_departamento(nombre):
                depto, tipo = nombre, "departamento"
            else:
                tipo = "municipio"
            datos.append({"departamento_boletin": depto, "nombre_boletin": nombre, "tipo": tipo, "radiobases": num(vals[0][4])})
    return datos, avisos


# ---------------------------------------------------------------------------
# Formatos antiguos (aprox. 2015–2022): encabezados cortos en mayúsculas y nombres sin tildes
# ---------------------------------------------------------------------------
DEPARTAMENTOS = ["alta verapaz", "baja verapaz", "chimaltenango", "chiquimula", "el progreso", "escuintla",
                 "guatemala", "huehuetenango", "izabal", "jalapa", "jutiapa", "peten", "quetzaltenango",
                 "quiche", "el quiche", "el peten", "retalhuleu", "sacatepequez", "san marcos", "santa rosa", "solola",
                 "suchitepequez", "totonicapan", "zacapa"]

CORTOS = {
    "telenorsa": "Teléfonos del Norte", "a tel": "A-Tel", "atel": "A-Tel", "guatel": "Guatel", "optel": "Optel",
    "cablenet": "Cablenet", "unitel": "Unitel", "columbus": "Liberty (Columbus)", "colum": "Liberty (Columbus)",
    "liberty": "Liberty (Columbus)", "vivophone": "Vivophone", "telefonica": "Telefónica (Movistar)",
    "claro": "Claro Guatemala", "comcel": "Comcel (Tigo)", "com": "Comcel (Tigo)", "telgua": "Telgua (Claro)",
    "total": "TOTAL",
}


def _orden_depto(n):
    clave = lambda d: d[3:] if d.startswith("el ") else d
    return sorted(DEPARTAMENTOS, key=clave).index(n)


def anexo_a_corto(doc):
    """Matriz municipio x operador con encabezados cortos (TELENORSA, A-TEL, ... TELGUA)."""
    datos, avisos = [], []
    depto = None
    previo = None
    for p in doc:
        t = p.get_text()
        ws = p.get_text("words")
        if not re.search(r"Informaci.n de l.neas por", t):
            # página de continuación sin encabezado: usa las columnas de la página anterior
            if previo and not re.search(r"Radiobases|^\s*[B-Z]\.\s", t, re.M) and any(norm(w[4]) in DEPARTAMENTOS for w in ws):
                cols, x_nombre_max = previo
                y_dm = 60
                previo = None
            else:
                previo = None
                continue
        else:
            cols = None
        if cols is None:
            y_info = min(w[1] for w in ws if w[4].startswith("Informaci"))
            y_dm = max(w[3] for w in ws if w[4] == "Municipio" and w[1] >= y_info - 2 and w[1] < y_info + 40)
            x_nombre_max = min(w[0] for w in ws if w[4].upper() in ("TELENORSA", "TOTAL", "A-TEL") and w[1] < y_dm + 2) - 5
            # encabezado: tokens en la banda del encabezado, a la derecha de los nombres
            hdr = sorted([w for w in ws if y_info - 6 <= w[1] <= y_dm and w[0] >= x_nombre_max and num(w[4]) is None], key=lambda w: w[0])
            cols, i = [], 0
            while i < len(hdr):
                w = hdr[i]
                k = norm(w[4])
                if i + 1 < len(hdr) and norm(w[4] + hdr[i + 1][4]) in CORTOS and hdr[i + 1][0] - w[2] < 12:
                    k = norm(w[4] + hdr[i + 1][4]); x0, x1 = w[0], hdr[i + 1][2]; i += 2
                else:
                    x0, x1 = w[0], w[2]; i += 1
                if k in CORTOS and CORTOS[k] not in [c[0] for c in cols]:
                    cols.append((CORTOS[k], (x0 + x1) / 2))
            if not cols:
                avisos.append(f"Anexo A (corto) p.{p.number + 1}: sin encabezado de operadores")
                continue
        previo = (cols, x_nombre_max)
        cuerpo = [w for w in ws if (w[1] + w[3]) / 2 > y_dm + 1 and w[3] < p.rect.height - 50]
        nombres_w = [w for w in cuerpo if w[2] <= x_nombre_max + 3 and num(w[4]) is None]
        valores_w = [w for w in cuerpo if w[0] >= x_nombre_max - 3 and num(w[4]) is not None and not w[4].endswith(".")]
        filas_n = []
        for w in sorted(nombres_w, key=lambda w: ((w[1] + w[3]) / 2, w[0])):
            yc = (w[1] + w[3]) / 2
            if filas_n and abs(filas_n[-1]["y"] - yc) <= 1.5:
                filas_n[-1]["w"].append(w)
            else:
                filas_n.append({"y": yc, "w": [w], "v": {}})
        for f in filas_n:
            f["n"] = " ".join(x[4] for x in sorted(f["w"], key=lambda x: x[0]))
        filas_n = [f for f in filas_n if not f["n"].startswith(("Fuente", "BOLET", "|", "*", "Nota"))]
        if not filas_n:
            continue
        for v in valores_w:
            yc = (v[1] + v[3]) / 2
            f = min(filas_n, key=lambda f: abs(f["y"] - yc))
            if abs(f["y"] - yc) > 6:
                avisos.append(f"Anexo A (corto) p.{p.number + 1}: cifra {v[4]} sin fila en y={yc:.0f}")
                continue
            xc = v[2]
            col = min(cols, key=lambda c: abs(c[1] - (v[0] + v[2]) / 2))[0]
            f["v"][col] = f["v"].get(col, 0) + num(v[4])
        for f in filas_n:
            n = norm(f["n"])
            if n.startswith("total"):
                tipo = "total"
            elif n in DEPARTAMENTOS and (depto is None or (n != norm(depto) and (_orden_depto(n) > _orden_depto(norm(depto)) or len(f["v"]) >= len(cols) - 1))) and (n != "el progreso" or len(f["v"]) >= len(cols) - 1):
                depto, tipo = f["n"], "departamento"
            else:
                tipo = "municipio"
            for op, _ in cols:
                datos.append({"departamento_boletin": depto, "nombre_boletin": f["n"], "tipo": tipo, "operador": op, "lineas_fijas": f["v"].get(op, 0.0)})
    # bloques repetidos en el PDF (misma fila en dos páginas): se conserva la primera aparición
    vistos, unicos = set(), []
    for d in datos:
        k = (d["tipo"], d["departamento_boletin"], d["nombre_boletin"], d["operador"])
        if k in vistos:
            if d["operador"] == datos[0]["operador"]:
                avisos.append(f"Anexo A (corto): fila repetida en el PDF, se ignora la segunda: {d['departamento_boletin']} / {d['nombre_boletin']}")
            continue
        vistos.add(k)
        unicos.append(d)
    datos = unicos
    # si existe la columna TOTAL junto con operadores, se descarta para no duplicar
    ops = {d["operador"] for d in datos}
    if "TOTAL" in ops and len(ops) > 1:
        datos = [d for d in datos if d["operador"] != "TOTAL"]
    return datos, avisos


def anexo_b_tabla(doc):
    """Tabla Departamento | Municipio | Cantidad de Radiobases (continúa en páginas sin encabezado)."""
    datos, avisos = [], []
    en_tabla, x_val = False, None
    deps_ord = sorted(DEPARTAMENTOS, key=len, reverse=True)
    for p in doc:
        t = p.get_text()
        ws = p.get_text("words")
        inicio = "Municipio" in t and "Radiobases" in t and "Cantidad" in t and "Desglose del Total" not in t
        if inicio:
            hdr = [w for w in ws if w[4] == "Municipio"]
            y0 = max(w[3] for w in ws if w[4] in ("Radiobases", "Municipio") and w[1] < hdr[0][3] + 15)
            x_val = min((w[0] for w in ws if w[4] == "Cantidad"), default=300) - 30
            en_tabla = True
        elif en_tabla:
            if re.search(r"por Departamento", t) or re.search(r"^\s*[B-Z]\.\s", t, re.M):
                en_tabla = False
                continue
            y0 = 60
        else:
            continue
        cuerpo = [w for w in ws if w[1] > y0 and w[3] < p.rect.height - 45]
        nombres_w = [w for w in cuerpo if w[2] < x_val + 25 and num(w[4]) is None]
        valores_w = [w for w in cuerpo if w[0] >= x_val and num(w[4]) is not None and not w[4].endswith(".")]
        filas_n = []
        for w in sorted(nombres_w, key=lambda w: ((w[1] + w[3]) / 2, w[0])):
            yc = (w[1] + w[3]) / 2
            if filas_n and abs(filas_n[-1]["y"] - yc) <= 1.5:
                filas_n[-1]["w"].append(w)
            else:
                filas_n.append({"y": yc, "w": [w], "v": None})
        for f in filas_n:
            f["n"] = " ".join(x[4] for x in sorted(f["w"], key=lambda x: x[0]))
        filas_n = [f for f in filas_n if norm(f["n"]).startswith("total") or any(norm(f["n"]).startswith(d + " ") for d in deps_ord)]
        if not inicio and not filas_n:
            en_tabla = False
            continue
        for v in valores_w:
            yc = (v[1] + v[3]) / 2
            if not filas_n:
                break
            f = min(filas_n, key=lambda f: abs(f["y"] - yc))
            if abs(f["y"] - yc) > 6 or f["v"] is not None:
                avisos.append(f"Anexo B (tabla) p.{p.number + 1}: cifra {v[4]} sin fila libre en y={yc:.0f}")
                continue
            f["v"] = num(v[4])
        for f in filas_n:
            n = norm(f["n"])
            if n.startswith("total"):
                datos.append({"departamento_boletin": None, "nombre_boletin": f["n"], "tipo": "total", "radiobases": f["v"]})
                continue
            dep = next(d for d in deps_ord if n.startswith(d + " "))
            ndep = len(dep.split())
            datos.append({"departamento_boletin": " ".join(f["n"].split()[:ndep]), "nombre_boletin": " ".join(f["n"].split()[ndep:]), "tipo": "municipio", "radiobases": f["v"]})
    return datos, avisos


# Tablas nacionales: (número de tabla en el boletín, indicador por columna numérica, unidad)
TABLAS = {
    "Telefonía Fija: Líneas en Operación": [("lineas_fijas", "líneas"), ("participacion_lineas_fijas", "%")],
    "Telefonía Móvil: Usuarios en Operación": [("usuarios_moviles", "usuarios"), ("participacion_usuarios_moviles", "%")],
    "Usuarios Móviles Crédito por Operador": [("usuarios_pospago", "usuarios"), ("participacion_pospago", "%")],
    "Usuarios Móviles Prepago por Operador": [("usuarios_prepago", "usuarios"), ("participacion_prepago", "%")],
    "Red de Telefonía Fija: Tráfico Nacional": [("trafico_fijo_a_moviles_min", "minutos"), ("trafico_fijo_a_fijas_min", "minutos"), ("trafico_fijo_on_net_min", "minutos"), ("trafico_fijo_total_min", "minutos"), ("participacion_trafico_fijo", "%")],
    "Telefonía Móvil: Tráfico Nacional": [("trafico_movil_a_fijas_min", "minutos"), ("trafico_movil_a_moviles_min", "minutos"), ("trafico_movil_on_net_min", "minutos"), ("trafico_movil_total_min", "minutos"), ("participacion_trafico_movil", "%")],
    "Banda Ancha Fija (BAF): Usuarios": [("usuarios_banda_ancha_fija", "usuarios"), ("participacion_baf", "%")],
    "Smartphones": [("smartphones", "equipos"), ("participacion_smartphones", "%")],
    "Banda Ancha Fija (BAF): Tráfico": [("trafico_baf_exabytes", "EB"), ("participacion_trafico_baf", "%")],
    "Banda Ancha Móvil (BAM): Tráfico": [("trafico_bam_pais_exabytes", "EB"), ("participacion_trafico_bam_pais", "%"), ("trafico_bam_roaming_exabytes", "EB"), ("participacion_trafico_bam_roaming", "%")],
}


def nacional(doc):
    datos, avisos = [], []
    texto = ""
    for p in doc[3:14]:
        texto += p.get_text("text", sort=True) + "\n"
    lineas = [l for l in texto.splitlines()]
    actual = None
    for l in lineas:
        ls = l.strip()
        m = re.match(r"^\d{1,2}\.\s+(.*)$", ls)
        if m:
            actual = next((k for k in TABLAS if norm(k) in norm(m.group(1))), None)
            continue
        if not actual:
            continue
        op = next((c for k, c in OPERADORES if ls.startswith(k)), None)
        es_total = ls.upper().startswith("TOTAL")
        if not op and not es_total:
            continue
        nums = re.findall(r"-?\d{1,3}(?:(?:\.\d{3}){2,}|\.\d{3},\d+)(?:,\d+)?(?!\d)%?|-?\d[\d,]*\.?\d*(?:E-?\d+)?%?", ls[len(ls.split("  ")[0]):] if op else ls)
        if not nums:
            continue
        cols = TABLAS[actual]
        for (ind, unidad), raw in zip(cols, nums):
            v = num(raw.rstrip("%"))
            if v is None:
                continue
            if unidad == "%" and not raw.endswith("%"):
                continue
            datos.append({"tabla": actual, "operador": op or "TOTAL", "indicador": ind, "valor": v, "unidad": unidad})
    return datos, avisos


def control(filas_a, filas_b):
    out = []
    for nombre, fil, campo in (("lineas_fijas", filas_a, "lineas_fijas"), ("radiobases", filas_b, "radiobases")):
        deps = {}
        for f in fil:
            if f["tipo"] == "total":
                d = deps.setdefault("TOTAL PAÍS", {"declarado": None, "suma_municipios": sum((g[campo] or 0) for g in fil if g["tipo"] == "municipio")})
                d["declarado"] = (d["declarado"] or 0) + (f[campo] or 0)
                continue
            d = deps.setdefault(f["departamento_boletin"], {"declarado": None, "suma_municipios": 0})
            if f["tipo"] == "departamento":
                d["declarado"] = (d["declarado"] or 0) + (f[campo] or 0)
            else:
                d["suma_municipios"] += f[campo] or 0
        for d, v in deps.items():
            dif = "" if v["declarado"] is None else v["suma_municipios"] - v["declarado"]
            out.append({"variable": nombre, "departamento": d, **{**v, "declarado": "" if v["declarado"] is None else v["declarado"]}, "diferencia": dif})
    return out


def escribir(path, rows):
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main(paths):
    OUT.mkdir(parents=True, exist_ok=True)
    for ps in paths:
        pdf = Path(ps)
        doc = pymupdf.open(pdf)
        per = periodo_de(pdf, doc)
        a, av_a = anexo_a(doc)
        formato = "actual"
        if not any(r["tipo"] == "municipio" for r in a):
            a, av_a = anexo_a_corto(doc)
            formato = "corto"
        b, av_b = anexo_b(doc)
        if not any(r["tipo"] == "municipio" for r in b):
            b, av_b = anexo_b_tabla(doc)
        vistos, unicos = set(), []
        for r in b:
            k = (r["tipo"], r["departamento_boletin"], r["nombre_boletin"])
            if k in vistos:
                av_b.append(f"Anexo B: fila repetida en el PDF, se ignora la segunda: {r['departamento_boletin']} / {r['nombre_boletin']}")
                continue
            vistos.add(k)
            unicos.append(r)
        b = unicos
        n, av_n = nacional(doc)
        c = control(a, b)
        for r in a + b + n + c:
            r["periodo"] = per
        escribir(OUT / f"{per}_lineas_fijas.csv", a)
        escribir(OUT / f"{per}_radiobases.csv", b)
        escribir(OUT / f"{per}_nacional.csv", n)
        escribir(OUT / f"{per}_control.csv", c)
        avisos = av_a + av_b + av_n
        (OUT / f"{per}_avisos.txt").write_text("\n".join(avisos), encoding="utf-8")
        mun_a = len({r["nombre_boletin"] for r in a if r["tipo"] == "municipio"})
        mun_b = len([r for r in b if r["tipo"] == "municipio"])
        print(f"{pdf.name} -> {per}: anexoA {mun_a} municipios, anexoB {mun_b} municipios, nacional {len(n)} datos, {len(avisos)} avisos")


if __name__ == "__main__":
    main(sys.argv[1:])
