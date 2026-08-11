// ── Editor manual de un día puntual (forzar bloqueado/viable, horas custom, tareas forzadas) ──
function toggleDayEditor(dateIso) {
    document.getElementById('day-editor-' + dateIso).classList.toggle('hidden');
}

// ── Panel colapsable "Tareas asignadas" de cada tarjeta de día ──
function toggleAssignedTasks(panelId) {
    document.getElementById(panelId).classList.toggle('hidden');
}

// ── Panel colapsable "Clima por hora (24h)" al pulsar el ícono de clima ──
function toggleHourlyPanel(dateIso) {
    const el = document.getElementById('hourly-panel-' + dateIso);
    if (el) {
        el.classList.toggle('hidden');
    }
}

// ── Posicionamiento dinámico del marcador en vivo sobre el arco meteorológico ──
function getLocalDateIso() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getLocalNowHours() {
    const d = new Date();
    return d.getHours() + (d.getMinutes() / 60) + (d.getSeconds() / 3600);
}

function updateArcSunMarkers() {
    const todayIso = getLocalDateIso();
    const nowH = getLocalNowHours();
    const arcs = document.querySelectorAll('svg.arc[data-date]');

    arcs.forEach(svg => {
        const dateIso = svg.dataset.date;
        const startH = parseFloat(svg.dataset.shiftStart || svg.dataset.windowStart);
        const endH = parseFloat(svg.dataset.shiftEnd || svg.dataset.windowEnd);
        const marker = svg.querySelector('.sun-marker');

        if (!marker) return;

        const isToday = (dateIso === todayIso);
        const hasShift = !isNaN(startH) && !isNaN(endH) && endH > startH;
        const inShift = hasShift && nowH >= startH && nowH <= endH;

        if (isToday && inShift) {
            const progress = (nowH - startH) / (endH - startH);
            const clampedProgress = Math.max(0, Math.min(1, progress));
            const angle = Math.PI - (clampedProgress * Math.PI);
            const cx = (160 + 115 * Math.cos(angle)).toFixed(2);
            const cy = (145 - 115 * Math.sin(angle)).toFixed(2);

            marker.style.display = 'block';
            const circles = marker.querySelectorAll('circle');
            circles.forEach(c => {
                c.setAttribute('cx', cx);
                c.setAttribute('cy', cy);
            });
        } else {
            marker.style.display = 'none';
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        updateArcSunMarkers();
        setInterval(updateArcSunMarkers, 30000);
    });
} else {
    updateArcSunMarkers();
    setInterval(updateArcSunMarkers, 30000);
}

Object.assign(window, {
    toggleDayEditor,
    toggleAssignedTasks,
    toggleHourlyPanel,
    updateArcSunMarkers
});
