# KAD HTTP service

Локальная HTTP-обёртка вокруг `parser_kad`.

## Установка

```powershell
cd services/kad_http
C:\Python313\python.exe -m pip install -r requirements.txt
C:\Python313\python.exe -m playwright install chromium
```

Для поиска `parser_kad` использует установленный Google Chrome по пути `C:\Program Files\Google\Chrome\Application\chrome.exe`.

## Запуск

```powershell
C:\Python313\python.exe app.py
```

## Методы

- `GET /health`
- `GET /cases/{номер_дела}/documents`
- `GET /cases/{номер_дела}/documents?refresh=1` — принудительно обновить без кэша.
- `GET /documents/download?url={url_из_списка_документов}`

Кэш действует 15 минут. Поиск в браузере сериализован: это защищает Chrome-профиль и CDP-порт библиотеки от параллельных запусков.
