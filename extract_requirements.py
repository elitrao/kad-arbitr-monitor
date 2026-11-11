import json
import re
import sys
from pypdf import PdfReader

path = sys.argv[1]
reader = PdfReader(path)
text = "\n".join((page.extract_text() or "") for page in reader.pages)
text = text.replace("\u00ad", "")

marker = re.search(r"Должнику\s*:\s*в\s+обязательном\s+порядке\s+представить\s*:", text, re.IGNORECASE)
if not marker:
    print(json.dumps({"found": False, "requirements": [], "excerpt": ""}, ensure_ascii=False))
    raise SystemExit(0)

tail = text[marker.end():]
stop = re.search(r"\n\s*(Судья|Приложение|Дело\s+направить|Настоящее\s+определение)", tail, re.IGNORECASE)
section = tail[:stop.start()] if stop else tail[:6000]
section = re.sub(r"(?<!\n)\s+(?=\d+[.)])", "\n", section)
lines = [re.sub(r"\s+", " ", line).strip(" -–•\t") for line in section.splitlines()]
requirements = []
for line in lines:
    line = re.sub(r"^\d+[.)]\s*", "", line)
    if len(line) > 8 and not re.fullmatch(r"\d+", line):
        requirements.append(line)

if not requirements and section.strip():
    requirements = [re.sub(r"\s+", " ", section).strip()]
print(json.dumps({"found": True, "requirements": requirements[:30], "excerpt": re.sub(r"\s+", " ", section).strip()[:900]}, ensure_ascii=False))
