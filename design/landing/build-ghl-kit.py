"""Builds ghl-kit.html from index.html (DECISIONS L-10).

The kit lists one block per landing section, each with a Copy button, ready to
paste into a GoHighLevel Custom Code element:

  0. Global CSS: paste once into the funnel step (Settings, Custom CSS, or one
     Custom Code element at the top of the page).
  1..n. One block per <header>, <section> and <footer>, each wrapped in
     <div class="vidrev-page"> so the colour tokens and font apply inside
     GoHighLevel. The section with the demo carries its own script.

Run: python design/landing/build-ghl-kit.py
"""

import html
import pathlib
import re

HERE = pathlib.Path(__file__).parent
SOURCE = (HERE / "index.html").read_text(encoding="utf-8")

css = re.search(r"<style>(.*?)</style>", SOURCE, re.S).group(1).strip()
fonts = '<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">'
script = re.search(r"<script>(.*?)</script>", SOURCE, re.S).group(1).strip()
page = re.search(r'<div class="vidrev-page">(.*)</div>\s*<script>', SOURCE, re.S).group(1)

# Each block starts at an HTML comment naming it, followed by one top-level element.
blocks = []
for match in re.finditer(r"<!--\s*(.*?)\s*-->\s*(<(header|section|footer)\b.*?</\3>)", page, re.S):
    title, body = match.group(1), match.group(2)
    blocks.append((title, body))
# The CSS travels inside the first block (the navigation), so there is no
# separate step that can be missed: GoHighLevel's Custom CSS field drops a
# <style> tag, a Custom Code element keeps it.
items = []
for i, (title, body) in enumerate(blocks):
    code = f'<div class="vidrev-page">\n{body}\n</div>'
    if i == 0:
        code = f"{fonts}\n<style>\n{css}\n</style>\n{code}"
        title += " (includes the CSS for the whole page: always the first block)"
    if 'id="vidrev-demo"' in body:
        code += f"\n<script>\n{script}\n</script>"
    items.append((title, code))

cards = []
for i, (title, code) in enumerate(items):
    cards.append(
        f'<article class="kit-card"><div class="kit-head"><h2>{html.escape(title)}</h2>'
        f'<button class="kit-copy" data-target="kit-{i}">Copy</button></div>'
        f'<details><summary>Show code ({len(code):,} characters)</summary><pre>{html.escape(code)}</pre></details>'
        f'<textarea id="kit-{i}" hidden>{html.escape(code)}</textarea></article>'
    )

kit = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>vidrev GHL kit</title>
<style>
body{{margin:0;font-family:"Segoe UI",system-ui,sans-serif;background:#F7F8FC;color:#0E1330}}
main{{max-width:960px;margin:0 auto;padding:32px 16px 64px;display:grid;gap:14px}}
h1{{margin:0 0 4px;font-size:28px}}
.kit-note{{margin:0 0 10px;color:#5B6178}}
.kit-card{{background:#fff;border:1px solid #E4E6EE;border-radius:14px;padding:16px 18px}}
.kit-head{{display:flex;justify-content:space-between;align-items:center;gap:12px}}
.kit-head h2{{margin:0;font-size:17px}}
.kit-copy{{font:inherit;font-weight:700;background:#D91E50;color:#fff;border:0;border-radius:10px;padding:10px 18px;cursor:pointer;white-space:nowrap}}
.kit-copy.kit-done{{background:#00B1B0}}
details{{margin-top:10px}} summary{{cursor:pointer;color:#5B6178;font-size:14px}}
pre{{max-height:320px;overflow:auto;background:#0E1330;color:#E4E6EE;padding:12px;border-radius:10px;font-size:12px;white-space:pre-wrap}}
</style></head><body><main>
<h1>vidrev landing: GoHighLevel kit</h1>
<p class="kit-note">Generated from design/landing/index.html. In GoHighLevel: one Custom Code element per block, in this order. The first block carries the CSS for the whole page, so it must be on the page, at the top.</p>
{''.join(cards)}
</main>
<script>
document.querySelectorAll(".kit-copy").forEach(function (b) {{
  b.addEventListener("click", function () {{
    var text = document.getElementById(b.dataset.target).value;
    navigator.clipboard.writeText(text).then(function () {{
      b.textContent = "Copied"; b.classList.add("kit-done");
      setTimeout(function () {{ b.textContent = "Copy"; b.classList.remove("kit-done"); }}, 1800);
    }});
  }});
}});
</script></body></html>
"""
(HERE / "ghl-kit.html").write_text(kit, encoding="utf-8")
print(f"{len(items)} blocks written to ghl-kit.html")
