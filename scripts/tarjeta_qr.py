"""Tarjeta con el QR de SITMAP (1080 x 1350, PNG y PDF).

    python scripts/tarjeta_qr.py
"""
import io
import json
import math
from pathlib import Path

import segno
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
URL = "https://lemus-code.github.io/SITMAP/"
W, H = 1080, 1350
NAVY, NAVY2, ORO, BLANCO, GRIS = (11, 18, 32), (22, 36, 62), (242, 184, 75), (236, 241, 248), (150, 166, 192)
F = "C:/Windows/Fonts/"


def fuente(nombre, tam, peso=None):
    f = ImageFont.truetype(F + nombre, tam)
    if peso:
        try:
            f.set_variation_by_name(peso)
        except Exception:
            pass
    return f


def texto_centrado(d, y, partes, fnt):
    """partes = [(texto, color), ...] centradas en una línea."""
    ancho = sum(d.textlength(t, font=fnt) for t, _ in partes)
    x = (W - ancho) / 2
    for t, c in partes:
        d.text((x, y), t, font=fnt, fill=c)
        x += d.textlength(t, font=fnt)


def main():
    img = Image.new("RGB", (W, H), NAVY)
    # fondo: degradado radial suave
    glow = Image.new("RGB", (W, H), NAVY)
    gd = ImageDraw.Draw(glow)
    for r in range(900, 0, -12):
        t = r / 900
        c = tuple(int(NAVY2[i] * (1 - t) + NAVY[i] * t) for i in range(3))
        gd.ellipse([W / 2 - r, 560 - r, W / 2 + r, 560 + r], fill=c)
    img = glow.filter(ImageFilter.GaussianBlur(30))

    # silueta de Guatemala (bordes reales del KMZ), tenue, de fondo
    capa = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cd = ImageDraw.Draw(capa)
    b = json.loads((ROOT / "mapa" / "data" / "bordes.json").read_text(encoding="utf-8"))
    pais = next(f for f in b["features"] if f["properties"]["tipo"] == "pais")["geometry"]
    lineas = pais["coordinates"] if pais["type"] == "MultiLineString" else [pais["coordinates"]]
    pts = [p for l in lineas for p in l]
    lon0, lon1 = min(p[0] for p in pts), max(p[0] for p in pts)
    lat0, lat1 = min(p[1] for p in pts), max(p[1] for p in pts)
    k = math.cos(math.radians((lat0 + lat1) / 2))
    esc = 1050 / max((lon1 - lon0) * k, lat1 - lat0)
    ox = (W - (lon1 - lon0) * k * esc) / 2 + 40
    oy = 250
    for l in lineas:
        cd.line([(ox + (p[0] - lon0) * k * esc, oy + (lat1 - p[1]) * esc) for p in l], fill=ORO + (40,), width=3)
    img = Image.alpha_composite(img.convert("RGBA"), capa)
    d = ImageDraw.Draw(img)

    # franja de colores arriba (como el kit)
    franja = [(245, 166, 35), (240, 120, 40), (232, 68, 79), (217, 70, 160), (147, 72, 220), (46, 124, 246)]
    for i, c in enumerate(franja):
        d.rectangle([i * W / len(franja), 0, (i + 1) * W / len(franja), 12], fill=c)

    # etiqueta superior
    fe = fuente("bahnschrift.ttf", 26, "SemiBold")
    et = "DATATÓN INNOVACON 2026  ·  SIT GUATEMALA"
    tw = d.textlength(et, font=fe)
    d.rounded_rectangle([(W - tw) / 2 - 24, 62, (W + tw) / 2 + 24, 108], radius=23, outline=ORO, width=2)
    d.text(((W - tw) / 2, 70), et, font=fe, fill=ORO)

    # marca
    fm = fuente("bahnschrift.ttf", 190, "Bold")
    texto_centrado(d, 118, [("SIT", BLANCO), ("MAP", ORO)], fm)
    fs = fuente("bahnschrift.ttf", 40, "SemiBold")
    texto_centrado(d, 330, [("Observatorio Telecom GT", BLANCO)], fs)
    fs2 = fuente("segoeui.ttf", 30)
    texto_centrado(d, 382, [("Telefonía, internet y escuelas en los 340 municipios", GRIS)], fs2)

    # QR con marco dorado y brillo
    lado, y0 = 600, 450
    x0 = (W - lado) // 2
    sombra = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sombra).rounded_rectangle([x0 - 20, y0 - 20, x0 + lado + 20, y0 + lado + 20], radius=46, fill=ORO + (120,))
    img = Image.alpha_composite(img, sombra.filter(ImageFilter.GaussianBlur(28)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x0 - 14, y0 - 14, x0 + lado + 14, y0 + lado + 14], radius=40, fill=ORO)
    d.rounded_rectangle([x0, y0, x0 + lado, y0 + lado], radius=30, fill=(255, 255, 255))
    qr = segno.make(URL, error="h")
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=20, border=2, dark="#0b1220", light="#ffffff")
    buf.seek(0)
    q = Image.open(buf).convert("RGBA").resize((lado - 44, lado - 44), Image.NEAREST)
    img.paste(q, (x0 + 22, y0 + 22))
    # sello al centro (corrección de errores alta: el código sigue leyéndose)
    d = ImageDraw.Draw(img)
    s = 132
    cx, cy = W // 2, y0 + lado // 2
    d.rounded_rectangle([cx - s // 2 - 8, cy - s // 2 - 8, cx + s // 2 + 8, cy + s // 2 + 8], radius=26, fill=(255, 255, 255))
    d.rounded_rectangle([cx - s // 2, cy - s // 2, cx + s // 2, cy + s // 2], radius=22, fill=NAVY)
    fsel = fuente("bahnschrift.ttf", 46, "Bold")
    for txt, col, dy in (("SIT", BLANCO, -40), ("MAP", ORO, 2)):
        tw = d.textlength(txt, font=fsel)
        d.text((cx - tw / 2, cy + dy - 6), txt, font=fsel, fill=col)

    # llamado a la acción
    fc = fuente("bahnschrift.ttf", 52, "Bold")
    texto_centrado(d, 1092, [("Escaneá y explorá el mapa", BLANCO)], fc)

    # chips de lo que hay adentro
    fch = fuente("bahnschrift.ttf", 27, "SemiBold")
    chips = ["IDM por municipio", "Escuelas y cobertura", "Próximamente"]
    pad, gap = 22, 16
    anchos = [d.textlength(c, font=fch) + 2 * pad for c in chips]
    x = (W - (sum(anchos) + gap * (len(chips) - 1))) / 2
    for c, a in zip(chips, anchos):
        d.rounded_rectangle([x, 1172, x + a, 1220], radius=24, outline=GRIS, width=2)
        d.text((x + pad, 1180), c, font=fch, fill=BLANCO)
        x += a + gap

    # URL
    fu = fuente("consolab.ttf", 30)
    texto_centrado(d, 1258, [("lemus-code.github.io/", GRIS), ("SITMAP", ORO)], fu)

    out = img.convert("RGB")
    out.save(ROOT / "SITMAP_QR_tarjeta.png", optimize=True)
    out.save(ROOT / "SITMAP_QR_tarjeta.pdf", resolution=200)
    print("ok", out.size)


if __name__ == "__main__":
    main()
