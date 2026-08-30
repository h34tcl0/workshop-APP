/**
 * Diagonals & Square Calculator Engine (Modo Taller)
 */

let currentDiagReport = '';

function calculateDiagonals() {
    const wInput = document.getElementById('diag-input-width');
    const hInput = document.getElementById('diag-input-height');
    const d1Input = document.getElementById('diag-input-d1');
    const d2Input = document.getElementById('diag-input-d2');

    const theoryEl = document.getElementById('diag-res-theory');
    const diffEl = document.getElementById('diag-res-diff');
    const statusEl = document.getElementById('diag-res-status');
    const instrEl = document.getElementById('diag-clamp-instruction');

    if (!wInput || !hInput || !d1Input || !d2Input) return;

    const W = parseFloat(wInput.value) || 0;
    const H = parseFloat(hInput.value) || 0;
    const D1 = parseFloat(d1Input.value) || 0;
    const D2 = parseFloat(d2Input.value) || 0;

    if (W <= 0 || H <= 0 || D1 <= 0 || D2 <= 0) {
        if (theoryEl) theoryEl.innerText = '-';
        if (diffEl) diffEl.innerText = '-';
        if (statusEl) {
            statusEl.innerText = 'Inválido';
            statusEl.className = 'text-xs sm:text-sm font-bold uppercase tracking-tight px-2 py-0.5 rounded-md bg-surface border border-hairline text-ink3';
        }
        if (instrEl) instrEl.innerText = 'Ingresa dimensiones positivas para calcular la cuadratura.';
        if (typeof window.renderDiagonalsSvg === 'function') {
            window.renderDiagonalsSvg(W, H, D1, D2, 0, 0, 'invalid', 'none');
        }
        return;
    }

    const D_theory = Math.sqrt((W * W) + (H * H));
    const roundedTheory = Math.round(D_theory * 10) / 10;

    const diff = Math.abs(D1 - D2);
    const roundedDiff = Math.round(diff * 10) / 10;
    const halfDiff = Math.round((diff / 2) * 10) / 10;

    let statusKey = 'out_of_square';
    let statusLabel = 'Descuadrado';
    let statusClass = 'bg-rust/20 text-rust border-rust/40';

    if (diff <= 0.5) {
        statusKey = 'perfect';
        statusLabel = 'A Escuadra (Óptimo)';
        statusClass = 'bg-moss/20 text-moss border-moss/40';
    } else if (diff <= 1.5) {
        statusKey = 'acceptable';
        statusLabel = 'Tolerancia Aceptable';
        statusClass = 'bg-brass/20 text-brass border-brass/40';
    }

    if (theoryEl) theoryEl.innerText = `${roundedTheory} mm`;
    if (diffEl) diffEl.innerText = `${roundedDiff} mm`;
    if (statusEl) {
        statusEl.innerText = statusLabel;
        statusEl.className = `text-xs sm:text-sm font-bold uppercase tracking-tight px-2 py-0.5 rounded-md border ${statusClass}`;
    }

    let longDiag = 'none';
    let instructionText = '';

    if (diff === 0) {
        instructionText = `Estructura perfectamente escuadrada a 90.0° (D1 = D2 = ${D1} mm). No requiere compresión con prensas.`;
    } else if (D1 > D2) {
        longDiag = 'D1';
        instructionText = `La diagonal D1 (A ↔ C = ${D1} mm) es ${roundedDiff} mm más larga que D2 (${D2} mm). Coloca la prensa sargento entre la Esquina A (Sup-Izq) y la Esquina C (Inf-Der) y aprieta aproximadamente ~${halfDiff} mm hasta igualar ambas diagonales.`;
    } else {
        longDiag = 'D2';
        instructionText = `La diagonal D2 (B ↔ D = ${D2} mm) es ${roundedDiff} mm más larga que D1 (${D1} mm). Coloca la prensa sargento entre la Esquina B (Sup-Der) y la Esquina D (Inf-Izq) y aprieta aproximadamente ~${halfDiff} mm hasta igualar ambas diagonales.`;
    }

    if (instrEl) instrEl.innerText = instructionText;

    currentDiagReport = `Reporte de Escuadra & Diagonales:
- Dimensiones Nominales: ${W} mm × ${H} mm (Diagonal Teórica: ${roundedTheory} mm)
- Diagonal D1 (A-C): ${D1} mm
- Diagonal D2 (B-D): ${D2} mm
- Diferencia ΔD: ${roundedDiff} mm
- Estado: ${statusLabel}
- Recomendación: ${instructionText}`;

    if (typeof window.renderDiagonalsSvg === 'function') {
        window.renderDiagonalsSvg(W, H, D1, D2, roundedTheory, roundedDiff, statusKey, longDiag);
    }
}

function copyDiagonalsReportToClipboard() {
    if (!currentDiagReport) return;
    navigator.clipboard.writeText(currentDiagReport).then(() => {
        const btnText = document.getElementById('diag-copy-btn-text');
        if (btnText) {
            const orig = btnText.innerText;
            btnText.innerText = '¡Copiado!';
            setTimeout(() => { btnText.innerText = orig; }, 2000);
        }
    }).catch(err => console.error('Error copying diagonals report:', err));
}

document.addEventListener('DOMContentLoaded', () => {
    calculateDiagonals();
});

if (typeof window !== 'undefined') {
    window.calculateDiagonals = calculateDiagonals;
    window.copyDiagonalsReportToClipboard = copyDiagonalsReportToClipboard;
}
