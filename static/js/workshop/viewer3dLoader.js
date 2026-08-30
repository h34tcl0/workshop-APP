/**
 * 3D Model Loading and Demo Assembly Engine
 */

function setupModelInScene(object3d, filename) {
    if (!window.V3D.scene) {
        window.init3dCore();
    }
    if (!window.V3D.scene) return;

    // Remover modelo anterior si existe
    if (window.V3D.currentRoot) {
        window.V3D.scene.remove(window.V3D.currentRoot);
        window.V3D.currentRoot = null;
    }

    window.V3D.parts = [];

    // 1. Calcular Bounding Box original antes de transformaciones
    const originalBox = new THREE.Box3().setFromObject(object3d);
    const center = originalBox.getCenter(new THREE.Vector3());
    const size = originalBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1.0;

    // 2. Centrar geometría en el origen (0, 0, 0)
    object3d.position.x = -center.x;
    object3d.position.y = -center.y;
    object3d.position.z = -center.z;

    // Contenedor wrapper centrado
    const modelWrapper = new THREE.Group();
    modelWrapper.add(object3d);

    let meshCount = 0;
    modelWrapper.traverse(child => {
        if (child.isMesh) {
            meshCount++;
            child.castShadow = true;
            child.receiveShadow = true;

            // Garantizar material visible con textura e iluminación
            if (!child.material || child.material.type === 'MeshBasicMaterial') {
                child.material = new THREE.MeshStandardMaterial({
                    color: 0xd97706,
                    roughness: 0.5,
                    metalness: 0.1
                });
            } else if (child.material) {
                // Si el material importado tiene color muy oscuro o opacidad 0, asegurar visibilidad
                if (child.material.color && child.material.color.getHex() === 0x000000) {
                    child.material.color.setHex(0xd97706);
                }
                child.material.side = THREE.DoubleSide;
            }

            // Añadir bordes técnicos sutiles
            try {
                const edges = new THREE.EdgesGeometry(child.geometry, 30);
                const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x0f172a, linewidth: 1 }));
                child.add(line);
            } catch (_) {}

            // Guardar posición local original
            const worldPos = new THREE.Vector3();
            child.getWorldPosition(worldPos);

            // Vector de dispersión radial desde el centro (0, 0, 0)
            let explodeVec = worldPos.clone();
            if (explodeVec.lengthSq() < 0.0001) {
                explodeVec.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2 + 1, (Math.random() - 0.5) * 2);
            }
            explodeVec.normalize();

            window.V3D.parts.push({
                mesh: child,
                originalPosition: child.position.clone(),
                explodeVector: explodeVec
            });
        }
    });

    window.V3D.scene.add(modelWrapper);
    window.V3D.currentRoot = modelWrapper;

    // 3. Auto-encuadre y ajuste de cámara/controles según maxDim
    if (window.V3D.camera && window.V3D.controls) {
        window.V3D.camera.near = maxDim / 100;
        window.V3D.camera.far = maxDim * 100;
        window.V3D.camera.updateProjectionMatrix();

        window.V3D.camera.position.set(maxDim * 1.4, maxDim * 1.1, maxDim * 1.6);
        window.V3D.controls.target.set(0, 0, 0);
        window.V3D.controls.update();
    }

    // UI Updates
    const badge = document.getElementById('v3d-status-badge');
    const emptyPrompt = document.getElementById('v3d-empty-prompt');
    const toolbar = document.getElementById('v3d-floating-toolbar');
    const meshCountEl = document.getElementById('v3d-mesh-count');
    const slider = document.getElementById('v3d-slider-explode');
    const explodeVal = document.getElementById('v3d-explode-val');

    if (badge) {
        badge.innerText = filename || 'Modelo Cargado';
        badge.className = 'text-xs font-mono bg-moss/20 text-moss border border-moss/40 px-2.5 py-1 rounded-full font-bold';
    }
    if (emptyPrompt) emptyPrompt.classList.add('hidden');
    if (toolbar) toolbar.classList.remove('hidden');
    if (meshCountEl) meshCountEl.innerText = `${meshCount} pieza${meshCount !== 1 ? 's' : ''} detectada${meshCount !== 1 ? 's' : ''}`;
    if (slider) slider.value = 0;
    if (explodeVal) explodeVal.innerText = '0%';
}

function loadDemo3dModel(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (typeof THREE === 'undefined') return;

    window.init3dCore();

    const group = new THREE.Group();
    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5, metalness: 0.1 });
    const darkWoodMaterial = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.7, metalness: 0.05 });
    const topMaterial = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.1 });

    // Cubierta Superior (Top)
    const topGeo = new THREE.BoxGeometry(1.4, 0.08, 0.9);
    const topMesh = new THREE.Mesh(topGeo, topMaterial);
    topMesh.position.set(0, 1.04, 0);
    group.add(topMesh);

    // 4 Patas
    const legGeo = new THREE.BoxGeometry(0.08, 1.0, 0.08);
    const legPositions = [
        [-0.55, 0.5, -0.35],
        [0.55, 0.5, -0.35],
        [-0.55, 0.5, 0.35],
        [0.55, 0.5, 0.35]
    ];
    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(legGeo, woodMaterial);
        leg.position.set(pos[0], pos[1], pos[2]);
        group.add(leg);
    });

    // Faldones / Travesaños Largos
    const apronLongGeo = new THREE.BoxGeometry(1.02, 0.12, 0.04);
    const apronFront = new THREE.Mesh(apronLongGeo, darkWoodMaterial);
    apronFront.position.set(0, 0.94, 0.35);
    group.add(apronFront);

    const apronBack = new THREE.Mesh(apronLongGeo, darkWoodMaterial);
    apronBack.position.set(0, 0.94, -0.35);
    group.add(apronBack);

    // Faldones / Travesaños Cortos
    const apronShortGeo = new THREE.BoxGeometry(0.04, 0.12, 0.62);
    const apronLeft = new THREE.Mesh(apronShortGeo, darkWoodMaterial);
    apronLeft.position.set(-0.55, 0.94, 0);
    group.add(apronLeft);

    const apronRight = new THREE.Mesh(apronShortGeo, darkWoodMaterial);
    apronRight.position.set(0.55, 0.94, 0);
    group.add(apronRight);

    // Repisa Inferior
    const shelfGeo = new THREE.BoxGeometry(1.02, 0.04, 0.62);
    const shelf = new THREE.Mesh(shelfGeo, woodMaterial);
    shelf.position.set(0, 0.25, 0);
    group.add(shelf);

    setupModelInScene(group, 'Mesa Taller (Demo)');
}

if (typeof window !== 'undefined') {
    window.setupModelInScene = setupModelInScene;
    window.loadDemo3dModel = loadDemo3dModel;
}
