# 🚀 AGENDAPP (Workshop OS) — Documentación Técnica y Arquitectura del Sistema

**AGENDAPP** (anteriormente *Workshop OS*) es un sistema operativo de ejecución operacional autónomo e inteligente respecto al clima, diseñado específicamente para talleres de carpintería al aire libre, estudios de ebanistería y procesos de manufactura sensibles a condiciones ambientales.

El sistema funciona como un **bucle de decisión continuo**: ingiere pronósticos meteorológicos en tiempo real, evalúa umbrales ambientales de secado/curado frente al backlog de tareas, agenda bloques de trabajo optimizados, sincroniza eventos espejo en **Google Calendar API v3** y entrega notificaciones operacionales oportunas e interactivas a través de un **Bot de Telegram**.

---

## 📌 1. Visión General y Arquitectura Multi-Tenant con Geolocalización

### El Desafío Operacional
La carpintería técnica y el trabajo en taller al aire libre sufren vulnerabilidades climáticas estrictas:
- **Colas PVA y Adhesivos**: Requieren temperaturas mínimas (usualmente > 10 °C) y ausencia de humedad directa durante la aplicación y el curado. Niveles de humedad relativa superiores al 80% degradan significativamente la resistencia mecánica del ensamblado.
- **Acabados, Barnices y Pinturas**: Los recubrimientos al agua o sintéticos requieren ventanas térmicas específicas y humedad controlada para evitar "velado", burbujas o fallas de secado.
- **Ensamblado e Insumos**: La lluvia o humedad crítica interrumpe el trabajo exterior con herramientas eléctricas y deteriora la madera expuesta.

### La Solución AGENDAPP
AGENDAPP automatiza completamente la planificación del taller mediante una arquitectura **Multi-Tenant aislada**:

1. **Aislamiento Multi-Tenant Completo**:
   - Cada usuario (`user_id`) posee un contexto completamente aislado en la base de datos: su propio backlog de tareas, proyectos, plantillas, logs diarios y configuración operacional (`app_settings`).
2. **Geolocalización y Cálculo Dinámico de Zona Horaria**:
   - El usuario configura la latitud y longitud exactas de su taller (mediante un mapa interactivo Leaflet/OpenStreetMap).
   - El backend utiliza `tz-lookup` para determinar automáticamente la zona horaria IANA correspondiente (ej. `America/Santiago`, `America/Buenos_Aires`).
   - La aplicación sincroniza y presenta la **hora local exacta del taller** (`local_time_info`), garantizando que la evaluación matutina, las notificaciones y los eventos de Google Calendar coincidan con el huso horario real del sitio de trabajo.

---

## 📅 2. Sincronización Espejo Multi-Día (Google Calendar API v3)

AGENDAPP implementa una arquitectura de **sincronización espejo flotante** proyectada en una ventana móvil de **7 días**:

```
[Evaluación Continua a 7 Días]
  ├── Día 1 (Viable)    ---> [Google Calendar: Bloque Creado / Actualizado]
  ├── Día 2 (Viable)    ---> [Google Calendar: Bloque Creado / Actualizado]
  ├── Día 3 (Bloqueado) ---> [Google Calendar: Bloque Eliminado / Limpiado]
  └── Día 4..7          ---> [Monitoreo Proyectado]
```

### Ciclo de Vida de los Eventos en Google Calendar
1. **Creación de Bloques Macro**: Para cada día evaluado como viable (`DAY_VIABLE`), el sistema genera o actualiza un evento macro en Google Calendar (ej. `🔨 Taller Carpintería (09:00 - 17:00)`), agregando el desglose detallado de tareas y tiempos de preparación en la descripción.
2. **Actualización Transparente**: Si el operario modifica horarios, parámetros de jornada o el backlog, el evento se actualiza automáticamente preservando su identificador.
3. **Limpieza por Inviabilidad Meteorológica**: Si una actualización meteorológica vuelve inviable un día previamente agendado (`DAY_BLOCKED` por lluvia o humedad excesiva), el sistema **elimina automáticamente** el evento de Google Calendar para evitar falsas confirmaciones.
4. **Resiliencia Técnica y Rescorte de Errores 404**:
   - Si un usuario elimina manualmente el evento en la interfaz gráfica de Google Calendar, la API devolverá un error `404 Not Found` en el siguiente ciclo de sincronización.
   - El servicio `src/calendarService.ts` captura este escenario de forma transparente, limpia la referencia obsoleta en la base de datos y recrea el evento si el día sigue siendo viable, manteniendo la integridad del estado.
   - Persistencia explícita de `google_event_id` en la tabla `daily_logs`.

---

## 📲 3. Sistema de Notificaciones Puntuales en Telegram

AGENDAPP rediseñó su motor de mensajería para eliminar el "spam" de reportes matutinos rutinarios y enfocar la comunicación en momentos operacionales críticos.

```
                    +---------------------------------------+
                    |       EVENTO DE INICIO DE TRABAJO     |
                    | (Inicio del primer bloque agendado)   |
                    +-------------------+-------------------+
                                        |
                                        v
                    +---------------------------------------+
                    |  sendWorkStartNotification()          |
                    |  - Detalle de preparación/setup       |
                    |  - Desglose de tareas activas         |
                    |  - Tiempos de curado proyectados      |
                    +-------------------+-------------------+
                                        |
                                        v
                    +---------------------------------------+
                    |     CHECK-IN NOCTURNO INTERACTIVO     |
                    |  (checkin_hour ej. 19:00 hrs)         |
                    |  [ Completada ✅ ]  [ Reagendar 🔁 ]  |
                    +---------------------------------------+
```

1. **Eliminación de Spam Matutino**: Ya no se envían mensajes genéricos al despertar. Las alertas se disparan con precisión cuando hay una acción requerida.
2. **Notificación al Inicio Exacto del Trabajo (`sendWorkStartNotification`)**:
   - Se dispara automáticamente en el minuto exacto en que comienza la primera tarea agendada del día.
   - Informa al operario sobre la preparación requerida (tiempo de setup/limpieza), la secuencia de tareas activas y los tiempos de curado/secado necesarios.
3. **Check-in Nocturno Interactivo**:
   - Se envía a la hora configurada (`checkin_hour`, ej. 19:00 hrs) mediante teclados inline de Telegram.
   - Permite al operario marcar cada tarea como `Completada ✅` o `Reagendar 🔁` con un solo toque, actualizando el estado en la base de datos SQLite sin abrir el navegador.

---

## 📋 4. Backlog de Tareas y Autocompletado Inteligente

### Eliminación del Módulo de "Favoritas"
- Se eliminó completamente la sección visual de tarjetas y botones de estrella ("Tareas Favoritas") para simplificar la interfaz y evitar la duplicidad de datos.
- Se removieron los controladores y endpoints obsoletos (`/tasks/:id/favorite`, `/favorites/*`), concentrando el flujo de trabajo en la entrada principal del backlog.

### Motor de Autocompletado Dinámico de Tareas
Para acelerar el registro de tareas frecuentes (ej. *Lijado de cubiertas*, *Encolado de bastidores*, *Barnizado final*), el campo "TÍTULO DE LA TAREA" incorpora autocompletado dinámico basado en el historial del usuario:

```
[ Input: "Lija..." ]
       │
       ├── Backend: Query `store.getTaskHistory(userId)`
       │   SELECT title, category, estimated_hours, curing_hours ...
       │
       └── Frontend: Lista `<datalist>` + Desplegable Filtrado
           ├── "Lijado de cubiertas"  (Carpintería • 2.0h)
           └── "Lijado de cantos"      (Carpintería • 1.0h)
```

- **Sugerencias Instantáneas**: Al escribir en el campo de título, el sistema despliega coincidencias del historial de tareas previamente creadas por el usuario.
- **Relleno Automático de Parámetros**: Al seleccionar una sugerencia (vía clic, navegación por teclado con flechas/Enter, o datalist nativo HTML5), se completan automáticamente:
  - **Título de la tarea**
  - **Categoría** (Carpintería, Encolado PVA, Barnizado/Pintura, Epoxi)
  - **Horas estimadas de trabajo activo**
  - **Horas de curado/secado requeridas**

---

## 🔍 5. Motor de Evaluación Meteorológica y Curado Pasivo Nocturno (`src/evaluator.ts`)

El núcleo de inteligencia operacional de AGENDAPP reside en `src/evaluator.ts`. A diferencia de un gestor de proyectos convencional, el sistema no solo evalúa si hay horas de sol durante la jornada laboral del taller (`operational_start_hour` a `operational_end_hour`), sino que simula la exposición de los materiales a lo largo de todo su proceso físico de secado.

```
Jornada Operativa (09:00 - 18:00)             Extensión de Curado Pasivo Nocturno (hasta 23:00+)
┌───────────────────────────────────────────┬─────────────────────────────────────────────┐
│ 09:00 Setup │ 10:00 - 15:00 Trabajo Activo │ 15:00 - 21:00 Curado PVA / Epoxi (Pasivo)   │
└─────────────┴─────────────────────────────┴─────────────────────────────────────────────┘
                                             ▲ Si a las 20:00 Lllueve o Humedad > 80% ────┤
                                               --> DÍA RECHAZADO / DAY_BLOCKED PREVENTIVO
```

### 1. Proyección de Curado Pasivo Extramuros (`operational_end_hour`)
- **Tiempos Activos vs. Pasivos**: Las tareas como *Encolado PVA* (2h curado), *Barnizado/Pintura* (2h a 4h curado) y *Epoxi* (6h+ curado) requieren que la pieza permanezca inmóvil y protegida en el taller.
- **Ventana de Evaluación Extendida**: Aunque la presencia activa del operario finalice a las 18:00 hrs (`operational_end_hour`), si una tarea de encolado o epoxi se ejecuta en la tarde (ej. a las 15:00 hrs), el curado pasivo se extiende hasta las 21:00 hrs o la medianoche.
- **Cálculo de `bufferEndHour`**: El motor evalúa las condiciones climáticas de cada hora `h` desde `startHour` hasta `bufferEndHour = Math.min(23, Math.floor(maxCuringEnd))`.

### 2. Reglas Ambientales Estrictas por Categoría y Curado Nocturno
Durante todo el período de trabajo activo **y** la ventana de curado pasivo nocturno, el evaluador aplica las siguientes verificaciones horario por horario:
- **Precipitación y Lluvia**: Si la probabilidad de lluvia es `>= 30%` o la precipitación es `>= min_rain_precipitation_mm` (ej. 0.2mm), la ventana queda invalidada.
- **Humedad Relativa Máxima (`max_humidity_percent`)**: Si en cualquier hora del curado (incluso pasadas las 19:00 o 22:00 hrs) la humedad relativa supera el umbral (ej. 80%), se detecta un conflicto ambiental.
- **Regla Especial para Epoxi**: Exige temperatura mínima de **15.0 °C** y humedad relativa máxima de **75.0%** en todo el bloque de trabajo y sus 6 horas de curado.

### 3. `DAY_BLOCKED` Preventivo y Justificación Explícita (`unassigned_reason`)
Si una tarde o noche proyecta humedad nocturna o lluvia que arruinaría una tarea realizada en la tarde, el motor rechaza preventivamente esa ventana y marca la jornada como `DAY_BLOCKED` registrando el motivo exacto:
- `Exceso de humedad detectado a las 21:00 hrs (86%, Máx permitido: 80%).`
- `Riesgo de lluvia detectado a las 22:00 hrs (Probabilidad: 65%, Precipitación: 1.2mm).`
- `Temperatura ambiente baja para Epoxi a las 20:00 hrs (12°C, Mínimo requerido: 15°C).`
- `Ventana de tiempo continuo disponible (2.0h) es menor al mínimo requerido (4.0h).`
- `Sin agendamiento: No hay tareas pendientes compatibles en el backlog.`

---

## 📡 6. Especificación de Endpoints REST (API Reference)

A continuación se detallan los endpoints HTTP que expone `server.ts` para la administración del taller:

### 🔐 Autenticación y Sesión

#### `POST /login`
Inicia sesión en la plataforma y establece la cookie firmada `workshop_token`.
- **Request Body**:
  ```json
  {
    "email": "maestro@taller.cl",
    "password": "secretoSeguro123"
  }
  ```
- **Response 303 Redirect**: Redirige a `/` en éxito.
- **Response 401 Unauthorized**:
  ```json
  {
    "status": "error",
    "message": "Credenciales inválidas"
  }
  ```

#### `POST /register`
Crea una nueva cuenta de usuario e inicializa sus parámetros operacionales por defecto (`app_settings`).
- **Request Body**:
  ```json
  {
    "email": "nuevo@taller.cl",
    "password": "secretoSeguro123"
  }
  ```
- **Response 303 Redirect**: Redirige a `/`.

#### `GET /logout`
Destruye la sesión actual, elimina la cookie y redirige a `/login`.

#### `GET /api/auth/status`
Verifica si la sesión actual es válida.
- **Response 200 OK**:
  ```json
  {
    "authenticated": true,
    "user": {
      "id": 1,
      "email": "maestro@taller.cl"
    }
  }
  ```

---

### 📋 Gestión de Tareas y Backlog

#### `GET /tasks/history` (o `/tasks/suggestions`)
Obtiene la lista de títulos y parámetros históricos únicos del usuario para el autocompletado inteligente.
- **Response 200 OK**:
  ```json
  [
    {
      "title": "Lijado de cubiertas",
      "category": "carpentry",
      "estimated_hours": 2.0,
      "curing_hours": 0.0
    },
    {
      "title": "Encolado de bastidores",
      "category": "pva_glue",
      "estimated_hours": 1.5,
      "curing_hours": 2.0
    }
  ]
  ```

#### `POST /tasks/add`
Agrega una nueva tarea al backlog del usuario.
- **Request Body (Form Data / JSON)**:
  ```json
  {
    "title": "Barnizado final de mesa",
    "category": "varnish_paint",
    "estimated_hours": 2.5,
    "curing_hours": 4.0
  }
  ```
- **Response 303 Redirect**: Redirige a `/`.

#### `POST /tasks/:id/update`
Actualiza el título, categoría y tiempos de una tarea existente.
- **Request Body**:
  ```json
  {
    "title": "Lijado y pulido fino",
    "category": "carpentry",
    "estimated_hours": 1.5,
    "curing_hours": 0.0
  }
  ```

#### `POST /tasks/:id/delete`
Elimina una tarea del backlog.
- **Response 303 Redirect**: Redirige a `/`.

#### `POST /tasks/reorder`
Reordena la secuencia de tareas en el backlog mediante Drag & Drop.
- **Request Body**:
  ```json
  {
    "task_ids": [12, 8, 15, 3]
  }
  ```
- **Response 200 OK**:
  ```json
  {
    "status": "ok"
  }
  ```

#### `POST /tasks/import`
Importa masivamente tareas en formato JSON generadas por IA y las asocia al proyecto indicado (`project_id` o `project_name`).
- **Request Body**:
  ```json
  {
    "project_name": "Mueble de Cocina",
    "tasks": [
      {
        "title": "Corte de terciado",
        "category": "carpentry",
        "estimated_hours": 3.0,
        "curing_hours": 0.0
      }
    ]
  }
  ```
- **Response 200 OK**:
  ```json
  {
    "status": "success",
    "message": "Se importaron 1 tareas con éxito."
  }
  ```

---

### 📁 Gestión de Proyectos y Materiales

#### `POST /projects/active`
Cambia el proyecto activo del usuario para filtrar tareas y materiales.
- **Request Body**: `{ "project_id": 2 }`
- **Response 200 OK / 303 Redirect**

#### `POST /projects/add`
Crea un nuevo proyecto en la base de datos para el usuario activo.
- **Request Body**: `{ "name": "Estructura Pérgola", "description": "Pérgola de Roble" }`

#### `GET /api/materials`
Obtiene la lista de materiales e insumos asociados al usuario y/o proyecto.

#### `POST /materials/add`
Registra un nuevo material asociado a un `project_id` explícito.
- **Request Body**:
  ```json
  {
    "project_id": 1,
    "name": "Tornillos T2 2 pulgadas",
    "quantity": 100,
    "unit": "unidades",
    "category": "Tornillería",
    "status": "to_buy"
  }
  ```

#### `POST /materials/:id/toggle`
Conmuta el estado de un material entre `Por Comprar` (`to_buy`) y `En Taller` (`in_stock`).

#### `POST /materials/:id/update`
Actualiza un material existente en la base de datos.

#### `POST /materials/:id/delete`
Elimina un material de la base de datos.

---

### 📆 Evaluación y Agenda

#### `POST /evaluation/run` (o `/evaluation/force_run`)
Fuerza la ejecución inmediata del motor de evaluación climática a 7 días.
- **Response 200 OK**:
  ```json
  {
    "status": "success",
    "message": "Evaluación completada para 7 días.",
    "evaluated_days": 7
  }
  ```

#### `POST /calendar/create`
Genera o fuerza la sincronización espejo a Google Calendar para una fecha dada.
- **Request Body**:
  ```json
  {
    "dateIso": "2026-08-03",
    "start_time": "09:00",
    "taskIds": [10, 11]
  }
  ```
- **Response 200 OK**:
  ```json
  {
    "status": "success",
    "message": "Evento de Google Calendar creado con éxito.",
    "eventId": "cal_evt_987654321"
  }
  ```

---

### ⚙️ Configuración Operacional

#### `POST /settings/update`
Actualiza la ubicación del taller, horas operativas y credenciales de Telegram.
- **Request Body**:
  ```json
  {
    "latitude": -32.99,
    "longitude": -71.27,
    "operational_start_hour": 9,
    "operational_end_hour": 18,
    "max_humidity_percent": 80.0,
    "telegram_chat_id": "123456789"
  }
  ```
- **Response 303 Redirect**: Redirige a `/`.

---

## 🛡️ 7. Resiliencia, Caché y Tolerancia a Fallos

AGENDAPP implementa una capa de resiliencia distribuida para garantizar la disponibilidad continua del taller frente a fallos de servicios externos:

```
+-----------------------------------------------------------------------------------+
|                            CAPA DE RESILIENCIA Y CACHÉ                            |
+-------------------+-------------------------------+-------------------------------+
|  OPEN-METEO API   |       TELEGRAM BOT API        |   GOOGLE CALENDAR API v3      |
+-------------------+-------------------------------+-------------------------------+
| • Timeout de 8s   | • Ejecución asíncrona         | • Manejo de cuotas (429)      |
| • Snapshot SQLite | • Silenciamiento de errores   | • Reintento en 5xx            |
| • Fallback local  |   400/403 sin frenar daemon   | • Recreación limpia en 404    |
+-------------------+-------------------------------+-------------------------------+
```

### 1. Ingesta Meteorológica (Open-Meteo API)
- **Timeout y Reintentos**: Las solicitudes HTTP de pronóstico se ejecutan con timeout estricto de 8 segundos y reintentos automáticos.
- **Persistencia de Snapshot**: Cada pronóstico obtenido con éxito se guarda en la columna `morning_climate_snapshot` de `daily_logs` en formato JSON.
- **Fallback Transparente**: Si la API de Open-Meteo se encuentra fuera de servicio o inalcanzable, el evaluador utiliza el último snapshot almacenado en SQLite para continuar agendando el día sin interrumpir al operario.

### 2. Mensajería Distribuida (Telegram Bot API)
- **Ejecución Asíncrona Non-Blocking**: Los ticks de notificación (`runWorkStartTick`, `runCheckinTick`) se ejecutan dentro de bloques `try/catch` aislados en el daemon (`scheduler.ts`).
- **Aislamiento de Errores**: Si un usuario tiene un `telegram_chat_id` inválido, o bloqueó el bot (`403 Forbidden`), la falla es capturada y registrada en los logs del servidor sin detener los procesos de otros usuarios ni bloquear el hilo principal de Node.js.

### 3. Sincronización de Calendario (Google Calendar API v3)
- **Manejo de Errores 404 (Eventos Eliminados)**: Si un evento espejo es eliminado manualmente en la app de Google Calendar, el servicio detecta la respuesta `404 Not Found`, limpia la columna `google_event_id` en SQLite y vuelve a crear el evento si la jornada sigue siendo viable.
- **Tolerancia a Errores 5xx**: Errores temporales de red o indisponibilidad de la API de Google son manejados con reintentos exponenciales en el siguiente tick del daemon (cada 15 minutos).

---

## 🛠️ 8. Tech Stack & Matriz Técnica

### Tech Stack Principal
| Capa | Tecnología | Descripción |
| :--- | :--- | :--- |
| **Entorno de Ejecución** | Node.js (v18+) & Express | Servidor HTTP, middleware de sesiones REST API. |
| **Lenguaje** | TypeScript | Tipado estricto para modelos de dominio y motores de evaluación. |
| **Compilador / Empaquetador**| `esbuild` | Compilación ultra-rápida a CommonJS (`dist/server.cjs`). |
| **Base de Datos** | SQLite vía `better-sqlite3` | Motor relacional en disco con modo WAL (`journal_mode = WAL`). |
| **Zona Horaria** | `tz-lookup` | Identificación dinámica de huso horario IANA según lat/lon. |
| **Calendario** | `googleapis` (API v3) | Sincronización espejo con Google Calendar API. |
| **Mensajería** | Telegram Bot API | Notificaciones operacionales e interacciones inline. |
| **Motor Meteorológico** | Open-Meteo API | Pronósticos horarias de temperatura, humedad y precipitaciones. |
| **Renderizado Frontend** | EJS (Embedded JavaScript) | Vistas SSR modulares y reactivas. |
| **Diseño y Estilos** | Tailwind CSS | Interfaz oscura de alta precisión para ambientes de taller. |

---

## 📂 9. Árbol de Archivos del Proyecto

```
AGENDAPP/
├── .env.example                  # Plantilla de variables de entorno
├── .gitignore                    # Reglas de exclusión de Git
├── Dockerfile                    # Receta de construcción de contenedor Docker
├── README.md                     # Documentación técnica y arquitectura (Single Source of Truth)
├── metadata.json                 # Metadatos del applet e intenciones de la plataforma
├── package.json                  # Dependencias NPM, scripts de compilación y ejecución
├── tsconfig.json                 # Configuración del compilador TypeScript
├── server.ts                     # Punto de entrada de Express y definición de rutas REST
├── data/                         # Directorio de persistencia de SQLite
│   └── workshop.db               # Archivo de base de datos SQLite (generado en runtime)
├── src/                          # Código fuente backend en TypeScript
│   ├── auth.ts                   # Autenticación, hashing PBKDF2 y firma HMAC de sesiones
│   ├── calendarService.ts        # Servicio de integración con Google Calendar API v3
│   ├── dateUtils.ts              # Formateo de fechas y localización en español
│   ├── db.ts                     # Gestor SQLite, migraciones de esquema y capa DAO (`store`)
│   ├── evaluator.ts              # Motor de evaluación meteorológica y calce de tiempos de curado
│   ├── holidaysService.ts        # Detección de feriados e irrenunciables
│   ├── scheduler.ts              # Daemon en segundo plano, tickers y tiempo local
│   ├── telegramBot.ts            # Bot de Telegram, webhooks y callbacks de teclado inline
│   ├── types.ts                  # Interfaces TypeScript, modelos y enums
│   └── weatherService.ts         # Cliente meteorológico para Open-Meteo API
├── static/                       # Archivos estáticos del frontend
│   ├── manifest.json             # Manifiesto Web App (PWA)
│   ├── sw.js                     # Service Worker para almacenamiento en caché
│   ├── css/
│   │   └── main.css              # Reglas CSS de Tailwind e interfaz
│   ├── icons/                    # Iconos y recursos gráficos
│   └── js/
│       ├── agenda.js             # Lógica del cliente para la línea de tiempo
│       ├── backlog.js            # Lógica del backlog, drag & drop y autocompletado
│       ├── map.js                # Selector interactivo de coordenadas del taller (Leaflet)
│       └── settings.js           # Gestor del modal de configuración y pruebas de Telegram
└── views/                        # Plantillas de renderizado EJS
    ├── index.ejs                 # Vista principal del Dashboard de AGENDAPP
    ├── login.ejs                 # Vista de inicio de sesión
    ├── register.ejs              # Vista de registro de usuario
    └── components/               # Componentes EJS modulares
        ├── agenda.ejs            # Componente de línea de tiempo y resumen diario
        ├── backlog.ejs           # Componente de backlog de tareas y plantillas
        └── settings_modal.ejs    # Modal de configuración de parámetros operacionales
```

---

## 📑 10. Matriz Técnica Detallada Archivo por Archivo

| Archivo | Responsabilidad Principal | Exportaciones / Métodos Clave | Dependencias |
| :--- | :--- | :--- | :--- |
| `server.ts` | Servidor HTTP Express, rutas REST (`/api/*`, `/tasks/*`, `/evaluation/*`), autenticación. | Inicialización de Express, endpoints de autenticación y lógica del dashboard. | `express`, `src/db.ts`, `src/auth.ts`, `src/scheduler.ts`, `src/telegramBot.ts` |
| `src/auth.ts` | Seguridad de contraseñas y tokens HMAC de sesión. | `hashPassword`, `verifyPassword`, `signToken`, `verifyToken`, `requireAuth` | Node `crypto`, `express`, `src/db.ts` |
| `src/calendarService.ts` | Integración con Google Calendar API v3. | `GoogleCalendarService`, `createWorkshopEvent` | `googleapis`, Node `fs`, `src/db.ts` |
| `src/dateUtils.ts` | Formateo de fechas y textos en español. | `formatDateShortEs`, `formatDateLongEs` | JavaScript Standard Date API |
| `src/db.ts` | Capa DAO de SQLite, migraciones y persistencia en disco. | `initDatabase`, `store` (CRUD de tareas, proyectos, configuraciones, logs) | `better-sqlite3`, Node `fs`, `src/types.ts` |
| `src/evaluator.ts` | Motor de evaluación climática y calce de tiempos de curado. | `evaluator.evaluateDay` | `src/types.ts`, `src/holidaysService.ts` |
| `src/holidaysService.ts` | Identificación de feriados legales. | `getHolidayDatesForRange`, `isHoliday` | `src/types.ts` |
| `src/scheduler.ts` | Daemon en segundo plano para tickers meteorológicos y notificaciones. | `startDaemon`, `runMorningEvaluation`, `runCheckinTick`, `processWorkStartNotificationsForUser` | `src/db.ts`, `src/evaluator.ts`, `src/weatherService.ts`, `src/telegramBot.ts` |
| `src/telegramBot.ts` | Bot de Telegram, recepción de webhooks y botones inline. | `TelegramBotService`, handlers de callback | `src/db.ts`, HTTP fetch API |
| `src/types.ts` | Interfaces de dominio y tipos de datos en TypeScript. | `Task`, `Project`, `AppSettings`, `DailyLog`, `TaskStatus`, `TaskCategory` | TypeScript Pure Types |
| `src/weatherService.ts` | Ingesta de pronósticos meteorológicos de Open-Meteo. | `getHourlyForecast`, `computeHourlyClimateMap` | HTTP fetch API, `src/types.ts` |
| `views/index.ejs` | Vista principal SSR que integra Agenda, Backlog y Configuración. | Estructura HTML del Dashboard | EJS Engine, Tailwind CSS |
| `views/components/backlog.ejs` | Componente de backlog con formulario de creación y autocompletado. | Parcial EJS del Backlog | EJS Engine |
| `static/js/backlog.js` | Lógica de cliente para drag & drop y autocompletado inteligente. | `initTaskAutocomplete`, `initSortable` | Browser DOM API |

---

## 🔄 11. Diagrama de Flujo de Datos End-to-End

```
+-----------------------------------------------------------------------------------+
|                                DAEMON SCHEDULER                                   |
|                             (src/scheduler.ts)                                    |
+----------------------------------------+------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 1. INGESTA CLIMÁTICA POR USUARIO       | 2. EVALUACIÓN Y CALCE                    |
| Open-Meteo API (Lat/Lon del taller)   | Motor Climático (src/evaluator.ts)       |
| -> Temp, Humedad, Precipitación        | -> Filtro de jornadas y tiempos curado   |
+----------------------------------------+------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 3. PERSISTENCIA EN SQLITE                                                         |
| Tabla `daily_logs` (Estado DAY_VIABLE o DAY_BLOCKED con block_reason)             |
+-------------------+---------------------------------------+-----------------------+
                    |                                       |
                    v                                       v
+---------------------------------------+   +---------------------------------------+
| 4. SINCRONIZACIÓN ESPEJO GOOGLE CAL.  |   | 5. NOTIFICACIÓN DE INICIO DE TRABAJO  |
| (src/calendarService.ts)              |   | (Telegram Bot al min exacto de inicio)|
| Crea/Actualiza/Elimina evento macro:  |   | Informa tiempo de setup, tareas       |
| "🔨 Taller Carpintería (09:00-17:00)" |   | activas y ventanas de curado.          |
+---------------------------------------+   +---------------------------------------+
                                                            |
                                                            v
+-----------------------------------------------------------------------------------+
| 6. CHECK-IN NOCTURNO INTERACTIVO (checkin_hour ej. 19:00 hrs)                     |
| Bot envía teclado inline: [ Completada ✅ ]  [ Reagendar 🔁 ]                      |
+----------------------------------------+------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 7. PROCESAMIENTO DE CALLBACK (src/telegramBot.ts)                                 |
| Operario presiona botón -> Actualización instantánea del estado de tareas en DB.  |
+-----------------------------------------------------------------------------------+
```

---

## 🗄️ 12. Esquema de Base de Datos SQLite (`data/workshop.db`)

### Tabla `users`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID único del usuario. |
| `email` | TEXT | UNIQUE NOT NULL | Correo electrónico de acceso. |
| `password_hash` | TEXT | NOT NULL | Hash PBKDF2 (`salt:hash`). |
| `must_change_password` | INTEGER | NOT NULL DEFAULT 0 | Flag de cambio obligatorio de clave. |
| `created_at` | TEXT | NOT NULL | Fecha de creación del usuario. |

### Tabla `app_settings`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID de la configuración. |
| `user_id` | INTEGER | UNIQUE NOT NULL | FK hacia `users.id`. |
| `operational_start_hour` | INTEGER | NOT NULL DEFAULT 9 | Hora de inicio de la jornada (0-23). |
| `operational_end_hour` | INTEGER | NOT NULL DEFAULT 18 | Hora de término de la jornada (0-23). |
| `max_humidity_percent` | REAL | NOT NULL DEFAULT 80.0 | Límite máximo de humedad para trabajar (%). |
| `latitude` | REAL | NOT NULL DEFAULT -32.99 | Latitud geográfica del taller. |
| `longitude` | REAL | NOT NULL DEFAULT -71.27 | Longitud geográfica del taller. |
| `timezone` | TEXT | NULL | Zona horaria IANA calculada (ej. `America/Santiago`). |
| `setup_hours` | REAL | NOT NULL DEFAULT 1.0 | Tiempo de preparación pre-jornada (horas). |
| `teardown_hours` | REAL | NOT NULL DEFAULT 1.0 | Tiempo de limpieza post-jornada (horas). |
| `min_work_hours` | REAL | NOT NULL DEFAULT 1.0 | Duración mínima para validar un día como viable. |
| `checkin_hour` | INTEGER | NOT NULL DEFAULT 19 | Hora para la notificación nocturna de Telegram. |
| `telegram_chat_id` | TEXT | NULL | Chat ID de Telegram del usuario. |
| `google_calendar_id` | TEXT | NULL | ID del calendario de Google Calendar. |
| `google_calendar_enabled`| INTEGER | NOT NULL DEFAULT 0 | Interruptor de activación de Google Calendar. |

### Tabla `projects`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID único del proyecto. |
| `user_id` | INTEGER | NOT NULL | FK hacia `users.id`. |
| `name` | TEXT | NOT NULL | Nombre del proyecto. |
| `description` | TEXT | NULL | Descripción detallada. |
| `is_active` | INTEGER | NOT NULL DEFAULT 0 | Flag de proyecto activo. |

### Tabla `tasks`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID de la tarea. |
| `user_id` | INTEGER | NOT NULL | FK hacia `users.id`. |
| `project_id` | INTEGER | NOT NULL | FK hacia `projects.id`. |
| `title` | TEXT | NOT NULL | Título de la tarea. |
| `category` | TEXT | NOT NULL | Categoría (`carpentry`, `pva_glue`, `varnish_paint`, `epoxy`). |
| `estimated_hours` | REAL | NOT NULL DEFAULT 1.0 | Horas de trabajo activo. |
| `curing_hours` | REAL | NOT NULL DEFAULT 0.0 | Horas de curado o secado pasivo. |
| `requires_curing` | INTEGER | NOT NULL DEFAULT 0 | Indica si requiere protección ambiental de secado. |
| `status` | TEXT | NOT NULL DEFAULT 'pending' | Estado (`pending`, `scheduled`, `in_progress`, `completed`). |
| `order_num` | INTEGER | NOT NULL DEFAULT 1 | Orden secuencial en el backlog. |

### Tabla `daily_logs`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID del registro diario. |
| `user_id` | INTEGER | NOT NULL | FK hacia `users.id`. |
| `eval_date` | TEXT | NOT NULL | Fecha evaluada (`YYYY-MM-DD`). |
| `status` | TEXT | NOT NULL | Resultado (`DAY_VIABLE` o `DAY_BLOCKED`). |
| `block_reason` | TEXT | NULL | Explicación detallada si el día fue bloqueado. |
| `window_start` | TEXT | NULL | Hora inicio de ventana de trabajo (`HH:MM`). |
| `window_end` | TEXT | NULL | Hora término de ventana de trabajo (`HH:MM`). |
| `net_work_hours` | REAL | NULL | Horas netas de trabajo disponibles. |
| `scheduled_task_ids` | TEXT | NULL | JSON con IDs de tareas agendadas. |
| `google_event_id` | TEXT | NULL | Identificador del evento en Google Calendar. |
| `calendar_created` | INTEGER | NOT NULL DEFAULT 0 | Flag de confirmación de evento en Google Calendar. |
| `checkin_sent` | INTEGER | NOT NULL DEFAULT 0 | Flag de notificación nocturna enviada. |

### Tabla `materials`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID del material. |
| `user_id` | INTEGER | NOT NULL | FK hacia `users.id`. |
| `project_id` | INTEGER | NOT NULL | FK hacia `projects.id` (Relación explícita con Proyecto). |
| `name` | TEXT | NOT NULL | Nombre del material/insumo. |
| `quantity` | REAL | NOT NULL DEFAULT 1.0 | Cantidad requerida. |
| `unit` | TEXT | NOT NULL DEFAULT 'unidades' | Unidad de medida (`piezas`, `mm`, `m2`, `kg`, etc.). |
| `category` | TEXT | NOT NULL DEFAULT 'General' | Categoría del material. |
| `status` | TEXT | NOT NULL DEFAULT 'to_buy' | Estado (`to_buy` o `in_stock`). |
| `created_at` | TEXT | NOT NULL | Fecha de creación ISO. |
| `updated_at` | TEXT | NOT NULL | Fecha de última actualización ISO. |

### Tabla `calculator_offsets`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID del offset. |
| `user_id` | INTEGER | NOT NULL | FK hacia `users.id`. |
| `label` | TEXT | NOT NULL | Etiqueta o nombre del descuento/holgura. |
| `offset_value` | REAL | NOT NULL | Valor numérico del offset (+ / -). |
| `unit` | TEXT | NOT NULL DEFAULT 'mm' | Unidad de medida. |
| `description` | TEXT | NULL | Descripción detallada. |
| `order_num` | INTEGER | NOT NULL DEFAULT 1 | Orden visual. |

---

## 🚀 13. Guía de Instalación, Desarrollo y Despliegue

### 1. Instalación de Dependencias y Compilación
```bash
# Instalar dependencias del proyecto
npm install

# Compilar TypeScript a producción (dist/server.cjs) usando esbuild
npm run build
```

### 2. Entorno de Desarrollo Local
```bash
# Iniciar servidor con recarga en vivo mediante tsx
npm run dev
```

### 3. Despliegue en Producción con PM2
```bash
# Compilar el empaquetado de producción
npm run build

# Iniciar proceso con PM2
pm2 start dist/server.cjs --name "agendapp" --update-env
```

### 4. Despliegue Contenerizado con Docker
```bash
# Construir imagen Docker
docker build -t agendapp:latest .

# Ejecutar contenedor con volumen de persistencia
docker run -d -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data --name agendapp_container agendapp:latest
```

### 5. Respaldos en Caliente de SQLite (Modo WAL)
AGENDAPP opera SQLite configurado en modo **Write-Ahead Logging (WAL)** (`journal_mode = WAL`), garantizando un rendimiento óptimo de lectura/escritura concurrente.

Para realizar respaldos seguros sin detener el servidor en ejecución, utiliza la API de respaldo en caliente o comandos nativos `VACUUM INTO`:

```bash
# Método A: Copia de seguridad nativa SQLite usando VACUUM INTO en Docker
docker exec -it agendapp_container sqlite3 /app/data/workshop.db "VACUUM INTO '/app/data/backup-$(date +%Y%m%d%H%M%S).db';"

# Método B: Copia de seguridad local directa mediante CLI de sqlite3
sqlite3 data/workshop.db "VACUUM INTO 'data/backup-live.db';"
```

---

## 🛡️ 14. Guardagujas de Desarrollo e Integración

1. **Evaluación Centralizada en `evaluator.ts`**: Toda modificación de horarios o viabilidad de tareas debe pasar por el motor de evaluación para asegurar los umbrales climáticos y de curado.
2. **Cookies `SameSite=None; Secure`**: Mantener las banderas de cookies para soportar la ejecución en entornos incrustados (iframes) e interfaces móviles.
3. **Persistencia Directa**: Toda escritura en SQLite debe reflejarse en `data/workshop.db` para asegurar la durabilidad tras reinicios del contenedor.
