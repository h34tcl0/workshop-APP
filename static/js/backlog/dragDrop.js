// DRAG AND DROP SUBMODULE (static/js/backlog/dragDrop.js)
function initSortable() {
    const list = document.getElementById('backlog-task-list');
    if (!list || typeof Sortable === 'undefined') return;

    Sortable.create(list, {
        animation: 200,
        ghostClass: 'opacity-40',
        dragClass: 'shadow-2xl',
        delay: 50,
        delayOnTouchOnly: true,
        filter: 'button, input, select, textarea, a, form, [onclick]',
        preventOnFilter: false,
        onEnd: function () {
            const items = list.querySelectorAll('.task-card[data-id]');
            const orderedIds = Array.from(items).map(el => parseInt(el.dataset.id, 10));

            fetch('/tasks/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_ids: orderedIds })
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'ok') {
                    showToast('Orden guardado');
                }
            })
            .catch(() => {});
        }
    });
}

Object.assign(window, {
    initSortable
});
