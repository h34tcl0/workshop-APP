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

1. **Entorno de Ejecución Moderno**:
   - Ejecución sobre **Node.js 22 (Web Runtime)** utilizando **Express 4** para la API REST, renderizado de plantillas modulares **EJS** y empaquetado optimizado con **`esbuild`** (`dist/server.cjs`) escuchando en el **puerto 3000**.
2. **Aislamiento Multi-Tenant Completo**:
   - Cada usuario (`user_id`) posee un contexto completamente aislado en la base de datos: su propio backlog de tareas, proyectos, plantillas, materiales/insumos, logs diarios y configuración operacional (`app_settings`).
3. **Geolocalización y Cálculo Dinámico de Zona Horaria**:
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

## 📲 3. Sistema de Notificaciones y Módulo de Telegram (`src/telegramBot.ts`)

AGENDAPP cuenta con un motor de mensajería altamente interactivo y resiliente diseñado para la gestión en tiempo real de operaciones de taller.

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

### Principales Capacidades del Módulo de Telegram:
1. **Long Polling Robusto y Prevención de Conflictos 404/409**:
   - Sistema de reconexión adaptativa en `src/telegramBot.ts` con respaldo exponencial.
   - Limpieza automática de webhooks previos (`deleteWebhook?drop_pending_updates=true`) ante detecciones de conflicto HTTP 409, garantizando un flujo constante de polling en contenedores o reinicios.
2. **Atención Inmediata de Comandos `/start` y `/help`**:
   - Los comandos `/start` y `/help` responden inmediatamente a cualquier usuario, entregando su `Telegram Chat ID` e instrucciones de vinculación incluso si la cuenta aún no ha sido registrada o enlazada en la plataforma.
3. **Consulta de Materiales e Insumos con `/materiales`**:
   - El comando `/materiales` permite consultar desde Telegram los materiales e insumos pendientes por comprar (`to_buy`) o en stock (`in_stock`) agrupados por proyecto activo.
4. **Alertas de Emergencia e Intradía con Silenciador Interactivo**:
   - Notificaciones inmediatas ante cambios climáticos intempestivos o riesgos de lluvia no previstos durante la jornada.
   - Incluyen un botón inline interactivo de **Silenciador / Snooze** para pausar avisos secundarios sin interrumpir la labor en el taller.
5. **Cierre de Jornada Nocturno (Check-in Interactivo)**:
   - Se envía a la hora configurada (`checkin_hour`, ej. 19:00 hrs) con teclados inline de Telegram.
   - Permite al operario marcar cada tarea agendada como `Completada ✅` o `Reagendar 🔁` con un solo toque.
   - El backend procesa las respuestas callback en tiempo real (`handleCallbackQuery`), actualizando de inmediato la base de datos y reordenando el backlog sin necesidad de abrir la aplicación web.
6. **Notificación al Inicio Exacto del Trabajo (`sendWorkStartNotification`)**:
   - Disparo automático en el minuto exacto del primer bloque agendado, detallando tiempos de setup, tareas activas y requisitos de curado.

---

## 📋 4. Backlog de Tareas y Autocompletado Inteligente

### Eliminación de Módulos Innecesarios
- Simplificación visual y arquitectónica: se eliminó la sección redundante de "Favoritas" y los endpoints obsoletos, concentrando la operativa en el backlog unificado.

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
                                             ▲ Si a las 20:00 Llueve o Humedad > 80% ────┤
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

## 📁 6. Gestión de Proyectos, Agendamiento Multi-Proyecto y Mezcla Oportunista de Tareas

### 1. Reconstrucción de la Sección de Proyectos (Sidebar Izquierdo)
- **Vistas Acordeón Colapsables**: Cada proyecto registrado en la base de datos se presenta como una tarjeta colapsable tipo acordeón.
- **Desglose Interno de Tareas**: Al hacer clic en la tarjeta de un proyecto, se despliegan sus tareas internas pertenecientes a ese `project_id`.
- **Edición Directa e Inline**: Permite modificar título, categoría, horas activas, horas de curado y reasignar de proyecto cualquier tarea guardada directamente en la tarjeta sin salir de la vista.
- **Conmutador de Activación (`is_active`)**: Cada proyecto y cada tarea incorporan un interruptor de activación (`Activo para Agendar`) para pausar o incluir dinámicamente sus elementos en el pool global de agendamiento.

### 2. Motor de Agendamiento Multi-Proyecto y Mezcla Oportunista (`src/evaluator.ts` / `src/scheduler.ts`)
- **Pool Global de Proyectos Activos**: El agendador no se limita al proyecto activo primario, sino que recopila tareas pendientes de **todos los proyectos marcados con `is_active = 1`**.
- **Evaluación de Mezcla Oportunista por Clima**:
  - Durante la evaluación matutina de una jornada (ej. Miércoles), si una tarea de un proyecto (ej. *Barnizado* en Proyecto "Zapatero") es descartada por restricciones meteorológicas de humedad o lluvia, el motor no da por bloqueado el día ni se detiene.
  - El evaluador continúa probando secuencialmente con la siguiente tarea del pool global (ej. *Corte de listones* en Proyecto "Taburete").
  - Si la tarea del segundo proyecto es compatible con la ventana climática, se agenda en esa jornada.
- **Distintivos de Proyecto en la Agenda y Calendario**: En el cronograma detallado de la Agenda, notificaciones de Telegram y eventos espejo en Google Calendar, las tareas agendadas muestran un distintivo explícito con el nombre del proyecto correspondiente (ej. `[Zapatero] #1 Barnizado final`).

---

## 📡 7. Especificación de Endpoints REST (API Reference)

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

#### `POST /projects/:id/toggle`
Alterna el estado de activación (`is_active`) de un proyecto para incluirlo o pausarlo en el agendamiento multi-proyecto.
- **Request Body**:
  ```json
  {
    "is_active": "true | false"
  }
  ```

#### `POST /tasks/:id/toggle-active`
Alterna el estado de activación (`is_active`) de una tarea individual dentro de su proyecto.
- **Request Body**:
  ```json
  {
    "is_active": "true | false"
  }
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

## 🛡️ 8. Resiliencia, Caché, Sistema de Tipos y Tolerancia a Fallos

AGENDAPP implementa una capa de resiliencia distribuida y verificación estricta de tipos para garantizar la disponibilidad continua y estabilidad del código:

```
+-----------------------------------------------------------------------------------+
|                        CAPA DE RESILIENCIA Y SISTEMA DE TIPOS                     |
+-------------------+-------------------------------+-------------------------------+
|  OPEN-METEO API   |       TELEGRAM BOT API        |   TYPESCRIPT & STACK STRICT   |
+-------------------+-------------------------------+-------------------------------+
| • Timeout de 8s   | • Long Polling sin conflictos | • 100% libre de errores lint  |
| • Snapshot SQLite | • Auto-clean de Webhooks      | • Tipado completo en DAO/Types|
| • Fallback local  | • Aislamiento 400/403         | • esbuild a dist/server.cjs   |
+-------------------+-------------------------------+-------------------------------+
```

### 1. Sistema de Tipos y Compilación Estricta (TypeScript Clean)
- **Cero Errores de Linter y Compilación**: Todo el proyecto compila estrictamente bajo TypeScript sin advertencias ni errores (0 errores con `npm run lint` y `npm run build`).
- **Tipado Completo de Módulos**:
  - `src/types.ts`: Definición de modelos de dominio (`Task`, `Project`, `AppSettings`, `DailyLog`, `Material`, `DayEvaluation`, etc.).
  - `src/db.ts`: Operaciones relacionales SQLite con verificación rigurosa de tipos.
  - `src/calendarService.ts`: Autenticación segura con Google OAuth JWT y manejo estructurado de la API de Google Calendar.
  - `src/scheduler.ts`: Tipado estricto en el procesamiento de tickers climáticos, ventanas operativas y notificaciones de inicio de jornada.
  - `server.ts`: Manejo limpio de tipos de Express, middleware de autenticación y controladores.

### 2. Ingesta Meteorológica (Open-Meteo API)
- **Timeout y Reintentos**: Las solicitudes HTTP de pronóstico se ejecutan con timeout estricto de 8 segundos y reintentos automáticos.
- **Persistencia de Snapshot**: Cada pronóstico obtenido con éxito se guarda en la columna `morning_climate_snapshot` de `daily_logs` en formato JSON.
- **Fallback Transparente**: Si la API de Open-Meteo se encuentra fuera de servicio o inalcanzable, el evaluador utiliza el último snapshot almacenado en SQLite para continuar agendando el día sin interrumpir al operario.

### 3. Mensajería Distribuida (Telegram Bot API)
- **Long Polling sin Conflictos 409**: Detección inteligente de sesiones concurrentes y eliminación automática de webhooks residuales (`deleteWebhook?drop_pending_updates=true`).
- **Ejecución Asíncrona Non-Blocking**: Los ticks de notificación (`runWorkStartTick`, `runCheckinTick`) se ejecutan dentro de bloques `try/catch` aislados en el daemon (`scheduler.ts`).
- **Aislamiento de Errores**: Si un usuario tiene un `telegram_chat_id` inválido, o bloqueó el bot (`403 Forbidden`), la falla es capturada y registrada en los logs del servidor sin detener los procesos de otros usuarios ni bloquear el hilo principal de Node.js.

### 4. Sincronización de Calendario (Google Calendar API v3)
- **Manejo de Errores 404 (Eventos Eliminados)**: Si un evento espejo es eliminado manualmente en la app de Google Calendar, el servicio detecta la respuesta `404 Not Found`, limpia la columna `google_event_id` en SQLite y vuelve a crear el evento si la jornada sigue siendo viable.
- **Tolerancia a Errores 5xx**: Errores temporales de red o indisponibilidad de la API de Google son manejados con reintentos exponenciales en el siguiente tick del daemon (cada 15 minutos).

---

## 🛠️ 9. Tech Stack & Matriz Técnica

### Tech Stack Principal
| Capa | Tecnología | Descripción |
| :--- | :--- | :--- |
| **Entorno de Ejecución** | Node.js 22 (Web Runtime) & Express 4 | Servidor HTTP en puerto 3000, middleware REST API y gestión de sesiones. |
| **Lenguaje** | TypeScript | Tipado estricto 100% limpio en todo el proyecto (`tsc --noEmit`). |
| **Compilador / Empaquetador**| `esbuild` | Bundling optimizado a CommonJS en `dist/server.cjs`. |
| **Base de Datos** | SQLite vía `better-sqlite3` | Motor relacional en disco con modo WAL (`journal_mode = WAL`). |
| **Zona Horaria** | `tz-lookup` | Identificación dinámica de huso horario IANA según lat/lon. |
| **Calendario** | `googleapis` (API v3) | Sincronización espejo con Google Calendar API vía Service Account JWT. |
| **Mensajería** | Telegram Bot API | Notificaciones operacionales, comandos intermedios y callbacks inline. |
| **Motor Meteorológico** | Open-Meteo API | Pronósticos horarios de temperatura, humedad y precipitaciones. |
| **Renderizado Frontend** | EJS (Embedded JavaScript) | Vistas SSR modulares y reactivas. |
| **Diseño y Estilos** | Tailwind CSS | Interfaz oscura de alta precisión para ambientes de taller. |

---

## 📂 10. Árbol de Archivos del Proyecto

```
AGENDAPP/
├── .env.example                  # Plantilla de variables de entorno
├── .gitignore                    # Reglas de exclusión de Git
├── Dockerfile                    # Receta de construcción de contenedor Docker
├── README.md                     # Documentación técnica y arquitectura (Single Source of Truth)
├── metadata.json                 # Metadatos del applet e intenciones de la plataforma
├── package.json                  # Dependencias NPM, scripts de compilación, linter y ejecución
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
        ├── materials.ejs         # Componente de materiales e insumos
        └── settings_modal.ejs    # Modal de configuración de parámetros operacionales
```

---

## 📑 11. Matriz Técnica Detallada Archivo por Archivo

| Archivo | Responsabilidad Principal | Exportaciones / Métodos Clave | Dependencias |
| :--- | :--- | :--- | :--- |
| `server.ts` | Servidor HTTP Express, rutas REST (`/api/*`, `/tasks/*`, `/evaluation/*`), autenticación. | Inicialización de Express, endpoints de autenticación y lógica del dashboard. | `express`, `src/db.ts`, `src/auth.ts`, `src/scheduler.ts`, `src/telegramBot.ts` |
| `src/auth.ts` | Seguridad de contraseñas y tokens HMAC de sesión. | `hashPassword`, `verifyPassword`, `signToken`, `verifyToken`, `requireAuth` | Node `crypto`, `express`, `src/db.ts` |
| `src/calendarService.ts` | Integración con Google Calendar API v3. | `GoogleCalendarService`, `createWorkshopEvent` | `googleapis`, Node `fs`, `src/db.ts` |
| `src/dateUtils.ts` | Formateo de fechas y textos en español. | `formatDateShortEs`, `formatDateLongEs` | JavaScript Standard Date API |
| `src/db.ts` | Capa DAO de SQLite, migraciones y persistencia en disco. | `initDatabase`, `store` (CRUD de tareas, proyectos, configuraciones, logs, materiales) | `better-sqlite3`, Node `fs`, `src/types.ts` |
| `src/evaluator.ts` | Motor de evaluación climática y calce de tiempos de curado. | `evaluator.evaluateDay` | `src/types.ts`, `src/holidaysService.ts` |
| `src/holidaysService.ts` | Identificación de feriados legales. | `getHolidayDatesForRange`, `isHoliday` | `src/types.ts` |
| `src/scheduler.ts` | Daemon en segundo plano para tickers meteorológicos y notificaciones. | `startDaemon`, `runMorningEvaluation`, `runCheckinTick`, `processWorkStartNotificationsForUser` | `src/db.ts`, `src/evaluator.ts`, `src/weatherService.ts`, `src/telegramBot.ts` |
| `src/telegramBot.ts` | Bot de Telegram, recepción de webhooks, Long Polling robusto y callbacks inline. | `TelegramBotService`, handlers de comandos e interacciones callback | `src/db.ts`, HTTP fetch API |
| `src/types.ts` | Interfaces de dominio y tipos de datos en TypeScript. | `Task`, `Project`, `AppSettings`, `DailyLog`, `Material`, `TaskStatus`, `TaskCategory` | TypeScript Pure Types |
| `src/weatherService.ts` | Ingesta de pronósticos meteorológicos de Open-Meteo. | `getHourlyForecast`, `computeHourlyClimateMap` | HTTP fetch API, `src/types.ts` |
| `views/index.ejs` | Vista principal SSR que integra Agenda, Backlog y Configuración. | Estructura HTML del Dashboard | EJS Engine, Tailwind CSS |
| `views/components/backlog.ejs` | Componente de backlog con formulario de creación y autocompletado. | Parcial EJS del Backlog | EJS Engine |
| `static/js/backlog.js` | Lógica de cliente para drag & drop y autocompletado inteligente. | `initTaskAutocomplete`, `initSortable` | Browser DOM API |

---

## 🔄 12. Diagrama de Flujo de Datos End-to-End

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

## 🗄️ 13. Esquema de Base de Datos SQLite (`data/workshop.db`)

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

## 🚀 14. Guía de Instalación, Configuración de Entorno (`.env`) y Despliegue

### 1. Configuración de Variables de Entorno (`.env`)
Crea un archivo `.env` basado en `.env.example` definiendo las credenciales operacionales clave:

```env
# Servidor y Sesiones
ADMIN_EMAIL=admin@taller.cl
ADMIN_PASSWORD=PasswordSeguro123!
SESSION_SECRET=un_secreto_muy_seguro_para_firmar_cookies
DATA_DIR=./data
TIMEZONE=America/Santiago

# Bot de Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=987654321
TELEGRAM_WEBHOOK_SECRET=secreto_webhook_opcional

# Google Calendar API v3 (Service Account / Credenciales)
GOOGLE_CLIENT_EMAIL=agendapp-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_ID=primary_or_calendar_id@group.calendar.google.com
GOOGLE_CREDENTIALS_JSON=
```

### 2. Instalación de Dependencias, Verificación y Compilación
```bash
# 1. Instalar dependencias del proyecto
npm install

# 2. Verificar estricta conformidad de tipos (Linting de TypeScript)
npm run lint

# 3. Compilar paquete optimizado para producción con esbuild (dist/server.cjs)
npm run build
```

### 3. Ejecución en Entorno de Desarrollo Local
```bash
# Iniciar servidor con hot-reload dinámico mediante tsx
npm run dev
```

### 4. Ejecución en Producción
```bash
# Iniciar la versión empaquetada de producción
npm start
```

### 5. Despliegue en Producción con PM2
```bash
# Compilar el empaquetado de producción
npm run build

# Iniciar proceso con PM2
pm2 start dist/server.cjs --name "agendapp" --update-env
```

### 6. Despliegue Contenerizado con Docker
```bash
# Construir imagen Docker
docker build -t agendapp:latest .

# Ejecutar contenedor con volumen de persistencia en el puerto 3000
docker run -d -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data --name agendapp_container agendapp:latest
```

### 7. Respaldos en Caliente de SQLite (Modo WAL)
AGENDAPP opera SQLite configurado en modo **Write-Ahead Logging (WAL)** (`journal_mode = WAL`), garantizando un rendimiento óptimo de lectura/escritura concurrente.

Para realizar respaldos seguros sin detener el servidor en ejecución, utiliza la API de respaldo en caliente o comandos nativos `VACUUM INTO`:

```bash
# Método A: Copia de seguridad nativa SQLite usando VACUUM INTO en Docker
docker exec -it agendapp_container sqlite3 /app/data/workshop.db "VACUUM INTO '/app/data/backup-$(date +%Y%m%d%H%M%S).db';"

# Método B: Copia de seguridad local directa mediante CLI de sqlite3
sqlite3 data/workshop.db "VACUUM INTO 'data/backup-live.db';"
```

---

## 🛡️ 15. Guardagujas de Desarrollo e Integración

1. **Evaluación Centralizada en `evaluator.ts`**: Toda modificación de horarios o viabilidad de tareas debe pasar por el motor de evaluación para asegurar los umbrales climáticos y de curado.
2. **Cookies `SameSite=None; Secure`**: Mantener las banderas de cookies para soportar la ejecución en entornos incrustados (iframes) e interfaces móviles.
3. **Persistencia Directa**: Toda escritura en SQLite debe reflejarse en `data/workshop.db` para asegurar la durabilidad tras reinicios del contenedor.
