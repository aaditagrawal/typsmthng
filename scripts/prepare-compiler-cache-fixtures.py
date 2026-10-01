"""Run with uv run --no-project --with fonttools==4.66.1 this-file."""
import hashlib
import json
from pathlib import Path
import unicodedata

from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
folder = root / ".compiler-perf"
original = folder / "fonts/DejaVuSansMono.ttf"
assert hashlib.sha256(original.read_bytes()).hexdigest() == "b4a6c3e4faab8773f4ff761d56451646409f29abedd68f05d38c2df667d3c582"
font = TTFont(original)
characters = [chr(c) for c in font.getBestCmap() if 160 <= c < 65536 and unicodedata.category(chr(c))[0] in "LNPS"]
assert len(characters) > 2048
(folder / "cache-churn-characters.json").write_text(json.dumps(" ".join(characters), ensure_ascii=False) + "\n")
# Same family, style, glyph IDs, and metrics, but a visibly different A outline.
# A cache keyed by font name or glyph ID would incorrectly reuse the old curve.
glyph = font["glyf"]["A"]
glyph.coordinates = type(glyph.coordinates)((round(x * 0.7), y) for x, y in glyph.coordinates)
glyph.recalcBounds(font["glyf"])
font.save(folder / "cache-modified-font.ttf")
print(f"Prepared {len(characters)} distinct mapped characters and a changed font outline")
