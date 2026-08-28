// TASK MODAL & AUTOCOMPLETE SUBMODULE (static/js/backlog/taskModal.js)
const DEFAULT_CURING_MAP = { 'carpentry': 0, 'pva_glue': 4, 'varnish_paint': 8, 'epoxy': 24 };

function openAddTaskDrawer() {
    const drawer = document.getElementById('add-task-drawer');
    if (drawer) {
        drawer.classList.remove('hidden');
        setTimeout(() => document.getElementById('manual-title')?.focus(), 100);
    }
}

function closeAddTaskDrawer() { document.getElementById('add-task-drawer')?.classList.add('hidden'); }

function quickAddTaskToProject(projectId) {
    const projSelect = document.getElementById('task-project-select');
    if (projSelect) projSelect.value = projectId;
    const titleInput = document.querySelector('#add-task-form input[name="title"]');
    if (titleInput) {
        titleInput.focus();
        titleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function handleProjectSelectChange(selectEl) {
    const container = document.getElementById('inline-new-project-container');
    if (!selectEl || !container) return;
    if (selectEl.value === '__new__') {
        container.classList.remove('hidden');
        document.getElementById('inline-project-name-input')?.focus();
    } else {
        container.classList.add('hidden');
    }
}

function cancelInlineProject() {
    document.getElementById('inline-new-project-container')?.classList.add('hidden');
    const selectEl = document.getElementById('task-project-select');
    if (selectEl && selectEl.options.length > 1) selectEl.selectedIndex = 0;
}

function createInlineProject() {
    const input = document.getElementById('inline-project-name-input');
    const selectEl = document.getElementById('task-project-select');
    const container = document.getElementById('inline-new-project-container');
    if (!input || !input.value.trim() || !selectEl) return;

    fetch('/projects/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ name: input.value.trim() })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success && data.project) {
            const opt = new Option(data.project.name, data.project.id);
            selectEl.insertBefore(opt, selectEl.options[selectEl.options.length - 1]);
            selectEl.value = data.project.id;
            input.value = '';
            container?.classList.add('hidden');
            showToast('Proyecto "' + data.project.name + '" creado');
        } else if (data.error) showToast(data.error);
    })
    .catch(() => showToast('Error al crear proyecto'));
}

function initCuringCalculation() {
    const catSelect = document.getElementById('manual-category');
    const curInput = document.getElementById('manual-curing-hours');
    if (catSelect && curInput) {
        catSelect.addEventListener('change', () => {
            const cat = catSelect.value;
            if (DEFAULT_CURING_MAP[cat] !== undefined && (!curInput.value || curInput.value === '0')) {
                curInput.value = DEFAULT_CURING_MAP[cat];
            }
        });
    }
}

function initTaskAutocomplete() {
    const input = document.getElementById('manual-title'), dropdown = document.getElementById('autocomplete-dropdown');
    const dataScript = document.getElementById('task-history-data');
    if (!input || !dropdown) return;

    let taskHistory = [];
    try { if (dataScript) taskHistory = JSON.parse(dataScript.textContent || '[]'); } catch (_) {}
    const catLabels = { 'carpentry': 'Carpintería', 'pva_glue': 'Encolado PVA', 'varnish_paint': 'Barnizado', 'epoxy': 'Epoxi' };

    const updateDatalist = (items) => {
        const datalist = document.getElementById('task-history-datalist');
        if (datalist && Array.isArray(items)) datalist.innerHTML = items.map(i => `<option value="${i.title.replace(/"/g, '&quot;')}"></option>`).join('');
    };

    if (!taskHistory || taskHistory.length === 0) {
        fetch('/tasks/history').then(r => r.json()).then(data => {
            if (Array.isArray(data)) { taskHistory = data; updateDatalist(taskHistory); }
        }).catch(() => {});
    } else { updateDatalist(taskHistory); }

    let activeIndex = -1;
    const getMatches = (q) => {
        const query = (q || '').trim().toLowerCase();
        return query ? taskHistory.filter(i => i.title && i.title.toLowerCase().includes(query)) : [];
    };

    function renderDropdown(matches) {
        if (!matches.length) { dropdown.innerHTML = ''; dropdown.classList.add('hidden'); activeIndex = -1; return; }
        dropdown.innerHTML = matches.map((item, idx) => `
            <button type="button" data-index="${idx}" class="task-autocomplete-item w-full text-left px-3.5 py-2 text-xs text-ink hover:bg-surface2 flex items-center justify-between gap-2 cursor-pointer transition-colors ${idx === activeIndex ? 'bg-surface2 font-semibold' : ''}">
                <span class="font-medium truncate flex items-center gap-1.5"><svg class="w-3.5 h-3.5 text-brass shrink-0"><use href="#i-history"/></svg>${item.title}</span>
                <span class="text-[10px] font-mono text-ink3 shrink-0">${catLabels[item.category] || item.category || ''} • ${item.estimated_hours}h</span>
            </button>
        `).join('');
        dropdown.classList.remove('hidden');
        dropdown.querySelectorAll('.task-autocomplete-item').forEach((btn, idx) => {
            btn.addEventListener('mousedown', (e) => { e.preventDefault(); selectTaskSuggestion(matches[idx]); });
        });
    }

    function selectTaskSuggestion(item) {
        input.value = item.title;
        const catSelect = document.getElementById('manual-category'), estInput = document.getElementById('manual-estimated-hours'), curInput = document.getElementById('manual-curing-hours');
        if (catSelect && item.category) catSelect.value = item.category;
        if (estInput && item.estimated_hours !== undefined) estInput.value = item.estimated_hours;
        if (curInput && item.curing_hours !== undefined) curInput.value = item.curing_hours;
        dropdown.classList.add('hidden'); dropdown.innerHTML = ''; activeIndex = -1;
    }

    input.addEventListener('input', function () {
        const val = this.value;
        const exactMatch = taskHistory.find(i => i.title.toLowerCase() === val.trim().toLowerCase());
        if (exactMatch) { selectTaskSuggestion(exactMatch); return; }
        activeIndex = -1; renderDropdown(getMatches(val));
    });

    input.addEventListener('keydown', function (e) {
        if (dropdown.classList.contains('hidden')) return;
        const matches = getMatches(this.value);
        if (!matches.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % matches.length; renderDropdown(matches); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + matches.length) % matches.length; renderDropdown(matches); }
        else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); e.stopPropagation(); selectTaskSuggestion(matches[activeIndex]); }
        else if (e.key === 'Escape') { dropdown.classList.add('hidden'); activeIndex = -1; }
    });

    input.addEventListener('blur', () => setTimeout(() => { dropdown.classList.add('hidden'); activeIndex = -1; }, 200));
}

async function submitAddTaskForm(event) {
    event.preventDefault();
    const form = event.target;
    try {
        const res = await fetch(form.action, {
            method: 'POST',
            body: new URLSearchParams(new FormData(form)),
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        showToast(res.ok ? 'Tarea agregada exitosamente' : 'Error al agregar tarea');
        if (res.ok) {
            const titleInput = document.getElementById('manual-title');
            if (titleInput) titleInput.value = '';
            closeAddTaskDrawer();
            await refreshBacklogView();
        }
    } catch (err) {
        console.error('Error in submitAddTaskForm:', err);
        showToast('Error de conexión');
    }
}

Object.assign(window, {
    openAddTaskDrawer, closeAddTaskDrawer, quickAddTaskToProject,
    handleProjectSelectChange, cancelInlineProject, createInlineProject,
    initCuringCalculation, initTaskAutocomplete, submitAddTaskForm
});
