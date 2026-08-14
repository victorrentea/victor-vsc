"""Builds icons/victor-icons.woff: one glyph, a six-petal flower, drawn on the
same grid as VS Code's codicon.ttf (upem 300, ascent 300, glyph box 0..282) so
it lines up with the built-in icons everywhere VS Code renders a ThemeIcon."""
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


def draw(pen):
    # Petals wind clockwise (filled in TrueType's non-zero rule), the heart
    # winds the other way so it punches a hole through their overlap.
    for i in range(N_PETALS):
        a = math.radians(90 + i * (360 / N_PETALS))
        ellipse(pen, C + PETAL_D * math.cos(a), C + PETAL_D * math.sin(a),
                PETAL_A, PETAL_B, a, clockwise=True)
    ellipse(pen, C, C, HEART_R, HEART_R, 0, clockwise=False)


pen = TTGlyphPen(None)
draw(pen)
flower = pen.glyph()

fb = FontBuilder(UPEM, isTTF=True)
order = [".notdef", "flower"]
fb.setupGlyphOrder(order)
fb.setupCharacterMap({0xE001: "flower"})
fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "flower": flower})
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
    svg = SVGPathPen(None)
    draw(svg)
    open(sys.argv[2], "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {UPEM} {UPEM}">'
        f'<g transform="translate(0,{UPEM}) scale(1,-1)">'
        f'<path fill="#D97757" fill-rule="nonzero" d="{svg.getCommands()}"/></g></svg>')
