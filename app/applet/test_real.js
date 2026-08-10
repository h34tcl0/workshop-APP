const dataset = [
  { hour: 0, temperature_c: 6.7, relative_humidity: 79, precipitation_mm: 0, precipitation_probability: 7 },
  { hour: 1, temperature_c: 5.6, relative_humidity: 87, precipitation_mm: 0, precipitation_probability: 7 },
  { hour: 2, temperature_c: 4.9, relative_humidity: 92, precipitation_mm: 0, precipitation_probability: 8 },
  { hour: 3, temperature_c: 4.5, relative_humidity: 93, precipitation_mm: 0, precipitation_probability: 12 },
  { hour: 4, temperature_c: 4.7, relative_humidity: 92, precipitation_mm: 0, precipitation_probability: 16 },
  { hour: 5, temperature_c: 4.6, relative_humidity: 93, precipitation_mm: 0, precipitation_probability: 20 },
  { hour: 6, temperature_c: 4.5, relative_humidity: 93, precipitation_mm: 0, precipitation_probability: 22 },
  { hour: 7, temperature_c: 5.4, relative_humidity: 90, precipitation_mm: 0, precipitation_probability: 23 },
  { hour: 8, temperature_c: 5.5, relative_humidity: 90, precipitation_mm: 0, precipitation_probability: 22 },
  { hour: 9, temperature_c: 7.6, relative_humidity: 82, precipitation_mm: 0, precipitation_probability: 19 },
  { hour: 10, temperature_c: 9.7, relative_humidity: 78, precipitation_mm: 0, precipitation_probability: 15 },
  { hour: 11, temperature_c: 11.9, relative_humidity: 72, precipitation_mm: 0, precipitation_probability: 12 },
  { hour: 12, temperature_c: 13.7, relative_humidity: 68, precipitation_mm: 0, precipitation_probability: 10 },
  { hour: 13, temperature_c: 15.0, relative_humidity: 65, precipitation_mm: 0, precipitation_probability: 9 },
  { hour: 14, temperature_c: 15.9, relative_humidity: 65, precipitation_mm: 0, precipitation_probability: 10 },
  { hour: 15, temperature_c: 16.2, relative_humidity: 66, precipitation_mm: 0, precipitation_probability: 15 },
  { hour: 16, temperature_c: 15.8, relative_humidity: 67, precipitation_mm: 0, precipitation_probability: 21 },
  { hour: 17, temperature_c: 14.9, relative_humidity: 70, precipitation_mm: 0, precipitation_probability: 29 },
  { hour: 18, temperature_c: 13.5, relative_humidity: 74, precipitation_mm: 0, precipitation_probability: 39 },
  { hour: 19, temperature_c: 12.3, relative_humidity: 80, precipitation_mm: 0, precipitation_probability: 50 },
  { hour: 20, temperature_c: 12.0, relative_humidity: 81, precipitation_mm: 0, precipitation_probability: 55 },
  { hour: 21, temperature_c: 11.4, relative_humidity: 82, precipitation_mm: 0, precipitation_probability: 50 },
  { hour: 22, temperature_c: 10.3, relative_humidity: 84, precipitation_mm: 0, precipitation_probability: 38 },
  { hour: 23, temperature_c: 9.9, relative_humidity: 83, precipitation_mm: 0, precipitation_probability: 27 }
];

const startHour = 11;
const endHour = 21; // Jornada: 11:00 a 21:00 (10 horas: 11,12,13,14,15,16,17,18,19,20)
const maxHum = 85;
const minRain = 0.2;

// Simulación de auditoría horaria getHourlyClimateAudit
console.log('=== AUDITORÍA HORARIA DE RIESGOS ===');
let redRiskHours = [];
let amberProbHours = [];

for (const f of dataset) {
  const isHumid = f.relative_humidity > maxHum;
  const isRainOld = f.precipitation_mm >= minRain || f.precipitation_probability >= 30; // Bug anterior
  const isRainNew = f.precipitation_mm >= minRain; // Corregido
  const isProbWarning = f.precipitation_probability >= 50 && !isRainNew;

  let risks = [];
  if (isHumid) risks.push(`Humedad ${f.relative_humidity}% (> ${maxHum}%)`);
  if (isRainNew) risks.push(`Lluvia ${f.precipitation_mm}mm`);
  if (isProbWarning) risks.push(`Probabilidad de lluvia (${f.precipitation_probability}%)`);

  if (isHumid || isRainNew) {
    redRiskHours.push({ hour: f.hour, risks, hum: f.relative_humidity, rain: f.precipitation_mm });
  } else if (isProbWarning) {
    amberProbHours.push({ hour: f.hour, risks, prob: f.precipitation_probability });
  }
}

console.log('1. Horas con Riesgo Crítico (Rojo, Humedad >85% o Lluvia >=0.2mm):');
redRiskHours.forEach(h => console.log(`   ${String(h.hour).padStart(2, '0')}:00 ->`, h.risks.join(' | ')));

console.log('\n2. Horas con Alerta Secundaria (Ámbar, Probabilidad >=50% con 0mm rain):');
amberProbHours.forEach(h => console.log(`   ${String(h.hour).padStart(2, '0')}:00 ->`, h.risks.join(' | ')));

// Confirmación punto 3
const redOnlyProb = dataset.filter(f => {
  const isHum = f.relative_humidity > maxHum;
  const isRain = f.precipitation_mm >= minRain;
  const isProb = f.precipitation_probability >= 50;
  return isProb && !isHum && !isRain;
});
console.log('\n3. Horas con probabilidad >=50% que NO superan humedad ni mm de lluvia:', redOnlyProb.map(f => `${String(f.hour).padStart(2, '0')}:00`));

// Cálculo del Índice de Eficiencia Climática
let oldJornadaOk = 0, oldFueraOk = 0;
let newJornadaOk = 0, newFueraOk = 0;
let totalJornada = 0, totalFuera = 0;

for (const f of dataset) {
  const h = f.hour;
  const isJornada = (h >= startHour && h < endHour);

  const isOkOld = (f.precipitation_mm < minRain && f.precipitation_probability < 30 && f.relative_humidity <= maxHum);
  const isOkNew = (f.precipitation_mm < minRain && f.relative_humidity <= maxHum);

  if (isJornada) {
    totalJornada++;
    if (isOkOld) oldJornadaOk++;
    if (isOkNew) newJornadaOk++;
  } else {
    totalFuera++;
    if (isOkOld) oldFueraOk++;
    if (isOkNew) newFueraOk++;
  }
}

const oldPJ = oldJornadaOk / totalJornada;
const oldPF = oldFueraOk / totalFuera;
const oldIndex = Math.round((oldPJ * 0.80 + oldPF * 0.20) * 100);

const newPJ = newJornadaOk / totalJornada;
const newPF = newFueraOk / totalFuera;
const newIndex = Math.round((newPJ * 0.80 + newPF * 0.20) * 100);

console.log('\n=== CÁLCULO DEL ÍNDICE DE EFICIENCIA CLIMÁTICA ===');
console.log(`Jornada (11:00 - 21:00) -> Total ${totalJornada}h | Fuera de jornada -> Total ${totalFuera}h`);
console.log('CON EL BUG ACTIVO (probabilidad >=30% contaba como fallo de lluvia):');
console.log(`  Jornada OK: ${oldJornadaOk}/${totalJornada} (${Math.round(oldPJ*100)}%) [Fallaban 18:00, 19:00, 20:00 por prob. >=30%]`);
console.log(`  Fuera OK: ${oldFueraOk}/${totalFuera} (${Math.round(oldPF*100)}%) [Fallaban 01:00-08:00 por humedad y 21:00, 22:00 por prob. >=30%]`);
console.log(`  ÍNDICE ANTERIOR: ${oldIndex}% (80% * ${Math.round(oldPJ*100)}% + 20% * ${Math.round(oldPF*100)}% = ${(oldPJ*80 + oldPF*20).toFixed(1)}%)`);

console.log('\nCON EL FIX IMPLEMENTADO (sólo mm de lluvia reales >=0.2mm y humedad <=85%):');
console.log(`  Jornada OK: ${newJornadaOk}/${totalJornada} (${Math.round(newPJ*100)}%) [10/10h operativas, 100% libre de restricciones real]`);
console.log(`  Fuera OK: ${newFueraOk}/${totalFuera} (${Math.round(newPF*100)}%) [6/14h operativas, 8h nocturnas 01:00-08:00 afectadas por humedad >85%]`);
console.log(`  ÍNDICE CORREGIDO: ${newIndex}% (80% * 100% + 20% * 43% = ${(newPJ*80 + newPF*20).toFixed(1)}%)`);
