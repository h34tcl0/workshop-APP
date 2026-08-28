// PROJECT & TEMPLATES SUBMODULE (static/js/backlog/projectTemplates.js)
function toggleProjectAccordion(projectId) {
    const body = document.getElementById(`proj-body-${projectId}`);
    const chevron = document.getElementById(`proj-chevron-${projectId}`);
    if (body) {
        body.classList.toggle('hidden');
        const isOpen = !body.classList.contains('hidden');
        let openProjs = JSON.parse(sessionStorage.getItem('open_project_accordions') || '[]');
        const strId = String(projectId);
        openProjs = isOpen ? (openProjs.includes(strId) ? openProjs : [...openProjs, strId]) : openProjs.filter(id => id !== strId);
        sessionStorage.setItem('open_project_accordions', JSON.stringify(openProjs));
    }
    if (chevron) chevron.classList.toggle('rotate-180');
}

function restoreProjectAccordions() {
    try {
        const openProjs = JSON.parse(sessionStorage.getItem('open_project_accordions') || '[]');
        openProjs.forEach(projectId => {
            document.getElementById(`proj-body-${projectId}`)?.classList.remove('hidden');
            document.getElementById(`proj-chevron-${projectId}`)?.classList.add('rotate-180');
        });
    } catch (e) {
        console.error('Error restoring project accordions:', e);
    }
}

function toggleMoreProjects() {
    const extraItems = document.querySelectorAll('.project-extra-item');
    const icon = document.getElementById('icon-show-more-projects');
    const btn = document.getElementById('btn-show-more-projects');
    const isExpanded = Array.from(extraItems).some(el => !el.classList.contains('hidden'));

    extraItems.forEach(el => el.classList.toggle('hidden', isExpanded));
    if (icon) icon.classList.toggle('rotate-180', !isExpanded);
    if (btn) {
        btn.querySelector('span').innerText = isExpanded 
            ? `Ver todos los proyectos (${document.querySelectorAll('.project-item-card').length})`
            : 'Mostrar menos proyectos';
    }
}

function toggleProjects() {
    document.getElementById('projects-panel')?.classList.toggle('hidden');
    document.getElementById('projects-chevron')?.classList.toggle('rotate-180');
}

function toggleProjectNameEdit(projectId) {
    document.getElementById(`proj-name-edit-${projectId}`)?.classList.toggle('hidden');
    document.getElementById(`proj-name-display-${projectId}`)?.classList.toggle('hidden');
}

async function saveProjectName(projectId) {
    const input = document.getElementById(`proj-name-input-${projectId}`);
    if (!input || !input.value.trim()) return;
    try {
        const res = await fetch(`/projects/${projectId}/update-name`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ name: input.value.trim() })
        });
        const data = await res.json();
        showToast(data.success ? 'Nombre de proyecto actualizado' : (data.error || 'Error al actualizar'));
        if (data.success) await refreshBacklogView();
    } catch (e) {
        console.error('Error saving project name:', e);
        showToast('Error de conexión');
    }
}

async function submitAddProjectForm(event) {
    event.preventDefault();
    const form = event.target;
    try {
        const res = await fetch(form.action, {
            method: 'POST',
            body: new URLSearchParams(new FormData(form)),
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        showToast(res.ok ? 'Proyecto creado' : 'Error al crear proyecto');
        if (res.ok) { form.reset(); await refreshBacklogView(); }
    } catch (err) {
        console.error('Error creating project:', err);
        showToast('Error de conexión');
    }
}

async function submitToggleProjectForm(event) {
    event.preventDefault();
    const form = event.target;
    try {
        const res = await fetch(form.action, {
            method: 'POST',
            body: new URLSearchParams(new FormData(form)),
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        showToast(res.ok ? 'Estado del proyecto actualizado' : 'Error al actualizar');
        if (res.ok) await refreshBacklogView();
    } catch (err) {
        console.error('Error toggling project:', err);
        showToast('Error de conexión');
    }
}

async function saveCurrentBacklogAsTemplate(name, description = '') {
    if (!name || !name.trim()) return showToast('Ingresa un nombre para la plantilla');
    try {
        const res = await fetch('/project-templates/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ name: name.trim(), description: description.trim() })
        });
        const data = await res.json();
        showToast(data.message || (data.status === 'success' ? 'Plantilla guardada' : 'Error'));
        if (data.status === 'success') await refreshBacklogView();
    } catch (err) {
        console.error('Error saving project template:', err);
        showToast('Error de conexión al guardar plantilla');
    }
}

async function applyProjectTemplate(templateId) {
    try {
        const res = await fetch(`/project-templates/${templateId}/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
        });
        const data = await res.json();
        showToast(data.message || (data.status === 'success' ? 'Plantilla aplicada' : 'Error'));
        if (data.status === 'success') await refreshBacklogView();
    } catch (err) {
        console.error('Error applying template:', err);
        showToast('Error de conexión al aplicar plantilla');
    }
}

async function deleteProjectTemplate(templateId) {
    if (!confirm('¿Eliminar esta plantilla de proyecto?')) return;
    try {
        const res = await fetch(`/project-templates/${templateId}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
        });
        const data = await res.json();
        showToast(data.message || (data.status === 'success' ? 'Plantilla eliminada' : 'Error'));
        if (data.status === 'success') await refreshBacklogView();
    } catch (err) {
        console.error('Error deleting template:', err);
        showToast('Error de conexión al eliminar plantilla');
    }
}

Object.assign(window, {
    toggleProjectAccordion, restoreProjectAccordions, toggleMoreProjects,
    toggleProjects, toggleProjectNameEdit, saveProjectName,
    submitAddProjectForm, submitToggleProjectForm, saveCurrentBacklogAsTemplate,
    applyProjectTemplate, deleteProjectTemplate
});
