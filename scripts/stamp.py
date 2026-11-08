"""Stamp every module/stylesheet reference with a content hash (?v=...) so browsers never mix old and new files
after an update. Run from the repo root before committing site changes: python scripts/stamp.py"""
import hashlib
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
files = sorted(root.glob("js/**/*.js")) + [root / "css/app.css"]
strip = re.compile(r"\?v=[0-9a-f]+")
h = hashlib.sha1()
for f in files:
    h.update(strip.sub("", f.read_text()).encode())
v = h.hexdigest()[:10]

spec = re.compile(r"""((?:from\s+|import\s*\(\s*)['"])(\.{1,2}/[^'"?]+\.js)(?:\?v=[0-9a-f]+)?(['"])""")
for f in sorted(root.glob("js/**/*.js")):
    s = f.read_text()
    n = spec.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}", s)
    if n != s:
        f.write_text(n)
idx = root / "index.html"
s = idx.read_text()
s = re.sub(r'(href="css/app\.css)(?:\?v=[0-9a-f]+)?(")', rf"\1?v={v}\2", s)
s = re.sub(r'(src="js/app\.js)(?:\?v=[0-9a-f]+)?(")', rf"\1?v={v}\2", s)
idx.write_text(s)
print("stamped", v)
