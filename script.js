import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

// --- Инициализация ---
const container2d = document.getElementById('canvas2d');
const container3d = document.getElementById('canvas3d');

// 2D сцена
const scene2d = new THREE.Scene();
scene2d.background = null;
const camera2d = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera2d.position.z = 1;
const renderer2d = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer2d.setClearColor(0x000000, 0);
container2d.appendChild(renderer2d.domElement);

// 3D сцена 
const scene3d = new THREE.Scene();
scene3d.background = new THREE.Color(0xffffff);
const camera3d = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera3d.position.set(3.5, 3.0, 4.5); // увеличенный зум
const renderer3d = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer3d.setClearColor(0xffffff);
container3d.appendChild(renderer3d.domElement);

const offscreenRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });

// Освещение 
const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
scene3d.add(ambientLight);
const mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
mainLight.position.set(2, 3, 2);
scene3d.add(mainLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
fillLight.position.set(-1, 1, 1.5);
scene3d.add(fillLight);
const backLight = new THREE.DirectionalLight(0xffffff, 0.6);
backLight.position.set(0, 1, -2);
scene3d.add(backLight);

function updateLightIntensity(val) {
  mainLight.intensity = val;
  fillLight.intensity = val * 0.6;
  backLight.intensity = val * 0.4;
}

// --- Общие переменные ---
let currentMesh3d = null;
let currentGeometryType = 'cube';
let customModel = null;
let overlayTexture = null;
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
let overlayDirty = true;
let overlayTimeout = null;
let pbrTimeout = null;
let pbrReady = false;

// Uniform'ы
const uniforms = {
  uScale: { value: 0.8 },
  uIntensity: { value: 1.0 },
  uPatternType: { value: 2 },
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
  uExportMode: { value: 0 },
  uNormalStrength: { value: 1.0 },
  uRoughnessContrast: { value: 1.5 },
  uMetalThreshold: { value: 0.4 },
  uMetalScale: { value: 2.0 },
  uMetalBias: { value: 0.0 },
  uTexelSize: { value: new THREE.Vector2(1/512, 1/512) },
  uIsExportingModel: { value: 0 }
};

function updateColorUniforms() {
  const last = activeColors[activeColors.length - 1] || new THREE.Color(1, 1, 1);
  for (let i = 0; i < 8; i++) {
    const c = i < activeColors.length ? activeColors[i] : last;
    uniforms[`uColor${i}`].value.set(c.r, c.g, c.b);
  }
  uniforms.uColorsCount.value = activeColors.length;
}
updateColorUniforms();

//  Шейдер  
const vertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = `
  precision highp float;
  uniform float uScale;
  uniform float uIntensity;
  uniform int uPatternType;
  uniform vec3 uColor0, uColor1, uColor2, uColor3, uColor4, uColor5, uColor6, uColor7;
  uniform int uColorsCount;
  uniform float uSaturation;
  uniform int uBlendMode;
  uniform float uRotation;
  uniform vec2 uOffset;
  uniform int uMirror;
  uniform int uOctaves;
  uniform float uPersistence;
  uniform float uLacunarity;
  uniform int uTileEnabled;
  uniform sampler2D uOverlayTexture;
  uniform int uUseOverlay;
  uniform int uWarpEnable;
  uniform float uWarpStrength;
  uniform int uWarpOctaves;
  uniform int uShowRelief;
  uniform float uReliefStrength;
  uniform int uExportMode;
  uniform float uNormalStrength;
  uniform float uRoughnessContrast;
  uniform float uMetalThreshold;
  uniform float uMetalScale;
  uniform float uMetalBias;
  uniform vec2 uTexelSize;
  uniform int uIsExportingModel;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vNormalW;

  float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
  vec2 hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(vec2(p.x * p.y, p.y * p.x)) * 2.0 - 1.0; }
  float perlinNoise(vec2 st) { vec2 i = floor(st); vec2 f = fract(st); vec2 u = f * f * (3.0 - 2.0 * f); vec2 grad00 = hash(i); vec2 grad10 = hash(i + vec2(1.0, 0.0)); vec2 grad01 = hash(i + vec2(0.0, 1.0)); vec2 grad11 = hash(i + vec2(1.0, 1.0)); float dot00 = dot(grad00, f); float dot10 = dot(grad10, f - vec2(1.0, 0.0)); float dot01 = dot(grad01, f - vec2(0.0, 1.0)); float dot11 = dot(grad11, f - vec2(1.0, 1.0)); return mix(mix(dot00, dot10, u.x), mix(dot01, dot11, u.x), u.y) * 0.5 + 0.5; }
  float fbmPerlin(vec2 st, int oct, float pers, float lac) { float val = 0.0, amp = 0.5, freq = 2.0; for(int i=0; i<6; i++) { if(i >= oct) break; val += amp * (perlinNoise(st * freq) * 2.0 - 1.0); amp *= pers; freq *= lac; } return val * 0.5 + 0.5; }
  float worley(vec2 uv) { vec2 p = floor(uv); vec2 f = fract(uv); float res = 1.0; for(int j=-1; j<=1; j++) for(int i=-1; i<=1; i++) { vec2 b = vec2(float(i), float(j)); vec2 r = b - f + random(p + b); res = min(res, dot(r,r)); } return sqrt(res); }
  float truchetPattern(vec2 uv) { uv = fract(uv * 3.0) - 0.5; float angle = sin(uv.x * 10.0) * cos(uv.y * 10.0); return step(length(uv), 0.4 + 0.2 * sin(angle * 20.0)); }
  vec2 domainWarp(vec2 uv, float strength, int octaves) { vec2 warped = uv; for(int i=0; i<octaves; i++) { warped += strength * vec2(sin(warped.y * 3.14159 * 2.0 * float(i+1)), cos(warped.x * 3.14159 * 2.0 * float(i+1))); } return warped; }
  float reactionDiffusion(vec2 uv) { vec2 p = uv * 4.0; float a = sin(p.x * 3.0) * cos(p.y * 3.0); float b = cos(p.x * 4.2) * sin(p.y * 4.2); return clamp(a * 0.5 + b * 0.5 + 0.5, 0.0, 1.0); }
  float flowField(vec2 uv) { vec2 q = uv * 3.0; float angle = sin(q.y * 0.7) * cos(q.x * 0.5); vec2 gradient = vec2(cos(angle), sin(angle)); uv += gradient * 0.1; float field = sin(uv.x * 10.0) * cos(uv.y * 10.0); return smoothstep(-0.3, 0.7, field); }
  float wfcPattern(vec2 uv) { vec2 tile = floor(uv * 8.0); float hashVal = random(tile); int rule = int(floor(hashVal * 6.0)); vec2 sub = fract(uv * 8.0); if(rule == 0) return step(0.5, sub.x) * step(0.5, sub.y); else if(rule == 1) return step(0.5, sub.x + sub.y); else if(rule == 2) return step(0.5, sub.x - sub.y + 0.5); else if(rule == 3) return sin(sub.x * 3.14159 * 4.0) * 0.5 + 0.5; else if(rule == 4) return (sub.x > 0.25 && sub.x < 0.75 && sub.y > 0.25 && sub.y < 0.75) ? 1.0 : 0.0; else return fract(sub.x * 3.0 + sub.y * 2.0); }
  float ridgedMF(vec2 uv, int oct, float pers, float lac) { float val = 0.0, amp = 0.5, freq = 2.0; for(int i=0; i<6; i++) { if(i >= oct) break; float n = perlinNoise(uv * freq) * 2.0 - 1.0; n = 1.0 - abs(n); val += amp * n; amp *= pers; freq *= lac; } return clamp(val, 0.0, 1.0); }
  float checker(vec2 uv, float freq) { vec2 p = floor(uv * freq); return mod(p.x + p.y, 2.0); }
  float stripes(vec2 uv, float freq) { return step(0.5, fract(uv.x * freq)); }
  float circles(vec2 uv, float freq) { vec2 c = vec2(0.5); return fract(length(uv - c) * freq * 2.0); }
  float grid(vec2 uv, float freq) { vec2 g = fract(uv * freq); return max(step(0.92, g.x), step(0.92, g.y)); }
  float tiles(vec2 uv, float freq) { vec2 f = fract(uv * freq); float line = step(0.75, f.x) + step(0.75, f.y); return clamp(1.0 - line, 0.0, 1.0); }
  float wood(vec2 uv, float freq) { vec2 c = vec2(0.5); float dist = length(uv - c) * 2.0; return clamp(sin(dist * freq * 12.0 + sin(uv.x * 8.0) * 1.5) * 0.5 + 0.5, 0.0, 1.0); }
  float marble(vec2 uv, float freq) { float noise = fbmPerlin(uv * freq * 3.0, 4, 0.6, 2.0); return clamp(sin((uv.x * freq * 5.0 + noise * 3.0) * 3.14159) * 0.6 + 0.5, 0.0, 1.0); }
  float linearGradient(vec2 uv) { return uv.x; }
  float radialGradient(vec2 uv) { return length(uv - 0.5) * 1.414; }
  float angularGradient(vec2 uv) { return atan(uv.y - 0.5, uv.x - 0.5) / (2.0 * 3.14159) + 0.5; }

  vec3 getColor(float t) {
    if (uColorsCount <= 1) return uColor0;
    float seg = 1.0 / float(uColorsCount - 1);
    float clamped = clamp(t, 0.0, 1.0);
    int idx = int(floor(clamped / seg));
    if (idx < 0) idx = 0;
    if (idx >= uColorsCount - 1) idx = uColorsCount - 2;
    float local = (clamped - float(idx) * seg) / seg;
    vec3 c1, c2;
    if (idx == 0) { c1 = uColor0; c2 = uColor1; }
    else if (idx == 1) { c1 = uColor1; c2 = uColor2; }
    else if (idx == 2) { c1 = uColor2; c2 = uColor3; }
    else if (idx == 3) { c1 = uColor3; c2 = uColor4; }
    else if (idx == 4) { c1 = uColor4; c2 = uColor5; }
    else if (idx == 5) { c1 = uColor5; c2 = uColor6; }
    else { c1 = uColor6; c2 = uColor7; }
    return mix(c1, c2, local);
  }

  float compute2DPattern(vec2 uv) {
    float angle = uRotation * 3.14159 / 180.0;
    vec2 centered = uv - 0.5;
    vec2 rotated = vec2(centered.x * cos(angle) - centered.y * sin(angle), centered.x * sin(angle) + centered.y * cos(angle));
    uv = rotated + 0.5 + uOffset;
    if(uMirror == 1) uv.x = 1.0 - uv.x;
    else if(uMirror == 2) uv.y = 1.0 - uv.y;
    else if(uMirror == 3) { uv.x = 1.0 - uv.x; uv.y = 1.0 - uv.y; }
    if(uTileEnabled == 1) uv = fract(uv);
    vec2 st = uv * uScale;
    if(uWarpEnable == 1) st = domainWarp(st, uWarpStrength, uWarpOctaves);
    if(uPatternType == 0) { float w1 = sin(st.x * 8.0) * cos(st.y * 8.0); float w2 = sin(st.y * 12.0 + st.x * 5.0); return clamp((w1 + w2) * 0.6 + 0.5, 0.0, 1.0) * uIntensity; }
    else if(uPatternType == 1) { float v = worley(st * 3.5); v = pow(v * 1.2, 0.8); return clamp(v * uIntensity, 0.0, 1.0); }
    else if(uPatternType == 2) return clamp(fbmPerlin(st, uOctaves, uPersistence, uLacunarity) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 4) return clamp(random(st) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 5) return clamp(reactionDiffusion(st) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 6) return clamp(wfcPattern(st) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 7) return clamp(flowField(st) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 12) return clamp(ridgedMF(st, uOctaves, uPersistence, uLacunarity) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 8) return clamp(checker(st, 4.0) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 9) return clamp(stripes(st, 6.0) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 10) return clamp(circles(st, 3.0) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 11) return clamp(grid(st, 6.0) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 14) return clamp(wood(st, 0.8) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 15) return clamp(marble(st, 1.2) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 16) return clamp(tiles(st, 5.0) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 17) return clamp(linearGradient(uv) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 18) return clamp(radialGradient(uv) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 19) return clamp(angularGradient(uv) * uIntensity, 0.0, 1.0);
    else if(uPatternType == 3) return clamp(truchetPattern(st * 3.0) * uIntensity, 0.0, 1.0);
    else return clamp(fbmPerlin(st, uOctaves, uPersistence, uLacunarity) * uIntensity, 0.0, 1.0);
  }

  void main() {
    bool useTriplanar = (uIsExportingModel == 1) || (uExportMode == 0);
    float patternValue;
    if (useTriplanar) {
      vec3 blend = abs(vNormalW);
      blend = pow(blend, vec3(2.0));
      blend /= (blend.x + blend.y + blend.z);
      vec2 uvX = vWorldPosition.yz * 0.8;
      vec2 uvY = vWorldPosition.xz * 0.8;
      vec2 uvZ = vWorldPosition.xy * 0.8;
      float patX = compute2DPattern(uvX);
      float patY = compute2DPattern(uvY);
      float patZ = compute2DPattern(uvZ);
      patternValue = patX * blend.x + patY * blend.y + patZ * blend.z;
    } else {
      patternValue = compute2DPattern(vUv);
    }

    float height = patternValue;
    vec2 texel = uTexelSize;
    float hL = compute2DPattern(vUv - vec2(texel.x, 0.0));
    float hR = compute2DPattern(vUv + vec2(texel.x, 0.0));
    float hD = compute2DPattern(vUv - vec2(0.0, texel.y));
    float hU = compute2DPattern(vUv + vec2(0.0, texel.y));
    vec3 grad = vec3(hR - hL, hU - hD, 0.0);
    vec3 normalTS = normalize(vec3(-grad.x * uNormalStrength, -grad.y * uNormalStrength, 1.0));

    if (uExportMode == 1) { gl_FragColor = vec4(normalTS * 0.5 + 0.5, 1.0); return; }
    if (uExportMode == 2) { float r = 1.0 - pow(patternValue, uRoughnessContrast); r = clamp(r, 0.04, 0.96); gl_FragColor = vec4(r, r, r, 1.0); return; }
    if (uExportMode == 3) {
      float m = clamp((patternValue - uMetalThreshold) * uMetalScale + uMetalBias, 0.0, 1.0);
      gl_FragColor = vec4(m, m, m, 1.0);
      return;
    }
    if (uExportMode == 4) { gl_FragColor = vec4(height, height, height, 1.0); return; }
    if (uExportMode == 5) {
      float h1 = compute2DPattern(vUv + texel);
      float h2 = compute2DPattern(vUv + vec2(-texel.x, texel.y));
      float h3 = compute2DPattern(vUv + vec2(texel.x, -texel.y));
      float h4 = compute2DPattern(vUv - texel);
      float cavity = max(max(h1, h2), max(h3, h4)) - height;
      float ao = clamp(1.0 - cavity * 2.0, 0.2, 1.0);
      gl_FragColor = vec4(ao, ao, ao, 1.0);
      return;
    }

    vec3 color = getColor(patternValue);
    float gray = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(gray), color, uSaturation);
    if(uBlendMode == 1) color *= patternValue;
    vec3 finalColor = color;
    if(uUseOverlay == 1) {
      vec4 overlay = texture2D(uOverlayTexture, vUv);
      if(overlay.a > 0.01) finalColor = mix(finalColor, overlay.rgb, overlay.a);
    }
    if(uShowRelief == 1) {
      vec3 normal = normalize(vec3(-grad.x * uReliefStrength, -grad.y * uReliefStrength, 1.0));
      vec3 lightDir = normalize(vec3(0.8, 1.0, 0.3));
      float diff = max(0.3, dot(normal, lightDir));
      finalColor *= (0.6 + diff * 0.5);
    }
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

const previewMaterial = new THREE.ShaderMaterial({
  uniforms: uniforms,
  vertexShader: vertexShader,
  fragmentShader: fragmentShader,
  side: THREE.DoubleSide
});

const plane2d = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), previewMaterial);
scene2d.add(plane2d);

const defaultGeom = new THREE.BoxGeometry(1.2, 1.2, 1.2);
const defaultMesh = new THREE.Mesh(defaultGeom, previewMaterial);
scene3d.add(defaultMesh);
currentMesh3d = defaultMesh;

const controls3d = new OrbitControls(camera3d, renderer3d.domElement);
controls3d.enableDamping = true;
controls3d.enableZoom = true;
controls3d.zoomSpeed = 1.2;
controls3d.panSpeed = 0.8;
controls3d.rotateSpeed = 1.0;
controls3d.target.set(0, 0, 0);

function renderAll() {
  renderer2d.render(scene2d, camera2d);
  renderer3d.render(scene3d, camera3d);
}
controls3d.addEventListener('change', () => renderAll());

function updateSizes() {
  const rect2d = container2d.parentElement.getBoundingClientRect();
  let size2d = Math.min(rect2d.width, rect2d.height);
  if (size2d <= 0) size2d = 256;
  renderer2d.setSize(size2d, size2d);
  const w3 = container3d.clientWidth;
  const h3 = container3d.clientHeight;
  if (w3 && h3) {
    renderer3d.setSize(w3, h3);
    camera3d.aspect = w3 / h3;
    camera3d.updateProjectionMatrix();
    controls3d.update();
    renderAll();
  }
}
new ResizeObserver(() => updateSizes()).observe(container3d);
new ResizeObserver(() => updateSizes()).observe(container2d.parentElement);
window.addEventListener('resize', updateSizes);
setTimeout(updateSizes, 100);
updateSizes();

function fitCameraToObject(object, camera, controls, offset = 1.9) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraZ = (maxDim / 2) / Math.tan(fov / 2);
  cameraZ *= offset;
  camera.position.set(center.x, center.y, center.z + cameraZ);
  controls.target.copy(center);
  controls.update();
  renderAll();
}

function update3dModel() {
  if (currentMesh3d) scene3d.remove(currentMesh3d);
  if (customModel) {
    customModel.traverse(c => { if (c.isMesh) c.material = previewMaterial; });
    scene3d.add(customModel);
    currentMesh3d = customModel;
  } else {
    let geom;
    if (currentGeometryType === 'cube') geom = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    else if (currentGeometryType === 'torus') geom = new THREE.TorusKnotGeometry(0.9, 0.25, 200, 32, 3, 4);
    else if (currentGeometryType === 'sphere') geom = new THREE.SphereGeometry(1.0, 128, 128);
    else geom = new THREE.CylinderGeometry(0.9, 0.9, 1.2, 64);
    currentMesh3d = new THREE.Mesh(geom, previewMaterial);
    scene3d.add(currentMesh3d);
  }
  fitCameraToObject(currentMesh3d, camera3d, controls3d, 1.9);
}

// --- Загрузка пользовательской модели ---
document.getElementById('modelFileInput').addEventListener('change', e => {
  if (!e.target.files[0]) return;
  const url = URL.createObjectURL(e.target.files[0]);
  new GLTFLoader().load(url, gltf => {
    if (currentMesh3d) scene3d.remove(currentMesh3d);
    customModel = gltf.scene;
    const box = new THREE.Box3().setFromObject(customModel);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scl = 1.2 / maxDim;
    customModel.scale.set(scl, scl, scl);
    customModel.position.copy(center.clone().negate().multiplyScalar(scl));
    customModel.traverse(c => { if (c.isMesh) c.material = previewMaterial; });
    update3dModel();
    URL.revokeObjectURL(url);
    document.getElementById('modelStatus').textContent = 'Модель загружена';
    setTimeout(() => document.getElementById('modelStatus').textContent = '', 2000);
  }, undefined, () => {
    document.getElementById('modelStatus').textContent = 'Ошибка загрузки';
  });
});

// --- Категории паттернов ---
const noisePatterns = [{name:"Волны",v:0},{name:"Перлин",v:2},{name:"Вороного",v:1}];
const fractalPatterns = [{name:"Реакция-диффузия",v:5},{name:"Потоковое поле",v:7},{name:"WFC",v:6},{name:"Гребневый мультифрактал",v:12}];
const gradientPatterns = [{name:"Линейный градиент",v:17},{name:"Радиальный градиент",v:18},{name:"Угловой градиент",v:19}];
const geometricPatterns = [{name:"Шахматная доска",v:8},{name:"Полосы",v:9},{name:"Концентрические круги",v:10},{name:"Сетка",v:11},{name:"Плитка",v:16},{name:"Древесина",v:14},{name:"Мрамор",v:15},{name:"Truchet",v:3}];
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
    if (window.innerWidth <= 860) closeMenu();
  });
}
populateSelect('selectNoise', noisePatterns, 2);
populateSelect('selectFractal', fractalPatterns, 5);
populateSelect('selectGradient', gradientPatterns, 17);
populateSelect('selectGeometric', geometricPatterns, 8);

// --- Обновление uniform из UI ---
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
  uniforms.uNormalStrength.value = parseFloat(document.getElementById('normalStrength').value);
  uniforms.uRoughnessContrast.value = parseFloat(document.getElementById('roughnessContrast').value);
  uniforms.uMetalThreshold.value = parseFloat(document.getElementById('metalThreshold').value);
  uniforms.uMetalScale.value = parseFloat(document.getElementById('metalScale').value);
  uniforms.uMetalBias.value = 0.0;
  
  const ids = ['scale','octaves','persistence','lacunarity','saturation','rotate','offsetX','offsetY','warpStrength','warpOctaves','reliefStrength','intensity','normalStrength','roughnessContrast','metalThreshold','metalScale'];
  ids.forEach(id => {
    const el = document.getElementById(id + 'Val');
    if (el) el.innerText = parseFloat(document.getElementById(id).value).toFixed(2);
  });
  document.getElementById('rotateVal').innerText = uniforms.uRotation.value + '°';
  // отложенный вызов оверлея, чтобы не тормозить
  if (layers.some(l => l.syncWithPattern)) {
    if (overlayTimeout) clearTimeout(overlayTimeout);
    overlayTimeout = setTimeout(() => generateOverlayTexture(), 100);
  }
  schedulePBRUpdate();
  renderAll();
}

const controlIds = ['scale','octaves','persistence','lacunarity','saturation','blendMode','rotate','offsetX','offsetY','mirror','warpStrength','warpOctaves','reliefStrength','intensity','normalStrength','roughnessContrast','metalThreshold','metalScale'];
controlIds.forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateUniformsFromUI);
});
document.getElementById('warpEnable')?.addEventListener('change', updateUniformsFromUI);
document.getElementById('relief2d')?.addEventListener('change', updateUniformsFromUI);
document.getElementById('geometrySelect')?.addEventListener('change', e => {
  customModel = null;
  currentGeometryType = e.target.value;
  update3dModel();
});
document.getElementById('lightIntensity')?.addEventListener('input', e => {
  const val = parseFloat(e.target.value);
  document.getElementById('lightIntensityVal').innerText = val.toFixed(2);
  updateLightIntensity(val);
  renderAll();
});

// --- Цвета ---
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
      renderAll();
    });
    div.appendChild(colorInput);
    if (activeColors.length > 2) {
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✕';
      removeBtn.className = 'remove-color-btn';
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        activeColors.splice(idx, 1);
        rebuildColorUI();
        updateColorUniforms();
        renderAll();
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
    renderAll();
  }
});
rebuildColorUI();

// --- Фоновое изображение и оверлей ---
document.getElementById('bgImageInput')?.addEventListener('change', e => {
  if (e.target.files[0]) {
    const img = new Image();
    img.onload = () => {
      backgroundImageEl = img;
      generateOverlayTexture();
    };
    img.src = URL.createObjectURL(e.target.files[0]);
    document.getElementById('clearBgBtn')?.classList.remove('hidden');
  }
});
document.getElementById('clearBgBtn')?.addEventListener('click', () => {
  backgroundImageEl = null;
  document.getElementById('clearBgBtn')?.classList.add('hidden');
  generateOverlayTexture();
});

async function generateOverlayTexture() {
  if (!overlayDirty) return;
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  if (backgroundImageEl) {
    const opacity = parseFloat(document.getElementById('bgOpacity').value);
    ctx.globalAlpha = opacity;
    const ratio = Math.max(size / backgroundImageEl.width, size / backgroundImageEl.height);
    const dx = (size - backgroundImageEl.width * ratio) / 2;
    const dy = (size - backgroundImageEl.height * ratio) / 2;
    ctx.drawImage(backgroundImageEl, 0, 0, backgroundImageEl.width, backgroundImageEl.height, dx, dy, backgroundImageEl.width * ratio, backgroundImageEl.height * ratio);
    ctx.globalAlpha = 1;
  }
  const syncRotation = uniforms.uRotation.value;
  const syncOffsetX = uniforms.uOffset.value.x;
  const syncOffsetY = uniforms.uOffset.value.y;
  const syncMirror = uniforms.uMirror.value;
  for (const layer of layers) {
    ctx.save();
    let rot = layer.rotation, offX = layer.x, offY = layer.y, mirror = layer.mirror || 0;
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
    const tileX = Math.max(1, layer.tileX || 1);
    const tileY = Math.max(1, layer.tileY || 1);
    if (tileX === 1 && tileY === 1) {
      ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
    } else {
      const tileW = img.width;
      const tileH = img.height;
      const neededX = Math.min(20, Math.ceil((size / layer.scale) / tileW) + 2);
      const neededY = Math.min(20, Math.ceil((size / layer.scale) / tileH) + 2);
      const startTX = -Math.floor(neededX / 2);
      const startTY = -Math.floor(neededY / 2);
      for (let ty = 0; ty < neededY; ty++) {
        for (let tx = 0; tx < neededX; tx++) {
          ctx.drawImage(img, (startTX + tx) * tileW, (startTY + ty) * tileH, tileW, tileH);
        }
      }
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (overlayTexture) overlayTexture.dispose?.();
  overlayTexture = texture;
  uniforms.uOverlayTexture.value = overlayTexture;
  uniforms.uUseOverlay.value = (layers.length > 0 || backgroundImageEl) ? 1 : 0;
  const clearBtn = document.getElementById('clearOverlayBtn');
  if (layers.length > 0) clearBtn.classList.remove('hidden');
  else clearBtn.classList.add('hidden');
  overlayDirty = false;
  renderAll();
}

// --- Слои UI ---
const overlayLayersDiv = document.getElementById('overlayLayersList');
const layerOpacitySlider = document.getElementById('layerOpacity');
const layerOpacityVal = document.getElementById('layerOpacityVal');
function updateLayersUI() {
  if (!overlayLayersDiv) return;
  overlayLayersDiv.innerHTML = '';
  layers.forEach(layer => {
    const div = document.createElement('div');
    div.className = `layer-item ${selectedLayerId === layer.id ? 'selected' : ''}`;
    div.dataset.id = layer.id;
    const thumb = document.createElement('img');
    thumb.className = 'layer-thumb';
    thumb.src = layer.imgElement.src;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'layer-name';
    nameSpan.textContent = layer.name;
    const controls = document.createElement('div');
    controls.className = 'layer-controls';
    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑';
    delBtn.title = 'Удалить';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteLayerById(layer.id);
    };
    controls.appendChild(delBtn);
    div.appendChild(thumb);
    div.appendChild(nameSpan);
    div.appendChild(controls);
    const extraDiv = document.createElement('div');
    extraDiv.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; width:100%; align-items:center;';
    const scaleRow = document.createElement('div');
    scaleRow.style.display = 'flex';
    scaleRow.style.alignItems = 'center';
    scaleRow.style.gap = '6px';
    scaleRow.innerHTML = `<span style="font-size:0.7rem;">Масштаб:</span><input type="range" min="0.1" max="2.0" step="0.01" value="${layer.scale}" style="width:80px;"><span style="font-size:0.7rem;">${layer.scale.toFixed(2)}</span>`;
    scaleRow.querySelector('input').addEventListener('input', (e) => {
      layer.scale = parseFloat(e.target.value);
      scaleRow.querySelector('span:last-child').innerText = layer.scale.toFixed(2);
      generateOverlayTexture();
    });
    extraDiv.appendChild(scaleRow);
    const syncRow = document.createElement('div');
    syncRow.style.display = 'flex';
    syncRow.style.alignItems = 'center';
    syncRow.style.gap = '6px';
    const syncCheck = document.createElement('input');
    syncCheck.type = 'checkbox';
    syncCheck.checked = layer.syncWithPattern || false;
    syncCheck.addEventListener('change', () => {
      layer.syncWithPattern = syncCheck.checked;
      generateOverlayTexture();
    });
    syncRow.appendChild(syncCheck);
    syncRow.appendChild(document.createTextNode('Синхр.'));
    extraDiv.appendChild(syncRow);
    const tileRow = document.createElement('div');
    tileRow.style.display = 'flex';
    tileRow.style.alignItems = 'center';
    tileRow.style.gap = '6px';
    tileRow.innerHTML = `<span style="font-size:0.7rem;">Повт X:</span><input type="number" min="1" max="10" step="1" value="${layer.tileX || 1}" style="width:50px;"><span style="font-size:0.7rem;">Y:</span><input type="number" min="1" max="10" step="1" value="${layer.tileY || 1}" style="width:50px;">`;
    const inpX = tileRow.querySelector('input:first-of-type');
    const inpY = tileRow.querySelector('input:last-of-type');
    inpX.addEventListener('change', () => {
      layer.tileX = Math.max(1, parseInt(inpX.value) || 1);
      generateOverlayTexture();
    });
    inpY.addEventListener('change', () => {
      layer.tileY = Math.max(1, parseInt(inpY.value) || 1);
      generateOverlayTexture();
    });
    extraDiv.appendChild(tileRow);
    div.appendChild(extraDiv);
    div.addEventListener('click', (e) => {
      if (!e.target.closest('.layer-controls')) selectLayer(layer.id);
    });
    overlayLayersDiv.appendChild(div);
  });
  if (selectedLayerId && layerOpacitySlider) {
    const layer = layers.find(l => l.id === selectedLayerId);
    if (layer) {
      layerOpacitySlider.value = layer.opacity;
      layerOpacityVal.innerText = layer.opacity.toFixed(2);
    }
  }
}
function selectLayer(id) {
  selectedLayerId = id;
  updateLayersUI();
  renderAll();
}
function deleteLayerById(id) {
  const idx = layers.findIndex(l => l.id === id);
  if (idx !== -1) {
    layers.splice(idx, 1);
    if (selectedLayerId === id) selectedLayerId = null;
    generateOverlayTexture();
    updateLayersUI();
    renderAll();
  }
}
document.getElementById('clearOverlayBtn')?.addEventListener('click', () => {
  layers = [];
  selectedLayerId = null;
  generateOverlayTexture();
  updateLayersUI();
  renderAll();
});
if (layerOpacitySlider) {
  layerOpacitySlider.addEventListener('input', () => {
    if (selectedLayerId) {
      const layer = layers.find(l => l.id === selectedLayerId);
      if (layer) {
        layer.opacity = parseFloat(layerOpacitySlider.value);
        layerOpacityVal.innerText = layer.opacity.toFixed(2);
        generateOverlayTexture();
        updateLayersUI();
        renderAll();
      }
    }
  });
}
async function loadFilesAsLayers(files) {
  for (const file of files) {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = URL.createObjectURL(file);
    });
    layers.push({
      id: Math.random().toString(36) + Date.now(),
      imgElement: img,
      name: file.name,
      x: 0.5,
      y: 0.5,
      scale: 0.4,
      rotation: 0,
      mirror: 0,
      opacity: 1.0,
      syncWithPattern: false,
      tileX: 1,
      tileY: 1,
      width: img.width,
      height: img.height
    });
    selectLayer(layers[layers.length - 1].id);
  }
  generateOverlayTexture();
  updateLayersUI();
  renderAll();
}
document.getElementById('multiTextureInput')?.addEventListener('change', async e => {
  if (e.target.files.length) await loadFilesAsLayers(Array.from(e.target.files));
  e.target.value = '';
});

// --- Drag & Drop на 2D холст ---
const canvas2dElem = renderer2d.domElement;
canvas2dElem.style.cursor = 'crosshair';
canvas2dElem.addEventListener('dragover', e => {
  e.preventDefault();
  canvas2dElem.style.border = '2px dashed #4CC9F0';
});
canvas2dElem.addEventListener('dragleave', () => {
  canvas2dElem.style.border = 'none';
});
canvas2dElem.addEventListener('drop', async e => {
  e.preventDefault();
  canvas2dElem.style.border = 'none';
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (files.length) await loadFilesAsLayers(files);
  renderAll();
});
function getCanvasCoords(e) {
  const rect = canvas2dElem.getBoundingClientRect();
  const scaleX = canvas2dElem.width / rect.width;
  const scaleY = canvas2dElem.height / rect.height;
  let clientX, clientY;
  if (e.touches) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }
  let canvasX = (clientX - rect.left) * scaleX;
  let canvasY = (clientY - rect.top) * scaleY;
  canvasX = Math.min(Math.max(0, canvasX), canvas2dElem.width);
  canvasY = Math.min(Math.max(0, canvasY), canvas2dElem.height);
  return { x: canvasX / canvas2dElem.width, y: canvasY / canvas2dElem.height };
}
canvas2dElem.addEventListener('mousedown', e => {
  e.preventDefault();
  const uv = getCanvasCoords(e);
  let hitLayer = null;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.tileX > 1 || l.tileY > 1 || l.syncWithPattern) continue;
    let dx = uv.x - l.x;
    let dy = uv.y - l.y;
    const ang = -l.rotation * Math.PI / 180;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const halfW = (l.width / 1024) * l.scale * 0.5;
    const halfH = (l.height / 1024) * l.scale * 0.5;
    if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) {
      hitLayer = l;
      break;
    }
  }
  if (hitLayer) {
    selectLayer(hitLayer.id);
    isDraggingLayer = true;
    dragStart = {
      x: uv.x,
      y: uv.y,
      layerX: hitLayer.x,
      layerY: hitLayer.y
    };
    canvas2dElem.style.cursor = 'grabbing';
  } else {
    selectLayer(null);
  }
});
window.addEventListener('mousemove', e => {
  if (!isDraggingLayer || selectedLayerId === null) return;
  const uv = getCanvasCoords(e);
  const layer = layers.find(l => l.id === selectedLayerId);
  if (layer) {
    let newX = dragStart.layerX + (uv.x - dragStart.x);
    let newY = dragStart.layerY + (uv.y - dragStart.y);
    newX = Math.min(Math.max(0, newX), 1);
    newY = Math.min(Math.max(0, newY), 1);
    layer.x = newX;
    layer.y = newY;
    generateOverlayTexture();
    updateLayersUI();
    renderAll();
  }
});
window.addEventListener('mouseup', () => {
  isDraggingLayer = false;
  canvas2dElem.style.cursor = 'crosshair';
  renderAll();
});
canvas2dElem.addEventListener('wheel', e => {
  e.preventDefault();
  if (selectedLayerId === null) return;
  const layer = layers.find(l => l.id === selectedLayerId);
  if (!layer) return;
  const delta = e.deltaY > 0 ? -0.05 : 0.05;
  if (e.ctrlKey) {
    if (!layer.syncWithPattern) {
      layer.rotation = (layer.rotation + delta * 20) % 360;
    }
  } else {
    let newScale = layer.scale + delta;
    newScale = Math.min(Math.max(0.1, newScale), 2.0);
    layer.scale = newScale;
  }
  generateOverlayTexture();
  updateLayersUI();
  renderAll();
});

// --- Экспорт 2D и PBR ---
document.getElementById('export2DBtn')?.addEventListener('click', async () => {
  const format = document.getElementById('export2DFormat').value;
  const res = parseInt(document.getElementById('exportResolution').value);
  if (format === 'pbr') {
    const zip = new JSZip();
    zip.file('basecolor.png', await renderPBRMap(res, 'basecolor', false));
    zip.file('normal.png', await renderPBRMap(res, 'normal', false));
    zip.file('roughness.png', await renderPBRMap(res, 'roughness', false));
    zip.file('height.png', await renderPBRMap(res, 'height', false));
    zip.file('ao.png', await renderPBRMap(res, 'ao', false));
    zip.file('metallic.png', await renderPBRMap(res, 'metallic', false));
    const content = await zip.generateAsync({ type: 'blob' });
    downloadBlob(content, `pbr_${res}.zip`);
  } else if (format === 'svg') {
    const imgData = renderer2d.domElement.toDataURL('image/png');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${res}" height="${res}" viewBox="0 0 ${res} ${res}"><image width="${res}" height="${res}" href="${imgData}"/></svg>`;
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'texture.svg');
  } else {
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = res;
    exportCanvas.height = res;
    exportCanvas.getContext('2d').drawImage(renderer2d.domElement, 0, 0, res, res);
    exportCanvas.toBlob(blob => downloadBlob(blob, `texture.${format}`), mime, 0.95);
  }
});

async function captureBaseColorTexture(resolution = 2048, useTriplanar = true) {
  const tuni = {};
  for (const key in uniforms) {
    if (uniforms[key].value instanceof THREE.Vector2) tuni[key] = { value: uniforms[key].value.clone() };
    else if (uniforms[key].value instanceof THREE.Vector3) tuni[key] = { value: uniforms[key].value.clone() };
    else tuni[key] = { value: uniforms[key].value };
  }
  tuni.uExportMode = { value: 0 };
  tuni.uUseOverlay = { value: (layers.length > 0 || backgroundImageEl) ? 1 : 0 };
  tuni.uOverlayTexture = { value: overlayTexture };
  tuni.uShowRelief = { value: document.getElementById('relief2d').checked ? 1 : 0 };
  tuni.uTexelSize = { value: new THREE.Vector2(1/resolution, 1/resolution) };
  tuni.uIsExportingModel = { value: useTriplanar ? 1 : 0 };
  
  const sc = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.z = 1;
  const mat = new THREE.ShaderMaterial({ uniforms: tuni, vertexShader, fragmentShader });
  sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  offscreenRenderer.setSize(resolution, resolution);
  offscreenRenderer.render(sc, cam);
  const blob = await new Promise(r => offscreenRenderer.domElement.toBlob(r, 'image/png'));
  mat.dispose();
  return blob;
}

async function renderPBRMap(res, type, useTriplanar = true) {
  const modeMap = { 'basecolor': 0, 'normal': 1, 'roughness': 2, 'metallic': 3, 'height': 4, 'ao': 5 };
  const tuni = {};
  for (const key in uniforms) {
    if (uniforms[key].value instanceof THREE.Vector2) tuni[key] = { value: uniforms[key].value.clone() };
    else if (uniforms[key].value instanceof THREE.Vector3) tuni[key] = { value: uniforms[key].value.clone() };
    else tuni[key] = { value: uniforms[key].value };
  }
  tuni.uUseOverlay = { value: 0 };
  tuni.uShowRelief = { value: 0 };
  tuni.uExportMode = { value: modeMap[type] !== undefined ? modeMap[type] : 0 };
  tuni.uTexelSize = { value: new THREE.Vector2(1/res, 1/res) };
  tuni.uIsExportingModel = { value: useTriplanar ? 1 : 0 };
  
  const sc = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.z = 1;
  const mat = new THREE.ShaderMaterial({ uniforms: tuni, vertexShader, fragmentShader });
  sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  offscreenRenderer.setSize(res, res);
  offscreenRenderer.render(sc, cam);
  const blob = await new Promise(r => offscreenRenderer.domElement.toBlob(r, 'image/png'));
  mat.dispose();
  return blob;
}

// --- PBR превью с debounce ---
async function updatePBRPreviews() {
  if (!pbrReady) return;
  const pbrGrid = document.getElementById('pbrGrid');
  if (!pbrGrid) return;
  if (pbrGrid.children.length === 0) {
    const maps = ['basecolor', 'normal', 'roughness', 'metallic', 'height', 'ao'];
    const names = ['Base Color', 'Normal', 'Roughness', 'Metallic', 'Height', 'AO'];
    maps.forEach((type, i) => {
      const div = document.createElement('div');
      div.className = 'pbr-item';
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const span = document.createElement('span');
      span.textContent = names[i];
      div.appendChild(canvas);
      div.appendChild(span);
      pbrGrid.appendChild(div);
    });
  }
  const maps = ['basecolor', 'normal', 'roughness', 'metallic', 'height', 'ao'];
  for (let i = 0; i < maps.length; i++) {
    const canvas = pbrGrid.children[i].querySelector('canvas');
    const blob = await renderPBRMap(256, maps[i], false);
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 128, 128);
    };
    img.src = URL.createObjectURL(blob);
  }
}
function schedulePBRUpdate() {
  if (!pbrReady) return;
  if (pbrTimeout) clearTimeout(pbrTimeout);
  pbrTimeout = setTimeout(updatePBRPreviews, 500);
}
let pbrActivated = false;
function enablePBR() {
  if (!pbrActivated) {
    pbrActivated = true;
    pbrReady = true;
    updatePBRPreviews();
  }
}
document.querySelector('.tab-btn[data-tab="pbr"]')?.addEventListener('click', enablePBR);
setTimeout(() => { if (!pbrActivated) enablePBR(); }, 2000);

// --- Функция пересчёта UV для triplanar (бесшовный экспорт) ---
function generateTriplanarUVs(geometry, scale = 1.0) {
  const positions = geometry.attributes.position.array;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const normals = geometry.attributes.normal.array;
  const uvs = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const ix = i * 3;
    const nx = Math.abs(normals[ix]);
    const ny = Math.abs(normals[ix+1]);
    const nz = Math.abs(normals[ix+2]);
    const px = positions[ix];
    const py = positions[ix+1];
    const pz = positions[ix+2];
    let u = 0, v = 0;
    if (nx >= ny && nx >= nz) {
      u = (py + 0.6) * 0.8;
      v = (pz + 0.6) * 0.8;
    } else if (ny >= nx && ny >= nz) {
      u = (px + 0.6) * 0.8;
      v = (pz + 0.6) * 0.8;
    } else {
      u = (px + 0.6) * 0.8;
      v = (py + 0.6) * 0.8;
    }
    uvs.push(u, v);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
}

//  ЭКСПОРТ 3D МОДЕЛИ 
document.getElementById('exportModelBtn')?.addEventListener('click', async () => {
  const format = document.getElementById('exportModelFormat').value;
  try {
    const baseColorBlob = await captureBaseColorTexture(4096, true);
    const normalBlob = await renderPBRMap(4096, 'normal', true);
    const roughnessBlob = await renderPBRMap(4096, 'roughness', true);
    const metallicBlob = await renderPBRMap(4096, 'metallic', true);
    const aoBlob = await renderPBRMap(4096, 'ao', true);
    const heightBlob = await renderPBRMap(4096, 'height', true);

    const loadTexture = (blob) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(new THREE.CanvasTexture(img));
      img.src = URL.createObjectURL(blob);
    });
    const baseColorTex = await loadTexture(baseColorBlob);
    const normalTex = await loadTexture(normalBlob);
    const roughnessTex = await loadTexture(roughnessBlob);
    const metallicTex = await loadTexture(metallicBlob);
    const aoTex = await loadTexture(aoBlob);
    const heightTex = await loadTexture(heightBlob);

    [baseColorTex, normalTex, roughnessTex, metallicTex, aoTex, heightTex].forEach(tex => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 1);
    });

    const exportMaterial = new THREE.MeshStandardMaterial({
      map: baseColorTex,
      normalMap: normalTex,
      roughnessMap: roughnessTex,
      metalnessMap: metallicTex,
      aoMap: aoTex,
      displacementMap: heightTex,
      roughness: 0.5,
      metalness: 0.5,
      side: THREE.DoubleSide
    });

    let modelToExport;
    if (customModel) {
      const cloned = customModel.clone();
      cloned.traverse(c => { if (c.isMesh) c.material = exportMaterial; });
      modelToExport = cloned;
    } else {
      let geom;
      if (currentGeometryType === 'cube') geom = new THREE.BoxGeometry(1.2, 1.2, 1.2);
      else if (currentGeometryType === 'torus') geom = new THREE.TorusKnotGeometry(0.9, 0.25, 200, 32, 3, 4);
      else if (currentGeometryType === 'sphere') geom = new THREE.SphereGeometry(1.0, 128, 128);
      else geom = new THREE.CylinderGeometry(0.9, 0.9, 1.2, 64);
      generateTriplanarUVs(geom, 1.0);
      modelToExport = new THREE.Mesh(geom, exportMaterial);
    }
    const exportScene = new THREE.Scene();
    exportScene.add(modelToExport);

    const exporter = new GLTFExporter();
    if (format === 'glb') {
      exporter.parse(exportScene, (result) => {
        if (typeof result === 'string') {
          console.error('GLTFExporter error:', result);
          alert('Ошибка экспорта GLB: ' + result.substring(0, 200));
          return;
        }
        const blob = new Blob([result], { type: 'application/octet-stream' });
        downloadBlob(blob, 'model.glb');
      }, { binary: true, trs: true, onlyVisible: true });
    } else if (format === 'gltf') {
      exporter.parse(exportScene, (result) => {
        const jsonStr = JSON.stringify(result, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        downloadBlob(blob, 'model.gltf');
      }, { binary: false, trs: true, onlyVisible: true });
    } else if (format === 'obj') {
      const objExporter = new OBJExporter();
      const obj = objExporter.parse(exportScene);
      const mtl = `newmtl material0\nmap_Kd texture.png\nmap_Ks texture.png\nmap_Bump normal.png\nmap_d roughness.png\nmap_Pr metallic.png\n`;
      const zip = new JSZip();
      zip.file('model.obj', obj);
      zip.file('model.mtl', mtl);
      zip.file('texture.png', baseColorBlob);
      zip.file('normal.png', normalBlob);
      zip.file('roughness.png', roughnessBlob);
      zip.file('metallic.png', metallicBlob);
      zip.file('ao.png', aoBlob);
      zip.file('height.png', heightBlob);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, 'model_obj.zip');
    }
  } catch (e) {
    console.error('Export error:', e);
    alert('Ошибка экспорта 3D: ' + e.message);
  }
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Интеграция ---
document.getElementById('integrationDownloadBtn')?.addEventListener('click', () => {
  const engine = document.getElementById('integrationSelect').value;
  let url = engine === 'blender' ? 'https://github.com/PatternForge/blender-addon/releases/latest/download/patternforge_blender.zip' : 'https://github.com/PatternForge/unity-package/releases/latest/download/PatternForge.unitypackage';
  if (url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.target = '_blank';
    a.click();
  } else {
    alert('Скачивание временно недоступно');
  }
});

// --- Гамбургер-меню ---
const menuToggle = document.getElementById('menuToggle');
const patternBar = document.getElementById('patternBar');
const menuOverlay = document.getElementById('menuOverlay');
function openMenu() {
  patternBar.classList.add('open');
  menuOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeMenu() {
  patternBar.classList.remove('open');
  menuOverlay.classList.remove('active');
  document.body.style.overflow = '';
}
menuToggle?.addEventListener('click', e => {
  e.stopPropagation();
  if (patternBar.classList.contains('open')) closeMenu();
  else openMenu();
});
menuOverlay?.addEventListener('click', closeMenu);

// --- Аккордеон ---
function initAccordion() {
  if (window.innerWidth > 860) return;
  const headers = document.querySelectorAll('.accordion-header');
  headers.forEach(header => {
    header.addEventListener('click', () => {
      const group = header.closest('.accordion-group');
      group.classList.toggle('open');
      renderAll();
    });
  });
}

// --- Мобильные табы ---
function initMobileTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = {
    texture: document.getElementById('tab-texture'),
    view3d: document.getElementById('tab-view3d'),
    pbr: document.getElementById('tab-pbr')
  };
  if (!tabs.length) return;
  const activateTab = target => {
    tabs.forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${target}"]`).classList.add('active');
    Object.values(contents).forEach(content => content?.classList.remove('active'));
    if (target === 'texture') contents.texture?.classList.add('active');
    if (target === 'view3d') contents.view3d?.classList.add('active');
    if (target === 'pbr') contents.pbr?.classList.add('active');
    setTimeout(() => {
      updateSizes();
      renderAll();
    }, 50);
  };
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      activateTab(target);
    });
  });
  if (!document.querySelector('.tab-content.active')) activateTab('texture');
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 860) {
      const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
      if (activeTab) activateTab(activeTab);
    }
  });
}

// --- Пресеты ---
const savePresetBtn = document.getElementById('savePresetBtn');
const loadPresetInput = document.getElementById('loadPresetInput');
const loadPresetBtn = document.getElementById('loadPresetBtn');
function getCurrentPreset() {
  return {
    colors: activeColors.map(c => c.getHexString()),
    uniforms: {
      scale: uniforms.uScale.value,
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
      intensity: uniforms.uIntensity.value,
      normalStrength: uniforms.uNormalStrength.value,
      roughnessContrast: uniforms.uRoughnessContrast.value,
      metalThreshold: uniforms.uMetalThreshold.value,
      metalScale: uniforms.uMetalScale.value
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
    updateUniformsFromUI();
  }
  if (p.patternType !== undefined) uniforms.uPatternType.value = p.patternType;
  updateUniformsFromUI();
  renderAll();
}
savePresetBtn?.addEventListener('click', () => {
  const p = getCurrentPreset();
  const blob = new Blob([JSON.stringify(p)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `preset_${Date.now()}.json`;
  a.click();
});
loadPresetBtn?.addEventListener('click', () => loadPresetInput.click());
loadPresetInput?.addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      applyPreset(JSON.parse(ev.target.result));
    } catch (e) {
      alert('Ошибка загрузки пресета');
    }
  };
  r.readAsText(f);
});

// --- Зум и панорамирование 2D ---
const zoomPanContainer = document.getElementById('zoomPanContainer');
let zoomScale = 1;
let panX = 0, panY = 0;
let isPanning2d = false;
let startPanX = 0, startPanY = 0;
function updateZoomPan() {
  if (container2d.firstChild) {
    container2d.firstChild.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
  }
}
zoomPanContainer?.addEventListener('wheel', e => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  zoomScale = Math.min(Math.max(0.5, zoomScale + delta), 4);
  updateZoomPan();
}, { passive: false });
zoomPanContainer?.addEventListener('mousedown', e => {
  isPanning2d = true;
  startPanX = e.clientX - panX;
  startPanY = e.clientY - panY;
  zoomPanContainer.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', e => {
  if (!isPanning2d) return;
  panX = e.clientX - startPanX;
  panY = e.clientY - startPanY;
  updateZoomPan();
});
window.addEventListener('mouseup', () => {
  isPanning2d = false;
  if (zoomPanContainer) zoomPanContainer.style.cursor = 'grab';
});
zoomPanContainer?.addEventListener('dblclick', () => {
  zoomScale = 1;
  panX = 0;
  panY = 0;
  updateZoomPan();
});

// --- Запуск ---
update3dModel();
generateOverlayTexture();
initAccordion();
initMobileTabs();
renderAll();
