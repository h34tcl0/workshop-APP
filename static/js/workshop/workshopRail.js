/**
 * Workshop Rail Navigation Controller
 * Sincroniza la navegación vertical (Desktop) y la barra inferior táctil (Mobile)
 * para cambiar de herramientas sin recarga de página y persistir en localStorage.
 */

const WORKSHOP_TOOLS = ['offsets', 'screws', 'centering', 'square', 'viewer3d'];

function switchWorkshopTool(toolId) {
    if (!WORKSHOP_TOOLS.includes(toolId)) {
        toolId = 'offsets';
    }

    // 1. Alternar vistas
    WORKSHOP_TOOLS.forEach(id => {
        const viewEl = document.getElementById(`tool-${id}-view`);
        if (viewEl) {
            if (id === toolId) {
                viewEl.classList.remove('hidden');
            } else {
                viewEl.classList.add('hidden');
            }
        }
    });

    // 2. Actualizar estilos del Left Rail Desktop (>= 768px)
    WORKSHOP_TOOLS.forEach(id => {
        const deskBtn = document.getElementById(`ws-rail-btn-${id}`);
        if (deskBtn) {
            if (id === toolId) {
                deskBtn.className = 'w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-brass text-canvas font-bold flex flex-col items-center justify-center shadow-xs transition-all active:scale-95 group relative';
            } else {
                deskBtn.className = 'w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-surface2 hover:bg-hairline text-ink hover:text-brass flex flex-col items-center justify-center transition-all group active:scale-95 relative';
            }
        }
    });

    // 3. Actualizar estilos del Bottom Nav Mobile (< 768px)
    WORKSHOP_TOOLS.forEach(id => {
        const mobBtn = document.getElementById(`ws-mob-btn-${id}`);
        if (mobBtn) {
            const iconWrap = mobBtn.querySelector('div');
            const labelSpan = mobBtn.querySelector('span');

            if (id === toolId) {
                mobBtn.className = 'flex-1 flex flex-col items-center justify-center py-1 px-1 rounded-xl text-brass active:scale-95 transition-all';
                if (iconWrap) iconWrap.className = 'w-8 h-8 rounded-lg bg-brass text-canvas flex items-center justify-center shadow-xs mb-0.5';
                if (labelSpan) labelSpan.className = 'text-[10px] font-bold tracking-tight font-sans text-ink';
            } else {
                mobBtn.className = 'flex-1 flex flex-col items-center justify-center py-1 px-1 rounded-xl text-ink3 hover:text-ink active:scale-95 transition-all';
                if (iconWrap) iconWrap.className = 'w-8 h-8 rounded-lg bg-surface2 flex items-center justify-center mb-0.5 text-ink';
                if (labelSpan) labelSpan.className = 'text-[10px] font-medium tracking-tight text-ink3 font-sans';
            }
        }
    });

    // 4. Persistir selección
    try {
        localStorage.setItem('agendapp_workshop_tool', toolId);
    } catch (_) {}

    // Si conmutamos a screws, square, centering o viewer3d, disparamos su lógica reactiva
    if (toolId === 'screws' && typeof window.calculateScrews === 'function') {
        window.calculateScrews();
    }
    if (toolId === 'square' && typeof window.calculateDiagonals === 'function') {
        window.calculateDiagonals();
    }
    if (toolId === 'centering' && typeof window.calculateCentering === 'function') {
        window.calculateCentering();
    }
    if (toolId === 'viewer3d') {
        if (typeof window.init3dCore === 'function') window.init3dCore();
        setTimeout(() => {
            if (typeof window.resize3dViewport === 'function') {
                window.resize3dViewport();
            }
        }, 50);
        if (typeof window.checkAndLoadSaved3dModel === 'function' && (!window.V3D || !window.V3D.currentRoot)) {
            window.checkAndLoadSaved3dModel();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    let savedTool = 'offsets';
    try {
        savedTool = localStorage.getItem('agendapp_workshop_tool') || 'offsets';
    } catch (_) {}
    switchWorkshopTool(savedTool);
});

if (typeof window !== 'undefined') {
    window.switchWorkshopTool = switchWorkshopTool;
}
