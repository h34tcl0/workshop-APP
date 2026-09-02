// static/js/admin/adminAudit.js - Admin audit log viewer & pagination

let auditCurrentPage = 1;
const auditPageLimit = 20;

async function loadAdminAuditLogs(page = 1) {
  auditCurrentPage = page;
  const tbody = document.getElementById('audit-table-body');
  const actionFilter = document.getElementById('audit-action-filter')?.value || '';
  if (!tbody) return;

  try {
    const params = new URLSearchParams({
      page: String(auditCurrentPage),
      limit: String(auditPageLimit)
    });
    if (actionFilter) params.append('action', actionFilter);

    const res = await fetch(`/admin/api/audit-log?${params.toString()}`);
    if (!res.ok) throw new Error('Error al cargar registro de auditoría');
    const data = await res.json();
    renderAuditTable(data.logs || [], data.pagination || {});
  } catch (err) {
    console.error('[ADMIN AUDIT]', err);
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-red-400 font-mono">Error: ${err.message}</td></tr>`;
  }
}

function renderAuditTable(logs, pagination) {
  const tbody = document.getElementById('audit-table-body');
  const infoEl = document.getElementById('audit-pagination-info');
  const prevBtn = document.getElementById('audit-btn-prev');
  const nextBtn = document.getElementById('audit-btn-next');

  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500 font-mono">No hay registros de auditoría disponibles</td></tr>`;
  } else {
    tbody.innerHTML = logs.map(l => {
      const dateStr = l.created_at ? new Date(l.created_at).toLocaleString('es-CL') : 'N/A';
      return `
        <tr class="hover:bg-slate-900/40 transition-colors font-mono text-[11px]">
          <td class="px-4 py-2.5 text-slate-400 whitespace-nowrap">${dateStr}</td>
          <td class="px-4 py-2.5 text-slate-200">
            ${l.admin_email || `ID #${l.admin_user_id}`}
          </td>
          <td class="px-4 py-2.5 font-semibold text-amber-400">${l.action}</td>
          <td class="px-4 py-2.5 text-slate-300">${l.target_user_id ? `#${l.target_user_id}` : '-'}</td>
          <td class="px-4 py-2.5 text-slate-400">${l.ip_address || '127.0.0.1'}</td>
          <td class="px-4 py-2.5 text-slate-400 max-w-xs truncate" title="${l.details || ''}">
            ${l.details || '-'}
          </td>
        </tr>
      `;
    }).join('');
  }

  if (infoEl && pagination.page) {
    infoEl.textContent = `Página ${pagination.page} de ${pagination.total_pages || 1} (${pagination.total_records || 0} registros)`;
  }

  if (prevBtn) prevBtn.disabled = !pagination.has_prev;
  if (nextBtn) nextBtn.disabled = !pagination.has_next;
}

function changeAuditPage(delta) {
  loadAdminAuditLogs(auditCurrentPage + delta);
}

window.loadAdminAuditLogs = loadAdminAuditLogs;
window.changeAuditPage = changeAuditPage;
