import { initDatabase, getDb } from "../src/db.js";

async function main() {
  await initDatabase();
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(day_overrides)").all();
  console.log("\n=======================================================");
  console.log(" PRAGMA table_info(day_overrides)");
  console.log("=======================================================");
  console.table(columns);
  
  const hasRangeOrigin = columns.some((c) => c.name === "range_origin");
  const hasPrevState = columns.some((c) => c.name === "previous_state_json");

  console.log(`\nVerificación de nuevas columnas:`);
  console.log(` - range_origin: ${hasRangeOrigin ? "✅ PRESENTE" : "❌ FALTANTE"}`);
  console.log(` - previous_state_json: ${hasPrevState ? "✅ PRESENTE" : "❌ FALTANTE"}\n`);

  process.exit(0);
}

main().catch(err => {
  console.error("Error verificando esquema:", err);
  process.exit(1);
});
