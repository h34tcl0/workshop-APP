// ── Toast (notificación flotante, usada en varias partes de la página) ──
function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerText = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
}

// ── Tabs del backlog (manual / importar JSON) ──
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

// ── Importador de tareas vía JSON (IA) ──
function copyAiPrompt() {
    const prompt = `Actúa como Jefe de proyecto. Genera el desglose de tareas en formato JSON: {"project_name": "...", "tasks": [{"title": "...", "category": "carpentry | pva_glue | varnish_paint | epoxy", "estimated_hours": 1.0, "curing_hours": 0.0}]}`;
    navigator.clipboard.writeText(prompt).then(() => showToast('Prompt copiado'));
}

function importJsonTasks() {
    const input = document.getElementById('json-import-input');
    if (!input) return;
    const jsonText = input.value.trim();
    if (!jsonText) return;
    fetch('/tasks/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: jsonText })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                showToast(data.message);
                setTimeout(() => window.location.reload(), 800);
            }
        });
}

// ── Panel de edición inline de cada tarea ──
function toggleEditTask(taskId) {
    const el = document.getElementById('edit-task-' + taskId);
    if (el) el.classList.toggle('hidden');
}

// ── Historial de últimos 7 días (colapsable) ──
function toggleHistory() {
    const panel = document.getElementById('history-panel');
    const chevron = document.getElementById('history-chevron');
    if (panel) panel.classList.toggle('hidden');
    if (chevron) chevron.classList.toggle('rotate-180');
}

// ── Acordeón de Proyectos y Edición Inline de Tareas ──
function toggleProjectAccordion(projectId) {
    const body = document.getElementById(`proj-body-${projectId}`);
    const chevron = document.getElementById(`proj-chevron-${projectId}`);
    if (body) {
        body.classList.toggle('hidden');
        const isOpen = !body.classList.contains('hidden');
        let openProjs = JSON.parse(sessionStorage.getItem('open_project_accordions') || '[]');
        const strId = String(projectId);
        if (isOpen) {
            if (!openProjs.includes(strId)) openProjs.push(strId);
        } else {
            openProjs = openProjs.filter(id => id !== strId);
        }
        sessionStorage.setItem('open_project_accordions', JSON.stringify(openProjs));
    }
    if (chevron) chevron.classList.toggle('rotate-180');
}

function restoreProjectAccordions() {
    try {
        const openProjs = JSON.parse(sessionStorage.getItem('open_project_accordions') || '[]');
        openProjs.forEach(projectId => {
            const body = document.getElementById(`proj-body-${projectId}`);
            const chevron = document.getElementById(`proj-chevron-${projectId}`);
            if (body) body.classList.remove('hidden');
            if (chevron) chevron.classList.add('rotate-180');
        });
    } catch (e) {
        console.error('Error restoring project accordions:', e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreProjectAccordions);
} else {
    restoreProjectAccordions();
}

// ── Acciones Rápidas en Tareas de Proyecto ──
async function activateTaskToBacklog(taskId, taskTitle) {
    try {
        const res = await fetch(`/tasks/${taskId}/activate-to-backlog`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message || `Tarea '${taskTitle}' agregada al backlog activo`);
            setTimeout(() => window.location.reload(), 400);
        } else {
            showToast(data.error || 'Error al agregar tarea al backlog activo');
        }
    } catch (err) {
        console.error('Error in activateTaskToBacklog:', err);
        showToast('Error de conexión');
    }
}

async function handleTaskDelete(event, taskId, taskTitle) {
    if (event) event.preventDefault();
    if (!confirm(`¿Eliminar la tarea '${taskTitle}'?`)) return false;
    try {
        const res = await fetch(`/tasks/${taskId}/delete`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json'
            }
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message || `Tarea '${taskTitle}' eliminada`);
            const taskCard = document.getElementById(`task-card-${taskId}`);
            if (taskCard) taskCard.remove();
            setTimeout(() => window.location.reload(), 400);
        } else {
            showToast('Error al eliminar tarea');
        }
    } catch (err) {
        console.error('Error deleting task:', err);
        showToast('Error al eliminar tarea');
    }
    return false;
}

async function handleTaskUpdate(event, taskId) {
    if (event) event.preventDefault();
    const form = document.getElementById(`task-edit-form-${taskId}`);
    if (!form) return false;
    
    const formData = new FormData(form);
    const bodyObj = {};
    formData.forEach((value, key) => {
        bodyObj[key] = value;
    });

    try {
        const res = await fetch(form.action, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(bodyObj)
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast('Tarea actualizada correctamente');
            setTimeout(() => window.location.reload(), 400);
        } else {
            showToast(data.error || 'Error al actualizar tarea');
        }
    } catch (err) {
        console.error('Error updating task:', err);
        showToast('Error al actualizar tarea');
    }
    return false;
}

function toggleTaskInlineEdit(taskId) {
    const form = document.getElementById(`task-edit-form-${taskId}`);
    if (form) form.classList.toggle('hidden');
}

function quickAddTaskToProject(projectId) {
    const projSelect = document.getElementById('task-project-select');
    if (projSelect) {
        projSelect.value = projectId;
    }
    const titleInput = document.querySelector('#add-task-form input[name="title"]');
    if (titleInput) {
        titleInput.focus();
        titleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// ── Proyectos (colapsable) ──
function toggleProjects() {
    const panel = document.getElementById('projects-panel') || document.getElementById('templates-panel');
    const chevron = document.getElementById('projects-chevron') || document.getElementById('templates-chevron');
    if (panel) panel.classList.toggle('hidden');
    if (chevron) chevron.classList.toggle('rotate-180');
}
function toggleTemplates() {
    toggleProjects();
}

// ── Creación Rápida de Proyectos en Formulario de Tarea ──
function handleProjectSelectChange(selectEl) {
    const container = document.getElementById('inline-new-project-container');
    if (!selectEl || !container) return;
    if (selectEl.value === '__new__') {
        container.classList.remove('hidden');
        const input = document.getElementById('inline-project-name-input');
        if (input) input.focus();
    } else {
        container.classList.add('hidden');
    }
}

function cancelInlineProject() {
    const container = document.getElementById('inline-new-project-container');
    const selectEl = document.getElementById('task-project-select');
    if (container) container.classList.add('hidden');
    if (selectEl && selectEl.options.length > 1) {
        selectEl.selectedIndex = 0;
    }
}

function createInlineProject() {
    const input = document.getElementById('inline-project-name-input');
    const selectEl = document.getElementById('task-project-select');
    const container = document.getElementById('inline-new-project-container');
    if (!input || !input.value.trim() || !selectEl) return;

    const projName = input.value.trim();
    fetch('/projects/add', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ name: projName })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success && data.project) {
            const newOpt = document.createElement('option');
            newOpt.value = data.project.id;
            newOpt.textContent = data.project.name;
            const newIndex = selectEl.options.length - 1;
            selectEl.insertBefore(newOpt, selectEl.options[newIndex]);
            selectEl.value = data.project.id;
            input.value = '';
            if (container) container.classList.add('hidden');
            showToast('Proyecto "' + data.project.name + '" creado');
        } else if (data.error) {
            showToast(data.error);
        }
    })
    .catch(() => {
        showToast('Error al crear proyecto');
    });
}

// ── SortableJS: Drag & Drop del backlog ──
function initSortable() {
    const list = document.getElementById('backlog-task-list');
    if (!list || typeof Sortable === 'undefined') return;

    Sortable.create(list, {
        animation: 200,
        ghostClass: 'opacity-40',
        dragClass: 'shadow-2xl',
        delay: 100,
        delayOnTouchOnly: true,
        filter: 'button, input, select, textarea, a',
        preventOnFilter: false,
        onEnd: function (evt) {
            const items = list.querySelectorAll('.task-card[data-id]');
            const orderedIds = Array.from(items).map(el => parseInt(el.dataset.id, 10));

            fetch('/tasks/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_ids: orderedIds })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'ok') {
                        showToast('Orden guardado');
                    }
                })
                .catch(() => {});
        }
    });
}

// ── Modo Enfoque ──
const FOCUS_COLLAPSE_CLASSES = ['-translate-x-full', 'opacity-0', '!max-w-0', '!p-0', 'pointer-events-none'];

function applyFocusModeState(isCollapsed, isInitial = false) {
    const backlogCol = document.getElementById('backlog-container');
    const btnText = document.getElementById('toggle-backlog-text');
    if (!backlogCol) return;

    if (isCollapsed) {
        backlogCol.classList.add(...FOCUS_COLLAPSE_CLASSES);
        const collapseDone = () => {
            if (backlogCol.classList.contains('-translate-x-full')) {
                backlogCol.style.display = 'none';
            }
        };
        if (isInitial) {
            collapseDone();
        } else {
            setTimeout(collapseDone, 300);
        }
        if (btnText) btnText.innerText = 'Mostrar Backlog';
    } else {
        backlogCol.style.display = '';
        if (isInitial) {
            backlogCol.classList.remove(...FOCUS_COLLAPSE_CLASSES);
        } else {
            requestAnimationFrame(() => {
                backlogCol.classList.remove(...FOCUS_COLLAPSE_CLASSES);
            });
        }
        if (btnText) btnText.innerText = 'Modo Enfoque';
    }
}

function toggleFocusMode() {
    const backlogCol = document.getElementById('backlog-container');
    if (!backlogCol) return;
    const currentlyCollapsed = backlogCol.classList.contains('-translate-x-full') ||
        backlogCol.style.display === 'none';
    const newState = !currentlyCollapsed;
    localStorage.setItem('workshop_backlog_collapsed', newState ? 'true' : 'false');
    applyFocusModeState(newState);
}

// ── Autocompletado Inteligente de Tareas en #manual-title ──
function initTaskAutocomplete() {
    const input = document.getElementById('manual-title');
    const dropdown = document.getElementById('autocomplete-dropdown');
    const dataScript = document.getElementById('task-history-data');
    if (!input || !dropdown) return;

    let taskHistory = [];
    try {
        if (dataScript) {
            taskHistory = JSON.parse(dataScript.textContent || '[]');
        }
    } catch (_) {}

    const catLabels = {
        'carpentry': 'Carpintería',
        'pva_glue': 'Encolado PVA',
        'varnish_paint': 'Barnizado',
        'epoxy': 'Epoxi'
    };

    function updateDatalist(items) {
        const datalist = document.getElementById('task-history-datalist');
        if (datalist && Array.isArray(items)) {
            datalist.innerHTML = items.map(i => `<option value="${i.title.replace(/"/g, '&quot;')}"></option>`).join('');
        }
    }

    if (!taskHistory || taskHistory.length === 0) {
        fetch('/tasks/history')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    taskHistory = data;
                    updateDatalist(taskHistory);
                }
            })
            .catch(() => {});
    } else {
        updateDatalist(taskHistory);
    }

    let activeIndex = -1;

    function getMatches(query) {
        const q = (query || '').trim().toLowerCase();
        if (!q) return [];
        return taskHistory.filter(item => item.title && item.title.toLowerCase().includes(q));
    }

    function renderDropdown(matches) {
        if (!matches.length) {
            dropdown.innerHTML = '';
            dropdown.classList.add('hidden');
            activeIndex = -1;
            return;
        }

        dropdown.innerHTML = matches.map((item, idx) => `
            <button type="button" data-index="${idx}" class="task-autocomplete-item w-full text-left px-3.5 py-2.5 text-xs text-ink hover:bg-surface2 flex items-center justify-between gap-2 cursor-pointer transition-colors ${idx === activeIndex ? 'bg-surface2 font-semibold' : ''}">
                <span class="font-medium truncate flex items-center gap-1.5">
                    <svg class="w-3.5 h-3.5 text-brass shrink-0"><use href="#i-history"/></svg>
                    ${item.title}
                </span>
                <span class="text-[10px] font-mono text-ink3 shrink-0">
                    ${catLabels[item.category] || item.category || ''} • ${item.estimated_hours}h
                </span>
            </button>
        `).join('');

        dropdown.classList.remove('hidden');

        dropdown.querySelectorAll('.task-autocomplete-item').forEach((btn, idx) => {
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectTaskSuggestion(matches[idx]);
            });
        });
    }

    function selectTaskSuggestion(item) {
        input.value = item.title;
        const catSelect = document.getElementById('manual-category');
        const estInput = document.getElementById('manual-estimated-hours');
        const curInput = document.getElementById('manual-curing-hours');

        if (catSelect && item.category) catSelect.value = item.category;
        if (estInput && item.estimated_hours !== undefined) estInput.value = item.estimated_hours;
        if (curInput && item.curing_hours !== undefined) curInput.value = item.curing_hours;

        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
        activeIndex = -1;
    }

    input.addEventListener('input', function () {
        const val = this.value;
        const exactMatch = taskHistory.find(i => i.title.toLowerCase() === val.trim().toLowerCase());
        if (exactMatch) {
            selectTaskSuggestion(exactMatch);
            return;
        }

        const matches = getMatches(val);
        activeIndex = -1;
        renderDropdown(matches);
    });

    input.addEventListener('keydown', function (e) {
        if (dropdown.classList.contains('hidden')) return;
        const matches = getMatches(this.value);
        if (!matches.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % matches.length;
            renderDropdown(matches);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = (activeIndex - 1 + matches.length) % matches.length;
            renderDropdown(matches);
        } else if (e.key === 'Enter') {
            if (activeIndex >= 0 && activeIndex < matches.length) {
                e.preventDefault();
                e.stopPropagation();
                selectTaskSuggestion(matches[activeIndex]);
            }
        } else if (e.key === 'Escape') {
            dropdown.classList.add('hidden');
            activeIndex = -1;
        }
    });

    input.addEventListener('blur', function () {
        setTimeout(() => {
            dropdown.classList.add('hidden');
            activeIndex = -1;
        }, 200);
    });
}

// ── Event Handlers de Movimiento DOM (subir/bajar) ──
function initMoveTaskForms() {
    document.querySelectorAll('form[action*="/move-up"], form[action*="/move-down"]').forEach(form => {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            const card = form.closest('.task-card');
            if (!card) { form.submit(); return; }
            const isUp = form.action.includes('/move-up');
            let sibling = isUp ? card.previousElementSibling : card.nextElementSibling;
            while (sibling && !sibling.classList.contains('task-card')) {
                sibling = isUp ? sibling.previousElementSibling : sibling.nextElementSibling;
            }
            if (!sibling) return;

            fetch(form.action, { method: 'POST' })
                .then(res => {
                    if (!res.ok && res.status !== 0) throw new Error('move failed');
                    if (isUp) {
                        card.parentNode.insertBefore(card, sibling);
                    } else {
                        card.parentNode.insertBefore(sibling, card);
                    }
                })
                .catch(() => { form.submit(); });
        });
    });
}

document.addEventListener('DOMContentLoaded', function () {
    const toggleBtn = document.getElementById('toggle-backlog-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleFocusMode);
    }

    const savedState = localStorage.getItem('workshop_backlog_collapsed');
    if (savedState === 'true') {
        const backlogCol = document.getElementById('backlog-container');
        if (backlogCol) {
            backlogCol.style.transition = 'none';
            applyFocusModeState(true, true);
            requestAnimationFrame(() => {
                backlogCol.style.transition = '';
            });
        }
    }

    initMoveTaskForms();
    initSortable();
    initTaskAutocomplete();
});
