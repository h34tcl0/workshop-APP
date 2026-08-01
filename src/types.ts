export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
}

export enum TaskCategory {
  CARPENTRY = "carpentry",
  PVA_GLUE = "pva_glue",
  VARNISH_PAINT = "varnish_paint",
  EPOXY = "epoxy"
}

export enum TaskStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed"
}

export enum DayStatus {
  DAY_VIABLE = "DAY_VIABLE",
  DAY_BLOCKED = "DAY_BLOCKED"
}

export interface AppSettings {
  operational_start_hour: number;
  operational_end_hour: number;
  max_humidity_percent: number;
  exclude_saturdays: boolean;
  exclude_sundays: boolean;
  exclude_holidays: boolean;
  require_curing_before_cutoff: boolean;
  latitude: number;
  longitude: number;
  setup_hours: number;
  teardown_hours: number;
  min_work_hours: number;
  min_work_hours_unless_final: number;
  min_rain_precipitation_mm: number;
  checkin_hour: number;
  morning_eval_lead_hours: number;
}

export interface Project {
  id: number;
  name: string;
  description?: string;
  is_active: boolean;
}

export interface Task {
  id: number;
  project_id: number;
  title: string;
  description?: string;
  category: TaskCategory;
  estimated_hours: number;
  curing_hours: number;
  order: number;
  status: TaskStatus;
  progress_percentage: number;
  completed_at?: Date | string | null;
  requires_curing?: boolean;
}

export interface FavoriteTask {
  id: number;
  title: string;
  category: TaskCategory;
  estimated_hours: number;
  curing_hours: number;
}

export interface DayOverride {
  id: number;
  override_date: string; // YYYY-MM-DD
  force_status?: "VIABLE" | "BLOCKED" | null;
  custom_start_hour?: number | null;
  custom_end_hour?: number | null;
  removed_task_ids?: string | null; // JSON string of number[]
  note?: string | null;
  updated_at?: string;
}

export interface ForcedTask {
  id: number;
  forced_date: string; // YYYY-MM-DD
  task_id: number;
  forced_start_hour: number;
}

export interface ForcedTaskWithDetails {
  forced_id: number;
  forced_start_hour: number;
  task: Task;
}

export interface HourlyForecast {
  hour: number;
  temperature_c: number;
  relative_humidity: number;
  precipitation_mm: number;
  precipitation_probability: number;
  cloud_cover_percent: number;
}

export interface TimeWindow {
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  start_hour: number;
  end_hour: number;
  total_duration_hours: number;
  net_work_hours: number;
  is_viable: boolean;
}

export interface TimelineItem {
  time_range: string;
  title: string;
  duration: string;
}

export interface ClimateSegment {
  start_h: number;
  end_h: number;
  condition: "clear" | "rain" | "humid";
}

export interface FreeWindow {
  start_hour: number;
  end_hour: number;
  duration_hours: number;
  start_label: string;
  end_label: string;
}

export interface BarSegmentDetail {
  pct: number;
  condition: "clear" | "rain" | "humid";
  start_h: number;
  end_h: number;
}

export interface BarSegments {
  closed_before_h: number;
  pct_closed_before: number;
  before_segments: BarSegmentDetail[];
  setup_h: number;
  pct_setup: number;
  work_h: number;
  pct_work: number;
  teardown_h: number;
  pct_teardown: number;
  curing_h: number;
  pct_curing: number;
  closed_after_h: number;
  pct_closed_after: number;
  after_segments: BarSegmentDetail[];
}

export interface WeatherSummary {
  condition: "sunny" | "partly" | "cloudy" | "rain";
  label: string;
  min_temp: number;
  max_temp: number;
}

export interface DayEvaluation {
  eval_date: string; // YYYY-MM-DD
  date_str: string;
  status: DayStatus;
  window?: TimeWindow | null;
  scheduled_tasks?: Task[];
  reason: string;
  timeline?: TimelineItem[];
  cutoff_reason?: string;
  bar_segments?: BarSegments | null;
  weather_summary: WeatherSummary;
  climate_segments: ClimateSegment[];
  free_windows: FreeWindow[];
  climate_only_status: "clear" | "blocked";
  is_manually_blocked?: boolean;
  forced_tasks?: ForcedTaskWithDetails[];
  day_override?: DayOverride | null;
}

export interface DailyLog {
  id: number;
  eval_date: string; // YYYY-MM-DD
  status: DayStatus;
  block_reason?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  net_work_hours?: number | null;
  tasks_summary?: string | null;
  scheduled_task_ids?: string | null; // JSON string of number[]
  morning_climate_snapshot?: string | null;
  telegram_notified: boolean;
  calendar_created: boolean;
  checkin_sent: boolean;
  checkin_resolved: boolean;
  weather_alert_sent: boolean;
  weather_alert_acknowledged: boolean;
  weather_alert_retry_count: number;
  weather_alert_last_sent_at?: string | null;
  weather_alert_message?: string | null;
  updated_at: string;
}

export interface ProjectTemplateItem {
  id: number;
  template_id: number;
  title: string;
  description?: string;
  category: TaskCategory;
  estimated_hours: number;
  curing_hours: number;
  order: number;
}

export interface ProjectTemplate {
  id: number;
  name: string;
  description?: string;
  created_at: string;
  items?: ProjectTemplateItem[];
}
