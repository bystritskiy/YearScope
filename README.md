<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo.svg" />
    <img src="public/logo-light.svg" width="200" alt="YearScope" />
  </picture>
</p>

<p align="center">
  Игры, сериалы, кино, книги и тренировки — на одном экране и в сумме часов.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/self--hosted-локально-06b6d4?style=flat-square" alt="self-hosted" />
  <img src="https://img.shields.io/badge/license-MIT-a78bfa?style=flat-square" alt="MIT" />
</p>

<p align="center">
  <img src="docs/screenshots/summary.png" width="900" alt="Сводка YearScope: 756 часов за год, разбитые по пяти активностям" />
</p>

## Что это

Ты играешь, смотришь, читаешь и тренируешься — и каждый сервис знает только свой кусочек. YearScope собирает их в одну картину: **сколько часов за год, на что именно и в каком месяце**.

Всё работает дома. Аккаунтов нет, трекинга нет, данные лежат в одном файле SQLite рядом с сервисом.

## Откуда данные

- 🎮 игры — [gowithme.club](https://gowithme.club)
- 📺 сериалы — [myshows.me](https://myshows.me)
- 🎬 кино — [letterboxd.com](https://letterboxd.com)
- 📚 книги — [koshelf](https://github.com/scampower3/koshelf)
- 🏃 тренировки — [intervals.icu](https://intervals.icu)

## Установка

Нужен только [Node 24+](https://nodejs.org). `npm install` не нужен: **ноль зависимостей** — свежий Node умеет SQLite и TypeScript из коробки.

```bash
npm run demo
```

Поднимет демо-год со скриншотов на `localhost:3010` — без ключей, аккаунтов и сети.

Со своими данными:

```bash
cp .env.example .env   # вписать свои ники и ключи
npm start
```

Или в Docker:

```bash
docker compose up -d --build
```

Обязательных полей в `.env` нет: незаполненный источник просто выключается, остальные работают. Что и зачем — в [`.env.example`](.env.example), как устроены источники — в [docs/sources.md](docs/sources.md).

## Лицензия

[MIT](LICENSE)
