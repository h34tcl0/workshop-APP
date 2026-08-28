// ── Modal de configuración & Gestión de Pestañas ──

function openSettingsModal() { 
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('hidden');
    switchSettingsTab('location');
}

function closeSettingsModal() { 
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden'); 
}

function switchSettingsTab(tabKey) {
    // Actualizar botones de tab en desktop (grid)
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.remove('border-brass', 'text-brass', 'bg-surface/60');
        btn.classList.add('border-transparent', 'text-ink3');
    });
    const activeBtn = document.getElementById('tab-btn-' + tabKey);
    if (activeBtn) {
        activeBtn.classList.remove('border-transparent', 'text-ink3');
        activeBtn.classList.add('border-brass', 'text-brass', 'bg-surface/60');
    }

    // Sincronizar el selector móvil
    const mobileSelect = document.getElementById('settings-tab-select');
    if (mobileSelect && mobileSelect.value !== tabKey) {
        mobileSelect.value = tabKey;
    }

    // Mostrar solo el panel activo
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    const activeContent = document.getElementById('tab-content-' + tabKey);
    if (activeContent) {
        activeContent.classList.remove('hidden');
    }

    // Invalidar tamaño de mapa Leaflet al abrir pestaña de ubicación si existe
    if (tabKey === 'location' && window.locationMap) {
        setTimeout(() => {
            try {
                window.locationMap.invalidateSize();
            } catch (e) {}
        }, 100);
    }
}

function syncDurationField(fieldPrefix) {
    if (typeof syncDurationInputs === 'function') {
        syncDurationInputs(fieldPrefix);
    } else {
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
}

function toggleTip(tipId) {
    const tip = document.getElementById('tip-' + tipId);
    if (tip) tip.classList.toggle('hidden');
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

Object.assign(window, {
    openSettingsModal,
    closeSettingsModal,
    switchSettingsTab,
    syncDurationField,
    toggleTip,
    refreshSettingsView
});
