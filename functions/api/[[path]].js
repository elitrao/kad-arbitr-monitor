const parserUrl = (path, params, key) => `https://parser-api.com/parser/arbitr_api/${path}?${new URLSearchParams({ key, ...params })}`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function normalize(raw, number) {
  const c = raw.Cases?.[0];
  if (!c) throw new Error('Дело не найдено в ответе API');
  const instance = c.CaseInstances?.[0] || {};
  const events = instance.InstanceEvents || [];
  const event = [...events].reverse().find((item) => item.File) || (instance.File?.URL ? { File: instance.File.URL, Date: c.StartDate, EventContentTypeName: instance.File.Name } : null);
  const hearing = c.CourtHearings?.[0];
  return {
    number: c.CaseNumber || number, court: instance.Court?.Name || c.Court, instance: instance.Name, state: instance.State || c.State,
    plaintiffLabel: c.CaseType === 'Б' ? 'Кредитор (заявитель)' : 'Истец', respondentLabel: c.CaseType === 'Б' ? 'Должник' : 'Ответчик',
    plaintiff: c.Plaintiffs?.map((item) => item.Name).join(', '), respondent: c.Respondents?.map((item) => item.Name).join(', '), judge: instance.Judges?.join(', '),
    hearing: hearing ? `${hearing.Start || instance.State || 'Дата не указана'} · ${hearing.Location || ''}`.trim() : null,
    act: event ? { title: event.EventContentTypeName || event.DecisionTypeName || 'Судебный акт', date: event.PublishDate || event.Date, pdfUrl: event.File, fileName: event.File?.split('/').pop() } : null,
    events: events.map((item) => ({ date: item.PublishDate || item.Date, title: item.EventContentTypeName || item.EventTypeName || 'Событие' }))
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = Array.isArray(params.path) ? params.path.join('/') : params.path;
  if (!env.PARSER_API_KEY) return json({ error: 'В Cloudflare не задан PARSER_API_KEY' }, 503);
  const url = new URL(request.url);
  try {
    if (path === 'case') {
      const number = url.searchParams.get('number');
      if (!number) return json({ error: 'Укажите номер дела' }, 400);
      const upstream = await fetch(parserUrl('details_by_number', { CaseNumber: number }, env.PARSER_API_KEY));
      const raw = await upstream.json();
      if (!upstream.ok || !raw.Success) return json({ error: raw.error || 'Ошибка Parser API' }, upstream.status || 502);
      return json(normalize(raw, number));
    }
    if (path === 'pdf') {
      const sourceUrl = url.searchParams.get('url');
      if (!sourceUrl) return new Response('Не передан URL PDF', { status: 400 });
      const raw = await (await fetch(parserUrl('pdf_download', { url: sourceUrl }, env.PARSER_API_KEY))).json();
      if (!raw.Success || !raw.pdfContent) return new Response('PDF не найден', { status: 404 });
      const binary = Uint8Array.from(atob(raw.pdfContent), (char) => char.charCodeAt(0));
      return new Response(binary, { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="court-act.pdf"' } });
    }
    if (path === 'ai-requirements') {
      if (!env.DEEPSEEK_API_KEY) return json({ error: 'В Cloudflare не задан DEEPSEEK_API_KEY' }, 503);
      const { requirements = [] } = await request.json();
      const prompt = `Ты юридический ассистент. На основе фрагментов оригинального судебного акта верни строгий JSON: {"summary":{"essence":"суть акта, максимум 2 предложения","deadline":"срок или пустая строка","risks":"последствие неисполнения или пустая строка"},"items":[{"title":"короткое название до 8 слов","action":"что представить, 1 предложение","details":"важные суммы, сроки, условия или пустая строка"}]}. Не добавляй факты, которых нет в тексте. Требования: ${JSON.stringify(requirements)}`;
      const upstream = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: env.DEEPSEEK_MODEL || 'deepseek-flash', messages: [{ role: 'system', content: 'Отвечай только валидным JSON, без Markdown.' }, { role: 'user', content: prompt }], stream: false }) });
      const raw = await upstream.json();
      if (!upstream.ok) return json({ error: raw.error?.message || 'Ошибка DeepSeek API' }, upstream.status);
      return new Response(raw.choices?.[0]?.message?.content || '{"items":[]}', { headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
    return json({ error: 'Маршрут API не найден' }, 404);
  } catch (error) { return json({ error: error.message || 'Внутренняя ошибка' }, 500); }
}
