# 🧠 Telegram Memory Bot

Лёгкий персональный ИИ-ассистент для Telegram. Стоимость ~0.03-0.10₽ за запрос.

## Возможности

- 💬 **Чат** с ИИ (DeepSeek через VseGPT) — запоминает контекст
- 🧠 **Память** — автопрофиль пользователя, история разговоров
- 🖼️ **Картинки** — распознавание через gpt-4o-mini vision
- 🎤 **Голосовые** — транскрипция через Whisper + выделение главного
- ⏰ **Напоминания** — «напомни через 30 минут позвонить»
- 🔍 **Веб-поиск** — `/search запрос` (DuckDuckGo, бесплатно)
- 📝 **Заметки** — «запомни: пароль от wifi — abc123»
- 🇷🇺 Поддержка fallback IP для обхода блокировки в РФ

## Команды

| Команда | Описание |
|---------|----------|
| `/start` | Приветствие |
| `/help` | Все команды |
| `/clear` | Очистить историю |
| `/profile` | Что бот о тебе знает |
| `/stats` | Статистика |
| `/search запрос` | Поиск в интернете |
| `/reminders` | Список напоминаний |
| `/cancel N` | Отменить напоминание |
| `/notes` | Все заметки |
| `/delnote N` | Удалить заметку |

## Интеллектуальные команды

Просто напиши на естественном языке:
- «напомни через 2 часа позвонить маме» → ⏰ создаст напоминание
- «запомни: пароль от роутера admin123» → 📝 сохранит заметку
- Отправь голосовое → 🎤 расшифрует и выделит главное
- Отправь картинку → 🖼️ опишет что на ней

## Установка

### Вручную (Ubuntu/Debian)

```bash
# 1. Клонируем
git clone https://github.com/drozdoff880508/telegram-memory-bot.git
cd telegram-memory-bot

# 2. Создаём venv и ставим зависимости
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. Настраиваем
cp .env.example .env
nano .env

# 4. Запускаем
python bot.py
```

### Через Docker

```bash
git clone https://github.com/drozdoff880508/telegram-memory-bot.git
cd telegram-memory-bot
cp .env.example .env
nano .env
docker compose up -d
```

### Как systemd-сервис

```bash
sudo cp telegram-memory-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable telegram-memory-bot
sudo systemctl start telegram-memory-bot

# Логи
journalctl -u telegram-memory-bot -f
```

## Настройка .env

| Переменная | Описание | По умолчанию |
|-----------|----------|--------------|
| `BOT_TOKEN` | Токен Telegram бота | — |
| `LLM_API_KEY` | API ключ VseGPT | — |
| `LLM_BASE_URL` | URL API | `https://api.vsegpt.ru/v1` |
| `LLM_MODEL` | Модель для чата | `deepseek/deepseek-chat` |
| `VISION_MODEL` | Модель для картинок | `openai/gpt-4o-mini` |
| `STT_MODEL` | Модель для голосовых | `openai/whisper-1` |
| `MAX_HISTORY_MESSAGES` | Сколько сообщений помнить | `30` |
| `ALLOWED_USERS` | Разрешённые Telegram ID | пусто = все |
| `TELEGRAM_FALLBACK_IP` | IP для обхода блокировки | `149.154.167.220` |

## Стоимость

| Действие | Модель | Примерная стоимость |
|----------|--------|-------------------|
| Текстовый чат | deepseek-chat | ~0.03-0.05₽ |
| Картинка | gpt-4o-mini | ~0.10-0.30₽ |
| Голосовое | whisper-1 | ~0.05-0.15₽ |
| Напоминание (создание) | deepseek-chat | ~0.03₽ |
| Напоминание (отправка) | — | бесплатно |
| Веб-поиск | — | бесплатно |

## Архитектура

```
┌──────────┐     ┌───────────┐     ┌──────────┐
│ Telegram │ ──▶ │  aiogram  │ ──▶ │ DeepSeek │
│   User   │ ◀── │  handlers │ ◀── │   API    │
└──────────┘     └─────┬─────┘     └──────────┘
                       │
              ┌────────┼────────┐
              │        │        │
        ┌─────▼──┐ ┌──▼────┐ ┌─▼──────┐
        │ SQLite │ │Whisper│ │DuckDuck│
        │ Memory │ │  STT  │ │  Go    │
        └────────┘ └───────┘ └────────┘
```

- **bot.py** — точка входа + фоновый чекер напоминаний
- **handlers.py** — обработчики сообщений и команд
- **llm_client.py** — клиент LLM (чат, vision, STT, профили, парсинг)
- **memory.py** — SQLite хранилище (история, профили, напоминания, заметки)
- **web_search.py** — поиск через DuckDuckGo
- **config.py** — конфигурация из .env
