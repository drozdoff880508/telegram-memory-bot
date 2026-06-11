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

> **Важно:** Один ключ VseGPT даёт доступ и к DeepSeek (текст+картинки), и к Whisper (распознавание голоса). Два отдельных ключа не нужны.

### GigaChat API Key (опционально, как резерв)
1. Зайдите на **https://developers.sber.ru/portal/products/gigachat-api**
2. Зарегистрируйтесь как разработчик
3. Создайте приложение и получите Client ID и Client Secret
4. Бесплатный лимит: ~1000 запросов/мес
5. GigaChat также используется для бесплатного распознавания аудио (лучший русский)

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

# Установка bun (рекомендуется, быстрый runtime)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Или Node.js 20+ (альтернатива)
# curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
# sudo apt install -y nodejs

# Установка git
sudo apt install -y git

# Установка sqlite3 (для проверки БД)
sudo apt install -y sqlite3
```

---

## Шаг 4: Установка проекта

```bash
# Клонируйте проект (или загрузите файлы на сервер)
cd /opt
git clone YOUR_REPO_URL ai-assistant
cd ai-assistant

# Установка зависимостей бота
cd mini-services/telegram-bot
bun install

# Создание директории для БД
mkdir -p db
```

> **Примечание:** Таблицы SQLite создаются автоматически при первом запуске бота. Никаких ручных миграций не требуется.

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

# Опционально (резервный AI + бесплатное распознавание аудио):
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
✅ Database tables ready
✅ Bot @my_personal_ai_bot is running!
⏰ Reminder scheduler started
```

Если всё работает — нажмите Ctrl+C и настройте автозапуск.

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

## Шаг 7: Проверка работы

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

## Архитектура системы

```
Пользователь → Telegram → Bot (grammy)
                           ├── Текст → DeepSeek V4 (через VseGPT)
                           ├── Фото  → DeepSeek V4 Vision
                           ├── Аудио → GigaChat Audio (бесплатно) → Whisper (фолбэк)
                           └── Напоминания → node-cron → SQLite

Фолбэк: если DeepSeek недоступен → GigaChat Pro
```

### Цепочка распознавания аудио:
1. **GigaChat Audio** (бесплатно, лучший русский) — пробуем первым
2. **Whisper через VseGPT** (~$0.006/мин) — фолбэк
3. DeepSeek V4 **не умеет** распознавать аудио — только текст и картинки

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

### Просмотр содержимого БД:
```bash
sqlite3 /opt/ai-assistant/mini-services/telegram-bot/db/custom.db
sqlite> .tables
sqlite> SELECT * FROM Reminder WHERE isSent = 0;
sqlite> SELECT * FROM ShoppingItem WHERE isBought = 0;
sqlite> .quit
```

---

## Обновление

```bash
cd /opt/ai-assistant
git pull
cd mini-services/telegram-bot && bun install
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
2. Файл не должен превышать 25 МБ
3. GigaChat Audio пробуется первым — если он настроен, Whisper может не понадобиться

### Напоминания не приходят
1. Убедитесь, что бот запущен (systemd status)
2. Проверьте TIMEZONE в .env
3. Напоминания проверяются каждую минуту

### Ошибка «Database tables»
1. Таблицы создаются автоматически при запуске
2. Если ошибка persists — удалите БД: `rm db/custom.db` и перезапустите

---

## Примерная стоимость

| Статья | Цена/мес |
|---|---|
| VPS | ~200-400₽ |
| VseGPT (DeepSeek + Whisper) | ~150-400₽ |
| GigaChat (резерв + ASR) | бесплатно до лимита |
| **Итого** | **~350-800₽/мес** |

### Расход по операциям (примерно):
- Текстовый чат: ~0.1₽ за запрос
- Распознавание голоса (GigaChat): бесплатно
- Распознавание голоса (Whisper): ~0.4₽ за минуту
- Анализ картинки: ~0.3₽ за изображение
