# 🧠 Telegram Memory Bot

Лёгкий ИИ-ассистент для Telegram с памятью. Стоимость ~0.03-0.10₽ за запрос.

## Возможности

- 💬 Чат с ИИ (DeepSeek через VseGPT)
- 🧠 Память — запоминает контекст разговора и предпочтения пользователя
- 🖼️ Распознавание изображений (gpt-4o-mini)
- 📋 Автоматическое создание профиля пользователя
- 🇷🇺 Поддержка fallback IP для обхода блокировки Telegram API в РФ
- 💰 Минимальный расход токенов (~0.03-0.10₽ за запрос)

## Команды

| Команда | Описание |
|---------|----------|
| `/start` | Приветствие |
| `/clear` | Очистить историю разговора |
| `/profile` | Посмотреть профиль (что бот о тебе знает) |
| `/stats` | Статистика использования |
| `/help` | Справка |

## Установка

### Вручную (Ubuntu/Debian)

```bash
# 1. Клонируем
git clone https://github.com/YOUR_USERNAME/telegram-memory-bot.git
cd telegram-memory-bot

# 2. Создаём venv и ставим зависимости
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. Копируем и настраиваем .env
cp .env.example .env
nano .env

# 4. Запускаем
python bot.py
```

### Через Docker

```bash
git clone https://github.com/YOUR_USERNAME/telegram-memory-bot.git
cd telegram-memory-bot
cp .env.example .env
nano .env
docker compose up -d
```

### Как systemd-сервис

```bash
# Копируем сервис
sudo cp telegram-memory-bot.service /etc/systemd/system/

# Редактируем пути если нужно
sudo nano /etc/systemd/system/telegram-memory-bot.service

# Запускаем
sudo systemctl daemon-reload
sudo systemctl enable telegram-memory-bot
sudo systemctl start telegram-memory-bot

# Логи
journalctl -u telegram-memory-bot -f
```

## Настройка .env

| Переменная | Описание | По умолчанию |
|-----------|----------|--------------|
| `BOT_TOKEN` | Токен Telegram бота (от @BotFather) | — |
| `LLM_API_KEY` | API ключ VseGPT | — |
| `LLM_BASE_URL` | URL API | `https://api.vsegpt.ru/v1` |
| `LLM_MODEL` | Модель для чата | `deepseek/deepseek-chat` |
| `VISION_MODEL` | Модель для картинок | `openai/gpt-4o-mini` |
| `MAX_HISTORY_MESSAGES` | Сколько сообщений помнить | `30` |
| `ALLOWED_USERS` | Разрешённые Telegram ID (через запятую) | пусто = все |
| `TELEGRAM_FALLBACK_IP` | IP для обхода блокировки | `149.154.167.220` |
| `SYSTEM_PROMPT` | Системный промпт | См. .env.example |

## Архитектура

```
┌──────────┐     ┌───────────┐     ┌──────────┐
│ Telegram │ ──▶ │  aiogram  │ ──▶ │ DeepSeek │
│   User   │ ◀── │  handlers │ ◀── │   API    │
└──────────┘     └─────┬─────┘     └──────────┘
                       │
                 ┌─────▼─────┐
                 │   SQLite  │
                 │  Memory   │
                 └───────────┘
```

- **bot.py** — точка входа, запуск бота
- **handlers.py** — обработчики сообщений и команд
- **llm_client.py** — клиент LLM (чат, vision, профили)
- **memory.py** — SQLite хранилище (история, профили, настройки)
- **config.py** — конфигурация из .env
