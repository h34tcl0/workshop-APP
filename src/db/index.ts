import {
  initDbConnection,
  getDb,
  closeDatabase,
  DB_DIR,
  DB_PATH,
  ensureDbDirExists
} from "./connection.js";
import { computeRequiresCuring } from "./helpers.js";
import { createTables } from "./schema.js";
import { runMigrations } from "./migrations.js";
import { seedDefaultsIfEmpty, cleanupDuplicateTelegramChatIds } from "./seeds.js";
import { SQLiteStore, store } from "./store.js";

export function initDatabase(customPath?: string): SQLiteStore {
  const db = initDbConnection(customPath);
  createTables(db);

  const defaultUser = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get() as any;
  const defaultUserId = defaultUser ? Number(defaultUser.id) : 1;

  runMigrations(db, defaultUserId);
  seedDefaultsIfEmpty(db);
  cleanupDuplicateTelegramChatIds(db);

  console.log(`[DB] SQLite database initialized successfully at: ${customPath || DB_PATH}`);
  return store;
}

export {
  initDbConnection,
  getDb,
  closeDatabase,
  DB_DIR,
  DB_PATH,
  ensureDbDirExists,
  computeRequiresCuring,
  createTables,
  runMigrations,
  seedDefaultsIfEmpty,
  cleanupDuplicateTelegramChatIds,
  SQLiteStore,
  store
};

export * from "./repositories/userRepo.js";
export * from "./repositories/settingsRepo.js";
export * from "./repositories/projectRepo.js";
export * from "./repositories/taskRepo.js";
export * from "./repositories/dailyLogRepo.js";
export * from "./repositories/dayOverrideRepo.js";
export * from "./repositories/inventoryRepo.js";
export * from "./repositories/curingRepo.js";
export * from "./repositories/calculatorRepo.js";
export * from "./repositories/backupRepo.js";
