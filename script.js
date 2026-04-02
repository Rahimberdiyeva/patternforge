import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- Инициализация рендереров ---
const container2d = document.getElementById('canvas2d');
const container3d = document.getElementById('canvas3d');
const scene2d = new THREE.Scene(); scene2d.background = null;
const camera2d = new THREE.OrthographicCamera(-1,1,1,-1,0.1,10); camera2d.position.z = 1;
const renderer2d = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer2d.setClearColor(0x000000, 0);
const scene3d = new THREE.Scene(); scene3d.background = new THREE.Color(0xfffafc);
const camera3d = new THREE.PerspectiveCamera(45, 1, 0.1, 1000); camera3d.position.set(2.2, 1.6, 2.8);
const renderer3d = new THREE.WebGLRenderer({ antialias: true });
container2d.appendChild(renderer2d.domElement);
container3d.appendChild(renderer3d.domElement);

function updateSizes() {
    const rect2d = container2d.parentElement.getBoundingClientRect();
    let size2d = Math.min(rect2d.width, rect2d.height);
    if (size2d <= 0) size2d = 256;
    renderer2d.setSize(size2d, size2d);
    const w3 = container3d.clientWidth, h3 = container3d.clientHeight;
    if (w3 && h3) { renderer3d.setSize(w3, h3); camera3d.aspect = w3 / h3; camera3d.updateProjectionMatrix(); }
}
new ResizeObserver(() => updateSizes()).observe(container3d);
new ResizeObserver(() => updateSizes()).observe(container2d.parentElement);
window.addEventListener('resize', updateSizes);
updateSizes();

const controls3d = new OrbitControls(camera3d, renderer3d.domElement);
controls3d.enableDamping = true; controls3d.enableZoom = true; controls3d.target.set(0,0,0);

// ========== ИСПРАВЛЕННОЕ ОСВЕЩЕНИЕ ==========
scene3d.add(new THREE.AmbientLight(0xffeef2, 0.65));
const dirLight = new THREE.DirectionalLight(0xfff0f3, 1.3);
dirLight.position.set(1, 2, 1);
scene3d.add(dirLight);

const pointLight1 = new THREE.PointLight(0xffd9e2, 0.7);
pointLight1.position.set(-1, 1, -1.2);
scene3d.add(pointLight1);

const pointLight2 = new THREE.PointLight(0xffe4ea, 0.6);
pointLight2.position.set(1, 1, 1.5);
scene3d.add(pointLight2);

let currentMesh3d = null, currentGeometryType = 'cube', customModel = null, overlayTexture = null;
let backgroundImageFile = null;
let patternImageFiles = [];
let currentZoom2d = 1;
const canvas2dElem = renderer2d.domElement;

let activeColors = [
    new THREE.Color('#FF6B8B'),
    new THREE.Color('#4CC9F0'),
    new THREE.Color('#F9C74F'),
    new THREE.Color('#9B5DE5')
];

const uniforms = {
    uScale: { value: 2.5 }, uIntensity: { value: 1.0 }, uPatternType: { value: 0 },
    uColors: { value: activeColors.map(c => [c.r, c.g, c.b]).flat() },
    uColorsCount: { value: activeColors.length },
    uSaturation: { value: 1.5 }, uBlendMode: { value: 0 },
    uRotation: { value: 0 }, uOffset: { value: new THREE.Vector2(0,0) },
    uMirror: { value: 0 }, uOctaves: { value: 3 }, uPersistence: { value: 0.5 },
    uLacunarity: { value: 2.0 }, uTileEnabled: { value: 1 },
    uOverlayTexture: { value: null }, uUseOverlay: { value: 1 }, uOverlayOpacity: { value: 0.7 }
};

const vertexShader = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fragmentShader = `
    uniform float uScale; uniform float uIntensity; uniform int uPatternType;
    uniform float uColors[24]; uniform int uColorsCount;
    uniform float uSaturation; uniform int uBlendMode;
    uniform float uRotation; uniform vec2 uOffset; uniform int uMirror;
    uniform int uOctaves; uniform float uPersistence; uniform float uLacunarity; uniform int uTileEnabled;
    uniform sampler2D uOverlayTexture; uniform int uUseOverlay; uniform float uOverlayOpacity;
    varying vec2 vUv;
    
    float random (vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
    vec2 hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(vec2(p.x * p.y, p.y * p.x)) * 2.0 - 1.0; }
    float perlinNoise(vec2 st) {
        vec2 i = floor(st); vec2 f = fract(st); vec2 u = f * f * (3.0 - 2.0 * f);
        vec2 grad00 = hash(i); vec2 grad10 = hash(i + vec2(1.0, 0.0));
        vec2 grad01 = hash(i + vec2(0.0, 1.0)); vec2 grad11 = hash(i + vec2(1.0, 1.0));
        float dot00 = dot(grad00, f); float dot10 = dot(grad10, f - vec2(1.0, 0.0));
        float dot01 = dot(grad01, f - vec2(0.0, 1.0)); float dot11 = dot(grad11, f - vec2(1.0, 1.0));
        return mix(mix(dot00, dot10, u.x), mix(dot01, dot11, u.x), u.y) * 0.5 + 0.5;
    }
    float fbmPerlin(vec2 st, int oct, float pers, float lac) {
        float val = 0.0, amp = 0.5, freq = 2.0;
        for(int i=0; i<6; i++) { if(i>=oct) break; val += amp * (perlinNoise(st * freq)*2.0-1.0); amp *= pers; freq *= lac; }
        return val * 0.5 + 0.5;
    }
    float voronoi(vec2 uv) {
        vec2 p = floor(uv); vec2 f = fract(uv); float res = 1.0;
        for(int j=-1; j<=1; j++) for(int i=-1; i<=1; i++) {
            vec2 b = vec2(float(i), float(j)); vec2 r = b - f + random(p + b);
            res = min(res, dot(r,r));
        } return sqrt(res);
    }
    float truchetPattern(vec2 uv, float t) { uv = fract(uv * 3.0) - 0.5; float angle = sin(t + uv.x*10.) * cos(t + uv.y*10.); return step(length(uv), 0.4+0.2*sin(angle*20.+t)); }
    
    vec3 getColor(float t) {
        if (uColorsCount <= 1) return vec3(uColors[0], uColors[1], uColors[2]);
        float seg = 1.0 / float(uColorsCount - 1);
        int idx = int(floor(t / seg));
        idx = clamp(idx, 0, uColorsCount-2);
        float localT = (t - float(idx) * seg) / seg;
        vec3 c1 = vec3(uColors[idx*3], uColors[idx*3+1], uColors[idx*3+2]);
        vec3 c2 = vec3(uColors[(idx+1)*3], uColors[(idx+1)*3+1], uColors[(idx+1)*3+2]);
        return mix(c1, c2, localT);
    }
    
    void main() {
        vec2 uv = vUv;
        float angle = uRotation * 3.14159 / 180.0;
        vec2 centered = uv - 0.5;
        vec2 rotated = vec2(centered.x*cos(angle)-centered.y*sin(angle), centered.x*sin(angle)+centered.y*cos(angle));
        uv = rotated + 0.5 + uOffset;
        if(uMirror == 1) uv.x = 1.0 - uv.x; else if(uMirror == 2) uv.y = 1.0 - uv.y; else if(uMirror == 3) { uv.x = 1.0 - uv.x; uv.y = 1.0 - uv.y; }
        if(uTileEnabled == 1) uv = fract(uv);
        vec2 st = uv * uScale;
        float patternValue;
        if(uPatternType == 0) { float w1 = sin(st.x*8.0)*cos(st.y*8.0); float w2 = sin(st.y*12.0+st.x*5.0); patternValue = (w1 + w2)*0.6+0.5; }
        else if(uPatternType == 1) { patternValue = voronoi(st*3.5); patternValue = pow(patternValue*1.2, 0.8); }
        else if(uPatternType == 2) { patternValue = fbmPerlin(st, uOctaves, uPersistence, uLacunarity); }
        else if(uPatternType == 3) { patternValue = truchetPattern(st*3.0, 0.0); patternValue = patternValue*0.8+0.2; }
        else { patternValue = random(st); }
        patternValue = clamp(patternValue * uIntensity, 0.0, 1.0);
        vec3 color = getColor(patternValue);
        float gray = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(vec3(gray), color, uSaturation);
        if(uBlendMode == 1) color = color * patternValue;
        
        if(uUseOverlay == 1) {
            vec4 overlayRGBA = texture2D(uOverlayTexture, uv);
            float overlayAlpha = overlayRGBA.a;
            if (overlayAlpha > 0.01) {
                color = mix(color, overlayRGBA.rgb, overlayAlpha * uOverlayOpacity);
            }
        }
        gl_FragColor = vec4(color, 1.0);
    }
`;

function createMaterial() { return new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide }); }

let plane2d = new THREE.Mesh(new THREE.PlaneGeometry(2,2), createMaterial());
scene2d.add(plane2d);

function updateColorsUniform() {
    const flat = [];
    for (let c of activeColors) flat.push(c.r, c.g, c.b);
    uniforms.uColors.value = flat;
    uniforms.uColorsCount.value = activeColors.length;
}

// --- UI цветов (исправлен цветовой пикер) ---
const colorContainer = document.getElementById('colorListContainer');
const addColorBtn = document.getElementById('addColorBtn');

function rebuildColorUI() {
    colorContainer.innerHTML = '';

    activeColors.forEach((col, idx) => {
        const div = document.createElement('div');
        div.className = 'color-item';

        const labelSpan = document.createElement('label');
        labelSpan.textContent = `${idx + 1}`;

        const circleDiv = document.createElement('div');
        circleDiv.className = 'custom-color-circle';
        circleDiv.style.backgroundColor = col.getStyle();

        circleDiv.addEventListener('click', (e) => {
            e.stopPropagation();

            document.querySelectorAll('.color-picker-popup').forEach(el => el.remove());

            const picker = document.createElement('div');
            picker.className = 'color-picker-popup';

            const input = document.createElement('input');
            input.type = 'color';
            // ИСПРАВЛЕНО: используем HEX вместо RGB
            input.value = '#' + col.getHexString();

            input.addEventListener('input', (ev) => {
                const newHex = ev.target.value;
                activeColors[idx] = new THREE.Color(newHex);
                circleDiv.style.backgroundColor = newHex;
                updateColorsUniform();
            });

            picker.appendChild(input);
            document.body.appendChild(picker);

            const rect = circleDiv.getBoundingClientRect();
            picker.style.left = (rect.right + 8) + 'px';
            picker.style.top = rect.top + 'px';

            const close = (event) => {
                if (!picker.contains(event.target)) {
                    picker.remove();
                    document.removeEventListener('click', close);
                }
            };
            setTimeout(() => document.addEventListener('click', close), 0);
        });

        div.appendChild(labelSpan);
        div.appendChild(circleDiv);

        if (activeColors.length > 2) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-color-btn';
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activeColors.length > 2) {
                    activeColors.splice(idx, 1);
                    rebuildColorUI();
                    updateColorsUniform();
                }
            });
            div.appendChild(removeBtn);
        }
        colorContainer.appendChild(div);
    });
}

addColorBtn.addEventListener('click', () => {
    if (activeColors.length < 8) {
        activeColors.push(new THREE.Color('#FFB347'));
        rebuildColorUI();
        updateColorsUniform();
    }
});
rebuildColorUI();

// --- Параметры из UI ---
function updateUniformsFromUI() {
    uniforms.uScale.value = parseFloat(document.getElementById('scale').value);
    uniforms.uIntensity.value = parseFloat(document.getElementById('octaves').value) / 3.0;
    uniforms.uOctaves.value = parseInt(document.getElementById('octaves').value);
    uniforms.uPersistence.value = parseFloat(document.getElementById('persistence').value);
    uniforms.uLacunarity.value = parseFloat(document.getElementById('lacunarity').value);
    uniforms.uSaturation.value = parseFloat(document.getElementById('saturation').value);
    uniforms.uBlendMode.value = parseInt(document.getElementById('blendMode').value);
    uniforms.uRotation.value = parseFloat(document.getElementById('rotate').value);
    uniforms.uOffset.value.set(parseFloat(document.getElementById('offsetX').value), parseFloat(document.getElementById('offsetY').value));
    uniforms.uMirror.value = parseInt(document.getElementById('mirror').value);
    uniforms.uTileEnabled.value = parseInt(document.getElementById('tileToggle').value);
    
    document.getElementById('scaleVal').innerText = parseFloat(document.getElementById('scale').value).toFixed(2);
    document.getElementById('octavesVal').innerText = document.getElementById('octaves').value;
    document.getElementById('persistenceVal').innerText = parseFloat(document.getElementById('persistence').value).toFixed(2);
    document.getElementById('lacunarityVal').innerText = parseFloat(document.getElementById('lacunarity').value).toFixed(2);
    document.getElementById('saturationVal').innerText = parseFloat(document.getElementById('saturation').value).toFixed(2);
    document.getElementById('rotateVal').innerText = document.getElementById('rotate').value + '°';
    document.getElementById('offsetXVal').innerText = parseFloat(document.getElementById('offsetX').value).toFixed(2);
    document.getElementById('offsetYVal').innerText = parseFloat(document.getElementById('offsetY').value).toFixed(2);
}

const uiElements = ['scale', 'octaves', 'persistence', 'lacunarity', 'saturation', 'blendMode', 'rotate', 'offsetX', 'offsetY', 'mirror', 'tileToggle'];
uiElements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateUniformsFromUI);
});
updateUniformsFromUI();

// --- Паттерны ---
const patterns = [{name:'Волны',v:0},{name:'Вороного',v:1},{name:'Перлин',v:2},{name:'Truchet',v:3},{name:'Симплекс',v:4}];
const patternDiv = document.getElementById('patternBarButtons');
const patternSelect = document.getElementById('patternSelectMobile');
patterns.forEach(p => {
    const btn = document.createElement('button'); btn.className = 'pattern-btn'; btn.textContent = p.name; btn.dataset.pattern = p.v;
    btn.onclick = () => { uniforms.uPatternType.value = p.v; document.querySelectorAll('.pattern-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); patternSelect.value = p.v; };
    patternDiv.appendChild(btn);
    if(p.v===0) btn.classList.add('active');
    const opt = document.createElement('option'); opt.value = p.v; opt.textContent = p.name; patternSelect.appendChild(opt);
});
patternSelect.addEventListener('change', (e) => { uniforms.uPatternType.value = parseInt(e.target.value); });

// --- 3D модель ---
function createGeometry(type) {
    if(type === 'cube') return new THREE.BoxGeometry(1.2,1.2,1.2);
    if(type === 'torus') return new THREE.TorusKnotGeometry(0.85,0.22,200,32,3,4);
    if(type === 'sphere') return new THREE.SphereGeometry(0.9,128,128);
    return new THREE.CylinderGeometry(0.8,0.8,1.2,64);
}
function update3dModel() {
    if (currentMesh3d) scene3d.remove(currentMesh3d);
    if (customModel) {
        customModel.traverse(child => { if(child.isMesh) child.material = createMaterial(); });
        scene3d.add(customModel);
        currentMesh3d = customModel;
    } else {
        const mesh = new THREE.Mesh(createGeometry(currentGeometryType), createMaterial());
        scene3d.add(mesh);
        currentMesh3d = mesh;
    }
    const box = new THREE.Box3().setFromObject(currentMesh3d);
    controls3d.target.copy(box.getCenter(new THREE.Vector3()));
    controls3d.update();
    updateSizes();
}
document.getElementById('geometrySelect').addEventListener('change', (e) => { customModel = null; currentGeometryType = e.target.value; update3dModel(); });
const modelInput = document.getElementById('modelFileInput'), modelStatus = document.getElementById('modelStatus'), loader = new GLTFLoader();
modelInput.addEventListener('change', e => {
    if(!e.target.files[0]) return;
    const url = URL.createObjectURL(e.target.files[0]);
    loader.load(url, gltf => {
        if(currentMesh3d) scene3d.remove(currentMesh3d);
        customModel = gltf.scene;
        const box = new THREE.Box3().setFromObject(customModel);
        const size = box.getSize(new THREE.Vector3()).length();
        const scl = 1.2 / size;
        customModel.scale.set(scl,scl,scl);
        customModel.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(scl));
        update3dModel();
        URL.revokeObjectURL(url);
        modelStatus.textContent = 'Модель загружена';
        setTimeout(() => modelStatus.textContent = '', 2000);
    }, undefined, () => { modelStatus.textContent = 'Ошибка загрузки'; });
});

// --- Наложения ---
const multiInput = document.getElementById('multiTextureInput');
const addOverlayBtn = document.getElementById('addOverlayBtn');
const clearOverlayBtn = document.getElementById('clearOverlayBtn');
const overlayImagesDiv = document.getElementById('overlayImagesList');

function updateImageBadges() {
    overlayImagesDiv.innerHTML = '';
    if (patternImageFiles.length === 0) overlayImagesDiv.innerHTML = '<div class="status-msg">Нет загруженных изображений</div>';
    else patternImageFiles.forEach((file, idx) => {
        const badge = document.createElement('div'); badge.className = 'image-badge';
        badge.innerHTML = `<span>${file.name.length > 20 ? file.name.slice(0,17)+'...' : file.name}</span><span class="remove-img" data-idx="${idx}">✕</span>`;
        overlayImagesDiv.appendChild(badge);
    });
    document.querySelectorAll('.remove-img').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(btn.dataset.idx);
            patternImageFiles.splice(idx, 1);
            updateImageBadges();
            generateOverlayTexture();
        });
    });
    generateOverlayTexture();
}
addOverlayBtn.addEventListener('click', () => multiInput.click());
clearOverlayBtn.addEventListener('click', () => { patternImageFiles = []; updateImageBadges(); generateOverlayTexture(); });
multiInput.addEventListener('change', (e) => { const newFiles = Array.from(e.target.files); if (newFiles.length) { patternImageFiles.push(...newFiles); updateImageBadges(); } multiInput.value = ''; });

// --- Генерация оверлейной текстуры (без швов) ---
async function generateOverlayTexture() {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    
    if (backgroundImageFile) {
        const bgImg = await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = URL.createObjectURL(backgroundImageFile);
        });
        ctx.globalAlpha = parseFloat(document.getElementById('bgOpacity').value);
        ctx.drawImage(bgImg, 0, 0, size, size);
        ctx.globalAlpha = 1.0;
        URL.revokeObjectURL(bgImg.src);
    }
    
    if (patternImageFiles.length > 0) {
        const density = parseFloat(document.getElementById('patternElemScale').value);
        const overlayAlpha = parseFloat(document.getElementById('overlayOpacity').value);
        
        const loaded = [];
        for (let file of patternImageFiles) {
            const img = await new Promise(r => {
                const i = new Image();
                i.onload = () => r(i);
                i.src = URL.createObjectURL(file);
            });
            loaded.push(img);
            URL.revokeObjectURL(img.src);
        }
        
        if (loaded.length) {
            let cellsPerSide = Math.max(2, Math.floor(6 * density));
            cellsPerSide = Math.min(cellsPerSide, 20);
            
            const cellW = Math.floor(size / cellsPerSide);
            const cellH = Math.floor(size / cellsPerSide);
            const remainderW = size - cellW * cellsPerSide;
            const remainderH = size - cellH * cellsPerSide;
            
            ctx.imageSmoothingEnabled = false;
            
            let y = 0;
            for (let row = 0; row < cellsPerSide; row++) {
                let h = cellH + (row < remainderH ? 1 : 0);
                let x = 0;
                for (let col = 0; col < cellsPerSide; col++) {
                    let w = cellW + (col < remainderW ? 1 : 0);
                    const idx = (row * cellsPerSide + col) % loaded.length;
                    const img = loaded[idx];
                    ctx.save();
                    ctx.globalAlpha = overlayAlpha;
                    ctx.drawImage(img, x, y, w, h);
                    ctx.restore();
                    x += w;
                }
                y += h;
            }
        }
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    if (overlayTexture) overlayTexture.dispose?.();
    overlayTexture = texture;
    uniforms.uOverlayTexture.value = overlayTexture;
    uniforms.uUseOverlay.value = document.getElementById('enableOverlay').checked ? 1 : 0;
    
    const cellsPerSide = Math.min(20, Math.max(2, Math.floor(6 * parseFloat(document.getElementById('patternElemScale').value))));
    document.getElementById('overlayStatus').textContent = `Наложение: ${patternImageFiles.length} изображений, сетка ${cellsPerSide}x${cellsPerSide}`;
}

document.getElementById('bgImageInput').addEventListener('change', (e) => { backgroundImageFile = e.target.files[0] || null; generateOverlayTexture(); });
document.getElementById('bgOpacity').addEventListener('input', () => generateOverlayTexture());
document.getElementById('patternElemScale').addEventListener('input', () => generateOverlayTexture());
document.getElementById('overlayOpacity').addEventListener('input', (e) => { uniforms.uOverlayOpacity.value = parseFloat(e.target.value); generateOverlayTexture(); });
document.getElementById('enableOverlay').addEventListener('change', (e) => { uniforms.uUseOverlay.value = e.target.checked ? 1 : 0; generateOverlayTexture(); });

// --- Зум ---
document.getElementById('canvas2d').addEventListener('wheel', (e) => {
    e.preventDefault();
    currentZoom2d = Math.min(Math.max(currentZoom2d + (e.deltaY > 0 ? -0.1 : 0.1), 0.5), 3);
    canvas2dElem.style.transform = `scale(${currentZoom2d})`;
    canvas2dElem.style.transformOrigin = 'center center';
});

// --- ЭКСПОРТ (исправлен: использует текущие настройки без принудительного тайлинга) ---
async function renderTextureAtSize(size) {
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1,1,1,-1,0.1,10);
    cam.position.z = 1;
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat);
    scene.add(mesh);
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, alpha: false });
    renderer.setSize(size, size);
    renderer.render(scene, cam);
    const canvas = renderer.domElement;
    let blob = null;
    const format = document.getElementById('exportFormat').value;
    if (format === 'svg') {
        const imgData = canvas.toDataURL('image/png');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><image width="${size}" height="${size}" href="${imgData}"/></svg>`;
        blob = new Blob([svg], {type: 'image/svg+xml'});
    } else {
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        blob = await new Promise(resolve => canvas.toBlob(resolve, mime));
    }
    renderer.dispose();
    mat.dispose();
    return { blob, canvas };
}

async function generateRoughnessFromBasecolor(basecolorCanvas, resolution) {
    const canvas = document.createElement('canvas'); canvas.width = resolution; canvas.height = resolution;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(basecolorCanvas, 0, 0, resolution, resolution);
    const imgData = ctx.getImageData(0, 0, resolution, resolution);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i+1] + data[i+2]) / 3 / 255;
        let rough = 1.0 - brightness;
        rough = Math.min(0.95, Math.max(0.1, rough + (Math.random() - 0.5) * 0.1));
        const val = Math.floor(rough * 255);
        data[i] = val; data[i+1] = val; data[i+2] = val;
    }
    ctx.putImageData(imgData, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function generateNormalFromBasecolor(basecolorCanvas, resolution) {
    const canvas = document.createElement('canvas'); canvas.width = resolution; canvas.height = resolution;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(basecolorCanvas, 0, 0, resolution, resolution);
    const imgData = ctx.getImageData(0, 0, resolution, resolution);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        const offset = ((data[i] + data[i+1]) / 512) - 0.5;
        const nr = 128 + Math.floor(offset * 40);
        const ng = 128 + Math.floor(offset * 30);
        data[i] = nr; data[i+1] = ng; data[i+2] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

document.getElementById('exportTextureBtn').onclick = async () => {
    try {
        const resolution = parseInt(document.getElementById('exportResolution').value);
        const format = document.getElementById('exportFormat').value;
        if (format === 'pbr') {
            const { blob: colorBlob, canvas: colorCanvas } = await renderTextureAtSize(resolution);
            if (!colorBlob) throw new Error();
            const roughnessBlob = await generateRoughnessFromBasecolor(colorCanvas, resolution);
            const normalBlob = await generateNormalFromBasecolor(colorCanvas, resolution);
            const zip = new JSZip();
            zip.file("basecolor.png", colorBlob);
            zip.file("roughness.png", roughnessBlob);
            zip.file("normal.png", normalBlob);
            const content = await zip.generateAsync({type:"blob"});
            const url = URL.createObjectURL(content);
            const a = document.createElement('a'); a.href = url; a.download = "pbr_maps.zip"; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 100);
            const warningDiv = document.createElement('div'); warningDiv.className = 'warning-box';
            warningDiv.innerHTML = 'Если Windows заблокировал файл, нажмите "Всё равно сохранить" или временно отключите SmartScreen. Файл полностью безопасен.';
            const container = document.querySelector('.global-footer');
            const existing = document.querySelector('.warning-box');
            if (existing) existing.remove();
            container.parentNode.insertBefore(warningDiv, container.nextSibling);
            setTimeout(() => warningDiv.remove(), 8000);
        } else {
            const { blob } = await renderTextureAtSize(resolution);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `texture_${resolution}.${format === 'svg' ? 'svg' : format}`; a.click();
            URL.revokeObjectURL(url);
        }
    } catch(e) { console.error(e); alert("Ошибка экспорта: " + e.message); }
};

// --- Анимация ---
function animate() {
    requestAnimationFrame(animate);
    if (plane2d.material) plane2d.material.uniforms = uniforms;
    if (currentMesh3d) {
        if (currentMesh3d.isGroup || currentMesh3d.isScene) currentMesh3d.traverse(c => { if(c.isMesh && c.material) c.material.uniforms = uniforms; });
        else if (currentMesh3d.material) currentMesh3d.material.uniforms = uniforms;
    }
    renderer2d.render(scene2d, camera2d);
    controls3d.update();
    renderer3d.render(scene3d, camera3d);
}
animate();
update3dModel();
generateOverlayTexture();
