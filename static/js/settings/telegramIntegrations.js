// ── Vinculación e Integraciones (Telegram y Google Calendar) ──

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[m]);
}

async function generateTelegramLinkCode() {
    const btn = event.target.closest('button') || event.target;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Generando...';

    try {
        const res = await fetch('/settings/telegram/generate-code', { method: 'POST' });
        if (!res.ok) throw new Error('Request failed');
        const data = await res.json();

        document.getElementById('telegram-link-code').textContent = data.code;
        document.getElementById('telegram-link-code-inline').textContent = data.code;

        const expiresAt = new Date(data.expiresAt);
        let intervalId;
        const updateExpiry = () => {
            const secondsLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000));
            const mins = Math.floor(secondsLeft / 60);
            const secs = secondsLeft % 60;
            const expiryEl = document.getElementById('telegram-link-expiry');
            if (!expiryEl) return;
            if (secondsLeft <= 0) {
                expiryEl.textContent = 'Código expirado. Genera uno nuevo.';
                if (intervalId) clearInterval(intervalId);
            } else {
                expiryEl.textContent = `Expira en ${mins}:${String(secs).padStart(2, '0')}`;
            }
        };
        updateExpiry();
        intervalId = setInterval(updateExpiry, 1000);

        document.getElementById('telegram-link-result').classList.remove('hidden');
    } catch (err) {
        alert('No se pudo generar el código. Intenta de nuevo.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function unlinkTelegram() {
    if (!confirm('¿Desvincular este chat de Telegram? Dejarás de recibir notificaciones hasta volver a vincularlo.')) {
        return;
    }
    try {
        const res = await fetch('/settings/telegram/unlink', { method: 'POST' });
        if (res.ok) {
            if (typeof showToast === 'function') {
                showToast('Telegram desvinculado');
            }
            if (typeof refreshSettingsView === 'function') {
                await refreshSettingsView();
            }
        } else {
            const txt = await res.text();
            alert('Error al desvincular Telegram: ' + (txt || res.statusText));
        }
    } catch (err) {
        alert('Error de red al desvincular Telegram');
    }
}

async function runCalendarReconciliation(btn) {
    const feedbackEl = document.getElementById('calendar-action-feedback');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Reconciliando...</span>';
    }
    if (feedbackEl) {
        feedbackEl.classList.remove('hidden');
        feedbackEl.textContent = 'Reconciliando eventos con Google Calendar...';
    }

    try {
        const res = await fetch('/api/calendar/reconcile', { method: 'POST' });
        const data = await res.json();
        if (feedbackEl) {
            if (data.success) {
                feedbackEl.textContent = data.reason || 'Reconciliación completada exitosamente.';
            } else {
                feedbackEl.textContent = data.reason || data.error || 'Error al reconciliar.';
            }
        }
        if (typeof showToast === 'function' && data.success) {
            showToast('Google Calendar reconciliado');
        }
    } catch (err) {
        if (feedbackEl) feedbackEl.textContent = 'Error de conexión al reconciliar.';
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

let currentOrphanEventIds = [];

async function previewCalendarCleanupOrphans(btn) {
    const feedbackEl = document.getElementById('calendar-action-feedback');
    const previewContainer = document.getElementById('calendar-orphan-preview-container');
    const previewMsg = document.getElementById('calendar-orphan-preview-msg');
    const orphanListEl = document.getElementById('calendar-orphan-list');
    
    if (previewContainer) previewContainer.classList.add('hidden');
    
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Buscando...</span>';
    }
    if (feedbackEl) {
        feedbackEl.classList.remove('hidden');
        feedbackEl.textContent = 'Consultando eventos en tu Google Calendar...';
    }

    try {
        const res = await fetch('/api/calendar/preview-orphans');
        const data = await res.json();
        
        if (!data.success) {
            if (feedbackEl) feedbackEl.textContent = data.error || 'Error al consultar Google Calendar.';
            return;
        }

        const orphans = data.orphanEvents || [];
        currentOrphanEventIds = orphans.map(o => o.id);

        if (orphans.length === 0) {
            if (feedbackEl) {
                feedbackEl.textContent = 'Tu Google Calendar está limpio. No se encontraron eventos huérfanos.';
            }
            return;
        }

        if (feedbackEl) feedbackEl.classList.add('hidden');
        
        if (previewContainer && previewMsg && orphanListEl) {
            previewMsg.textContent = `Se encontraron ${orphans.length} evento(s) en Google Calendar sin jornada de trabajo activa asociada:`;
            orphanListEl.innerHTML = orphans.map(o => {
                const dateStr = o.start ? o.start.replace('T', ' ').substring(0, 16) : 'Fecha sin definir';
                return `
                    <div class="p-1.5 rounded bg-surface border border-hairline flex flex-col gap-0.5">
                        <span class="font-semibold text-ink">${escapeHtml(o.summary || 'Sin título')}</span>
                        <span class="text-[10px] text-ink3">${escapeHtml(dateStr)}</span>
                    </div>
                `;
            }).join('');
            previewContainer.classList.remove('hidden');
        }
    } catch (err) {
        if (feedbackEl) feedbackEl.textContent = 'Error de conexión al buscar eventos huérfanos.';
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

function cancelCalendarCleanupPreview() {
    const previewContainer = document.getElementById('calendar-orphan-preview-container');
    if (previewContainer) previewContainer.classList.add('hidden');
    currentOrphanEventIds = [];
}

async function executeConfirmedCalendarCleanup(btn) {
    const feedbackEl = document.getElementById('calendar-action-feedback');
    const previewContainer = document.getElementById('calendar-orphan-preview-container');
    
    if (currentOrphanEventIds.length === 0) {
        if (previewContainer) previewContainer.classList.add('hidden');
        return;
    }

    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Eliminando...</span>';
    }

    try {
        const res = await fetch('/api/calendar/cleanup-orphans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetEventIds: currentOrphanEventIds })
        });
        const data = await res.json();
        
        if (previewContainer) previewContainer.classList.add('hidden');
        if (feedbackEl) {
            feedbackEl.classList.remove('hidden');
            if (data.success) {
                feedbackEl.textContent = `Limpieza completada: ${data.deletedCount} evento(s) huérfano(s) eliminado(s) exitosamente.`;
            } else {
                feedbackEl.textContent = data.error || 'Error al eliminar eventos huérfanos.';
            }
        }
        if (typeof showToast === 'function' && data.success) {
            showToast(`Limpieza: ${data.deletedCount} eventos eliminados`);
        }
        currentOrphanEventIds = [];
    } catch (err) {
        if (feedbackEl) {
            feedbackEl.classList.remove('hidden');
            feedbackEl.textContent = 'Error de conexión al ejecutar el borrado.';
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

Object.assign(window, {
    escapeHtml,
    generateTelegramLinkCode,
    unlinkTelegram,
    runCalendarReconciliation,
    previewCalendarCleanupOrphans,
    cancelCalendarCleanupPreview,
    executeConfirmedCalendarCleanup
});
