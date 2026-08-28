import { AppSettings, TimeWindow, ClimateSegment, BarSegments, TimelineItem } from "../types.js";
import { sliceClimateSegments } from "./segments.js";

export function calculateBarSegments(
  window: TimeWindow,
  timeline: TimelineItem[],
  cfg: AppSettings,
  climateSegments: ClimateSegment[] = []
): BarSegments {
  const totalDayHours = Math.max(1.0, cfg.operational_end_hour - cfg.operational_start_hour);
  const [sH, sM] = window.start_time.split(":").map(Number);
  const startH = sH + sM / 60.0;
  const closedBeforeH = Math.max(0.0, startH - cfg.operational_start_hour);
  const setupH = cfg.setup_hours;
  const workH = window.net_work_hours;
  const teardownH = cfg.teardown_hours;

  let curingH = 0.0;
  for (const item of timeline) {
    if (item.title.includes("Curado") || item.title.includes("Secado")) {
      const match = item.duration.match(/([0-9.]+)/);
      if (match) curingH += parseFloat(match[1]) || 0.0;
    }
  }

  const endActivityH = startH + setupH + workH + teardownH + curingH;
  const closedAfterH = Math.max(0.0, cfg.operational_end_hour - endActivityH);
  const beforeClimate = sliceClimateSegments(climateSegments, cfg.operational_start_hour, startH);
  const afterClimate = sliceClimateSegments(
    climateSegments,
    Math.min(endActivityH, cfg.operational_end_hour),
    cfg.operational_end_hour
  );

  return {
    closed_before_h: closedBeforeH,
    pct_closed_before: (closedBeforeH / totalDayHours) * 100,
    before_segments: beforeClimate.map(seg => ({
      pct: ((seg.end_h - seg.start_h) / totalDayHours) * 100,
      condition: seg.condition,
      start_h: seg.start_h,
      end_h: seg.end_h
    })),
    setup_h: setupH,
    pct_setup: (setupH / totalDayHours) * 100,
    work_h: workH,
    pct_work: (workH / totalDayHours) * 100,
    teardown_h: teardownH,
    pct_teardown: (teardownH / totalDayHours) * 100,
    curing_h: curingH,
    pct_curing: (curingH / totalDayHours) * 100,
    closed_after_h: closedAfterH,
    pct_closed_after: (closedAfterH / totalDayHours) * 100,
    after_segments: afterClimate.map(seg => ({
      pct: ((seg.end_h - seg.start_h) / totalDayHours) * 100,
      condition: seg.condition,
      start_h: seg.start_h,
      end_h: seg.end_h
    }))
  };
}
