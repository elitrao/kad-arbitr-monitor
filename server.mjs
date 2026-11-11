import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = process.cwd();
const kadServiceUrl = process.env.KAD_SERVICE_URL || 'http://127.0.0.1:4176';
const deepseekKey = process.env.DEEPSEEK_API_KEY;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
const execFileAsync = promisify(execFile);

async function extractRequirements(pdfBuffer) {
  const directory = await mkdtemp(join(tmpdir(), 'kad-pdf-'));
  const pdfPath = join(directory, 'act.pdf');
  try {
    await writeFile(pdfPath, pdfBuffer);
    const { stdout } = await execFileAsync('C:\\Python313\\python.exe', [join(root, 'extract_requirements.py'), pdfPath], { maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function normalizeDocuments(raw, number) {
  const sourceEvents = raw.documents || [];
  const event = sourceEvents.at(-1);
  return {
    number, court: 'КАД Арбитр', instance: 'Информация из документов КАД', state: raw.from_cache ? 'Сохранённая информация' : 'Данные обновлены',
    plaintiffLabel: 'Участники', respondentLabel: 'Данные карточки', plaintiff: '—', respondent: 'Будут добавлены отдельным маршрутом', judge: '—', hearing: null,
    act: event ? { title: event.document_title || 'Судебный акт', date: event.document_date, pdfUrl: event.document_url, fileName: event.document_url?.split('/').pop() } : null,
    events: sourceEvents.map((item) => ({ date: item.document_date, title: item.document_title || 'Судебный акт' }))
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/case') {
      const number = url.searchParams.get('number'); if (!number) return send(res, 400, JSON.stringify({ error: 'Укажите номер дела' }));
      const upstream = await fetch(`${kadServiceUrl}/cases/${encodeURIComponent(number)}/documents`); const raw = await upstream.json();
      if (!upstream.ok) return send(res, upstream.status || 502, JSON.stringify({ error: raw.error || 'Ошибка KAD HTTP service' }));
      return send(res, 200, JSON.stringify(normalizeDocuments(raw, number)));
    }
    if (url.pathname === '/api/search') {
      return send(res, 501, JSON.stringify({ error: 'Поиск по ИНН пока не подключён: сервис работает по номеру дела.' }));
    }
    if (url.pathname === '/api/pdf') {
      const pdfUrl = url.searchParams.get('url'); const upstream = await fetch(`${kadServiceUrl}/documents/download?${new URLSearchParams({ url: pdfUrl })}`);
      if (!upstream.ok) return send(res, upstream.status, 'PDF не найден', 'text/plain; charset=utf-8');
      const pdf = Buffer.from(await upstream.arrayBuffer()); res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="court-act.pdf"' }); return res.end(pdf);
    }
    if (url.pathname === '/api/analyze') {
      const pdfUrl = url.searchParams.get('url'); if (!pdfUrl) return send(res, 400, JSON.stringify({ error: 'Не передан URL PDF' }));
      const pdf = await fetch(`${kadServiceUrl}/documents/download?${new URLSearchParams({ url: pdfUrl })}`);
      if (!pdf.ok) return send(res, 404, JSON.stringify({ error: 'PDF не найден' }));
      const analyzer = await fetch('http://127.0.0.1:4175', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from(await pdf.arrayBuffer()) });
      return send(res, analyzer.status, await analyzer.text());
    }
    if (url.pathname === '/api/ai-requirements') {
      if (!deepseekKey) return send(res, 503, JSON.stringify({ error: 'Не задан DEEPSEEK_API_KEY на локальном сервере' }));
      let body = ''; for await (const chunk of req) body += chunk;
      const { requirements = [] } = JSON.parse(body);
      const prompt = `Ты юридический ассистент. На основе фрагментов оригинального судебного акта верни строгий JSON: {"summary":{"essence":"суть акта, максимум 2 предложения","deadline":"срок или пустая строка","risks":"последствие неисполнения или пустая строка"},"items":[{"title":"короткое название до 8 слов","action":"что представить, 1 предложение","details":"важные суммы, сроки, условия или пустая строка"}]}. Не добавляй факты, которых нет в тексте. Требования: ${JSON.stringify(requirements)}`;
      const upstream = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${deepseekKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-flash', messages: [{ role: 'system', content: 'Отвечай только валидным JSON, без Markdown.' }, { role: 'user', content: prompt }], stream: false, thinking: { type: 'disabled' } }) });
      const raw = await upstream.json();
      if (!upstream.ok) return send(res, upstream.status, JSON.stringify({ error: raw.error?.message || 'Ошибка DeepSeek API' }));
      return send(res, 200, raw.choices?.[0]?.message?.content || '{"items":[]}');
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); if (file.includes('..')) return send(res, 403, 'Forbidden', 'text/plain');
    return send(res, 200, await readFile(join(root, file)), types[extname(file)] || 'application/octet-stream');
  } catch (error) { return send(res, 500, JSON.stringify({ error: error.message })); }
}).listen(4174, '127.0.0.1', () => console.log('http://127.0.0.1:4174'));
