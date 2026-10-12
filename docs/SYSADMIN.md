# NexusCRM — инструкция по развёртыванию и эксплуатации

Документ для системного администратора: установка на сервер, HTTPS, автозапуск, резервное копирование, безопасность.

---

## 1. Что это за приложение

- **Монолит**: Node.js-сервер (Express) отдаёт и API (`/api/*`), и готовый интерфейс (`server/public`). Отдельный веб-сервер для статики не требуется.
- **База данных**: один файл SQLite (`crm.db`) — не нужен ни PostgreSQL, ни MySQL.
- **Порт по умолчанию**: `3001`.
- **Все данные локальные**: никаких внешних сервисов приложение не вызывает.

### Структура каталогов

| Путь | Что | Бэкапить |
|---|---|---|
| `crm.db` (+ `crm.db-wal`, `crm.db-shm`) | база данных | **да** |
| `crm-backups/` | автобэкапы, которые делает сама CRM | желательно |
| `uploads/documents/` | прикреплённые к карточкам документы | **да** |
| `server/public/` | собранный интерфейс (идёт в комплекте) | нет |
| `server/`, `client/` | код | нет |
| `.env` | настройки окружения (вы создаёте сами) | **да** |

---

## 2. Требования

- **Node.js ≥ 22.5** (проверка: `node -v`). Ставить через [NodeSource](https://github.com/nodesource/distributions) или nvm — штатный из старых репозиториев не подойдёт (нужен встроенный `node:sqlite`).
- **RAM**: 512 МБ достаточно, 1 ГБ с запасом.
- **Диск**: ~500 МБ на приложение + место под базу и бэкапы.
- ОС: любой Linux (инструкция на примере Ubuntu/Debian, systemd).

```bash
# Установка Node.js 22 на Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # должно быть v22.x или новее
```

---

## 3. Установка

```bash
sudo mkdir -p /opt/nexuscrm
sudo unzip NexusCRM.zip -d /opt/nexuscrm          # внутри окажется каталог NexusCRM/
cd /opt/nexuscrm/NexusCRM

# Зависимости только production-сервера (собранный фронтенд уже в server/public)
cd server && npm ci --omit=dev && cd ..

# Служебный пользователь без прав входа в систему
sudo useradd -r -s /usr/sbin/nologin nexuscrm || true
sudo chown -R nexuscrm:nexuscrm /opt/nexuscrm/NexusCRM
```

### Первый запуск (проверка руками)

```bash
cd /opt/nexuscrm/NexusCRM
sudo -u nexuscrm ADMIN_PASSWORD='СЕКРЕТНЫЙ-ПАРОЛЬ' node server/src/index.js
```

- На чистой базе создаётся пользователь **`admin`** с паролем из `ADMIN_PASSWORD`
  (если переменную не задать — заводской `admin123`, о чём сервер громко предупредит в логе).
- Проверить: `curl http://127.0.0.1:3001/api/health` → `{"ok":true,...}`.
- Открыть `http://IP-сервера:3001`, войти и **сразу сменить пароль** (Настройки → Профиль).

> **Важно:** `ADMIN_PASSWORD` срабатывает только при самом первом запуске, пока базы нет.

---

## 4. Файл настроек `.env`

Скопируйте шаблон и отредактируйте:

```bash
cp .env.example .env
sudo chown nexuscrm:nexuscrm .env && sudo chmod 600 .env
```

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `PORT` | `3001` | порт |
| `HOST` | `0.0.0.0` | интерфейс; за nginx можно `127.0.0.1` |
| `CRM_DB_PATH` | `./crm.db` | путь к файлу БД (удобно вынести на отдельный раздел) |
| `ADMIN_PASSWORD` | `admin123` | пароль admin только при первом запуске на чистой базе |
| `SESSION_DAYS` | `7` | срок жизни сессии (1–90) |
| `COOKIE_SAMESITE` | `lax` | `lax` — рекомендуется; `strict` — максимально жёстко; `none` — только для iframe-встраивания |
| `COOKIE_SECURE` | авто | `1` — cookie только по HTTPS; `0` — разрешить по HTTP; пусто — по протоколу запроса |
| `TRUST_PROXY` | выкл | `1` — если стоит за nginx (нужно для корректных IP в антибрутфорсе) |
| `CORS_ORIGINS` | выкл | список чужих доменов с доступом к API (обычно не нужен!) |
| `ALLOW_EMBED` | `0` | `1` — разрешить показ во внешнем iframe |

---

## 5. Автозапуск (systemd)

`/etc/systemd/system/nexuscrm.service`:

```ini
[Unit]
Description=NexusCRM (приёмная комиссия)
After=network.target

[Service]
Type=simple
User=nexuscrm
Group=nexuscrm
WorkingDirectory=/opt/nexuscrm/NexusCRM
ExecStart=/usr/bin/node server/src/index.js
Restart=always
RestartSec=5
# Изоляция
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/nexuscrm/NexusCRM
# Логи: journalctl -u nexuscrm -f

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nexuscrm
sudo systemctl status nexuscrm
journalctl -u nexuscrm -f    # живой лог
```

---

## 6. HTTPS через nginx (рекомендуемая схема)

Приложение слушает только локальный петлевой интерфейс, наружу смотрит nginx с TLS.

1. В `.env`: `HOST=127.0.0.1`, `TRUST_PROXY=1`.
2. Сертификат Let's Encrypt: `sudo apt install certbot python3-certbot-nginx`.
3. `/etc/nginx/sites-available/nexuscrm`:

```nginx
server {
    listen 80;
    server_name crm.example.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name crm.example.ru;

    ssl_certificate     /etc/letsencrypt/live/crm.example.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.example.ru/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 25m;   # загрузка Excel до 20 МБ + документы

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/nexuscrm /etc/nginx/sites-enabled/
sudo certbot --nginx -d crm.example.ru
sudo nginx -t && sudo systemctl reload nginx
```

4. Firewall:

```bash
sudo ufw allow 'Nginx Full'
sudo ufw delete allow 'Nginx HTTP'   # опционально, если 80 не нужен
sudo ufw enable
```

Порт 3001 наружу не открываем — приложение доступно только через nginx.

---

## 7. Резервное копирование

Два независимых механизма — используйте оба.

### Встроенный (уже работает)
- При каждом старте + по расписанию внутри приложения создаются снапшоты в `crm-backups/`.
- В админке: **Настройки → Бэкапы** — скачать, создать вручную, восстановить из файла.
- Восстановление из интерфейса **не сбрасывает сессии** пользователей.

### Внешний (рекомендуется добавить)

Холодная копия раз в сутки, вне сервера:

```bash
# /etc/cron.daily/nexuscrm-backup
#!/bin/sh
DEST=/backup/nexuscrm
mkdir -p "$DEST"
cp -a /opt/nexuscrm/NexusCRM/crm.db* "$DEST"/ 2>/dev/null
cp -a /opt/nexuscrm/NexusCRM/uploads "$DEST"/ 2>/dev/null
cp -a /opt/nexuscrm/NexusCRM/crm-backups "$DEST"/ 2>/dev/null
find "$DEST" -mtime +30 -delete
```

> SQLite в WAL-режиме: копируйте `crm.db` **вместе с** `crm.db-wal` и `crm.db-shm`
> (команда выше так и делает через маску `crm.db*`).

**Восстановление**: остановить сервис → вернуть файлы `crm.db*` на место → запустить.
Либо через админку: Настройки → Бэкапы → Восстановить (загрузив файл `.db`).

---

## 8. Обновление приложения

```bash
sudo systemctl stop nexuscrm

# 1. Распаковать новую версию поверх (база и uploads ЗАТРОНУТЫ НЕ БУДУТ — их нет в архиве)
sudo unzip -o NexusCRM-new.zip -d /opt/nexuscrm/

# 2. Обновить зависимости сервера
cd /opt/nexuscrm/NexusCRM/server && sudo -u nexuscrm npm ci --omit=dev

# 3. Права и запуск
sudo chown -R nexuscrm:nexuscrm /opt/nexuscrm/NexusCRM
sudo systemctl start nexuscrm
journalctl -u nexuscrm -n 50 --no-pager   # проверить старт
```

Перед обновлением сделайте бэкап (Настройки → Бэкапы → «Создать снапшот» или копия файла).

---

## 9. Безопасность — что уже встроено

| Механизм | Поведение |
|---|---|
| **Аутентификация** | Все `/api/*`, кроме `/api/health` и `/api/auth/login`, недоступны без сессии. Нет «гостевых» данных. |
| **Пароли** | Только bcrypt-хэши (cost 10). Минимум 8 символов. Пароли никогда не пишутся в журнал аудита. |
| **Антибрутфорс** | 10 неудачных по паре IP+логин за 10 минут → блокировка на 15 минут; 30 неудачных с одного IP → блокировка. Попытки пишутся в серверный лог. |
| **Сессии** | 32-байтовый случайный токен, httpOnly-кука, срок `SESSION_DAYS`, просроченные удаляются автоматически. Смена пароля завершает остальные сессии. Сброс пароля администратором — тоже. |
| **Права доступа** | Ролевая модель: каждый эндпоинт проверяет право (`contacts.view`, `admin.users` и пр.). Наблюдатель не сможет даже прочитать чужие данные сверх своей роли. |
| **CSP / заголовки** | Content-Security-Policy (скрипты только свои + хэши inline-блоков), `X-Frame-Options: SAMEORIGIN`, `nosniff`, `Referrer-Policy`, отключён `X-Powered-By`. |
| **CORS** | По умолчанию выключен вовсе (API принимает только same-origin запросы). |
| **Инъекции** | Все SQL-запросы только через подготовленные выражения (параметры), конкатенации ввода нет. |
| **Загрузка файлов** | Только `.xlsx/.xls/.csv` в импорт, лимит 20 МБ, разбор в памяти, на диск не пишется. Документы — в изолированный каталог, имя файла генерируется сервером. |
| **Зависимости** | Минимальный набор; известная оговорка — пакет `xlsx` имеет незакрытые CVE без фикса, риск нивелируется тем, что файлы загружают только авторизованные сотрудники с правом импорта. Следите за `npm audit` при обновлениях. |

### Чек-лист администратора после установки

- [ ] Пароль `admin` сменён (сервер при старте пишет предупреждение, если остался заводской).
- [ ] Заведены личные учётные записи всем сотрудникам; общий пароль не используется.
- [ ] Роли выданы по минимуму (Наблюдатель/Менеджер/Администратор).
- [ ] HTTPS настроен, `HOST=127.0.0.1`, `TRUST_PROXY=1`, порт 3001 закрыт снаружи.
- [ ] `.env` с правами `600`, владелец `nexuscrm`.
- [ ] Настроен внешний бэкап (п. 7) и проверено восстановление хотя бы раз.
- [ ] `journalctl -u nexuscrm` — в логе нет предупреждений безопасности.

---

## 10. Диагностика

| Симптом | Где смотреть |
|---|---|
| Не стартует | `journalctl -u nexuscrm -n 100 --no-pager` |
| Не пускает с правильным паролем | не сработал ли антибрутфорс (подождать 15 мин), не заблокирован ли пользователь (активность в админке) |
| «Приложение недоступно» через nginx | `sudo nginx -t`, `curl -i http://127.0.0.1:3001/api/health` |
| Вход «отваливается» сразу | проверьте `COOKIE_SECURE`: по обычному HTTP с `COOKIE_SECURE=1` браузер не пришлёт cookie |
| Место на диске | `du -sh /opt/nexuscrm/NexusCRM/{crm.db*,crm-backups,uploads}` |
| Журнал действий пользователей | Настройки → Аудит (в интерфейсе) |
