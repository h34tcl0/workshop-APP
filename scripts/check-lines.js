import fs from "fs";
import path from "path";

const TARGET_DIRECTORIES = ["src", "static/js", "views"];
const TARGET_ROOT_FILES = ["server.ts"];
const VALID_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs", ".ejs", ".html", ".css", ".json"];
const EXCLUDE_DIRS = ["node_modules", "dist", ".git", "coverage", ".vscode"];

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content) return 0;
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

function scanDir(dir, baseDir = process.cwd()) {
  let results = [];
  const fullPath = path.resolve(baseDir, dir);
  if (!fs.existsSync(fullPath)) {
    return results;
  }

  const entries = fs.readdirSync(fullPath, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_DIRS.includes(entry.name)) continue;
    const fullEntryPath = path.join(fullPath, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(scanDir(path.relative(baseDir, fullEntryPath), baseDir));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VALID_EXTENSIONS.includes(ext)) {
        results.push(fullEntryPath);
      }
    }
  }
  return results;
}

function categorize(lines) {
  if (lines > 400) return "RED";
  if (lines >= 250) return "YELLOW";
  return "GREEN";
}

function runAudit() {
  const cwd = process.cwd();
  let filesToScan = [];

  for (const rootFile of TARGET_ROOT_FILES) {
    const fullRootPath = path.resolve(cwd, rootFile);
    if (fs.existsSync(fullRootPath)) {
      filesToScan.push(fullRootPath);
    }
  }

  for (const targetDir of TARGET_DIRECTORIES) {
    filesToScan = filesToScan.concat(scanDir(targetDir, cwd));
  }

  filesToScan = Array.from(new Set(filesToScan));

  const stats = filesToScan.map((file) => {
    const rel = path.relative(cwd, file);
    const lines = countLines(file);
    return {
      filePath: file,
      relativePath: rel,
      lineCount: lines,
      category: categorize(lines),
    };
  });

  stats.sort((a, b) => b.lineCount - a.lineCount);

  const redFiles = stats.filter((s) => s.category === "RED");
  const yellowFiles = stats.filter((s) => s.category === "YELLOW");
  const greenFiles = stats.filter((s) => s.category === "GREEN");
  const totalLines = stats.reduce((acc, curr) => acc + curr.lineCount, 0);

  console.log("\n========================================================");
  console.log("   AGENDAPP - AUDITORÍA DE LÍNEAS Y MODULARIDAD");
  console.log("========================================================\n");
  console.log(`📊 Archivos analizados     : ${stats.length}`);
  console.log(`📝 Total de líneas de código: ${totalLines.toLocaleString()}`);
  console.log(`🚨 Zona Roja (>400 líneas) : ${redFiles.length}`);
  console.log(`⚠️ Zona Amarilla (250-400) : ${yellowFiles.length}`);
  console.log(`🟢 Zona Verde (<250 líneas): ${greenFiles.length}\n`);

  if (redFiles.length > 0) {
    console.log("🚨 [ZONA ROJA] - Archivos que superan las 400 líneas (Prioridad de Refactorización):");
    console.table(
      redFiles.map((f) => ({
        "Archivo": f.relativePath,
        "Líneas": f.lineCount,
        "Estado": "🚨 CRÍTICO (>400)",
      }))
    );
  } else {
    console.log("✅ [ZONA ROJA] - ¡Excelente! No se encontraron archivos con más de 400 líneas.");
  }

  if (yellowFiles.length > 0) {
    console.log("\n⚠️ [ZONA AMARILLA] - Archivos entre 250 y 400 líneas (Alerta de Crecimiento):");
    console.table(
      yellowFiles.map((f) => ({
        "Archivo": f.relativePath,
        "Líneas": f.lineCount,
        "Estado": "⚠️ ALERTA (250-400)",
      }))
    );
  }

  console.log(`\n🟢 [ZONA VERDE] - ${greenFiles.length} archivos mantienen una longitud óptima (<250 líneas).`);
  console.log("\n========================================================\n");

  return {
    totalFiles: stats.length,
    totalLines,
    redFiles,
    yellowFiles,
    greenFiles,
    allStats: stats,
  };
}

runAudit();
