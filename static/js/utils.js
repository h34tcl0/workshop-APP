/**
 * Workshop OS - Utilidades transversales de Frontend
 */

// ── Conversión de horas decimales a texto legible (ej: 1.5 -> "1h 30m") ──
function formatHoursToHm(decimalHours) {
    const totalMinutes = Math.round((parseFloat(decimalHours) || 0) * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h === 0 && m === 0) return '0h';
    if (m === 0) return `${h}h`;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
}

// ── Conversión de horas y minutos separados a número decimal redondeado ──
function parseHmToDecimal(hours, minutes) {
    const h = parseInt(hours, 10) || 0;
    const m = parseInt(minutes, 10) || 0;
    return Math.round((h + m / 60.0) * 100) / 100;
}

// ── Sincronizador genérico de inputs (horas + minutos -> input hidden decimal) ──
function syncDurationInputs(fieldPrefix) {
    const hInput = document.getElementById(fieldPrefix + '_h');
    const mInput = document.getElementById(fieldPrefix + '_m');
    const targetInput = document.getElementById('input_' + fieldPrefix + '_hours') || document.getElementById(fieldPrefix + '_hours');

    if (hInput && mInput && targetInput) {
        targetInput.value = parseHmToDecimal(hInput.value, mInput.value);
    }
}

// ── Toast unificado (notificación flotante en pantalla) ──
function showToast(msg, durationMs = 3000) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerText = msg;
    t.classList.remove('hidden');
    if (window._toastTimeout) clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => t.classList.add('hidden'), durationMs);
}

// Exportar globalmente a window
Object.assign(window, {
    formatHoursToHm,
    parseHmToDecimal,
    syncDurationInputs,
    showToast
});
