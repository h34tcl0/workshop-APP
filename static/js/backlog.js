// BACKLOG MAIN ORCHESTRATOR (static/js/backlog.js)
async function refreshBacklogView() {
    try {
        const res = await fetch(window.location.href);
        if (!res.ok) return;
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        ['backlog-container', 'agenda-container', 'left-rail-panel', 'right-rail-panel'].forEach(id => {
            const n = doc.getElementById(id), o = document.getElementById(id);
            if (n && o) o.innerHTML = n.innerHTML;
        });
        [restoreMainTab, restoreProjectAccordions, initMoveTaskForms, initSortable, initTaskAutocomplete, initCuringCalculation, restoreSelectedAgendaDay, updateCalendarGridTaskStatuses].forEach(fn => typeof fn === 'function' && fn());
    } catch (e) { console.error('Error refreshing backlog:', e); }
}
function showToast(msg, durationMs = 3000) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerText = msg;
    t.classList.remove('hidden');
    clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => t.classList.add('hidden'), durationMs);
}
function switchMainTab(tabKey) {
    ['backlog', 'projects', 'history'].forEach(k => {
        document.getElementById('content-tab-' + k)?.classList.toggle('hidden', k !== tabKey);
        const btn = document.getElementById('main-tab-' + k);
        if (btn) btn.className = k === tabKey ? 'px-3 py-1.5 rounded-xl font-semibold text-xs transition-colors bg-brass text-canvas shadow-xs' : 'px-3 py-1.5 rounded-xl font-semibold text-xs transition-colors text-ink2 hover:bg-surface2';
    });
    sessionStorage.setItem('active_backlog_main_tab', tabKey);
}
function restoreMainTab() {
    const s = sessionStorage.getItem('active_backlog_main_tab');
    if (s && ['backlog', 'projects', 'history'].includes(s)) switchMainTab(s);
}
const openBacklogDrawerTab = (k) => { document.getElementById('backlog-drawer-modal')?.classList.remove('hidden'); if (k) switchMainTab(k); };
const closeBacklogDrawer = () => document.getElementById('backlog-drawer-modal')?.classList.add('hidden');
const toggleBacklogDrawerTab = (k) => { const d = document.getElementById('backlog-drawer-modal'); if (d && !d.classList.contains('hidden') && sessionStorage.getItem('active_backlog_main_tab') === k) closeBacklogDrawer(); else openBacklogDrawerTab(k); };
function toggleFocusMode() {
    const col = document.getElementById('backlog-container');
    if (!col) return;
    const isCollapsed = !col.classList.contains('-translate-x-full');
    ['-translate-x-full', 'opacity-0', '!max-w-0'].forEach(c => col.classList.toggle(c, isCollapsed));
    const txt = document.getElementById('toggle-backlog-text');
    if (txt) txt.innerText = isCollapsed ? 'Mostrar Backlog' : 'Modo Enfoque';
}
const toggleHistory = () => { document.getElementById('history-panel')?.classList.toggle('hidden'); document.getElementById('history-chevron')?.classList.toggle('rotate-180'); };
document.addEventListener('DOMContentLoaded', () => { [restoreMainTab, restoreProjectAccordions, initMoveTaskForms, initSortable, initTaskAutocomplete, initCuringCalculation].forEach(fn => typeof fn === 'function' && fn()); });
Object.assign(window, { showToast, switchMainTab, restoreMainTab, openBacklogDrawerTab, closeBacklogDrawer, toggleBacklogDrawerTab, toggleFocusMode, toggleHistory, refreshBacklogView });
