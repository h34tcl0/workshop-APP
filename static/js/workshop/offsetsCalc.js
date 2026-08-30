/**
 * Offsets & Measurements Calculator Logic (Modo Taller)
 */

let currentCalcInput = '';
let currentExpression = '';
let calcHistory = [];

function updateCalcDisplay() {
    const disp = document.getElementById('calc-display');
    const expr = document.getElementById('calc-expression');
    if (disp) disp.innerText = currentCalcInput || '0';
    if (expr) expr.innerText = currentExpression || '0';
}

function calcInput(val) {
    if (['+', '-', '*', '/'].includes(val)) {
        if (currentCalcInput) {
            currentExpression += ' ' + currentCalcInput + ' ' + val;
            currentCalcInput = '';
        } else if (currentExpression && ['+', '-', '*', '/'].includes(currentExpression.trim().slice(-1))) {
            currentExpression = currentExpression.trim().slice(0, -1) + ' ' + val;
        }
    } else {
        currentCalcInput += val;
    }
    updateCalcDisplay();
}

function calcClear() {
    currentCalcInput = '';
    currentExpression = '';
    const label = document.getElementById('calc-offset-label');
    if (label) label.innerText = '';
    updateCalcDisplay();
}

function calcBackspace() {
    if (currentCalcInput.length > 0) {
        currentCalcInput = currentCalcInput.slice(0, -1);
    }
    updateCalcDisplay();
}

function applyOffsetPreset(offsetValue, label) {
    const lblEl = document.getElementById('calc-offset-label');
    if (lblEl) lblEl.innerText = `Offset Aplicado: ${label} (${offsetValue > 0 ? '+' : ''}${offsetValue} mm)`;

    if (currentCalcInput) {
        const val = parseFloat(currentCalcInput);
        if (!isNaN(val)) {
            const res = val + offsetValue;
            addCalcHistory(`${val} [${label} (${offsetValue})]= ${res}`);
            currentCalcInput = String(res);
            updateCalcDisplay();
            return;
        }
    }

    if (currentExpression) {
        currentExpression += ` ${offsetValue > 0 ? '+' : ''} ${offsetValue}`;
        calcEquals();
    } else {
        currentCalcInput = String(offsetValue);
        updateCalcDisplay();
    }
}

function calcEquals() {
    try {
        let fullExpr = currentExpression;
        if (currentCalcInput) {
            fullExpr += ' ' + currentCalcInput;
        }
        fullExpr = fullExpr.trim();
        if (!fullExpr) return;

        const sanitized = fullExpr.replace(/[^0-9+\-*/.]/g, '');
        const result = Function(`'use strict'; return (${sanitized})`)();

        if (result !== undefined && !isNaN(result)) {
            const formattedRes = Math.round(result * 1000) / 1000;
            addCalcHistory(`${fullExpr} = ${formattedRes}`);
            currentExpression = `${fullExpr} =`;
            currentCalcInput = String(formattedRes);
            updateCalcDisplay();
        }
    } catch (e) {
        console.error('Error evaluating calculation:', e);
        const disp = document.getElementById('calc-display');
        if (disp) disp.innerText = 'Error';
    }
}

function addCalcHistory(item) {
    calcHistory.unshift(item);
    if (calcHistory.length > 15) calcHistory.pop();
    renderCalcHistory();
}

function renderCalcHistory() {
    const list = document.getElementById('calc-history-list');
    if (!list) return;
    if (calcHistory.length === 0) {
        list.innerHTML = '<p class="text-ink3 text-center py-3 italic font-sans text-xs">Realiza cálculos en el taller para registrar aquí tu historial.</p>';
        return;
    }

    let html = '';
    calcHistory.forEach((hist) => {
        const parts = hist.split('=');
        const resVal = parts[1] ? parts[1].trim() : '';
        html += `
            <div class="flex items-center justify-between p-2.5 bg-surface2 border border-hairline rounded-lg hover:border-brass/40 transition-colors">
                <span class="text-ink2">${hist}</span>
                <button type="button" onclick="useCalcHistoryValue('${resVal}')" class="bg-brass/20 text-brass hover:bg-brass hover:text-canvas text-[10px] font-bold px-2 py-1 rounded transition-colors">
                    Usar
                </button>
            </div>
        `;
    });
    list.innerHTML = html;
}

function useCalcHistoryValue(val) {
    if (val) {
        currentCalcInput = val;
        updateCalcDisplay();
    }
}

function clearCalcHistory() {
    calcHistory = [];
    renderCalcHistory();
}

function openManageOffsetsModal() {
    const modal = document.getElementById('manage-offsets-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeManageOffsetsModal() {
    const modal = document.getElementById('manage-offsets-modal');
    if (modal) modal.classList.add('hidden');
}

async function refreshCalculatorOffsetsView() {
    try {
        const res = await fetch(window.location.href);
        if (res.ok) {
            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const newOffsetsModal = doc.getElementById('manage-offsets-modal');
            const oldOffsetsModal = document.getElementById('manage-offsets-modal');
            if (newOffsetsModal && oldOffsetsModal) {
                const newList = newOffsetsModal.querySelector('.space-y-2');
                const oldList = oldOffsetsModal.querySelector('.space-y-2');
                if (newList && oldList) oldList.innerHTML = newList.innerHTML;
            }
            const newPresets = doc.getElementById('presets-quick-bar');
            const oldPresets = document.getElementById('presets-quick-bar');
            if (newPresets && oldPresets) {
                oldPresets.innerHTML = newPresets.innerHTML;
            }
        }
    } catch (e) {
        console.error('Error refreshing offsets:', e);
    }
}

async function submitAddOffsetForm(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
        const res = await fetch('/calculator/offsets/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json'
            },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            form.reset();
            await refreshCalculatorOffsetsView();
        }
    } catch (e) {
        console.error('Error adding offset preset:', e);
    }
}

async function deleteOffsetPreset(id) {
    if (!confirm('¿Seguro que deseas eliminar este preset?')) return;
    try {
        const res = await fetch(`/calculator/offsets/${id}/delete`, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
        });
        if (res.ok) {
            await refreshCalculatorOffsetsView();
        }
    } catch (e) {
        console.error('Error deleting offset preset:', e);
    }
}

if (typeof window !== 'undefined') {
    window.calcInput = calcInput;
    window.calcClear = calcClear;
    window.calcBackspace = calcBackspace;
    window.calcEquals = calcEquals;
    window.applyOffsetPreset = applyOffsetPreset;
    window.useCalcHistoryValue = useCalcHistoryValue;
    window.clearCalcHistory = clearCalcHistory;
    window.openManageOffsetsModal = openManageOffsetsModal;
    window.closeManageOffsetsModal = closeManageOffsetsModal;
    window.submitAddOffsetForm = submitAddOffsetForm;
    window.deleteOffsetPreset = deleteOffsetPreset;
}
