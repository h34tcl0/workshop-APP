/**
 * Three.js 3D Viewport Core for Workshop OS
 */

window.V3D = {
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    currentRoot: null,
    parts: [], // { mesh, originalPos, explodeVector }
    wireframeMode: false,
    initialized: false
};

function init3dCore() {
    const container = document.getElementById('v3d-canvas-container');
    if (!container) return;

    if (window.V3D.initialized) {
        resize3dViewport();
        return;
    }

    if (typeof THREE === 'undefined') {
        console.warn('[3D Core] Three.js not loaded yet.');
        return;
    }

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 420;

    // Scene & Background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 2000);
    camera.position.set(2.5, 2.0, 3.5);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.touchAction = 'none';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // OrbitControls instanciados sobre renderer.domElement (el canvas directo)
    let controls = null;
    if (typeof THREE.OrbitControls !== 'undefined') {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
    } else if (typeof OrbitControls !== 'undefined') {
        controls = new OrbitControls(camera, renderer.domElement);
    }
    if (controls) {
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.maxDistance = 1000;
        controls.minDistance = 0.01;
        controls.target.set(0, 0, 0);
    }

    // Luces optimizadas para evitar piezas oscuras/invisibles
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    const dirLightFront = new THREE.DirectionalLight(0xfff7ed, 1.4);
    dirLightFront.position.set(6, 12, 8);
    scene.add(dirLightFront);

    const dirLightBack = new THREE.DirectionalLight(0xdbeafe, 1.0);
    dirLightBack.position.set(-6, -8, -8);
    scene.add(dirLightBack);

    const dirLightFill = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLightFill.position.set(0, -10, 0);
    scene.add(dirLightFill);

    // Grid Floor
    const gridHelper = new THREE.GridHelper(10, 20, 0xd97706, 0x334155);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    window.V3D.scene = scene;
    window.V3D.camera = camera;
    window.V3D.renderer = renderer;
    window.V3D.controls = controls;
    window.V3D.initialized = true;

    // Continuous Animation Loop
    function animate() {
        requestAnimationFrame(animate);
        if (window.V3D.controls) {
            window.V3D.controls.update();
        }
        if (window.V3D.renderer && window.V3D.scene && window.V3D.camera) {
            window.V3D.renderer.render(window.V3D.scene, window.V3D.camera);
        }
    }
    animate();

    // Responsive Resize Observer
    const resizeObserver = new ResizeObserver(() => {
        resize3dViewport();
    });
    resizeObserver.observe(container);
}

function resize3dViewport() {
    const container = document.getElementById('v3d-canvas-container');
    if (!container || !window.V3D.renderer || !window.V3D.camera) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
        window.V3D.camera.aspect = w / h;
        window.V3D.camera.updateProjectionMatrix();
        window.V3D.renderer.setSize(w, h);
    }
}

function reset3dCamera() {
    if (!window.V3D.camera || !window.V3D.controls) return;
    if (window.V3D.currentRoot) {
        const box = new THREE.Box3().setFromObject(window.V3D.currentRoot);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 2.0;

        window.V3D.camera.near = maxDim / 100;
        window.V3D.camera.far = maxDim * 100;
        window.V3D.camera.updateProjectionMatrix();
        window.V3D.camera.position.set(maxDim * 1.4, maxDim * 1.1, maxDim * 1.6);
        window.V3D.controls.target.set(0, 0, 0);
        window.V3D.controls.update();
    } else {
        window.V3D.camera.position.set(2.5, 2.0, 3.5);
        window.V3D.controls.target.set(0, 0, 0);
        window.V3D.controls.update();
    }
}

function toggle3dWireframe() {
    window.V3D.wireframeMode = !window.V3D.wireframeMode;
    const isW = window.V3D.wireframeMode;
    if (window.V3D.currentRoot) {
        window.V3D.currentRoot.traverse(child => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.wireframe = isW);
                } else {
                    child.material.wireframe = isW;
                }
            }
        });
    }
    const btn = document.getElementById('v3d-btn-wireframe');
    if (btn) {
        if (isW) {
            btn.classList.add('bg-brass', 'text-canvas');
            btn.classList.remove('bg-surface2', 'text-ink');
        } else {
            btn.classList.remove('bg-brass', 'text-canvas');
            btn.classList.add('bg-surface2', 'text-ink');
        }
    }
}

if (typeof window !== 'undefined') {
    window.init3dCore = init3dCore;
    window.resize3dViewport = resize3dViewport;
    window.reset3dCamera = reset3dCamera;
    window.toggle3dWireframe = toggle3dWireframe;
}
