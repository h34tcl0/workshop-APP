import { getLocalDateIso, getLocalHoursAndMinutes, getTargetTimeZone, LocalDate } from "./dateUtils.js";
import { NotificationDispatcher } from "./notificationDispatcher.js";

import {
  LOCK_TIMEOUT_MS,
  setLockTimeoutForTest,
  isEvaluationInProgress,
  acquireEvaluationLock,
  releaseEvaluationLock
} from "./scheduler/locks.js";

import {
  syncMultiDayCalendar,
  reconcileCalendarEvents
} from "./scheduler/calendarReconciler.js";

import {
  runMorningEvaluation,
  triggerSilentReevaluation
} from "./scheduler/horizonRunner.js";

import {
  processWorkStartNotificationsForUser,
  processCheckinForUser,
  runCheckinTick,
  processWeatherAlertForUser,
  runWeatherAlertTick,
  runWorkStartTick,
  runMorningEvalTick,
  startDaemon,
  stopDaemon
} from "./scheduler/daemon.js";

export {
  // Date utils & notification dispatcher re-exports
  getLocalDateIso,
  getLocalHoursAndMinutes,
  getTargetTimeZone,
  LocalDate,
  NotificationDispatcher,

  // Lock management
  LOCK_TIMEOUT_MS,
  setLockTimeoutForTest,
  isEvaluationInProgress,
  acquireEvaluationLock,
  releaseEvaluationLock,

  // Calendar reconciliation
  syncMultiDayCalendar,
  reconcileCalendarEvents,

  // Horizon runner
  runMorningEvaluation,
  triggerSilentReevaluation,

  // Daemon ticks and lifecycle
  processWorkStartNotificationsForUser,
  processCheckinForUser,
  runCheckinTick,
  processWeatherAlertForUser,
  runWeatherAlertTick,
  runWorkStartTick,
  runMorningEvalTick,
  startDaemon,
  stopDaemon
};
