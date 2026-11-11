# Контроль требований суда

Прототип для поиска арбитражного дела, загрузки судебного акта, извлечения списка документов и подготовки ИИ-выжимки.

## Развёртывание в Cloudflare Pages

Проект уже содержит Pages Function в `functions/api/[[path]].js`. Она обслуживает `/api/case`, `/api/pdf` и `/api/ai-requirements`; ключи остаются в Cloudflare и не попадают в браузер или GitHub.

1. В Cloudflare Dashboard откройте **Workers & Pages → Create application → Pages → Connect to Git**.
2. Выберите репозиторий `elitrao/kad-arbitr-monitor`, branch `main`.
3. В настройках сборки укажите **Framework preset: None**, **Build command: пусто**, **Build output directory: /**.
4. После первого деплоя откройте **Settings → Environment variables → Add** и добавьте secrets для окружений Production и Preview:

   - `PARSER_API_KEY` — ключ Parser API;
   - `DEEPSEEK_API_KEY` — ключ DeepSeek;
   - `DEEPSEEK_MODEL` — `deepseek-flash` (необязательно).

5. Нажмите **Retry deployment**. Pages автоматически опубликует статику и API-функцию.

PDF скачивается через защищённый `/api/pdf`, а текст PDF разбирается прямо в браузере через PDF.js. Поэтому Python-сервис на Cloudflare не требуется.

## Локальный запуск

Для локальной версии можно продолжить запускать `node server.mjs` и `python analyzer.py`, предварительно задав `PARSER_API_KEY` и `DEEPSEEK_API_KEY` в окружении.
