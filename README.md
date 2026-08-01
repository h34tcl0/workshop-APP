# 🚀 AGENDAPP (Workshop OS) — Technical Blueprint & Architecture Single Source of Truth

**AGENDAPP** (formerly *Workshop OS*) is an autonomous, weather-intelligent operational execution system designed specifically for outdoor carpentry workshops, woodworking studios, and weather-sensitive manufacturing. 

It acts as a continuous decision loop: ingesting real-time meteorological forecasts, evaluating environmental drying/curing thresholds against task backlogs, scheduling macro-blocks, automatically syncing calendar blocks via the **Google Calendar API**, and delivering interactive operational prompts through a **Telegram Bot**.

---

## 📌 1. Executive Overview & Objectives

### The Problem
Outdoor carpentry and technical crafting suffer from strict environmental vulnerabilities:
- **PVA Wood Glues & Epoxies**: Require specific temperature ranges (typically > 10°C) and zero moisture exposure during curing. High humidity (>80%) significantly degrades cure strength.
- **Finishes & Paints**: Water-based and oil-based topcoats require minimum temperatures and maximum humidity caps to avoid blushing, bubbling, or failing to dry.
- **Outdoor Assembly & Power Tools**: Rain, high winds, or freezing conditions halt outdoor assembly and raw timber handling.
- **Wasted Operational Hours**: Craftspeople lose hours manually checking forecasts or starting assembly only to be interrupted by unpredicted rain mid-cure.

### The AGENDAPP Solution
AGENDAPP automates workshop planning by:
1. **Hourly Forecast Evaluation**: Checking temperature, humidity, and rain probability hour-by-hour across operational work windows (e.g. 09:00 to 18:00).
2. **Setup, Active & Passive Curing Window Fitting**: Differentiating between active work (`setup_hours` + `estimated_hours`) and passive drying (`curing_hours`). Tasks requiring curing are checked to ensure rain will not occur during the post-work curing window.
3. **Automated Event Creation**: Syncing macro-work blocks directly to **Google Calendar** with scheduled task breakdowns and dual 60-min / 30-min reminders.
4. **Interactive Telegram Assistant**: Broadcasting morning feasibility reports and sending evening check-in messages with interactive inline buttons (`Completada ✅`, `Reagendar 🔁`) to instantly update task statuses without opening a web browser.

---

## 🛠️ 2. Tech Stack & Architecture

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Backend Runtime** | Node.js (v18+) & Express | Event-driven HTTP web server and REST API host. |
| **Language** | TypeScript | Strict type safety for domain models, database queries, and evaluation engines. |
| **Bundler / Compiler** | `esbuild` | Fast production compilation generating `dist/server.cjs` (Node CJS target). |
| **Database Engine** | SQLite via `sql.js` | In-memory SQLite relational engine with atomic disk persistence (`data/workshop.db`). |
| **Calendar Integration**| `googleapis` (v173+) | Google Calendar API v3 integration with Service Account & OAuth credentials. |
| **Bot & Messaging** | Telegram Bot API | Custom HTTP polling & webhook engine with inline keyboard callback handlers. |
| **Weather Engine** | Open-Meteo API | Hourly meteorological data fetching with fallback mock scenarios. |
| **Frontend Rendering** | EJS (Embedded JavaScript) | Server-Side Rendered views with responsive components. |
| **Styling & UI** | Tailwind CSS | Utility-first CSS layout with custom dark/slate theme design tokens. |
| **PWA Layer** | Web App Manifest & Service Worker | Installable mobile web app with network-first Service Worker asset caching (`sw.js`). |
| **Daemon Scheduler** | Custom `node-cron` / Ticker | 5-minute autonomous ticker checking evaluation times, check-ins, and intraday weather risks. |

---

## 📂 3. Directory Tree & Module Topology

```
AGENDAPP/
├── .env.example                  # Template for environment configuration
├── .gitignore                    # Git exclusion rules
├── Dockerfile                    # Containerization build recipe
├── README.md                     # Technical architecture documentation
├── metadata.json                 # AI Studio app capabilities & metadata
├── package.json                  # NPM dependencies, scripts, and build target
├── tsconfig.json                 # TypeScript compiler configuration
├── server.ts                     # Express application entry point & route definitions
├── data/                         # Persistent database directory
│   └── workshop.db               # SQLite database file (generated at runtime)
├── src/                          # Backend TypeScript source code
│   ├── auth.ts                   # Cryptographic authentication & session signing
│   ├── calendarService.ts        # Google Calendar API integration service
│   ├── dateUtils.ts              # Localized date formatting & timezone helpers
│   ├── db.ts                     # SQLite initialization, schema definition & query store
│   ├── evaluator.ts              # Weather feasibility & curing timeline evaluation engine
│   ├── holidaysService.ts        # Holiday detection & date exclusion logic
│   ├── scheduler.ts              # Background daemon tick engine & local time utilities
│   ├── telegramBot.ts            # Telegram Bot polling, webhook & callback handler
│   ├── types.ts                  # Domain models, TypeScript interfaces & status enums
│   └── weatherService.ts         # Open-Meteo & mock weather forecast ingestion
├── static/                       # Static frontend assets
│   ├── manifest.json             # PWA Web App Manifest configuration
│   ├── sw.js                     # Service Worker script for offline caching
│   ├── css/
│   │   └── main.css              # Custom Tailwind CSS rules & layout styling
│   ├── icons/                    # App icon assets (SVG/PNG)
│   └── js/
│       ├── agenda.js             # Timeline rendering & task agenda interactions
│       ├── backlog.js            # Task creation, modal controls & project backlog
│       ├── map.js                # Location selection & coordinate handling
│       └── settings.js           # User configuration & Telegram testing handlers
└── views/                        # EJS template views
    ├── index.ejs                 # Primary AGENDAPP dashboard view
    ├── login.ejs                 # Authentication login view
    ├── register.ejs              # User registration view
    └── components/               # Modular EJS components
        ├── agenda.ejs            # Timeline & scheduled task block component
        ├── backlog.ejs           # Project task backlog & template drawer component
        └── settings_modal.ejs    # Settings modal component for operational parameters
```

---

## 📑 4. Exhaustive File-by-File Technical Matrix

Below is the complete catalog of every file in the repository, detailing its primary responsibility, key exports, and system dependencies.

| File Path & Name | Primary Responsibility & Module Owner | Key Exports & Functions | Core Dependencies & Interacting Modules |
| :--- | :--- | :--- | :--- |
| `server.ts` | Express server entry point, route middleware, and HTTP API handling. | Server initialization, REST routes (`/api/*`, `/evaluation/*`, `/settings/*`), auth routes. | `express`, `src/db.ts`, `src/auth.ts`, `src/scheduler.ts`, `src/telegramBot.ts` |
| `src/auth.ts` | Security module for password hashing and HMAC session token signing. | `hashPassword`, `verifyPassword`, `signToken`, `verifyToken`, `requireAuth`, `createSessionCookie` | Node `crypto`, `express`, `src/db.ts` |
| `src/calendarService.ts` | Integration with Google Calendar API v3 for event creation. | `GoogleCalendarService`, `calendarService.createWorkshopEvent` | `googleapis`, Node `fs`, Node `path`, `src/db.ts` |
| `src/dateUtils.ts` | Formatting helpers for Spanish localized dates and time strings. | `formatDateShortEs`, `formatDateLongEs` | Standard JS Date APIs |
| `src/db.ts` | SQLite database manager, schema migrations, and query data access object (`store`). | `initDatabase`, `store` (CRUD for tasks, projects, app_settings, daily_logs, etc.) | `sql.js`, Node `fs`, Node `path`, `src/types.ts`, `src/auth.ts` |
| `src/evaluator.ts` | Core weather evaluation algorithm, curing logic, and task fitting. | `evaluator.evaluateDay` | `src/types.ts`, `src/holidaysService.ts` |
| `src/holidaysService.ts` | Statutory holiday detection for Chile / operational region. | `getHolidayDatesForRange`, `isHoliday` | `src/types.ts` |
| `src/scheduler.ts` | Daemon ticker controlling evaluation runs, Telegram alerts, check-ins. | `startDaemon`, `runMorningEvaluation`, `runCheckinTick`, `runWeatherAlertTick`, `getLocalDateIso` | `src/db.ts`, `src/evaluator.ts`, `src/weatherService.ts`, `src/telegramBot.ts`, `src/calendarService.ts` |
| `src/telegramBot.ts` | Telegram Bot service handling notifications, webhooks, and inline button callbacks. | `TelegramBotService`, Telegram webhook endpoint handlers | `src/db.ts`, `src/types.ts`, HTTP fetch API |
| `src/types.ts` | Central TypeScript interfaces, type aliases, and system enums. | `Task`, `Project`, `AppSettings`, `DayEvaluation`, `DayStatus`, `TaskStatus`, `TaskCategory`, `WeatherRisk` | Pure TypeScript type definitions |
| `src/weatherService.ts` | Meteorological forecast client for Open-Meteo API and mock scenarios. | `getHourlyForecast`, `MockWeatherService` | HTTP fetch API, `src/types.ts` |
| `views/index.ejs` | Main dashboard template layout combining Agenda, Backlog, and Settings. | SSR Dashboard HTML structure | EJS Engine, Tailwind CSS, `views/components/*` |
| `views/login.ejs` | Login form view with password and session submission. | Authentication Login Form | EJS Engine, `src/auth.ts` |
| `views/register.ejs` | User registration view for creating new workshop accounts. | Registration Form | EJS Engine, `src/auth.ts` |
| `views/components/agenda.ejs` | Dashboard component rendering active day timeline and weather window. | Timeline EJS Partial | `views/index.ejs` |
| `views/components/backlog.ejs` | Dashboard component rendering project task cards and template manager. | Backlog EJS Partial | `views/index.ejs` |
| `views/components/settings_modal.ejs` | Modal component for modifying operational parameters & Telegram settings. | Settings Modal EJS Partial | `views/index.ejs` |
| `static/js/agenda.js` | Client-side DOM logic for timeline visualization and task status updates. | Task progress handlers, inline state updates | Browser DOM API |
| `static/js/backlog.js` | Client-side DOM logic for creating tasks, editing projects, applying templates. | Modal controls, task creation AJAX | Browser DOM API |
| `static/js/favorites.js` | Autocomplete logic for quick task selection without blur conflicts. | Real-time title/category search | Browser DOM API |
| `static/js/map.js` | Interactive coordinate map selector for workshop location configuration. | Latitude/longitude picker | Leaflet.js / OpenStreetMap DOM API |
| `static/js/settings.js` | Settings form submission handlers and Telegram test message buttons. | Settings AJAX handlers | Browser DOM API |
| `static/css/main.css` | Custom styles, scrollbar styling, and Tailwind imports. | CSS design tokens | Browser CSS Engine |
| `static/manifest.json` | Web App Manifest for mobile installation (PWA). | Web App Metadata | Mobile Browsers / PWA Installers |
| `static/sw.js` | Service Worker providing network-first caching for offline readiness. | SW fetch interceptor & cache management | Browser Service Worker API |
| `.env.example` | Environment variable specification template. | Config blueprint | Node `process.env` |
| `Dockerfile` | Multi-stage Docker container specification. | Container build recipe | Docker Engine |
| `package.json` | Project manifest, dependencies, and build/start scripts. | Dependency graph & scripts | NPM / Node.js |
| `tsconfig.json` | TypeScript compiler options. | TS Compiler configuration | `tsc` / `esbuild` / `tsx` |
| `metadata.json` | Platform metadata and major capabilities. | Platform features registration | AI Studio Environment |

---

## 🔄 5. End-to-End Data Flow & Lifecycles

```
+-----------------------------------------------------------------------------------+
|                                DAEMON TICKER                                      |
|                             (src/scheduler.ts)                                    |
+----------------------------------------+------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 1. INGEST FORECAST                     | 2. EVALUATE FEASIBILITY                  |
| Open-Meteo API / Mock                  | Weather Engine (src/evaluator.ts)        |
| -> Hourly Temp, Humidity, Rain         | -> Match Working Window & Curing Caps    |
+----------------------------------------+------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 3. PERSIST DAY LOG                                                                |
| Store Evaluation in SQLite (src/db.ts -> daily_logs table)                        |
+-------------------+---------------------------------------+-----------------------+
                    |                                       |
                    v                                       v
+---------------------------------------+   +---------------------------------------+
| 4. GOOGLE CALENDAR SYNC               |   | 5. TELEGRAM MORNING BROADCAST         |
| (src/calendarService.ts)              |   | (src/telegramBot.ts)                  |
| Creates Macro-Block Event:            |   | Sends Morning Summary Card with       |
| "🔨 Taller Carpintería (09:00-17:00)" |   | Scheduled Tasks to Workshop Operator  |
+---------------------------------------+   +---------------------------------------+
                                                            |
                                                            v
+-----------------------------------------------------------------------------------+
| 6. EVENING CHECK-IN PROMPT (src/telegramBot.ts @ checkin_hour)                    |
| Sends Interactive Message with Inline Keyboard:                                   |
| [ Completada ✅ ]   [ Reagendar 🔁 ]                                              |
+----------------------------------------+------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 7. CALLBACK QUERY PROCESSING (src/telegramBot.ts Callback Handler)                 |
| Operator taps button -> Bot receives webhook/polling payload                     |
| -> SQLite task status updated to 'completed' or rescheduled to next cycle        |
+-----------------------------------------------------------------------------------+
```

---

## 🗄️ 6. Database Schema & Domain Type System

### SQLite Database Tables (`data/workshop.db`)

#### 1. `users`
| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique user identifier. |
| `email` | TEXT | UNIQUE NOT NULL | User login email address. |
| `password_hash` | TEXT | NOT NULL | PBKDF2 hash formatted as `salt:hash`. |
| `created_at` | TEXT | NOT NULL | ISO Timestamp of user creation. |

#### 2. `app_settings`
| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY CHECK(id=1) | Singleton settings row. |
| `operational_start_hour` | INTEGER | NOT NULL DEFAULT 9 | Day start time (0-23). |
| `operational_end_hour` | INTEGER | NOT NULL DEFAULT 18 | Day end time (0-23). |
| `max_humidity_percent` | REAL | NOT NULL DEFAULT 80.0 | Maximum allowed humidity % for work. |
| `latitude` | REAL | NOT NULL DEFAULT -32.99 | Workshop location latitude. |
| `longitude` | REAL | NOT NULL DEFAULT -71.27 | Workshop location longitude. |
| `setup_hours` | REAL | NOT NULL DEFAULT 1.0 | Setup time required before active work. |
| `teardown_hours` | REAL | NOT NULL DEFAULT 1.0 | Cleanup time required after active work. |
| `min_work_hours` | REAL | NOT NULL DEFAULT 1.0 | Minimum work window length to mark day viable. |
| `min_work_hours_unless_final`| REAL | NOT NULL DEFAULT 4.0 | Threshold required unless finalizing project. |
| `min_rain_precipitation_mm` | REAL | NOT NULL DEFAULT 0.2 | Minimum rain mm/h considered active precipitation. |
| `checkin_hour` | INTEGER | NOT NULL DEFAULT 19 | Hour for evening Telegram check-in prompt. |
| `morning_eval_lead_hours` | INTEGER | NOT NULL DEFAULT 1 | Hours before work start to run morning evaluation. |
| `exclude_saturdays` | INTEGER | NOT NULL DEFAULT 1 | Boolean (0/1): Exclude Saturdays. |
| `exclude_sundays` | INTEGER | NOT NULL DEFAULT 1 | Boolean (0/1): Exclude Sundays. |
| `exclude_holidays` | INTEGER | NOT NULL DEFAULT 1 | Boolean (0/1): Exclude statutory holidays. |
| `require_curing_before_cutoff`| INTEGER | NOT NULL DEFAULT 1 | Boolean (0/1): Enforce curing completion before day end. |

#### 3. `projects`
| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Project identifier. |
| `name` | TEXT | NOT NULL | Project title. |
| `description` | TEXT | NULL | Project details. |
| `is_active` | INTEGER | NOT NULL DEFAULT 0 | Active project selector flag. |

#### 4. `tasks`
| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Task identifier. |
| `project_id` | INTEGER | NOT NULL | FK to `projects.id`. |
| `title` | TEXT | NOT NULL | Task title. |
| `description` | TEXT | NULL | Detailed task instructions. |
| `category` | TEXT | NOT NULL | Category (e.g., `carpentry`, `pva_glue`, `epoxy`, `finish`). |
| `estimated_hours` | REAL | NOT NULL DEFAULT 1.0 | Active work duration in hours. |
| `curing_hours` | REAL | NOT NULL DEFAULT 0.0 | Passive drying duration in hours. |
| `requires_curing` | INTEGER | NOT NULL DEFAULT 0 | Boolean (0/1): Flags if task needs drying time. |
| `status` | TEXT | NOT NULL DEFAULT 'pending' | Task state (`pending`, `scheduled`, `in_progress`, `completed`, `blocked`). |
| `progress_percentage` | INTEGER | NOT NULL DEFAULT 0 | Completion progress (0-100). |
| `order_num` | INTEGER | NOT NULL DEFAULT 1 | Display sequence order within project. |
| `completed_at` | TEXT | NULL | ISO timestamp when completed. |

#### 5. `daily_logs`
| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Log entry identifier. |
| `eval_date` | TEXT | UNIQUE NOT NULL | Evaluation date (`YYYY-MM-DD`). |
| `status` | TEXT | NOT NULL | Day outcome status (`DAY_VIABLE` / `DAY_BLOCKED`). |
| `block_reason` | TEXT | NULL | Human readable reason if day is blocked. |
| `window_start` | TEXT | NULL | Feasible work window start time (`HH:MM`). |
| `window_end` | TEXT | NULL | Feasible work window end time (`HH:MM`). |
| `net_work_hours` | REAL | NULL | Calculated usable work hours. |
| `tasks_summary` | TEXT | NULL | String summary of scheduled tasks. |
| `scheduled_task_ids` | TEXT | NULL | JSON array string of scheduled task IDs. |
| `morning_climate_snapshot` | TEXT | NULL | Snapshot of weather metrics during evaluation. |
| `telegram_notified` | INTEGER | NOT NULL DEFAULT 0 | Boolean flag: Telegram morning alert sent. |
| `calendar_created` | INTEGER | NOT NULL DEFAULT 0 | Boolean flag: Google Calendar event inserted. |
| `checkin_sent` | INTEGER | NOT NULL DEFAULT 0 | Boolean flag: Evening check-in prompt sent. |
| `checkin_resolved` | INTEGER | NOT NULL DEFAULT 0 | Boolean flag: Operator completed evening check-in. |
| `weather_alert_sent` | INTEGER | NOT NULL DEFAULT 0 | Boolean flag: Intraday weather warning sent. |
| `updated_at` | TEXT | NOT NULL | Last update timestamp. |

---

## 🧠 7. Weather Evaluation & Window Allocation Engine

The evaluation engine in `src/evaluator.ts` operates deterministically:

```
[Operational Hours: 09:00 - 18:00]
|-------------------------------------------------------------------|
09:00        10:00               14:00            16:00        18:00
[Setup 1h]   [Active Task Work]  [Teardown 1h]   [Passive Curing]
             (carpentry/glue)                    (No Rain Allowed!)
```

### Evaluation Algorithm Steps:
1. **Day Exclusion Checks**:
   - Check if date is a Saturday (`exclude_saturdays`) or Sunday (`exclude_sundays`).
   - Check if date is a statutory holiday (`exclude_holidays`).
   - Check if a `day_override` exists in SQLite for the target date.
2. **Hourly Weather Ingestion**:
   - For every hour in `[operational_start_hour, operational_end_hour]`:
     - Test temperature limits ($10^\circ\text{C} \le T \le 35^\circ\text{C}$).
     - Test maximum humidity ($H \le \text{max\_humidity\_percent}$).
     - Test rain precipitation ($P < \text{min\_rain\_precipitation\_mm}$).
3. **Window Extraction**:
   - Find contiguous hours meeting all weather criteria.
   - Deduct `setup_hours` at the start of the window and `teardown_hours` at the end.
   - If remaining net hours < `min_work_hours`, set `status = DAY_BLOCKED`.
4. **Task Fitting & Curing Verification**:
   - Select pending tasks ordered by `order_num`.
   - Fit tasks chronologically into the net work window.
   - For any task where `requires_curing == 1`:
     - Extend a post-work curing check for `curing_hours`.
     - Verify that rain probability remains $0$ during the curing window. If rain threatens during curing, flag or postpone the task.

---

## 🔒 8. Security, Auth & Token Engine

### Password Storage
- **Algorithm**: `PBKDF2` (Password-Based Key Derivation Function 2) using `SHA-512`.
- **Iterations**: `10,000`
- **Salt**: 16 random bytes generated via `crypto.randomBytes(16)`.
- **Stored Format**: `salt:hash` (hex strings).

### Session Security & Cookie Handling
- **Session Tokens**: Signed HMAC-SHA256 tokens encoding `user_id`, `email`, and `exp` timestamp.
- **Cookie Configuration**:
  - Name: `workshop_session`
  - Directives: `Path=/; HttpOnly; SameSite=None; Secure; Max-Age=2592000`
  - **Iframe & Preview Compatibility**: `SameSite=None; Secure` allows AGENDAPP to execute seamlessly within embedded cloud IDE sandboxes and mobile webviews without cross-site cookie rejection.

---

## ⚙️ 9. Environment Variables & Configuration (`.env`)

All configurable parameters are read from environment variables or `app_settings` in SQLite:

```env
# Server Network Port (Default: 3000)
PORT=3000

# SQLite Persistence Directory
DATA_DIR=data

# Google Calendar Integration Credentials
GOOGLE_APPLICATION_CREDENTIALS=google-credentials.json
GOOGLE_CALENDAR_ID=primary

# Telegram Bot Token & Target Chat ID
TELEGRAM_BOT_TOKEN=7890123456:AAFxXxXxXxXxXxXxXxXxXxXxXxXx
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_WEBHOOK_SECRET=my_secure_webhook_secret

# Application Timezone
TIMEZONE=America/Santiago
```

---

## 🚀 10. Installation, Local Dev, Production Build & Deployment

### 1. Installation & Compilation
```bash
# Install NPM dependencies
npm install

# Compile TypeScript into single CJS bundle (dist/server.cjs)
npm run build
```

### 2. Local Development
```bash
# Run server with live TS reload using tsx
npm run dev
```

### 3. Production Deployment with PM2
```bash
# Build production bundle
npm run build

# Launch server process using PM2
pm2 start dist/server.cjs --name "agendapp" --update-env
```

### 4. Containerized Docker Deployment
```bash
# Build Docker image
docker build -t agendapp:latest .

# Run Docker container with environment file
docker run -d -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data --name agendapp_app agendapp:latest
```

### 5. Manual Evaluation & API Endpoint Testing
AGENDAPP exposes endpoint triggers for manual verification, automated testing, or external webhooks:

```bash
# 1. Force Morning Evaluation Loop (Triggers Weather Check, DB Log, Calendar Event & Telegram Alert)
curl -X POST http://localhost:3000/evaluation/force_run

# 2. Force Evening Check-In Telegram Message (Sends Interactive Task Buttons)
curl -X POST http://localhost:3000/evaluation/force_checkin

# 3. Trigger Mock Scenario Evaluation (e.g. test rain scenario)
curl -X POST http://localhost:3000/evaluation/force_run -H "Content-Type: application/json" -d '{"scenario": "rain_afternoon"}'
```

---

## 🤖 AI & Developer Handover Guardrails

When extending AGENDAPP:
1. **Never Bypass `evaluator.ts` for Schedule Logic**: All scheduling operations must run through `evaluateDay()` to maintain weather, curing, and window safety guarantees.
2. **Preserve `SameSite=None; Secure` Cookie Flags**: Altering cookie settings breaks iframe preview sandboxes and embedded execution environments.
3. **Database Export Consistency**: When modifying `src/db.ts`, ensure `saveToDisk()` is invoked after write operations so `data/workshop.db` remains persistent across restarts.
4. **Calendar Fallback Handling**: `src/calendarService.ts` must never crash the application if `google-credentials.json` is missing or invalid; always log a warning and fallback gracefully to simulated execution.
"# workshop-APP" 
