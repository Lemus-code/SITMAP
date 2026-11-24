"""Cobertura móvil observada en las escuelas de Guatemala (conectividad estratégica).

    python scripts/escuelas_cobertura.py

Entradas (reales):
    escuelas/School_report_page_*.csv    escuelas de Giga (UNICEF/UIT): ubicación y nivel
    mapa/data/celdas_opencellid.json     celdas observadas (OpenCelliD, posiciones y alcance estimados)
    mapa/data/limites_municipales.json   límites municipales

Clasificación de cada escuela según la celda observada más favorable:
    4G / 3G / Solo 2G   dentro del alcance estimado de al menos una celda (mejor tecnología disponible)
    Borde               fuera del alcance, pero a menos de 2 veces el alcance de alguna celda
    Sin cobertura       ninguna celda observada cerca
Potenciales (solo para Borde y Sin cobertura):
    Extensión           hay una celda observada a 5 km o menos
    Nuevo sitio         agrupación de 5 o más escuelas sin cobertura a más de 5 km de cualquier celda;
                        se propone un punto que alcanzaría a varias en un radio de 3 km
Limitación: OpenCelliD mide más en ciudades. "Sin cobertura" significa sin cobertura OBSERVADA.

Salidas en mapa/data/: escuelas.json, escuelas_municipios.json, escuelas_sitios_candidatos.json, escuelas_meta.json
"""
import csv
import glob
import json
import math
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "mapa" / "data"
RANGO_MIN = 500          # m: alcance mínimo atribuido a una celda
EXTENSION_KM = 5
SITIO_RADIO_KM = 3
SITIO_MIN_ESCUELAS = 5
NIVEL = {"Pre-Primary": "Preprimaria", "Primary": "Primaria", "Secondary": "Secundaria", "Unknown": "Sin dato"}
RANGO_TEC = {"4G": 3, "3G": 2, "2G": 1}


def km(a_lon, a_lat, b_lon, b_lat):
    return math.hypot((a_lon - b_lon) * 111.32 * math.cos(math.radians((a_lat + b_lat) / 2)), (a_lat - b_lat) * 110.57)


def main():
    # escuelas únicas (por ID de Giga); se juntan sus niveles
    esc = {}
    for f in sorted(glob.glob(str(ROOT / "escuelas" / "School_report_page_*.csv"))):
        with open(f, encoding="utf-8-sig", errors="replace") as fh:
            for r in csv.DictReader(fh):
                gid = r["School Giga ID"]
                try:
                    lon, lat = float(r["Longitude"]), float(r["Latitude"])
                except ValueError:
                    continue
                e = esc.setdefault(gid, {"id": gid, "nombre": r["School Name"].strip(), "lon": lon, "lat": lat, "niveles": set()})
                e["niveles"].add(NIVEL.get(r["Education Level"], "Sin dato"))
    escuelas = list(esc.values())
    print("escuelas únicas:", len(escuelas))

    g = json.loads((D / "limites_municipales.json").read_text(encoding="utf-8"))
    feats = [f for f in g["features"] if not f["properties"]["lake"]]
    cods = [f["properties"]["id"] for f in feats]
    arbol_m = STRtree([shape(f["geometry"]) for f in feats])
    nombres = {f["properties"]["id"]: (f["properties"].get("municipio"), f["properties"].get("departamento")) for f in feats}

    celdas = json.loads((D / "celdas_opencellid.json").read_text(encoding="utf-8"))
    # índice espacial simple por rejilla de 0.1°
    rej = defaultdict(list)
    for c in celdas:
        rej[(int((c[0] + 200) * 10), int((c[1] + 200) * 10))].append(c)

    def cercanas(lon, lat, radio_celdas=1):
        gx, gy = int((lon + 200) * 10), int((lat + 200) * 10)
        for dx in range(-radio_celdas, radio_celdas + 1):
            for dy in range(-radio_celdas, radio_celdas + 1):
                yield from rej.get((gx + dx, gy + dy), [])

    fuera = 0
    for e in escuelas:
        i = arbol_m.query(Point(e["lon"], e["lat"]), predicate="intersects")
        if len(i) == 0:
            i = [arbol_m.nearest(Point(e["lon"], e["lat"]))]
            fuera += 1
        e["cod"] = cods[i[0]]
        mejor_tec, dmin, ratio_min, tec_cercana = 0, 1e9, 1e9, None
        for c in cercanas(e["lon"], e["lat"]):
            d = km(e["lon"], e["lat"], c[0], c[1]) * 1000
            alcance = max(RANGO_MIN, c[4])
            if d <= alcance:
                mejor_tec = max(mejor_tec, RANGO_TEC.get(c[2], 1))
            ratio_min = min(ratio_min, d / alcance)
            if d < dmin:
                dmin, tec_cercana = d, c[2]
        if dmin > 1e8:  # nada en 0.1°: buscar más lejos para la distancia
            for c in cercanas(e["lon"], e["lat"], 6):
                d = km(e["lon"], e["lat"], c[0], c[1]) * 1000
                if d < dmin:
                    dmin, tec_cercana = d, c[2]
        e["dist_m"] = round(dmin) if dmin < 1e8 else None
        if mejor_tec:
            e["cat"] = {3: "4G", 2: "3G", 1: "2G"}[mejor_tec]
        elif ratio_min <= 2:
            e["cat"] = "borde"
        else:
            e["cat"] = "sin"
        e["pot"] = None
        if e["cat"] in ("borde", "sin") and e["dist_m"] is not None and e["dist_m"] <= EXTENSION_KM * 1000:
            e["pot"] = "extension"

    # candidatos a sitio nuevo: escuelas sin cobertura y lejos (> 5 km) de toda celda observada
    lejanas = [e for e in escuelas if e["cat"] in ("borde", "sin") and e["pot"] is None]
    rej2 = defaultdict(list)
    for e in lejanas:
        rej2[(round(e["lon"] / 0.03), round(e["lat"] / 0.03))].append(e)
    libres = set(id(e) for e in lejanas)
    candidatos = []
    while True:
        mejor = None
        for e in lejanas:
            if id(e) not in libres:
                continue
            gx, gy = round(e["lon"] / 0.03), round(e["lat"] / 0.03)
            vec = [v for dx in range(-1, 2) for dy in range(-1, 2) for v in rej2.get((gx + dx, gy + dy), [])
                   if id(v) in libres and km(e["lon"], e["lat"], v["lon"], v["lat"]) <= SITIO_RADIO_KM]
            if mejor is None or len(vec) > len(mejor[1]):
                mejor = (e, vec)
        if not mejor or len(mejor[1]) < SITIO_MIN_ESCUELAS:
            break
        e0, vec = mejor
        lon = sum(v["lon"] for v in vec) / len(vec)
        lat = sum(v["lat"] for v in vec) / len(vec)
        cid = f"SC-{len(candidatos) + 1:03d}"
        for v in vec:
            libres.discard(id(v))
            v["pot"] = "nuevo"
            v["sitio"] = cid
        candidatos.append({"id": cid, "lon": round(lon, 5), "lat": round(lat, 5), "escuelas": len(vec), "cod": e0["cod"],
                           "municipio": nombres[e0["cod"]][0], "departamento": nombres[e0["cod"]][1],
                           "dist_celda_km": round(min((v["dist_m"] or 99999) for v in vec) / 1000, 1)})

    # salidas
    cats = ["4G", "3G", "2G", "borde", "sin"]
    filas = [[round(e["lon"], 5), round(e["lat"], 5), e["cat"], e["pot"] or "", e["dist_m"], e["cod"], e["nombre"].title(),
              "/".join(sorted(e["niveles"])), e.get("sitio", "")] for e in escuelas]
    (D / "escuelas.json").write_text(json.dumps({"campos": ["lon", "lat", "cat", "pot", "dist_m", "cod", "nombre", "niveles", "sitio"], "filas": filas},
                                                ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    por_m = defaultdict(Counter)
    for e in escuelas:
        por_m[e["cod"]][e["cat"]] += 1
        por_m[e["cod"]]["total"] += 1
        if e["pot"]:
            por_m[e["cod"]]["pot_" + e["pot"]] += 1
    salida_m = {}
    for cod, c in por_m.items():
        cub = c["4G"] + c["3G"] + c["2G"]
        salida_m[cod] = {"codigo_ine": cod, "municipio": nombres[cod][0], "departamento": nombres[cod][1], "total": c["total"],
                         **{k: c[k] for k in cats}, "cubiertas": cub, "pct_cubiertas": round(cub / c["total"] * 100, 1),
                         "pct_4g": round(c["4G"] / c["total"] * 100, 1),
                         "pot_extension": c["pot_extension"], "pot_nuevo": c["pot_nuevo"]}
    (D / "escuelas_municipios.json").write_text(json.dumps(salida_m, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (D / "escuelas_sitios_candidatos.json").write_text(json.dumps(candidatos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tot = Counter(e["cat"] for e in escuelas)
    meta = {
        "fuente_escuelas": "Giga (UNICEF/UIT), reporte de escuelas de Guatemala descargado el 2026-11-24",
        "fuente_cobertura": "OpenCelliD (celdas observadas, licencia CC BY-SA 4.0)",
        "generado": date.today().isoformat(), "escuelas": len(escuelas), "registros_originales": sum(1 for _ in escuelas),
        "fuera_de_limites": fuera, "por_categoria": dict(tot),
        "potencial_extension": sum(1 for e in escuelas if e["pot"] == "extension"),
        "potencial_nuevo_sitio": sum(1 for e in escuelas if e["pot"] == "nuevo"), "sitios_candidatos": len(candidatos),
        "parametros": {"alcance_minimo_m": RANGO_MIN, "extension_km": EXTENSION_KM, "sitio_radio_km": SITIO_RADIO_KM, "sitio_min_escuelas": SITIO_MIN_ESCUELAS},
        "aviso": "Cobertura OBSERVADA por teléfonos (OpenCelliD), no cobertura oficial. Hay más mediciones en ciudades: una escuela sin cobertura observada puede tener señal no medida.",
    }
    (D / "escuelas_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: meta[k] for k in ("escuelas", "fuera_de_limites", "por_categoria", "potencial_extension", "potencial_nuevo_sitio", "sitios_candidatos")}, ensure_ascii=False))
    print("tamaño", (D / "escuelas.json").stat().st_size // 1024, "KB")
    print("top candidatos", [(c["id"], c["escuelas"], c["municipio"]) for c in candidatos[:5]])


if __name__ == "__main__":
    main()
