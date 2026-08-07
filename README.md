# Car Hunter MVP

Car Hunter збирає оголошення BMW E91/E61 Touring з OTOMOTO, OLX та Allegro, нормалізує їх, зберігає історію в Supabase, рахує deterministic score, аналізує лише перспективні варіанти через Gemini й надсилає в Telegram тільки рекомендації `call` або `inspect`.

## Вимоги

- Node.js 22+
- pnpm 10+
- проєкт Supabase
- Telegram-бот
- Gemini API key
- шість широких пошукових URL (E91/E61 для трьох маркетплейсів)

## 1. Локальне встановлення

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
```

Заповніть `.env`. Реальні секрети не комітьте. Межі ціни й року можна змінити в `src/config/searches.ts`; пошукові URL мають бути ширшими за остаточні критерії.

## 2. Supabase

Створіть проєкт, скопіюйте Project URL і service-role key у `.env`, потім застосуйте міграцію:

```bash
pnpm dlx supabase login
pnpm dlx supabase link --project-ref YOUR_PROJECT_REF
pnpm dlx supabase db push
```

Міграція створює `listings`, `listing_snapshots`, `listing_analysis`, `sellers`, `scan_runs`, `notifications` та `app_state`. RLS увімкнений без публічних політик: бекенд працює service-role ключем. Для власного dashboard додайте окремі read-only політики.

## 3. Telegram

1. Створіть бота через `@BotFather` і внесіть токен у `.env`.
2. Надішліть боту будь-яке повідомлення.
3. Отримайте chat ID:

```bash
pnpm telegram:chat-id
```

Скопіюйте ID у `TELEGRAM_CHAT_ID`.

Перевірте з’єднання тестовим повідомленням:

```bash
pnpm test:telegram
```

Старий alias `pnpm telegram:test` також підтримується.

## 4. Обов’язковий baseline

Перший запуск записує поточні оголошення як уже відомі й ніколи не надсилає Telegram-сповіщення:

```bash
pnpm baseline
```

Варіанти для дешевшої/точкової перевірки:

```bash
pnpm baseline -- --skip-ai
pnpm baseline -- --source=otomoto
pnpm baseline -- --profile=bmw-e91
```

Точкові варіанти з `--source` або `--profile` зберігають дані, але навмисно не виставляють глобальний прапорець завершення. Після діагностики все одно виконайте повний `pnpm baseline` без фільтрів.

Перевірте в Supabase, що `listings` та `listing_snapshots` заповнені, дублі не виникли, а `app_state.baseline_completed` має значення `true`.

Baseline запам’ятовує окремо кожну активну пару профіль/джерело. Якщо пізніше додати ще один URL або ввімкнути нове джерело, звичайний scan зупиниться без сповіщень, доки ви знову не виконаєте повний baseline.

## 5. Звичайне сканування

```bash
pnpm scan
```

Якщо baseline не завершений, команда безпечно відмовиться від моніторингу й не надішле жодного повідомлення. Незмінне оголошення не аналізується й не сповіщається повторно. Зміна опису, VIN, продавця або ціни створює нову матеріальну версію; падіння ціни щонайменше на 1 000 zł або 3% позначається окремо.

## 6. Ручна AI-перевірка

Скопіюйте UUID із колонки `listings.id` у Supabase і проаналізуйте одну машину:

```bash
pnpm analyze <listing-id>
```

Команда повторно рахує deterministic score, запускає Gemini, зберігає результат у
`listing_analysis` і друкує JSON у термінал. Telegram вона не викликає.

Для ручної перевірки повного ланцюжка AI → Telegram:

```bash
pnpm analyze <listing-id> --send
```

Тестове повідомлення надсилається напряму й не створює запис у бойовій таблиці
`notifications`.

## 7. GitHub Actions

Workflow `.github/workflows/scan.yml` запускається кожні 30 хвилин і вручну. До ввімкнення cron:

- додайте Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`;
- додайте Variables: шість `*_E91_URL`/`*_E61_URL` із `.env.example`;
- локально виконайте baseline;
- один раз запустіть workflow вручну та перевірте лог.

За потреби задайте Variables `GEMINI_MODEL`, `MAX_LISTINGS_PER_SOURCE`, `MAX_SEARCH_PAGES`, `DETAIL_CONCURRENCY`, `AI_SCORE_THRESHOLD`, `NOTIFICATION_SCORE_THRESHOLD`. Адаптери проходять сторінки пагінації до цих захисних лімітів і обробляють до трьох detail-сторінок паралельно; для повного першого імпорту ліміти мають покривати весь обсяг результатів кожного пошуку.

## Перевірки

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

## Важливі обмеження MVP

- Адаптери використовують браузер і віддають перевагу JSON-LD/семантичним даним сторінки, без обходу CAPTCHA чи інших механізмів захисту. Перед використанням перевірте актуальні правила кожного маркетплейсу та задайте помірну частоту запуску.
- AI оцінює лише якість оголошення, відповідність профілю й поведінку продавця; це не технічна діагностика автомобіля.
- Значення за замовчуванням — актуальна стабільна бюджетна модель `gemini-3.5-flash-lite`; модель конфігурується через `GEMINI_MODEL`.
