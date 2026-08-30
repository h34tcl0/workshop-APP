/**
 * Screws & Fasteners Calculator Engine (Huincha Corrida & SVG)
 */

let screwMode = 'max_dist'; // 'max_dist' | 'fixed_qty'
let currentTapeMarks = [];

function setScrewMode(mode) {
    screwMode = mode;
    const btnMax = document.getElementById('screw-mode-max-dist');
    const btnQty = document.getElementById('screw-mode-fixed-qty');
    const lbl = document.getElementById('screw-target-label');
    const input = document.getElementById('screw-input-target');

    if (mode === 'fixed_qty') {
        if (btnQty) {
            btnQty.className = 'py-1.5 px-2 rounded-lg text-xs font-bold bg-brass text-canvas transition-all';
        }
        if (btnMax) {
            btnMax.className = 'py-1.5 px-2 rounded-lg text-xs font-medium text-ink2 hover:text-ink transition-all';
        }
        if (lbl) lbl.innerHTML = 'Cantidad Fijaciones (<span class="text-brass">N</span> tornillos)';
        if (input) {
            input.placeholder = 'Ej. 5';
            input.value = '5';
            input.min = '2';
        }
    } else {
        if (btnMax) {
            btnMax.className = 'py-1.5 px-2 rounded-lg text-xs font-bold bg-brass text-canvas transition-all';
        }
        if (btnQty) {
            btnQty.className = 'py-1.5 px-2 rounded-lg text-xs font-medium text-ink2 hover:text-ink transition-all';
        }
        if (lbl) lbl.innerHTML = 'Separación Máx (<span class="text-brass">S máx</span> mm)';
        if (input) {
            input.placeholder = 'Ej. 250';
            input.value = '250';
            input.min = '1';
        }
    }
    calculateScrews();
}

function calculateScrews() {
    const lInput = document.getElementById('screw-input-length');
    const mInput = document.getElementById('screw-input-margin');
    const tInput = document.getElementById('screw-input-target');
    const zzInput = document.getElementById('screw-opt-zigzag');

    const errBanner = document.getElementById('screw-error-banner');
    const errText = document.getElementById('screw-error-text');
    const utilBadge = document.getElementById('screw-util-length-badge');

    const resCount = document.getElementById('screw-res-count');
    const resSpacing = document.getElementById('screw-res-spacing');
    const resIntervals = document.getElementById('screw-res-intervals');

    if (!lInput || !mInput || !tInput) return;

    const L = parseFloat(lInput.value) || 0;
    const M = parseFloat(mInput.value) || 0;
    const targetVal = parseFloat(tInput.value) || 0;
    const isZigzag = zzInput ? zzInput.checked : false;

    const L_util = L - (2 * M);
    if (utilBadge) utilBadge.innerText = `L. Útil: ${L_util > 0 ? L_util : 0} mm`;

    // Validación: margen no viable
    if (L <= 0 || (2 * M) >= L || targetVal <= 0) {
        if (errBanner) {
            errBanner.classList.remove('hidden');
            if (errText) errText.innerText = (2 * M) >= L ? 'El margen a ambos extremos (2 × M) supera o iguala el largo total.' : 'Ingresa dimensiones válidas mayores a cero.';
        }
        if (resCount) resCount.innerText = '-';
        if (resSpacing) resSpacing.innerText = '-';
        if (resIntervals) resIntervals.innerText = '-';
        renderTapeMarks([]);
        renderScrewSvg(L, M, [], isZigzag, true);
        return;
    }

    if (errBanner) errBanner.classList.add('hidden');

    let intervals = 1;
    let screwCount = 2;
    let actualSpacing = L_util;

    if (screwMode === 'fixed_qty') {
        screwCount = Math.max(2, Math.round(targetVal));
        intervals = screwCount - 1;
        actualSpacing = intervals > 0 ? (L_util / intervals) : 0;
    } else {
        intervals = Math.max(1, Math.ceil(L_util / targetVal));
        screwCount = intervals + 1;
        actualSpacing = L_util / intervals;
    }

    const roundedSpacing = Math.round(actualSpacing * 10) / 10;

    // Calcular marcas de huincha corrida
    const marks = [];
    for (let i = 0; i < screwCount; i++) {
        const mark = M + (i * actualSpacing);
        marks.push(Math.round(mark * 10) / 10);
    }
    currentTapeMarks = marks;

    if (resCount) resCount.innerText = String(screwCount);
    if (resSpacing) resSpacing.innerText = `${roundedSpacing} mm`;
    if (resIntervals) resIntervals.innerText = String(intervals);

    renderTapeMarks(marks);
    renderScrewSvg(L, M, marks, isZigzag, false);
}

function renderTapeMarks(marks) {
    const container = document.getElementById('screw-tape-marks-container');
    if (!container) return;

    if (!marks || marks.length === 0) {
        container.innerHTML = '<span class="text-ink3 text-xs italic">Sin marcas para mostrar</span>';
        return;
    }

    let html = '';
    marks.forEach((m, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === marks.length - 1;
        const badgeColor = (isFirst || isLast) ? 'bg-brass/20 text-brass border-brass/50 font-bold' : 'bg-surface border-hairline text-ink font-semibold';
        html += `
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border ${badgeColor} shadow-2xs">
                <span class="text-[9px] text-ink3">#${idx + 1}:</span>
                <span>${m} mm</span>
            </span>
        `;
    });
    container.innerHTML = html;
}

function renderScrewSvg(L, M, marks, isZigzag, isError) {
    const svg = document.getElementById('screw-svg-canvas');
    if (!svg) return;

    if (isError || !marks || marks.length === 0) {
        svg.innerHTML = `
            <rect x="50" y="45" width="700" height="40" rx="8" fill="#1e293b" stroke="#334155" stroke-width="2"/>
            <text x="400" y="70" text-anchor="middle" fill="#64748b" font-family="monospace" font-size="12">Parámetros no válidos</text>
        `;
        return;
    }

    const svgWidth = 800;
    const boardX = 60;
    const boardY = 40;
    const boardW = 680;
    const boardH = 46;

    const scale = boardW / L;

    let screwsSvg = '';
    marks.forEach((m, idx) => {
        const cx = boardX + (m * scale);
        let cy = boardY + (boardH / 2);
        if (isZigzag) {
            cy = idx % 2 === 0 ? (boardY + 14) : (boardY + boardH - 14);
        }

        screwsSvg += `
            <g class="screw-marker">
                <!-- Sombra / Aro -->
                <circle cx="${cx}" cy="${cy}" r="7" fill="#0f172a" stroke="#d97706" stroke-width="2"/>
                <!-- Cruz de tornillo -->
                <line x1="${cx - 4}" y1="${cy}" x2="${cx + 4}" y2="${cy}" stroke="#fbbf24" stroke-width="1.5"/>
                <line x1="${cx}" y1="${cy - 4}" x2="${cx}" y2="${cy + 4}" stroke="#fbbf24" stroke-width="1.5"/>
                <!-- Etiqueta con cota -->
                <text x="${cx}" y="${cy > boardY + 23 ? cy + 18 : cy - 11}" text-anchor="middle" fill="#cbd5e1" font-family="monospace" font-size="9" font-weight="bold">${m}</text>
            </g>
        `;
    });

    const firstMarkX = boardX + (marks[0] * scale);
    const lastMarkX = boardX + (marks[marks.length - 1] * scale);

    svg.innerHTML = `
        <!-- Borde / Tablero base -->
        <rect x="${boardX}" y="${boardY}" width="${boardW}" height="${boardH}" rx="6" fill="#1e293b" stroke="#475569" stroke-width="2"/>
        <!-- Textura / Eje central -->
        <line x1="${boardX}" y1="${boardY + boardH/2}" x2="${boardX + boardW}" y2="${boardY + boardH/2}" stroke="#334155" stroke-dasharray="4 4" stroke-width="1"/>
        
        <!-- Cotas de Margen Extremos -->
        <line x1="${boardX}" y1="20" x2="${firstMarkX}" y2="20" stroke="#f59e0b" stroke-width="1.5"/>
        <line x1="${boardX}" y1="15" x2="${boardX}" y2="25" stroke="#f59e0b" stroke-width="1.5"/>
        <line x1="${firstMarkX}" y1="15" x2="${firstMarkX}" y2="25" stroke="#f59e0b" stroke-width="1.5"/>
        <text x="${(boardX + firstMarkX) / 2}" y="14" text-anchor="middle" fill="#f59e0b" font-family="monospace" font-size="9" font-weight="bold">M=${M}</text>

        <!-- Cotas Margen Final -->
        <line x1="${lastMarkX}" y1="20" x2="${boardX + boardW}" y2="20" stroke="#f59e0b" stroke-width="1.5"/>
        <line x1="${lastMarkX}" y1="15" x2="${lastMarkX}" y2="25" stroke="#f59e0b" stroke-width="1.5"/>
        <line x1="${boardX + boardW}" y1="15" x2="${boardX + boardW}" y2="25" stroke="#f59e0b" stroke-width="1.5"/>
        <text x="${(lastMarkX + boardX + boardW) / 2}" y="14" text-anchor="middle" fill="#f59e0b" font-family="monospace" font-size="9" font-weight="bold">M=${M}</text>

        <!-- Indicador Largo Total L -->
        <text x="${boardX + boardW/2}" y="118" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="10">Largo Total L = ${L} mm</text>

        <!-- Tornillos y Cruces -->
        ${screwsSvg}
    `;
}

function copyTapeMarksToClipboard() {
    if (!currentTapeMarks || currentTapeMarks.length === 0) return;
    const textToCopy = currentTapeMarks.map((m, i) => `#${i + 1}: ${m} mm`).join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
        const btnText = document.getElementById('screw-copy-btn-text');
        if (btnText) {
            const orig = btnText.innerText;
            btnText.innerText = '¡Copiado!';
            setTimeout(() => { btnText.innerText = orig; }, 2000);
        }
    }).catch(err => console.error('Error copying tape marks:', err));
}

document.addEventListener('DOMContentLoaded', () => {
    calculateScrews();
});

if (typeof window !== 'undefined') {
    window.setScrewMode = setScrewMode;
    window.calculateScrews = calculateScrews;
    window.copyTapeMarksToClipboard = copyTapeMarksToClipboard;
}
