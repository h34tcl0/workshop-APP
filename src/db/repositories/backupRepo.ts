import path from "path";
import { getDb, DB_DIR, ensureDbDirExists } from "../connection.js";

export class BackupRepository {
  backupDatabase(destinationPath?: string): string {
    ensureDbDirExists();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = destinationPath || path.join(DB_DIR, `backup-${timestamp}.db`);
    getDb().prepare("VACUUM INTO ?").run(dest);
    console.log(`[DB BACKUP] Consistent WAL database backup generated at: ${dest}`);
    return dest;
  }
}

export const backupRepo = new BackupRepository();
