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
- **Colas PVA y Adhesivos**: Requieren temperaturas mínimas (usualmente > 10 °C) y ausencia de humedad directa durante la aplicación y el curado. Niveles de humedad relativa superiores al 80% degradan significativamente la resistencia mecánica del ensamblado.
- **Acabados, Barnices y Pinturas**: Los recubrimientos al agua o sintéticos requieren ventanas térmicas específicas y humedad controlada para evitar "velado", falta de adherencia, burbujas o fallas de secado.
- **Epoxi y Resinas**: Exigen condiciones térmicas estrictas (mínimo 15 °C) y humedad relativa < 75% tanto en la colada activa como durante sus 6 horas o más de curado continuo.
- **Herramientas Eléctricas y Madera Expuesta**: La lluvia directa o humedad crítica interrumpe el trabajo en patio, estropea la maquinaria y tuerce los tablones de madera aserrada o cepillada.

### La Solución AGENDAPP
AGENDAPP automatiza completamente la planificación del taller mediante una arquitectura **Multi-Tenant aislada**:

1. **Entorno de Ejecución Moderno**:
   - Backend escrito en **TypeScript** ejecutado sobre **Node.js 22 (Web Runtime)** con **Express 4**.
   - Renderizado server-side de vistas modulares **EJS** asistido por estilos de utilidad **Tailwind CSS**.
   - Empaquetado optimizado para producción con **`esbuild`** (`dist/server.cjs`), escuchando en el **puerto 3000**.
2. **Aislamiento Multi-Tenant y Unicidad Estricta de Chat ID**:
   - Cada usuario (`user_id`) posee un contexto completamente aislado en la base de datos: su propio backlog de tareas, proyectos, plantillas, materiales/insumos, herramientas, logs diarios, sobreescrituras manuales (`day_overrides`) y configuración operacional (`app_settings`).
   - **Garantía de Unicidad**: Cada `telegram_chat_id` está estrictamente vinculado a un único usuario activo. Si un usuario registra un Chat ID ya usado por otra cuenta, el sistema desvincula automáticamente la cuenta anterior (`telegram_chat_id = NULL`), evitando la duplicación de notificaciones o cruce de datos.
3. **Geolocalización y Cálculo Dinámico de Zona Horaria**:
   - El usuario configura la latitud y longitud exactas de su taller (mediante un mapa interactivo Leaflet/OpenStreetMap).
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
| `setup_hours` | REAL | NOT NULL DEFAULT 1.0 | Tiempo de preparación pre-jornada (horas). |
| `teardown_hours` | REAL | NOT NULL DEFAULT 1.0 | Tiempo de limpieza post-jornada (horas). |
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
   - **PREP (Setup)**: Preparación del taller (duración `setup_hours`, ej. 1.0h).
   - **TRABAJO (Trabajo Activo)**: Ejecución de tareas con herramientas y ensamblajes.
   - **CIERRE (Teardown)**: Limpieza y guardado (duración `teardown_hours`, ej. 1.0h).
   - **CURADO (Curado Pasivo)**: Secado que puede extenderse después de la jornada (hasta las 23:00 hrs).
4. **Umbrales Ambientales**:
   - **Lluvia**: Precipitación `>= min_rain_precipitation_mm` (0.2 mm) o probabilidad `>= 30%` en trabajo activo o curado pasivo bloquea el día.
   - **Humedad**: Humedad `>= max_humidity_percent` (ej. 80%) durante trabajo o curado invalida la ventana.
   - **Epoxi / Resinas**: Exige temperatura `>= 15.0 °C` y humedad `<= 75.0%` continuas.
   - **Umbral de Tarea Final (`min_work_hours_unless_final`)**: Si la jornada no alcanza `min_work_hours` estándar (ej. 4h) pero la tarea evaluada es la **última pendiente del backlog**, el motor aplica el umbral reducido (ej. 1h o 2h) para completar el proyecto sin demoras artificiales.
5. **Curado No Vinculante (`curing_is_blocking = false`)**:
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
  [ Tier 1: Matutino ] [ Tier 2: Inicio ]    [ Tier 3: Check-in ] [ Tier 4: Humedad ] [ Tier 4: Lluvia ]
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

## 🛡️ 8. Seguridad, CSRF, Rate Limiting y Administración (Backups y Contraseñas)

### Medidas de Seguridad Integradas
1. **Protección CSRF (`verifySameOrigin`)**: Valida encabezados `Origin` y `Referer` en todas las mutaciones (`POST`, `PUT`, `DELETE`).
2. **Rate Limiting**: Mitigación de fuerza bruta en los endpoints `/login` y `/register`.
3. **Hashing PBKDF2 de 4 Partes**: Formato `pbkdf2:sha256:100000:salt:hash` con migración transparente automática de claves legadas.
4. **Aislamiento de Recursos Multi-Tenant**: Los endpoints de tareas y materiales validan que el `project_id` pertenezca al `user_id` de la sesión.

### Herramientas de Administración en Modal de Configuración
- **Cambio de Contraseña Seguro**: Sección colapsable que valida la contraseña actual antes de actualizar el hash PBKDF2.
- **Creación de Backup Manual (WAL)**: Botón que ejecuta un checkpoint de SQLite y genera un respaldo íntegro de la base de datos descargable.

---

## 🎨 9. Frontend, UI, Modos de Navegación, Componentes y Patrón AJAX

### 3 Modos de Navegación de Primer Nivel
1. **Planificación**: Línea de tiempo diaria del horizonte, desglose horario auditado del clima, botón "Término de la Jornada", botón condicional "Modo Enfoque" y gestión del backlog.
2. **Taller**: Vista de ejecución directa para el trabajo diario en el espacio de trabajo.
3. **Inventario**: Control de inventario unificado en dos pestañas:
   - **Materiales e Insumos** (`Por Comprar` / `En Taller` por proyecto).
   - **Herramientas y Accesorios** (`Por Comprar` / `En Taller`).

### Patrón AJAX Obligatorio (Sin `location.reload()`)
> ⚠️ **CONVENCIÓN DE DESARROLLO**: Todo formulario, modal o acción interactiva en el frontend **DEBE** ejecutarse mediante peticiones asíncronas `fetch()` (AJAX) y actualizar puntualmente el DOM. Está **estrictamente prohibido** utilizar envíos de `<form>` tradicionales que recarguen la página o invocar `location.reload()`.

---

## 🧪 10. Suite de Pruebas Automatizadas y Aseguramiento de Calidad (Vitest)

El proyecto cuenta con una exhaustiva suite de pruebas unitarias y de integración sobre **Vitest**:

- **14 suites de prueba** (`tests/*.test.ts`).
- **89 tests pasando al 100%** en verde.

### Cobertura de Suites Clave
1. `tests/notificationDispatcher.test.ts`: Pruebas directas de cada tier de notificación (Tier 2 inicio de jornada, Tier 3 check-in, Tier 4 alertas de lluvia, ráfagas y avisos de humedad).
2. `tests/alertScenarios.test.ts`: Validación de escenarios climáticos complejos (adelanto de hora de lluvia, confirmación de operario, independencia de humedad y lluvia).
3. `tests/evaluator.test.ts`: Umbrales de curado, resina epóxica, tareas finales y precedencia de sobreescrituras manuales (`day_overrides`).
4. `tests/fsm.test.ts`: Máquinas de estado finitas de tareas y días (`TaskService`, `DayService`).
5. `tests/curingAndAdmin.test.ts`: Curado no vinculante en paralelo (`curing_is_blocking = false`).
6. `tests/localDate.test.ts`: Aritmética de fechas inmutables y anclaje al mediodía UTC.
7. `tests/validation.test.ts`: Aislamiento multi-tenant y prevención de cruce de proyectos.
8. `tests/toolsToBuy.test.ts`: Gestión y reportes de herramientas por comprar.
9. `tests/materialsFlow.test.ts`: Adición secuencial y reactividad de materiales.
10. `tests/weatherCache.test.ts`: TTL y reutilización de pronósticos meteorológicos en memoria.

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
- `POST /api/admin/backup`: Generación y descarga de backup de SQLite.

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
- `POST /tasks/reorder`: Reordenamiento secuencial masivo mediante JSON.
- `POST /tasks/import`: Importación masiva de tareas en formato JSON.
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

### ⚙️ Configuración y Telegram
- `GET /api/timezone`: Obtiene zona horaria calculada según lat/lon.
- `POST /settings/update`: Guarda ubicación, horarios operativos y umbrales climáticos.
- `POST /settings/telegram/generate-code`: Genera código OTP de 6 dígitos para vincular bot.
- `POST /settings/telegram/unlink`: Desvincula cuenta de Telegram.
- `POST /webhook/telegram`: Webhook para mensajes y callbacks interactivos de Telegram.

---

## 📂 14. Árbol de Archivos del Proyecto y Matriz Técnica por Archivo

```
AGENDAPP/
├── .env.example                  # Plantilla de variables de entorno
├── .gitignore                    # Reglas de exclusión de Git
├── Dockerfile                    # Receta de construcción de contenedor Docker
├── README.md                     # Documentación técnica y arquitectura (Single Source of Truth)
├── metadata.json                 # Metadatos del applet
├── package.json                  # Dependencias NPM, scripts de compilación y linter
├── tsconfig.json                 # Configuración del compilador TypeScript
├── vitest.config.ts              # Configuración del runner de pruebas Vitest
├── server.ts                     # Punto de entrada de Express y definición de rutas REST
├── data/                         # Directorio de persistencia de SQLite
│   └── workshop.db               # Base de datos SQLite en runtime (WAL mode)
├── src/                          # Código fuente backend en TypeScript
│   ├── auth.ts                   # Autenticación, hashing PBKDF2 y firma HMAC de sesiones
│   ├── calendarService.ts        # Integración con Google Calendar API v3 y validación PEM
│   ├── dateUtils.ts              # Formateo de fechas y localización en zona horaria del taller
│   ├── db.ts                     # Gestor SQLite, migraciones idempotentes y capa DAO (`store`)
│   ├── evaluator.ts              # Motor de evaluación meteorológica y auditoría horaria
│   ├── holidaysService.ts        # Detección de feriados e irrenunciables
│   ├── LocalDate.ts              # Value Object inmutable para aritmética de fechas
│   ├── notificationDispatcher.ts # Despachador centralizado de notificaciones (Tiers 2, 3 y 4)
│   ├── scheduler.ts              # Daemon de fondo, locks de concurrencia y orquestación
│   ├── telegramBot.ts            # Bot de Telegram, webhooks, long polling y teclados inline
│   ├── types.ts                  # Interfaces TypeScript, modelos y enums
│   ├── weatherService.ts         # Ingesta de pronósticos meteorológicos de Open-Meteo
│   └── services/                 # Servicios de dominio FSM
│       ├── taskService.ts        # Máquina de estados y transiciones de tareas
│       └── dayService.ts         # Máquina de estados y transiciones de días
├── static/                       # Archivos estáticos del frontend
│   ├── manifest.json             # Manifiesto Web App (PWA)
│   ├── sw.js                     # Service Worker
│   ├── css/
│   │   └── main.css              # Reglas CSS de Tailwind e interfaz
│   ├── icons/                    # Iconos y recursos gráficos
│   └── js/
│       ├── agenda.js             # Lógica del cliente para la línea de tiempo y auditoría
│       ├── backlog.js            # Lógica del backlog, drag & drop y autocompletado
│       ├── map.js                # Selector interactivo de coordenadas (Leaflet)
│       └── settings.js           # Gestor de configuración, backup WAL y cambio de contraseña
├── tests/                        # Suite de pruebas automatizadas (14 archivos, 89 tests)
│   ├── alertScenarios.test.ts    # Escenarios de lluvia, ráfagas y adelanto de hora
│   ├── curingAndAdmin.test.ts    # Curado en paralelo y permisos de administrador
│   ├── evaluator.test.ts         # Pruebas del motor evaluador y umbrales climáticos
│   ├── fsm.test.ts               # Pruebas de máquinas de estado de tareas y días
│   ├── localDate.test.ts         # Pruebas unitarias de LocalDate
│   ├── materialsFlow.test.ts     # Pruebas de flujo reactivo de materiales
│   ├── notificationDispatcher.test.ts # Pruebas directas de los tiers de notificación
│   ├── toolsToBuy.test.ts        # Pruebas de herramientas por comprar
│   ├── validation.test.ts        # Pruebas de aislamiento multi-tenant
│   └── weatherCache.test.ts      # Pruebas de caché de clima en memoria
└── views/                        # Plantillas de renderizado EJS
    ├── index.ejs                 # Vista principal del Dashboard
    ├── login.ejs                 # Vista de inicio de sesión
    ├── register.ejs              # Vista de registro de usuario
    └── components/               # Componentes EJS modulares
        ├── agenda.ejs            # Componente de línea de tiempo y auditoría horaria
        ├── backlog.ejs           # Componente de backlog de tareas
        ├── materials.ejs         # Componente de Inventario (Materiales + Herramientas)
        └── settings_modal.ejs    # Modal de configuración, backups y seguridad
```

### Matriz Técnica por Archivo
| Archivo | Responsabilidad Principal | Dependencias Clave |
| :--- | :--- | :--- |
| `server.ts` | Servidor HTTP Express, controladores REST y middleware de seguridad. | `express`, `src/db.ts`, `src/auth.ts`, `src/scheduler.ts` |
| `src/notificationDispatcher.ts` | Despacho, formateo y validación de notificaciones de inicio, check-in y alertas climáticas. | `src/db.ts`, `src/telegramBot.ts`, `src/weatherService.ts`, `src/types.ts` |
| `src/scheduler.ts` | Daemon de fondo, ciclo de vida del evaluador, locks de concurrencia y timers cron. | `src/db.ts`, `src/evaluator.ts`, `src/notificationDispatcher.ts` |
| `src/evaluator.ts` | Motor climático, precedencia de sobreescrituras y auditoría horaria. | `src/types.ts`, `src/holidaysService.ts`, `src/LocalDate.ts` |
| `src/LocalDate.ts` | Representación inmutable de fechas de calendario ancladas al mediodía UTC. | Ninguna (código puro) |
| `src/db.ts` | DAO de SQLite, migraciones idempotentes condicionales y consultas relacionales. | `better-sqlite3`, `src/types.ts` |
| `src/calendarService.ts` | Sincronización espejo con Google Calendar API v3 y validación PEM. | `googleapis`, Node `crypto`, `src/db.ts` |
| `src/auth.ts` | Hashing PBKDF2 en 4 partes, migración transparente y cookies HMAC. | Node `crypto`, `express`, `src/db.ts` |
| `src/telegramBot.ts` | Bot de Telegram, desvinculación automática de duplicados y teclados inline. | `src/db.ts`, HTTP fetch API |
| `src/weatherService.ts` | Ingesta de pronósticos de Open-Meteo con caché local TTL 15-30 min. | HTTP fetch API, `src/types.ts` |

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
