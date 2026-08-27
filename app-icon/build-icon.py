#!/usr/bin/env python3
"""
Generează iconița aplicației VS Code: pătrat negru cu o margine subțire
colorată pe periferie, în cheia iconiței de IntelliJ IDEA, dar la jumătate
din grosime.

Măsurat pe `idea.icns` (1024px): tile-ul stă în caseta 100..924 și banda
colorată e de 148px. Aici o ținem la 74 — de-aia „2x mai subțire".

Ieșiri: app-icon/Code.png (1024, pentru preview) și app-icon/Code.icns
(instalat de vscode-patch/apply.sh peste Contents/Resources/Code.icns).

    ./build-icon.py
"""
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))

S = 1024
TILE0, TILE1 = 100, 924  # aceeași casetă ca la IntelliJ, ca să arate la fel în Dock
R_OUT = 184              # raza colțurilor tile-ului
BORDER = 74              # jumătate din cei 148px ai lui IntelliJ
SS = 2                   # supersampling, pentru margini curate la downscale
RIBBON_FRACTION = 0.46   # cât din tile ocupă sigla VS Code

# Sigla oficială VS Code, pe un viewBox 100x100. Triunghiul din coadă e o
# gaură — se randează doar cu fill-rule evenodd.
VSCODE_PATH = (
    "M70.9119 99.3171C72.4869 99.9307 74.2828 99.8914 75.8725 99.1264L96.4608 89.2197C98.6242 "
    "88.1787 100 85.9892 100 83.5872V16.4133C100 14.0113 98.6243 11.8218 96.4609 10.7808L75.8725 "
    "0.873756C73.7862 -0.130129 71.3446 0.11576 69.5135 1.44695C69.252 1.63711 69.0028 1.84943 "
    "68.769 2.08341L29.3551 38.0415L12.1872 25.0096C10.589 23.7965 8.35363 23.8959 6.86933 "
    "25.2461L1.36303 30.2549C-0.451465 31.9064 -0.4536 34.7628 1.35853 36.417L16.2471 50.0001L1.35853 "
    "63.5832C-0.4536 65.2374 -0.451465 68.0938 1.36303 69.7453L6.86933 74.7541C8.35363 76.1043 "
    "10.589 76.2037 12.1872 74.9906L29.3551 61.9587L68.769 97.9167C69.3925 98.5406 70.1246 99.0104 "
    "70.9119 99.3171ZM75.0152 27.2989L45.1091 50.0001L75.0152 72.7012V27.2989Z"
)

# Culorile citite direct din idea.icns (colț cu colț).
PALETTE = dict(pink=(254, 40, 87), blue=(0, 126, 255),
               orange_tl=(254, 111, 40), orange_br=(255, 129, 0))


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def gradient(size):
    """Roz -> albastru pe antidiagonală, cu pene portocalii pe diagonala mare.

    E reconstrucția fondului de la IntelliJ: colț stânga-sus și dreapta-jos
    portocalii, dreapta-sus albastru, stânga-jos roz, cu violet la mijloc.
    """
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + (size - y)) / (2.0 * size)
            base = lerp(PALETTE["pink"], PALETTE["blue"], smooth((t - 0.15) / 0.7))
            wedge = smooth(1 - (abs(x - y) / float(size)) / 0.35)
            orange = lerp(PALETTE["orange_tl"], PALETTE["orange_br"], (x + y) / (2.0 * size))
            px[x, y] = lerp(base, orange, wedge)
    return img


def ribbon(size, tmp):
    svg = os.path.join(tmp, "ribbon.svg")
    png = os.path.join(tmp, "ribbon.png")
    open(svg, "w").write(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
        f'width="{size}" height="{size}">'
        f'<path d="{VSCODE_PATH}" fill="#ffffff" fill-rule="evenodd"/></svg>'
    )
    subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), svg, "-o", png], check=True)
    return Image.open(png).convert("RGBA")


def render(tmp):
    s, t0, t1 = S * SS, TILE0 * SS, TILE1 * SS
    r, b = R_OUT * SS, BORDER * SS
    side = t1 - t0

    tile = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, side - 1, side - 1], radius=r, fill=255)
    tile.paste(gradient(side), (0, 0), mask)

    ImageDraw.Draw(tile).rounded_rectangle(
        [b, b, side - 1 - b, side - 1 - b], radius=r - b, fill=(0, 0, 0, 255))

    rib_size = int(side * RIBBON_FRACTION)
    tile.alpha_composite(ribbon(rib_size, tmp), ((side - rib_size) // 2,) * 2)

    # Umbra moale pe care o au toate iconițele macOS; fără ea tile-ul negru
    # se lipește de fundalurile închise din Dock.
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [t0, t0 + 10 * SS, t1, t1 + 10 * SS], radius=r, fill=(0, 0, 0, 70))
    out.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14 * SS)))
    out.alpha_composite(tile, (t0, t0))
    return out.resize((S, S), Image.LANCZOS)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        icon = render(tmp)
        icon.save(os.path.join(HERE, "Code.png"))

        iconset = os.path.join(tmp, "Code.iconset")
        os.mkdir(iconset)
        for size in (16, 32, 128, 256, 512):
            icon.resize((size, size), Image.LANCZOS).save(
                os.path.join(iconset, f"icon_{size}x{size}.png"))
            icon.resize((size * 2, size * 2), Image.LANCZOS).save(
                os.path.join(iconset, f"icon_{size}x{size}@2x.png"))
        subprocess.run(["iconutil", "-c", "icns", iconset,
                        "-o", os.path.join(tmp, "Code.icns")], check=True)
        shutil.copy2(os.path.join(tmp, "Code.icns"), os.path.join(HERE, "Code.icns"))
    print("app-icon/Code.png + app-icon/Code.icns")


if __name__ == "__main__":
    main()
