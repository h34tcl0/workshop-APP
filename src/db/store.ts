import Database from "better-sqlite3";
import { AppSettings, CalculatorOffset, CuringSession, DailyLog, DayOverride, Material, Project, ProjectTemplate, Task, Tool, User } from "../types.js";
import { getDb } from "./connection.js";
import { userRepo } from "./repositories/userRepo.js";
import { settingsRepo } from "./repositories/settingsRepo.js";
import { projectRepo } from "./repositories/projectRepo.js";
import { taskRepo } from "./repositories/taskRepo.js";
import { dailyLogRepo } from "./repositories/dailyLogRepo.js";
import { dayOverrideRepo } from "./repositories/dayOverrideRepo.js";
import { inventoryRepo } from "./repositories/inventoryRepo.js";
import { curingRepo } from "./repositories/curingRepo.js";
import { calculatorRepo } from "./repositories/calculatorRepo.js";
import { backupRepo } from "./repositories/backupRepo.js";

import { adminRepo } from "./repositories/adminRepo.js";

export class SQLiteStore {
  get db(): Database.Database { return getDb(); }
  getAppSettings = (u: number): AppSettings => settingsRepo.getAppSettings(u); updateAppSettings = (u: number, d: Partial<AppSettings>) => settingsRepo.updateAppSettings(u, d);
  getUserByTelegramChatId = (c: string | number) => settingsRepo.getUserByTelegramChatId(c); generateTelegramLinkCode = (u: number) => settingsRepo.generateTelegramLinkCode(u);
  consumeTelegramLinkCode = (code: string, ch: string) => settingsRepo.consumeTelegramLinkCode(code, ch); unlinkTelegram = (u: number) => settingsRepo.unlinkTelegram(u); unlinkTelegramByChatId = (c: string) => settingsRepo.unlinkTelegramByChatId(c);
  getProjects = (u: number): Project[] => projectRepo.getProjects(u); getProjectById = (u: number, id: number) => projectRepo.getProjectById(u, id); getActiveProject = (u: number) => projectRepo.getActiveProject(u);
  addProject = (u: number, n: string, d?: string) => projectRepo.addProject(u, n, d); setActiveProject = (u: number, id: number) => projectRepo.setActiveProject(u, id);
  toggleProjectActive = (u: number, id: number, a?: boolean) => projectRepo.toggleProjectActive(u, id, a); updateProject = (u: number, id: number, d: any) => projectRepo.updateProject(u, id, d);
  getProjectTemplates = (u: number): ProjectTemplate[] => projectRepo.getProjectTemplates(u); getProjectTemplate = (u: number, id: number) => projectRepo.getProjectTemplate(u, id);
  getProjectTemplateItems = (u: number, id: number) => projectRepo.getProjectTemplateItems(u, id); deleteProjectTemplate = (u: number, id: number) => projectRepo.deleteProjectTemplate(u, id);
  createProjectTemplateFromBacklog = (u: number, n: string, d?: string, p?: number) => projectRepo.createProjectTemplateFromBacklog(u, n, d, p, (usr, prj) => taskRepo.getPendingTasksForProject(usr, prj));
  applyProjectTemplate = (u: number, t: number, p?: number): Task[] => taskRepo.applyProjectTemplate(u, t, p);
  getTasks = (u: number): Task[] => taskRepo.getTasks(u); getPendingTasks = (u: number, p?: number) => taskRepo.getPendingTasks(u, p);
  getPendingTasksForActiveProjects = (u: number) => taskRepo.getPendingTasksForActiveProjects(u); getPendingTasksForProject = (u: number, p: number) => taskRepo.getPendingTasksForProject(u, p);
  getTask = (u: number, id: number) => taskRepo.getTask(u, id); getTaskGlobal = (id: number) => taskRepo.getTaskGlobal(id); toggleTaskActive = (u: number, id: number, a?: boolean) => taskRepo.toggleTaskActive(u, id, a);
  addTask = (u: number, d: any): Task => taskRepo.addTask(u, d); updateTask = (u: number, id: number, d: Partial<Task>) => taskRepo.updateTask(u, id, d); updateTaskGlobal = (id: number, d: Partial<Task>) => taskRepo.updateTaskGlobal(id, d);
  deleteTask = (u: number, id: number) => taskRepo.deleteTask(u, id); moveTaskUp = (u: number, id: number) => taskRepo.moveTaskUp(u, id); moveTaskDown = (u: number, id: number) => taskRepo.moveTaskDown(u, id);
  reorderTasks = (u: number, ids: number[]) => taskRepo.reorderTasks(u, ids); getRecentCompletedHistory = (u: number) => taskRepo.getRecentCompletedHistory(u); getTaskHistory = (u: number) => taskRepo.getTaskHistory(u);
  getDayOverride = (u: number, d: string): DayOverride | null => dayOverrideRepo.getDayOverride(u, d); saveDayOverride = (u: number, d: string, data: any) => dayOverrideRepo.saveDayOverride(u, d, data);
  clearDayOverride = (u: number, d: string) => dayOverrideRepo.clearDayOverride(u, d); getForcedTasksForDate = (u: number, d: string) => dayOverrideRepo.getForcedTasksForDate(u, d);
  addForcedTask = (u: number, d: string, t: number, h: number) => dayOverrideRepo.addForcedTask(u, d, t, h); deleteForcedTask = (u: number, id: number) => dayOverrideRepo.deleteForcedTask(u, id);
  getDailyLogByDate = (u: number, d: string): DailyLog | null => dailyLogRepo.getDailyLogByDate(u, d); getDailyLogById = (u: number, id: number) => dailyLogRepo.getDailyLogById(u, id);
  getDailyLogsForRange = (u: number, s: string, e: string): DailyLog[] => dailyLogRepo.getDailyLogsForRange(u, s, e); getFutureDailyLogsWithEvent = (u: number, f: string) => dailyLogRepo.getFutureDailyLogsWithEvent(u, f);
  getDailyLogByIdGlobal = (id: number) => dailyLogRepo.getDailyLogByIdGlobal(id); saveDailyLog = (u: number, d: any) => dailyLogRepo.saveDailyLog(u, d); updateDailyLog = (u: number, id: number, d: Partial<DailyLog>) => dailyLogRepo.updateDailyLog(u, id, d);
  claimCalendarSync = (u: number, id: number) => dailyLogRepo.claimCalendarSync(u, id); releaseCalendarSync = (u: number, id: number) => dailyLogRepo.releaseCalendarSync(u, id); updateDailyLogGlobal = (id: number, d: Partial<DailyLog>) => dailyLogRepo.updateDailyLogGlobal(id, d);
  getAllUsers = (): User[] => userRepo.getAllUsers(); getActiveUsers = (): User[] => userRepo.getActiveUsers(); getUserByEmail = (e: string) => userRepo.getUserByEmail(e); getUserById = (id: number) => userRepo.getUserById(id);
  createUser = (e: string, p: string, r?: any) => userRepo.createUser(e, p, r); setUserRole = (u: number, r: any) => userRepo.setUserRole(u, r); setUserStatus = (u: number, s: any, reason?: string | null) => userRepo.setUserStatus(u, s, reason); updateUserPassword = (u: number, p: string) => userRepo.updateUserPassword(u, p);
  getSystemSettings = () => adminRepo.getSystemSettings(); updateSystemSettings = (s: any) => adminRepo.updateSystemSettings(s);
  getAccountLimits = (u: number) => adminRepo.getAccountLimits(u); setAccountLimits = (l: any) => adminRepo.setAccountLimits(l);
  logAdminAction = (l: any) => adminRepo.logAdminAction(l); getAuditLogs = (limit?: number, offset?: number) => adminRepo.getAuditLogs(limit, offset);
  getMaterials = (u: number, p?: number): Material[] => inventoryRepo.getMaterials(u, p); getMaterial = (u: number, id: number) => inventoryRepo.getMaterial(u, id);
  addMaterial = (u: number, d: any) => inventoryRepo.addMaterial(u, d); updateMaterial = (u: number, id: number, d: any) => inventoryRepo.updateMaterial(u, id, d);
  toggleMaterialStatus = (u: number, id: number) => inventoryRepo.toggleMaterialStatus(u, id); setMaterialStatus = (u: number, id: number, s: string) => inventoryRepo.setMaterialStatus(u, id, s); deleteMaterial = (u: number, id: number) => inventoryRepo.deleteMaterial(u, id);
  importMaterialsFromJson = (u: number, l: any[], p?: number) => inventoryRepo.importMaterialsFromJson(u, l, p); getPendingMaterialsGroupedByProject = (u: number) => inventoryRepo.getPendingMaterialsGroupedByProject(u);
  getTools = (u: number, c?: string): Tool[] => inventoryRepo.getTools(u, c); getTool = (u: number, id: number) => inventoryRepo.getTool(u, id);
  addTool = (u: number, d: any) => inventoryRepo.addTool(u, d); updateTool = (u: number, id: number, d: any) => inventoryRepo.updateTool(u, id, d);
  setToolStatus = (u: number, id: number, s: string) => inventoryRepo.setToolStatus(u, id, s); deleteTool = (u: number, id: number) => inventoryRepo.deleteTool(u, id); getPendingTools = (u: number) => inventoryRepo.getPendingTools(u);
  getCalculatorOffsets = (u: number): CalculatorOffset[] => calculatorRepo.getCalculatorOffsets(u); getCalculatorOffset = (u: number, id: number) => calculatorRepo.getCalculatorOffset(u, id);
  addCalculatorOffset = (u: number, d: any) => calculatorRepo.addCalculatorOffset(u, d); updateCalculatorOffset = (u: number, id: number, d: any) => calculatorRepo.updateCalculatorOffset(u, id, d); deleteCalculatorOffset = (u: number, id: number) => calculatorRepo.deleteCalculatorOffset(u, id);
  getActiveCuringSessions = (u: number): CuringSession[] => curingRepo.getActiveCuringSessions(u); getCuringSessionsByTask = (u: number, tid: number) => curingRepo.getCuringSessionsByTask(u, tid);
  startCuringSession = (u: number, d: any) => curingRepo.startCuringSession(u, d); completeCuringSession = (u: number, id: number) => curingRepo.completeCuringSession(u, id); interruptCuringSession = (u: number, id: number) => curingRepo.interruptCuringSession(u, id);
  backupDatabase = (dest?: string): string => backupRepo.backupDatabase(dest);
}

export const store = new SQLiteStore();
