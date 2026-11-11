import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = process.cwd();
const key = process.env.PARSER_API_KEY;
const deepseekKey = process.env.DEEPSEEK_API_KEY;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
const callApi = (path, params) => fetch(`https://parser-api.com/parser/arbitr_api/${path}?${new URLSearchParams({ key, ...params })}`);
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

function normalize(raw, number) {
  const c = raw.Cases?.[0]; if (!c) throw new Error('Дело не найдено в ответе API');
  const instance = c.CaseInstances?.[0] || {}; const sourceEvents = instance.InstanceEvents || [];
  const event = [...sourceEvents].reverse().find((item) => item.File) || (instance.File?.URL ? { File: instance.File.URL, Date: c.StartDate, EventContentTypeName: instance.File.Name } : null);
  const hearing = c.CourtHearings?.[0];
  return {
    number: c.CaseNumber || number, court: instance.Court?.Name || c.Court, instance: instance.Name, state: instance.State || c.State,
    plaintiffLabel: c.CaseType === 'Б' ? 'Кредитор (заявитель)' : 'Истец', respondentLabel: c.CaseType === 'Б' ? 'Должник' : 'Ответчик',
    plaintiff: c.Plaintiffs?.map((x) => x.Name).join(', '), respondent: c.Respondents?.map((x) => x.Name).join(', '), judge: instance.Judges?.join(', '),
    hearing: hearing ? `${hearing.Start || instance.State || 'Дата не указана'} · ${hearing.Location || ''}`.trim() : null,
    act: event ? { title: event.EventContentTypeName || event.DecisionTypeName || 'Судебный акт', date: event.PublishDate || event.Date, pdfUrl: event.File, fileName: event.File?.split('/').pop() } : null,
    events: sourceEvents.map((item) => ({ date: item.PublishDate || item.Date, title: item.EventContentTypeName || item.EventTypeName || 'Событие' }))
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/case') {
      if (!key) return send(res, 503, JSON.stringify({ error: 'Не задан PARSER_API_KEY на локальном сервере' }));
      const number = url.searchParams.get('number'); if (!number) return send(res, 400, JSON.stringify({ error: 'Укажите номер дела' }));
      const upstream = await callApi('details_by_number', { CaseNumber: number }); const raw = await upstream.json();
      if (!upstream.ok || !raw.Success) return send(res, upstream.status || 502, JSON.stringify({ error: raw.error || 'Ошибка Parser API' }));
      return send(res, 200, JSON.stringify(normalize(raw, number)));
    }
    if (url.pathname === '/api/search') {
      if (!key) return send(res, 503, JSON.stringify({ error: 'Не задан PARSER_API_KEY на локальном сервере' }));
      const inn = url.searchParams.get('inn'); if (!/^\d{10}(\d{2})?$/.test(inn || '')) return send(res, 400, JSON.stringify({ error: 'Введите ИНН из 10 или 12 цифр' }));
      const upstream = await callApi('search', { Inn: inn, InnType: 'Any' }); const raw = await upstream.json();
      if (!upstream.ok || !raw.Success) return send(res, upstream.status || 502, JSON.stringify({ error: raw.error || 'Ошибка Parser API' }));
      const cases = (raw.Cases || []).map((item) => ({ number: item.CaseNumber, court: item.Court, state: item.State || item.CaseType }));
      return send(res, 200, JSON.stringify({ cases }));
    }
    if (url.pathname === '/api/pdf') {
      if (!key) return send(res, 503, 'Не задан PARSER_API_KEY', 'text/plain; charset=utf-8');
      const pdfUrl = url.searchParams.get('url'); const raw = await (await callApi('pdf_download', { url: pdfUrl })).json();
      if (!raw.Success || !raw.pdfContent) return send(res, 404, 'PDF не найден', 'text/plain; charset=utf-8');
      const pdf = Buffer.from(raw.pdfContent, 'base64'); res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="court-act.pdf"' }); return res.end(pdf);
    }
    if (url.pathname === '/api/analyze') {
      if (!key) return send(res, 503, JSON.stringify({ error: 'Не задан PARSER_API_KEY на локальном сервере' }));
      const pdfUrl = url.searchParams.get('url'); if (!pdfUrl) return send(res, 400, JSON.stringify({ error: 'Не передан URL PDF' }));
      const raw = await (await callApi('pdf_download', { url: pdfUrl })).json();
      if (!raw.Success || !raw.pdfContent) return send(res, 404, JSON.stringify({ error: 'PDF не найден' }));
      const analyzer = await fetch('http://127.0.0.1:4175', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from(raw.pdfContent, 'base64') });
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
