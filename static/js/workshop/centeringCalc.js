/**
 * Centering & Gap Distribution Calculator Controller
 */

let centeringMode = 'bars'; // 'bars' | 'handles'
let currentCenteringMarksText = '';

function setCenteringMode(mode) {
    centeringMode = mode;
    const btnBars = document.getElementById('centering-btn-mode-bars');
    const btnHandles = document.getElementById('centering-btn-mode-handles');
    const panelBars = document.getElementById('centering-panel-bars');
    const panelHandles = document.getElementById('centering-panel-handles');

    if (mode === 'handles') {
        if (btnHandles) btnHandles.className = 'py-1.5 px-3 rounded-lg text-xs font-bold bg-brass text-canvas transition-all shadow-xs flex items-center gap-1.5';
        if (btnBars) btnBars.className = 'py-1.5 px-3 rounded-lg text-xs font-medium text-ink2 hover:text-ink transition-all flex items-center gap-1.5';
        if (panelBars) panelBars.classList.add('hidden');
        if (panelHandles) panelHandles.classList.remove('hidden');
    } else {
        if (btnBars) btnBars.className = 'py-1.5 px-3 rounded-lg text-xs font-bold bg-brass text-canvas transition-all shadow-xs flex items-center gap-1.5';
        if (btnHandles) btnHandles.className = 'py-1.5 px-3 rounded-lg text-xs font-medium text-ink2 hover:text-ink transition-all flex items-center gap-1.5';
        if (panelHandles) panelHandles.classList.add('hidden');
        if (panelBars) panelBars.classList.remove('hidden');
    }
    calculateCentering();
}

function setHandleCcPreset(cc) {
    const input = document.getElementById('c-handles-cc');
    if (input) {
        input.value = cc;
        calculateCentering();
    }
}

function calculateCentering() {
    const errBanner = document.getElementById('centering-error-banner');
    const errText = document.getElementById('centering-error-text');
    const svgContainer = document.getElementById('centering-svg-container');
    const marksContainer = document.getElementById('centering-marks-container');

    if (centeringMode === 'bars') {
        calculateBars(errBanner, errText, svgContainer, marksContainer);
    } else {
        calculateHandles(errBanner, errText, svgContainer, marksContainer);
    }
}

function calculateBars(errBanner, errText, svgContainer, marksContainer) {
    const W = parseFloat(document.getElementById('c-bars-width')?.value) || 0;
    const Sw = parseFloat(document.getElementById('c-bars-bar-width')?.value) || 0;
    const N = parseInt(document.getElementById('c-bars-count')?.value, 10) || 0;

    const totalWood = N * Sw;
    const isInvalid = (W <= 0 || Sw <= 0 || N <= 0 || totalWood >= W);

    if (isInvalid) {
        if (errBanner) errBanner.classList.remove('hidden');
        if (errText) errText.innerText = totalWood >= W ? `La madera total (${totalWood} mm) supera o iguala el vano (${W} mm).` : 'Ingresa valores mayores a cero.';
        if (svgContainer) svgContainer.innerHTML = '';
        if (marksContainer) marksContainer.innerHTML = '';
        return;
    }
    if (errBanner) errBanner.classList.add('hidden');

    const spaces = N + 1;
    const gap = (W - totalWood) / spaces;
    const step = gap + Sw;

    // Métricas UI
    setMetric('c-metric-1-lbl', 'Luz Entre Barrotes', 'c-metric-1-val', `${gap.toFixed(1)} mm`);
    setMetric('c-metric-2-lbl', 'Total Espacios', 'c-metric-2-val', `${spaces} vanos`);
    setMetric('c-metric-3-lbl', 'Total Madera', 'c-metric-3-val', `${totalWood} mm`);
    setMetric('c-metric-4-lbl', 'Paso (Luz + Sw)', 'c-metric-4-val', `${step.toFixed(1)} mm`);

    if (svgContainer && typeof window.generateBarsSvg === 'function') {
        svgContainer.innerHTML = window.generateBarsSvg(W, Sw, N, gap);
    }

    // Marcas de Huincha
    let textLines = [`MARCAS DE HUINCHA CORRIDA (Vano: ${W}mm, ${N} barrotes de ${Sw}mm, Luz: ${gap.toFixed(1)}mm):`];
    let cardsHtml = '';

    for (let i = 1; i <= N; i++) {
        const start = (i * gap) + ((i - 1) * Sw);
        const end = start + Sw;
        const center = start + (Sw / 2);

        textLines.push(`Barrote #${i}: [${start.toFixed(1)} ➔ ${end.toFixed(1)} mm] (Centro: ${center.toFixed(1)} mm)`);
        cardsHtml += `
            <div class="bg-surface2/60 border border-hairline hover:border-brass/50 rounded-xl p-2.5 transition-all">
                <div class="flex items-center justify-between text-xs mb-1">
                    <span class="font-bold text-brass font-mono">Barrote #${i}</span>
                    <span class="text-[10px] text-ink3 font-mono">Centro: ${center.toFixed(1)}</span>
                </div>
                <div class="text-sm font-mono font-extrabold text-ink tracking-tight">
                    ${start.toFixed(1)} <span class="text-brass">➔</span> ${end.toFixed(1)} <span class="text-[10px] text-ink3 font-normal">mm</span>
                </div>
            </div>
        `;
    }
    currentCenteringMarksText = textLines.join('\n');
    if (marksContainer) marksContainer.innerHTML = cardsHtml;
}

function calculateHandles(errBanner, errText, svgContainer, marksContainer) {
    const W = parseFloat(document.getElementById('c-handles-w')?.value) || 0;
    const H = parseFloat(document.getElementById('c-handles-h')?.value) || 0;
    const CC = parseFloat(document.getElementById('c-handles-cc')?.value) || 0;

    const isInvalid = (W <= 0 || H <= 0 || CC < 0 || CC > W);
    if (isInvalid) {
        if (errBanner) errBanner.classList.remove('hidden');
        if (errText) errText.innerText = CC > W ? `La distancia entre pernos (${CC} mm) es mayor que el frente (${W} mm).` : 'Dimensiones inválidas.';
        if (svgContainer) svgContainer.innerHTML = '';
        if (marksContainer) marksContainer.innerHTML = '';
        return;
    }
    if (errBanner) errBanner.classList.add('hidden');

    const Mx = (W - CC) / 2;
    const My = H / 2;
    const h1 = Mx;
    const h2 = W - Mx;

    setMetric('c-metric-1-lbl', 'Margen Lateral (Mx)', 'c-metric-1-val', `${Mx.toFixed(1)} mm`);
    setMetric('c-metric-2-lbl', 'Centro Vertical (My)', 'c-metric-2-val', `${My.toFixed(1)} mm`);
    setMetric('c-metric-3-lbl', 'Distancia CC', 'c-metric-3-val', `${CC} mm`);
    setMetric('c-metric-4-lbl', 'Punto 1 / Punto 2', 'c-metric-4-val', CC === 0 ? `${h1.toFixed(1)} mm` : `${h1.toFixed(1)} / ${h2.toFixed(1)}`);

    if (svgContainer && typeof window.generateHandlesSvg === 'function') {
        svgContainer.innerHTML = window.generateHandlesSvg(W, H, CC, Mx, My);
    }

    let textLines = [`PLANTILLA DE PERFORACIÓN DE TIRADOR (${W}x${H}mm, CC=${CC}mm):`];
    let cardsHtml = '';

    if (CC === 0) {
        textLines.push(`Perno Único (Centro): X=${(W/2).toFixed(1)} mm, Y=${My.toFixed(1)} mm`);
        cardsHtml = `
            <div class="col-span-full bg-surface2/60 border border-hairline rounded-xl p-3">
                <span class="text-xs font-bold text-brass block">Perforación Monopunto</span>
                <span class="text-base font-mono font-extrabold text-ink">X = ${(W/2).toFixed(1)} mm | Y = ${My.toFixed(1)} mm (Gramil)</span>
            </div>
        `;
    } else {
        textLines.push(`Perforación #1: X=${h1.toFixed(1)} mm | Y=${My.toFixed(1)} mm (Gramil superior)`);
        textLines.push(`Perforación #2: X=${h2.toFixed(1)} mm | Y=${My.toFixed(1)} mm (Gramil superior)`);
        cardsHtml = `
            <div class="bg-surface2/60 border border-hairline rounded-xl p-2.5">
                <span class="text-xs font-bold text-brass block">Perforación Izquierda #1</span>
                <span class="text-sm font-mono font-extrabold text-ink">X = ${h1.toFixed(1)} mm</span>
                <span class="text-[10px] text-ink3 block">Gramil Y: ${My.toFixed(1)} mm</span>
            </div>
            <div class="bg-surface2/60 border border-hairline rounded-xl p-2.5">
                <span class="text-xs font-bold text-brass block">Perforación Derecha #2</span>
                <span class="text-sm font-mono font-extrabold text-ink">X = ${h2.toFixed(1)} mm</span>
                <span class="text-[10px] text-ink3 block">Gramil Y: ${My.toFixed(1)} mm</span>
            </div>
        `;
    }
    currentCenteringMarksText = textLines.join('\n');
    if (marksContainer) marksContainer.innerHTML = cardsHtml;
}

function setMetric(lblId, lblText, valId, valText) {
    const l = document.getElementById(lblId);
    const v = document.getElementById(valId);
    if (l) l.innerText = lblText;
    if (v) v.innerText = valText;
}

async function copyCenteringMarks() {
    if (!currentCenteringMarksText) return;
    try {
        await navigator.clipboard.writeText(currentCenteringMarksText);
        const txt = document.getElementById('c-btn-copy-text');
        if (txt) {
            const old = txt.innerText;
            txt.innerText = '¡Copiado!';
            setTimeout(() => { txt.innerText = old; }, 2000);
        }
    } catch (_) {}
}

if (typeof window !== 'undefined') {
    window.setCenteringMode = setCenteringMode;
    window.setHandleCcPreset = setHandleCcPreset;
    window.calculateCentering = calculateCentering;
    window.copyCenteringMarks = copyCenteringMarks;
}
