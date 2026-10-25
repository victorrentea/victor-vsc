"""Builds icons/victor-icons.woff: a six-petal flower (U+E001), two coins
(U+E002), a crosshair (U+E003), a picture (U+E004), Clawd, the Claude Code
mascot (U+E005) and unwrap (U+E006), the opposite of $(word-wrap), drawn on the same grid
as VS Code's codicon.ttf (upem 300, ascent 300, glyph box 0..282) so they line up with the
built-in icons everywhere VS Code renders a ThemeIcon."""
import math, re, sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.svgPathPen import SVGPathPen

UPEM = 300
C = 141.0            # icon centre; codicon glyphs span 0..282
PETAL_A = 60.0       # petal half-length, along the radius
PETAL_B = 32.0       # petal half-width; 2*B < D leaves a notch between petals
PETAL_D = 78.0       # petal centre distance from the flower centre
HEART_R = 32.0       # the hole in the middle
N_PETALS = 6
K = 1 / math.cos(math.radians(22.5))   # off-curve radius for an 8-segment circle


def ellipse(pen, cx, cy, a, b, rot, clockwise):
    """A circle stretched to a*b and rotated — an affine map, so the 8-segment
    quadratic approximation of a circle survives it unchanged."""
    def pt(scale, deg):
        t = math.radians(deg if clockwise is False else -deg)
        x, y = a * scale * math.cos(t), b * scale * math.sin(t)
        return (round(cx + x * math.cos(rot) - y * math.sin(rot)),
                round(cy + x * math.sin(rot) + y * math.cos(rot)))
    pen.moveTo(pt(1, 0))
    for i in range(8):
        pen.qCurveTo(pt(K, i * 45 + 22.5), pt(1, (i + 1) * 45))
    pen.closePath()


COIN_R_OUT = 78.0    # coin outer radius
COIN_R_IN = 46.0     # the hole: 32 units of ink ≈ 1.5px de contur la 14px
COIN_OFF = 48.0      # each coin's offset from the centre, on the diagonal


def draw(pen):
    # Petals wind clockwise (filled in TrueType's non-zero rule), the heart
    # winds the other way so it punches a hole through their overlap.
    for i in range(N_PETALS):
        a = math.radians(90 + i * (360 / N_PETALS))
        ellipse(pen, C + PETAL_D * math.cos(a), C + PETAL_D * math.sin(a),
                PETAL_A, PETAL_B, a, clockwise=True)
    ellipse(pen, C, C, HEART_R, HEART_R, 0, clockwise=False)


def draw_coins(pen):
    """Two rings on the ↗ diagonal, overlapping just enough to touch: the
    offset is picked so the outer circles cross by ~9 units, which at 16px is
    the width of the contact point and not a merged blob."""
    for dx, dy in ((-COIN_OFF, COIN_OFF), (COIN_OFF, -COIN_OFF)):
        ellipse(pen, C + dx, C + dy, COIN_R_OUT, COIN_R_OUT, 0, clockwise=True)
        ellipse(pen, C + dx, C + dy, COIN_R_IN, COIN_R_IN, 0, clockwise=False)


CROSS_R_OUT = 88.0   # inelul din mijloc
CROSS_R_IN = 64.0    # 24 de unități de contur ≈ 1.1px la 14px, ca la codicon-uri
CROSS_DOT = 20.0     # punctul din centru
CROSS_TICK_IN = 82.0 # gradațiile pornesc din inel (suprapunere, ca să nu apară fantă)
CROSS_TICK_OUT = 138.0
CROSS_TICK_W = 12.0  # jumătate de lățime


def rect(pen, x0, y0, x1, y1):
    """Dreptunghi bobinat în sensul acelor de ceas — adică umplut, ca elipsele
    de mai sus: în spațiul fontului (y în sus) sus→dreapta→jos→stânga."""
    pen.moveTo((round(x0), round(y0)))
    pen.lineTo((round(x0), round(y1)))
    pen.lineTo((round(x1), round(y1)))
    pen.lineTo((round(x1), round(y0)))
    pen.closePath()


def draw_crosshair(pen):
    """Ținta din toolbarul IntelliJ („Select Opened File"): inel, punct în
    centru, patru gradații pe axe. Punctul e bobinat ca inelul exterior, deci
    în gaura inelului (winding -1) suma redevine +1 și se umple."""
    ellipse(pen, C, C, CROSS_R_OUT, CROSS_R_OUT, 0, clockwise=True)
    ellipse(pen, C, C, CROSS_R_IN, CROSS_R_IN, 0, clockwise=False)
    ellipse(pen, C, C, CROSS_DOT, CROSS_DOT, 0, clockwise=True)
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if sx:
            x0, x1 = C + sx * CROSS_TICK_IN, C + sx * CROSS_TICK_OUT
            rect(pen, min(x0, x1), C - CROSS_TICK_W, max(x0, x1), C + CROSS_TICK_W)
        else:
            y0, y1 = C + sy * CROSS_TICK_IN, C + sy * CROSS_TICK_OUT
            rect(pen, C - CROSS_TICK_W, min(y0, y1), C + CROSS_TICK_W, max(y0, y1))


PIC_X0, PIC_Y0, PIC_X1, PIC_Y1 = 18.0, 46.0, 264.0, 236.0   # rama, peisaj culcat
PIC_W = 18.0         # grosimea ramei ≈ 1px la 16px, ca liniile codicon-urilor
PIC_SUN = (196.0, 170.0, 20.0)


def poly(pen, pts):
    """Poligon dat în sensul acelor de ceas (y în sus) — deci umplut."""
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()


def draw_picture(pen):
    """O poză și atât: ramă, soare, doi munți — forma randată, opusă lui
    $(file-text) (forma textuală) pe butonul ⇄. Rama goală e un dreptunghi
    plin cu o gaură bobinată invers; soarele și munții, bobinați ca rama, se
    umplu în gaură. Baza munților coboară în latura de jos a ramei, ca să nu
    rămână fantă între ei."""
    rect(pen, PIC_X0, PIC_Y0, PIC_X1, PIC_Y1)
    ix0, iy0, ix1, iy1 = PIC_X0 + PIC_W, PIC_Y0 + PIC_W, PIC_X1 - PIC_W, PIC_Y1 - PIC_W
    pen.moveTo((round(ix0), round(iy0)))
    pen.lineTo((round(ix1), round(iy0)))
    pen.lineTo((round(ix1), round(iy1)))
    pen.lineTo((round(ix0), round(iy1)))
    pen.closePath()
    ellipse(pen, *PIC_SUN[:2], PIC_SUN[2], PIC_SUN[2], 0, clockwise=True)
    base = PIC_Y0 + PIC_W / 2
    poly(pen, [(round(ix0), round(base)), (round(ix0), 96), (104, 160), (150, 112),
               (186, 140), (round(ix1), 84), (round(ix1), round(base))])


# Clawd, omulețul din Claude Code, copiat pixel cu pixel după cum îl desenează
# CLI-ul în terminal, din sferturi de bloc:
#    ▐▛███▜▌
#   ▝▜█████▛▘
#     ▘▘ ▝▝
# Un sfert de celulă de terminal e de două ori mai înalt decât lat, deci pixelul
# de aici e CLAWD_PX × 2·CLAWD_PX. Ochii sunt cele două sferturi lipsă din ▛ și ▜.
CLAWD = [
    "...############...",
    "...##.######.##...",
    ".################.",
    "...############...",
    "....#.#....#.#....",
]
CLAWD_PX = 16.0      # 18 coloane × 16 = 288 ≈ cutia de 282; rândurile au 32


def draw_clawd(pen):
    """Fiecare rând se umple în segmente orizontale; segmentele vecine pe
    verticală se suprapun 1 unitate, ca să nu apară fante la rasterizare."""
    w = len(CLAWD[0]) * CLAWD_PX
    x_off = C - w / 2
    y_top = C + len(CLAWD) * CLAWD_PX     # rândurile au 2·CLAWD_PX, centrate pe C
    for r, row in enumerate(CLAWD):
        y1 = y_top - r * 2 * CLAWD_PX
        for m in re.finditer(r"#+", row):
            rect(pen, x_off + m.start() * CLAWD_PX, y1 - 2 * CLAWD_PX - 1,
                 x_off + m.end() * CLAWD_PX, y1)


# „ab" exact ca în $(word-wrap) din codicon.ttf (CC BY 4.0), pe aceleași
# coordonate, ca cele două butoane de wrap/unwrap să fie de aceeași mărime.
WRAP_A = [
    [("moveTo", (94, 178)), ("lineTo", (94, 230)), ("qCurveTo", (94, 243), (74, 258), (61, 258)),
     ("qCurveTo", (50, 258), (43, 255)),
     ("qCurveTo", (38, 253), (33, 248), (33, 240), (38, 234), (46, 234), (52, 239), (61, 239)),
     ("qCurveTo", (65, 239), (68, 238)), ("qCurveTo", (75, 236), (75, 230)), ("lineTo", (75, 224)),
     ("qCurveTo", (69, 225), (61, 225)),
     ("qCurveTo", (43, 225), (23, 208), (23, 186), (43, 169), (61, 169)),
     ("qCurveTo", (70, 169), (78, 172)), ("qCurveTo", (80, 169), (88, 169), (94, 174), (94, 178))],
    [("moveTo", (61, 206)), ("qCurveTo", (69, 206), (75, 205)), ("lineTo", (75, 191)),
     ("qCurveTo", (71, 187), (52, 187), (42, 193), (42, 201), (52, 206), (61, 206))],
]
WRAP_B = [
    [("moveTo", (150, 169)), ("qCurveTo", (166, 169), (188, 193), (188, 228), (166, 253), (150, 253)),
     ("qCurveTo", (140, 253), (131, 247)), ("lineTo", (131, 272)),
     ("qCurveTo", (131, 276), (126, 281), (118, 281), (113, 276), (113, 272)), ("lineTo", (113, 178)),
     ("qCurveTo", (113, 174), (118, 169), (125, 169), (130, 172), (131, 175)),
     ("qCurveTo", (140, 169), (150, 169))],
    [("moveTo", (150, 234)),
     ("qCurveTo", (158, 234), (169, 221), (169, 201), (158, 187), (142, 187), (131, 201), (131, 221),
      (142, 234), (150, 234))],
]
# $(arrow-small-right), ca săgeata să aibă grosimea și vârful codicon-urilor
ARROW_R = [
    [("moveTo", (166, 115)), ("lineTo", (204, 153)), ("qCurveTo", (206, 155), (206, 163), (204, 166)),
     ("lineTo", (166, 203)), ("qCurveTo", (163, 206), (155, 206), (150, 201), (150, 193), (153, 190)),
     ("lineTo", (174, 169)), ("lineTo", (84, 169)),
     ("qCurveTo", (80, 169), (75, 163), (75, 155), (80, 150), (84, 150)),
     ("lineTo", (174, 150)), ("lineTo", (153, 129)),
     ("qCurveTo", (150, 126), (150, 118), (155, 112), (163, 112), (166, 115))],
]

UNWRAP_O = (232.0, 213.5, 32.0, 44.5)   # litera tăiată: centru, raze (cât „c"-ul din $(word-wrap))
UNWRAP_STROKE = 19.0                     # grosimea liniilor din codicon
UNWRAP_CUT = 0.6                         # cât rămâne din literă, din lățime
UNWRAP_BAR = (250.0, 266.0)              # marginea editorului; golul de 12 o ține departe de literă
UNWRAP_ARROW_TIP = 236.0                 # săgeata se oprește înainte de margine


def contours(pen, cs, fx=lambda x: x, dy=0):
    for c in cs:
        for op, *pts in c:
            pts = [(round(fx(x)), round(y + dy)) for x, y in pts]
            getattr(pen, op)(*pts)
        pen.closePath()


def arc(pen, cx, cy, a, b, t0, t1, n=4):
    """Arc de elipsă de la t0 la t1 (grade), din n bucăți pătratice; punctul de
    control e la mijlocul unghiului, la raza r/cos(Δ/2), ca la ellipse()."""
    d = (t1 - t0) / n
    k = 1 / math.cos(math.radians(d / 2))
    def pt(t, s=1.0):
        t = math.radians(t)
        return (round(cx + a * s * math.cos(t)), round(cy + b * s * math.sin(t)))
    for i in range(n):
        pen.qCurveTo(pt(t0 + (i + 0.5) * d, k), pt(t0 + (i + 1) * d))


def draw_unwrap(pen):
    """Opusul lui $(word-wrap): rândul „ab…" nu se mai frânge, ci dă de
    marginea editorului, bara verticală. Litera de lângă ea e tăiată drept la
    60%: o literă închisă („o"), ca tăietura să treacă prin gaura ei și să se
    vadă că lipsește o bucată — un „c" tăiat arată tot ca un „c" (e deschis
    exact în partea aia), iar lipit de bară se citea „d". Dedesubt, pe rândul
    lui „c↲", o săgeată într-un singur sens, spre dreapta: rândul continuă."""
    contours(pen, WRAP_A)
    contours(pen, WRAP_B)
    cx, cy, rx, ry = UNWRAP_O
    ix, iy = rx - UNWRAP_STROKE, ry - UNWRAP_STROKE
    cut = rx * (2 * UNWRAP_CUT - 1)               # tăietura, față de centru
    to = math.degrees(math.acos(cut / rx))        # unde taie inelul exterior
    ti = math.degrees(math.acos(cut / ix))        # și pe cel interior (cut < ix)
    # un singur contur, în sensul acelor (y în sus): exteriorul de jos, prin
    # stânga, până sus; tăietura în jos până în gaură; interiorul înapoi, invers
    pen.moveTo((round(cx + cut), round(cy - ry * math.sin(math.radians(to)))))
    arc(pen, cx, cy, rx, ry, 360 - to, to)
    pen.lineTo((round(cx + cut), round(cy + iy * math.sin(math.radians(ti)))))
    arc(pen, cx, cy, ix, iy, ti, 360 - ti)
    pen.closePath()
    rect(pen, UNWRAP_BAR[0], 19, UNWRAP_BAR[1], 281)
    # coada săgeții mutată la începutul lui „a", vârful lângă bară
    contours(pen, ARROW_R,
             fx=lambda x: x + (23 - 75 if x < 150 else UNWRAP_ARROW_TIP - 206), dy=-94)


def glyph(fn):
    pen = TTGlyphPen(None)
    fn(pen)
    return pen.glyph()


fb = FontBuilder(UPEM, isTTF=True)
order = [".notdef", "flower", "coins", "crosshair", "picture", "clawd", "unwrap"]
fb.setupGlyphOrder(order)
fb.setupCharacterMap({0xE001: "flower", 0xE002: "coins", 0xE003: "crosshair",
                       0xE004: "picture", 0xE005: "clawd", 0xE006: "unwrap"})
fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(),
              "flower": glyph(draw), "coins": glyph(draw_coins),
              "crosshair": glyph(draw_crosshair), "picture": glyph(draw_picture),
              "clawd": glyph(draw_clawd), "unwrap": glyph(draw_unwrap)})
fb.setupHorizontalMetrics({g: (UPEM, 0) for g in order})
fb.setupHorizontalHeader(ascent=UPEM, descent=0)
fb.setupNameTable({"familyName": "victor-icons", "styleName": "Regular",
                   "psName": "victor-icons", "version": "1.0"})
fb.setupOS2(sTypoAscender=UPEM, sTypoDescender=0, usWinAscent=UPEM, usWinDescent=0)
fb.setupPost()
fb.font.flavor = "woff"
fb.save(sys.argv[1])
print("wrote", sys.argv[1])

if len(sys.argv) > 2:      # proof sheet: the very contours that went into the font
    paths = []
    FNS = (draw, draw_coins, draw_crosshair, draw_picture, draw_clawd, draw_unwrap)
    for i, fn in enumerate(FNS):
        svg = SVGPathPen(None)
        fn(svg)
        paths.append(f'<g transform="translate({i * UPEM},{UPEM}) scale(1,-1)">'
                     f'<path fill="#D97757" fill-rule="nonzero" d="{svg.getCommands()}"/></g>')
    open(sys.argv[2], "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {len(FNS) * UPEM} {UPEM}">'
        + "".join(paths) + '</svg>')
