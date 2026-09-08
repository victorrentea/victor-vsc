"""Builds icons/victor-icons.woff: a six-petal flower (U+E001), two coins
(U+E002) and a crosshair (U+E003), drawn on the same grid as VS Code's
codicon.ttf (upem 300, ascent 300, glyph box 0..282) so they line up with the
built-in icons everywhere VS Code renders a ThemeIcon."""
import math, sys
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


def glyph(fn):
    pen = TTGlyphPen(None)
    fn(pen)
    return pen.glyph()


fb = FontBuilder(UPEM, isTTF=True)
order = [".notdef", "flower", "coins", "crosshair"]
fb.setupGlyphOrder(order)
fb.setupCharacterMap({0xE001: "flower", 0xE002: "coins", 0xE003: "crosshair"})
fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(),
              "flower": glyph(draw), "coins": glyph(draw_coins),
              "crosshair": glyph(draw_crosshair)})
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
    for i, fn in enumerate((draw, draw_coins, draw_crosshair)):
        svg = SVGPathPen(None)
        fn(svg)
        paths.append(f'<g transform="translate({i * UPEM},{UPEM}) scale(1,-1)">'
                     f'<path fill="#D97757" fill-rule="nonzero" d="{svg.getCommands()}"/></g>')
    open(sys.argv[2], "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {3 * UPEM} {UPEM}">'
        + "".join(paths) + '</svg>')
