# Контроль требований суда

Прототип ищет дела по номеру, получает судебные документы с КАД, скачивает PDF и формирует ИИ-выжимку требований.

Платный Parser API больше не используется. Получение документов выполняет локальный `KAD HTTP service` поверх `parser_kad`: Chrome/Playwright ищет дело, а затем сервис получает список актов с КАД.

## Запуск

Один раз после клонирования репозитория:

```powershell
git submodule update --init --recursive
cd services/kad_http
C:\Python313\python.exe -m pip install -r requirements.txt
```

Запустите три локальных процесса в отдельных окнах PowerShell.

```powershell
# 1. Поиск дел и документы КАД
cd services/kad_http
C:\Python313\python.exe app.py
```

```powershell
# 2. Извлечение текста из PDF
C:\Python313\python.exe analyzer.py
```

```powershell
# 3. Веб-интерфейс и DeepSeek
$env:DEEPSEEK_API_KEY = 'ваш_ключ_DeepSeek'
node server.mjs
```

Откройте `http://127.0.0.1:4174`.

## Наш HTTP-сервис

- `GET http://127.0.0.1:4176/health`
- `GET /cases/{номер_дела}/documents`
- `GET /cases/{номер_дела}/documents?refresh=1` — обновление без кэша.
- `GET /documents/download?url={url_акта}`

Первая версия хранит результаты 15 минут и запускает только один браузерный поиск одновременно. Новые маршруты — карточка дела, участники, заседания, история и плановый мониторинг — можно добавлять без изменения интерфейса.
