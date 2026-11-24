"""Procesa la exportación de OpenCelliD para Guatemala (MCC 704) para el mapa.

Uso:
    python scripts/procesar_opencellid.py [ruta/al/704.csv.gz]

Por defecto lee fuentes/opencellid/704.csv.gz. Escribe en mapa/data/:
    celdas_opencellid.json        [[lon, lat, tecnologia, mnc, alcance_m, mediciones, ultima_vez(AAAA-MM-DD), codigo_ine], ...]
    celdas_por_municipio.json     {codigo_ine: {total, 2G, 3G, 4G, mnc01, mnc02, mnc03}}
    celdas_meta.json              fecha de la exportación, totales, licencia

Datos: OpenCelliD (https://opencellid.org), licencia CC BY-SA 4.0. Las posiciones son estimadas
a partir de mediciones de teléfonos; no son ubicaciones confirmadas de torres.
"""
import csv
import gzip
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "mapa" / "data"
COLS = ["radio", "mcc", "net", "area", "cell", "unit", "lon", "lat", "range", "samples", "changeable", "created", "updated", "averageSignal"]
TEC = {"GSM": "2G", "UMTS": "3G", "LTE": "4G", "NR": "5G", "CDMA": "CDMA"}


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "fuentes" / "opencellid" / "704.csv.gz"
    g = json.loads((OUT / "limites_municipales.json").read_text(encoding="utf-8"))
    feats = [f for f in g["features"] if not f["properties"]["lake"]]
    cods = [f["properties"]["id"] for f in feats]
    arbol = STRtree([shape(f["geometry"]) for f in feats])

    celdas, por_muni, fuera = [], defaultdict(Counter), 0
    ultima = 0
    primera = 10**12
    with gzip.open(src, "rt", encoding="utf-8") as fh:
        for fila in csv.reader(fh):
            if not fila or not fila[1].isdigit():
                continue  # encabezado, si lo hubiera
            x = dict(zip(COLS, fila))
            if x["mcc"] != "704":
                continue
            lon, lat = float(x["lon"]), float(x["lat"])
            i = arbol.query(Point(lon, lat), predicate="intersects")
            if len(i) == 0:
                fuera += 1
                continue
            cod = cods[i[0]]
            tec = TEC.get(x["radio"], x["radio"])
            mnc = "%02d" % int(x["net"])
            upd = int(x["updated"])
            ultima = max(ultima, upd)
            primera = min(primera, upd)
            celdas.append([round(lon, 4), round(lat, 4), tec, mnc, int(x["range"]), int(x["samples"]),
                           datetime.fromtimestamp(upd, timezone.utc).strftime("%Y-%m-%d"), cod])
            c = por_muni[cod]
            c["total"] += 1
            c[tec] += 1
            c["mnc" + mnc] += 1

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "celdas_opencellid.json").write_text(json.dumps(celdas, separators=(",", ":")), encoding="utf-8")
    (OUT / "celdas_por_municipio.json").write_text(json.dumps({k: dict(v) for k, v in por_muni.items()}, separators=(",", ":")), encoding="utf-8")
    meta = {
        "fuente": "OpenCelliD", "url": "https://opencellid.org", "licencia": "CC BY-SA 4.0",
        "atribucion": "Datos de celdas: OpenCelliD, licencia CC BY-SA 4.0",
        "archivo": src.name, "primera_observacion": datetime.fromtimestamp(primera, timezone.utc).strftime("%Y-%m-%d"), "ultima_observacion": datetime.fromtimestamp(ultima, timezone.utc).strftime("%Y-%m-%d"),
        "celdas": len(celdas), "fuera_de_guatemala": fuera, "municipios_con_celdas": len(por_muni),
        "por_tecnologia": dict(Counter(c[2] for c in celdas)), "por_mnc": dict(Counter(c[3] for c in celdas)),
        "mnc": {"01": "Claro", "02": "Tigo", "03": "Movistar"},
        "nota": "Posiciones estimadas con mediciones de teléfonos de voluntarios, no ubicaciones confirmadas de torres. Varias celdas pueden pertenecer a la misma torre. La ausencia de celdas no significa ausencia de servicio.",
    }
    (OUT / "celdas_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
