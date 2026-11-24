"""Arma los límites municipales y la capa de lugares poblados a partir de los KMZ.

Uso:
    python scripts/construir_limites.py

Entradas:
    KMZ/Copia de Municipios.kmz              polígonos municipales (división anterior a 2014, con código)
    KMZ/Copia de Lugares Poblados 2026.kmz   puntos de lugares poblados
    piloto-dashboard/data.js                 límites del piloto (solo para los 7 municipios creados después)
    datos/catalogo_municipios.csv            340 municipios con código INE

Salidas (en mapa/data/):
    limites_municipales.json   GeoJSON de 340 municipios + lagos
    lugares_poblados.json      [[lon, lat, categoria, nombre, codigo_ine], ...]
    lugares_por_municipio.json {codigo_ine: {total, por categoría}}
"""
import csv
import json
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET

from shapely.geometry import MultiPolygon, Polygon, Point, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
K = "{http://www.opengis.net/kml/2.2}"
OUT = ROOT / "mapa" / "data"
NUEVOS = ["GT0514", "GT1021", "GT1230", "GT1333", "GT1713", "GT1714", "GT1911"]  # creados 2014-2019


def atributos(desc):
    celdas = re.findall(r"<td>(.*?)</td>", desc or "", re.S)
    return {k.strip(): v.strip() for k, v in zip(celdas[1::2], celdas[2::2])}


def anillo(texto):
    return [tuple(map(float, c.split(",")[:2])) for c in texto.split()]


def poligonos_de(pm):
    polys = []
    for pg in pm.iter(K + "Polygon"):
        ext = pg.find(f"{K}outerBoundaryIs/{K}LinearRing/{K}coordinates")
        huecos = [anillo(h.text) for h in pg.findall(f"{K}innerBoundaryIs/{K}LinearRing/{K}coordinates")]
        p = Polygon(anillo(ext.text), huecos)
        polys.append(p if p.is_valid else p.buffer(0))
    return unary_union(polys)


def kml_de(kmz):
    z = zipfile.ZipFile(kmz)
    return z.open(next(n for n in z.namelist() if n.endswith(".kml")))


def limpiar(g):
    g = g.buffer(0)
    if g.geom_type == "GeometryCollection":
        g = unary_union([x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")])
    if g.geom_type == "Polygon":
        g = MultiPolygon([g])
    return MultiPolygon([p for p in g.geoms if p.area > 1e-8])


def redondear(geo, nd=5):
    def r(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [r(x) for x in c]
    geo["coordinates"] = r(geo["coordinates"])
    return geo


def main():
    cat = {r["codigo_ine"]: r for r in csv.DictReader(open(ROOT / "datos" / "catalogo_municipios.csv", encoding="utf-8-sig"))}

    # 1. municipios del KMZ
    kmz = defaultdict(list)
    lagos = {}
    for _, el in ET.iterparse(kml_de(ROOT / "KMZ" / "Copia de Municipios.kmz")):
        if el.tag != K + "Placemark":
            continue
        a = atributos(el.findtext(K + "description"))
        cod = "GT%04d" % int(a["Codigo"])
        g = poligonos_de(el)
        if cod == "GT2000":          # Belice: fuera del mapa
            pass
        elif cod == "GT0000":        # Lago de Amatitlán
            lagos["GT0100"] = g
        else:
            kmz[cod].append(g)
        el.clear()
    geom = {c: limpiar(unary_union(gs)) for c, gs in kmz.items()}
    pais = unary_union(list(geom.values()))
    print("KMZ:", len(geom), "municipios")

    # 2. municipios nuevos: forma del piloto recortada al borde preciso del país, y se quita de su municipio de origen
    s = (ROOT / "piloto-dashboard" / "data.js").read_text(encoding="utf-8")
    piloto = {f["properties"]["id"]: shape(f["geometry"]).buffer(0) for f in json.loads(s[s.index("{"):s.rindex("}") + 1])["geo"]["features"]}
    origen = {}
    for nuevo in NUEVOS:
        hijo = piloto[nuevo].intersection(pais)
        padres = [c for c, g in geom.items() if g.intersection(hijo).area > 0.2 * hijo.area]
        for c in list(geom):
            if geom[c].intersects(hijo):
                geom[c] = limpiar(geom[c].difference(hijo))
        geom[nuevo] = limpiar(hijo)
        origen[nuevo] = padres
        print(f"  {nuevo} {cat[nuevo]['municipio']}: recortado de {[cat[p]['municipio'] for p in padres]}")

    # 3. Lago de Atitlán: el hueco que dejan los municipios del KMZ dentro del lago del piloto
    if "GT0700" in piloto:
        atit = piloto["GT0700"].difference(unary_union(list(geom.values())))
        if atit.area > 0.5 * piloto["GT0700"].area:
            lagos["GT0700"] = atit

    faltan = [c for c in cat if c not in geom]
    assert not faltan, faltan

    feats = []
    for c in sorted(geom):
        g = geom[c].simplify(0.00015, preserve_topology=True)
        feats.append({"type": "Feature", "properties": {"id": c, "lake": False, "municipio": cat[c]["municipio"], "departamento": cat[c]["departamento"],
                                                         "fuente": "KMZ Municipios" if c not in NUEVOS else "Piloto recortado al KMZ (municipio creado después de la cartografía)"},
                      "geometry": redondear(mapping(g))})
    for c, g in lagos.items():
        feats.append({"type": "Feature", "properties": {"id": c, "lake": True}, "geometry": redondear(mapping(limpiar(g).simplify(0.00015)))})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "limites_municipales.json").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("límites:", len(feats), "polígonos", (OUT / "limites_municipales.json").stat().st_size // 1024, "KB")

    # bordes de departamento y de país (líneas), calculados de la unión de municipios
    por_dep = defaultdict(list)
    for c, g in geom.items():
        por_dep[c[:4]].append(g)
    bordes = []
    for d, gs in sorted(por_dep.items()):
        u = unary_union(gs).buffer(0.0004).buffer(-0.0004)   # cierra rendijas mínimas entre polígonos
        bordes.append({"type": "Feature", "properties": {"tipo": "departamento", "cod": d, "nombre": cat[next(c for c in cat if c.startswith(d))]["departamento"]},
                       "geometry": redondear(mapping(u.boundary.simplify(0.00015)))})
    nacional = unary_union(list(geom.values())).buffer(0.0004).buffer(-0.0004)
    bordes.append({"type": "Feature", "properties": {"tipo": "pais"}, "geometry": redondear(mapping(nacional.boundary.simplify(0.00015)))})
    (OUT / "bordes.json").write_text(json.dumps({"type": "FeatureCollection", "features": bordes}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("bordes:", (OUT / "bordes.json").stat().st_size // 1024, "KB")

    # 4. lugares poblados: cada punto se asigna al municipio que lo contiene
    codigos = sorted(geom)
    arbol = STRtree([geom[c] for c in codigos])
    puntos, por_muni, fuera = [], defaultdict(Counter), 0
    for _, el in ET.iterparse(kml_de(ROOT / "KMZ" / "Copia de Lugares Poblados 2026.kmz")):
        if el.tag != K + "Placemark":
            continue
        a = atributos(el.findtext(K + "description"))
        xy = el.findtext(f"{K}Point/{K}coordinates")
        el.clear()
        if not xy:
            continue
        lon, lat = map(float, xy.split(",")[:2])
        pt = Point(lon, lat)
        idx = arbol.query(pt, predicate="intersects")
        if len(idx) == 0:
            idx = [arbol.nearest(pt)]
            if geom[codigos[idx[0]]].distance(pt) > 0.01:
                fuera += 1
                continue
        cod = codigos[idx[0]]
        categoria = (a.get("categoria") or "OTRA").upper() or "OTRA"
        puntos.append([round(lon, 5), round(lat, 5), categoria, (a.get("lugar_pobl") or "").strip().title(), cod])
        por_muni[cod][categoria] += 1
    (OUT / "lugares_poblados.json").write_text(json.dumps(puntos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    resumen = {c: {"total": sum(v.values()), **dict(v)} for c, v in por_muni.items()}
    (OUT / "lugares_por_municipio.json").write_text(json.dumps(resumen, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("lugares poblados:", len(puntos), "asignados;", fuera, "fuera del país;", len(resumen), "municipios con lugares")
    print("  municipios nuevos:", {c: resumen.get(c, {}).get("total", 0) for c in NUEVOS})


if __name__ == "__main__":
    main()
