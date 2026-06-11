# 🤖 AI Assistant — Руководство по установке

## Пошаговая инструкция для развёртывания на VPS

---

## Шаг 1: Получите API-ключи

### Telegram Bot Token
1. Откройте Telegram и найдите **@BotFather**
2. Отправьте `/newbot`
3. Придумайте имя (например: "Мой Ассистент")
4. Придумайте username (например: `my_personal_ai_bot`)
5. Скопируйте полученный токен вида `123456789:ABCdefGHI...`

### VseGPT API Key (DeepSeek + Whisper)
1. Зайдите на **https://vsegpt.ru**
2. Зарегистрируйтесь
3. Пополните баланс (карта МИР, СБП, от 100₽)
4. Перейдите в **API-ключи** → создайте новый ключ
5. Скопируйте ключ вида `sk-...`

### GigaChat API Key (опционально, как резерв)
1. Зайдите на **https://developers.sber.ru/portal/products/gigachat-api**
2. Зарегистрируйтесь как разработчик
3. Создайте приложение и получите Client ID и Client Secret
4. Бесплатный лимит: ~1000 запросов/мес

---

## Шаг 2: Арендуйте VPS

### Рекомендуемые провайдеры (оплата МИР/СБП)

| Провайдер | Цена от | Ссылка |
|---|---|---|
| **Timeweb Cloud** | ~200₽/мес | https://timeweb.cloud |
| **Бегет** | ~200₽/мес | https://beget.com |
| **RuVDS** | ~300₽/мес | https://ruvds.com |
| **HostKEY** | ~250₽/мес | https://hostkey.ru |

### Минимальные требования
- **CPU:** 1 ядро
- **RAM:** 1 ГБ
- **Диск:** 10 ГБ SSD
- **ОС:** Ubuntu 22.04 / 24.04

---

## Шаг 3: Подготовка сервера

Подключитесь к серверу по SSH:
```bash
ssh root@YOUR_SERVER_IP
```

Обновите систему и установите зависимости:
```bash
# Обновление
sudo apt update && sudo apt upgrade -y

# Установка Node.js 20+ и bun
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Установка bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Установка git
sudo apt install -y git

# Установка sqlite3
sudo apt install -y sqlite3
```

---

## Шаг 4: Установка проекта

```bash
# Клонируйте проект (или загрузите файлы на сервер)
cd /opt
git clone YOUR_REPO_URL ai-assistant
cd ai-assistant

# Установка зависимостей
bun install

# Установка зависимостей бота
cd mini-services/telegram-bot
bun install
cd ../..

# Инициализация базы данных
bun run db:push
```

---

## Шаг 5: Настройка

```bash
# Скопируйте шаблон конфигурации
cp mini-services/telegram-bot/.env.example mini-services/telegram-bot/.env

# Отредактируйте конфигурацию
nano mini-services/telegram-bot/.env
```

Заполните значения:
```env
# Обязательно:
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...     # Ваш токен от BotFather
DEEPSEEK_API_KEY=sk-...                         # Ваш ключ VseGPT

# Опционально (резервный AI):
GIGACHAT_CLIENT_ID=your_client_id
GIGACHAT_CLIENT_SECRET=your_client_secret

# Настройки:
ALLOWED_TELEGRAM_IDS=123456789                  # Ваш Telegram ID (без пробелов)
TIMEZONE=Europe/Kaliningrad                     # Ваш часовой пояс
```

### Как узнать свой Telegram ID:
Напишите боту **@userinfobot** — он покажет ваш ID.

---

## Шаг 6: Запуск бота

### Тестовый запуск (для проверки)
```bash
cd /opt/ai-assistant/mini-services/telegram-bot
bun run index.ts
```

Вы должны увидеть:
```
🤖 AI Assistant Bot starting...
📡 DeepSeek model: deepseek-chat
🌐 Timezone: Europe/Kaliningrad
✅ Bot @my_personal_ai_bot is running!
⏰ Reminder scheduler started
```

### Запуск через systemd (автозапуск)

Создайте файл сервиса:
```bash
sudo nano /etc/systemd/system/ai-assistant.service
```

Содержимое:
```ini
[Unit]
Description=AI Assistant Telegram Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ai-assistant/mini-services/telegram-bot
ExecStart=/root/.bun/bin/bun run index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Запустите:
```bash
sudo systemctl daemon-reload
sudo systemctl enable ai-assistant
sudo systemctl start ai-assistant

# Проверка статуса
sudo systemctl status ai-assistant

# Просмотр логов
sudo journalctl -u ai-assistant -f
```

---

## Шаг 7: Настройка админ-панели (опционально)

Если хотите видеть дашборд в браузере:

```bash
cd /opt/ai-assistant

# Сборка проекта
bun run build

# Запуск в продакшн
bun run start
```

Админ-панель будет доступна по адресу: `http://YOUR_SERVER_IP:3000`

Для доступа извесьте настройте Caddy или Nginx с HTTPS.

---

## Шаг 8: Проверка работы

1. Откройте Telegram
2. Найдите вашего бота по username
3. Отправьте `/start`
4. Попробуйте:
   - Написать текст: «Привет! Что ты умеешь?»
   - Отправить голосовое сообщение
   - Отправить фото (например, чек)
   - «Напомни через 5 минут проверить бота»
   - «Добавь в покупки молоко, хлеб и сыр»

---

## Управление ботом

| Команда | Описание |
|---|---|
| `sudo systemctl start ai-assistant` | Запуск |
| `sudo systemctl stop ai-assistant` | Остановка |
| `sudo systemctl restart ai-assistant` | Перезапуск |
| `sudo systemctl status ai-assistant` | Статус |
| `sudo journalctl -u ai-assistant -f` | Логи в реальном времени |
| `sudo journalctl -u ai-assistant --since "1 hour ago"` | Логи за последний час |

---

## Обновление

```bash
cd /opt/ai-assistant
git pull
bun install
cd mini-services/telegram-bot && bun install && cd ../..
bun run db:push
sudo systemctl restart ai-assistant
```

---

## Решение проблем

### Бот не отвечает
1. Проверьте статус: `sudo systemctl status ai-assistant`
2. Проверьте логи: `sudo journalctl -u ai-assistant -f`
3. Убедитесь, что API-ключи корректны
4. Проверьте интернет: `curl -I https://api.telegram.org`

### Ошибка «DeepSeek API error»
1. Проверьте баланс на VseGPT
2. Проверьте правильность API-ключа
3. Если GigaChat настроен — бот переключится автоматически

### Ошибка «Whisper transcription error»
1. Аудио должно быть в формате OGG, MP3, M4A или WAV
2. Проверьте, что WHISPER_API_KEY совпадает с DEEPSEEK_API_KEY
3. Файл не должен превышать 25 МБ

### Напоминания не приходят
1. Убедитесь, что бот запущен (systemd status)
2. Проверьте TIMEZONE в .env
3. Напоминания проверяются каждую минуту

---

## Примерная стоимость

| Статья | Цена/мес |
|---|---|
| VPS | ~200-400₽ |
| VseGPT (DeepSeek + Whisper) | ~150-400₽ |
| GigaChat (резерв) | бесплатно до лимита |
| **Итого** | **~350-800₽/мес** |
