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

Object.assign(window, {
    toggleDayEditor,
    toggleAssignedTasks,
    toggleHourlyPanel
});
