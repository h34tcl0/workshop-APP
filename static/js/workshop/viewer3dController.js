/**
 * 3D Viewer Controller & Persistence API Handler
 */

function set3dExplode(percent) {
    const p = parseFloat(percent) || 0;
    const factor = (p / 100) * 1.8; // Escala máxima de separación
    const explodeVal = document.getElementById('v3d-explode-val');
    if (explodeVal) explodeVal.innerText = `${Math.round(p)}%`;

    if (!window.V3D.parts || window.V3D.parts.length === 0) return;

    window.V3D.parts.forEach(part => {
        if (!part.mesh || !part.originalPosition || !part.explodeVector) return;
        const newPos = part.originalPosition.clone().addScaledVector(part.explodeVector, factor);
        part.mesh.position.copy(newPos);
    });
}

function show3dLoader(show, text) {
    const overlay = document.getElementById('v3d-loading-overlay');
    const textEl = document.getElementById('v3d-loading-text');
    if (overlay) {
        if (show) overlay.classList.remove('hidden');
        else overlay.classList.add('hidden');
    }
    if (textEl && text) textEl.innerText = text;
}

async function checkAndLoadSaved3dModel() {
    try {
        window.init3dCore();
        const res = await fetch('/api/workshop/model3d/status');
        if (!res.ok) return;
        const data = await res.json();
        if (data.hasModel && data.filename) {
            loadModelFromUrl('/api/workshop/model3d/latest', data.filename);
        }
    } catch (err) {
        console.error('[3D Viewer] Error checking saved model:', err);
    }
}

async function loadModelFromUrl(url, filename) {
    show3dLoader(true, `Cargando ${filename}...`);
    window.init3dCore();
    const ext = filename.split('.').pop().toLowerCase();

    try {
        if (ext === 'glb' || ext === 'gltf') {
            if (typeof THREE.GLTFLoader === 'undefined') {
                console.error('[3D Viewer] GLTFLoader not available');
                show3dLoader(false);
                return;
            }
            const loader = new THREE.GLTFLoader();
            loader.load(url, (gltf) => {
                show3dLoader(false);
                window.setupModelInScene(gltf.scene || gltf.scenes[0], filename);
            }, undefined, (err) => {
                console.error('[3D Viewer] Error loading GLTF:', err);
                show3dLoader(false);
            });
        } else if (ext === 'obj') {
            if (typeof THREE.OBJLoader === 'undefined') {
                console.error('[3D Viewer] OBJLoader not available');
                show3dLoader(false);
                return;
            }
            const loader = new THREE.OBJLoader();
            loader.load(url, (obj) => {
                show3dLoader(false);
                window.setupModelInScene(obj, filename);
            }, undefined, (err) => {
                console.error('[3D Viewer] Error loading OBJ:', err);
                show3dLoader(false);
            });
        } else {
            show3dLoader(false);
        }
    } catch (err) {
        console.error('[3D Viewer] Error in loadModelFromUrl:', err);
        show3dLoader(false);
    }
}

async function upload3dFile(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
        show3dLoader(true, 'El archivo supera el límite de 50 MB');
        setTimeout(() => show3dLoader(false), 3000);
        return;
    }
    show3dLoader(true, `Subiendo ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`);
    try {
        const res = await fetch('/api/workshop/model3d', {
            method: 'POST',
            headers: {
                'x-filename': encodeURIComponent(file.name),
                'content-type': 'application/octet-stream'
            },
            body: file
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
            loadModelFromUrl('/api/workshop/model3d/latest', file.name);
        } else {
            const msg = data.error || (res.status === 413 ? 'El archivo supera el límite de 50 MB' : 'Error al procesar el modelo 3D');
            show3dLoader(true, `Error: ${msg}`);
            setTimeout(() => show3dLoader(false), 3500);
        }
    } catch (err) {
        console.error('[3D Viewer] Error uploading file:', err);
        show3dLoader(true, 'Error de conexión durante la subida');
        setTimeout(() => show3dLoader(false), 3500);
    }
}

async function delete3dModel() {
    if (!confirm('¿Deseas eliminar el modelo 3D guardado?')) return;
    try {
        const res = await fetch('/api/workshop/model3d', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            if (window.V3D.currentRoot && window.V3D.scene) {
                window.V3D.scene.remove(window.V3D.currentRoot);
                window.V3D.currentRoot = null;
            }
            window.V3D.parts = [];
            const badge = document.getElementById('v3d-status-badge');
            const emptyPrompt = document.getElementById('v3d-empty-prompt');
            const toolbar = document.getElementById('v3d-floating-toolbar');
            const meshCountEl = document.getElementById('v3d-mesh-count');
            if (badge) {
                badge.innerText = 'Sin Modelo';
                badge.className = 'text-xs font-mono bg-surface2 text-ink3 border border-hairline px-2.5 py-1 rounded-full font-bold';
            }
            if (emptyPrompt) emptyPrompt.classList.remove('hidden');
            if (toolbar) toolbar.classList.add('hidden');
            if (meshCountEl) meshCountEl.innerText = '0 piezas detectadas';
        }
    } catch (err) {
        console.error('[3D Viewer] Error deleting model:', err);
    }
}

function trigger3dUpload() {
    const input = document.getElementById('v3d-file-input');
    if (input) input.click();
}

function init3dDropzone() {
    const dropzone = document.getElementById('v3d-upload-zone');
    const input = document.getElementById('v3d-file-input');
    if (!dropzone || !input) return;

    dropzone.addEventListener('click', (e) => {
        if (e.target && e.target.closest('#v3d-btn-demo')) return;
        input.click();
    });

    input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
            upload3dFile(input.files[0]);
        }
    });

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('border-brass', 'bg-brass/10');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('border-brass', 'bg-brass/10');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('border-brass', 'bg-brass/10');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            upload3dFile(e.dataTransfer.files[0]);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    init3dDropzone();
});

if (typeof window !== 'undefined') {
    window.set3dExplode = set3dExplode;
    window.checkAndLoadSaved3dModel = checkAndLoadSaved3dModel;
    window.upload3dFile = upload3dFile;
    window.delete3dModel = delete3dModel;
    window.trigger3dUpload = trigger3dUpload;
}
