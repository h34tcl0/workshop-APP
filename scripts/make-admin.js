#!/usr/bin/env node
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const args = process.argv.slice(2);
const isDemote = args.includes('--demote');
const email = args.find(a => !a.startsWith('--'));

if (!email) {
  console.error("Uso: node scripts/make-admin.js <email> [--demote]");
  process.exit(1);
}

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'workshop.db');

if (!fs.existsSync(dbPath)) {
  console.error(`Error: Base de datos no encontrada en '${dbPath}'. Inicie el servidor primero.`);
  process.exit(1);
}

let db = null;
try {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const normalizedEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT id, email, role FROM users WHERE LOWER(email) = LOWER(?)').get(normalizedEmail);

  if (!user) {
    console.error(`Error: Usuario con email '${email}' no encontrado en la base de datos.`);
    process.exit(1);
  }

  const targetRole = isDemote ? 'user' : 'admin';
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(targetRole, user.id);

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [CLI ADMIN] Rol del usuario '${user.email}' (ID #${user.id}) actualizado exitosamente a '${targetRole}'.`);
} catch (err) {
  console.error('Error al ejecutar make-admin:', err);
  process.exit(1);
} finally {
  if (db) {
    try {
      db.close();
    } catch {}
  }
}
