// ── Seguridad, Contraseñas y Backups ──

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
            feedback.textContent = data.message || 'Contraseña actualizada correctamente.';
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
            feedback.textContent = data.error || 'Error al actualizar contraseña.';
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
        btn.innerHTML = '<span>Generando Backup...</span>';
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
                feedbackEl.textContent = `${data.message || 'Copia de seguridad creada con éxito'}${pathMsg}`;
                if (typeof showToast === 'function') {
                    showToast('Backup WAL creado exitosamente');
                }
            } else {
                feedbackEl.classList.add('text-red-400', 'border-red-500/40');
                feedbackEl.textContent = data.error || 'Error al generar la copia de seguridad.';
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
    toggleChangePasswordSection,
    submitChangePassword,
    triggerManualBackup
});
