"""Exporta del Excel base los archivos que alimentan el dashboard.

Uso:
    python scripts/exportar_dashboard.py

Lee datos/SIT_telefonia_base.xlsx y piloto-dashboard/data.js (límites municipales)
y escribe datos/dashboard/*.json.
"""
import json
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
XLSX = ROOT / "datos" / "SIT_telefonia_base.xlsx"
OUT = ROOT / "datos" / "dashboard"


def filas(ws):
    it = ws.iter_rows(values_only=True)
    cab = next(it)
    return [dict(zip(cab, r)) for r in it]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    wb = load_workbook(XLSX, read_only=True)

    cols = ["periodo", "codigo_ine", "departamento", "municipio", "poblacion", "area_km2", "radiobases",
            "lineas_fijas_total", "operadores_fijos", "operador_fijo_principal", "participacion_principal_pct",
            "hhi_fijo", "radiobases_10k_hab", "lineas_fijas_100_hab"]
    mun = [{c: r[c] for c in cols} for r in filas(wb["municipios"])]

    ops = [{"periodo": r["periodo"], "codigo_ine": r["codigo_ine"], "operador": r["operador"], "lineas_fijas": r["lineas_fijas"]}
           for r in filas(wb["lineas_fijas_operador"]) if r["lineas_fijas"]]

    nac = [{"periodo": r["periodo"], "indicador": r["indicador"], "operador": r["operador"], "valor": r["valor"],
            "unidad": r["unidad"], "verificacion": r["verificacion"]}
           for r in filas(wb["nacional"]) if not str(r["verificacion"]).startswith("NO")]

    cal = [{k: r[k] for k in ("periodo", "tipo", "codigo_ine", "departamento", "municipio", "variable", "valor", "nota")}
           for r in filas(wb["calidad_datos"]) if r["tipo"] in ("Salto en la serie", "Localidad no municipal", "Valor atípico alto", "Inconsistencia nacional", "Dato no reportado")]

    inv = filas(wb["inventario_boletines"])

    s = (ROOT / "piloto-dashboard" / "data.js").read_text(encoding="utf-8")
    geo = json.loads(s[s.index("{"):s.rindex("}") + 1])["geo"]

    def dump(nombre, obj, filas_por_linea=True):
        p = OUT / nombre
        if isinstance(obj, list) and filas_por_linea:
            p.write_text("[\n" + ",\n".join(json.dumps(o, ensure_ascii=False) for o in obj) + "\n]\n", encoding="utf-8")
        else:
            p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(nombre, p.stat().st_size // 1024, "KB", len(obj) if isinstance(obj, list) else "")

    dump("municipios.json", mun)
    dump("operadores_fijos.json", ops)
    dump("nacional.json", nac)
    dump("calidad.json", cal)
    dump("inventario.json", inv)
    dump("limites_municipales.json", geo, filas_por_linea=False)


if __name__ == "__main__":
    main()
