/**
 * Centering & Gap Distribution SVG Generator
 * Genera diagramas técnicos vectoriales limpios y acotados para vanos y tiradores.
 */

function generateBarsSvg(W, Sw, N, gap) {
    if (W <= 0 || Sw <= 0 || N < 0 || gap <= 0) return '';
    const svgW = 680;
    const svgH = 190;
    const padX = 40;
    const padY = 50;
    const drawW = svgW - (padX * 2);
    const drawH = 90;
    const scale = drawW / W;

    let barsXml = '';
    let dimsXml = '';
    const barW_px = Sw * scale;
    const gap_px = gap * scale;

    // Cota Total Superior
    dimsXml += `
        <line x1="${padX}" y1="${padY - 25}" x2="${padX + drawW}" y2="${padY - 25}" stroke="#d97706" stroke-width="1.5"/>
        <line x1="${padX}" y1="${padY - 32}" x2="${padX}" y2="${padY - 18}" stroke="#d97706" stroke-width="1.5"/>
        <line x1="${padX + drawW}" y1="${padY - 32}" x2="${padX + drawW}" y2="${padY - 18}" stroke="#d97706" stroke-width="1.5"/>
        <text x="${padX + drawW / 2}" y="${padY - 30}" fill="#d97706" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle">W = ${W} mm</text>
    `;

    // Cota primer espacio
    const firstGapMid = padX + (gap_px / 2);
    dimsXml += `
        <line x1="${padX}" y1="${padY + drawH + 20}" x2="${padX + gap_px}" y2="${padY + drawH + 20}" stroke="#94a3b8" stroke-width="1"/>
        <text x="${firstGapMid}" y="${padY + drawH + 34}" fill="#94a3b8" font-size="10" font-family="monospace" text-anchor="middle">Luz: ${gap.toFixed(1)}</text>
    `;

    // Barrotes y cotas
    let currX = padX + gap_px;
    for (let i = 0; i < N; i++) {
        barsXml += `
            <rect x="${currX}" y="${padY}" width="${barW_px}" height="${drawH}" rx="3" fill="#d97706" fill-opacity="0.85" stroke="#b45309" stroke-width="1.5"/>
            <text x="${currX + barW_px / 2}" y="${padY + drawH / 2 + 4}" fill="#ffffff" font-size="10" font-family="monospace" font-weight="bold" text-anchor="middle">#${i + 1}</text>
        `;

        if (i < N - 1) {
            const nextGapX = currX + barW_px;
            const nextGapMid = nextGapX + (gap_px / 2);
            dimsXml += `
                <line x1="${nextGapX}" y1="${padY + drawH + 15}" x2="${nextGapX + gap_px}" y2="${padY + drawH + 15}" stroke="#64748b" stroke-width="1" stroke-dasharray="2 2"/>
                <text x="${nextGapMid}" y="${padY + drawH + 28}" fill="#94a3b8" font-size="9" font-family="monospace" text-anchor="middle">${gap.toFixed(1)}</text>
            `;
        }
        currX += barW_px + gap_px;
    }

    return `
    <svg viewBox="0 0 ${svgW} ${svgH}" class="w-full max-h-[220px]" xmlns="http://www.w3.org/2000/svg">
        <!-- Vano Marco Exterior -->
        <rect x="${padX}" y="${padY}" width="${drawW}" height="${drawH}" rx="6" fill="#0f172a" fill-opacity="0.6" stroke="#334155" stroke-width="2" stroke-dasharray="4 4"/>
        ${barsXml}
        ${dimsXml}
    </svg>`;
}

function generateHandlesSvg(W, H, CC, Mx, My) {
    if (W <= 0 || H <= 0 || Mx < 0) return '';
    const svgW = 680;
    const svgH = 220;
    const pad = 40;
    const maxDrawW = svgW - (pad * 2);
    const maxDrawH = svgH - (pad * 2);

    const scale = Math.min(maxDrawW / W, maxDrawH / H);
    const drawW = W * scale;
    const drawH = H * scale;
    const startX = (svgW - drawW) / 2;
    const startY = (svgH - drawH) / 2;

    const holeY = startY + (My * scale);
    const isSinglePoint = (CC <= 0);

    let holesXml = '';
    let dimsXml = '';

    if (isSinglePoint) {
        const holeX = startX + (W / 2) * scale;
        holesXml = `
            <circle cx="${holeX}" cy="${holeY}" r="6" fill="#d97706" stroke="#ffffff" stroke-width="2"/>
            <line x1="${holeX - 12}" y1="${holeY}" x2="${holeX + 12}" y2="${holeY}" stroke="#d97706" stroke-width="1.5"/>
            <line x1="${holeX}" y1="${holeY - 12}" x2="${holeX}" y2="${holeY + 12}" stroke="#d97706" stroke-width="1.5"/>
        `;
        dimsXml = `
            <text x="${holeX}" y="${holeY - 18}" fill="#d97706" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle">Centro: X=${(W/2).toFixed(1)} / Y=${My.toFixed(1)}</text>
        `;
    } else {
        const hole1X = startX + (Mx * scale);
        const hole2X = startX + ((W - Mx) * scale);
        const handleBarW = Math.max((CC * scale) + 16, 24);

        holesXml = `
            <!-- Silueta Tirador -->
            <rect x="${hole1X - 8}" y="${holeY - 6}" width="${handleBarW}" height="12" rx="4" fill="#334155" fill-opacity="0.8" stroke="#d97706" stroke-width="1.5"/>
            <!-- Perforación 1 -->
            <circle cx="${hole1X}" cy="${holeY}" r="5" fill="#d97706" stroke="#ffffff" stroke-width="1.5"/>
            <line x1="${hole1X - 9}" y1="${holeY}" x2="${hole1X + 9}" y2="${holeY}" stroke="#ffffff" stroke-width="1"/>
            <line x1="${hole1X}" y1="${holeY - 9}" x2="${hole1X}" y2="${holeY + 9}" stroke="#ffffff" stroke-width="1"/>
            <!-- Perforación 2 -->
            <circle cx="${hole2X}" cy="${holeY}" r="5" fill="#d97706" stroke="#ffffff" stroke-width="1.5"/>
            <line x1="${hole2X - 9}" y1="${holeY}" x2="${hole2X + 9}" y2="${holeY}" stroke="#ffffff" stroke-width="1"/>
            <line x1="${hole2X}" y1="${holeY - 9}" x2="${hole2X}" y2="${holeY + 9}" stroke="#ffffff" stroke-width="1"/>
        `;

        dimsXml = `
            <!-- Cota CC -->
            <line x1="${hole1X}" y1="${holeY + 22}" x2="${hole2X}" y2="${holeY + 22}" stroke="#d97706" stroke-width="1.5"/>
            <text x="${(hole1X + hole2X) / 2}" y="${holeY + 36}" fill="#d97706" font-size="10" font-family="monospace" font-weight="bold" text-anchor="middle">CC: ${CC} mm</text>
            <!-- Cota Margen Izquierdo -->
            <line x1="${startX}" y1="${holeY - 20}" x2="${hole1X}" y2="${holeY - 20}" stroke="#94a3b8" stroke-width="1"/>
            <text x="${(startX + hole1X) / 2}" y="${holeY - 25}" fill="#94a3b8" font-size="10" font-family="monospace" text-anchor="middle">Mx: ${Mx.toFixed(1)}</text>
        `;
    }

    return `
    <svg viewBox="0 0 ${svgW} ${svgH}" class="w-full max-h-[220px]" xmlns="http://www.w3.org/2000/svg">
        <!-- Frente Cajón / Puerta -->
        <rect x="${startX}" y="${startY}" width="${drawW}" height="${drawH}" rx="8" fill="#0f172a" fill-opacity="0.75" stroke="#475569" stroke-width="2"/>
        <!-- Ejes Guía de Centro -->
        <line x1="${startX}" y1="${startY + drawH / 2}" x2="${startX + drawW}" y2="${startY + drawH / 2}" stroke="#334155" stroke-width="1" stroke-dasharray="3 3"/>
        <line x1="${startX + drawW / 2}" y1="${startY}" x2="${startX + drawW / 2}" y2="${startY + drawH}" stroke="#334155" stroke-width="1" stroke-dasharray="3 3"/>
        ${holesXml}
        ${dimsXml}
        <!-- Cota Total -->
        <text x="${startX + drawW / 2}" y="${startY - 8}" fill="#94a3b8" font-size="10" font-family="monospace" text-anchor="middle">${W} × ${H} mm</text>
    </svg>`;
}

if (typeof window !== 'undefined') {
    window.generateBarsSvg = generateBarsSvg;
    window.generateHandlesSvg = generateHandlesSvg;
}
