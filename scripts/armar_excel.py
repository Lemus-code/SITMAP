"""Arma el Excel base a partir de las tablas que deja extraer_boletin.py.

Uso:
    python scripts/armar_excel.py

Lee datos/intermedio/<periodo>_*.csv de todos los periodos procesados y el catálogo
de municipios, y escribe datos/SIT_telefonia_base.xlsx.
Todas las celdas son valores (no fórmulas) para que cualquier herramienta las lea.
"""
import csv
import re
import statistics
import unicodedata
from datetime import date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
INTER = ROOT / "datos" / "intermedio"
CATALOGO = ROOT / "datos" / "catalogo_municipios.csv"
ALIAS = ROOT / "datos" / "alias_municipios.csv"
SALIDA = ROOT / "datos" / "SIT_telefonia_base.xlsx"

AZUL = PatternFill("solid", fgColor="1B2A6B")
GRIS = PatternFill("solid", fgColor="EEF0F5")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def leer(p):
    with open(p, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def hoja(wb, nombre, encabezado, filas, anchos=None, formatos=None):
    ws = wb.create_sheet(nombre)
    ws.append(encabezado)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = AZUL
        c.alignment = Alignment(vertical="center", wrap_text=True)
    for f in filas:
        ws.append(f)
    ws.freeze_panes = "A2"
    if filas:
        ws.auto_filter.ref = f"A1:{get_column_letter(len(encabezado))}{len(filas) + 1}"
    for i, h in enumerate(encabezado, 1):
        ws.column_dimensions[get_column_letter(i)].width = (anchos or {}).get(h, max(12, min(40, len(h) + 4)))
    for col, fmt in (formatos or {}).items():
        if col in encabezado:
            j = encabezado.index(col) + 1
            for r in range(2, len(filas) + 2):
                ws.cell(r, j).number_format = fmt
    return ws


def texto(wb, nombre, lineas, ancho=110):
    ws = wb.create_sheet(nombre)
    ws.column_dimensions["A"].width = ancho
    for l in lineas:
        ws.append([l])
        c = ws.cell(ws.max_row, 1)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        if l and (l.isupper() or l.startswith("#")):
            c.value = l.lstrip("# ")
            c.font = Font(bold=True, color="1B2A6B", size=12)
    return ws


def nd(s):
    s = norm(s)
    return s[3:] if s.startswith("el ") else s


def main():
    cat = leer(CATALOGO)
    por_codigo = {c["codigo_ine"]: c for c in cat}
    claves = {}
    for c in cat:
        claves[(nd(c["departamento"]), norm(c["nombre_en_boletin_sit"]))] = c
        claves[(nd(c["departamento"]), norm(c["municipio"]))] = c
    # alias: nombres mal escritos o abreviados en boletines antiguos
    if ALIAS.exists():
        for a in leer(ALIAS):
            dest = a["codigo_ine_destino"] or ""
            if not dest:
                objetivo = norm(a["nota"].split(" (")[0])
                dest = next((c["codigo_ine"] for c in cat if nd(c["departamento"]) == nd(a["departamento"]) and norm(c["municipio"]) == objetivo), "")
            if dest:
                claves[(nd(a["departamento"]), norm(a["nombre_en_boletin"]))] = por_codigo[dest]

    def buscar(dep, nombre):
        return claves.get((nd(dep), norm(nombre)))

    periodos = sorted({p.name.split("_")[0] for p in INTER.glob("*_control.csv")})
    mun_rows, op_rows, nac_rows, ctrl_rows, sin_match, estado = [], [], [], [], [], {}
    for per in periodos:
        ctrl = leer(INTER / f"{per}_control.csv")
        ok = {}
        for var in ("lineas_fijas", "radiobases"):
            cc = [r for r in ctrl if r["variable"] == var]
            ok[var] = bool(cc) and all(r["diferencia"] in ("", "0", "0.0") for r in cc)
            estado[(per, var)] = "Sin datos municipales en el boletín" if not cc else ("Incluido (totales cuadran)" if ok[var] else "Excluido: totales no cuadran")
        for r in ctrl:
            dec = float(r["declarado"]) if r["declarado"] != "" else None
            dif = float(r["diferencia"]) if r["diferencia"] != "" else None
            ctrl_rows.append([per, r["variable"], r["departamento"], dec, float(r["suma_municipios"]), dif,
                              "SIN TOTAL EN BOLETÍN" if dec is None else ("OK" if dif == 0 else "REVISAR")])

        fijas, rbs_map, nombre_bol = {}, {}, {}
        if ok["lineas_fijas"]:
            for r in leer(INTER / f"{per}_lineas_fijas.csv"):
                if r["tipo"] != "municipio":
                    continue
                c = buscar(r["departamento_boletin"], r["nombre_boletin"])
                if not c:
                    sin_match.append((per, "Líneas fijas", r["departamento_boletin"], r["nombre_boletin"], float(r["lineas_fijas"] or 0)))
                    continue
                v = float(r["lineas_fijas"] or 0)
                d = fijas.setdefault(c["codigo_ine"], {})
                d[r["operador"]] = d.get(r["operador"], 0) + v
                nombre_bol[c["codigo_ine"]] = r["nombre_boletin"]
        if ok["radiobases"]:
            for r in leer(INTER / f"{per}_radiobases.csv"):
                if r["tipo"] != "municipio":
                    continue
                c = buscar(r["departamento_boletin"], r["nombre_boletin"])
                v = float(r["radiobases"]) if r["radiobases"] not in ("", None) else None
                if not c:
                    sin_match.append((per, "Radiobases", r["departamento_boletin"], r["nombre_boletin"], v))
                    continue
                rbs_map[c["codigo_ine"]] = (rbs_map.get(c["codigo_ine"]) or 0) + (v or 0) if v is not None else rbs_map.get(c["codigo_ine"])
                nombre_bol.setdefault(c["codigo_ine"], r["nombre_boletin"])
        for cod, ops in fijas.items():
            c = por_codigo[cod]
            for op, v in sorted(ops.items()):
                op_rows.append([per, cod, c["departamento"], c["municipio"], op, v])

        if not (ok["lineas_fijas"] or ok["radiobases"]):
            continue
        for c in cat:
            cod = c["codigo_ine"]
            pob, area = float(c["poblacion_2024"]), float(c["area_km2"])
            rbs = rbs_map.get(cod) if ok["radiobases"] else None
            ops = fijas.get(cod) if ok["lineas_fijas"] else None
            total_fx = sum(ops.values()) if ops else None
            activos = {o: v for o, v in (ops or {}).items() if v > 0}
            principal = max(activos, key=activos.get) if activos else None
            part = (activos[principal] / total_fx * 100) if activos and total_fx else None
            hhi = sum((v / total_fx * 100) ** 2 for v in activos.values()) if total_fx else None
            mun_rows.append([
                per, cod, c["departamento"], c["municipio"], nombre_bol.get(cod),
                pob, area, rbs, total_fx, len(activos) if ops is not None else None, principal,
                round(part, 2) if part is not None else None, round(hhi) if hhi is not None else None,
                round(rbs / pob * 10000, 2) if rbs is not None and pob else None,
                round(rbs / area * 100, 2) if rbs is not None and area else None,
                round(total_fx / pob * 100, 2) if total_fx is not None and pob else None,
            ])

        if (INTER / f"{per}_nacional.csv").exists():
            for r in leer(INTER / f"{per}_nacional.csv"):
                nac_rows.append([per, r["tabla"], r["indicador"], r["operador"], float(r["valor"]), r["unidad"]])

    # ---- Verificación de tablas nacionales: suma de operadores vs. TOTAL ----
    grupos = {}
    for n in nac_rows:
        grupos.setdefault((n[0], n[2]), []).append(n)
    nac_check = {}
    for (per, ind), filas_ in grupos.items():
        if filas_[0][5] == "%":
            estado_ = "n/a (porcentaje)"
        else:
            tot = [f[4] for f in filas_ if f[3] == "TOTAL"]
            suma = sum(f[4] for f in filas_ if f[3] != "TOTAL")
            if not tot:
                estado_ = "Sin total en el boletín"
            elif abs(suma - tot[0]) <= max(1, abs(tot[0]) * 0.005):
                estado_ = "Cuadra"
            else:
                estado_ = f"NO cuadra (suma {suma:,.2f} vs total {tot[0]:,.2f})"
        nac_check[(per, ind)] = estado_
    nac_rows = [n + [nac_check[(n[0], n[2])]] for n in nac_rows]

    # ---- Departamentos (agregado desde municipios) ----
    dep = {}
    for m in mun_rows:
        d = dep.setdefault((m[0], m[2]), {"pob": 0, "area": 0, "rbs": None, "fx": None, "n": 0, "un_op": None})
        d["pob"] += m[5]; d["area"] += m[6]; d["n"] += 1
        if m[7] is not None:
            d["rbs"] = (d["rbs"] or 0) + m[7]
        if m[8] is not None:
            d["fx"] = (d["fx"] or 0) + m[8]
            d["un_op"] = (d["un_op"] or 0) + (1 if m[9] == 1 else 0)
    r2 = lambda x: round(x, 2) if x is not None else None
    dep_rows = [[p, d, v["n"], v["pob"], v["area"], v["rbs"], v["fx"], v["un_op"],
                 r2(v["rbs"] / v["pob"] * 10000) if v["rbs"] is not None else None,
                 r2(v["rbs"] / v["area"] * 100) if v["rbs"] is not None else None,
                 r2(v["fx"] / v["pob"] * 100) if v["fx"] is not None else None]
                for (p, d), v in sorted(dep.items())]

    # ---- Calidad de datos ----
    cal = []
    for per in periodos:
        ms = [m for m in mun_rows if m[0] == per]
        tasas = sorted(m[13] for m in ms if m[13] is not None)
        if not tasas:
            tasas = [0]
        q1, q3 = tasas[len(tasas) // 4], tasas[3 * len(tasas) // 4]
        med = statistics.median(tasas)
        lim = q3 + 3 * (q3 - q1)
        for m in ms:
            if m[13] is not None and m[13] > lim:
                cal.append([per, "Valor atípico alto", m[1], m[2], m[3], "radiobases_10k_hab", m[13], f"Supera {lim:.1f} (Q3 + 3×RIC; mediana {med:.1f}). Verificar con la SIT."])
            if m[8] == 0:
                cal.append([per, "Sin líneas fijas reportadas", m[1], m[2], m[3], "lineas_fijas_total", 0, "Regla 2: tratar como vacío, no como cero cobertura."])
            if m[9] == 1:
                cal.append([per, "Un solo operador fijo", m[1], m[2], m[3], "operadores_fijos", 1, "Mercado sin alternativa: candidato a auditoría."])
        for r in [n for n in nac_rows if n[0] == per and n[2] == "trafico_baf_exabytes"]:
            if r[3] == "Teléfonos del Norte" and r[4] > 1:
                us = next((n[4] for n in nac_rows if n[0] == per and n[2] == "usuarios_banda_ancha_fija" and n[3] == "Teléfonos del Norte"), None)
                cal.append([per, "Inconsistencia nacional", "", "", "", "trafico_baf_exabytes", r[4], f"Teléfonos del Norte reporta {r[4]:.2f} EB con {us:.0f} usuarios de banda ancha fija: probable error de unidad."])
        if any(n[0] == per and n[2] == "trafico_baf_exabytes" for n in nac_rows) and not any(n for n in nac_rows if n[0] == per and n[2] == "trafico_baf_exabytes" and n[3] == "Telgua (Claro)"):
            cal.append([per, "Dato no reportado", "", "", "", "trafico_baf_exabytes", None, "Telgua (Claro) no reporta tráfico de banda ancha fija (aduce planes ilimitados): el total nacional está subestimado."])
    LOCALIDADES = {"santo tomas de castilla": "aldea de Puerto Barrios", "santa elena": "cabecera de Flores", "caballo blanco": "aldea de Retalhuleu", "san jorge la laguna": "aldea de Sololá"}
    for s_ in sin_match:
        loc = LOCALIDADES.get(norm(s_[3]))
        cal.append([s_[0], "Localidad no municipal" if loc else "Nombre sin homologar", "", s_[2], s_[3], s_[1], s_[4],
                    f"El boletín la reporta aparte ({loc}); no se suma a ningún municipio para no suponer." if loc else "No se encontró en el catálogo INE: agregar a alias_municipios.csv"])
    for (per, ind), e in sorted(nac_check.items()):
        if e.startswith("NO cuadra"):
            cal.append([per, "Tabla nacional no cuadra", "", "", "", ind, None, e + ". Revisar contra el PDF antes de usar."])
    # saltos bruscos en la serie nacional de radiobases (cambios de método)
    tot_rb = {}
    for m in mun_rows:
        if m[7] is not None:
            tot_rb[m[0]] = tot_rb.get(m[0], 0) + m[7]
    pers = sorted(tot_rb)
    for a_, b_ in zip(pers, pers[1:]):
        var = (tot_rb[b_] - tot_rb[a_]) / tot_rb[a_] * 100
        if abs(var) >= 20:
            cal.append([b_, "Salto en la serie", "", "", "", "radiobases (total país)", tot_rb[b_], f"{var:+.0f} % frente a {a_} ({tot_rb[a_]:,.0f}). Probable cambio en la forma de contar (sitio vs. sector): confirmar con la SIT antes de comparar periodos."])

    # ---- Inventario de boletines ----
    NOTAS = {"2016S1": "PDF escaneado (imagen, sin texto): requiere OCR o pedir el archivo original a la SIT.",
             "2016S2": "No trae líneas fijas por municipio.",
             "2018S2": "No trae radiobases por municipio.",
             "2019S1": "No trae radiobases por municipio.",
             "2014S2": "Nombres partidos en dos líneas en el PDF: totales no cuadran.",
             "2015S1": "Cada departamento aparece dos veces con cifras distintas: totales no cuadran.",
             "2015S2": "Solo trae el total por municipio, sin desglose por operador."}
    procesados = set(periodos)
    inv = []
    for anio in range(2014, 2027):
        for s_ in ("S1", "S2"):
            per = f"{anio}{s_}"
            if anio == 2026 and s_ == "S2":
                continue
            n_nac = sum(1 for n in nac_rows if n[0] == per)
            inv.append([per, anio, "1er semestre" if s_ == "S1" else "2do semestre",
                        estado.get((per, "radiobases"), "Sin datos municipales en el boletín") if per in procesados else "Pendiente",
                        estado.get((per, "lineas_fijas"), "Sin datos municipales en el boletín") if per in procesados else "Pendiente",
                        "Incluido" if n_nac else "No extraído (formato distinto)", NOTAS.get(per, "")])

    wb = Workbook()
    wb.remove(wb.active)

    texto(wb, "LEEME", [
        "# BASE DE DATOS · TELEFONÍA E INTERNET (SIT) · DATATÓN INNOVACON 2026",
        f"Actualizado: {date.today().isoformat()} · Periodos procesados: {', '.join(periodos)}",
        "",
        "# PREGUNTA DE DECISIÓN",
        "La SIT necesita saber la calidad del servicio de telefonía e internet para decidir qué y dónde auditar en el territorio nacional, en tiempo real.",
        "",
        "# QUÉ HAY EN CADA HOJA",
        "municipios — una fila por municipio y semestre: radiobases, líneas fijas, operadores, concentración y tasas por habitante y por área. Es la hoja que alimenta el mapa y el ranking de auditoría.",
        "lineas_fijas_operador — líneas fijas por municipio, operador y semestre (formato largo).",
        "departamentos — los mismos indicadores sumados por departamento.",
        "nacional — tablas nacionales del boletín por operador: usuarios móviles (prepago/pospago), banda ancha fija, smartphones, tráfico de voz y de datos.",
        "catalogo_municipios — los 340 municipios con código INE, población y área; homologa los nombres del boletín.",
        "control_totales — los totales por departamento que declara el boletín contra la suma de sus municipios. Todo en OK = extracción completa.",
        "calidad_datos — valores atípicos, vacíos e inconsistencias que hay que declarar (Reglas para leer los datos).",
        "inventario_boletines — qué semestres están procesados y cuáles faltan.",
        "diccionario — qué significa cada columna y cómo se calcula.",
        "bitacora — pasos de limpieza.",
        "",
        "# CÓMO SE ACTUALIZA",
        "1. Guardar los PDF del Boletín Estadístico en fuentes/SIT/boletines/ (el nombre del archivo debe decir 1er o 2do semestre y el año).",
        "2. python scripts/extraer_boletin.py fuentes/SIT/boletines/*.pdf",
        "3. python scripts/armar_excel.py",
        "4. Revisar control_totales (todo OK) y calidad_datos.",
        "",
        "# LIMITACIONES",
        "Datos autodeclarados por los operadores (formulario SIT-OTE-A), semestrales, sin indicadores de calidad (velocidad, caídas, latencia).",
        "Radiobases sin tecnología, operador ni coordenadas. Banda ancha, usuarios móviles y tráfico solo a nivel nacional.",
        "Población y área: heredadas de la base del piloto (proyección 2024); confirmar la fuente oficial (INE) antes de publicar. Las tasas de años anteriores usan esa misma población: sirven para comparar municipios dentro de un periodo, no para leer tendencias por habitante.",
        "Radiobases: la serie nacional tiene saltos de más de 20 % entre semestres (ver calidad_datos). Comparar periodos solo después de confirmar el método con la SIT.",
        "Un periodo se incluye por variable solo si los totales por departamento y país del boletín cuadran con la suma de sus municipios (ver inventario_boletines).",
    ])

    hoja(wb, "municipios",
         ["periodo", "codigo_ine", "departamento", "municipio", "nombre_en_boletin", "poblacion", "area_km2",
          "radiobases", "lineas_fijas_total", "operadores_fijos", "operador_fijo_principal", "participacion_principal_pct",
          "hhi_fijo", "radiobases_10k_hab", "radiobases_100km2", "lineas_fijas_100_hab"],
         sorted(mun_rows, key=lambda m: (m[0], m[1])),
         anchos={"departamento": 16, "municipio": 26, "nombre_en_boletin": 26, "operador_fijo_principal": 20},
         formatos={"poblacion": "#,##0", "radiobases": "#,##0", "lineas_fijas_total": "#,##0", "hhi_fijo": "#,##0", "area_km2": "#,##0.0"})
    hoja(wb, "lineas_fijas_operador", ["periodo", "codigo_ine", "departamento", "municipio", "operador", "lineas_fijas"],
         sorted(op_rows, key=lambda r: (r[0], r[1], r[4])), anchos={"municipio": 26, "operador": 20},
         formatos={"lineas_fijas": "#,##0"})
    hoja(wb, "departamentos", ["periodo", "departamento", "municipios", "poblacion", "area_km2", "radiobases", "lineas_fijas_total",
                               "municipios_un_operador_fijo", "radiobases_10k_hab", "radiobases_100km2", "lineas_fijas_100_hab"],
         dep_rows, formatos={"poblacion": "#,##0", "radiobases": "#,##0", "lineas_fijas_total": "#,##0", "area_km2": "#,##0"})
    hoja(wb, "nacional", ["periodo", "tabla_boletin", "indicador", "operador", "valor", "unidad", "verificacion"], nac_rows,
         anchos={"tabla_boletin": 38, "indicador": 32, "operador": 20}, formatos={"valor": "#,##0.####"})
    hoja(wb, "catalogo_municipios", ["codigo_ine", "departamento", "municipio", "nombre_en_boletin_sit", "poblacion_2024", "area_km2", "fuente_poblacion_area"],
         [[c["codigo_ine"], c["departamento"], c["municipio"], c["nombre_en_boletin_sit"], float(c["poblacion_2024"]), float(c["area_km2"]),
           "Base del piloto (proyección 2024) – por confirmar con INE"] for c in cat],
         anchos={"municipio": 26, "nombre_en_boletin_sit": 26, "fuente_poblacion_area": 50}, formatos={"poblacion_2024": "#,##0"})
    hoja(wb, "control_totales", ["periodo", "variable", "departamento", "declarado_boletin", "suma_municipios", "diferencia", "estado"],
         ctrl_rows, formatos={"declarado_boletin": "#,##0", "suma_municipios": "#,##0"})
    hoja(wb, "calidad_datos", ["periodo", "tipo", "codigo_ine", "departamento", "municipio", "variable", "valor", "nota"], cal,
         anchos={"tipo": 26, "municipio": 24, "nota": 80})
    hoja(wb, "inventario_boletines", ["periodo", "anio", "semestre", "radiobases_municipio", "lineas_fijas_municipio", "tablas_nacionales", "nota"], inv,
         anchos={"radiobases_municipio": 34, "lineas_fijas_municipio": 34, "tablas_nacionales": 28, "nota": 80})

    dic = [
        ["municipios", "periodo", "Año y semestre del boletín (2025S2 = 2.º semestre 2025, datos entregados en enero 2026).", "Boletín"],
        ["municipios", "codigo_ine", "Código del municipio (GT + depto + municipio).", "Catálogo"],
        ["municipios", "radiobases", "Radiobases (RBS/BTS) de telefonía móvil en operación al final del semestre.", "Anexo B"],
        ["municipios", "lineas_fijas_total", "Suma de líneas fijas en operación de todos los operadores.", "Anexo A"],
        ["municipios", "operadores_fijos", "Operadores con al menos 1 línea fija en el municipio.", "Calculado"],
        ["municipios", "operador_fijo_principal", "Operador con más líneas fijas en el municipio.", "Calculado"],
        ["municipios", "participacion_principal_pct", "Líneas del operador principal / total × 100.", "Calculado"],
        ["municipios", "hhi_fijo", "Índice Herfindahl-Hirschman de telefonía fija: suma de participaciones² (0–10 000; >2 500 = muy concentrado).", "Calculado"],
        ["municipios", "radiobases_10k_hab", "radiobases / población × 10 000. Proxy de capacidad móvil por habitante.", "Calculado"],
        ["municipios", "radiobases_100km2", "radiobases / área × 100. Proxy de cobertura territorial.", "Calculado"],
        ["municipios", "lineas_fijas_100_hab", "líneas fijas / población × 100. Proxy de red fija (internet fijo) disponible.", "Calculado"],
        ["municipios", "poblacion / area_km2", "Del catálogo (proyección 2024). Por confirmar fuente oficial.", "Catálogo"],
        ["nacional", "indicador", "Ver tabla_boletin. Unidades en la columna unidad; % = participación del operador en el total.", "Tablas 2–13"],
        ["nacional", "operador", "Nombre corto: Comcel (Tigo) = Comunicaciones Celulares, S.A.; Telgua (Claro) = Telecomunicaciones de Guatemala, S.A.", "Boletín"],
        ["control_totales", "diferencia", "suma de municipios − total declarado por el boletín. Debe ser 0.", "Calculado"],
    ]
    hoja(wb, "diccionario", ["hoja", "columna", "definicion", "origen"], dic, anchos={"columna": 28, "definicion": 95})

    texto(wb, "bitacora", [
        "# BITÁCORA DE LIMPIEZA",
        "1. Extracción por coordenadas de cada palabra (PyMuPDF) de los anexos A (líneas fijas por municipio y operador) y B (radiobases por municipio). El texto plano del PDF desalinea nombres y cifras, por eso no se usa.",
        "2. Detección de filas de departamento (nombre en mayúsculas) y de la fila TOTAL; se guardan aparte para el control.",
        "3. Encabezados de operador leídos del propio boletín: si cambia el número de operadores entre años, el script lo detecta.",
        "4. Homologación de nombres del boletín con el catálogo INE (sin tildes ni mayúsculas, por departamento + municipio).",
        "5. Control: total de cada departamento y total país declarados vs. suma de municipios (hoja control_totales).",
        "6. Tablas nacionales 2–13 extraídas por operador; nombres de operador abreviados.",
        "7. Cálculo de tasas por población y área, número de operadores y concentración (HHI).",
        "8. Marcado de atípicos, vacíos e inconsistencias en calidad_datos. No se corrige ni se borra ningún valor original.",
    ])

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    wb.save(SALIDA)
    print(f"{SALIDA} · periodos {periodos} · municipios {len(mun_rows)} · nacional {len(nac_rows)} · calidad {len(cal)} · sin homologar {len(sin_match)}")


if __name__ == "__main__":
    main()
