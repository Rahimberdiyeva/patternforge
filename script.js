import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

// --- Инициализация 2D рендерера (шейдерная текстура) ---
const container2d = document.getElementById('canvas2d');
const container3d = document.getElementById('canvas3d');
const scene2d = new THREE.Scene(); scene2d.background = null;
const camera2d = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera2d.position.z = 1;
const renderer2d = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer2d.setClearColor(0x000000, 0);
container2d.appendChild(renderer2d.domElement);

// --- 3D сцена и рендерер ---
const scene3d = new THREE.Scene();
scene3d.background = new THREE.Color(0xfffafc);
const camera3d = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera3d.position.set(2.2, 1.6, 2.8);
const renderer3d = new THREE.WebGLRenderer({ antialias: true });
container3d.appendChild(renderer3d.domElement);
const controls3d = new OrbitControls(camera3d, renderer3d.domElement);
controls3d.enableDamping = true;
controls3d.enableZoom = true;
controls3d.target.set(0, 0, 0);

// Освещение 3D
scene3d.add(new THREE.AmbientLight(0xffeef2, 0.65));
const dirLight = new THREE.DirectionalLight(0xfff0f3, 1.2);
dirLight.position.set(1, 2, 1);
scene3d.add(dirLight);
scene3d.add(new THREE.PointLight(0xffd9e2, 0.6, 10));
scene3d.add(new THREE.PointLight(0xffe4ea, 0.5, 10));

// --- Глобальные переменные ---
let currentMesh3d = null;
let currentGeometryType = 'cube';
let customModel = null;
let backgroundImageEl = null;
let activeColors = [
    new THREE.Color('#FF6B8B'),
    new THREE.Color('#4CC9F0'),
    new THREE.Color('#F9C74F'),
    new THREE.Color('#9B5DE5')
];
let layers = [];
let selectedLayerId = null;
let isDraggingLayer = false;
let dragStart = { x: 0, y: 0, layerX: 0, layerY: 0 };
let overlayTexture = null;
let texture3D = null;           // Текстура для 3D модели (из 2D канваса)
let current3DMaterial = null;   // MeshStandardMaterial для 3D

// --- Униформа шейдера 2д
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
    uTime: { value: 0 }
};

// --- Обновление цветовых uniform ---
function updateColorUniforms() {
    const lastColor = activeColors.length ? activeColors[activeColors.length - 1] : new THREE.Color(1, 1, 1);
    for (let i = 0; i < 8; i++) {
        const c = i < activeColors.length ? activeColors[i] : lastColor;
        uniforms[`uColor${i}`].value.set(c.r, c.g, c.b);
    }
    uniforms.uColorsCount.value = activeColors.length;
}

const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    precision highp float;
    uniform float uScale; uniform float uIntensity; uniform int uPatternType;
    uniform vec3 uColor0; uniform vec3 uColor1; uniform vec3 uColor2; uniform vec3 uColor3;
    uniform vec3 uColor4; uniform vec3 uColor5; uniform vec3 uColor6; uniform vec3 uColor7;
    uniform int uColorsCount; uniform float uSaturation; uniform int uBlendMode;
    uniform float uRotation; uniform vec2 uOffset; uniform int uMirror;
    uniform int uOctaves; uniform float uPersistence; uniform float uLacunarity;
    uniform sampler2D uOverlayTexture; uniform int uUseOverlay;
    uniform int uWarpEnable; uniform float uWarpStrength; uniform int uWarpOctaves;
    uniform int uShowRelief; uniform float uReliefStrength;
    uniform float uTime;
    varying vec2 vUv;
    
    // ----- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (объявлены заранее) -----
    float random (vec2 st);
    vec2 hash(vec2 p);
    float perlinNoise(vec2 st);
    float fbmPerlin(vec2 st, int oct, float pers, float lac);
    float worley(vec2 uv);
    float fbmWorley(vec2 uv, int oct, float pers, float lac);
    float reactionDiffusion(vec2 uv);
    float flowField(vec2 uv);
    float wfcPattern(vec2 uv);
    float ridgedMF(vec2 uv, int oct, float pers, float lac);
    float checker(vec2 uv, float freq);
    float stripes(vec2 uv, float freq);
    float circles(vec2 uv, float freq);
    float grid(vec2 uv, float freq);
    float tiles(vec2 uv, float freq);
    float wood(vec2 uv, float freq);
    float marble(vec2 uv, float freq);
    float linearGradient(vec2 uv);
    float radialGradient(vec2 uv);
    float angularGradient(vec2 uv);
    float truchetPattern(vec2 uv, float t);
    float fractalPattern(vec2 uv, int patternType, int oct, float pers, float lac);
    vec2 domainWarp(vec2 uv, float strength, int octaves);
    float computePattern(vec2 uv);
    vec3 getColor(float t);
    
    // ----- РЕАЛИЗАЦИИ -----
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
    float fbmWorley(vec2 uv, int oct, float pers, float lac) {
        float val = 0.0, amp = 0.5, freq = 2.0;
        for(int i=0; i<oct; i++) { val += amp * worley(uv * freq); amp *= pers; freq *= lac; }
        return clamp(val, 0.0, 1.0);
    }
    float reactionDiffusion(vec2 uv) { vec2 p = uv * 4.0; float a = sin(p.x * 3.0) * cos(p.y * 3.0); float b = cos(p.x * 4.2) * sin(p.y * 4.2); return clamp(a * 0.5 + b * 0.5 + 0.5, 0.0, 1.0); }
    float flowField(vec2 uv) { vec2 q = uv * 3.0; float angle = sin(q.y * 0.7) * cos(q.x * 0.5); vec2 gradient = vec2(cos(angle), sin(angle)); uv += gradient * 0.1; float field = sin(uv.x * 10.0) * cos(uv.y * 10.0); return smoothstep(-0.3, 0.7, field); }
    float wfcPattern(vec2 uv) { vec2 tile = floor(uv * 8.0); float hashVal = random(tile); int rule = int(floor(hashVal * 6.0)); float pattern = 0.0; vec2 sub = fract(uv * 8.0); if(rule == 0) pattern = step(0.5, sub.x) * step(0.5, sub.y); else if(rule == 1) pattern = step(0.5, sub.x + sub.y); else if(rule == 2) pattern = step(0.5, sub.x - sub.y + 0.5); else if(rule == 3) pattern = sin(sub.x * 3.14159 * 4.0) * 0.5 + 0.5; else if(rule == 4) pattern = (sub.x > 0.25 && sub.x < 0.75 && sub.y > 0.25 && sub.y < 0.75) ? 1.0 : 0.0; else pattern = fract(sub.x * 3.0 + sub.y * 2.0); return pattern; }
    float ridgedMF(vec2 uv, int oct, float pers, float lac) { float val = 0.0, amp = 0.5, freq = 2.0; for(int i=0; i<oct; i++) { float n = perlinNoise(uv * freq) * 2.0 - 1.0; n = 1.0 - abs(n); val += amp * n; amp *= pers; freq *= lac; } return clamp(val, 0.0, 1.0); }
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
    float truchetPattern(vec2 uv, float t) { uv = fract(uv * 3.0) - 0.5; float angle = sin(t + uv.x*10.) * cos(t + uv.y*10.); return step(length(uv), 0.4+0.2*sin(angle*20.+t)); }
    
    float fractalPattern(vec2 uv, int patternType, int oct, float pers, float lac) {
        if(oct <= 1) {
            if(patternType == 0) { float w1 = sin(uv.x*8.0)*cos(uv.y*8.0); float w2 = sin(uv.y*12.0+uv.x*5.0); return (w1 + w2)*0.6+0.5; }
            else if(patternType == 1) return worley(uv*3.5);
            else if(patternType == 2) return fbmPerlin(uv, 1, 0.5, 2.0);
            else if(patternType == 4) return random(uv);
            else if(patternType == 5) return reactionDiffusion(uv);
            else if(patternType == 6) return wfcPattern(uv);
            else if(patternType == 7) return flowField(uv);
            else if(patternType == 12) return ridgedMF(uv, 1, 0.5, 2.0);
            else return 0.5;
        }
        float val = 0.0, amp = 0.5, freq = 2.0;
        for(int i=0; i<6; i++) {
            if(i>=oct) break;
            float n;
            if(patternType == 0) { float w1 = sin((uv*freq).x*8.0)*cos((uv*freq).y*8.0); float w2 = sin((uv*freq).y*12.0+(uv*freq).x*5.0); n = (w1 + w2)*0.6+0.5; }
            else if(patternType == 1) n = worley(uv * freq * 3.5);
            else if(patternType == 2) n = fbmPerlin(uv * freq, 1, 0.5, 2.0);
            else if(patternType == 4) n = random(uv * freq);
            else if(patternType == 5) n = reactionDiffusion(uv * freq);
            else if(patternType == 6) n = wfcPattern(uv * freq);
            else if(patternType == 7) n = flowField(uv * freq);
            else if(patternType == 12) n = ridgedMF(uv * freq, 1, 0.5, 2.0);
            else n = 0.5;
            val += amp * n;
            amp *= pers;
            freq *= lac;
        }
        return clamp(val, 0.0, 1.0);
    }
    
    vec2 domainWarp(vec2 uv, float strength, int octaves) {
        vec2 warped = uv;
        for(int i=0; i<octaves; i++) {
            warped += strength * vec2(sin(warped.y * 3.14159 * 2.0 * float(i+1) + uTime), cos(warped.x * 3.14159 * 2.0 * float(i+1) + uTime));
        }
        return warped;
    }
    
    float computePattern(vec2 uv) {
        float angle = uRotation * 3.14159 / 180.0;
        vec2 centered = uv - 0.5;
        vec2 rotated = vec2(centered.x*cos(angle)-centered.y*sin(angle), centered.x*sin(angle)+centered.y*cos(angle));
        uv = rotated + 0.5 + uOffset;
        if(uMirror == 1) uv.x = 1.0 - uv.x; else if(uMirror == 2) uv.y = 1.0 - uv.y; else if(uMirror == 3) { uv.x = 1.0 - uv.x; uv.y = 1.0 - uv.y; }
        uv = fract(uv);
        vec2 st = uv * uScale;
        if(uWarpEnable == 1) st = domainWarp(st, uWarpStrength, uWarpOctaves);
        
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
        
        return fractalPattern(st, uPatternType, uOctaves, uPersistence, uLacunarity);
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
        vec2 uv = vUv;
        float patternValue = computePattern(uv);
        patternValue = clamp(patternValue * uIntensity, 0.0, 1.0);
        vec3 color = getColor(patternValue);
        float gray = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(vec3(gray), color, uSaturation);
        if(uBlendMode == 1) color = color * patternValue;
        vec3 finalColor = color;
        if(uUseOverlay == 1) {
            vec4 overlayRGBA = texture2D(uOverlayTexture, vUv);
            if (overlayRGBA.a > 0.01) finalColor = mix(finalColor, overlayRGBA.rgb, overlayRGBA.a);
        }
        if (uShowRelief == 1) {
            vec3 grad = vec3(dFdx(patternValue), dFdy(patternValue), 0.0);
            vec3 normal = normalize(vec3(-grad.x * uReliefStrength, -grad.y * uReliefStrength, 1.0));
            vec3 lightDir = normalize(vec3(0.8, 1.0, 0.3));
            float diff = max(0.3, dot(normal, lightDir));
            finalColor = finalColor * (0.6 + diff * 0.5);
        }
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

let plane2d = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }));
scene2d.add(plane2d);

function update2DRenderAndTexture() {
    // Рендерим 2D сцену в canvas
    renderer2d.render(scene2d, camera2d);
    
    // Если текстура для 3D ещё не создана, создаём
    if (!texture3D && renderer2d.domElement) {
        texture3D = new THREE.CanvasTexture(renderer2d.domElement);
        texture3D.wrapS = THREE.RepeatWrapping;
        texture3D.wrapT = THREE.RepeatWrapping;
        if (current3DMaterial) {
            current3DMaterial.map = texture3D;
            current3DMaterial.needsUpdate = true;
        }
    } else if (texture3D) {
        texture3D.needsUpdate = true;
        if (current3DMaterial) current3DMaterial.needsUpdate = true;
    }
}

function update3DMaterialProps() {
    if (!current3DMaterial) return;
    const metallic = parseFloat(document.getElementById('metallic')?.value || 0.5);
    const roughness = parseFloat(document.getElementById('roughness')?.value || 0.4);
    const scale3d = parseFloat(document.getElementById('tile3dScale')?.value || 1.0);
    current3DMaterial.metalness = metallic;
    current3DMaterial.roughness = roughness;
    if (texture3D) {
        texture3D.repeat.set(scale3d, scale3d);
        texture3D.needsUpdate = true;
    }
    document.getElementById('metallicVal').innerText = metallic.toFixed(2);
    document.getElementById('roughnessVal').innerText = roughness.toFixed(2);
    document.getElementById('tile3dScaleVal').innerText = scale3d.toFixed(2);
}

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
    
    update2DRenderAndTexture();
    update3DMaterialProps();
}

function create3DModel() {
    if (currentMesh3d) scene3d.remove(currentMesh3d);
    let geometry;
    if (customModel) {
        currentMesh3d = customModel.clone();
        currentMesh3d.traverse(child => { if (child.isMesh) child.material = current3DMaterial; });
        scene3d.add(currentMesh3d);
        const box = new THREE.Box3().setFromObject(currentMesh3d);
        controls3d.target.copy(box.getCenter(new THREE.Vector3()));
        controls3d.update();
        return;
    } else {
        if (currentGeometryType === 'cube') geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
        else if (currentGeometryType === 'torus') geometry = new THREE.TorusKnotGeometry(0.85, 0.22, 200, 32, 3, 4);
        else if (currentGeometryType === 'sphere') geometry = new THREE.SphereGeometry(0.9, 128, 128);
        else geometry = new THREE.CylinderGeometry(0.8, 0.8, 1.2, 64);
        currentMesh3d = new THREE.Mesh(geometry, current3DMaterial);
        scene3d.add(currentMesh3d);
        const box = new THREE.Box3().setFromObject(currentMesh3d);
        controls3d.target.copy(box.getCenter(new THREE.Vector3()));
        controls3d.update();
    }
}

function update3DMaterial() {
    if (current3DMaterial) current3DMaterial.dispose();
    if (!texture3D && renderer2d.domElement) {
        texture3D = new THREE.CanvasTexture(renderer2d.domElement);
        texture3D.wrapS = THREE.RepeatWrapping;
        texture3D.wrapT = THREE.RepeatWrapping;
    }
    current3DMaterial = new THREE.MeshStandardMaterial({ map: texture3D, metalness: 0.5, roughness: 0.4 });
    update3DMaterialProps();
    create3DModel();
}

document.getElementById('geometrySelect')?.addEventListener('change', e => { customModel = null; currentGeometryType = e.target.value; update3DMaterial(); });
document.getElementById('modelFileInput')?.addEventListener('change', e => {
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
        update3DMaterial();
        URL.revokeObjectURL(url);
        document.getElementById('modelStatus').textContent = 'Модель загружена';
        setTimeout(() => document.getElementById('modelStatus').textContent = '', 2000);
    }, undefined, () => document.getElementById('modelStatus').textContent = 'Ошибка');
});

const colorContainer = document.getElementById('colorListContainer');
const addColorBtn = document.getElementById('addColorBtn');
function rebuildColorUI() {
    colorContainer.innerHTML = '';
    activeColors.forEach((col, idx) => {
        const div = document.createElement('div'); div.className = 'color-item';
        const colorInput = document.createElement('input'); colorInput.type = 'color'; colorInput.value = '#' + col.getHexString(); colorInput.className = 'color-circle-input';
        colorInput.addEventListener('input', (e) => { activeColors[idx] = new THREE.Color(e.target.value); updateColorUniforms(); update2DRenderAndTexture(); });
        div.appendChild(colorInput);
        if (activeColors.length > 2) {
            const removeBtn = document.createElement('button'); removeBtn.className = 'remove-color-btn'; removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', (e) => { e.stopPropagation(); if (activeColors.length > 2) { activeColors.splice(idx, 1); rebuildColorUI(); updateColorUniforms(); update2DRenderAndTexture(); } });
            div.appendChild(removeBtn);
        }
        colorContainer.appendChild(div);
    });
}
addColorBtn.addEventListener('click', () => { if (activeColors.length < 8) { activeColors.push(new THREE.Color('#FFB347')); rebuildColorUI(); updateColorUniforms(); update2DRenderAndTexture(); } });
rebuildColorUI();
updateColorUniforms();

const noisePatterns = [{ name: "Перлин (фрактал)", v: 2 }, { name: "Вороного (Worley)", v: 1 }, { name: "Волны", v: 0 }, { name: "Реакция-диффузия", v: 5 }, { name: "Потоковое поле", v: 7 }, { name: "WFC", v: 6 }, { name: "Гребневый", v: 12 }];
const fractalPatterns = [{ name: "Фрактал Перлина", v: 2 }, { name: "Мультифрактал", v: 12 }];
const gradientPatterns = [{ name: "Линейный", v: 17 }, { name: "Радиальный", v: 18 }, { name: "Угловой", v: 19 }];
const geometricPatterns = [{ name: "Шахматы", v: 8 }, { name: "Полосы", v: 9 }, { name: "Круги", v: 10 }, { name: "Сетка", v: 11 }, { name: "Плитка", v: 16 }, { name: "Древесина", v: 14 }, { name: "Мрамор", v: 15 }, { name: "Truchet", v: 3 }];
function populateSelect(id, items, cur) {
    const sel = document.getElementById(id); if (!sel) return;
    sel.innerHTML = '';
    items.forEach(i => { const o = document.createElement('option'); o.value = i.v; o.textContent = i.name; if (i.v === cur) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', e => { uniforms.uPatternType.value = parseInt(e.target.value); update2DRenderAndTexture(); });
}
populateSelect('selectNoise', noisePatterns, 2);
populateSelect('selectFractal', fractalPatterns, 2);
populateSelect('selectGradient', gradientPatterns, 17);
populateSelect('selectGeometric', geometricPatterns, 8);

// --- Пресеты (UI/UX) ---
function getCurrentPreset() {
    return {
        colors: activeColors.map(c => c.getHexString()),
        uniforms: {
            scale: uniforms.uScale.value, intensity: uniforms.uIntensity.value, octaves: uniforms.uOctaves.value,
            persistence: uniforms.uPersistence.value, lacunarity: uniforms.uLacunarity.value,
            saturation: uniforms.uSaturation.value, blendMode: uniforms.uBlendMode.value,
            rotation: uniforms.uRotation.value, offsetX: uniforms.uOffset.value.x, offsetY: uniforms.uOffset.value.y,
            mirror: uniforms.uMirror.value, warpEnable: uniforms.uWarpEnable.value,
            warpStrength: uniforms.uWarpStrength.value, warpOctaves: uniforms.uWarpOctaves.value,
            reliefStrength: uniforms.uReliefStrength.value, relief2d: uniforms.uShowRelief.value
        },
        patternType: uniforms.uPatternType.value
    };
}
function applyPreset(p) {
    if (!p.colors) return;
    activeColors = p.colors.map(h => new THREE.Color('#' + h)); rebuildColorUI(); updateColorUniforms();
    if (p.uniforms) {
        Object.keys(p.uniforms).forEach(k => { const el = document.getElementById(k); if (el) el.value = p.uniforms[k]; });
        if (p.uniforms.relief2d !== undefined) document.getElementById('relief2d').checked = p.uniforms.relief2d === 1;
        updateUniformsFromUI();
    }
    if (p.patternType !== undefined) uniforms.uPatternType.value = p.patternType;
    update2DRenderAndTexture();
    alert('Пресет загружен');
}
document.getElementById('savePresetBtn').onclick = () => { const p = getCurrentPreset(); const blob = new Blob([JSON.stringify(p)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `preset_${Date.now()}.json`; a.click(); alert('Пресет сохранён'); };
document.getElementById('loadPresetBtn').onclick = () => document.getElementById('loadPresetInput').click();
document.getElementById('loadPresetInput').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { try { applyPreset(JSON.parse(ev.target.result)); } catch (e) { alert('Ошибка загрузки'); } }; r.readAsText(f); };

// --- Фоновое изображение ---
const bgInput = document.getElementById('bgImageInput');
const clearBgBtn = document.getElementById('clearBgBtn');
bgInput.addEventListener('change', e => {
    if (e.target.files[0]) {
        const img = new Image();
        img.onload = () => { backgroundImageEl = img; generateOverlayTexture(); clearBgBtn.classList.remove('hidden'); };
        img.src = URL.createObjectURL(e.target.files[0]);
    }
});
clearBgBtn.addEventListener('click', () => { backgroundImageEl = null; clearBgBtn.classList.add('hidden'); generateOverlayTexture(); });
document.getElementById('bgOpacity')?.addEventListener('input', () => generateOverlayTexture());

async function generateOverlayTexture() {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    if (backgroundImageEl) {
        const bgOpacity = parseFloat(document.getElementById('bgOpacity').value);
        ctx.globalAlpha = bgOpacity;
        const ratio = Math.max(size / backgroundImageEl.width, size / backgroundImageEl.height);
        const dx = (size - backgroundImageEl.width * ratio) / 2;
        const dy = (size - backgroundImageEl.height * ratio) / 2;
        ctx.drawImage(backgroundImageEl, 0, 0, backgroundImageEl.width, backgroundImageEl.height, dx, dy, backgroundImageEl.width * ratio, backgroundImageEl.height * ratio);
        ctx.globalAlpha = 1.0;
    }
    const syncRotation = uniforms.uRotation.value;
    const syncOffsetX = uniforms.uOffset.value.x;
    const syncOffsetY = uniforms.uOffset.value.y;
    const syncMirror = uniforms.uMirror.value;
    for (const layer of layers) {
        ctx.save();
        let rot = layer.rotation;
        let offX = layer.x;
        let offY = layer.y;
        let mirror = layer.mirror || 0;
        if (layer.syncWithPattern) {
            rot = syncRotation;
            offX = syncOffsetX;
            offY = syncOffsetY;
            mirror = syncMirror;
        }
        ctx.translate(size / 2, size / 2);
        ctx.rotate(rot * Math.PI / 180);
        if (layer.syncWithPattern) ctx.translate(offX * size, offY * size);
        else ctx.translate((offX - 0.5) * size, (offY - 0.5) * size);
        if (mirror === 1 || mirror === 3) ctx.scale(-1, 1);
        if (mirror === 2 || mirror === 3) ctx.scale(1, -1);
        ctx.scale(layer.scale, layer.scale);
        const img = layer.imgElement;
        const w = img.width, h = img.height;
        const tileX = Math.max(1, layer.tileX || 1), tileY = Math.max(1, layer.tileY || 1);
        ctx.globalAlpha = layer.opacity;
        if (tileX === 1 && tileY === 1) ctx.drawImage(img, -w / 2, -h / 2, w, h);
        else {
            for (let ty = -tileY / 2; ty <= tileY / 2; ty++)
                for (let tx = -tileX / 2; tx <= tileX / 2; tx++)
                    ctx.drawImage(img, tx * w, ty * h, w, h);
        }
        ctx.restore();
    }
    if (overlayTexture) overlayTexture.dispose();
    overlayTexture = new THREE.CanvasTexture(canvas);
    overlayTexture.wrapS = THREE.RepeatWrapping;
    overlayTexture.wrapT = THREE.RepeatWrapping;
    uniforms.uOverlayTexture.value = overlayTexture;
    uniforms.uUseOverlay.value = (layers.length > 0 || backgroundImageEl) ? 1 : 0;
    update2DRenderAndTexture();
}

const overlayLayersDiv = document.getElementById('overlayLayersList');
function updateLayersUI() {
    overlayLayersDiv.innerHTML = '';
    layers.forEach(layer => {
        const div = document.createElement('div'); div.className = `layer-item ${selectedLayerId === layer.id ? 'selected' : ''}`;
        const header = document.createElement('div'); header.className = 'layer-header';
        const thumb = document.createElement('img'); thumb.className = 'layer-thumb'; thumb.src = layer.imgElement.src;
        const nameSpan = document.createElement('span'); nameSpan.className = 'layer-name'; nameSpan.textContent = layer.name;
        const controls = document.createElement('div'); controls.className = 'layer-controls';
        const delBtn = document.createElement('button'); delBtn.textContent = '🗑'; delBtn.title = 'Удалить';
        delBtn.onclick = (e) => { e.stopPropagation(); deleteLayerById(layer.id); };
        controls.appendChild(delBtn);
        header.appendChild(thumb); header.appendChild(nameSpan); header.appendChild(controls);
        div.appendChild(header);
        const extraDiv = document.createElement('div'); extraDiv.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; margin-top:6px;';
        const scaleRow = document.createElement('div'); scaleRow.innerHTML = `<span>Масштаб:</span><input type="range" min="0.1" max="2.0" step="0.01" value="${layer.scale}" style="width:80px;"><span>${layer.scale.toFixed(2)}</span>`;
        scaleRow.querySelector('input').addEventListener('input', (e) => { layer.scale = parseFloat(e.target.value); scaleRow.querySelector('span:last-child').innerText = layer.scale.toFixed(2); generateOverlayTexture(); });
        extraDiv.appendChild(scaleRow);
        const syncRow = document.createElement('div'); syncRow.innerHTML = `<input type="checkbox" ${layer.syncWithPattern ? 'checked' : ''}> Синхр. с генерацией`;
        syncRow.querySelector('input').addEventListener('change', (e) => { layer.syncWithPattern = e.target.checked; generateOverlayTexture(); });
        extraDiv.appendChild(syncRow);
        const tileRow = document.createElement('div'); tileRow.innerHTML = `Повтор X:<input type="number" min="1" max="10" value="${layer.tileX || 1}" style="width:55px;"> Y:<input type="number" min="1" max="10" value="${layer.tileY || 1}" style="width:55px;">`;
        tileRow.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => { layer.tileX = parseInt(tileRow.children[1].value) || 1; layer.tileY = parseInt(tileRow.children[3].value) || 1; generateOverlayTexture(); }));
        extraDiv.appendChild(tileRow);
        div.appendChild(extraDiv);
        div.addEventListener('click', (e) => { if (!e.target.closest('.layer-controls')) selectLayer(layer.id); });
        overlayLayersDiv.appendChild(div);
    });
    const layer = layers.find(l => l.id === selectedLayerId);
    if (layer) document.getElementById('layerOpacity').value = layer.opacity;
}
function selectLayer(id) { selectedLayerId = id; updateLayersUI(); }
function deleteLayerById(id) { layers = layers.filter(l => l.id !== id); if (selectedLayerId === id) selectedLayerId = null; generateOverlayTexture(); updateLayersUI(); }
document.getElementById('addOverlayBtn').onclick = () => document.getElementById('multiTextureInput').click();
document.getElementById('clearOverlayBtn').onclick = () => { layers = []; selectedLayerId = null; generateOverlayTexture(); updateLayersUI(); };
document.getElementById('layerOpacity').addEventListener('input', (e) => { if (selectedLayerId) { const l = layers.find(l => l.id === selectedLayerId); if (l) { l.opacity = parseFloat(e.target.value); generateOverlayTexture(); updateLayersUI(); } } });
document.getElementById('multiTextureInput').addEventListener('change', async (e) => {
    for (const file of e.target.files) {
        const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = URL.createObjectURL(file); });
        layers.push({ id: Math.random().toString(36), imgElement: img, name: file.name, x: 0.5, y: 0.5, scale: 0.4, rotation: 0, mirror: 0, opacity: 1, syncWithPattern: false, tileX: 1, tileY: 1 });
        selectLayer(layers[layers.length - 1].id);
    }
    generateOverlayTexture(); updateLayersUI();
    e.target.value = '';
});

// --- Drag & drop слоёв на 2D канвасе ---
const canvas2dElem = renderer2d.domElement;
canvas2dElem.style.cursor = 'crosshair';
function getCanvasCoords(e) {
    const rect = canvas2dElem.getBoundingClientRect();
    const scaleX = canvas2dElem.width / rect.width;
    const scaleY = canvas2dElem.height / rect.height;
    let cx = (e.clientX - rect.left) * scaleX, cy = (e.clientY - rect.top) * scaleY;
    return { x: Math.min(1, Math.max(0, cx / canvas2dElem.width)), y: Math.min(1, Math.max(0, cy / canvas2dElem.height)) };
}
function findLayerUnderPointer(uv) {
    for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        let dx = uv.x - l.x, dy = uv.y - l.y;
        const ang = -l.rotation * Math.PI / 180;
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
        const hw = (l.imgElement.width / 1024) * l.scale * 0.5, hh = (l.imgElement.height / 1024) * l.scale * 0.5;
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return l;
    }
    return null;
}
canvas2dElem.addEventListener('mousedown', (e) => {
    const uv = getCanvasCoords(e);
    const layer = findLayerUnderPointer(uv);
    if (layer) { selectLayer(layer.id); isDraggingLayer = true; dragStart = { x: uv.x, y: uv.y, layerX: layer.x, layerY: layer.y }; canvas2dElem.style.cursor = 'grabbing'; e.preventDefault(); }
    else selectLayer(null);
});
window.addEventListener('mousemove', (e) => {
    if (!isDraggingLayer || !selectedLayerId) return;
    const uv = getCanvasCoords(e);
    const layer = layers.find(l => l.id === selectedLayerId);
    if (layer) {
        let nx = dragStart.layerX + (uv.x - dragStart.x), ny = dragStart.layerY + (uv.y - dragStart.y);
        layer.x = Math.min(1, Math.max(0, nx)); layer.y = Math.min(1, Math.max(0, ny));
        generateOverlayTexture(); updateLayersUI();
    }
});
window.addEventListener('mouseup', () => { isDraggingLayer = false; canvas2dElem.style.cursor = 'crosshair'; });
canvas2dElem.addEventListener('wheel', (e) => {
    if (!selectedLayerId) return;
    const layer = layers.find(l => l.id === selectedLayerId);
    if (layer) {
        if (e.ctrlKey) layer.rotation = (layer.rotation + (e.deltaY > 0 ? -5 : 5)) % 360;
        else { layer.scale = Math.min(2, Math.max(0.1, layer.scale + (e.deltaY > 0 ? -0.05 : 0.05))); }
        generateOverlayTexture(); updateLayersUI();
        e.preventDefault();
    }
});

async function renderPBRMap(res, type) {
    const tuni = JSON.parse(JSON.stringify(uniforms));
    tuni.uUseOverlay = { value: 0 }; tuni.uShowRelief = { value: 0 };
    if (type === 'normal') { tuni.uColorsCount = { value: 2 }; tuni.uColor0 = { value: new THREE.Vector3(0.5, 0.5, 1.0) }; tuni.uColor1 = { value: new THREE.Vector3(1.0, 0.5, 0.5) }; }
    else { tuni.uColorsCount = { value: 1 }; for (let i = 0; i < 8; i++) tuni[`uColor${i}`] = { value: new THREE.Vector3(1, 1, 1) }; }
    const sc = new THREE.Scene(); const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); cam.position.z = 1;
    const mat = new THREE.ShaderMaterial({ uniforms: tuni, vertexShader, fragmentShader });
    sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    const r = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    r.setSize(res, res); r.render(sc, cam);
    const blob = await new Promise(resolve => r.domElement.toBlob(resolve, 'image/png'));
    r.dispose(); mat.dispose();
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
        const a = document.createElement('a'); a.href = URL.createObjectURL(content); a.download = `pbr_${res}.zip`; a.click();
    } else if (format === 'svg') {
        const imgData = renderer2d.domElement.toDataURL('image/png');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${res}" height="${res}" viewBox="0 0 ${res} ${res}"><image width="${res}" height="${res}" href="${imgData}"/></svg>`;
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `texture.svg`; a.click();
    } else {
        const canvas = renderer2d.domElement;
        const exportCanvas = document.createElement('canvas'); exportCanvas.width = res; exportCanvas.height = res;
        exportCanvas.getContext('2d').drawImage(canvas, 0, 0, res, res);
        exportCanvas.toBlob(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `texture.${format}`; a.click(); }, format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
    }
});
document.getElementById('exportModelBtn').addEventListener('click', async () => {
    const format = document.getElementById('exportModelFormat').value;
    if (!current3DMaterial || !texture3D) return;
    const exportScene = new THREE.Scene();
    let modelClone;
    if (customModel) modelClone = customModel.clone();
    else {
        let geom;
        if (currentGeometryType === 'cube') geom = new THREE.BoxGeometry(1.2, 1.2, 1.2);
        else if (currentGeometryType === 'torus') geom = new THREE.TorusKnotGeometry(0.85, 0.22, 200, 32, 3, 4);
        else if (currentGeometryType === 'sphere') geom = new THREE.SphereGeometry(0.9, 128, 128);
        else geom = new THREE.CylinderGeometry(0.8, 0.8, 1.2, 64);
        modelClone = new THREE.Mesh(geom, current3DMaterial.clone());
    }
    exportScene.add(modelClone);
    if (format === 'glb') {
        new GLTFExporter().parse(exportScene, result => { const blob = new Blob([result], { type: 'application/octet-stream' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'model.glb'; a.click(); }, { binary: true });
    } else if (format === 'gltf') {
        new GLTFExporter().parse(exportScene, result => { const blob = new Blob([JSON.stringify(result)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'model.gltf'; a.click(); });
    } else if (format === 'obj') {
        const exporter = new OBJExporter();
        const obj = exporter.parse(exportScene);
        const mtl = `newmtl material0\nmap_Kd texture.png\n`;
        const zip = new JSZip();
        zip.file("model.obj", obj);
        zip.file("model.mtl", mtl);
        const textureBlob = await new Promise(r => renderer2d.domElement.toBlob(r, 'image/png'));
        zip.file("texture.png", textureBlob);
        const content = await zip.generateAsync({ type: "blob" });
        const a = document.createElement('a'); a.href = URL.createObjectURL(content); a.download = 'model_obj.zip'; a.click();
    }
});

function animate() {
    requestAnimationFrame(animate);
    controls3d.update();
    renderer3d.render(scene3d, camera3d);
   uniforms.uTime.value += 0.01;
}
animate();

update2DRenderAndTexture();
update3DMaterial();
generateOverlayTexture();

const allInputs = ['scale', 'intensity', 'octaves', 'persistence', 'lacunarity', 'saturation', 'blendMode', 'rotate', 'offsetX', 'offsetY', 'mirror', 'warpStrength', 'warpOctaves', 'reliefStrength', 'metallic', 'roughness', 'tile3dScale', 'warpEnable', 'relief2d'];
allInputs.forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', updateUniformsFromUI); });

function updateSizes() {
    const rect2d = container2d.parentElement.getBoundingClientRect();
    let sz = Math.min(rect2d.width, rect2d.height);
    if (sz <= 0) sz = 256;
    renderer2d.setSize(sz, sz);
    const w3 = container3d.clientWidth, h3 = container3d.clientHeight;
    if (w3 && h3) { renderer3d.setSize(w3, h3); camera3d.aspect = w3 / h3; camera3d.updateProjectionMatrix(); }
}
new ResizeObserver(() => updateSizes()).observe(container3d);
new ResizeObserver(() => updateSizes()).observe(container2d.parentElement);
window.addEventListener('resize', updateSizes);
updateSizes();
