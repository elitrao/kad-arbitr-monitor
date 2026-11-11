import io, json, re
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pypdf import PdfReader

def parse(pdf):
    text = '\n'.join(p.extract_text() or '' for p in PdfReader(io.BytesIO(pdf)).pages).replace('\u00ad', '')
    marker = re.search(r'Должнику\s*:\s*в\s+обязательном\s+порядке\s+представить\s*:', text, re.I)
    if not marker: return {'found': False, 'requirements': []}
    tail = text[marker.end():]
    stop = re.search(r'\b(Неисполнение должником|Разъяснить сторонам|В силу ч\.|В соответствии со ст\.)', tail, re.I)
    section = re.sub(r'\s+', ' ', (tail[:stop.start()] if stop else tail[:6000])).strip()
    starts = list(re.finditer(r'(?i)(?<!\w)(?=в случае если заявление|представить платежный документ|представить заявление)', section))
    points, start = [], 0
    for match in starts:
        if match.start() > start:
            points.append(section[start:match.start()].strip(' ;-–'))
        start = match.start()
    if section[start:].strip(' ;-–'):
        points.append(section[start:].strip(' ;-–'))
    points = [re.sub(r'\s+\d+\.$', '', x).strip() for x in points]
    return {'found': True, 'requirements': [x for x in points if len(x) > 8]}

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            data = parse(self.rfile.read(int(self.headers['Content-Length']))); body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.end_headers(); self.wfile.write(body)
        except Exception as error:
            self.send_response(500); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.end_headers(); self.wfile.write(json.dumps({'error': str(error)}, ensure_ascii=False).encode())

ThreadingHTTPServer(('127.0.0.1', 4175), Handler).serve_forever()
