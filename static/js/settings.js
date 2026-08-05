// ── Modal de configuración ──
function openSettingsModal() { document.getElementById('settings-modal').classList.remove('hidden'); }
function closeSettingsModal() { document.getElementById('settings-modal').classList.add('hidden'); }

// ── Tooltips de ayuda junto a cada campo del modal ──
function toggleTip(tipId) {
    document.getElementById('tip-' + tipId).classList.toggle('hidden');
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
