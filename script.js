import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

// --- Инициализация рендереров ---
const container2d = document.getElementById('canvas2d');
const container3d = document.getElementById('canvas3d');
const scene2d = new THREE.Scene(); scene2d.background = null;
const camera2d = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera2d.position.z = 1;
const renderer2d = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer2d.setClearColor(0x000000, 0);
const scene3d = new THREE.Scene();
scene3d.background = new THREE.Color(0xfffafc);
const camera3d = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera3d.position.set(2.2, 1.6, 2.8);
const renderer3d = new THREE.WebGLRenderer({ antialias: true });
container2d.appendChild(renderer2d.domElement);
container3d.appendChild(renderer3d.domElement);

function updateSizes() {
    const rect2d = container2d.parentElement.getBoundingClientRect();
    let size2d = Math.min(rect2d.width, rect2d.height);
    if (size2d <= 0) size2d = 256;
    renderer2d.setSize(size2d, size2d);
    const w3 = container3d.clientWidth, h3 = container3d.clientHeight;
    if (w3 && h3) {
        renderer3d.setSize(w3, h3);
        camera3d.aspect = w3 / h3;
        camera3d.updateProjectionMatrix();
    }
}
new ResizeObserver(() => updateSizes()).observe(container3d);
new ResizeObserver(() => updateSizes()).observe(container2d.parentElement);
window.addEventListener('resize', updateSizes);
updateSizes();

const controls3d = new OrbitControls(camera3d, renderer3d.domElement);
controls3d.enableDamping = true;
controls3d.enableZoom = true;
controls3d.target.set(0, 0, 0);

// --- Освещение ---
scene3d.add(new THREE.AmbientLight(0xffeef2, 0.65));
const dirLight = new THREE.DirectionalLight(0xfff0f3, 1.3);
dirLight.position.set(1, 2, 1);
scene3d.add(dirLight);
scene3d.add(new THREE.PointLight(0xffd9e2, 0.7, 100, -1, 1, -1.2));
scene3d.add(new THREE.PointLight(0xffe4ea, 0.6, 100, 1, 1, 1.5));

let currentMesh3d = null,
    currentGeometryType = 'cube',
    customModel = null,
    overlayTexture = null;
let backgroundImageFile = null;
let patternImageFiles = []; // каждый элемент: { file, rotation, offsetX, offsetY, mirror, opacity, scale }
let syncOverlay = false;
let globalShiftX = 0,
    globalShiftY = 0;

let activeColors = [
    new THREE.Color('#FF6B8B'),
    new THREE.Color('#4CC9F0'),
    new THREE.Color('#F9C74F'),
    new THREE.Color('#9B5DE5')
];

// --- Uniforms шейдера (добавлены metallic, roughness) ---
const uniforms = {
    uScale: { value: 0.8 },
    uIntensity: { value: 1.0 },
    uPatternType: { value: 0 },
    uColor0: { value: new THREE.Vector3() },
    uColor1: { value: new THREE.Vector3() },
    uColor2: { value: new THREE.Vector3() },
    uColor3: { value: new THREE.Vector3() },
    uColor4: { value: new THREE.Vector3() },
    uColor5: { value: new THREE.Vector3() },
    uColor6: { value: new THREE.Vector3() },
    uColor7: { value: new THREE.Vector3() },
    uColorsCount: { value: 4 },
    uSaturation: { value: 1.5 },
    uBlendMode: { value: 0 },
    uRotation: { value: 0 },
    uOffset: { value: new THREE.Vector2(0, 0) },
    uMirror: { value: 0 },
    uOctaves: { value: 3 },
    uPersistence: { value: 0.5 },
    uLacunarity: { value: 2.0 },
    uTileEnabled: { value: 0 },
    uOverlayTexture: { value: null },
    uUseOverlay: { value: 1 },
    uWarpEnable: { value: 0 },
    uWarpStrength: { value: 0.3 },
    uWarpOctaves: { value: 2 },
    uShowRelief: { value: 0 },
    uReliefStrength: { value: 1.0 },
    uTile3DScale: { value: 1.0 },
    uTime: { value: 0 },
    uMetallic: { value: 0.5 },
    uRoughness: { value: 0.4 }
};

function updateColorUniforms() {
    const lastColor = activeColors.length ? activeColors[activeColors.length - 1] : new THREE.Color(1, 1, 1);
    for (let i = 0; i < 8; i++) {
        const c = i < activeColors.length ? activeColors[i] : lastColor;
        uniforms[`uColor${i}`].value.set(c.r, c.g, c.b);
    }
    uniforms.uColorsCount.value = activeColors.length;
}
updateColorUniforms();

// ========== ШЕЙДЕРЫ С ИСПРАВЛЕННЫМИ ОКТАВАМИ/ПЕРСИСТЕНСОМ/ЛАКУНАРНОСТЬЮ ==========
const vertexShader = `
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying vec3 vNormalW;
    uniform float uTile3DScale;
    void main() {
        vUv = uv * uTile3DScale;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

const fragmentShader = `
    precision highp float;
    uniform float uScale; uniform float uIntensity; uniform int uPatternType;
    uniform vec3 uColor0; uniform vec3 uColor1; uniform vec3 uColor2; uniform vec3 uColor3;
    uniform vec3 uColor4; uniform vec3 uColor5; uniform vec3 uColor6; uniform vec3 uColor7;
    uniform int uColorsCount;
    uniform float uSaturation; uniform int uBlendMode;
    uniform float uRotation; uniform vec2 uOffset; uniform int uMirror;
    uniform int uOctaves; uniform float uPersistence; uniform float uLacunarity; uniform int uTileEnabled;
    uniform sampler2D uOverlayTexture; uniform int uUseOverlay;
    uniform int uWarpEnable; uniform float uWarpStrength; uniform int uWarpOctaves;
    uniform int uShowRelief; uniform float uReliefStrength;
    uniform float uTime;
    uniform float uMetallic;
    uniform float uRoughness;
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying vec3 vNormalW;
    
    // ---------- БАЗОВЫЕ ФУНКЦИИ ----------
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
    float worley(vec2 uv) {
        vec2 p = floor(uv); vec2 f = fract(uv); float res = 1.0;
        for(int j=-1; j<=1; j++) for(int i=-1; i<=1; i++) {
            vec2 b = vec2(float(i), float(j)); vec2 r = b - f + random(p + b);
            res = min(res, dot(r,r));
        } return sqrt(res);
    }
    // Фрактальный Worley с октавами
    float fbmWorley(vec2 st, int oct, float pers, float lac) {
        float val = 0.0, amp = 0.5, freq = 1.0;
        for(int i=0; i<oct; i++) {
            val += amp * worley(st * freq);
            amp *= pers;
            freq *= lac;
        }
        return clamp(val, 0.0, 1.0);
    }
    
    float truchetPattern(vec2 uv, float t) { uv = fract(uv * 3.0) - 0.5; float angle = sin(t + uv.x*10.) * cos(t + uv.y*10.); return step(length(uv), 0.4+0.2*sin(angle*20.+t)); }
    vec2 domainWarp(vec2 uv, float strength, int octaves) {
        vec2 warped = uv;
        for(int i=0; i<5; i++) { if(i>=octaves) break;
            warped += strength * vec2(sin(warped.y * 3.14159 * 2.0 * float(i+1) + uTime), cos(warped.x * 3.14159 * 2.0 * float(i+1) + uTime));
        }
        return warped;
    }
    float reactionDiffusion(vec2 uv) { vec2 p = uv * 4.0; float a = sin(p.x * 3.0) * cos(p.y * 3.0); float b = cos(p.x * 4.2) * sin(p.y * 4.2); return clamp(a * 0.5 + b * 0.5 + 0.5, 0.0, 1.0); }
    float flowField(vec2 uv) { vec2 q = uv * 3.0; float angle = sin(q.y * 0.7) * cos(q.x * 0.5); vec2 gradient = vec2(cos(angle), sin(angle)); uv += gradient * 0.1; float field = sin(uv.x * 10.0) * cos(uv.y * 10.0); return smoothstep(-0.3, 0.7, field); }
    float wfcPattern(vec2 uv) { vec2 tile = floor(uv * 8.0); float hashVal = random(tile); int rule = int(floor(hashVal * 6.0)); float pattern = 0.0; vec2 sub = fract(uv * 8.0); if(rule == 0) pattern = step(0.5, sub.x) * step(0.5, sub.y); else if(rule == 1) pattern = step(0.5, sub.x + sub.y); else if(rule == 2) pattern = step(0.5, sub.x - sub.y + 0.5); else if(rule == 3) pattern = sin(sub.x * 3.14159 * 4.0) * 0.5 + 0.5; else if(rule == 4) pattern = (sub.x > 0.25 && sub.x < 0.75 && sub.y > 0.25 && sub.y < 0.75) ? 1.0 : 0.0; else pattern = fract(sub.x * 3.0 + sub.y * 2.0); return pattern; }
    float ridgedMF(vec2 uv, int oct, float pers, float lac) { 
        float val = 0.0, amp = 0.5, freq = 2.0;
        for(int i=0; i<6; i++) { if(i>=oct) break;
            float n = perlinNoise(uv * freq) * 2.0 - 1.0;
            n = 1.0 - abs(n);
            val += amp * n;
            amp *= pers;
            freq *= lac;
        }
        return clamp(val, 0.0, 1.0);
    }
    float checker(vec2 uv, float freq) { vec2 p = floor(uv * freq); return mod(p.x + p.y, 2.0); }
    float stripes(vec2 uv, float freq) { return step(0.5, fract(uv.x * freq)); }
    float circles(vec2 uv, float freq) { vec2 center = vec2(0.5, 0.5); float radius = length(uv - center) * freq; return fract(radius * 2.0); }
    float grid(vec2 uv, float freq) { vec2 g = fract(uv * freq); return max(step(0.92, g.x), step(0.92, g.y)); }
    float tiles(vec2 uv, float freq) { vec2 f = fract(uv * freq); float line = step(0.75, f.x) + step(0.75, f.y); return clamp(1.0 - line, 0.0, 1.0); }
    float wood(vec2 uv, float freq) { vec2 center = vec2(0.5, 0.5); float dist = length(uv - center) * 2.0; float rings = sin(dist * freq * 12.0 + sin(uv.x * 8.0) * 1.5); return clamp(rings * 0.5 + 0.5, 0.0, 1.0); }
    float marble(vec2 uv, float freq) { float noise = fbmPerlin(uv * freq * 3.0, 4, 0.6, 2.0); float veins = sin((uv.x * freq * 5.0 + noise * 3.0) * 3.14159); return clamp(veins * 0.6 + 0.5, 0.0, 1.0); }
    float linearGradient(vec2 uv) { return uv.x; }
    float radialGradient(vec2 uv) { return length(uv - 0.5) * 1.414; }
    float angularGradient(vec2 uv) { return atan(uv.y - 0.5, uv.x - 0.5) / (2.0 * 3.14159) + 0.5; }
    
    // Единая функция вычисления паттерна с учётом октав/персистенса/лакунарности для всех шумовых типов
    float computePattern(vec2 uv) {
        float angle = uRotation * 3.14159 / 180.0;
        vec2 centered = uv - 0.5;
        vec2 rotated = vec2(centered.x*cos(angle)-centered.y*sin(angle), centered.x*sin(angle)+centered.y*cos(angle));
        uv = rotated + 0.5 + uOffset;
        if(uMirror == 1) uv.x = 1.0 - uv.x; else if(uMirror == 2) uv.y = 1.0 - uv.y; else if(uMirror == 3) { uv.x = 1.0 - uv.x; uv.y = 1.0 - uv.y; }
        if(uTileEnabled == 1) uv = fract(uv);
        vec2 st = uv * uScale;
        if(uWarpEnable == 1) st = domainWarp(st, uWarpStrength, uWarpOctaves);
        
        // Геометрические и градиентные паттерны (без октав)
        if(uPatternType >= 17 && uPatternType <= 19) {
            if(uPatternType == 17) return linearGradient(st);
            if(uPatternType == 18) return radialGradient(st);
            if(uPatternType == 19) return angularGradient(st);
        }
        if(uPatternType == 8) return checker(st, 4.0);
        if(uPatternType == 9) return stripes(st, 6.0);
        if(uPatternType == 10) return circles(st, 3.0);
        if(uPatternType == 11) return grid(st, 6.0);
        if(uPatternType == 14) return wood(st, 0.8);
        if(uPatternType == 15) return marble(st, 1.2);
        if(uPatternType == 16) return tiles(st, 5.0);
        if(uPatternType == 3) return truchetPattern(st*3.0, uTime);
        
        // Все шумовые и фрактальные паттерны теперь используют октавы, персистенс, лакунарность
        int oct = uOctaves;
        float pers = uPersistence;
        float lac = uLacunarity;
        
        if(uPatternType == 0) { // Волны (синусоидальные) – делаем фрактальным
            float val = 0.0, amp = 0.5, freq = 1.0;
            for(int i=0; i<oct; i++) {
                float w1 = sin(st.x * 8.0 * freq) * cos(st.y * 8.0 * freq);
                float w2 = sin(st.y * 12.0 * freq + st.x * 5.0 * freq);
                val += amp * ((w1 + w2) * 0.6 + 0.5);
                amp *= pers;
                freq *= lac;
            }
            return clamp(val, 0.0, 1.0);
        }
        else if(uPatternType == 1) { // Worley с октавами
            return fbmWorley(st * 3.5, oct, pers, lac);
        }
        else if(uPatternType == 2) { // Перлин
            return fbmPerlin(st, oct, pers, lac);
        }
        else if(uPatternType == 4) { // Случайный шум (фрактальный)
            float val = 0.0, amp = 0.5, freq = 1.0;
            for(int i=0; i<oct; i++) {
                val += amp * random(st * freq);
                amp *= pers;
                freq *= lac;
            }
            return clamp(val, 0.0, 1.0);
        }
        else if(uPatternType == 5) { // Реакция-диффузия
            float val = 0.0, amp = 0.5, freq = 1.0;
            for(int i=0; i<oct; i++) {
                val += amp * reactionDiffusion(st * freq);
                amp *= pers;
                freq *= lac;
            }
            return clamp(val, 0.0, 1.0);
        }
        else if(uPatternType == 6) { // WFC
            float val = 0.0, amp = 0.5, freq = 1.0;
            for(int i=0; i<oct; i++) {
                val += amp * wfcPattern(st * freq);
                amp *= pers;
                freq *= lac;
            }
            return clamp(val, 0.0, 1.0);
        }
        else if(uPatternType == 7) { // Потоковое поле
            float val = 0.0, amp = 0.5, freq = 1.0;
            for(int i=0; i<oct; i++) {
                val += amp * flowField(st * freq);
                amp *= pers;
                freq *= lac;
            }
            return clamp(val, 0.0, 1.0);
        }
        else if(uPatternType == 12) { // Гребневый
            return ridgedMF(st, oct, pers, lac);
        }
        else {
            return fbmPerlin(st, oct, pers, lac);
        }
    }
    
    vec3 getColor(float t) {
        if (uColorsCount <= 1) return uColor0;
        float seg = 1.0 / float(uColorsCount - 1);
        int baseIdx = int(floor(t / seg));
        if (baseIdx >= uColorsCount - 1) baseIdx = uColorsCount - 2;
        float localT = (t - float(baseIdx) * seg) / seg;
        vec3 c1, c2;
        if (baseIdx == 0) { c1 = uColor0; c2 = uColor1; }
        else if (baseIdx == 1) { c1 = uColor1; c2 = uColor2; }
        else if (baseIdx == 2) { c1 = uColor2; c2 = uColor3; }
        else if (baseIdx == 3) { c1 = uColor3; c2 = uColor4; }
        else if (baseIdx == 4) { c1 = uColor4; c2 = uColor5; }
        else if (baseIdx == 5) { c1 = uColor5; c2 = uColor6; }
        else { c1 = uColor6; c2 = uColor7; }
        return mix(c1, c2, localT);
    }
    
    void main() {
        vec3 blend = abs(vNormalW);
        blend = pow(blend, vec3(2.0));
        blend /= (blend.x + blend.y + blend.z);
        vec2 uvX = vWorldPosition.yz;
        vec2 uvY = vWorldPosition.xz;
        vec2 uvZ = vWorldPosition.xy;
        float triScale = 0.8;
        uvX *= triScale; uvY *= triScale; uvZ *= triScale;
        float patX = computePattern(uvX);
        float patY = computePattern(uvY);
        float patZ = computePattern(uvZ);
        float patternValue = patX * blend.x + patY * blend.y + patZ * blend.z;
        patternValue = clamp(patternValue * uIntensity, 0.0, 1.0);
        vec3 color = getColor(patternValue);
        float gray = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(vec3(gray), color, uSaturation);
        if(uBlendMode == 1) color = color * patternValue;
        vec3 finalColor = color;
        
        // Оверлей
        if(uUseOverlay == 1) {
            vec4 overlayX = texture2D(uOverlayTexture, uvX);
            vec4 overlayY = texture2D(uOverlayTexture, uvY);
            vec4 overlayZ = texture2D(uOverlayTexture, uvZ);
            vec4 overlayRGBA = overlayX * blend.x + overlayY * blend.y + overlayZ * blend.z;
            if (overlayRGBA.a > 0.01) finalColor = mix(finalColor, overlayRGBA.rgb, overlayRGBA.a);
        }
        
        // Рельеф (2D)
        if (uShowRelief == 1) {
            vec3 grad = vec3(dFdx(patternValue), dFdy(patternValue), 0.0);
            vec3 normal = normalize(vec3(-grad.x * uReliefStrength, -grad.y * uReliefStrength, 1.0));
            vec3 lightDir = normalize(vec3(0.8, 1.0, 0.3));
            float diff = max(0.3, dot(normal, lightDir));
            finalColor = finalColor * (0.6 + diff * 0.5);
        }
        
        // Применяем металличность (простое смешение с серым)
        float metallic = uMetallic;
        vec3 metallicColor = mix(finalColor, vec3(0.8, 0.8, 0.8), metallic);
        gl_FragColor = vec4(metallicColor, 1.0);
    }
`;

function createMaterial() {
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide });
    if (uniforms.uOverlayTexture.value) {
        uniforms.uOverlayTexture.value.wrapS = THREE.MirroredRepeatWrapping;
        uniforms.uOverlayTexture.value.wrapT = THREE.MirroredRepeatWrapping;
    }
    return mat;
}

let plane2d = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), createMaterial());
scene2d.add(plane2d);

// --- Добавляем ползунок интенсивности, если отсутствует ---
if (!document.getElementById('intensity')) {
    const genGroup = document.querySelector('.setting-group');
    if (genGroup) {
        const row = document.createElement('div');
        row.className = 'control-row';
        row.innerHTML = `<label>Интенсивность</label><input type="range" id="intensity" min="0.2" max="2.5" step="0.01" value="1.0"><span class="value-display" id="intensityVal">1.00</span>`;
        genGroup.insertBefore(row, genGroup.children[2]);
    }
}

// --- Обновление параметров из UI ---
function updateUniformsFromUI() {
    uniforms.uScale.value = parseFloat(document.getElementById('scale').value);
    uniforms.uIntensity.value = parseFloat(document.getElementById('intensity').value);
    uniforms.uOctaves.value = parseInt(document.getElementById('octaves').value);
    uniforms.uPersistence.value = parseFloat(document.getElementById('persistence').value);
    uniforms.uLacunarity.value = parseFloat(document.getElementById('lacunarity').value);
    uniforms.uSaturation.value = parseFloat(document.getElementById('saturation').value);
    uniforms.uBlendMode.value = parseInt(document.getElementById('blendMode').value);
    uniforms.uRotation.value = parseFloat(document.getElementById('rotate').value);
    uniforms.uOffset.value.set(parseFloat(document.getElementById('offsetX').value), parseFloat(document.getElementById('offsetY').value));
    uniforms.uMirror.value = parseInt(document.getElementById('mirror').value);
    uniforms.uWarpEnable.value = document.getElementById('warpEnable').checked ? 1 : 0;
    uniforms.uWarpStrength.value = parseFloat(document.getElementById('warpStrength').value);
    uniforms.uWarpOctaves.value = parseInt(document.getElementById('warpOctaves').value);
    uniforms.uShowRelief.value = document.getElementById('relief2d').checked ? 1 : 0;
    uniforms.uReliefStrength.value = parseFloat(document.getElementById('reliefStrength').value);
    uniforms.uMetallic.value = parseFloat(document.getElementById('metallic').value);
    // Обновление отображения
    document.getElementById('scaleVal').innerText = uniforms.uScale.value.toFixed(2);
    document.getElementById('intensityVal').innerText = uniforms.uIntensity.value.toFixed(2);
    document.getElementById('octavesVal').innerText = uniforms.uOctaves.value;
    document.getElementById('persistenceVal').innerText = uniforms.uPersistence.value.toFixed(2);
    document.getElementById('lacunarityVal').innerText = uniforms.uLacunarity.value.toFixed(2);
    document.getElementById('saturationVal').innerText = uniforms.uSaturation.value.toFixed(2);
    document.getElementById('rotateVal').innerText = uniforms.uRotation.value + '°';
    document.getElementById('offsetXVal').innerText = uniforms.uOffset.value.x.toFixed(2);
    document.getElementById('offsetYVal').innerText = uniforms.uOffset.value.y.toFixed(2);
    document.getElementById('warpStrengthVal').innerText = uniforms.uWarpStrength.value.toFixed(2);
    document.getElementById('warpOctavesVal').innerText = uniforms.uWarpOctaves.value;
    document.getElementById('reliefStrengthVal').innerText = uniforms.uReliefStrength.value.toFixed(2);
    document.getElementById('metallicVal').innerText = uniforms.uMetallic.value.toFixed(2);

    if (syncOverlay) {
        patternImageFiles.forEach(item => {
            item.rotation = uniforms.uRotation.value;
            item.mirror = uniforms.uMirror.value;
            item.offsetX = uniforms.uOffset.value.x + globalShiftX;
            item.offsetY = uniforms.uOffset.value.y + globalShiftY;
        });
        updateOverlayUI();
        generateOverlayTexture();
    }
}

// --- Подписка на события ---
const controlIds = ['scale', 'intensity', 'octaves', 'persistence', 'lacunarity', 'saturation', 'blendMode', 'rotate', 'offsetX', 'offsetY', 'mirror', 'warpStrength', 'warpOctaves', 'reliefStrength', 'metallic'];
controlIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateUniformsFromUI);
});
document.getElementById('warpEnable')?.addEventListener('change', updateUniformsFromUI);
document.getElementById('relief2d')?.addEventListener('change', updateUniformsFromUI);
document.getElementById('globalOverlayShiftX')?.addEventListener('input', (e) => {
    globalShiftX = parseFloat(e.target.value);
    document.getElementById('globalOverlayShiftXVal').innerText = globalShiftX.toFixed(2);
    generateOverlayTexture();
});
document.getElementById('globalOverlayShiftY')?.addEventListener('input', (e) => {
    globalShiftY = parseFloat(e.target.value);
    document.getElementById('globalOverlayShiftYVal').innerText = globalShiftY.toFixed(2);
    generateOverlayTexture();
});

// --- Категории паттернов ---
const noisePatterns = [{ name: "Перлин", v: 2 }, { name: "Вороного", v: 1 }, { name: "Волны", v: 0 }];
const fractalPatterns = [{ name: "Реакция-диффузия", v: 5 }, { name: "Потоковое поле", v: 7 }, { name: "WFC", v: 6 }, { name: "Гребневый", v: 12 }];
const gradientPatterns = [{ name: "Линейный", v: 17 }, { name: "Радиальный", v: 18 }, { name: "Угловой", v: 19 }];
const geometricPatterns = [{ name: "Шахматы", v: 8 }, { name: "Полосы", v: 9 }, { name: "Круги", v: 10 }, { name: "Сетка", v: 11 }, { name: "Плитка", v: 16 }, { name: "Древесина", v: 14 }, { name: "Мрамор", v: 15 }, { name: "Truchet", v: 3 }];

function populateSelect(id, items, cur) {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    items.forEach(i => {
        const o = document.createElement('option');
        o.value = i.v;
        o.textContent = i.name;
        if (i.v === cur) o.selected = true;
        sel.appendChild(o);
    });
    sel.addEventListener('change', e => {
        uniforms.uPatternType.value = parseInt(e.target.value);
        updateUniformsFromUI();
    });
}
populateSelect('selectNoise', noisePatterns, uniforms.uPatternType.value);
populateSelect('selectFractal', fractalPatterns, uniforms.uPatternType.value);
populateSelect('selectGradient', gradientPatterns, uniforms.uPatternType.value);
populateSelect('selectGeometric', geometricPatterns, uniforms.uPatternType.value);


function createGeometry(type) {
    if (type === 'cube') return new THREE.BoxGeometry(1.2, 1.2, 1.2);
    if (type === 'torus') return new THREE.TorusKnotGeometry(0.85, 0.22, 200, 32, 3, 4);
    if (type === 'sphere') return new THREE.SphereGeometry(0.9, 128, 128);
    return new THREE.CylinderGeometry(0.8, 0.8, 1.2, 64);
}
function update3dModel() {
    if (currentMesh3d) scene3d.remove(currentMesh3d);
    if (customModel) {
        customModel.traverse(c => { if (c.isMesh) c.material = createMaterial(); });
        scene3d.add(customModel);
        currentMesh3d = customModel;
    } else {
        const m = new THREE.Mesh(createGeometry(currentGeometryType), createMaterial());
        scene3d.add(m);
        currentMesh3d = m;
    }
    const box = new THREE.Box3().setFromObject(currentMesh3d);
    controls3d.target.copy(box.getCenter(new THREE.Vector3()));
    controls3d.update();
    updateSizes();
}
document.getElementById('geometrySelect').addEventListener('change', e => {
    customModel = null;
    currentGeometryType = e.target.value;
    update3dModel();
});
document.getElementById('modelFileInput').addEventListener('change', e => {
    if (!e.target.files[0]) return;
    const url = URL.createObjectURL(e.target.files[0]);
    new GLTFLoader().load(url, gltf => {
        if (currentMesh3d) scene3d.remove(currentMesh3d);
        customModel = gltf.scene;
        const box = new THREE.Box3().setFromObject(customModel);
        const size = box.getSize(new THREE.Vector3()).length();
        const scl = 1.2 / size;
        customModel.scale.set(scl, scl, scl);
        customModel.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(scl));
        update3dModel();
        URL.revokeObjectURL(url);
        document.getElementById('modelStatus').textContent = 'Модель загружена';
        setTimeout(() => (document.getElementById('modelStatus').textContent = ''), 2000);
    }, undefined, () => (document.getElementById('modelStatus').textContent = 'Ошибка'));
});


document.getElementById('bgImageInput').addEventListener('change', e => {
    if (e.target.files[0]) {
        backgroundImageFile = e.target.files[0];
        document.getElementById('clearBgBtn').classList.remove('hidden');
        generateOverlayTexture();
    }
});
document.getElementById('clearBgBtn').addEventListener('click', () => {
    backgroundImageFile = null;
    document.getElementById('clearBgBtn').classList.add('hidden');
    generateOverlayTexture();
});
document.getElementById('bgOpacity').addEventListener('input', () => generateOverlayTexture());

const overlayImagesDiv = document.getElementById('overlayImagesList');
const patternElemScaleSlider = document.getElementById('patternElemScale');
const syncOverlayCheckbox = document.getElementById('syncOverlayCheckbox');
syncOverlayCheckbox.addEventListener('change', e => {
    syncOverlay = e.target.checked;
    if (syncOverlay) {
        patternImageFiles.forEach(item => {
            item.rotation = uniforms.uRotation.value;
            item.mirror = uniforms.uMirror.value;
            item.offsetX = uniforms.uOffset.value.x + globalShiftX;
            item.offsetY = uniforms.uOffset.value.y + globalShiftY;
        });
        updateOverlayUI();
        generateOverlayTexture();
    }
});

function updateOverlayUI() {
    overlayImagesDiv.innerHTML = '';
    if (patternImageFiles.length === 0) {
        overlayImagesDiv.innerHTML = '<div class="status-msg">Нет загруженных изображений</div>';
        return;
    }
    patternImageFiles.forEach((item, idx) => {
        const container = document.createElement('div');
        container.className = 'overlay-item-container';
        const nameDiv = document.createElement('div');
        nameDiv.className = 'overlay-item-name';
        nameDiv.textContent = item.file.name.length > 20 ? item.file.name.slice(0, 17) + '…' : item.file.name;
        container.appendChild(nameDiv);

        const delBtn = document.createElement('button');
        delBtn.className = 'remove-color-btn';
        delBtn.textContent = '✕';
        delBtn.style.position = 'absolute';
        delBtn.style.top = '8px';
        delBtn.style.right = '8px';
        delBtn.addEventListener('click', e => {
            e.stopPropagation();
            patternImageFiles.splice(idx, 1);
            updateOverlayUI();
            generateOverlayTexture();
        });
        container.appendChild(delBtn);

        const scaleRow = document.createElement('div');
        scaleRow.className = 'control-row';
        scaleRow.innerHTML = `<label>Масштаб</label><input type="range" min="0.1" max="3.0" step="0.05" value="${item.scale}"><span class="value-display">${item.scale.toFixed(2)}</span>`;
        scaleRow.querySelector('input').addEventListener('input', e => {
            item.scale = parseFloat(e.target.value);
            e.target.nextElementSibling.textContent = item.scale.toFixed(2);
            generateOverlayTexture();
        });
        container.appendChild(scaleRow);

        if (!syncOverlay) {
            const rotRow = document.createElement('div');
            rotRow.className = 'control-row';
            rotRow.innerHTML = `<label>Поворот</label><input type="range" min="0" max="360" step="1" value="${item.rotation}"><span class="value-display">${item.rotation}°</span>`;
            rotRow.querySelector('input').addEventListener('input', e => {
                item.rotation = parseInt(e.target.value);
                e.target.nextElementSibling.textContent = item.rotation + '°';
                generateOverlayTexture();
            });
            container.appendChild(rotRow);

            const offXRow = document.createElement('div');
            offXRow.className = 'control-row';
            offXRow.innerHTML = `<label>Сдвиг X</label><input type="range" min="-1" max="1" step="0.01" value="${item.offsetX}"><span class="value-display">${item.offsetX.toFixed(2)}</span>`;
            offXRow.querySelector('input').addEventListener('input', e => {
                item.offsetX = parseFloat(e.target.value);
                e.target.nextElementSibling.textContent = item.offsetX.toFixed(2);
                generateOverlayTexture();
            });
            container.appendChild(offXRow);

            const offYRow = document.createElement('div');
            offYRow.className = 'control-row';
            offYRow.innerHTML = `<label>Сдвиг Y</label><input type="range" min="-1" max="1" step="0.01" value="${item.offsetY}"><span class="value-display">${item.offsetY.toFixed(2)}</span>`;
            offYRow.querySelector('input').addEventListener('input', e => {
                item.offsetY = parseFloat(e.target.value);
                e.target.nextElementSibling.textContent = item.offsetY.toFixed(2);
                generateOverlayTexture();
            });
            container.appendChild(offYRow);

            const mirRow = document.createElement('div');
            mirRow.className = 'control-row';
            mirRow.innerHTML = `<label>Зеркало</label><select><option value="0" ${item.mirror === 0 ? 'selected' : ''}>Нет</option><option value="1" ${item.mirror === 1 ? 'selected' : ''}>X</option><option value="2" ${item.mirror === 2 ? 'selected' : ''}>Y</option><option value="3" ${item.mirror === 3 ? 'selected' : ''}>X+Y</option></select>`;
            mirRow.querySelector('select').addEventListener('change', e => {
                item.mirror = parseInt(e.target.value);
                generateOverlayTexture();
            });
            container.appendChild(mirRow);
        } else {
            const info = document.createElement('div');
            info.style.cssText = 'font-size:0.75rem; color:#5a3b44; margin-bottom:8px;';
            info.textContent = `Синхронизировано`;
            container.appendChild(info);
        }

        const opRow = document.createElement('div');
        opRow.className = 'control-row';
        opRow.innerHTML = `<label>Прозрачность</label><input type="range" min="0" max="1" step="0.01" value="${item.opacity}"><span class="value-display">${item.opacity.toFixed(2)}</span>`;
        opRow.querySelector('input').addEventListener('input', e => {
            item.opacity = parseFloat(e.target.value);
            e.target.nextElementSibling.textContent = item.opacity.toFixed(2);
            generateOverlayTexture();
        });
        container.appendChild(opRow);

        overlayImagesDiv.appendChild(container);
    });
}

async function generateOverlayTexture() {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // Фоновое изображение
    if (backgroundImageFile) {
        const bgImg = await new Promise(resolve => {
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
        const globalScale = parseFloat(patternElemScaleSlider.value);
        for (const item of patternImageFiles) {
            const img = await new Promise(resolve => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.src = URL.createObjectURL(item.file);
            });
            ctx.save();
            ctx.translate(size / 2, size / 2);
            const finalRotation = syncOverlay ? uniforms.uRotation.value : item.rotation;
            const finalOffsetX = syncOverlay ? (uniforms.uOffset.value.x + globalShiftX) : (item.offsetX + globalShiftX);
            const finalOffsetY = syncOverlay ? (uniforms.uOffset.value.y + globalShiftY) : (item.offsetY + globalShiftY);
            const finalMirror = syncOverlay ? uniforms.uMirror.value : item.mirror;
            const finalOpacity = item.opacity;
            const finalScale = item.scale * globalScale;

            ctx.translate(finalOffsetX * size / 2, finalOffsetY * size / 2);
            ctx.rotate(finalRotation * Math.PI / 180);
            if (finalMirror === 1 || finalMirror === 3) ctx.scale(-1, 1);
            if (finalMirror === 2 || finalMirror === 3) ctx.scale(1, -1);

            const imgW = img.width * finalScale;
            const imgH = img.height * finalScale;
            ctx.globalAlpha = finalOpacity;
            // Тайлинг 5x5 (вместо 3x3) гарантирует отсутствие обрезания при любых сдвигах
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    ctx.drawImage(img, dx * imgW - imgW / 2, dy * imgH - imgH / 2, imgW, imgH);
                }
            }
            ctx.restore();
            URL.revokeObjectURL(img.src);
        }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.MirroredRepeatWrapping;
    texture.wrapT = THREE.MirroredRepeatWrapping;
    texture.needsUpdate = true;
    if (overlayTexture) overlayTexture.dispose?.();
    overlayTexture = texture;
    uniforms.uOverlayTexture.value = overlayTexture;
    uniforms.uUseOverlay.value = patternImageFiles.length > 0 || backgroundImageFile ? 1 : 0;
}

document.getElementById('addOverlayBtn').addEventListener('click', () => document.getElementById('multiTextureInput').click());
document.getElementById('clearOverlayBtn').addEventListener('click', () => {
    patternImageFiles = [];
    updateOverlayUI();
    generateOverlayTexture();
});
document.getElementById('multiTextureInput').addEventListener('change', e => {
    Array.from(e.target.files).forEach(f => {
        patternImageFiles.push({
            file: f,
            rotation: 0,
            offsetX: 0,
            offsetY: 0,
            mirror: 0,
            opacity: 1,
            scale: 1
        });
    });
    updateOverlayUI();
    generateOverlayTexture();
    e.target.value = '';
});
patternElemScaleSlider.addEventListener('input', () => {
    document.getElementById('patternElemScaleVal').innerText = patternElemScaleSlider.value;
    generateOverlayTexture();
});


const colorContainer = document.getElementById('colorListContainer');
const addColorBtn = document.getElementById('addColorBtn');
function rebuildColorUI() {
    colorContainer.innerHTML = '';
    activeColors.forEach((col, idx) => {
        const div = document.createElement('div');
        div.className = 'color-item';
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = '#' + col.getHexString();
        colorInput.className = 'color-circle-input';
        colorInput.addEventListener('input', e => {
            activeColors[idx] = new THREE.Color(e.target.value);
            updateColorUniforms();
            updateUniformsFromUI();
        });
        div.appendChild(colorInput);
        if (activeColors.length > 2) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-color-btn';
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', e => {
                e.stopPropagation();
                if (activeColors.length > 2) {
                    activeColors.splice(idx, 1);
                    rebuildColorUI();
                    updateColorUniforms();
                    updateUniformsFromUI();
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
        updateColorUniforms();
        updateUniformsFromUI();
    }
});
rebuildColorUI();


const savePresetBtn = document.getElementById('savePresetBtn');
const loadPresetInput = document.getElementById('loadPresetInput');
const loadPresetBtn = document.getElementById('loadPresetBtn');
function getCurrentPreset() {
    return {
        colors: activeColors.map(c => c.getHexString()),
        uniforms: {
            scale: uniforms.uScale.value,
            intensity: uniforms.uIntensity.value,
            octaves: uniforms.uOctaves.value,
            persistence: uniforms.uPersistence.value,
            lacunarity: uniforms.uLacunarity.value,
            saturation: uniforms.uSaturation.value,
            blendMode: uniforms.uBlendMode.value,
            rotation: uniforms.uRotation.value,
            offsetX: uniforms.uOffset.value.x,
            offsetY: uniforms.uOffset.value.y,
            mirror: uniforms.uMirror.value,
            warpEnable: uniforms.uWarpEnable.value,
            warpStrength: uniforms.uWarpStrength.value,
            warpOctaves: uniforms.uWarpOctaves.value,
            reliefStrength: uniforms.uReliefStrength.value,
            relief2d: uniforms.uShowRelief.value,
            metallic: uniforms.uMetallic.value
        },
        patternType: uniforms.uPatternType.value
    };
}
function applyPreset(p) {
    if (!p.colors) return;
    activeColors = p.colors.map(h => new THREE.Color('#' + h));
    rebuildColorUI();
    updateColorUniforms();
    if (p.uniforms) {
        Object.keys(p.uniforms).forEach(k => {
            const el = document.getElementById(k);
            if (el) el.value = p.uniforms[k];
        });
        if (p.uniforms.relief2d !== undefined) document.getElementById('relief2d').checked = p.uniforms.relief2d === 1;
        updateUniformsFromUI();
    }
    if (p.patternType !== undefined) uniforms.uPatternType.value = p.patternType;
    generateOverlayTexture();
    alert('Пресет загружен');
}
savePresetBtn.onclick = () => {
    const p = getCurrentPreset();
    const blob = new Blob([JSON.stringify(p)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `preset_${Date.now()}.json`;
    a.click();
    alert('Пресет сохранён');
};
loadPresetBtn.onclick = () => loadPresetInput.click();
loadPresetInput.onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
        try {
            applyPreset(JSON.parse(ev.target.result));
        } catch (err) {
            alert('Ошибка загрузки пресета');
        }
    };
    r.readAsText(f);
};


async function renderPBRMap(res, type) {
    const tuni = JSON.parse(JSON.stringify(uniforms));
    tuni.uUseOverlay = { value: 0 };
    tuni.uShowRelief = { value: 0 };
    if (type === 'normal') {
        tuni.uColorsCount = { value: 2 };
        tuni.uColor0 = { value: new THREE.Vector3(0.5, 0.5, 1.0) };
        tuni.uColor1 = { value: new THREE.Vector3(1.0, 0.5, 0.5) };
    } else if (type === 'roughness') {
        tuni.uColorsCount = { value: 1 };
        tuni.uColor0 = { value: new THREE.Vector3(0.4, 0.4, 0.4) };
    } else if (type === 'metallic') {
        tuni.uColorsCount = { value: 1 };
        tuni.uColor0 = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
    } else if (type === 'height') {
        tuni.uColorsCount = { value: 1 };
        tuni.uColor0 = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
        tuni.uShowRelief = { value: 0 };
    } else if (type === 'ao') {
        tuni.uColorsCount = { value: 1 };
        tuni.uColor0 = { value: new THREE.Vector3(1.0, 1.0, 1.0) };
    } else {
        // basecolor
        tuni.uColorsCount = { value: uniforms.uColorsCount.value };
        for (let i = 0; i < 8; i++) tuni[`uColor${i}`] = { value: uniforms[`uColor${i}`].value.clone() };
    }
    const sc = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    cam.position.z = 1;
    const mat = new THREE.ShaderMaterial({ uniforms: tuni, vertexShader, fragmentShader });
    sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(res, res);
    renderer.render(sc, cam);
    const blob = await new Promise(r => renderer.domElement.toBlob(r, 'image/png'));
    renderer.dispose();
    mat.dispose();
    return blob;
}

async function captureTextureImage() {
    const tuni = JSON.parse(JSON.stringify(uniforms));
    tuni.uShowRelief = { value: 0 };
    const sc = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    cam.position.z = 1;
    const mat = new THREE.ShaderMaterial({ uniforms: tuni, vertexShader, fragmentShader });
    sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(1024, 1024);
    renderer.render(sc, cam);
    const blob = await new Promise(r => renderer.domElement.toBlob(r, 'image/png'));
    renderer.dispose();
    mat.dispose();
    return blob;
}

document.getElementById('export2DBtn').addEventListener('click', async () => {
    const format = document.getElementById('export2DFormat').value;
    const res = parseInt(document.getElementById('exportResolution').value);
    if (format === 'pbr') {
        const zip = new JSZip();
        zip.file("basecolor.png", await renderPBRMap(res, 'basecolor'));
        zip.file("normal.png", await renderPBRMap(res, 'normal'));
        zip.file("roughness.png", await renderPBRMap(res, 'roughness'));
        zip.file("height.png", await renderPBRMap(res, 'height'));
        zip.file("ao.png", await renderPBRMap(res, 'ao'));
        zip.file("metallic.png", await renderPBRMap(res, 'metallic'));
        const content = await zip.generateAsync({ type: "blob" });
        downloadBlob(content, `pbr_${res}.zip`);
    } else if (format === 'svg') {
        const imgData = renderer2d.domElement.toDataURL('image/png');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${res}" height="${res}" viewBox="0 0 ${res} ${res}"><image width="${res}" height="${res}" href="${imgData}"/></svg>`;
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        downloadBlob(blob, `texture.svg`);
    } else {
        const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
        const canvas = renderer2d.domElement;
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = res;
        exportCanvas.height = res;
        const ctx = exportCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, 0, res, res);
        exportCanvas.toBlob(blob => downloadBlob(blob, `texture.${format}`), mime, 0.95);
    }
});
renderer2d.domElement.addEventListener('dblclick', () => document.getElementById('export2DBtn').click());

document.getElementById('exportModelBtn').addEventListener('click', async () => {
    const format = document.getElementById('exportModelFormat').value;
    try {
        const textureBlob = await captureTextureImage();
        const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = URL.createObjectURL(textureBlob); });
        const texture = new THREE.CanvasTexture(img);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        const mat = new THREE.MeshStandardMaterial({ map: texture });
        let exportScene = new THREE.Scene();
        if (customModel) {
            const c = customModel.clone();
            c.traverse(ch => { if (ch.isMesh) ch.material = mat; });
            exportScene.add(c);
        } else {
            const g = createGeometry(currentGeometryType);
            exportScene.add(new THREE.Mesh(g, mat));
        }
        if (format === 'glb') {
            new GLTFExporter().parse(exportScene, result => {
                const blob = new Blob([result], { type: 'application/octet-stream' });
                downloadBlob(blob, 'model.glb');
            }, { binary: true });
        } else if (format === 'gltf') {
            new GLTFExporter().parse(exportScene, result => {
                const blob = new Blob([JSON.stringify(result)], { type: 'application/json' });
                downloadBlob(blob, 'model.gltf');
            });
        } else if (format === 'obj') {
            const obj = new OBJExporter().parse(exportScene);
            const mtl = `newmtl material0\nmap_Kd texture.png\n`;
            const zip = new JSZip();
            zip.file("model.obj", obj);
            zip.file("model.mtl", mtl);
            zip.file("texture.png", textureBlob);
            const content = await zip.generateAsync({ type: "blob" });
            downloadBlob(content, 'model_obj.zip');
        }
    } catch (e) {
        alert("Ошибка экспорта: " + e.message);
    }
});
renderer3d.domElement.addEventListener('dblclick', () => document.getElementById('exportModelBtn').click());

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}


function animate() {
    requestAnimationFrame(animate);
    renderer2d.render(scene2d, camera2d);
    controls3d.update();
    renderer3d.render(scene3d, camera3d);
}
animate();


updateUniformsFromUI();
update3dModel();
generateOverlayTexture();
