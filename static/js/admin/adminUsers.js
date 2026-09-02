// static/js/admin/adminUsers.js - User management & Step-up modal handler

let currentUsersList = [];
let pendingStepUpAction = null;

async function loadAdminUsers() {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/admin/api/users', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Error al cargar la lista de usuarios');
    const data = await res.json();
    currentUsersList = data.users || [];
    renderUsersTable(currentUsersList);
    updateUsersSelectOptions(currentUsersList);
  } catch (err) {
    console.error('[ADMIN USERS]', err);
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-red-400 font-mono">Error al obtener usuarios: ${err.message}</td></tr>`;
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500 font-mono">No se encontraron usuarios</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => {
    const isBlocked = u.status === 'blocked';
    const isRevoked = u.status === 'revoked';
    const isAdmin = u.role === 'admin';

    const statusBadge = isRevoked
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-red-500/10 text-red-400 border border-red-500/30">REVOCADO</span>`
      : isBlocked
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">BLOQUEADO</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">ACTIVO</span>`;

    const roleBadge = isAdmin
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">ADMIN</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-slate-800 text-slate-400 border border-slate-700">USUARIO</span>`;

    const storageUsage = u.storage_usage_mb || 0;
    const maxStorage = u.limits?.max_total_storage_mb || 50;
    const storagePercent = Math.min(100, Math.round((storageUsage / maxStorage) * 100));
    const barColor = storagePercent > 90 ? 'bg-red-500' : storagePercent > 70 ? 'bg-amber-500' : 'bg-emerald-500';

    const createdAt = u.created_at ? new Date(u.created_at).toLocaleDateString('es-CL') : 'N/A';

    return `
      <tr class="hover:bg-slate-900/40 transition-colors">
        <td class="px-4 py-3">
          <div class="font-medium text-slate-100 font-mono text-xs">${u.email}</div>
          <div class="text-[10px] text-slate-500 font-mono">ID #${u.id}</div>
        </td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-1.5 flex-wrap">
            ${roleBadge}
            ${statusBadge}
          </div>
        </td>
        <td class="px-4 py-3 font-mono text-xs">
          <span class="text-slate-200">${u.project_count || 0}</span> <span class="text-slate-500">/ ${u.limits?.max_projects || 20} proy</span><br>
          <span class="text-slate-200">${u.task_count || 0}</span> <span class="text-slate-500">/ ${u.limits?.max_tasks_per_project || 100} tar</span>
        </td>
        <td class="px-4 py-3 w-44">
          <div class="flex items-center justify-between text-[11px] font-mono text-slate-300 mb-1">
            <span>${storageUsage.toFixed(1)} MB</span>
            <span class="text-slate-500">max ${maxStorage} MB</span>
          </div>
          <div class="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div class="${barColor} h-full transition-all duration-300" style="width: ${storagePercent}%"></div>
          </div>
        </td>
        <td class="px-4 py-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">
          ${createdAt}
        </td>
        <td class="px-4 py-3 text-right">
          <div class="flex items-center justify-end gap-1.5 flex-wrap">
            ${!isRevoked && !isBlocked ? `
              <button onclick="toggleBlockUser(${u.id}, true)" class="px-2 py-1 text-[11px] font-medium text-amber-400 hover:bg-amber-500/10 border border-amber-500/30 rounded-lg transition-colors" title="Bloquear cuenta">
                Bloquear
              </button>
            ` : ''}
            ${!isRevoked && isBlocked ? `
              <button onclick="toggleBlockUser(${u.id}, false)" class="px-2 py-1 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/30 rounded-lg transition-colors" title="Reactivar cuenta">
                Desbloquear
              </button>
            ` : ''}
            ${!isAdmin && !isRevoked ? `
              <button onclick="promptPromoteUser(${u.id})" class="px-2 py-1 text-[11px] font-medium text-sky-400 hover:bg-sky-500/10 border border-sky-500/30 rounded-lg transition-colors" title="Promover a Administrador">
                Promover
              </button>
            ` : ''}
            ${isAdmin && !isRevoked ? `
              <button onclick="promptDemoteUser(${u.id})" class="px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors" title="Degradar a Usuario">
                Degradar
              </button>
            ` : ''}
            ${!isRevoked ? `
              <button onclick="promptSoftDeleteUser(${u.id})" class="px-2 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/10 border border-red-500/30 rounded-lg transition-colors" title="Revocar cuenta y archivar 3D">
                Revocar
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function toggleBlockUser(userId, block) {
  const endpoint = `/admin/api/users/${userId}/${block ? 'block' : 'unblock'}`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: block ? 'Bloqueado vía Panel de Administración' : undefined })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error al procesar solicitud');
    showAdminToast(json.message || 'Estado actualizado', 'success');
    loadAdminUsers();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

function openStepUpModal(title, description, onConfirm) {
  const modal = document.getElementById('step-up-modal');
  const titleEl = document.getElementById('step-up-title');
  const descEl = document.getElementById('step-up-description');
  const pwdInput = document.getElementById('step-up-password-input');
  const errEl = document.getElementById('step-up-error');
  const confirmBtn = document.getElementById('step-up-confirm-btn');

  if (!modal) return;
  titleEl.textContent = title;
  descEl.textContent = description;
  pwdInput.value = '';
  errEl.classList.add('hidden');
  errEl.textContent = '';
  modal.classList.remove('hidden');
  pwdInput.focus();

  confirmBtn.onclick = async () => {
    const sudoPassword = pwdInput.value;
    if (!sudoPassword) {
      errEl.textContent = 'Ingresa tu contraseña para continuar.';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      await onConfirm(sudoPassword);
      closeStepUpModal();
    } catch (err) {
      errEl.textContent = err.message || 'Contraseña incorrecta';
      errEl.classList.remove('hidden');
    }
  };
}

function closeStepUpModal() {
  const modal = document.getElementById('step-up-modal');
  if (modal) modal.classList.add('hidden');
}

function promptPromoteUser(userId) {
  openStepUpModal(
    'Promover a Administrador',
    `¿Deseas conceder privilegios totales de administración al usuario #${userId}?`,
    async (sudoPassword) => {
      const res = await fetch(`/admin/api/users/${userId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sudo_password: sudoPassword })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al promover usuario');
      showAdminToast(json.message, 'success');
      loadAdminUsers();
    }
  );
}

function promptDemoteUser(userId) {
  openStepUpModal(
    'Degradar Administrador',
    `¿Deseas remover el rol de administrador del usuario #${userId}?`,
    async (sudoPassword) => {
      const res = await fetch(`/admin/api/users/${userId}/demote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sudo_password: sudoPassword })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al degradar usuario');
      showAdminToast(json.message, 'success');
      loadAdminUsers();
    }
  );
}

function promptSoftDeleteUser(userId) {
  openStepUpModal(
    'Revocar Cuenta y Archivar Modelos 3D',
    `Esta acción revocará el acceso al usuario #${userId} y moverá sus modelos a la carpeta de archivo.`,
    async (sudoPassword) => {
      const res = await fetch(`/admin/api/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sudo_password: sudoPassword })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al revocar usuario');
      showAdminToast(json.message, 'success');
      loadAdminUsers();
    }
  );
}

// User Search filter
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('user-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      const filtered = currentUsersList.filter(u => u.email.toLowerCase().includes(term) || String(u.id).includes(term));
      renderUsersTable(filtered);
    });
  }
  loadAdminUsers();
});

window.loadAdminUsers = loadAdminUsers;
window.toggleBlockUser = toggleBlockUser;
window.promptPromoteUser = promptPromoteUser;
window.promptDemoteUser = promptDemoteUser;
window.promptSoftDeleteUser = promptSoftDeleteUser;
window.closeStepUpModal = closeStepUpModal;
