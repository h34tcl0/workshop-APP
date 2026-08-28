// ── Guardado y Procesamiento de Configuración ──

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
            if (typeof refreshSettingsView === 'function') {
                await refreshSettingsView();
            }

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

Object.assign(window, {
    saveSettings
});
