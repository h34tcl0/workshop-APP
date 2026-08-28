// ── Editor manual de un día puntual (forzar bloqueado/viable, horas custom, tareas forzadas) ──
function toggleDayEditor(dateIso) {
    document.getElementById('day-editor-' + dateIso).classList.toggle('hidden');
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
            const cx = (160 + 120 * Math.cos(angle)).toFixed(2);
            const cy = (145 - 120 * Math.sin(angle)).toFixed(2);

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

function updateCalendarGridTaskStatuses() {
    const todayIso = getLocalDateIso();
    const nowH = getLocalNowHours();
    const gridContainers = document.querySelectorAll('.calendar-grid-container');

    gridContainers.forEach(grid => {
        const dateIso = grid.dataset.date;
        const isToday = (dateIso === todayIso);
        const isPastDay = dateIso < todayIso;
        const isFutureDay = dateIso > todayIso;

        const blocks = grid.querySelectorAll('.task-grid-block');
        blocks.forEach(block => {
            const startH = parseFloat(block.dataset.blockStart);
            const endH = parseFloat(block.dataset.blockEnd);
            const indicator = block.querySelector('.task-status-indicator');

            // Reset dynamic modifier classes
            block.classList.remove('task-block-past', 'task-block-current');

            if (isPastDay || (isToday && !isNaN(endH) && nowH >= endH)) {
                // Tarea Pasada: Atenuada con ícono o check
                block.classList.add('task-block-past');
                if (indicator) {
                    indicator.innerHTML = `<span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[var(--w-ok)]/20 text-[var(--w-ok)] font-bold text-[9px]">✓</span>`;
                }
            } else if (isToday && !isNaN(startH) && !isNaN(endH) && nowH >= startH && nowH < endH) {
                // Tarea En Curso: Fondo ámbar sólido + label en negrita
                block.classList.add('task-block-current');
                if (indicator) {
                    indicator.innerHTML = `<span class="inline-flex items-center gap-1 font-mono-jb text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-black/40 text-canvas tracking-wider">En curso</span>`;
                }
            } else {
                // Tarea Futura / Pendiente
                if (indicator) {
                    indicator.innerHTML = '';
                }
            }
        });
    });
}

// ── Navegación e interacción del Panel Central (Grilla Multi-Día 2-3 Columnas) ──
let agendaWindowStartIndex = 0;

function getAgendaWindowSize() {
    const w = window.innerWidth;
    const backlogDrawer = document.getElementById('backlog-drawer-modal');
    const isBacklogOpen = backlogDrawer && !backlogDrawer.classList.contains('hidden');

    if (w < 768) {
        return 1;
    } else if (w < 1280 || isBacklogOpen) {
        return 2;
    } else {
        return 3;
    }
}

function updateVisibleAgendaDays() {
    const cards = Array.from(document.querySelectorAll('article.weather-card[data-date-iso]'));
    if (!cards.length) return;

    const winSize = getAgendaWindowSize();
    const maxStart = Math.max(0, cards.length - winSize);
    agendaWindowStartIndex = Math.max(0, Math.min(agendaWindowStartIndex, maxStart));

    const visibleCards = [];
    cards.forEach((card, index) => {
        if (index >= agendaWindowStartIndex && index < agendaWindowStartIndex + winSize) {
            card.classList.remove('hidden');
            visibleCards.push(card);
        } else {
            card.classList.add('hidden');
        }
    });

    // Actualizar etiqueta del horizonte visible
    const label = document.getElementById('agenda-current-day-label');
    if (label && visibleCards.length > 0) {
        const firstStr = visibleCards[0].dataset.dateStr || visibleCards[0].dataset.dateIso;
        const lastStr = visibleCards[visibleCards.length - 1].dataset.dateStr || visibleCards[visibleCards.length - 1].dataset.dateIso;
        if (visibleCards.length === 1 || firstStr === lastStr) {
            label.innerText = firstStr;
        } else {
            label.innerText = `${firstStr} — ${lastStr}`;
        }
    }

    // Actualizar estado activo en el Right Rail
    const visibleIsos = new Set(visibleCards.map(c => c.dataset.dateIso));
    const railItems = document.querySelectorAll('.horizon-day-item');
    railItems.forEach(item => {
        if (visibleIsos.has(item.dataset.dateIso)) {
            item.classList.add('bg-surface2', 'border-brass/60', 'shadow-xs', 'ring-1', 'ring-brass/40');
            item.classList.remove('bg-surface/50', 'border-hairline/80');
        } else {
            item.classList.remove('bg-surface2', 'border-brass/60', 'shadow-xs', 'ring-1', 'ring-brass/40');
            item.classList.add('bg-surface/50', 'border-hairline/80');
        }
    });

    sessionStorage.setItem('agendapp_window_start', agendaWindowStartIndex.toString());
}

function selectAgendaDay(dateIso) {
    const cards = Array.from(document.querySelectorAll('article.weather-card[data-date-iso]'));
    if (!cards.length) return;

    const targetIndex = cards.findIndex(c => c.dataset.dateIso === dateIso);
    if (targetIndex === -1) return;

    const winSize = getAgendaWindowSize();
    // Si no está dentro de la ventana visible actual, centrar/ajustar la ventana
    if (targetIndex < agendaWindowStartIndex || targetIndex >= agendaWindowStartIndex + winSize) {
        const maxStart = Math.max(0, cards.length - winSize);
        agendaWindowStartIndex = Math.max(0, Math.min(targetIndex, maxStart));
    }

    updateVisibleAgendaDays();

    // Scroll suave a la tarjeta seleccionada si está en pantalla pequeña
    const targetCard = document.getElementById('agenda-day-card-' + dateIso);
    if (targetCard && window.innerWidth < 768) {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function navigateAgendaDay(direction) {
    const cards = Array.from(document.querySelectorAll('article.weather-card[data-date-iso]'));
    if (!cards.length) return;

    const winSize = getAgendaWindowSize();
    const maxStart = Math.max(0, cards.length - winSize);

    agendaWindowStartIndex += direction;
    if (agendaWindowStartIndex > maxStart) agendaWindowStartIndex = 0;
    if (agendaWindowStartIndex < 0) agendaWindowStartIndex = maxStart;

    updateVisibleAgendaDays();
}

function restoreSelectedAgendaDay() {
    const savedStart = sessionStorage.getItem('agendapp_window_start');
    if (savedStart !== null) {
        agendaWindowStartIndex = parseInt(savedStart, 10) || 0;
    }
    updateVisibleAgendaDays();
}

window.addEventListener('resize', () => {
    updateVisibleAgendaDays();
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        restoreSelectedAgendaDay();
        updateArcSunMarkers();
        updateCalendarGridTaskStatuses();
        setInterval(() => {
            updateArcSunMarkers();
            updateCalendarGridTaskStatuses();
        }, 30000);
    });
} else {
    restoreSelectedAgendaDay();
    updateArcSunMarkers();
    updateCalendarGridTaskStatuses();
    setInterval(() => {
        updateArcSunMarkers();
        updateCalendarGridTaskStatuses();
    }, 30000);
}

Object.assign(window, {
    toggleDayEditor,
    toggleHourlyPanel,
    updateArcSunMarkers,
    updateCalendarGridTaskStatuses,
    selectAgendaDay,
    navigateAgendaDay,
    updateVisibleAgendaDays
});
