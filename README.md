# Контроль требований суда

Прототип для поиска арбитражного дела, загрузки судебного акта, извлечения списка документов и подготовки ИИ-выжимки.

## Развёртывание в Cloudflare Workers

Проект содержит полноценный Worker (`worker.js`) и конфигурацию `wrangler.jsonc`. Он обслуживает `/api/case`, `/api/pdf` и `/api/ai-requirements`, а остальные запросы отдаёт как статический интерфейс. Ключи остаются в Cloudflare и не попадают в браузер или GitHub.

1. В Cloudflare Dashboard откройте **Workers & Pages → Create application → Workers → Import a repository**.
2. Выберите репозиторий `elitrao/kad-arbitr-monitor`, branch `main`. Cloudflare возьмёт настройки из `wrangler.jsonc`.
3. После первого деплоя откройте **Settings → Variables and Secrets → Add** и добавьте secrets:

   - `PARSER_API_KEY` — ключ Parser API;
   - `DEEPSEEK_API_KEY` — ключ DeepSeek;
   - `DEEPSEEK_MODEL` — `deepseek-flash` (необязательно).

4. Нажмите **Deploy**. Worker опубликует и интерфейс, и API.

PDF скачивается через защищённый `/api/pdf`, а текст PDF разбирается прямо в браузере через PDF.js. Поэтому Python-сервис на Cloudflare не требуется.

## Локальный запуск

Для локальной версии можно продолжить запускать `node server.mjs` и `python analyzer.py`, предварительно задав `PARSER_API_KEY` и `DEEPSEEK_API_KEY` в окружении.
