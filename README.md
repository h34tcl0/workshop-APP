# 🚀 AGENDAPP (Workshop OS) — Documentación Técnica y Arquitectura del Sistema

**AGENDAPP** (anteriormente *Workshop OS*) es un sistema operativo de ejecución operacional autónomo e inteligente respecto al clima, diseñado específicamente para talleres de carpintería al aire libre, estudios de ebanistería y procesos de manufactura artesanal sensibles a condiciones ambientales.

El sistema funciona como un **bucle de decisión continuo**: ingiere pronósticos meteorológicos en tiempo real, evalúa umbrales ambientales de secado y curado frente al backlog de tareas, agenda bloques de trabajo optimizados, sincroniza eventos espejo en **Google Calendar API v3**, emite alertas intradía de emergencia ante cambios climáticos intempestivos, gestiona el inventario de materiales y herramientas, y entrega notificaciones operacionales e interactivas a través de un **Bot de Telegram** y su despachador centralizado **`NotificationDispatcher`**.

---

## 📑 Tabla de Contenidos

1. [Visión General y Arquitectura Multi-Tenant con Geolocalización](#-1-visión-general-y-arquitectura-multi-tenant-con-geolocalización)
2. [Arquitectura y Modelo de Datos (Esquema Completo)](#-2-arquitectura-y-modelo-de-datos-esquema-completo)
3. [Motor de Evaluación Meteorológica, Curado Pasivo y Auditoría Horaria](#-3-motor-de-evaluación-meteorológica-curado-pasivo-y-auditoría-horaria)
4. [Sistema de Notificaciones y Alertas por Tiers (`NotificationDispatcher`)](#-4-sistema-de-notificaciones-y-alertas-por-tiers-notificationdispatcher)
5. [Concurrencia, Locks en Memoria y Re-evaluación Automática Silenciosa](#-5-concurrencia-locks-en-memoria-y-re-evaluación-automática-silenciosa)
6. [Botón "Término de la Jornada" (Check-in Manual y Fallback)](#-6-botón-término-de-la-jornada-check-in-manual-y-fallback)
7. [Sincronización Espejo Multi-Día (Google Calendar API v3)](#-7-sincronización-espejo-multi-día-google-calendar-api-v3)
8. [Seguridad, CSRF, Rate Limiting y Administración (Backups y Contraseñas)](#-8-seguridad-csrf-rate-limiting-y-administración-backups-y-contraseñas)
9. [Frontend, UI, Modos de Navegación, Componentes y Patrón AJAX](#-9-frontend-ui-modos-de-navegación-componentes-y-patrón-ajax)
10. [Suite de Pruebas Automatizadas y Aseguramiento de Calidad (Vitest)](#-10-suite-de-pruebas-automatizadas-y-aseguramiento-de-calidad-vitest)
11. [Operaciones, Despliegue en Producción y Comandos de Diagnóstico](#-11-operaciones-despliegue-en-producción-y-comandos-de-diagnóstico)
12. [Historial de Incidentes Conocidos y Lecciones Aprendidas](#-12-historial-de-incidentes-conocidos-y-lecciones-aprendidas)
13. [Especificación de Endpoints REST (API Reference)](#-13-especificación-de-endpoints-rest-api-reference)
14. [Árbol de Archivos del Proyecto y Matriz Técnica por Archivo](#-14-árbol-de-archivos-del-proyecto-y-matriz-técnica-por-archivo)
15. [💡 Sugerencias y Roadmap para Futuras Iteraciones](#-15--sugerencias-y-roadmap-para-futuras-iteraciones)

---

## 📌 1. Visión General y Arquitectura Multi-Tenant con Geolocalización

### El Desafío Operacional
La carpintería técnica y el trabajo en taller al aire libre sufren vulnerabilidades climáticas estrictamente delimitadas:
- **Colas PVA y Adhesivos Estructurales**: Requieren temperaturas mínimas (usualmente > 10 °C) y ausencia de humedad crítica durante la aplicación y el curado. Niveles de humedad relativa superiores al 80% degradan significativamente la resistencia mecánica del ensamble.
- **Acabados, Barnices y Pinturas**: Los recubrimientos sintéticos y al agua exigen ventanas térmicas estables y baja humedad para evitar el "velado" blanco, falta de anclaje, burbujas o tiempos de secado anormalmente prolongados.
- **Epoxi y Resinas de Colada**: Exigen condiciones térmicas estrictas (mínimo 15.0 °C) y humedad relativa $\le 75.0\%$ tanto durante el vaciado activo como durante sus 6 a 24 horas de curado exotérmico continuo.
- **Herramientas Eléctricas y Madera Expuesta**: La lluvia directa o rocío imprevisto interrumpe el trabajo en patio, estropea la maquinaria eléctrica y arquea los tablones de madera aserrada o cepillada.

### La Solución AGENDAPP
AGENDAPP automatiza completamente la planificación del taller mediante una arquitectura **Multi-Tenant aislada**:

```
+-----------------------------------------------------------------------------------+
|                                CLIENTE WEB (PWA)                                 |
|  [ Vista Planificación ]  |  [ Vista Taller / Focus ]  |  [ Vista Inventario ]    |
|  - Timeline 7-14 Días     |  - Widget Curado Vivo      |  - Materiales y Herram.  |
|  - Auditoría Horaria      |  - Checklist de Tareas     |  - Importación Masiva    |
|  - Modal Ajustes (Tabs)   |  - Calculadora de Madera   |  - Export Context IA     |
+---------------------------------------------------------+-------------------------+
                                                          | Peticiones AJAX (Fetch)
                                                          v
+-----------------------------------------------------------------------------------+
|                        SERVIDOR EXPRESS / NODE.JS (PUERTO 3000)                   |
|  - Middlewares: CSRF Check (verifySameOrigin), Rate Limiting, Auth PBKDF2 Session |
|  - Servicios FSM: TaskService, DayService                                         |
|  - Evaluador Climático: evaluator.ts (Horizonte Multi-Día + Ventanas Operativas)  |
|  - Scheduler Daemon: scheduler.ts (Locks de Concurrencia + Reevaluación Silenciosa)|
|  - NotificationDispatcher: Tiers 1 a 4 (Telegram Bot API)                         |
|  - CalendarService: Google Calendar API v3 (Espejo Bidireccional)                 |
+--------------------+------------------------------------+-------------------------+
                     |                                    |
                     v                                    v
     +-------------------------------+    +-------------------------------+
     |  SQLite 3 (better-sqlite3)    |    |  APIs Externas                |
     |  - Modo WAL (journal_mode=WAL)|    |  - Open-Meteo Weather API     |
     |  - Migraciones Idempotentes   |    |  - Telegram Bot API           |
     |  - Aislamiento por user_id    |    |  - Google Calendar v3 REST    |
     +-------------------------------+    +-------------------------------+
```

1. **Entorno de Ejecución Moderno**:
   - Backend escrito en **TypeScript** ejecutado sobre **Node.js 22 (Web Runtime)** con **Express 4**.
   - Renderizado server-side de vistas modulares **EJS** asistido por estilos de utilidad **Tailwind CSS**.
   - Empaquetado optimizado para producción con **`esbuild`** (`dist/server.cjs`), escuchando en el **puerto 3000**.
2. **Aislamiento Multi-Tenant y Unicidad Estricta de Chat ID**:
   - Cada usuario (`user_id`) posee un contexto completamente aislado en la base de datos: su propio backlog de tareas, proyectos, plantillas, materiales/insumos, herramientas, logs diarios, sobreescrituras manuales (`day_overrides`) y configuración operacional (`app_settings`).
   - **Garantía de Unicidad de Telegram**: Cada `telegram_chat_id` está estrictamente vinculado a un único usuario activo. Si un usuario registra un Chat ID ya usado por otra cuenta, el sistema desvincula automáticamente la cuenta anterior (`telegram_chat_id = NULL`), evitando la duplicación de notificaciones o cruce de datos.
3. **Geolocalización y Cálculo Dinámico de Zona Horaria**:
   - El usuario configura la latitud y longitud exactas de su taller (mediante un mapa interactivo Leaflet/OpenStreetMap integrado en el modal de configuración).
   - El backend utiliza `tz-lookup` para determinar automáticamente la zona horaria IANA correspondiente (ej. `America/Santiago`, `America/Buenos_Aires`).
   - La aplicación sincroniza y presenta la **hora local exacta del taller** (`local_time_info`), garantizando que la evaluación matutina, las notificaciones y los eventos de Google Calendar coincidan con el huso horario real del sitio de trabajo.

---

## 🗄️ 2. Arquitectura y Modelo de Datos (Esquema Completo)

AGENDAPP almacena la persistencia relacional en SQLite (`data/workshop.db`) mediante el driver de alto rendimiento `better-sqlite3` con modo WAL activado (`journal_mode = WAL`).

### Patrón de Migraciones Idempotentes en `src/db.ts`
Para garantizar que la base de datos se actualice de forma transparente en cada inicio del servidor sin destruir datos ni requerir herramientas CLI externas (las cuales no existen en el contenedor de producción), `db.ts` implementa una convención de **migraciones idempotentes condicionales**:

```typescript
// Convención estándar en db.ts:
const currentDailyLogCols = dbInstance.prepare("PRAGMA table_info(daily_logs)").all() as any[];
if (!currentDailyLogCols.some(c => c.name === 'last_rain_alert_hour')) {
  dbInstance.exec("ALTER TABLE daily_logs ADD COLUMN last_rain_alert_hour INTEGER;");
}
```

Cualquier modificación o adición de columna futura **DEBE** seguir este mismo patrón:
1. Inspeccionar las columnas existentes con `PRAGMA table_info(nombre_tabla)`.
2. Verificar con `.some(c => c.name === 'columna')` si la columna ya existe.
3. Ejecutar `ALTER TABLE ... ADD COLUMN` condicionalmente solo si está ausente.

### Esquema Detallado de Tablas

#### Tabla `users`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID único del usuario. |
| `email` | TEXT | UNIQUE NOT NULL | Correo electrónico de acceso. |
| `password_hash` | TEXT | NOT NULL | Hash PBKDF2 en formato de 4 partes (`pbkdf2:sha256:100000:salt:hash`). |
| `must_change_password` | INTEGER | NOT NULL DEFAULT 0 | Flag de cambio obligatorio de clave (1=Sí, 0=No). |
| `created_at` | TEXT | NOT NULL | Fecha de creación ISO. |

#### Tabla `app_settings`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID de la configuración. |
| `user_id` | INTEGER | UNIQUE NOT NULL | FK hacia `users.id`. |
| `operational_start_hour` | INTEGER | NOT NULL DEFAULT 9 | Hora de inicio de la jornada (0-23). |
| `operational_end_hour` | INTEGER | NOT NULL DEFAULT 18 | Hora de término de la jornada (0-23). |
| `max_humidity_percent` | REAL | NOT NULL DEFAULT 80.0 | Límite máximo de humedad relativa (%). |
| `latitude` | REAL | NOT NULL DEFAULT -32.99 | Latitud geográfica del taller. |
| `longitude` | REAL | NOT NULL DEFAULT -71.27 | Longitud geográfica del taller. |
| `timezone` | TEXT | NULL | Zona horaria IANA calculada (ej. `America/Santiago`). |
| `setup_hours` | REAL | NOT NULL DEFAULT 1.0 | Tiempo de preparación pre-jornada (horas decimales, ej. 0.5 = 30m). |
| `teardown_hours` | REAL | NOT NULL DEFAULT 1.0 | Tiempo de limpieza post-jornada (horas decimales, ej. 0.5 = 30m). |
| `min_work_hours` | REAL | NOT NULL DEFAULT 1.0 | Duración mínima para validar un día como viable. |
| `min_work_hours_unless_final`| REAL | NOT NULL DEFAULT 4.0 | Duración mínima a menos que complete la última tarea del proyecto. |
| `min_rain_precipitation_mm` | REAL | NOT NULL DEFAULT 0.2 | Umbral de precipitación para considerar riesgo de lluvia (mm). |
| `checkin_hour` | INTEGER | NOT NULL DEFAULT 19 | Hora para la notificación nocturna de Telegram. |
| `morning_eval_lead_hours` | INTEGER | NOT NULL DEFAULT 1 | Horas de anticipación para la evaluación matutina. |
| `exclude_saturdays` | INTEGER | NOT NULL DEFAULT 1 | Excluir sábados por defecto (1=Sí, 0=No). |
| `exclude_sundays` | INTEGER | NOT NULL DEFAULT 1 | Excluir domingos por defecto (1=Sí, 0=No). |
| `exclude_holidays` | INTEGER | NOT NULL DEFAULT 1 | Excluir feriados legales (1=Sí, 0=No). |
| `require_curing_before_cutoff`| INTEGER | NOT NULL DEFAULT 1 | Exigir que el curado termine antes del corte operacional nocturno. |
| `telegram_chat_id` | TEXT | NULL | Chat ID de Telegram (Unicidad estricta por usuario). |
| `google_calendar_id` | TEXT | NULL | ID del calendario en Google Calendar. |
| `google_calendar_enabled`| INTEGER | NOT NULL DEFAULT 0 | Interruptor de activación de Google Calendar. |

#### Tabla `day_overrides`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID de la sobreescritura. |
| `user_id` | INTEGER | NOT NULL | FK hacia `users.id`. |
| `override_date` | TEXT | NOT NULL | Fecha sobreescrita (`YYYY-MM-DD`). |
| `force_status` | TEXT | NULL | Sobreescritura de estado (`VIABLE` o `BLOCKED`). |
| `custom_start_hour` | INTEGER | NULL | Hora inicio personalizada de la jornada. |
| `custom_end_hour` | INTEGER | NULL | Hora fin personalizada de la jornada. |
| `removed_task_ids` | TEXT | NULL | JSON con IDs de tareas excluidas manualmente para este día. |
| `note` | TEXT | NULL | Nota justificativa del usuario. |
| `updated_at` | TEXT | NULL | Fecha ISO de actualización. |

#### Tabla `daily_logs`
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
| `tasks_summary` | TEXT | NULL | Resumen legible de tareas agendadas. |
| `scheduled_task_ids` | TEXT | NULL | JSON con IDs de tareas agendadas. |
| `morning_climate_snapshot`| TEXT | NULL | JSON con snapshot climático recibido de Open-Meteo. |
| `hourly_forecast` | TEXT | NULL | JSON con el desglose auditado hora por hora del día (~1.5 KB/día). |
| `telegram_notified` | INTEGER | NOT NULL DEFAULT 0 | Flag de notificación de inicio de jornada enviada (Tier 2). |
| `calendar_created` | INTEGER | NOT NULL DEFAULT 0 | Flag de confirmación de evento en Google Calendar. |
| `google_event_id` | TEXT | NULL | Identificador del evento en Google Calendar. |
| `checkin_sent` | INTEGER | NOT NULL DEFAULT 0 | Flag de prompt de check-in nocturno enviado (Tier 3). |
| `checkin_resolved` | INTEGER | NOT NULL DEFAULT 0 | Flag de check-in resuelto por el operario. |
| `humidity_alert_sent` | INTEGER | NOT NULL DEFAULT 0 | Flag de aviso informativo de humedad enviado hoy. |
| `intraday_alert_triggered`| INTEGER | NOT NULL DEFAULT 0 | Flag de alerta de emergencia de lluvia activada hoy. |
| `intraday_alert_acknowledged`| INTEGER | NOT NULL DEFAULT 0 | Flag de confirmación/revisión por parte del operario. |
| `intraday_alert_last_sent_at`| TEXT | NULL | Timestamp ISO de la última ráfaga de lluvia enviada. |
| `intraday_alert_burst_count`| INTEGER | NOT NULL DEFAULT 0 | Contador de ráfagas enviadas (máx 3 ráfagas cada 5 min). |
| `last_rain_alert_hour`| INTEGER | NULL | Hora de lluvia registrada en la última alerta para detectar adelantos. |
| `weather_alert_message`| TEXT | NULL | Mensaje de la última alerta emitida. |
| `calendar_sync_claimed_at`| TEXT | NULL | Timestamp ISO de lock optimista para creación en Google Calendar. |
| `updated_at` | TEXT | NOT NULL | Timestamp ISO de actualización. |

#### Tabla `projects`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID único del proyecto. |
| `user_id` | INTEGER | NOT NULL | FK hacia `users.id`. |
| `name` | TEXT | NOT NULL | Nombre del proyecto. |
| `description` | TEXT | NULL | Descripción detallada. |
| `is_active` | INTEGER | NOT NULL DEFAULT 0 | Flag de proyecto activo en el pool de agendamiento. |

#### Tabla `tasks`
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
| `curing_is_blocking` | INTEGER | NOT NULL DEFAULT 1 | 1 = Bloquea el avance del taller, 0 = Curado en paralelo no vinculante. |
| `status` | TEXT | NOT NULL DEFAULT 'pending' | Estado (`pending`, `scheduled`, `in_progress`, `completed`). |
| `order_num` | INTEGER | NOT NULL DEFAULT 1 | Orden secuencial en el backlog. |

#### Tabla `materials`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID del material. |
| `user_id` | INTEGER | NOT NULL | FK hacia `users.id`. |
| `project_id` | INTEGER | NOT NULL | FK hacia `projects.id`. |
| `name` | TEXT | NOT NULL | Nombre del material/insumo. |
| `quantity` | REAL | NOT NULL DEFAULT 1.0 | Cantidad requerida. |
| `unit` | TEXT | NOT NULL DEFAULT 'unidades' | Unidad de medida (`piezas`, `mm`, `m2`, `kg`, etc.). |
| `category` | TEXT | NOT NULL DEFAULT 'General' | Categoría del material. |
| `status` | TEXT | NOT NULL DEFAULT 'to_buy' | Estado (`to_buy` [Por Comprar] o `in_stock` [En Taller]). |
| `created_at` | TEXT | NOT NULL | Fecha ISO de creación. |
| `updated_at` | TEXT | NOT NULL | Fecha ISO de actualización. |

#### Tabla `tools`
| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | ID de la herramienta. |
| `user_id` | INTEGER | NOT NULL | FK hacia `users.id`. |
| `name` | TEXT | NOT NULL | Nombre de la herramienta o accesorio. |
| `category` | TEXT | NOT NULL DEFAULT 'General' | Categoría de la herramienta. |
| `status` | TEXT | NOT NULL DEFAULT 'in_stock' | Estado (`to_buy` [Por Comprar] o `in_stock` [En Taller]). |
| `created_at` | TEXT | NOT NULL | Fecha ISO de creación. |
| `updated_at` | TEXT | NOT NULL | Fecha ISO de actualización. |

---

## 🔍 3. Motor de Evaluación Meteorológica, Curado Pasivo y Auditoría Horaria

El motor de evaluación en `src/evaluator.ts` calcula la viabilidad de agendamiento a lo largo de un horizonte móvil multi-día (usualmente 7 a 14 días).

```
Jornada Operativa (09:00 - 18:00)             Extensión de Curado Pasivo Nocturno (hasta 23:00)
┌───────────────────────────────────────────┬─────────────────────────────────────────────┐
│ 09:00 Setup │ 10:00 - 15:00 Trabajo Activo │ 15:00 - 20:00 Curado PVA / Epoxi (Pasivo)   │
└─────────────┴─────────────────────────────┴─────────────────────────────────────────────┘
                                             ▲ Si a las 19:00 Llueve o Humedad > 80% ────┤
                                               --> DÍA RECHAZADO / DAY_BLOCKED PREVENTIVO
```

### Reglas de Negocio Centrales del Evaluador

1. **Precedencia Absoluta de `day_overrides`**:
   - Las sobreescrituras manuales tienen **prioridad absoluta** sobre cualquier regla de exclusión (`exclude_saturdays`, `exclude_sundays`, `exclude_holidays`).
   - Si un día tiene `force_status === "BLOCKED"`, el evaluador retorna `DAY_BLOCKED` inmediatamente con la nota del usuario.
   - Si un día tiene `force_status === "VIABLE"` u horas personalizadas (`custom_start_hour` / `custom_end_hour`), anula el bloqueo de calendario y evalúa el clima en esa ventana horaria específica.
2. **Jornada Concluida y Exclusión del Día de Hoy**:
   - Si para el día de hoy `checkin_resolved === true` (cerrado manualmente vía check-in o el botón "Término de la Jornada"), o si la hora actual ya no permite completar el mínimo de horas de trabajo antes del cierre operativo (`operational_end_hour`), el día de hoy se marca como `DAY_BLOCKED` ("Jornada concluida").
   - Las tareas pendientes se agendan automáticamente a partir de **MAÑANA**.
3. **Fases de la Jornada Evaluada**:
   - **PREP (Setup)**: Preparación del taller (duración `setup_hours`, ej. 1.0h o 30m).
   - **TRABAJO (Trabajo Activo)**: Ejecución de tareas con herramientas y ensamblajes.
   - **CIERRE (Teardown)**: Limpieza y guardado (duración `teardown_hours`, ej. 1.0h o 30m).
   - **CURADO (Curado Pasivo)**: Secado que puede extenderse después de la jornada (hasta las 23:00 hrs o corte configurado).
4. **Umbrales Ambientales**:
   - **Lluvia**: Precipitación `>= min_rain_precipitation_mm` (0.2 mm) o probabilidad `>= 30%` en trabajo activo o curado pasivo bloquea el día.
   - **Humedad**: Humedad `>= max_humidity_percent` (ej. 80%) durante trabajo o curado invalida la ventana.
   - **Epoxi / Resinas**: Exige temperatura `>= 15.0 °C` y humedad `<= 75.0%` continuas.
   - **Umbral de Tarea Final (`min_work_hours_unless_final`)**: Si la jornada no alcanza `min_work_hours` estándar (ej. 4h) pero la tarea evaluada es la **última pendiente del backlog**, el motor aplica el umbral reducido (ej. 1h o 2h) para completar el proyecto sin demoras artificiales.
5. **Jerarquía Diagnóstica de Inviabilidad**:
   - **Caso 1**: Lluvia generalizada persistente en el horario operativo.
   - **Caso 2**: Conflicto climático puntual (lluvia, humedad o temperatura en secado de tarea específica).
   - **Caso 3**: Humedad ambiental persistente sin ventanas aptas.
   - **Caso 4**: Ventana seca detectada pero insuficiente para cubrir el setup, trabajo activo y teardown requeridos.
6. **Curado No Vinculante (`curing_is_blocking = false`)**:
   - Si una tarea requiere curado pero no bloquea el taller, el evaluador permite programar tareas adicionales en paralelo ese mismo día siempre que haya horas disponibles.

### Value Object Inmutable `LocalDate`
Todo cálculo de fechas de calendario se realiza a través de `LocalDate` (`src/LocalDate.ts`), que proporciona aritmética de días pura (`addDays(n)`), comparaciones cronológicas deterministas y anclaje al mediodía UTC (`toUtcNoonDate()`, `T12:00:00Z`), eliminando por completo cualquier desfase horario entre la UI y el motor en husos horarios occidentales (`America/Santiago`).

### Auditoría Horaria Climática (`hourly_forecast`)
El evaluador genera un desglose hora por hora (`getHourlyClimateAudit`) almacenado en `daily_logs.hourly_forecast` (~1.5 KB/día), permitiendo a la interfaz web mostrar con precisión en qué hora específica ocurrió un riesgo climático (trabajo activo o curado pasivo).

---

## 📢 4. Sistema de Notificaciones y Alertas por Tiers (`NotificationDispatcher`)

El sistema de notificaciones está completamente desacoplado del scheduler y centralizado en **`NotificationDispatcher`** (`src/notificationDispatcher.ts`):

```
                                  +-------------------------------+
                                  |    NotificationDispatcher     |
                                  +---------------+---------------+
                                                  |
       +--------------------+---------------------+--------------------+--------------------+
       |                    |                     |                    |                    |
       v                    v                     v                    v                    v
  [ Tier 1: Matutino ] [ Tier 2: Inicio ]    [ Tier 3: Check-in ] [ Tier 4A: Humedad ] [ Tier 4B: Lluvia ]
  Evaluación 7 días    Al empezar bloque     Prompt nocturno      1 aviso diario      Ráfagas cada 5 min
  Sync Google Cal      telegram_notified=1   checkin_sent=1       humidity_sent=1     Alerta re-adelanto
```

### Detalle de los 4 Tiers de Notificación

| Tier | Nombre | Función de Despacho | Condición de Activación | Comportamiento y Persistencia |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | **Evaluación Matutina** | `runMorningEvaluation` | Horas antes de la jornada (`operational_start_hour - morning_eval_lead_hours`). | Evalúa los 7-14 días con Open-Meteo, persiste `daily_logs` y sincroniza eventos espejo en Google Calendar. |
| **Tier 2** | **Inicio de Jornada** | `processWorkStartNotification` | Al inicio exacto de la ventana viable (`now >= window_start`). | Envía a Telegram el resumen de tareas a ejecutar hoy. Marca `telegram_notified = true`. |
| **Tier 3** | **Check-in Nocturno** | `processCheckinNotification` | Al alcanzar la hora de cierre (`now >= checkin_hour`). | Envía un teclado interactivo inline a Telegram para marcar tareas completadas/postergadas. Marca `checkin_sent = true`. |
| **Tier 4A** | **Aviso de Humedad** | `processWeatherAlert` | Humedad `> max_humidity_percent` dentro del horario laboral. | **Informativo**: Envía 1 único mensaje al día sin ráfagas. Marca `humidity_alert_sent = true`. |
| **Tier 4B** | **Emergencia de Lluvia** | `processWeatherAlert` | Lluvia detectada en la ventana de trabajo o curado. | **Emergencia**: Dispara ráfaga de mensajes cada 5 min (hasta 3 veces) hasta que el operario confirme (`intraday_alert_acknowledged`). |

### 🚨 Lógica Crítica de Adelanto de Lluvia (`last_rain_alert_hour`)
Si una lluvia prevista para las 18:00 hrs ya había sido confirmada por el operario, pero una nueva lectura climática detecta que la lluvia **se adelantó** a las 16:00 hrs:
1. El despachador detecta `rainHour < previousRainHour` usando la columna `last_rain_alert_hour`.
2. Resetea `intraday_alert_acknowledged = false` para exigir nueva atención.
3. Actualiza `last_rain_alert_hour` a la nueva hora.
4. Emite inmediatamente una nueva ráfaga con el título:
   `🚨 ¡ALERTA URGENTE DE LLUVIA ADELANTADA!`

---

## 🔐 5. Concurrencia, Locks en Memoria y Re-evaluación Automática Silenciosa

### Sistema de Lock en Memoria
Para evitar condiciones de carrera cuando coinciden un cron en segundo plano, una mutación web del usuario y un callback de Telegram, `scheduler.ts` implementa cerrojos por usuario (`activeEvaluationLocks`):
- **Timeout de Seguridad de 2 Minutos**: Si una llamada externa a APIs (Open-Meteo o Telegram) quedara colgada, el lock se libera forzosamente tras 2 minutos mediante un `setTimeout` defensivo.
- **Timeouts en Peticiones Salientes**: Todas las llamadas salientes HTTP utilizan `AbortSignal.timeout(8000)` o `AbortSignal.timeout(10000)`.

### Re-evaluación Automática Silenciosa
Cualquier mutación en el sistema (agregar/editar tareas, mover prioridades, alternar materiales a `in_stock`, resolver check-in) dispara una **re-evaluación automática y silenciosa** del horizonte. Actualiza `daily_logs` y resincroniza Google Calendar de inmediato, **sin enviar notificaciones redundantes** a Telegram.

---

## 🔘 6. Botón "Término de la Jornada" (Check-in Manual y Fallback)

En la cabecera de la vista de Planificación, el operario cuenta con el botón **"Término de la Jornada"**:

```
                 [ Botón: Término de la Jornada ]
                                │
                                ▼
                 ¿Telegram vinculado y responsivo?
                       ├── SÍ  ──> Envía prompt interactivo a Telegram + Notificación web.
                       └── NO  ──> Abre Modal Fallback directamente en pantalla para marcar tareas.
```

- **Idempotencia**: Si el check-in de hoy ya fue resuelto, informa amablemente sin duplicar acciones.
- **Doble Clic Prematuro**: El botón se deshabilita instantáneamente (`disabled = true`) y muestra spinner para evitar llamadas dobles concurrentes.
- **Modal Fallback Web**: Permite al operario marcar cada tarea como completada o postergada directamente en el navegador si no tiene su teléfono a mano.

---

## 📅 7. Sincronización Espejo Multi-Día (Google Calendar API v3)

AGENDAPP mantiene un espejo automático de la agenda en Google Calendar (`src/calendarService.ts`):
1. **Eventos Macro**: Para días viables (`DAY_VIABLE`), genera eventos titulados `🔨 Taller Carpintería (09:00 - 17:00)` con la lista de tareas en la descripción.
2. **Eliminación Automática**: Si un día se vuelve inviable por lluvia (`DAY_BLOCKED`), el evento se remueve automáticamente de Google Calendar.
3. **Rescate de Errores 404**: Si el usuario elimina el evento manualmente en Google Calendar, el sistema limpia `google_event_id` y lo regenera limpiamente en la siguiente evaluación.
4. **Lock Optimista (`calendar_sync_claimed_at`)**: Previene la creación de eventos duplicados entre hilos concurrentes.
5. **Validación de Claves PEM**: Sanitiza y valida claves de Service Account mediante `crypto.createPrivateKey()` antes de instanciar el cliente JWT.

---

## 🛡️ 8. Seguridad, CSRF, Rate Limiting, Administración y Políticas de Modularidad (AI Rules)

### Medidas de Seguridad Integradas
1. **Protección CSRF (`verifySameOrigin`)**: Valida encabezados `Origin` y `Referer` en todas las mutaciones (`POST`, `PUT`, `DELETE`).
2. **Rate Limiting**: Mitigación de fuerza bruta en los endpoints `/login` y `/register`.
3. **Hashing PBKDF2 de 4 Partes**: Formato `pbkdf2:sha256:100000:salt:hash` con migración transparente automática de claves legadas.
4. **Aislamiento de Recursos Multi-Tenant**: Los endpoints de tareas y materiales validan que el `project_id` pertenezca al `user_id` de la sesión.

### Herramientas de Administración en Modal de Configuración
- **Cambio de Contraseña Seguro**: Sección colapsable que valida la contraseña actual antes de actualizar el hash PBKDF2.
- **Creación de Backup Manual (WAL)**: Botón que ejecuta un checkpoint de SQLite y genera un respaldo íntegro de la base de datos descargable.

### 📐 Políticas de Modularidad y Calidad de Código (AI Rules)
Para prevenir la degradación arquitectónica, mitigar la complejidad cognitiva y asegurar mantenibilidad a largo plazo:
- **🟢 Límite Óptimo por Módulo / Archivo**: **< 200 - 250 líneas**.
- **⚠️ Zona Amarilla (Alerta de Crecimiento)**: **250 a 400 líneas** (requiere evaluación de partición funcional).
- **🚨 Zona Roja (Máximo Absoluto)**: **> 400 líneas** (**0 archivos permitidos en el proyecto**).
- **Patrón Repositorio / Controlador / Fachada**: Toda lógica de base de datos se encapsula en `src/db/repositories/`, los controladores en `src/controllers/`, las rutas en `src/routes/` y las integraciones complejas utilizan fachadas desacopladas con retrocompatibilidad.
- **Auditoría Automatizada**: Verificación obligatoria mediante `npm run check:lines` (`scripts/check-lines.js`).

---

## 🎨 9. Frontend, UI, Modos de Navegación, Componentes y Patrón AJAX

### 3 Modos de Navegación de Primer Nivel (Header)
1. **Planificación**: Estructura de 3 paneles (Rail de accesos directos, Lienzo central de calendario proporcional y Horizonte Climático multi-día).
2. **Taller (Modo Enfoque & Banco de Trabajo)**: Vista de ejecución y banco técnico que integra el checklist interactivo del día, widget de cuenta regresiva de curado y la **Suite de 5 Herramientas Técnicas de Banco de Trabajo** (Offsets, Tornillos/Huincha corrida, Escuadra/Diagonales, Centrador/Tiradores y Visor 3D con Three.js).
3. **Inventario**: Control de inventario unificado en dos pestañas:
   - **Materiales e Insumos** (`Por Comprar` / `En Taller` por proyecto).
   - **Herramientas y Accesorios** (`Por Comprar` / `En Taller`).

### 🆕 Suite de Herramientas de Banco de Trabajo (Modo Taller)
El **Modo Taller** está concebido como una estación de trabajo digital para el banco de carpintería y ebanistería. Se diseñó bajo una estricta **regla de Cero Emojis** en la interfaz operacional, empleando iconografía técnica SVG, tipografía monospace de alta legibilidad técnica (`font-mono`) y navegación ergonómica dual adaptada al entorno físico del taller:

- **Navegación Dual Adaptativa**:
  - **Desktop / Tablet (`md:` >= 768px)**: Rail lateral vertical (`_workshop_left_rail.ejs` / `workshopRail.js`) fijado a la izquierda con tooltips direccionales, selección activa en tonos latón cálido (`text-brass`, `bg-brass`) y transiciones reactivas instantáneas.
  - **Mobile (< 768px)**: Barra de navegación inferior flotante (`_workshop_bottom_nav.ejs`) optimizada para manipulación con una sola mano y feedback táctil de 44px.

- **Las 5 Herramientas de Banco Implementadas**:
  1. **Offsets & Medidas de Corte (`_tool_offsets.ejs` / `offsetsCalc.js`)**:
     - *Propósito*: Cálculo exacto de cortes para cajones, rebajes, ranuras, holguras de correderas telescópicas (ej. $12.7\,\text{mm} \times 2$), ingletes y solapes de puertas con desglose de medidas interiores y exteriores en milímetros.
  2. **Tornillos & Fijaciones con Huincha Corrida (`_tool_screws.ejs` / `screwsCalc.js`)**:
     - *Propósito*: Reparto equidistante de fijaciones a lo largo de un canto o bastidor según longitud total, margen inicial/final y cantidad de tornillos o espaciado máximo.
     - *Innovación*: Genera la **Tira de Marcas de Medición Continua (Huincha Corrida desde el Cero)**, permitiendo al carpintero extender la cinta métrica una sola vez y marcar todos los puntos acumulados (`120 mm`, `260 mm`, `400 mm`...) sin sumar cotas mentalmente ni arrastrar errores de tolerancia. Incluye botón de copiado rápido de marcas al portapapeles.
  3. **Escuadra & Diagonales (`_tool_diagonals.ejs` / `diagonalsCalc.js` / `diagonalsSvg.js`)**:
     - *Propósito*: Verificación milimétrica de cuadratura en muebles y bastidores mediante el teorema de Pitágoras ($D = \sqrt{W^2 + H^2}$) y método del triángulo de escuadra 3-4-5 ($600-800-1000\,\text{mm}$).
     - *Innovación*: Admite la entrada de diagonales reales medidas ($D_1$ y $D_2$), diagnostica la desviación de paralelogramo con semáforo técnico de tolerancia ($0\,\text{mm}$: Perfecto, $\le 1\,\text{mm}$: Aceptable, $> 1\,\text{mm}$: Descuadrado) y renderiza un **Diagrama Vectorial SVG Reactivo** que exagera visualmente la inclinación hacia el lado largo indicando exactamente hacia dónde corregir o prensar el ensamble.
  4. **Centrador & Reparto de Luces / Tiradores (`_tool_centering.ejs` / `centeringCalc.js` / `centeringSvg.js`)**:
     - *Propósito*: Resolución de dos desafíos críticos de ebanistería:
       - **Reparto de Barrotes / Celosías**: Calcula la luz exacta entre piezas $\text{Luz} = \frac{W - N \cdot S_w}{N + 1}$, verificando el total de madera y generando la tira de marcas de huincha corrida `[Inicio ➔ Fin]` y `(Centros)`.
       - **Centrado de Tiradores & Herrajes**: Admite dimensiones de frente ($W \times H$) y centros de perforación ($CC$: presets de punto único, 96, 128, 160, 192 mm). Entrega márgenes simétricos exactos $M_x = (W - CC)/2$, distancia de gramil desde el canto $M_y = H/2$ y marcas de perforación acotadas.
     - *Innovación*: Diagrama SVG reactivo acotado con líneas de cota técnicas, flechas de ingeniería y representación gráfica a escala de barrotes y siluetas de tiradores.
  5. **Visor 3D de Proyecto (`_tool_viewer_3d.ejs` / `viewer3dCore.js` / `viewer3dLoader.js` / `viewer3dController.js`)**:
     - *Propósito*: Inspección espacial interactiva de despieces y ensambles 3D del proyecto cargados directamente en el navegador mediante **Three.js** (WebGL).
     - *Características*: Carga de archivos `.glb`, `.gltf` y `.obj` por arrastrar y soltar (drag & drop) o selección de archivo, persistencia en servidor en `data/models/user_{id}_latest.glb`, renderizado PBR con iluminación de estudio, sombras suaves en suelo, bounding box con dimensiones acotadas en milímetros ($X \times Y \times Z$), modos de visualización (Sólido, Wireframe, Rayos X), botones de vistas ortogonales (Frente, Superior, Isométrica, Reset) y soporte completo para pantalla completa en el taller.

### 🆕 Rediseño de la Vista de Planificación y Experiencia Operacional
Durante la última iteración de diseño, la vista de Planificación fue modernizada para maximizar la legibilidad visual y el control en el taller:

- **Lienzo de Calendario Continuo y Proporcional**: Las tareas ya no se presentan como listas de texto estáticas; ahora se posicionan y dimensionan en bloques temporales de altura exacta proporcional a su duración (44px por hora), con una hora de margen atenuada previa y posterior a la jornada operativa configurada.
- **Auditoría Climática Horaria Granular**: Se reemplazó la antigua línea divisoria fija de lluvia por un indicador vertical continuo en cada ranura horaria del grid, señalizando con precisión de color el estado ambiental (verde: apto; celeste: advertencia por humedad elevada; rojo: precipitación o corte).
- **Protección Climática Integral de Fases (Setup y Teardown)**: El motor de agendamiento evalúa y garantiza que ni la preparación del taller (setup) ni el guardado de herramientas (teardown) se programen bajo lluvia o humedad crítica.
- **Identidad Visual por Proyecto**: Cada bloque de trabajo muestra un indicador de color (punto de acento) vinculado a su proyecto, reduciendo la saturación de texto redundante en la agenda.
- **Panel Deslizante Unificado (Backlog / Proyectos / Historial)**: El backlog actúa como un cajón lateral que empuja fluidamente la agenda sin taparla. Su navegación se centraliza desde el rail izquierdo (y bottom nav en mobile), cerrándose cómodamente vía botón directo, clic exterior o tecla Escape.
- **Modal de Creación Rápida (`+ Nueva`)**: Acceso directo e instantáneo al formulario de nueva tarea desde el rail o la barra móvil en la capa superior (`z-[200]`), sin depender de abrir previamente el backlog.
- **Consistencia de Estados del Día**: Homogeneización total de etiquetas e indicadores entre la agenda central y el rail de horizonte (*Viable, Disponible, Suspendido, Concluida, Bloqueado*).
- **Experiencia Responsive Mobile Optimizada**:
  - En pantallas `< 768px`, el rail izquierdo se oculta automáticamente para maximizar el espacio útil de trabajo.
  - Se introduce una **Barra de Navegación Inferior Fija (Bottom Nav)** con 4 accesos directos táctiles (`+ Nueva`, `Backlog`, `Proyectos`, `Historial`).
  - El rail derecho de días se transforma en una **Tira Horizontal Deslizable** de píldoras compactas e interactivas con indicador de viabilidad por color.

### Componentes Modulares de la Interfaz
- **Modal de Nueva Tarea e Importación (`task_modal.ejs`)**: Formulario flotante en capa superior (`z-[200]`) con selector de proyectos, cálculo de curado y autocompletado inteligente desde el historial de tareas.
- **Barra de Navegación Móvil (`bottom_nav.ejs`)**: Menú inferior fijo para dispositivos móviles con contadores en tiempo real.
- **Modal de Configuración Reorganizado (`settings_modal.ejs`)**: Navegación por pestañas (*Ubicación, Jornada y Clima, Notificaciones, Integraciones, Seguridad*) con selectores dobles de Horas y Minutos para Setup, Teardown y Trabajo Mínimo, sincronizados bidireccionalmente con decimales.
- **Widget de Cuenta Regresiva de Curado (`curing_countdown_widget.ejs`)**: Timer en tiempo real con barra de progreso circular para piezas en proceso de secado pasivo.
- **Calculadora de Taller (`workshop_calculator.ejs`)**: Herramienta de conversión para carpintería (cálculo de pies tablares, mezclas de resina epoxi ratio 2:1 / 3:1 y rendimiento de adhesivos PVA).

### Patrón AJAX Obligatorio (Sin `location.reload()`)
> ⚠️ **CONVENCIÓN DE DESARROLLO**: Todo formulario, modal o acción interactiva en el frontend **DEBE** ejecutarse mediante peticiones asíncronas `fetch()` (AJAX) y actualizar puntualmente el DOM. Está **estrictamente prohibido** utilizar envíos de `<form>` tradicionales que recarguen la página o invocar `location.reload()`.

---

## 🧪 10. Suite de Pruebas Automatizadas y Aseguramiento de Calidad (Vitest)

El proyecto cuenta con una exhaustiva suite de pruebas unitarias y de integración sobre **Vitest**:

- **17 suites de prueba** (`tests/*.test.ts`).
- **136 tests pasando al 100%** en verde (0 fallos, 0 regresiones).

### Cobertura Completa de Suites

| Suite de Prueba | Archivo | Responsabilidad y Casos Clave |
| :--- | :--- | :--- |
| **Alert Scenarios** | `tests/alertScenarios.test.ts` | Escenarios de lluvia, ráfagas, avisos de humedad y adelanto de hora (`last_rain_alert_hour`). |
| **Notification Dispatcher** | `tests/notificationDispatcher.test.ts` | Pruebas unitarias de los 4 tiers de notificación, formateo de mensajes y persistencia. |
| **Evaluator & Climate Boundaries** | `tests/evaluator.test.ts` | 46 pruebas: umbrales climáticos, epoxi, curado pasivo, tareas finales, precedencia de `day_overrides` y tipos de taller. |
| **FSM Domain Services** | `tests/fsm.test.ts` | Máquinas de estado finito de tareas (`TaskService`) y días (`DayService`). |
| **Curing & Admin** | `tests/curingAndAdmin.test.ts` | Curado no vinculante en paralelo (`curing_is_blocking = false`) y credenciales admin seguras. |
| **Concurrency Locks** | `tests/concurrency.test.ts` | Locks en memoria, timeouts de 2 min y reevaluación silenciosa sin colisiones. |
| **Agenda Reevaluation Flow** | `tests/agendaReevaluationFlow.test.ts` | Disparo reactivo de re-evaluación al mutar backlog o materiales. |
| **Activate to Backlog** | `tests/activateToBacklog.test.ts` | Restauración de tareas con reseteo de ciclo de vida completo. |
| **End Shift Edge Cases** | `tests/endShiftEdgeCases.test.ts` | Manejo de fin de turno con Telegram no disponible y resolución web idempotente. |
| **Local Date** | `tests/localDate.test.ts` | Aritmética de fechas inmutables con anclaje al mediodía UTC (`LocalDate`). |
| **Multi-Tenant Validation** | `tests/validation.test.ts` | Esquemas Zod y prevención de cruce de proyectos/materiales entre usuarios. |
| **Tools to Buy** | `tests/toolsToBuy.test.ts` | Gestión de herramientas, reporte consolidado y filtros `to_buy` / `in_stock`. |
| **Materials Flow** | `tests/materialsFlow.test.ts` | Ciclo de vida de insumos, cálculo de estado y reactividad en la agenda. |
| **Weather Cache** | `tests/weatherCache.test.ts` | TTL en memoria (15-30 min) y reutilización de snapshots meteorológicos. |
| **Telegram Callback Determinism** | `tests/telegramCallbackDeterminism.test.ts` | Determinismo de callbacks interactivos de Telegram, parseo de acciones, transiciones FSM y respuestas idempotentes. |
| **Workshop 3D Model API** | `tests/workshop3dModel.test.ts` | Ciclo de vida completo del modelo 3D (consulta de estado, subida de binarios `.glb`, validación de formatos, eliminación y descarga). |
| **Responsive UI & Mobile Design** | `tests/responsiveUi.test.ts` | Verificación de contratos de diseño responsive: viewport, navegación móvil fija inferior, tira horizontal táctil de días, modales con contención vertical y visor 3D adaptable. |

---

## ⚙️ 11. Operaciones, Despliegue en Producción y Comandos de Diagnóstico

### Comando de Despliegue en Docker
```bash
# Construcción e inicio del contenedor en puerto 3000 con volumen persistente
docker build -t workshop-os .
docker run -d -p 3000:3000 --name workshop-app -v $(pwd)/data:/app/data workshop-os
```

> ⚠️ **ADVERTENCIA CRÍTICA**: No desplegar ni reiniciar el contenedor en la ventana horaria cercana al check-in nocturno (`checkin_hour`, ej. 18:55 - 19:05 hrs) para evitar interrumpir las notificaciones y locks en ejecución.

### Comandos de Diagnóstico Útiles en Producción (CLI `node -e`)
Dado que el contenedor de producción no incluye el binario CLI `sqlite3`, cualquier inspección directa se realiza con `node -e`:

```bash
# 1. Inspeccionar columnas de daily_logs:
node -e "const db = require('better-sqlite3')('./data/workshop.db'); console.log(db.prepare('PRAGMA table_info(daily_logs)').all());"

# 2. Ver logs diarios recientes:
node -e "const db = require('better-sqlite3')('./data/workshop.db'); console.log(db.prepare('SELECT eval_date, status, window_start, window_end, telegram_notified, checkin_sent, checkin_resolved, last_rain_alert_hour FROM daily_logs ORDER BY eval_date DESC LIMIT 5').all());"

# 3. Ver configuración del usuario #1:
node -e "const db = require('better-sqlite3')('./data/workshop.db'); console.log(db.prepare('SELECT user_id, timezone, operational_start_hour, operational_end_hour, checkin_hour, telegram_chat_id FROM app_settings WHERE user_id = 1').all());"

# 4. Filtrar logs de la aplicación en Docker:
docker logs workshop-app 2>&1 | grep -iE "scheduler|weather|calendar|notification" | tail -n 50
```

---

## 📜 12. Historial de Incidentes Conocidos y Lecciones Aprendidas

1. **Formularios Anidados Rompiendo Submits Silenciosamente**:
   - *Causa*: `<form>` declarados dentro de otros formularios HTML en plantillas EJS ignoraban clics en botones internos.
   - *Lección*: Mantener modales y formularios desacoplados fuera del árbol DOM y usar exclusivamente el patrón AJAX.
2. **Cálculos Erróneos entre UTC y Hora Local**:
   - *Causa*: El uso de `new Date().toISOString()` interpretaba la hora en UTC (UTC-3/UTC-4 en Chile), disparando check-ins nocturnos a las 15:00 hrs locales.
   - *Lección*: Toda lógica horaria se calcula a través de `src/dateUtils.ts` (`getLocalDateIso`, `getLocalHoursAndMinutes`) usando la zona horaria IANA calculada.
3. **Lock de Concurrencia Bloqueado por Promesas Colgadas**:
   - *Causa*: Peticiones salientes a Open-Meteo o Telegram sin timeout dejaban locks tomados indefinidamente.
   - *Lección*: Toda petición saliente tiene `AbortSignal.timeout()` y el gestor de locks incluye liberación forzosa a los 2 minutos.
4. **Sobreescrituras Manuales (`day_overrides`) Ignoradas en Fines de Semana**:
   - *Causa*: El evaluador comprobaba `exclude_sundays` antes de consultar `day_overrides`.
   - *Lección*: Las sobreescrituras manuales tienen precedencia absoluta y se evalúan antes que las reglas de exclusión por defecto.
5. **Bug de "Al Backlog" con Confirmación Falsa de Éxito**:
   - *Causa*: Se marcaba `is_active = 1` sin resetear `status = 'pending'` ni limpiar `completed_at`.
   - *Lección*: Reactivar una tarea resetea su ciclo de vida completo (`status`, `progress_percentage`, `completed_at`) y dispara una re-evaluación silenciosa.
6. **Fallback Silencioso a Clima Mock Reescribiendo la Agenda**:
   - *Causa*: Ante caídas transitorias de red, el scheduler recurría a un mock "sunny", sobrescribiendo diagnósticos reales y agendando tareas en días lluviosos.
   - *Lección*: En producción no se usan mocks como fallback; se utiliza la caché en memoria o se preserva el último snapshot climático sin inventar datos.
7. **Desfase de Fecha UTC entre UI y Motor de Evaluación**:
   - *Causa*: Fechas instanciadas en medianoche UTC (`00:00:00Z`) retrocedían un día en zonas horarias occidentales.
   - *Lección*: Todas las fechas del horizonte se anclan al mediodía UTC (`T12:00:00Z`) mediante `LocalDate`.
8. **Bug de `Lluvia_Hour` y Re-Alerta por Adelanto de Lluvia**:
   - *Causa*: No se persistía la hora de la lluvia alertada previamente, por lo que si una lluvia confirmada para las 18:00 se adelantaba a las 16:00, el sistema no volvía a alertar.
   - *Lección*: Se introdujo la columna `last_rain_alert_hour` en `daily_logs` y `NotificationDispatcher` detecta adelantos para relanzar la alarma de emergencia.

---

## 📡 13. Especificación de Endpoints REST (API Reference)

### 🔐 Sistema, Autenticación y Administración
- `GET /health`: Estado del servidor y timestamp.
- `GET /manifest.json`: Manifiesto Web App (PWA).
- `GET /sw.js`: Service Worker cliente.
- `GET /.well-known/assetlinks.json`: Compatibilidad PWA/Android.
- `GET /login` / `POST /login`: Renderizado y procesamiento de login (PBKDF2 de 4 partes).
- `GET /register` / `POST /register`: Registro de usuario y configuración inicial.
- `GET /logout`: Destruye la sesión del usuario.
- `GET /api/auth/status`: Consulta el estado de la sesión activa y cambio obligatorio de clave.
- `POST /api/user/change-password`: Cambio seguro de contraseña validando la actual.
- `POST /api/admin/backup`: Generación y descarga de backup de SQLite (WAL checkpoint).

### 📁 Proyectos
- `GET /`: Dashboard principal (Planificación, Taller, Inventario).
- `POST /projects/add`: Crea un nuevo proyecto.
- `POST /projects/:id/toggle`: Alterna el estado activo/inactivo del proyecto.
- `POST /projects/:id/update`: Actualiza nombre y descripción del proyecto.

### 📋 Backlog de Tareas
- `POST /tasks/add`: Agrega una tarea al backlog del proyecto activo.
- `POST /tasks/:id/activate-to-backlog`: Restaura una tarea reseteando su ciclo de vida y reevalúa silenciosamente.
- `POST /tasks/:id/toggle-active`: Pausa o activa una tarea en el agendamiento.
- `POST /tasks/:id/update`: Edita título, categoría, horas activas y horas de curado.
- `POST /tasks/:id/update_status`: Actualiza estado (`pending`, `in_progress`, `completed`).
- `POST /tasks/:id/delete`: Elimina una tarea.
- `POST /tasks/:id/move-up` / `POST /tasks/:id/move-down`: Reordena tareas paso a paso.
- `POST /tasks/reorder`: Reordenamiento secuencial masivo mediante JSON validado con Zod.
- `POST /tasks/import`: Importación masiva de tareas en formato JSON validado con Zod.
- `GET /tasks/history` / `GET /tasks/suggestions`: Historial de títulos para autocompletado.

### 📑 Plantillas de Proyecto
- `POST /project-templates/save`: Guarda tareas activas como plantilla reutilizable.
- `POST /project-templates/:id/apply`: Aplica una plantilla al proyecto actual.
- `POST /project-templates/:id/delete`: Elimina una plantilla.

### 📦 Insumos y Materiales
- `GET /api/materials`: Obtiene materiales del usuario/proyecto.
- `POST /materials/add`: Agrega un material al inventario.
- `POST /materials/:id/toggle`: Alterna estado entre `to_buy` y `in_stock`.
- `POST /materials/:id/update`: Edita datos del material.
- `POST /materials/:id/set-status`: Fija explícitamente `to_buy` o `in_stock`.
- `POST /materials/:id/delete`: Elimina un material.
- `POST /materials/import`: Importación masiva de materiales.

### 🛠️ Herramientas
- `GET /api/tools`: Lista de herramientas del taller.
- `POST /tools/add`: Registra una nueva herramienta.
- `POST /tools/:id/update`: Edita una herramienta.
- `POST /tools/:id/set-status`: Fija estado `to_buy` o `in_stock`.
- `POST /tools/:id/delete`: Elimina una herramienta.
- `GET /api/inventory/export-context`: Exportación consolidada de inventario en JSON para IA y reportes.

### 📆 Sobreescrituras Manuales (`day_overrides`)
- `POST /day-override/:override_date/save`: Fija estado forzado (`VIABLE`/`BLOCKED`), horas personalizadas y notas.
- `POST /day-override/:override_date/clear`: Elimina sobreescritura retornando a evaluación climática automática.
- `POST /day-override/:override_date/force-task`: Fuerza una tarea a una fecha específica.
- `POST /day-override/forced-task/:forced_id/delete`: Elimina asignación forzada de tarea.

### ☀️ Evaluación Climática y Check-in
- `POST /evaluation/force_run`: Fuerza la re-evaluación del horizonte multi-día.
- `POST /evaluation/force_checkin`: Emite prompt de check-in en Telegram (pruebas/desarrollo).
- `POST /api/checkin/end_shift`: Controlador del botón "Término de la Jornada" (Telegram o modal web).
- `POST /api/checkin/resolve`: Procesa la resolución de tareas del check-in.

### ⚙️ Configuración, Telegram y Persistencia 3D
- `GET /api/timezone`: Obtiene zona horaria calculada según lat/lon.
- `POST /settings/update`: Guarda ubicación, horarios operativos, umbrales climáticos y duraciones en horas/minutos.
- `POST /settings/telegram/generate-code`: Genera código OTP de 6 dígitos para vincular bot.
- `POST /settings/telegram/unlink`: Desvincula cuenta de Telegram.
- `POST /webhook/telegram`: Webhook para mensajes y callbacks interactivos de Telegram.
- `GET /api/workshop/model3d/status`: Consulta el estado del modelo 3D del usuario (`hasModel`, `filename`, `size`, `updatedAt`).
- `GET /api/workshop/model3d/latest`: Descarga / stream del archivo binario 3D actual (`.glb`, `.gltf`, `.obj`).
- `POST /api/workshop/model3d`: Subida y almacenamiento del modelo 3D con límite de 25MB (`application/octet-stream` con `x-filename`).
- `DELETE /api/workshop/model3d`: Eliminación segura del modelo 3D persistido del usuario.

---

## 📂 14. Árbol de Archivos del Proyecto y Matriz Técnica por Archivo

```
AGENDAPP/
├── .env.example                       # Plantilla de variables de entorno (PORT=3000, TELEGRAM_BOT_TOKEN)
├── .gitignore                         # Reglas de exclusión de Git
├── AI_RULES.md                        # Directrices de arquitectura, calidad y límites de líneas
├── Dockerfile                         # Receta de construcción de contenedor Docker para producción
├── README.md                          # Documentación técnica y arquitectura (Single Source of Truth)
├── metadata.json                      # Metadatos del applet
├── package.json                       # Dependencias NPM, scripts de compilación y linter
├── tsconfig.json                      # Configuración del compilador TypeScript
├── vitest.config.ts                   # Configuración del runner de pruebas Vitest
├── server.ts                          # Servidor Express desacoplado, middleware global y montaje de rutas
├── data/                              # Directorio de persistencia SQLite
│   └── workshop.db                    # Base de datos SQLite en runtime (WAL mode)
├── scripts/                           # Herramientas de automatización y CI/CD local
│   └── check-lines.js                 # Script de auditoría de líneas y zonas de modularidad
├── src/                               # Código fuente backend en TypeScript
│   ├── LocalDate.ts                   # Value Object inmutable para aritmética de fechas (mediodía UTC)
│   ├── auth.ts                        # Autenticación, hashing PBKDF2 y firma HMAC de sesiones
│   ├── calendarService.ts             # Fachada de integración con Google Calendar API v3
│   ├── dateUtils.ts                   # Formateo de fechas y localización en zona horaria del taller
│   ├── db.ts                          # Fachada delegativa de base de datos
│   ├── evaluator.ts                   # Fachada delegativa del motor climático y evaluación
│   ├── holidaysService.ts             # Detección de feriados e irrenunciables
│   ├── notificationDispatcher.ts      # Fachada delegativa de notificaciones (Tiers 1 a 4)
│   ├── scheduler.ts                   # Fachada delegativa del daemon de fondo y concurrencia
│   ├── schemas.ts                     # Esquemas Zod para validación de cargas REST
│   ├── telegramBot.ts                 # Fachada delegativa del bot de Telegram y webhooks
│   ├── types.ts                       # Interfaces TypeScript, modelos y enums
│   ├── weatherService.ts              # Ingesta de pronósticos meteorológicos de Open-Meteo
│   ├── calendar/                      # Dominio de sincronización con Google Calendar
│   │   ├── client.ts                  # Autenticación JWT y cliente API v3
│   │   ├── cryptoUtils.ts             # Sanitización y validación de claves PEM RSA
│   │   ├── eventFormatter.ts          # Construcción de payloads para Google Calendar
│   │   ├── orphanManager.ts           # Limpieza y eliminación de eventos obsoletos
│   │   └── syncService.ts             # Orquestación de sincronización espejo
│   ├── climate/                       # Motor meteorológico y reglas ambientales
│   │   ├── audit.ts                   # Fachada de auditoría climática horaria
│   │   ├── barSegmentsCalculator.ts   # Segmentación de barras horarias por condición
│   │   ├── hourlyAuditBuilder.ts      # Construcción de slots horarios y estados de riesgo
│   │   ├── metricsCalculator.ts       # Cálculo de temperatura, humedad, lluvia y ráfagas
│   │   ├── rules.ts                   # Reglas de viabilidad por categoría (epoxi, PVA, etc.)
│   │   ├── segments.ts                # Segmentación de ventanas operativas
│   │   └── weatherCutoffCalculator.ts # Detección de hora de corte por precipitaciones
│   ├── controllers/                   # Controladores REST HTTP desacoplados
│   │   ├── agendaController.ts        # Renderizado de dashboard y vistas de agenda
│   │   ├── checkinController.ts       # Gestión de fin de turno y resolución de check-in
│   │   ├── curingController.ts        # Consultas de estado de curado activo
│   │   ├── materialsController.ts     # Gestión CRUD e importación de insumos
│   │   ├── overrideController.ts      # Sobreescrituras manuales (`day_overrides`)
│   │   ├── taskController.ts          # Gestión CRUD, activación y reordenamiento de tareas
│   │   ├── toolsController.ts         # Gestión CRUD e inventario de herramientas
│   │   └── workshopModelController.ts # Control de subida, streaming y estado de modelo 3D
│   ├── db/                            # Capa de persistencia SQLite y repositorios
│   │   ├── connection.ts              # Instancia singleton Better-SQLite3 y WAL mode
│   │   ├── helpers.ts                 # Funciones auxiliares de mapeo y serialización SQL
│   │   ├── index.ts                   # Exportación unificada de la capa de datos
│   │   ├── migrations.ts              # Migraciones idempotentes condicionales de esquema
│   │   ├── schema.ts                  # Definición DDL de tablas e índices
│   │   ├── seeds.ts                   # Semillas iniciales para arranque del sistema
│   │   ├── store.ts                   # Fachada delegada del DAO (`store`)
│   │   └── repositories/              # Repositorios especializados por entidad (SRP)
│   │       ├── backupRepo.ts          # Generación de checkpoints WAL y volcados
│   │       ├── calculatorRepo.ts      # Persistencia de cálculos de carpintería
│   │       ├── curingRepo.ts          # Consultas de curado pasivo y timers
│   │       ├── dailyLogRepo.ts        # Bitácora diaria y trazabilidad de alertas
│   │       ├── dayOverrideRepo.ts     # CRUD de sobreescrituras de fecha y tareas forzadas
│   │       ├── inventoryRepo.ts       # CRUD de materiales, herramientas y stock
│   │       ├── projectRepo.ts         # CRUD de proyectos y plantillas
│   │       ├── settingsRepo.ts        # Preferencias de usuario, horarios y umbrales
│   │       ├── taskRepo.ts            # CRUD de tareas, orden y estados
│   │       └── userRepo.ts            # Autenticación, usuarios y credenciales
│   ├── notifications/                 # Módulo de notificaciones operacionales
│   │   ├── checkinNotifier.ts         # Despacho de prompts de check-in nocturno
│   │   ├── markdownUtils.ts           # Formateo y escape MarkdownV2 para Telegram
│   │   ├── targetChat.ts              # Resolución y validación de chat_id destinatario
│   │   ├── weatherAlertNotifier.ts    # Alertas intradía por lluvia y ráfagas críticas
│   │   └── workStartNotifier.ts       # Notificación matutina de inicio de jornada
│   ├── routes/                        # Enrutadores Express modulares
│   │   ├── agendaRoutes.ts            # Rutas de agenda, evaluación y check-in
│   │   ├── authRoutes.ts              # Rutas de login, registro y sesiones
│   │   ├── inventoryRoutes.ts         # Rutas de materiales, insumos y herramientas
│   │   ├── projectRoutes.ts           # Rutas de proyectos y plantillas
│   │   ├── publicRoutes.ts            # Rutas públicas (health, PWA manifest, SW)
│   │   ├── settingsRoutes.ts          # Rutas de configuración y vinculación Telegram
│   │   └── taskRoutes.ts              # Rutas de manipulación de tareas del backlog
│   ├── scheduler/                     # Daemon de ejecución periódica y concurrencia
│   │   ├── calendarReconciler.ts      # Reconciliación con Google Calendar
│   │   ├── daemon.ts                  # Bucle principal y temporizadores periódicos
│   │   ├── dayEvaluatorStep.ts        # Paso de evaluación individual por día
│   │   ├── forecastLoader.ts          # Carga y caché de pronósticos meteorológicos
│   │   ├── horizonRunner.ts           # Ejecución de evaluación multi-día
│   │   └── locks.ts                   # Gestor de locks en memoria con timeout
│   ├── scheduling/                    # Orquestador del empaquetado de agenda
│   │   ├── curingValidator.ts         # Validación de secuencias y colisiones de curado
│   │   ├── diagnostics.ts             # Generación de diagnósticos de viabilidad
│   │   ├── orchestrator.ts            # Fachada de orquestación de agenda
│   │   ├── packageSelection.ts        # Selección óptima de tareas para la jornada
│   │   ├── preconditions.ts           # Verificación de condiciones previas operativas
│   │   ├── timeline.ts                # Modelado de bloques temporales
│   │   ├── timelineAssembler.ts       # Ensamblado del timeline proporcional y acentos
│   │   └── windowPacker.ts            # Empaquetado de ventanas de trabajo activo
│   ├── services/                      # Servicios de dominio de máquinas de estado
│   │   ├── dayService.ts              # FSM de días operativos y transiciones de estado
│   │   └── taskService.ts             # FSM de tareas y control de ciclo de vida
│   └── telegram/                      # Integración interactiva con Telegram Bot API
│       ├── apiClient.ts               # Cliente HTTP tipado para Telegram Bot API
│       ├── callbackHandlers.ts        # Manejadores de callbacks de botones inline
│       ├── callbackParser.ts          # Parseo seguro de payloads de callbacks
│       ├── commandHandlers.ts         # Manejo de comandos (`/start`, `/agenda`, etc.)
│       ├── keyboards.ts               # Fábrica de teclados inline interactivos
│       ├── notifications.ts           # Envío de mensajes estructurados
│       ├── pollingEngine.ts           # Motor de long-polling y webhooks
│       └── state.ts                   # Estado en memoria de conversaciones OTP
├── static/                            # Archivos estáticos del frontend
│   ├── manifest.json                  # Manifiesto Web App (PWA)
│   ├── sw.js                          # Service Worker para capacidades offline
│   ├── css/
│   │   └── main.css                   # Reglas CSS de Tailwind e interfaz
│   ├── icons/                         # Iconos PWA y recursos visuales
│   └── js/                            # JavaScript modular del cliente (ES Modules / AJAX)
│       ├── agenda.js                  # Lógica del cliente para línea de tiempo y auditoría
│       ├── backlog.js                 # Fachada del drawer de backlog y tabs
│       ├── map.js                     # Selector interactivo de coordenadas (Leaflet)
│       ├── settings.js                # Fachada del modal de configuración
│       ├── utils.js                   # Notificaciones toast y helpers DOM
│       ├── backlog/                   # Submódulos del backlog
│       │   ├── dragDrop.js            # Lógica de arrastrar y soltar tareas
│       │   ├── projectTemplates.js    # Gestión y aplicación de plantillas
│       │   ├── taskActions.js         # Acciones CRUD y cambios de estado de tareas
│       │   ├── taskImport.js          # Importación masiva de tareas en JSON
│       │   └── taskModal.js           # Control del modal superior de creación
│       ├── settings/                  # Submódulos de configuración
│       │   ├── formHandler.js         # Serialización y guardado reactivo de ajustes
│       │   ├── securityBackup.js      # Cambio de contraseña y descarga de backups
│       │   ├── tabsModal.js           # Navegación por pestañas y sincronización H/M
│       │   └── telegramIntegrations.js # Generación de código OTP y vinculación
│       └── workshop/                  # Submódulos de Modo Taller (Herramientas de Banco)
│           ├── centeringCalc.js       # Cálculo de celosías, barrotes y centros de tiradores
│           ├── centeringSvg.js        # Diagramas SVG acotados para centrado y barrotes
│           ├── diagonalsCalc.js       # Cálculo de escuadra (Pitágoras / 3-4-5) y tolerancias
│           ├── diagonalsSvg.js        # Diagrama SVG reactivo con deformación por escuadra
│           ├── offsetsCalc.js         # Calculadora de rebajes, ranuras y holguras
│           ├── screwsCalc.js          # Reparto de fijaciones y marcas de huincha corrida
│           ├── viewer3dController.js  # Control de interfaz, HUD y eventos del visor 3D
│           ├── viewer3dCore.js        # Motor Three.js, escena, cámara, luces y renderizado
│           ├── viewer3dLoader.js      # Parser y cargador de archivos GLB/GLTF/OBJ
│           └── workshopRail.js        # Navegación reactiva entre herramientas de banco
├── tests/                             # Suite de pruebas automatizadas (17 suites, 136 tests)
│   ├── activateToBacklog.test.ts      # Reactivación de tareas y ciclo de vida limpio
│   ├── agendaReevaluationFlow.test.ts # Re-evaluación reactiva al mutar tareas o materiales
│   ├── alertScenarios.test.ts         # Escenarios de lluvia, ráfagas y adelanto de hora
│   ├── concurrency.test.ts            # Locks de concurrencia y timeouts de liberación
│   ├── curingAndAdmin.test.ts         # Curado en paralelo y permisos de administrador
│   ├── endShiftEdgeCases.test.ts      # Fin de turno con Telegram offline y modal fallback
│   ├── evaluator.test.ts              # Pruebas del motor evaluador y umbrales climáticos
│   ├── fsm.test.ts                    # Pruebas de máquinas de estado de tareas y días
│   ├── localDate.test.ts              # Pruebas unitarias de LocalDate
│   ├── materialsFlow.test.ts          # Pruebas de flujo reactivo de materiales
│   ├── notificationDispatcher.test.ts # Pruebas directas de los tiers de notificación
│   ├── responsiveUi.test.ts           # Pruebas de contratos de diseño responsive y UI móvil
│   ├── telegramCallbackDeterminism.test.ts # Determinismo de callbacks interactivos de Telegram
│   ├── toolsToBuy.test.ts             # Herramientas por comprar y filtros de taller
│   ├── validation.test.ts             # Validación con Zod y multi-tenant isolation
│   ├── weatherCache.test.ts           # Cache de pronóstico meteorológico
│   └── workshop3dModel.test.ts        # API y persistencia de modelos 3D (.glb)
└── views/                             # Plantillas de renderizado EJS modulares
    ├── index.ejs                      # Vista principal del Dashboard (contenedor limpio)
    ├── login.ejs                      # Vista de inicio de sesión
    ├── register.ejs                   # Vista de registro de usuario
    ├── components/                    # Componentes EJS modulares y sub-partials
    │   ├── agenda.ejs                 # Fachada del lienzo central de calendario
    │   ├── backlog.ejs                # Fachada del drawer de backlog
    │   ├── bottom_nav.ejs             # Barra de navegación fija inferior para mobile
    │   ├── curing_countdown_widget.ejs # Widget de cuenta regresiva de curado en vivo
    │   ├── left_rail.ejs              # Rail vertical de accesos rápidos (Desktop)
    │   ├── materials.ejs              # Fachada del módulo de inventario
    │   ├── mode_switcher.ejs          # Selector de modo (Planificación, Taller, Inventario)
    │   ├── right_rail.ejs             # Rail de Horizonte Climático multi-día
    │   ├── settings_modal.ejs         # Fachada del modal de configuración
    │   ├── task_modal.ejs             # Modal superior de creación de tareas
    │   ├── workshop_calculator.ejs    # Contenedor maestro modular de herramientas de taller
    │   ├── agenda/                    # Sub-partials de la agenda
    │   │   ├── _calendar_grid.ejs     # Grid de bloques horarios proporcionales
    │   │   ├── _card_header.ejs       # Cabecera de estado, clima y acciones del día
    │   │   ├── _day_editor_modal.ejs  # Modal de sobreescritura manual (`day_overrides`)
    │   │   ├── _forced_tasks.ejs      # Asignación y gestión de tareas forzadas
    │   │   ├── _grid_tasks_col.ejs    # Columna de renderizado de tareas activas
    │   │   ├── _grid_weather_col.ejs  # Columna de auditoría climática horaria
    │   │   └── _hourly_modal.ejs      # Modal de detalle meteorológico horario
    │   ├── backlog/                   # Sub-partials del backlog
    │   │   ├── _tab_backlog.ejs       # Pestaña de lista de tareas activas del backlog
    │   │   ├── _tab_history.ejs       # Pestaña de historial de tareas completadas
    │   │   └── _tab_projects.ejs      # Pestaña de proyectos y plantillas
    │   ├── materials/                 # Sub-partials de inventario y compras
    │   │   ├── _export_modal.ejs      # Modal de exportación de inventario para IA
    │   │   ├── _header_tabs.ejs       # Selector de pestañas Materiales / Herramientas
    │   │   ├── _material_modals.ejs   # Modales de creación y edición de materiales
    │   │   ├── _materials_table.ejs   # Tabla de insumos `Por Comprar` y `En Taller`
    │   │   ├── _scripts_export_gen.ejs # Generador de JSON para exportación
    │   │   ├── _scripts_export_ui.ejs # Interfaz interactiva de exportación
    │   │   ├── _scripts_forms_material.ejs # Manejador de formularios de materiales
    │   │   ├── _scripts_forms_tool.ejs # Manejador de formularios de herramientas
    │   │   ├── _scripts_state.ejs     # Estado reactivo del inventario
    │   │   ├── _shopping_summary.ejs  # Resumen de insumos pendientes de compra
    │   │   ├── _tool_modals.ejs       # Modales de creación y edición de herramientas
    │   │   └── _tools_table.ejs       # Tabla de herramientas `Por Comprar` y `En Stock`
    │   ├── settings/                  # Sub-partials del modal de configuración
    │   │   ├── _tab_climate.ejs       # Pestaña de umbrales climáticos y resinas
    │   │   ├── _tab_integrations.ejs  # Pestaña de integración con Google Calendar
    │   │   ├── _tab_location.ejs      # Pestaña de mapa Leaflet, coordenadas y huso
    │   │   ├── _tab_operational.ejs   # Pestaña de horarios operativos y tipo de taller
    │   │   ├── _tab_security_backup.ejs # Pestaña de cambio de clave y backup SQLite
    │   │   └── _tab_telegram.ejs      # Pestaña de vinculación OTP con Telegram Bot
    │   └── workshop/                  # Sub-partials de herramientas de banco de taller
    │       ├── _tool_centering.ejs    # Centrador de tiradores y reparto de barrotes
    │       ├── _tool_diagonals.ejs    # Comprobador de escuadra y diagonales con SVG
    │       ├── _tool_offsets.ejs      # Calculadora de rebajes, ranuras y holguras
    │       ├── _tool_screws.ejs       # Reparto de fijaciones y marcas de huincha corrida
    │       ├── _tool_viewer_3d.ejs    # Visor 3D interactivo Three.js (GLB/GLTF/OBJ)
    │       ├── _workshop_bottom_nav.ejs # Barra de navegación inferior móvil para taller
    │       └── _workshop_left_rail.ejs # Rail lateral de herramientas de banco (Desktop)
    └── partials/                      # Partials globales del layout
        ├── _client_scripts.ejs        # Scripts de inicialización global del cliente
        ├── _end_shift_modals.ejs      # Modales de término de jornada y fallback web
        ├── _eval_feedback_modal.ejs   # Modal de retroalimentación de evaluación
        └── _svg_icons.ejs             # Sprite centralizado de iconos SVG del sistema
```

### Matriz Técnica por Módulo y Capa Arquitectónica

| Capa / Módulo | Archivos Principales | Responsabilidad Técnica | Dependencias Clave |
| :--- | :--- | :--- | :--- |
| **HTTP & Routing** | `server.ts`, `src/routes/*` | Enrutamiento HTTP desacoplado, middleware de seguridad, rate limiting y CSRF. | `express`, `src/routes/*`, `src/auth.ts` |
| **Controladores REST** | `src/controllers/*` | Procesamiento de peticiones, validación Zod, respuestas JSON y renderizado EJS. | `src/db/`, `src/services/*`, `src/scheduler/` |
| **Persistencia & Repositorios** | `src/db/repositories/*`, `src/db/connection.ts` | Acceso a datos relacionales SQLite en modo WAL y consultas tipadas por dominio. | `better-sqlite3`, `src/types.ts` |
| **Motor Climático** | `src/climate/*`, `src/evaluator.ts` | Evaluación de umbrales ambientales, auditoría horaria y segmentación de jornada. | `src/types.ts`, `src/LocalDate.ts` |
| **Orquestador de Agenda** | `src/scheduling/*` | Empaquetado de tareas, validación de curado pasivo y timeline proporcional. | `src/climate/`, `src/types.ts` |
| **Daemon & Scheduler** | `src/scheduler/*`, `src/scheduler.ts` | Ciclo de vida periódico, evaluación multi-día, locks de concurrencia y caché. | `src/climate/`, `src/db/`, `src/calendar/` |
| **Notificaciones Operacionales** | `src/notifications/*`, `src/notificationDispatcher.ts` | Formateo MarkdownV2, despacho de Tiers 1-4, alertas de lluvia y check-in nocturno. | `src/telegram/`, `src/db/repositories/` |
| **Telegram Bot API** | `src/telegram/*`, `src/telegramBot.ts` | Long-polling, webhooks, manejo determinista de callbacks FSM y teclados inline. | HTTP Fetch API, `src/db/` |
| **Google Calendar Sync** | `src/calendar/*`, `src/calendarService.ts` | Sincronización espejo bidireccional, validación PEM RSA y eliminación de huérfanos. | `googleapis`, Node `crypto`, `src/db/` |
| **Servicios de Dominio FSM** | `src/services/*` | Máquinas de estado finito de tareas y días con transiciones idempotentes. | `src/db/repositories/`, `src/types.ts` |
| **Vistas EJS Modulares** | `views/index.ejs`, `views/components/**/*` | Interfaz reactiva dividida en sub-partials especializados (< 180 líneas por archivo). | EJS Engine, Tailwind CSS |
| **Cliente JavaScript** | `static/js/**/*` | Lógica cliente modularizada (ES Modules), manipulación DOM y llamadas AJAX fetch. | Vanilla JS, Leaflet |

---

## 💡 15. Sugerencias y Roadmap para Futuras Iteraciones

Para continuar fortaleciendo la plataforma en futuras versiones, se sugieren las siguientes mejoras arquitectónicas y funcionales:

1. **Notificaciones Push Web (Web Push API / Service Worker)**:
   - Añadir soporte nativo de notificaciones push en el navegador mediante el Service Worker ya existente (`sw.js`).
   - Permitiría recibir las alertas críticas de lluvia o el prompt de check-in directamente en la pantalla de la tablet o laptop del taller, incluso si el operario no tiene Telegram abierto.
2. **Cálculo de Costo Real por Proyecto e Insumos**:
   - Agregar campos de `costo_unitario` y `moneda` en la tabla `materials` y `tools`.
   - Permitiría al taller conocer el costo acumulado de materiales e insumos utilizados por proyecto al momento de completarlo.
3. **Módulo de Registro Fotográfico de Avances**:
   - Permitir adjuntar fotos del estado de avance durante el check-in (vía Telegram enviando la foto con la confirmación de la tarea o subiéndola en la interfaz web).
   - Generaría un histórico visual del proyecto útil para control de calidad y reportes a clientes.
4. **Soporte de Estaciones Meteorológicas Locales (PWS / MQTT)**:
   - Integrar un endpoint webhook/MQTT para recibir datos de sensores ambientales locales instalados en el propio taller (ej. sensor DHT22 / BME280 conectado por ESP32).
   - Complementaría el pronóstico satelital de Open-Meteo con la medición de humedad y temperatura real dentro del cobertizo de trabajo.
5. **Generador de Reportes PDF / Plan de Corte para Clientes**:
   - Crear un generador de fichas técnicas en PDF exportables con la cronología real de trabajo, materiales utilizados y fechas de curado para certificar la durabilidad de los muebles ante clientes exigentes.
