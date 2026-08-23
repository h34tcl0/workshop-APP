import { getTargetTimeZone, getLocalDateIso } from "./dateUtils.js";

const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS_ES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
];

/**
 * Value Object inmutable para representar una fecha de calendario pura (YYYY-MM-DD)
 * en la zona horaria del usuario/taller, inmune a desfases UTC y horas intermedias.
 */
export class LocalDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;   // 1-31
  private readonly _iso: string; // "YYYY-MM-DD"

  private constructor(year: number, month: number, day: number) {
    this.year = year;
    this.month = month;
    this.day = day;
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    this._iso = `${year}-${mm}-${dd}`;
  }

  /**
   * Crea una instancia a partir del día actual según la zona horaria indicada.
   */
  static today(timeZone?: string | null): LocalDate {
    const tz = getTargetTimeZone(timeZone);
    const iso = getLocalDateIso(new Date(), tz);
    return LocalDate.fromIso(iso);
  }

  /**
   * Crea una instancia a partir de un objeto Date existente interpretado en la zona horaria indicada.
   */
  static fromDate(date: Date, timeZone?: string | null): LocalDate {
    const tz = getTargetTimeZone(timeZone);
    const iso = getLocalDateIso(date, tz);
    return LocalDate.fromIso(iso);
  }

  /**
   * Parsea un string "YYYY-MM-DD".
   */
  static fromIso(isoString: string): LocalDate {
    if (!isoString || typeof isoString !== "string") {
      throw new Error(`[LocalDate] Invalid ISO date string: '${isoString}'`);
    }
    const clean = isoString.trim().split("T")[0];
    const parts = clean.split("-");
    if (parts.length !== 3) {
      throw new Error(`[LocalDate] Malformed date string '${isoString}'. Expected format YYYY-MM-DD.`);
    }
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);

    if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) {
      throw new Error(`[LocalDate] Out-of-bounds date components in '${isoString}': Y=${y}, M=${m}, D=${d}`);
    }
    return new LocalDate(y, m, d);
  }

  /**
   * Parsea o retorna la instancia si ya es un LocalDate o un string ISO válido.
   */
  static from(val: string | LocalDate | Date, timeZone?: string | null): LocalDate {
    if (val instanceof LocalDate) return val;
    if (val instanceof Date) return LocalDate.fromDate(val, timeZone);
    return LocalDate.fromIso(val);
  }

  /**
   * Retorna el string ISO estándar 'YYYY-MM-DD'.
   */
  toIso(): string {
    return this._iso;
  }

  /**
   * Alias de toIso para compatibilidad transparente con SQLite y plantillas.
   */
  toString(): string {
    return this._iso;
  }

  /**
   * Alias explícito para persistencia en base de datos SQLite.
   */
  toSql(): string {
    return this._iso;
  }

  /**
   * Devuelve un Date anclado de forma segura al mediodía UTC (T12:00:00Z) de este día.
   * Totalmente inmune a desbordamientos o retrocesos de huso horario en UTC-3 / UTC-4.
   */
  toUtcNoonDate(): Date {
    return new Date(Date.UTC(this.year, this.month - 1, this.day, 12, 0, 0));
  }

  /**
   * Suma (o resta si es negativo) un número entero de días y retorna un nuevo LocalDate inmutable.
   */
  addDays(days: number): LocalDate {
    const utcDate = this.toUtcNoonDate();
    utcDate.setUTCDate(utcDate.getUTCDate() + days);
    return new LocalDate(
      utcDate.getUTCFullYear(),
      utcDate.getUTCMonth() + 1,
      utcDate.getUTCDate()
    );
  }

  /**
   * Retorna el índice del día de la semana (0 = Domingo, 1 = Lunes, ..., 6 = Sábado).
   */
  getDayOfWeek(): number {
    return this.toUtcNoonDate().getUTCDay();
  }

  /**
   * Retorna true si este día es Domingo.
   */
  isSunday(): boolean {
    return this.getDayOfWeek() === 0;
  }

  /**
   * Retorna true si este día es Sábado o Domingo.
   */
  isWeekend(): boolean {
    const dow = this.getDayOfWeek();
    return dow === 0 || dow === 6;
  }

  /**
   * Compara igualdad estricta entre dos fechas de calendario.
   */
  equals(other: LocalDate | string): boolean {
    const otherIso = other instanceof LocalDate ? other.toIso() : other;
    return this._iso === otherIso;
  }

  /**
   * Retorna true si esta fecha es anterior cronológicamente a otra.
   */
  isBefore(other: LocalDate | string): boolean {
    const otherIso = other instanceof LocalDate ? other.toIso() : other;
    return this._iso < otherIso;
  }

  /**
   * Retorna true si esta fecha es posterior cronológicamente a otra.
   */
  isAfter(other: LocalDate | string): boolean {
    const otherIso = other instanceof LocalDate ? other.toIso() : other;
    return this._iso > otherIso;
  }

  /**
   * Retorna la diferencia en días entre esta fecha y otra (this - other).
   */
  diffInDays(other: LocalDate | string): number {
    const o = LocalDate.from(other);
    const msPerDay = 86400000;
    const thisTime = this.toUtcNoonDate().getTime();
    const otherTime = o.toUtcNoonDate().getTime();
    return Math.round((thisTime - otherTime) / msPerDay);
  }

  /**
   * Formatea la fecha en español corto: ej. "Lun 19/08" o "Mié 20/08".
   */
  formatShortEs(): string {
    const dow = this.getDayOfWeek();
    const dd = String(this.day).padStart(2, "0");
    const mm = String(this.month).padStart(2, "0");
    return `${DAYS_ES[dow]} ${dd}/${mm}`;
  }

  /**
   * Formatea la fecha legible completa en español: ej. "Miércoles, 19 de Agosto de 2026".
   */
  formatLongEs(): string {
    const dow = this.getDayOfWeek();
    const daysLong = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const monthsLong = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];
    return `${daysLong[dow]}, ${this.day} de ${monthsLong[this.month - 1]} de ${this.year}`;
  }
}
