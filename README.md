# 🚀 AGENDAPP (Workshop OS) — Documentación Técnica y Arquitectura del Sistema

**AGENDAPP** (anteriormente *Workshop OS*) es un sistema operativo de ejecución operacional autónomo e inteligente respecto al clima, diseñado específicamente para talleres de carpintería al aire libre, estudios de ebanistería y procesos de manufactura sensibles a condiciones ambientales.

El sistema funciona como un **bucle de decisión continuo**: ingiere pronósticos meteorológicos en tiempo real, evalúa umbrales ambientales de secado y curado frente al backlog de tareas, agenda bloques de trabajo optimizados, sincroniza eventos espejo en **Google Calendar API v3**, emite alertas intradía de emergencia ante cambios climáticos intempestivos y entrega notificaciones operacionales e interactivas a través de un **Bot de Telegram**.

---

## 📑 Tabla de Contenidos

1. [Visión General y Arquitectura Multi-Tenant con Geolocalización](#-1-visión-general-y-arquitectura-multi-tenant-con-geolocalización)
2. [Arquitectura y Modelo de Datos (Esquema Completo)](#-2-arquitectura-y-modelo-de-datos-esquema-completo)
3. [Motor de Evaluación Meteorológica, Curado Pasivo y Auditoría Horaria](#-3-motor-de-evaluación-meteorológica-curado-pasivo-y-auditoría-horaria)
4. [Sistema de Alertas (Humedad Informativa vs. Lluvia Crítica de Emergencia)](#-4-sistema-de-alertas-humedad-informativa-vs-lluvia-crítica-de-emergencia)
5. [Concurrencia, Locks en Memoria y Re-evaluación Automática Silenciosa](#-5-concurrencia-locks-en-memoria-y-re-evaluación-automática-silenciosa)
6. [Botón "Término de la Jornada" (Check-in Manual y Fallback)](#-6-botón-término-de-la-jornada-check-in-manual-y-fallback)
7. [Sincronización Espejo Multi-Día (Google Calendar API v3)](#-7-sincronización-espejo-multi-día-google-calendar-api-v3)
8. [Seguridad, CSRF, Rate Limiting y Auditoría Multi-Tenant](#-8-seguridad-csrf-rate-limiting-y-auditoría-multi-tenant)
9. [Frontend, UI, Modos de Navegación y Patrón AJAX](#-9-frontend-ui-modos-de-navegación-y-patrón-ajax)
10. [Operaciones, Despliegue en Producción y Comandos de Diagnóstico](#-10-operaciones-despliegue-en-producción-y-comandos-de-diagnóstico)
11. [Historial de Incidentes Conocidos y Lecciones Aprendidas](#-11-historial-de-incidentes-conocidos-y-lecciones-aprendidas)
12. [Especificación de Endpoints REST (API Reference)](#-12-especificación-de-endpoints-rest-api-reference)
13. [Árbol de Archivos del Proyecto y Matriz Técnica por Archivo](#-13-árbol-de-archivos-del-proyecto-y-matriz-técnica-por-archivo)

---

## 📌 1. Visión General y Arquitectura Multi-Tenant con Geolocalización

### El Desafío Operacional
La carpintería técnica y el trabajo en taller al aire libre sufren vulnerabilidades climáticas estrictamente delimitadas:
- **Colas PVA y Adhesivos**: Requieren temperaturas mínimas (usualmente > 10 °C) y ausencia de humedad directa durante la aplicación y el curado. Niveles de humedad relativa superiores al 80% degradan significativamente la resistencia mecánica del ensamblado.
- **Acabados, Barnices y Pinturas**: Los recubrimientos al agua o sintéticos requieren ventanas térmicas específicas y humedad controlada para evitar "velado", burbujas o fallas de secado.
- **Epoxi y Resinas**: Exigen condiciones térmicas estrictas (mínimo 15 °C) y humedad relativa < 75% tanto en la colada activa como durante sus 6 horas o más de curado continuo.
- **Ensamblado e Insumos**: La lluvia o humedad crítica interrumpe el trabajo exterior con herramientas eléctricas y deteriora la madera expuesta.

### La Solución AGENDAPP
AGENDAPP automatiza completamente la planificación del taller mediante una arquitectura **Multi-Tenant aislada**:

1. **Entorno de Ejecución Moderno**:
   - Ejecución sobre **Node.js 22 (Web Runtime)** utilizando **Express 4** para la API REST, renderizado de plantillas modulares **EJS** y empaquetado optimizado con **`esbuild`** (`dist/server.cjs`) escuchando en el **puerto 3000**.
2. **Aislamiento Multi-Tenant y Unicidad Estricta de Chat ID**:
   - Cada usuario (`user_id`) posee un contexto completamente aislado en la base de datos: su propio backlog de tareas, proyectos, plantillas, materiales/insumos, logs diarios, sobreescrituras manuales (`day_overrides`) y configuración operacional (`app_settings`).
   - **Garantía de Unicidad**: Cada `telegram_chat_id` está estrictamente vinculado a un único usuario activo. Si un usuario registra un Chat ID ya usado por otra cuenta, el sistema desvincula automáticamente la cuenta anterior (`telegram_chat_id = NULL`), evitando la duplicación de notificaciones.
3. **Geolocalización y Cálculo Dinámico de Zona Horaria**:
   - El usuario configura la latitud y longitud exactas de su taller (mediante un mapa interactivo Leaflet/OpenStreetMap).
   - El backend utiliza `tz-lookup` para determinar automáticamente la zona horaria IANA correspondiente (ej. `America/Santiago`, `America/Buenos_Aires`).
   - La aplicación sincroniza y presenta la **hora local exacta del taller** (`local_time_info`), garantizando que la evaluación matutina, las notificaciones y los eventos de Google Calendar coincidan con el huso horario real del sitio de trabajo.

---

## 🗄️ 2. Arquitectura y Modelo de Datos (Esquema Completo)

AGENDAPP almacena la persistencia relacional en SQLite (`data/workshop.db`) mediante el driver de alto rendimiento `better-sqlite3` con modo WAL (`journal_mode = WAL`).

### Patrón de Migraciones Idempotentes en `db.ts`
Para garantizar que la base de datos se actualice de forma transparente en cada inicio del servidor sin destruir datos ni requerir herramientas CLI externas (las cuales no existen en el contenedor de producción), `db.ts` implementa una convención de **migraciones idempotentes condicionales**:

```typescript
// Convención estándar en db.ts:
const currentDailyLogCols = dbInstance.prepare("PRAGMA table_info(daily_logs)").all() as any[];
if (!currentDailyLogCols.some(c => c.name === 'hourly_forecast')) {
  dbInstance.exec("ALTER TABLE daily_logs ADD COLUMN hourly_forecast TEXT;");
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
| `must_change_password` | INTEGER | NOT NULL DEFAULT 0 | Flag de cambio obligatorio de clave. |
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
| `min_work_hours_unless_final`| REAL | NOT NULL DEFAULT 4.0 | Duración mínima a menos que complete la última tarea. |
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
| `telegram_notified` | INTEGER | NOT NULL DEFAULT 0 | Flag de notificación matutina enviada. |
| `calendar_created` | INTEGER | NOT NULL DEFAULT 0 | Flag de confirmación de evento en Google Calendar. |
| `google_event_id` | TEXT | NULL | Identificador del evento en Google Calendar. |
| `checkin_sent` | INTEGER | NOT NULL DEFAULT 0 | Flag de prompt nocturno enviado. |
| `checkin_resolved` | INTEGER | NOT NULL DEFAULT 0 | Flag de check-in resuelto por el operario. |
| `humidity_alert_sent` | INTEGER | NOT NULL DEFAULT 0 | Flag de alerta informativa de humedad enviada hoy. |
| `intraday_alert_triggered`| INTEGER | NOT NULL DEFAULT 0 | Flag de alerta de emergencia de lluvia activada hoy. |
| `intraday_alert_acknowledged`| INTEGER | NOT NULL DEFAULT 0 | Flag de confirmación/revisión por parte del operario. |
| `intraday_alert_last_sent_at`| TEXT | NULL | Timestamp ISO de la última ráfaga de lluvia. |
| `intraday_alert_burst_count`| INTEGER | NOT NULL DEFAULT 0 | Contador de ráfagas enviadas (máx 3 ráfagas cada 5 min). |
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

---

## 🔍 3. Motor de Evaluación Meteorológica, Curado Pasivo y Auditoría Horaria

El motor de evaluación en `src/evaluator.ts` calcula la viabilidad de agendamiento a lo largo de un horizonte móvil multi-día (usualmente 7 a 10 días).

```
Jornada Operativa (09:00 - 18:00)             Extensión de Curado Pasivo Nocturno (hasta 23:00)
┌───────────────────────────────────────────┬─────────────────────────────────────────────┐
│ 09:00 Setup │ 10:00 - 15:00 Trabajo Activo │ 15:00 - 20:00 Curado PVA / Epoxi (Pasivo)   │
└─────────────┴─────────────────────────────┴─────────────────────────────────────────────┘
                                             ▲ Si a las 19:00 Llueve o Humedad > 80% ────┤
                                               --> DÍA RECHAZADO / DAY_BLOCKED PREVENTIVO
```

### Regla de Negocio Central: Precedencia Absoluta de `day_overrides`
> ⚠️ **REGLA INVARIABLE**: Las sobreescrituras manuales registradas en `day_overrides` tienen **prioridad absoluta** sobre cualquier regla predeterminada de exclusión (`exclude_saturdays`, `exclude_sundays`, `exclude_holidays`).

1. **Si un día tiene `force_status === "BLOCKED"`**:
   El evaluador **retorna inmediatamente** `DayStatus.DAY_BLOCKED` con la razón definida por el usuario, omitiendo cualquier evaluación meteorológica o asignación de tareas.
2. **Si un día tiene `force_status === "VIABLE"` o horas personalizadas (`custom_start_hour`/`custom_end_hour`)**:
   Incluso si es domingo, sábado o feriado irrenunciable, el motor **anula el bloqueo por calendario**, establece la ventana con los horarios personalizados solicitados (ej. 15:00 a 21:00) y evalúa el clima y la asignación de tareas dentro de esa ventana específica.

### Fases de una Jornada Evaluada y Umbrales Ambientales
Cada día evaluado pasa por 4 fases secuenciales:
1. **PREP (Setup)**: Preparación del taller (duración `setup_hours`, ej. 1.0h).
2. **TRABAJO (Trabajo Activo)**: Ejecución de tareas activas con herramientas y aplicación de materiales.
3. **CIERRE (Teardown)**: Limpieza y guardado de herramientas (duración `teardown_hours`, ej. 1.0h).
4. **CURADO (Curado Activo y Pasivo Nocturno)**:
   - **Curado Activo**: Ocurre durante la jornada mientras se aplican recubrimientos o adhesivos.
   - **Curado Pasivo**: Ocurre **después** de terminar el trabajo activo o el cierre. Se extiende durante las horas de secado necesarias (`curing_hours`, ej. 2h a 6h), pudiendo adentrarse en la noche (hasta las 23:00 hrs).

**Umbrales Climáticos Aplicables**:
- **Lluvia**: Precipitación `>= min_rain_precipitation_mm` (0.2mm) o probabilidad `>= 30%` en **cualquiera** de las horas de trabajo activo o curado pasivo provoca el bloqueo preventivo del día.
- **Humedad Relativa**: Humedad `>= max_humidity_percent` (ej. 80%) durante trabajo activo o curado invalida la ventana.
- **Epoxi**: Exige estricto cumplimiento de `temperatura >= 15.0 °C` y `humedad <= 75.0%` en todas las horas activas y sus 6 horas de curado.

### Auditoría Horaria Climática (`hourly_forecast`)
El evaluador genera un objeto de auditoría hora por hora (`getHourlyClimateAudit`) que se guarda serializado en `daily_logs.hourly_forecast`.
- **Propósito**: Permitir inspeccionar exactamente qué ocurrió en cada hora del día (0 a 23), indicando si era hora de trabajo activo, hora de curado pasivo, y los riesgos detectados.
- **Detección de Lluvia en Curado Pasivo**: Si la lluvia ocurre durante las horas de curado pasivo (ej. a las 15:00 hrs, cuando el trabajo activo ya terminó a las 12:00), el audit registra explícitamente:
  `"is_curing": true`, `risk_reasons: ["Lluvia en curado pasivo: 1.5mm (80%)"]`.
- **Tamaño de Almacenamiento**: Cada registro diario almacena un JSON de ~1.2 KB a 1.8 KB en SQLite, garantizando información detallada para la UI sin sobrecargar la base de datos.

---

## 🚨 4. Sistema de Alertas (Humedad Informativa vs. Lluvia Crítica de Emergencia)

El daemon de fondo (`scheduler.ts`) realiza revisiones climáticas continuas durante la jornada. Existe una **asimetría intencional** en el tratamiento de alertas según la severidad del riesgo:

```
                            +-----------------------------------+
                            |  REVISIÓN CLIMÁTICA INTRADÍA      |
                            +-----------------+-----------------+
                                              |
                     +------------------------+------------------------+
                     |                                                 |
                     v                                                 v
        [Riesgo de Humedad Excesiva]                        [Riesgo de Lluvia Inminente]
                     |                                                 |
                     v                                                 v
        • Tipo: INFORMATIVO                                 • Tipo: EMERGENCIA CRÍTICA
        • Frecuencia: 1 vez al día                          • Frecuencia: Ráfaga cada 5 min (máx 3)
        • Reintentos: Ninguno                               • Reintentos: Hasta confirmación operario
        • Marcador: `humidity_alert_sent = 1`               • Marcador: `intraday_alert_triggered = 1`
```

### Razón de la Asimetría de Alertas
1. **Alerta de Humedad (Informativa)**: El exceso de humedad relativa ralentiza el secado de adhesivos o barnices, pero raras veces exige una evacuación de emergencia inmediata del taller. Por ende, se envía un **único aviso informativo diario** para no saturar al operario.
2. **Alerta de Lluvia (Emergencia Crítica)**: La lluvia directa sobre herramientas eléctricas, madera expuesta o ensambles en proceso destruye materiales y supone un riesgo eléctrico grave. Por ello:
   - Dispara una **ráfaga de alertas de emergencia** cada 5 minutos (hasta 3 reintentos) hasta que el operario confirme la recepción o intervenga.
   - **Re-alerta por Adelantamiento**: Si la lluvia estaba prevista originalmente para las 18:00 hrs y el operario ya la había confirmado, pero un nuevo reporte meteorológico indica que la lluvia se **adelantó** a las 17:00 hrs, el sistema **relanza la ráfaga de emergencia de inmediato**. Si la lluvia se retrasa, no se genera una nueva ráfaga molesta.

---

## 🔐 5. Concurrencia, Locks en Memoria y Re-evaluación Automática Silenciosa

### Sistema de Lock en Memoria
Para evitar que múltiples solicitudes concurrentes (ej. un cron del scheduler, una acción del usuario en la web y un callback de Telegram) ejecuten el motor de evaluación para el mismo usuario de forma simultánea, `scheduler.ts` implementa un gestor de cerrojos en memoria:

```typescript
// Estructura del lock en scheduler.ts
const activeEvaluationLocks = new Set<number>();

export function acquireEvaluationLock(userId: number): boolean {
  if (activeEvaluationLocks.has(userId)) return false;
  activeEvaluationLocks.add(userId);
  return true;
}

export function releaseEvaluationLock(userId: number): void {
  activeEvaluationLocks.delete(userId);
}
```

### Timeout de Seguridad de 2 Minutos
**Lección Aprendida de Incidente Real**: En versiones previas, si una solicitud HTTP externa (como Open-Meteo o Telegram) quedaba colgada indefinidamente por problemas de red sin timeout, el lock en memoria jamás se liberaba, dejando las evaluaciones del usuario bloqueadas para siempre.
- **Red de Protección**: Toda evaluación adquiere el lock con un `setTimeout` de seguridad de 2 minutos que fuerza la liberación del cerrojo si la promesa no concluye.
- **Timeouts en Peticiones Salientes**: Toda llamada HTTP saliente (Open-Meteo, Telegram, Google Calendar, Servicio de Feriados) incluye un `AbortSignal.timeout(8000)` o `AbortSignal.timeout(10000)` estricto.

### Re-evaluación Automática Silenciosa
Cualquier mutación relevante del estado operativo realizada por el usuario en la interfaz web o Telegram:
- Completar o reagendar una tarea en el check-in nocturno.
- Agregar, editar o reordenar tareas en el backlog.
- Cambiar el estado de activación de un proyecto o tarea.
- Modificar el estado de un material (`to_buy` <-> `in_stock`).

Dispara una **re-evaluación automática y silenciosa** del horizonte multi-día. Esta re-evaluación utiliza el mismo lock de concurrencia, actualiza los registros en `daily_logs` y resincroniza Google Calendar, pero **NO re-envía notificaciones ni alertas** por Telegram para mantener la tranquilidad del operario.

---

## 🔘 6. Botón "Término de la Jornada" (Check-in Manual y Fallback)

En la interfaz principal de la Agenda, el operario dispone del botón **"Término de la Jornada"**.

```
   [ Botón: Término de la Jornada ]
                  │
                  ▼
   ¿Telegram vinculado y responsivo?
         ├── SÍ  ──> Envía prompt interactivo a Telegram + Notificación flotante en web.
         └── NO  ──> Abre Modal Fallback directamente en pantalla para marcar tareas.
```

### Propósito y Casos Borde Cubiertos
Permite forzar el cierre de la jornada de trabajo sin esperar a la hora programada (`checkin_hour`, ej. 19:00 hrs).

**Casos Borde Garantizados**:
1. **Cancelación**: Si el operario abre el modal de cierre y presiona "Cancelar", no se altera el estado de ninguna tarea ni log diario.
2. **Día Bloqueado (`DAY_BLOCKED`)**: Si se presiona en un día no laborable o bloqueado, la interfaz informa amablemente que no hay jornada activa que cerrar.
3. **Re-apretar el mismo día (Idempotencia)**: Si el check-in de hoy ya fue completado, al presionar el botón el sistema informa claramente: *"El check-in de la jornada de hoy ya fue completado previamente"*, sin duplicar notificaciones ni corromper registros en la DB.
4. **Doble Clic Prematuro**: Los controladores del frontend deshabilitan el botón inmediatamente al primer clic (`disabled = true`) y muestran un spinner de carga, previniendo solicitudes duplicadas o apertura de múltiples modales.

---

## 📅 7. Sincronización Espejo Multi-Día (Google Calendar API v3)

AGENDAPP mantiene un espejo flotante de la agenda en Google Calendar:

1. **Creación de Eventos Macro**: Para días viables (`DAY_VIABLE`), genera eventos del tipo `🔨 Taller Carpintería (09:00 - 17:00)` con el desglose de tareas en la descripción.
2. **Limpieza de Eventos Inviables**: Si una actualización meteorológica vuelve inviable un día (`DAY_BLOCKED`), el sistema **elimina automáticamente** el evento de Google Calendar.
3. **Rescate de Errores 404**: Si el operario borra el evento manualmente en Google Calendar, el backend detecta el error `404 Not Found`, limpia `google_event_id` en SQLite y recrea el evento limpiamente.
4. **Lock Optimista de Sincronización (`calendar_sync_claimed_at`)**: Evita la creación de eventos duplicados si dos rutinas de evaluación coinciden en el tiempo.
5. **Sanitización de Claves PEM**: Sanitiza y valida claves privadas mediante `crypto.createPrivateKey()` antes de instanciar el cliente JWT de Google.

---

## 🛡️ 8. Seguridad, CSRF, Rate Limiting y Auditoría Multi-Tenant

Tras una auditoría formal de seguridad realizada en agosto de 2026, el sistema cuenta con las siguientes protecciones:

1. **Protección CSRF (`verifySameOrigin`)**: Middleware que valida los encabezados `Origin` y `Referer` en todas las peticiones mutativas (`POST`, `PUT`, `DELETE`), bloqueando ataques entre sitios.
2. **Rate Limiting en Autenticación**: `/login` y `/register` limitan los intentos fallidos por dirección IP para mitigar ataques de fuerza bruta.
3. **Formato PBKDF2 de 4 Partes y Migración Transparente**:
   - Formato de almacenamiento: `pbkdf2:sha256:100000:salt:hash`.
   - Soporta migración transparente: si un usuario con hash antiguo (`salt:hash`) inicia sesión correctamente, su contraseña se re-encripta automáticamente al formato moderno de 4 partes.
4. **Validación Multi-Tenant de `project_id`**: Los endpoints REST de tareas y materiales verifican que el `project_id` provisto pertenezca estrictamente al `user_id` de la sesión activa, impidiendo que un usuario modifique o asigne elementos a proyectos de otro usuario.

---

## 🎨 9. Frontend, UI, Modos de Navegación y Patrón AJAX

### 3 Modos de Navegación de Primer Nivel
La interfaz web se estructura en 3 vistas principales seleccionables mediante la barra superior:
1. **Planificación**: Vista general del horizonte de agendamiento, línea de tiempo diaria, panel de detalle climático hora por hora y gestión del backlog.
2. **Taller**: Enfoque de ejecución directa para el trabajo diario en el espacio de trabajo.
3. **Inventario**: Control de materiales e insumos (`Por Comprar` / `En Taller`) agrupados por proyecto.

- **Botón Modo Enfoque**: Condicional y **únicamente visible** dentro del modo *Planificación*, permitiendo maximizar la línea de tiempo y el detalle climático sin distracciones.

### Patrón AJAX Obligatorio (Sin `location.reload()`)
> ⚠️ **CONVENCIÓN DE DESARROLLO**: Todo formulario, modal o acción interactiva en el frontend **DEBE** ejecutarse mediante peticiones asíncronas `fetch()` (AJAX) y actualizar puntualmente el DOM. Está **estrictamente prohibido** utilizar envíos de `<form>` tradicionales que recarguen la página o invocar `location.reload()`, salvo excepciones de autenticación/logout explícitamente justificadas.

---

## ⚙️ 10. Operaciones, Despliegue en Producción y Comandos de Diagnóstico

### Comando de Despliegue Actual
```bash
# Construcción e inicio del contenedor Docker en puerto 3000
docker build -t workshop-os .
docker run -d -p 3000:3000 --name workshop-app -v $(pwd)/data:/app/data workshop-os
```

> ⚠️ **ADVERTENCIA CRÍTICA DE DESPLIEGUE**: Nunca realizar un despliegue o reinicio del contenedor en la ventana horaria cercana al check-in nocturno (`checkin_hour`, ej. 18:55 - 19:05 hrs). Un despliegue ejecutado durante esa ventana puede interrumpir el scheduler justo en el instante de emisión de notificaciones, dejando registros incompletos o impidiendo el envío de la alerta diaria.

### Comandos de Diagnóstico Útiles en Producción
Dado que no existe el ejecutable CLI `sqlite3` dentro del contenedor de producción, toda inspección o diagnóstico de la base de datos se realiza mediante comandos de una sola línea con `node -e` y `better-sqlite3`:

```bash
# 1. Consultar las columnas de una tabla (ej. daily_logs):
node -e "const db = require('better-sqlite3')('./data/workshop.db'); console.log(db.prepare('PRAGMA table_info(daily_logs)').all());"

# 2. Consultar los parámetros de configuración de un usuario:
node -e "const db = require('better-sqlite3')('./data/workshop.db'); console.log(db.prepare('SELECT * FROM app_settings WHERE user_id = 1').all());"

# 3. Filtrar logs del sistema en búsqueda de errores de sincronización o clima:
docker logs workshop-app 2>&1 | grep -iE "scheduler|weather|calendar|error" | tail -n 50

# 4. Verificar presencia de credenciales de Google sin exponer la clave privada:
node -e "console.log('CLIENT_EMAIL:', !!process.env.GOOGLE_CLIENT_EMAIL, 'PRIVATE_KEY_LENGTH:', (process.env.GOOGLE_PRIVATE_KEY||'').length);"
```

---

## 📜 11. Historial de Incidentes Conocidos y Lecciones Aprendidas

A continuación se resumen los incidentes operacionales más relevantes experimentados durante el desarrollo y producción del sistema, documentados como lecciones aprendidas para prevenir su reaparición:

1. **Formularios Anidados Rompiendo Submits Silenciosamente**:
   - *Causa Raíz*: Elementos `<form>` declarados dentro de otros formularios HTML en plantillas EJS causaban que el navegador ignorara los botones de submit internos sin emitir errores en consola.
   - *Lección*: Mantener modales y formularios completamente desacoplados fuera del árbol DOM de otros formularios y usar el patrón AJAX.

2. **Cálculos Erróneos entre UTC y Hora Local (`America/Santiago`)**:
   - *Causa Raíz*: El uso de `new Date().toISOString()` para comparar horas operativas (ej. 19:00 hrs) interpretaba la hora en UTC (UTC-3 / UTC-4 según época del año), provocando que los check-in nocturnos se dispararan a las 15:00 hrs locales.
   - *Lección*: Toda lógica horaria del taller debe canalizarse a través de las utilidades de `src/dateUtils.ts` (`getLocalDateIso`, `getLocalHoursAndMinutes`) usando la zona horaria IANA configurada.

3. **Lock de Concurrencia Bloqueado por Promesas Colgadas**:
   - *Causa Raíz*: Llamadas HTTP salientes sin timeout hacia APIs externas (Open-Meteo / Telegram) quedaban en estado `pending` indefinidamente ante fallas de red, impidiendo que `releaseEvaluationLock` se ejecutara.
   - *Lección*: Toda petición red saliente implementa `AbortSignal.timeout()` y el gestor de cerrojos incorpora un `setTimeout` de liberación forzosa de 2 minutos.

4. **Sobreescrituras Manuales (`day_overrides`) Ignoradas en Fines de Semana**:
   - *Causa Raíz*: El evaluador verificaba la regla `exclude_sundays` antes de consultar la tabla `day_overrides`, descartando el domingo antes de leer la intención del usuario.
   - *Lección*: Las sobreescrituras en `day_overrides` poseen precedencia absoluta y se evalúan antes que las exclusiones por defecto.

---

## 📡 12. Especificación de Endpoints REST (API Reference)

### 🔐 Autenticación y Sesión
- `POST /login`: Inicia sesión y establece la cookie firmada `workshop_token`.
- `POST /register`: Crea una cuenta de usuario e inicializa sus parámetros.
- `GET /logout`: Destruye la sesión actual y redirige a `/login`.
- `GET /api/auth/status`: Retorna el estado de autenticación del usuario.

### 📋 Gestión de Tareas y Backlog
- `GET /tasks/history`: Obtiene el historial de tareas únicas para autocompletado.
- `POST /tasks/add`: Agrega una tarea al backlog del proyecto activo.
- `POST /tasks/:id/update`: Actualiza título, categoría, horas de trabajo y curado.
- `POST /tasks/:id/delete`: Elimina una tarea.
- `POST /tasks/:id/toggle-active`: Activa o pausa una tarea en el agendamiento.
- `POST /tasks/reorder`: Reordena secuencialmente las tareas del backlog.
- `POST /tasks/import`: Importación masiva JSON de tareas asociadas a un proyecto.

### 📁 Proyectos y Materiales
- `POST /projects/add`: Crea un nuevo proyecto.
- `POST /projects/:id/toggle`: Alterna el estado de activación de un proyecto.
- `GET /api/materials`: Obtiene los materiales e insumos del usuario/proyecto.
- `POST /materials/add`: Registra un nuevo material asociado a un proyecto.
- `POST /materials/:id/toggle`: Alterna el estado del material entre `to_buy` y `in_stock`.
- `POST /materials/:id/update`: Actualiza datos de un material.
- `POST /materials/:id/delete`: Elimina un material.

### 📆 Evaluación, Agenda y Check-in
- `POST /evaluation/run`: Dispara la evaluación climática del horizonte multi-día.
- `POST /api/checkin/resolve`: Procesa el cierre de jornada y actualiza el estado de las tareas.
- `POST /calendar/create`: Fuerza la sincronización espejo hacia Google Calendar.

### ⚙️ Configuración
- `POST /settings/update`: Actualiza parámetros operacionales, coordenadas y vinculación de Telegram.

---

## 📂 13. Árbol de Archivos del Proyecto y Matriz Técnica por Archivo

```
AGENDAPP/
├── .env.example                  # Plantilla de variables de entorno
├── .gitignore                    # Reglas de exclusión de Git
├── Dockerfile                    # Receta de construcción de contenedor Docker
├── README.md                     # Documentación técnica y arquitectura (Single Source of Truth)
├── metadata.json                 # Metadatos del applet
├── package.json                  # Dependencias NPM, scripts de compilación y linter
├── tsconfig.json                 # Configuración del compilador TypeScript
├── server.ts                     # Punto de entrada de Express y definición de rutas REST
├── data/                         # Directorio de persistencia de SQLite
│   └── workshop.db               # Archivo de base de datos SQLite (runtime)
├── src/                          # Código fuente backend en TypeScript
│   ├── auth.ts                   # Autenticación, hashing PBKDF2 y firma HMAC de sesiones
│   ├── calendarService.ts        # Integración con Google Calendar API v3 y validación PEM
│   ├── dateUtils.ts              # Formateo de fechas y localización en zona horaria del taller
│   ├── db.ts                     # Gestor SQLite, migraciones idempotentes y capa DAO (`store`)
│   ├── evaluator.ts              # Motor de evaluación meteorológica y auditoría horaria
│   ├── holidaysService.ts        # Detección de feriados e irrenunciables
│   ├── scheduler.ts              # Daemon de fondo, locks de concurrencia y tickers
│   ├── telegramBot.ts            # Bot de Telegram, webhooks, long polling y callbacks
│   ├── types.ts                  # Interfaces TypeScript, modelos y enums
│   └── weatherService.ts         # Ingesta de pronósticos meteorológicos de Open-Meteo
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
│       └── settings.js           # Gestor de configuración y vinculación de Telegram
└── views/                        # Plantillas de renderizado EJS
    ├── index.ejs                 # Vista principal del Dashboard
    ├── login.ejs                 # Vista de inicio de sesión
    ├── register.ejs              # Vista de registro de usuario
    └── components/               # Componentes EJS modulares
        ├── agenda.ejs            # Componente de línea de tiempo y auditoría horaria
        ├── backlog.ejs           # Componente de backlog de tareas
        ├── materials.ejs         # Componente de materiales e insumos
        └── settings_modal.ejs    # Modal de configuración operacional
```

### Matriz Técnica por Archivo
| Archivo | Responsabilidad Principal | Dependencias Clave |
| :--- | :--- | :--- |
| `server.ts` | Servidor HTTP Express, controladores REST y middleware de seguridad. | `express`, `src/db.ts`, `src/auth.ts`, `src/scheduler.ts` |
| `src/auth.ts` | Hashing PBKDF2 en 4 partes, migración transparente y cookies HMAC. | Node `crypto`, `express`, `src/db.ts` |
| `src/calendarService.ts` | Sincronización espejo con Google Calendar API v3 y validación PEM. | `googleapis`, Node `crypto`, `src/db.ts` |
| `src/dateUtils.ts` | Lógica de fechas en zona horaria IANA del taller. | Date Standard API, `tz-lookup` |
| `src/db.ts` | DAO de SQLite, migraciones idempotentes condicionales y consultas relacionales. | `better-sqlite3`, `src/types.ts` |
| `src/evaluator.ts` | Motor climático, precedencia de sobreescrituras y auditoría horaria. | `src/types.ts`, `src/holidaysService.ts` |
| `src/scheduler.ts` | Daemon en segundo plano, cerrojos de concurrencia y tickers de alertas. | `src/db.ts`, `src/evaluator.ts`, `src/weatherService.ts`, `src/telegramBot.ts` |
| `src/telegramBot.ts` | Bot de Telegram, desvinculación automática de duplicados y callbacks inline. | `src/db.ts`, HTTP fetch API |
| `src/weatherService.ts` | Ingesta de pronósticos de Open-Meteo con cache local y fallback a snapshot. | HTTP fetch API, `src/types.ts` |
