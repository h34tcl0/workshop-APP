// TASK IMPORT VIA JSON (AI) SUBMODULE (static/js/backlog/taskImport.js)
function openImportJsonDrawer() {
    const drawer = document.getElementById('import-json-drawer');
    if (drawer) drawer.classList.remove('hidden');
}

function closeImportJsonDrawer() {
    const drawer = document.getElementById('import-json-drawer');
    if (drawer) drawer.classList.add('hidden');
}

function switchTab(tabName) {
    const indicator = document.getElementById('pill-indicator');
    const btnManual = document.getElementById('tab-btn-manual');
    const btnJson = document.getElementById('tab-btn-json');
    const tabManual = document.getElementById('tab-manual');
    const tabJson = document.getElementById('tab-json');
    if (!btnManual || !btnJson || !tabManual || !tabJson) return;

    if (tabName === 'manual') {
        if (indicator) indicator.classList.remove('right');
        btnManual.classList.replace('text-ink2', 'text-canvas');
        btnJson.classList.replace('text-canvas', 'text-ink2');
        tabManual.classList.remove('hidden');
        tabJson.classList.add('hidden');
    } else {
        if (indicator) indicator.classList.add('right');
        btnJson.classList.replace('text-ink2', 'text-canvas');
        btnManual.classList.replace('text-canvas', 'text-ink2');
        tabJson.classList.remove('hidden');
        tabManual.classList.add('hidden');
    }
}

function copyAiPrompt() {
    const prompt = `Actúa como Jefe de proyecto. Genera el desglose de tareas en formato JSON: {"project_name": "...", "tasks": [{"title": "...", "category": "carpentry | pva_glue | varnish_paint | epoxy", "estimated_hours": 1.0, "curing_hours": 0.0}]}`;
    navigator.clipboard.writeText(prompt).then(() => showToast('Prompt copiado'));
}

async function importJsonTasks() {
    const input = document.getElementById('json-import-input');
    if (!input) return;
    const jsonText = input.value.trim();
    if (!jsonText) {
        showToast('Pega el JSON antes de importar');
        return;
    }

    try {
        JSON.parse(jsonText);
    } catch (e) {
        showToast('JSON inválido. Revisa la sintaxis.');
        return;
    }

    try {
        const res = await fetch('/tasks/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: jsonText
        });
        const data = await res.json();
        if (data.status === 'success' || data.success) {
            showToast(data.message || 'Tareas importadas correctamente');
            input.value = '';
            closeImportJsonDrawer();
            await refreshBacklogView();
        } else {
            showToast(data.message || data.error || 'Error al importar tareas');
        }
    } catch (err) {
        console.error('Error importing JSON tasks:', err);
        showToast('Error de conexión al importar');
    }
}

Object.assign(window, {
    openImportJsonDrawer,
    closeImportJsonDrawer,
    switchTab,
    copyAiPrompt,
    importJsonTasks
});
