// ── Modal de configuración ──
function openSettingsModal() { 
    document.getElementById('settings-modal').classList.remove('hidden');
    switchSettingsTab('location');
}
function closeSettingsModal() { document.getElementById('settings-modal').classList.add('hidden'); }

// ── Tabs horizontales del modal de configuración ──
function switchSettingsTab(tabKey) {
    // Actualizar botones de tab
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.remove('border-brass', 'text-brass', 'bg-surface');
        btn.classList.add('border-transparent', 'text-ink3');
    });
    const activeBtn = document.getElementById('tab-btn-' + tabKey);
    if (activeBtn) {
        activeBtn.classList.remove('border-transparent', 'text-ink3');
        activeBtn.classList.add('border-brass', 'text-brass', 'bg-surface');
    }

    // Actualizar paneles de contenido
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    const activeContent = document.getElementById('tab-content-tab-' + tabKey) || document.getElementById('tab-content-' + tabKey);
    if (activeContent) {
        activeContent.classList.remove('hidden');
    }
}

// ── Sincronización de inputs de tiempo (Horas + Minutos -> Decimal) ──
function syncDurationField(fieldPrefix) {
    const hInput = document.getElementById(fieldPrefix + '_h');
    const mInput = document.getElementById(fieldPrefix + '_m');
    const targetInput = document.getElementById('input_' + fieldPrefix + '_hours');

    if (hInput && mInput && targetInput) {
        const hours = parseInt(hInput.value, 10) || 0;
        const minutes = parseInt(mInput.value, 10) || 0;
        const decimalVal = Math.round((hours + minutes / 60.0) * 100) / 100;
        targetInput.value = decimalVal;
    }
}

// ── Tooltips de ayuda junto a cada campo del modal ──
function toggleTip(tipId) {
    const tip = document.getElementById('tip-' + tipId);
    if (tip) tip.classList.toggle('hidden');
}

// ── Vinculación de Telegram por código OTP ──
async function generateTelegramLinkCode() {
    const btn = event.target;
    const originalText = btn.textContent;
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
                expiryEl.textContent = 'Código expirado. Generá uno nuevo.';
                if (intervalId) clearInterval(intervalId);
            } else {
                expiryEl.textContent = `Expira en ${mins}:${String(secs).padStart(2, '0')}`;
            }
        };
        updateExpiry();
        intervalId = setInterval(updateExpiry, 1000);

        document.getElementById('telegram-link-result').classList.remove('hidden');
    } catch (err) {
        alert('No se pudo generar el código. Intentá de nuevo.');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function refreshSettingsView() {
    try {
        const res = await fetch(window.location.href);
        if (res.ok) {
            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const newModal = doc.getElementById('settings-modal');
            const oldModal = document.getElementById('settings-modal');
            if (newModal && oldModal) {
                const wasHidden = oldModal.classList.contains('hidden');
                oldModal.innerHTML = newModal.innerHTML;
                if (wasHidden) oldModal.classList.add('hidden');
                else oldModal.classList.remove('hidden');
            }
            const newHeader = doc.querySelector('header');
            const oldHeader = document.querySelector('header');
            if (newHeader && oldHeader) {
                oldHeader.innerHTML = newHeader.innerHTML;
            }
        }
    } catch (e) {
        console.error('Error refreshing settings view:', e);
    }
}

async function saveSettings(event) {
    if (event) event.preventDefault();
    const form = document.getElementById('settings-form') || (event && event.target);
    if (!form) return;

    const btn = document.getElementById('btn-save-settings') || form.querySelector('button[type="submit"]');
    const btnText = document.getElementById('btn-save-settings-text');
    const originalText = btnText ? btnText.innerHTML : (btn ? btn.innerHTML : 'Guardar ajustes');
    
    if (btn) {
        btn.disabled = true;
        if (btnText) {
            btnText.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-canvas inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Guardando y evaluando...`;
        } else {
            btn.innerHTML = 'Guardando y evaluando...';
        }
    }

    try {
        const formData = new FormData(form);
        const body = new URLSearchParams(formData);

        const res = await fetch('/settings/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json'
            },
            body: body.toString()
        });

        if (res.ok) {
            closeSettingsModal();
            if (typeof showToast === 'function') {
                showToast('Ajustes guardados y agenda reevaluada correctamente', 'success');
            }
            
            // Actualizar la vista de ajustes/header
            await refreshSettingsView();

            // Actualizar la agenda, backlog y cola de trabajo en vivo
            if (typeof window.refreshWorkshopView === 'function') {
                await window.refreshWorkshopView();
            }
        } else {
            const txt = await res.text();
            alert('Error al guardar configuración: ' + (txt || res.statusText));
        }
    } catch (err) {
        console.error('Error al guardar la configuración:', err);
        alert('Error de red al guardar la configuración');
    } finally {
        if (btn) {
            btn.disabled = false;
            if (btnText) {
                btnText.innerHTML = originalText;
            } else {
                btn.innerHTML = originalText;
            }
        }
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
            await refreshSettingsView();
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
        btn.innerHTML = '<span>🔄 Reconciliando...</span>';
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
        btn.innerHTML = '<span>🔍 Buscando...</span>';
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
                feedbackEl.textContent = '✨ Tu Google Calendar está limpio. No se encontraron eventos huérfanos.';
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
                        <span class="text-[10px] text-ink3">🕒 ${escapeHtml(dateStr)}</span>
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
        btn.innerHTML = '<span>⏳ Eliminando...</span>';
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
                feedbackEl.textContent = `✅ Limpieza completada: ${data.deletedCount} evento(s) huérfano(s) eliminado(s) exitosamente.`;
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

function toggleChangePasswordSection(forceState) {
    const panel = document.getElementById('change-password-panel');
    const inputPass = document.getElementById('input-new-password');
    const inputConfirm = document.getElementById('input-new-password-confirm');
    const feedback = document.getElementById('change-password-feedback');
    
    if (!panel) return;
    
    const shouldShow = typeof forceState === 'boolean' ? forceState : panel.classList.contains('hidden');
    if (shouldShow) {
        panel.classList.remove('hidden');
        if (inputPass) inputPass.focus();
    } else {
        panel.classList.add('hidden');
        if (inputPass) inputPass.value = '';
        if (inputConfirm) inputConfirm.value = '';
        if (feedback) {
            feedback.classList.add('hidden');
            feedback.textContent = '';
        }
    }
}

async function submitChangePassword(btn) {
    const inputPass = document.getElementById('input-new-password');
    const inputConfirm = document.getElementById('input-new-password-confirm');
    const feedback = document.getElementById('change-password-feedback');
    
    const new_password = inputPass ? inputPass.value.trim() : '';
    const new_password_confirm = inputConfirm ? inputConfirm.value.trim() : '';

    if (!feedback) return;
    feedback.classList.remove('hidden', 'text-emerald-400', 'text-red-400', 'border-emerald-500/40', 'border-red-500/40');

    if (!new_password || new_password.length < 6) {
        feedback.classList.add('text-red-400', 'border-red-500/40');
        feedback.textContent = 'La nueva contraseña debe tener al menos 6 caracteres.';
        return;
    }

    if (new_password !== new_password_confirm) {
        feedback.classList.add('text-red-400', 'border-red-500/40');
        feedback.textContent = 'Las contraseñas no coinciden.';
        return;
    }

    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Actualizando...</span>';
    }

    try {
        const res = await fetch('/api/user/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_password, new_password_confirm })
        });
        const data = await res.json();

        if (res.ok && data.status === 'ok') {
            feedback.classList.add('text-emerald-400', 'border-emerald-500/40');
            feedback.textContent = '✅ ' + (data.message || 'Contraseña actualizada correctamente.');
            if (inputPass) inputPass.value = '';
            if (inputConfirm) inputConfirm.value = '';
            if (typeof showToast === 'function') {
                showToast('Contraseña actualizada correctamente');
            }
            setTimeout(() => {
                toggleChangePasswordSection(false);
            }, 1800);
        } else {
            feedback.classList.add('text-red-400', 'border-red-500/40');
            feedback.textContent = '❌ ' + (data.error || 'Error al actualizar contraseña.');
        }
    } catch (err) {
        feedback.classList.add('text-red-400', 'border-red-500/40');
        feedback.textContent = 'Error de conexión al intentar cambiar la contraseña.';
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

async function triggerManualBackup(btn) {
    const feedbackEl = document.getElementById('backup-action-feedback');
    const originalText = btn ? btn.innerHTML : '';

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>💾 Generando Backup...</span>';
    }
    if (feedbackEl) {
        feedbackEl.classList.remove('hidden', 'text-emerald-400', 'text-red-400', 'border-emerald-500/40', 'border-red-500/40');
        feedbackEl.textContent = 'Generando copia de seguridad en caliente (WAL mode)...';
    }

    try {
        const res = await fetch('/api/admin/backup', { method: 'POST' });
        const data = await res.json();

        if (feedbackEl) {
            if (res.ok && data.status === 'ok') {
                const pathMsg = data.backup_path ? ` (${data.backup_path})` : '';
                feedbackEl.classList.add('text-emerald-400', 'border-emerald-500/40');
                feedbackEl.textContent = `✅ ${data.message || 'Copia de seguridad creada con éxito'}${pathMsg}`;
                if (typeof showToast === 'function') {
                    showToast('Backup WAL creado exitosamente');
                }
            } else {
                feedbackEl.classList.add('text-red-400', 'border-red-500/40');
                feedbackEl.textContent = `❌ ${data.error || 'Error al generar la copia de seguridad.'}`;
            }
        }
    } catch (err) {
        if (feedbackEl) {
            feedbackEl.classList.add('text-red-400', 'border-red-500/40');
            feedbackEl.textContent = 'Error de conexión al generar la copia de seguridad.';
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

Object.assign(window, {
    openSettingsModal,
    closeSettingsModal,
    switchSettingsTab,
    syncDurationField,
    toggleTip,
    generateTelegramLinkCode,
    saveSettings,
    unlinkTelegram,
    runCalendarReconciliation,
    previewCalendarCleanupOrphans,
    cancelCalendarCleanupPreview,
    executeConfirmedCalendarCleanup,
    toggleChangePasswordSection,
    submitChangePassword,
    triggerManualBackup
});
