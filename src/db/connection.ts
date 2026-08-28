import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export const DB_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
export const DB_PATH = path.join(DB_DIR, "workshop.db");

let dbInstance: Database.Database | null = null;

export function ensureDbDirExists(dirPath: string = DB_DIR): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function initDbConnection(customPath?: string): Database.Database {
  if (dbInstance) return dbInstance;

  const targetPath = customPath || DB_PATH;
  if (targetPath !== ":memory:") {
    ensureDbDirExists(path.dirname(targetPath));
  }

  dbInstance = new Database(targetPath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");

  return dbInstance;
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    throw new Error("SQLite Database not initialized. Call initDatabase() first.");
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    console.log("[DB] Closing SQLite database connection safely...");
    dbInstance.close();
    dbInstance = null;
  }
}
