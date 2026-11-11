import base64
import io
import json
import mimetypes
import os
import re
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from pypdf import PdfReader

ROOT = Path(__file__).parent
KEY = os.environ.get('PARSER_API_KEY', '')

def api(path, params):
    query = urllib.parse.urlencode({'key': KEY, **params})
    with urllib.request.urlopen(f'https://parser-api.com/parser/arbitr_api/{path}?{query}', timeout=60) as response:
        return json.load(response)

def normalize(raw, number):
    case = raw['Cases'][0]; instance = (case.get('CaseInstances') or [{}])[0]; events = instance.get('InstanceEvents') or []
    event = next((e for e in reversed(events) if e.get('File')), None)
    hearing = (case.get('CourtHearings') or [None])[0]
    return {'number': case.get('CaseNumber', number), 'court': instance.get('Court', {}).get('Name') or case.get('Court'), 'instance': instance.get('Name'), 'state': instance.get('State') or case.get('State'),
      'plaintiffLabel': 'Кредитор (заявитель)' if case.get('CaseType') == 'Б' else 'Истец', 'respondentLabel': 'Должник' if case.get('CaseType') == 'Б' else 'Ответчик',
      'plaintiff': ', '.join(x.get('Name', '') for x in case.get('Plaintiffs', [])), 'respondent': ', '.join(x.get('Name', '') for x in case.get('Respondents', [])), 'judge': ', '.join(instance.get('Judges', [])),
      'hearing': f"{hearing.get('Start')} · {hearing.get('Location', '')}" if hearing else None,
      'act': {'title': event.get('EventContentTypeName') or event.get('DecisionTypeName') or 'Судебный акт', 'date': event.get('PublishDate') or event.get('Date'), 'pdfUrl': event.get('File'), 'fileName': event.get('File', '').split('/')[-1]} if event else None,
      'events': [{'date': e.get('PublishDate') or e.get('Date'), 'title': e.get('EventContentTypeName') or e.get('EventTypeName') or 'Событие'} for e in events]}

def requirements(pdf):
    text = '\n'.join(page.extract_text() or '' for page in PdfReader(io.BytesIO(pdf)).pages).replace('\u00ad', '')
    marker = re.search(r'Должнику\s*:\s*в\s+обязательном\s+порядке\s+представить\s*:', text, re.I)
    if not marker: return {'found': False, 'requirements': []}
    tail = text[marker.end():]; stop = re.search(r'\n\s*(Судья|Приложение|Дело\s+направить|Настоящее\s+определение)', tail, re.I)
    section = (tail[:stop.start()] if stop else tail[:6000]).strip()
    lines = [re.sub(r'^\d+[.)]\s*', '', re.sub(r'\s+', ' ', line)).strip(' -–•') for line in section.splitlines()]
    items = [line for line in lines if len(line) > 8]
    return {'found': True, 'requirements': items or [re.sub(r'\s+', ' ', section)]}

class Handler(SimpleHTTPRequestHandler):
    def send_json(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path); query = urllib.parse.parse_qs(parsed.query)
        try:
            if parsed.path == '/api/case':
                if not KEY: return self.send_json(503, {'error': 'Не задан PARSER_API_KEY на локальном сервере'})
                number = query.get('number', [''])[0]; raw = api('details_by_number', {'CaseNumber': number})
                if not raw.get('Success'): return self.send_json(502, {'error': raw.get('error', 'Ошибка Parser API')})
                return self.send_json(200, normalize(raw, number))
            if parsed.path in ('/api/pdf', '/api/analyze'):
                url = query.get('url', [''])[0]; raw = api('pdf_download', {'url': url})
                if not raw.get('pdfContent'): return self.send_json(404, {'error': 'PDF не найден'})
                pdf = base64.b64decode(raw['pdfContent'])
                if parsed.path == '/api/analyze': return self.send_json(200, requirements(pdf))
                self.send_response(200); self.send_header('Content-Type', 'application/pdf'); self.send_header('Content-Disposition', 'attachment; filename="court-act.pdf"'); self.end_headers(); return self.wfile.write(pdf)
            target = (ROOT / (parsed.path.lstrip('/') or 'index.html')).resolve()
            if ROOT not in target.parents and target != ROOT: return self.send_error(403)
            content = target.read_bytes(); self.send_response(200); self.send_header('Content-Type', mimetypes.guess_type(target.name)[0] or 'application/octet-stream'); self.end_headers(); self.wfile.write(content)
        except Exception as exc: self.send_json(500, {'error': str(exc)})

ThreadingHTTPServer(('127.0.0.1', 4174), Handler).serve_forever()
