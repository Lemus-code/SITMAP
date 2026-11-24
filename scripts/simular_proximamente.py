"""Genera DATOS SIMULADOS para la vista "Próximamente" del mapa.

    python scripts/simular_proximamente.py

IMPORTANTE: todo lo que produce este script es SIMULADO. Sirve solo para mostrar qué análisis se
podrían hacer si los operadores entregaran a la SIT las métricas por radiobase. No describe la red real.

Qué es real y qué es simulado:
- REAL (estimado): posición de los sitios que salen de agrupar celdas observadas de OpenCelliD,
  su operador y sus tecnologías; población y área municipal; lugares poblados; radiobases SIT 2026-S1.
- SIMULADO: sitios en municipios sin celdas observadas (ubicados en lugares poblados reales al azar),
  sectores, bandas, capacidad del enlace, tráfico promedio y pico, usuarios, latencia, fallas,
  perfil de consumo por dispositivo y marcas de duplicidad.

Salidas en mapa/data/: sim_sitios.json, sim_municipios.json, sim_meta.json
"""
import json
import math
import random
import statistics
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "mapa" / "data"
SEMILLA = 2026
rnd = random.Random(SEMILLA)

# ---------------- supuestos (todos simulados) ----------------
CAP_SECTOR_MBPS = {"2G": 0.2, "3G": 21.0, "4G": 75.0}          # capacidad de aire por sector
USUARIOS_SECTOR = {"2G": 150, "3G": 250, "4G": 600}             # usuarios simultáneos por sector
BANDAS = {"2G": ["850 MHz", "1900 MHz"], "3G": ["850 MHz", "1900 MHz"], "4G": ["700 MHz", "1700/2100 MHz (AWS)", "1900 MHz"]}
ENLACES = {  # (tipo, Mbps, probabilidad) según tipo de municipio
    "urbano": [("Fibra", 1000, 0.70), ("Microondas", 400, 0.30)],
    "intermedio": [("Microondas", 300, 0.65), ("Fibra", 1000, 0.35)],
    "rural": [("Microondas", 150, 0.75), ("Satelital", 50, 0.25)],
}
LAT_BASE = {"Fibra": 22, "Microondas": 38, "Satelital": 590}   # ms
PENETRACION = 1.15          # líneas móviles por habitante
CONCURRENCIA_PICO = 0.04    # fracción de usuarios activos a la vez en hora pico
MBPS_POR_USUARIO_PICO = 0.6
DEMANDA_ZONA = {"urbano": 1.0, "intermedio": 0.8, "rural": 0.55}  # uso de datos relativo por tipo de zona
CUOTA = {"01": 0.45, "02": 0.55, "03": 0.0}  # participación de usuarios usada para repartir demanda
PERFILES = [  # (perfil, GB/mes base)
    ("Teléfono básico", 0.3), ("Smartphone", 9.0), ("Módem o router móvil", 45.0)]


def elegir(opciones):
    r = rnd.random()
    acum = 0
    for o in opciones:
        acum += o[-1]
        if r <= acum:
            return o
    return opciones[-1]


def dist_m(a, b):
    return math.hypot((a[0] - b[0]) * 111320 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110570)


def main():
    celdas = json.loads((D / "celdas_opencellid.json").read_text(encoding="utf-8"))
    mun = [r for r in json.loads((D / "municipios.json").read_text(encoding="utf-8")) if r["periodo"] == "2026S1"]
    lugares = json.loads((D / "lugares_poblados.json").read_text(encoding="utf-8"))
    lug_por_muni = defaultdict(list)
    for l in lugares:
        lug_por_muni[l[4]].append(l)
    info = {r["codigo_ine"]: r for r in mun}

    def tipo_muni(cod):
        r = info[cod]
        dens = r["poblacion"] / max(r["area_km2"], 1)
        return "urbano" if dens > 1000 else "intermedio" if dens > 200 else "rural"

    # 1) sitios a partir de celdas reales: agrupar por operador en celdas de ~330 m
    grupos = defaultdict(list)
    for c in celdas:
        grupos[(c[3], round(c[0] / 0.003), round(c[1] / 0.003))].append(c)
    sitios = []
    for (mnc, _, _), cs in grupos.items():
        cod = Counter(c[7] for c in cs).most_common(1)[0][0]
        sitios.append({"lon": round(statistics.mean(c[0] for c in cs), 5), "lat": round(statistics.mean(c[1] for c in cs), 5),
                       "mnc": mnc, "cod": cod, "tec": sorted({c[2] for c in cs if c[2] in CAP_SECTOR_MBPS}) or ["3G"],
                       "celdas": len(cs), "posicion": "OpenCelliD (real, estimada)"})

    # 2) municipios sin celdas observadas: sitios simulados en lugares poblados reales
    con_sitio = {s["cod"] for s in sitios}
    for cod, r in info.items():
        if cod in con_sitio:
            continue
        n = max(1, min(60, r["radiobases"] or 2))
        cand = [l for l in lug_por_muni.get(cod, []) if l[2] in ("PUEBLO", "CIUDAD", "VILLA", "ALDEA")] or lug_por_muni.get(cod, [])
        if not cand:
            continue
        for _ in range(n):
            l = rnd.choice(cand)
            sitios.append({"lon": round(l[0] + rnd.uniform(-0.004, 0.004), 5), "lat": round(l[1] + rnd.uniform(-0.004, 0.004), 5),
                           "mnc": rnd.choice(["01", "01", "02"]), "cod": cod,
                           "tec": rnd.choice([["2G", "3G"], ["3G"], ["3G", "4G"], ["2G", "3G", "4G"]]), "celdas": None, "posicion": "Simulada"})

    # 3) atributos simulados por sitio
    sitios_muni = Counter(s["cod"] for s in sitios)
    for i, s in enumerate(sitios):
        tm = tipo_muni(s["cod"])
        s["id"] = f"RB-{i + 1:05d}"
        s["tipo_zona"] = tm
        s["sectores"] = elegir([(1, 0.05), (2, 0.15), (3, 0.6), (4, 0.12), (6, 0.08)])[0]
        s["bandas"] = sorted({b for t in s["tec"] for b in rnd.sample(BANDAS[t], k=min(len(BANDAS[t]), rnd.choice([1, 1, 2])))})
        enl = elegir(ENLACES[tm])
        s["enlace_tipo"], s["enlace_mbps"] = enl[0], enl[1]
        aire = s["sectores"] * sum(CAP_SECTOR_MBPS[t] for t in s["tec"])
        s["capacidad_max_mbps"] = round(min(s["enlace_mbps"], aire), 1)
        s["usuarios_soportados"] = s["sectores"] * max(USUARIOS_SECTOR[t] for t in s["tec"])
        r = info[s["cod"]]
        usuarios = r["poblacion"] * PENETRACION / max(1, sitios_muni[s["cod"]])
        usuarios = max(30, usuarios * rnd.uniform(0.5, 1.6))
        s["usuarios_atendidos"] = round(usuarios)
        pico = usuarios * CONCURRENCIA_PICO * MBPS_POR_USUARIO_PICO * DEMANDA_ZONA[tm] * rnd.uniform(0.6, 1.3)
        s["trafico_pico_mbps"] = round(min(pico, s["capacidad_max_mbps"] * 1.0), 1)
        s["trafico_prom_mbps"] = round(s["trafico_pico_mbps"] * rnd.uniform(0.3, 0.55), 1)
        s["ocupacion_pico_pct"] = round(min(100, pico / s["capacidad_max_mbps"] * 100), 1)
        s["uso_prom_usuario_kbps"] = round(s["trafico_prom_mbps"] * 1000 / s["usuarios_atendidos"], 1)
        cong = max(0, s["ocupacion_pico_pct"] - 60) / 40
        s["latencia_ms"] = round(LAT_BASE[s["enlace_tipo"]] * rnd.uniform(0.85, 1.25) + cong * 80)
        rural = 1.6 if tm == "rural" else 1.2 if tm == "intermedio" else 1.0
        s["fallas"] = {
            "caida_llamada": round(rnd.uniform(4, 12) * rural * (1 + cong), 1),
            "sesion_datos_interrumpida": round(rnd.uniform(6, 18) * rural * (1 + 1.5 * cong), 1),
            "sitio_fuera_servicio_h_mes": round(rnd.expovariate(1 / (3 * rural)), 1),
        }
        s["radio_cobertura_m"] = round(rnd.uniform(400, 1200) if tm == "urbano" else rnd.uniform(1500, 4000) if tm == "intermedio" else rnd.uniform(3000, 8000))
        s["duplicado_de"] = None

    # 4) posible duplicidad: mismo operador a menos de 150 m (se marca la segunda)
    por_op = defaultdict(list)
    for s in sitios:
        por_op[s["mnc"]].append(s)
    for lst in por_op.values():
        celda = defaultdict(list)
        for s in lst:
            celda[(round(s["lon"] / 0.002), round(s["lat"] / 0.002))].append(s)
        for (gx, gy), ss in celda.items():
            vecinos = [v for dx in (-1, 0, 1) for dy in (-1, 0, 1) for v in celda.get((gx + dx, gy + dy), [])]
            for s in ss:
                for v in vecinos:
                    if v is not s and v["id"] < s["id"] and v["duplicado_de"] is None and dist_m((s["lon"], s["lat"]), (v["lon"], v["lat"])) < 80:
                        s["duplicado_de"] = v["id"]
                        break

    # 5) agregados por municipio (simulados) + perfil de consumo
    por_muni = defaultdict(list)
    for s in sitios:
        por_muni[s["cod"]].append(s)
    salida_m = {}
    for cod, r in info.items():
        ss = por_muni.get(cod, [])
        if not ss:
            continue
        tm = tipo_muni(cod)
        smart = {"urbano": 0.78, "intermedio": 0.62, "rural": 0.45}[tm] + rnd.uniform(-0.06, 0.06)
        modem = {"urbano": 0.07, "intermedio": 0.05, "rural": 0.03}[tm] + rnd.uniform(-0.01, 0.01)
        basico = max(0.02, 1 - smart - modem)
        perfil = [{"perfil": n, "participacion_pct": round(p * 100, 1), "gb_mes": round(gb * rnd.uniform(0.75, 1.25), 1)}
                  for (n, gb), p in zip(PERFILES, [basico, smart, modem])]
        sesiones = sum(s["usuarios_atendidos"] for s in ss)
        salida_m[cod] = {
            "codigo_ine": cod, "municipio": r["municipio"], "departamento": r["departamento"], "tipo_zona": tm,
            "sitios": len(ss), "sitios_posicion_real": sum(1 for s in ss if s["posicion"].startswith("OpenCelliD")),
            "usuarios_soportados": sum(s["usuarios_soportados"] for s in ss),
            "usuarios_atendidos": sesiones,
            "usuarios_por_sitio": round(sesiones / len(ss)),
            "capacidad_max_mbps": round(sum(s["capacidad_max_mbps"] for s in ss)),
            "trafico_prom_mbps": round(sum(s["trafico_prom_mbps"] for s in ss)),
            "trafico_pico_mbps": round(sum(s["trafico_pico_mbps"] for s in ss)),
            "ocupacion_pico_pct": round(sum(s["trafico_pico_mbps"] for s in ss) / max(1, sum(s["capacidad_max_mbps"] for s in ss)) * 100, 1),
            "sitios_saturados": sum(1 for s in ss if s["ocupacion_pico_pct"] >= 85),
            "uso_prom_usuario_kbps": round(sum(s["trafico_prom_mbps"] for s in ss) * 1000 / max(1, sesiones), 1),
            "latencia_mediana_ms": round(statistics.median(s["latencia_ms"] for s in ss)),
            "fallas_caida_llamada": round(statistics.mean(s["fallas"]["caida_llamada"] for s in ss), 1),
            "fallas_sesion_datos": round(statistics.mean(s["fallas"]["sesion_datos_interrumpida"] for s in ss), 1),
            "fallas_fuera_servicio_h": round(statistics.mean(s["fallas"]["sitio_fuera_servicio_h_mes"] for s in ss), 1),
            "posibles_duplicados": sum(1 for s in ss if s["duplicado_de"]),
            "tecnologia_4g_pct": round(sum(1 for s in ss if "4G" in s["tec"]) / len(ss) * 100, 1),
            "gb_usuario_mes": round(sum(p["participacion_pct"] / 100 * p["gb_mes"] for p in perfil), 1),
            "perfil_consumo": perfil,
        }

    CAMPOS = ["id", "lon", "lat", "cod", "mnc", "tec", "posicion_real", "sectores", "bandas", "enlace_tipo", "enlace_mbps", "capacidad_max_mbps",
              "usuarios_soportados", "usuarios_atendidos", "trafico_prom_mbps", "trafico_pico_mbps", "ocupacion_pico_pct", "uso_prom_usuario_kbps",
              "latencia_ms", "caida_llamada", "sesion_datos_interrumpida", "fuera_servicio_h_mes", "radio_cobertura_m", "duplicado_de"]
    filas = [[s["id"], s["lon"], s["lat"], s["cod"], s["mnc"], "/".join(s["tec"]), 1 if s["posicion"].startswith("OpenCelliD") else 0, s["sectores"],
              " · ".join(s["bandas"]), s["enlace_tipo"], s["enlace_mbps"], s["capacidad_max_mbps"], s["usuarios_soportados"], s["usuarios_atendidos"],
              s["trafico_prom_mbps"], s["trafico_pico_mbps"], s["ocupacion_pico_pct"], s["uso_prom_usuario_kbps"], s["latencia_ms"],
              s["fallas"]["caida_llamada"], s["fallas"]["sesion_datos_interrumpida"], s["fallas"]["sitio_fuera_servicio_h_mes"], s["radio_cobertura_m"], s["duplicado_de"]]
             for s in sitios]
    (D / "sim_sitios.json").write_text(json.dumps({"simulado": True, "campos": CAMPOS, "filas": filas}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (D / "sim_municipios.json").write_text(json.dumps(salida_m, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    meta = {
        "simulado": True, "semilla": SEMILLA, "generado": date.today().isoformat(),
        "aviso": "DATOS SIMULADOS. No describen la red real. Muestran qué análisis serían posibles si los operadores entregaran estas métricas a la SIT.",
        "real": ["Posición, operador y tecnologías de los sitios que vienen de OpenCelliD (estimados)", "Población y área municipal", "Lugares poblados", "Radiobases SIT 2026-S1 (para cuántos sitios simular donde no hay celdas observadas)"],
        "simulado": ["Sitios en municipios sin celdas observadas", "Sectores", "Bandas", "Capacidad y tipo de enlace", "Tráfico promedio y pico", "Usuarios soportados y atendidos", "Latencia", "Fallas", "Perfil de consumo por dispositivo", "Radio de cobertura declarado", "Marcas de posible duplicidad"],
        "supuestos": {"capacidad_por_sector_mbps": CAP_SECTOR_MBPS, "usuarios_por_sector": USUARIOS_SECTOR, "penetracion_movil": PENETRACION,
                      "concurrencia_pico": CONCURRENCIA_PICO, "mbps_por_usuario_pico": MBPS_POR_USUARIO_PICO, "duplicado_si_mismo_operador_a_menos_de_m": 80},
        "demanda_por_zona": DEMANDA_ZONA, "sitios": len(sitios), "sitios_posicion_real": sum(1 for s in sitios if s["posicion"].startswith("OpenCelliD")),
        "municipios": len(salida_m),
    }
    (D / "sim_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print({k: meta[k] for k in ("sitios", "sitios_posicion_real", "municipios")})
    oc = [s["ocupacion_pico_pct"] for s in sitios]
    print("ocupación pico mediana", statistics.median(oc), "saturados>=85%", sum(1 for v in oc if v >= 85), "latencia mediana", statistics.median(s["latencia_ms"] for s in sitios), "duplicados", sum(1 for s in sitios if s["duplicado_de"]))
    print("tamaño", (D / "sim_sitios.json").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
