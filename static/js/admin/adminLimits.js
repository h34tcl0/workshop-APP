// static/js/admin/adminLimits.js - Custom account limits management

function updateUsersSelectOptions(users) {
  const select = document.getElementById('limits-user-select');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="">-- Elige un usuario para editar --</option>' +
    users.map(u => `<option value="${u.id}">${u.email} (#${u.id})</option>`).join('');

  if (currentVal) select.value = currentVal;
}

async function loadSelectedUserLimits() {
  const select = document.getElementById('limits-user-select');
  const form = document.getElementById('user-limits-form');
  if (!select || !form) return;

  const userId = select.value;
  if (!userId) {
    form.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch(`/admin/api/users/${userId}/limits`);
    if (!res.ok) throw new Error('Error al obtener cuotas del usuario');
    const data = await res.json();
    const limits = data.effective_limits || {};

    document.getElementById('limit-max-projects').value = limits.max_projects || 20;
    document.getElementById('limit-max-tasks').value = limits.max_tasks_per_project || 100;
    document.getElementById('limit-max-model-size').value = limits.max_model_size_mb || 20;
    document.getElementById('limit-max-total-storage').value = limits.max_total_storage_mb || 50;

    form.classList.remove('hidden');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

async function saveUserLimits(e) {
  e.preventDefault();
  const select = document.getElementById('limits-user-select');
  if (!select || !select.value) return;

  const userId = select.value;
  const payload = {
    max_projects: parseInt(document.getElementById('limit-max-projects').value, 10),
    max_tasks_per_project: parseInt(document.getElementById('limit-max-tasks').value, 10),
    max_model_size_mb: parseInt(document.getElementById('limit-max-model-size').value, 10),
    max_total_storage_mb: parseInt(document.getElementById('limit-max-total-storage').value, 10)
  };

  try {
    const res = await fetch(`/admin/api/users/${userId}/limits`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error al actualizar límites');

    showAdminToast(json.message || 'Cuotas actualizadas exitosamente', 'success');
    loadAdminUsers();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

async function resetUserLimitsToDefault() {
  const select = document.getElementById('limits-user-select');
  if (!select || !select.value) return;
  const userId = select.value;

  try {
    const res = await fetch('/admin/api/system-settings');
    if (!res.ok) throw new Error('Error al obtener valores del sistema');
    const data = await res.json();
    const def = data.settings?.default_limits || {};

    document.getElementById('limit-max-projects').value = def.max_projects || 20;
    document.getElementById('limit-max-tasks').value = def.max_tasks_per_project || 100;
    document.getElementById('limit-max-model-size').value = def.max_model_size_mb || 20;
    document.getElementById('limit-max-total-storage').value = def.max_total_storage_mb || 50;

    showAdminToast('Valores restablecidos a predeterminados. Presiona Guardar para confirmar.', 'success');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

window.updateUsersSelectOptions = updateUsersSelectOptions;
window.loadSelectedUserLimits = loadSelectedUserLimits;
window.saveUserLimits = saveUserLimits;
window.resetUserLimitsToDefault = resetUserLimitsToDefault;
