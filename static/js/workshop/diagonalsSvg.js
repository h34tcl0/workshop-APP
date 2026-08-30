/**
 * Diagonals SVG Visualizer (Guía Vectorial de Cuadratura y Prensado)
 */

function renderDiagonalsSvg(W, H, D1, D2, D_theory, diff, statusKey, longDiag) {
    const svg = document.getElementById('diagonals-svg-canvas');
    if (!svg) return;

    if (statusKey === 'invalid' || W <= 0 || H <= 0) {
        svg.innerHTML = `
            <rect x="50" y="30" width="400" height="180" rx="8" fill="#1e293b" stroke="#334155" stroke-width="2"/>
            <text x="250" y="125" text-anchor="middle" fill="#64748b" font-family="monospace" font-size="13">Introduce medidas válidas</text>
        `;
        return;
    }

    const svgW = 500;
    const svgH = 240;
    const padX = 60;
    const padY = 32;

    const maxDrawW = svgW - (padX * 2);
    const maxDrawH = svgH - (padY * 2);

    const aspect = W / H;
    let drawW = maxDrawW;
    let drawH = maxDrawW / aspect;

    if (drawH > maxDrawH) {
        drawH = maxDrawH;
        drawW = maxDrawH * aspect;
    }

    const startX = (svgW - drawW) / 2;
    const startY = (svgH - drawH) / 2;

    // Vértices A (Sup-Izq), B (Sup-Der), C (Inf-Der), D (Inf-Izq)
    const Ax = startX, Ay = startY;
    const Bx = startX + drawW, By = startY;
    const Cx = startX + drawW, Cy = startY + drawH;
    const Dx = startX, Dy = startY + drawH;

    const d1Color = longDiag === 'D1' ? '#f59e0b' : (statusKey === 'perfect' ? '#10b981' : '#64748b');
    const d2Color = longDiag === 'D2' ? '#f59e0b' : (statusKey === 'perfect' ? '#10b981' : '#64748b');
    const d1Width = longDiag === 'D1' ? '2.5' : '1.5';
    const d2Width = longDiag === 'D2' ? '2.5' : '1.5';

    // Flechas de prensa sargento (clamps) si hay diagonal larga
    let clampSvg = '';
    if (longDiag === 'D1') {
        clampSvg = `
            <!-- Prensa en Esquina A (Sup-Izq) -->
            <g class="clamp-vector">
                <circle cx="${Ax}" cy="${Ay}" r="14" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="3 3"/>
                <path d="M ${Ax - 18} ${Ay - 18} L ${Ax + 10} ${Ay + 10}" stroke="#fbbf24" stroke-width="3.5" stroke-linecap="round"/>
                <polygon points="${Ax+12},${Ay+12} ${Ax+3},${Ay+13} ${Ax+13},${Ay+3}" fill="#fbbf24"/>
            </g>
            <!-- Prensa en Esquina C (Inf-Der) -->
            <g class="clamp-vector">
                <circle cx="${Cx}" cy="${Cy}" r="14" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="3 3"/>
                <path d="M ${Cx + 18} ${Cy + 18} L ${Cx - 10} ${Cy - 10}" stroke="#fbbf24" stroke-width="3.5" stroke-linecap="round"/>
                <polygon points="${Cx-12},${Cy-12} ${Cx-3},${Cy-13} ${Cx-13},${Cy-3}" fill="#fbbf24"/>
            </g>
        `;
    } else if (longDiag === 'D2') {
        clampSvg = `
            <!-- Prensa en Esquina B (Sup-Der) -->
            <g class="clamp-vector">
                <circle cx="${Bx}" cy="${By}" r="14" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="3 3"/>
                <path d="M ${Bx + 18} ${By - 18} L ${Bx - 10} ${By + 10}" stroke="#fbbf24" stroke-width="3.5" stroke-linecap="round"/>
                <polygon points="${Bx-12},${By+12} ${Bx-3},${By+13} ${Bx-13},${By+3}" fill="#fbbf24"/>
            </g>
            <!-- Prensa en Esquina D (Inf-Izq) -->
            <g class="clamp-vector">
                <circle cx="${Dx}" cy="${Dy}" r="14" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="3 3"/>
                <path d="M ${Dx - 18} ${Dy + 18} L ${Dx + 10} ${Dy - 10}" stroke="#fbbf24" stroke-width="3.5" stroke-linecap="round"/>
                <polygon points="${Dx+12},${Dy-12} ${Dx+3},${Dy-13} ${Dx+13},${Dy-3}" fill="#fbbf24"/>
            </g>
        `;
    }

    svg.innerHTML = `
        <!-- Bastidor / Marco de Madera -->
        <rect x="${startX}" y="${startY}" width="${drawW}" height="${drawH}" rx="4" fill="#0f172a" stroke="#334155" stroke-width="3"/>
        <rect x="${startX + 7}" y="${startY + 7}" width="${drawW - 14}" height="${drawH - 14}" rx="2" fill="#1e293b" stroke="#1e293b"/>

        <!-- Diagonal D1 (A -> C) -->
        <line x1="${Ax}" y1="${Ay}" x2="${Cx}" y2="${Cy}" stroke="${d1Color}" stroke-width="${d1Width}" stroke-dasharray="${longDiag === 'D1' ? 'none' : '4 3'}"/>
        
        <!-- Diagonal D2 (B -> D) -->
        <line x1="${Bx}" y1="${By}" x2="${Dx}" y2="${Dy}" stroke="${d2Color}" stroke-width="${d2Width}" stroke-dasharray="${longDiag === 'D2' ? 'none' : '4 3'}"/>

        <!-- Etiquetas de Diagonales -->
        <text x="${(Ax + Cx) / 2 - 25}" y="${(Ay + Cy) / 2 - 8}" fill="${d1Color}" font-family="monospace" font-size="10" font-weight="bold">D1: ${D1}mm</text>
        <text x="${(Bx + Dx) / 2 - 25}" y="${(By + Dy) / 2 + 16}" fill="${d2Color}" font-family="monospace" font-size="10" font-weight="bold">D2: ${D2}mm</text>

        <!-- Cotas Exteriores W y H -->
        <text x="${startX + drawW / 2}" y="${startY - 10}" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="10">W = ${W} mm</text>
        <text x="${startX - 12}" y="${startY + drawH / 2}" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="10" transform="rotate(-90 ${startX - 12} ${startY + drawH / 2})">H = ${H} mm</text>

        <!-- Nodos de Vértices (A, B, C, D) -->
        <circle cx="${Ax}" cy="${Ay}" r="8" fill="#d97706"/>
        <text x="${Ax}" y="${Ay + 3}" text-anchor="middle" fill="#0f172a" font-family="sans-serif" font-size="9" font-weight="bold">A</text>

        <circle cx="${Bx}" cy="${By}" r="8" fill="#d97706"/>
        <text x="${Bx}" y="${By + 3}" text-anchor="middle" fill="#0f172a" font-family="sans-serif" font-size="9" font-weight="bold">B</text>

        <circle cx="${Cx}" cy="${Cy}" r="8" fill="#d97706"/>
        <text x="${Cx}" y="${Cy + 3}" text-anchor="middle" fill="#0f172a" font-family="sans-serif" font-size="9" font-weight="bold">C</text>

        <circle cx="${Dx}" cy="${Dy}" r="8" fill="#d97706"/>
        <text x="${Dx}" y="${Dy + 3}" text-anchor="middle" fill="#0f172a" font-family="sans-serif" font-size="9" font-weight="bold">D</text>

        <!-- Vectores de Prensa -->
        ${clampSvg}
    `;
}

if (typeof window !== 'undefined') {
    window.renderDiagonalsSvg = renderDiagonalsSvg;
}
