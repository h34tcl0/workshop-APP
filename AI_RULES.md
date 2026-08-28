# AGENDAPP - Reglas de Arquitectura y Modularidad de Código (AI Rules)

Este documento establece las políticas obligatorias de calidad de software, arquitectura modular y límites de tamaño de archivo para el desarrollo y mantenimiento del sistema **AGENDAPP**.

---

## 1. Política de Modularidad y Límites de Archivo

Para evitar el crecimiento desmedido de componentes, reducir la complejidad cognitiva, prevenir regresiones y optimizar el consumo de tokens en revisiones por IA:

- **🟢 Límite Óptimo / Objetivo**: **< 250 líneas** por archivo.
- **⚠️ Zona Amarilla (Alerta de Crecimiento)**: **250 a 400 líneas**. Requiere atención y evaluar subdivisión.
- **🚨 Zona Roja (Máximo Absoluto)**: **> 400 líneas**. **PROHIBIDO**. Cualquier archivo que supere las 400 líneas debe ser refactorizado y desacoplado de inmediato.

---

## 2. Principio de Responsabilidad Única (SRP) y Arquitectura por Dominio

Cada módulo, archivo o clase debe resolver una única responsabilidad de negocio o infraestructura dentro de su dominio:

1. **Rutas y Controladores (`src/routes/`, `server.ts`)**:
   - Encargados exclusivamente del enrutamiento HTTP, parsing de peticiones, validaciones de esquemas (Zod) y delegación a los servicios.
   - **No deben contener** lógica de negocio compleja ni consultas SQL directas.
2. **Capa de Servicios (`src/services/`)**:
   - Orquestan la lógica de negocio, flujos transaccionales y llamados a APIs externas (ej. Google Calendar, Telegram, Open-Meteo).
   - Mantener servicios pequeños y altamente cohesivos (ej. `weatherService`, `telegramService`, `shiftCalculationService`, etc.).
3. **Capa de Repositorios / Persistencia (`src/db/repositories/`, `src/db/`)**:
   - Encapsulan todas las consultas a SQLite/Better-SQLite3.
   - Un repositorio por entidad o tabla (ej. `dailyLogRepo.ts`, `taskRepo.ts`, `userRepo.ts`, `settingsRepo.ts`).
4. **Utilidades y Helpers (`src/utils/`, `src/db/helpers.ts`)**:
   - Funciones puras, helpers de tiempo/zona horaria, validaciones y formateadores.
5. **Frontend / Vistas (`static/js/`, `views/`)**:
   - Separar scripts pesados en módulos de interfaz específicos por funcionalidad (ej. modals, calendar view, alert drawer, shift managers) en lugar de un monolito global.

---

## 3. Protocolo Obligatorio de Verificación de Calidad

Antes de dar por concluida cualquier tarea o cambio en el código:

1. **Ejecutar Suite de Pruebas Unitarias e Integración**:
   ```bash
   npm test
   ```
   *Todos los tests deben pasar exitosamente (100% green).*

2. **Ejecutar Auditoría de Líneas**:
   ```bash
   npm run check:lines
   ```
   *Ningún archivo nuevo o modificado debe ingresar a la Zona Roja (>400 líneas).*

3. **Verificar Tipos y Compilación**:
   ```bash
   npm run lint
   npm run build
   ```

---

## 4. Estrategia de Refactorización Proactiva

Cuando un archivo supere las 300 líneas:
- Identificar bloques funcionales independientes (por ejemplo: sincronización externa, serialización/deserialización, helpers de cálculo).
- Extraerlos a submódulos o clases auxiliares dentro del mismo directorio de dominio.
- Mantener una fachada o exportación limpia para preservar la retrocompatibilidad con el resto del sistema.
