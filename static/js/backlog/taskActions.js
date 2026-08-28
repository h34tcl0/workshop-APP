// TASK ACTIONS SUBMODULE (static/js/backlog/taskActions.js)
async function activateTaskToBacklog(taskId, taskTitle) {
    try {
        const res = await fetch(`/tasks/${taskId}/activate-to-backlog`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
        });
        const data = await res.json();
        showToast(data.success ? (data.message || `Tarea '${taskTitle}' agregada al backlog`) : (data.error || 'Error'));
        if (data.success) await refreshBacklogView();
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
            headers: { 'Accept': 'application/json' }
        });
        const data = await res.json();
        showToast(data.success ? (data.message || `Tarea '${taskTitle}' eliminada`) : 'Error al eliminar');
        if (data.success) {
            document.getElementById(`task-card-${taskId}`)?.remove();
            await refreshBacklogView();
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
    const bodyObj = Object.fromEntries(new FormData(form).entries());

    try {
        const res = await fetch(form.action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(bodyObj)
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast('Tarea actualizada correctamente');
            await refreshBacklogView();
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
    document.getElementById(`task-edit-form-${taskId}`)?.classList.toggle('hidden');
}

function toggleEditTask(taskId) {
    document.getElementById('edit-task-' + taskId)?.classList.toggle('hidden');
}

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
                    if (isUp) card.parentNode.insertBefore(card, sibling);
                    else card.parentNode.insertBefore(sibling, card);
                })
                .catch(() => form.submit());
        });
    });
}

async function handleSimpleFormSubmit(event, successMsg, errMsg) {
    event.preventDefault();
    const form = event.target;
    try {
        const hasBody = form.method?.toUpperCase() === 'POST' && (new FormData(form).keys().next().value !== undefined);
        const opts = {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        };
        if (hasBody) opts.body = new URLSearchParams(new FormData(form));
        const res = await fetch(form.action, opts);
        showToast(res.ok ? successMsg : errMsg);
        if (res.ok) await refreshBacklogView();
    } catch (err) {
        console.error('Error submitting form:', err);
        showToast('Error de conexión');
    }
}

const submitToggleTaskActiveForm = (e) => handleSimpleFormSubmit(e, 'Estado de tarea actualizado', 'Error al actualizar tarea');
const submitTaskUpdateStatusForm = (e) => handleSimpleFormSubmit(e, 'Tarea marcada como completada', 'Error al actualizar tarea');
const submitDayOverrideForm = (e) => handleSimpleFormSubmit(e, 'Ajuste del día guardado', 'Error al guardar ajuste');
const submitClearDayOverrideForm = (e) => handleSimpleFormSubmit(e, 'Ajustes manuales eliminados', 'Error al limpiar');
const submitForceTaskForm = (e) => handleSimpleFormSubmit(e, 'Tarea forzada asignada', 'Error al forzar tarea');
const submitDeleteForcedTaskForm = (e) => handleSimpleFormSubmit(e, 'Tarea forzada quitada', 'Error al eliminar');

Object.assign(window, {
    activateTaskToBacklog, handleTaskDelete, handleTaskUpdate,
    toggleTaskInlineEdit, toggleEditTask, initMoveTaskForms,
    submitToggleTaskActiveForm, submitTaskUpdateStatusForm, submitDayOverrideForm,
    submitClearDayOverrideForm, submitForceTaskForm, submitDeleteForcedTaskForm
});
