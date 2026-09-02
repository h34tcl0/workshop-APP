// static/js/admin/adminSystem.js - Global system configuration management

async function loadAdminSystemSettings() {
  try {
    const res = await fetch('/admin/api/system-settings');
    if (!res.ok) throw new Error('Error al cargar la configuración global');
    const data = await res.json();
    const settings = data.settings || {};
    const defaults = settings.default_limits || {};

    const regOpenInput = document.getElementById('system-reg-open');
    if (regOpenInput) regOpenInput.checked = !!settings.registration_open;

    const defProjects = document.getElementById('sys-default-projects');
    if (defProjects) defProjects.value = defaults.max_projects || 20;

    const defTasks = document.getElementById('sys-default-tasks');
    if (defTasks) defTasks.value = defaults.max_tasks_per_project || 100;

    const defModelSize = document.getElementById('sys-default-model-size');
    if (defModelSize) defModelSize.value = defaults.max_model_size_mb || 20;

    const defStorage = document.getElementById('sys-default-storage');
    if (defStorage) defStorage.value = defaults.max_total_storage_mb || 50;

    const absModelSize = document.getElementById('sys-absolute-model-size');
    if (absModelSize) absModelSize.value = settings.absolute_max_model_size_mb || 50;
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

async function saveSystemSettings(e) {
  e.preventDefault();

  const payload = {
    registration_open: document.getElementById('system-reg-open').checked,
    default_limits: {
      max_projects: parseInt(document.getElementById('sys-default-projects').value, 10),
      max_tasks_per_project: parseInt(document.getElementById('sys-default-tasks').value, 10),
      max_model_size_mb: parseInt(document.getElementById('sys-default-model-size').value, 10),
      max_total_storage_mb: parseInt(document.getElementById('sys-default-storage').value, 10)
    },
    absolute_max_model_size_mb: parseInt(document.getElementById('sys-absolute-model-size').value, 10)
  };

  try {
    const res = await fetch('/admin/api/system-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error al guardar configuración global');

    showAdminToast('Configuración global del sistema guardada con éxito', 'success');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

window.loadAdminSystemSettings = loadAdminSystemSettings;
window.saveSystemSettings = saveSystemSettings;
