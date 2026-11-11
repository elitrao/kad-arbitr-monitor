const $ = (id) => document.getElementById(id);
let current = null;
const fmtDate = (value) => value ? new Intl.DateTimeFormat('ru-RU').format(new Date(value)) : '—';
function fmtHearing(value) {
  if (!value) return 'Не назначено';
  const [rawDate, location = ''] = value.split(' · ');
  const parts = rawDate.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const when = parts ? `${Number(parts[3])} ${months[Number(parts[2]) - 1]} ${parts[1]}, ${parts[4]}:${parts[5]}` : rawDate;
  const hall = location.match(/зал\s*\d+/i)?.[0];
  return hall ? `${when} · ${hall}` : when;
}
const watchKey = 'iq-legal-watchlist';
const watched = () => { try { return JSON.parse(localStorage.getItem(watchKey) || '[]'); } catch { return []; } };
const saveWatched = (items) => localStorage.setItem(watchKey, JSON.stringify(items));

function renderWatchlist() {
  const items = watched();
  $('watchCount').textContent = items.length;
  $('watchList').innerHTML = items.length ? items.map((item) => `<tr class="watch-item" data-watch="${item.number}" tabindex="0"><td><b>${item.number}</b></td><td>${item.court || 'Суд не указан'}</td><td>${item.act?.title || item.state || 'Без новых актов'}</td><td>${fmtHearing(item.hearing)}</td><td><time>${new Date(item.lastChecked).toLocaleString('ru-RU')}</time></td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Пока нет дел под наблюдением.</td></tr>';
  $('watchList').querySelectorAll('[data-watch]').forEach((button) => button.onclick = () => {
    const item = watched().find((entry) => entry.number === button.dataset.watch);
    if (!item) return;
    renderCase(item, false); document.body.classList.remove('watch-mode'); setActiveSection('overview'); window.location.hash = 'overview'; document.querySelector('#overview').scrollIntoView({ behavior: 'smooth' });
  });
}

function updateWatchButton() {
  const isWatching = current && watched().some((item) => item.number === current.number);
  $('watchBtn').textContent = isWatching ? '✓ Под наблюдением' : '◉ Под наблюдение';
  $('watchBtn').classList.toggle('is-watching', Boolean(isWatching));
}

function syncCurrentWatch(data) {
  const items = watched(); const index = items.findIndex((item) => item.number === data.number);
  if (index >= 0) { items[index] = { ...data, lastChecked: new Date().toISOString() }; saveWatched(items); renderWatchlist(); }
}

function renderCase(data, refresh = true) {
  current = data;
  if (refresh) syncCurrentWatch(data);
  updateWatchButton();
  $('caseNumber').textContent = data.number;
  $('courtName').textContent = data.court || 'Суд не указан';
  $('instanceName').textContent = data.instance || 'Инстанция не указана';
  $('caseState').textContent = data.state || 'Статус не указан';
  $('plaintiffLabel').textContent = data.plaintiffLabel || 'Истец';
  $('respondentLabel').textContent = data.respondentLabel || 'Ответчик';
  $('plaintiff').textContent = data.plaintiff || '—'; $('respondent').textContent = data.respondent || '—';
  $('judge').textContent = data.judge || '—'; $('deadline').textContent = fmtHearing(data.hearing);
  $('actTitle').textContent = data.act?.title || 'Судебные акты не найдены'; $('actDate').textContent = fmtDate(data.act?.date);
  $('pdfName').textContent = data.act?.fileName || (data.act?.pdfUrl ? 'Оригинал судебного акта (PDF)' : 'PDF для этого акта не опубликован');
  $('pdfMeta').textContent = data.act?.pdfUrl ? 'Оригинал из КАД · файл доступен для скачивания' : 'Проверьте публикацию PDF в КАД';
  $('summaryText').textContent = data.act?.pdfUrl ? 'Оригинал PDF найден. Автоматическое извлечение требований подключается отдельным модулем анализа текста.' : 'PDF судебного акта не получен: саммари и требования не формируются, чтобы не подставлять неподтверждённые данные.';
  $('kadLink').href = data.act?.pdfUrl || 'https://kad.arbitr.ru/'; $('downloadBtn').disabled = !data.act?.pdfUrl;
  $('historyList').innerHTML = data.events.map(e => `<div><span></span><b>${fmtDate(e.date)}</b> ${e.title}</div>`).join('') || '<div>События не найдены</div>';
  $('modalCourt').textContent = (data.court || 'АРБИТРАЖНЫЙ СУД').toUpperCase(); $('modalAct').textContent = data.act?.title || 'СУДЕБНЫЙ АКТ';
  $('modalText').textContent = 'Предпросмотр доступен после загрузки оригинального PDF из КАД.'; $('modalDeadline').textContent = data.hearing ? `Ближайшее заседание: ${data.hearing}.` : '';
  if (refresh) {
    $('requirementsList').innerHTML = '<div class="empty-state">Загружаем и разбираем оригинальный PDF…</div>';
    $('progress').textContent = data.act?.pdfUrl ? 'Разбор PDF…' : 'PDF не найден';
    if (data.act?.pdfUrl) analyzePdf(data.act.pdfUrl);
  } else {
    $('requirementsList').innerHTML = '<div class="empty-state">Показан сохранённый снимок. Для обновления введите номер дела в поиске.</div>';
    $('progress').textContent = 'Без новых запросов';
    $('summaryText').textContent = 'Показана последняя сохранённая информация. Автоматическое обновление отключено.';
  }
}

async function analyzePdf(pdfUrl) {
  try {
    const response = await fetch(`/api/analyze?url=${encodeURIComponent(pdfUrl)}`); const analysis = await response.json();
    if (!response.ok) throw new Error(analysis.error || 'Не удалось разобрать PDF');
    if (!analysis.found) {
      $('requirementsList').innerHTML = '<div class="empty-state">В тексте акта не найден раздел «Должнику: в обязательном порядке представить:».</div>';
      $('progress').textContent = 'Требования не найдены'; return;
    }
    $('requirementsList').innerHTML = '<div class="empty-state">ИИ формирует понятный чек-лист…</div>';
    $('progress').textContent = 'ИИ анализирует акт';
    $('summaryText').textContent = 'ИИ формирует краткую выжимку из оригинального PDF…';
    const ai = await fetch('/api/ai-requirements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requirements: analysis.requirements }) });
    if (!ai.ok) throw new Error('ИИ не смог сформировать выжимку');
    const result = await ai.json(); const items = result.items || [];
    if (!items.length) throw new Error('ИИ не выделил требований из акта');
    $('requirementsList').innerHTML = items.map((item) => `<label class="requirement"><input type="checkbox"><span><b>${item.title}</b><small>${item.action}${item.details ? ` · ${item.details}` : ''}</small></span></label>`).join('');
    $('progress').textContent = `0 из ${items.length} готово`;
    $('requirementsList').onchange = () => $('progress').textContent = `${$('requirementsList').querySelectorAll('input:checked').length} из ${items.length} готово`;
    const summary = result.summary || {};
    $('summaryText').innerHTML = `<b>Суть:</b> ${summary.essence || 'Не определена'}${summary.deadline ? `<br><b>Срок:</b> ${summary.deadline}` : ''}${summary.risks ? `<br><b>Риск:</b> ${summary.risks}` : ''}`;
  } catch (error) {
    $('requirementsList').innerHTML = `<div class="empty-state">${error.message}</div>`;
    $('progress').textContent = 'Ошибка разбора';
  }
}

async function loadCase(number) {
  $('syncStatus').textContent = 'Загружаем карточку дела…';
  const response = await fetch(`/api/case?number=${encodeURIComponent(number)}`); const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'КАД не вернул карточку дела');
  renderCase(payload, true); $('syncStatus').textContent = 'Данные КАД получены';
}

function renderSearchResults(cases) {
  const panel = $('searchResults'); panel.hidden = false;
  panel.innerHTML = `<p>Найдено дел: ${cases.length}. Выберите нужное:</p>` + cases.map((item) => `<button class="case-result" data-case="${item.number}"><b>${item.number}</b><small>${item.court || 'Суд не указан'} · ${item.state || 'Статус не указан'}</small><span>Открыть →</span></button>`).join('');
  panel.querySelectorAll('[data-case]').forEach((button) => button.onclick = async () => {
    try { await loadCase(button.dataset.case); panel.hidden = true; } catch (error) { $('syncStatus').textContent = error.message; }
  });
}

$('searchBtn').addEventListener('click', async () => {
  const number = $('caseInput').value.trim(); if (!number) return;
  $('searchResults').hidden = true;
  try { await loadCase(number); } catch (error) { $('syncStatus').textContent = error.message; }
});
const watchNav = $('watchCount').closest('a');
const overviewNav = document.querySelector('a[href="#overview"]');
const setActiveSection = (name) => { overviewNav.classList.toggle('active', name === 'overview'); watchNav.classList.toggle('active', name === 'watchlist'); };
watchNav.onclick = (event) => { event.preventDefault(); document.body.classList.add('watch-mode'); setActiveSection('watchlist'); window.location.hash = 'watchlist'; };
overviewNav.onclick = (event) => { event.preventDefault(); document.body.classList.remove('watch-mode'); setActiveSection('overview'); window.location.hash = 'overview'; };
if (window.location.hash === '#watchlist') { document.body.classList.add('watch-mode'); setActiveSection('watchlist'); }
$('watchBtn').onclick = () => {
  if (!current) return;
  const items = watched(); const index = items.findIndex((item) => item.number === current.number);
  if (index >= 0) items.splice(index, 1); else items.unshift({ ...current, lastChecked: new Date().toISOString() });
  saveWatched(items); renderWatchlist(); updateWatchButton();
};
const dialog = $('previewDialog'); $('previewBtn').onclick = () => dialog.showModal(); $('closePreview').onclick = () => dialog.close();
$('downloadBtn').onclick = () => { if (current?.act?.pdfUrl) window.open(`/api/pdf?url=${encodeURIComponent(current.act.pdfUrl)}`, '_blank'); };
renderWatchlist();
