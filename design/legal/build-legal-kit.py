"""Builds legal-kit.html: the Privacy Policy and the Terms as paste-ready blocks.

Source of the text: docs/compliance/PRIVACY-POLICY.md and TERMS.md. Source of
the operator's legal data: docs/compliance/legal-entity.json, the only place it
lives. The text is the same for any company form (US LLC, UK Ltd, HK Ltd, Kft);
a new company means editing the JSON and running this again.

Each block is one self-contained Custom Code element (styles inside, scoped to
.vidrev-legal), for the pages vidrev.app/privacy and vidrev.app/terms.

Run: python design/legal/build-legal-kit.py
"""

import html
import json
import pathlib
import re

HERE = pathlib.Path(__file__).parent
DOCS = HERE.parent.parent / "docs" / "compliance"
entity = json.loads((DOCS / "legal-entity.json").read_text(encoding="utf-8"))

missing = [k for k in ("name", "address", "governing_law", "effective_date") if not entity.get(k, "").strip()]
parts = [entity.get(k, "").strip() for k in ("name", "type")]
operator = ", ".join(p for p in parts if p) or "the operator of vidrev"
if entity.get("reg_number", "").strip():
    operator += f" (registration number {entity['reg_number'].strip()})"
if entity.get("address", "").strip():
    operator += f", {entity['address'].strip()}"
TOKENS = {
    "OPERATOR": operator,
    "OPERATOR_NAME": entity.get("name", "").strip() or "the operator of vidrev",
    "CONTACT_EMAIL": entity.get("contact_email", "").strip(),
    "GOVERNING_LAW": entity.get("governing_law", "").strip() or "[GOVERNING LAW]",
    "EFFECTIVE_DATE": entity.get("effective_date", "").strip() or "[EFFECTIVE DATE]",
}


def inline(text: str) -> str:
    out = html.escape(text, quote=False)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(https?://[^\s,;)]+[^\s,;).])", r'<a href="\1" rel="noopener" target="_blank">\1</a>', out)
    email = TOKENS["CONTACT_EMAIL"]
    if email:
        out = out.replace(email, f'<a href="mailto:{email}">{email}</a>')
    return out


def render(markdown: str) -> str:
    for key, value in TOKENS.items():
        markdown = markdown.replace("{{" + key + "}}", value)
    markdown = re.sub(r"<!--.*?-->", "", markdown, flags=re.S)
    out, para, items, rows = [], [], [], []

    def flush():
        if para:
            out.append(f"<p>{inline(' '.join(para))}</p>")
            para.clear()
        if items:
            out.append("<ul>" + "".join(f"<li>{inline(i)}</li>" for i in items) + "</ul>")
            items.clear()
        if rows:
            head, *body = [r for r in rows if not re.fullmatch(r"[\s|:-]+", r)]
            cells = lambda r: [c.strip() for c in r.strip().strip("|").split("|")]
            out.append(
                "<table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in cells(head)) + "</tr></thead><tbody>"
                + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells(r)) + "</tr>" for r in body)
                + "</tbody></table>"
            )
            rows.clear()

    for line in markdown.replace("\r\n", "\n").split("\n"):
        heading = re.match(r"(#{1,3}) (.*)", line)
        if heading:
            flush()
            level = len(heading.group(1))
            out.append(f"<h{level}>{inline(heading.group(2))}</h{level}>")
        elif line.startswith("- "):
            if para or rows:
                flush()
            items.append(line[2:])
        elif line.startswith("|"):
            if para or items:
                flush()
            rows.append(line)
        elif line.strip():
            if items or rows:
                flush()
            para.append(line.strip())
        else:
            flush()
    flush()
    return "\n".join(out)


STYLE = """<style>
.vidrev-legal{max-width:760px;margin:0 auto;padding:48px 20px 72px;font-family:"Open Sans",system-ui,sans-serif;color:#0E1330;font-size:16px;line-height:1.65}
.vidrev-legal h1{font-size:34px;line-height:1.2;margin:0 0 8px}
.vidrev-legal h2{font-size:22px;margin:36px 0 10px}
.vidrev-legal h3{font-size:18px;margin:26px 0 8px}
.vidrev-legal p,.vidrev-legal ul{margin:0 0 14px}
.vidrev-legal ul{padding-left:22px}
.vidrev-legal li{margin:0 0 6px}
.vidrev-legal a{color:#D91E50;word-break:break-word}
.vidrev-legal code{font-size:14px;background:#F1F2F7;padding:1px 5px;border-radius:5px}
.vidrev-legal table{width:100%;border-collapse:collapse;margin:0 0 16px;font-size:15px}
.vidrev-legal th,.vidrev-legal td{border:1px solid #E4E6EE;padding:8px 10px;text-align:left;vertical-align:top}
.vidrev-legal th{background:#F7F8FC}
</style>"""

items = []
for title, file, path in (("Privacy Policy", "PRIVACY-POLICY.md", "vidrev.app/privacy"), ("Terms of Service", "TERMS.md", "vidrev.app/terms")):
    body = render((DOCS / file).read_text(encoding="utf-8"))
    items.append((f"{title}: one Custom Code element on {path}", f'{STYLE}\n<div class="vidrev-legal">\n{body}\n</div>'))

status = (
    f'<p class="kit-warn">DRAFT: not ready to publish. Missing in docs/compliance/legal-entity.json: {", ".join(missing)}.</p>'
    if missing
    else '<p class="kit-ok">Ready: every legal field is filled.</p>'
)
cards = []
for i, (title, code) in enumerate(items):
    cards.append(
        f'<article class="kit-card"><div class="kit-head"><h2>{html.escape(title)}</h2>'
        f'<button class="kit-copy" data-target="kit-{i}">Copy</button></div>'
        f'<details><summary>Preview</summary><div class="kit-preview">{code}</div></details>'
        f'<textarea id="kit-{i}" hidden>{html.escape(code)}</textarea></article>'
    )

kit = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>vidrev legal kit</title>
<style>
body{{margin:0;font-family:"Segoe UI",system-ui,sans-serif;background:#F7F8FC;color:#0E1330}}
main{{max-width:960px;margin:0 auto;padding:32px 16px 64px;display:grid;gap:14px}}
h1{{margin:0 0 4px;font-size:28px}}
.kit-note{{margin:0;color:#5B6178}}
.kit-warn{{margin:0;padding:12px 14px;border-radius:10px;background:#FDE8EE;color:#8A1033;font-weight:700}}
.kit-ok{{margin:0;padding:12px 14px;border-radius:10px;background:#E0F6F5;color:#00605F;font-weight:700}}
.kit-card{{background:#fff;border:1px solid #E4E6EE;border-radius:14px;padding:16px 18px}}
.kit-head{{display:flex;justify-content:space-between;align-items:center;gap:12px}}
.kit-head h2{{margin:0;font-size:17px}}
.kit-copy{{font:inherit;font-weight:700;background:#D91E50;color:#fff;border:0;border-radius:10px;padding:10px 18px;cursor:pointer;white-space:nowrap}}
.kit-copy.kit-done{{background:#00B1B0}}
details{{margin-top:10px}} summary{{cursor:pointer;color:#5B6178;font-size:14px}}
.kit-preview{{border-top:1px solid #E4E6EE;margin-top:10px;max-height:520px;overflow:auto}}
</style></head><body><main>
<h1>vidrev legal kit: Privacy and Terms</h1>
{status}
<p class="kit-note">Generated from docs/compliance (the two policies and legal-entity.json). In the site builder: one page per block (paths privacy and terms), one Custom Code element with the whole block.</p>
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
(HERE / "legal-kit.html").write_text(kit, encoding="utf-8")
print(f"{len(items)} blocks written to legal-kit.html" + (f" (DRAFT, missing: {', '.join(missing)})" if missing else ""))
