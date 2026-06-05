import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

// --- Инициализация рендереров ---
const container2d = document.getElementById('canvas2d');
const container3d = document.getElementById('canvas3d');
const scene2d = new THREE.Scene(); scene2d.background = null;
const camera2d = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); camera2d.position.z = 1;
const renderer2d = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer2d.setClearColor(0x000000, 0);
const scene3d = new THREE.Scene(); scene3d.background = null;
const camera3d = new THREE.PerspectiveCamera(45, 1, 0.1, 1000); camera3d.position.set(2.2, 1.6, 2.8);
const renderer3d = new THREE.WebGLRenderer({ antialias: true, alpha: true });

container2d.appendChild(renderer2d.domElement);
container3d.appendChild(renderer3d.domElement);

// --- Оффскрин рендерер для PBR/экспорта ---
const offscreenRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
offscreenRenderer.setSize(1024, 1024);

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
controls3d.enableDamping = true; controls3d.enableZoom = true; controls3d.target.set(0, 0, 0);

// --- Освещение ---
scene3d.add(new THREE.AmbientLight(0xffffff, 0.4));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2); keyLight.position.set(5, 5, 5); scene3d.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.5); fillLight.position.set(-5, 0, 5); scene3d.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xffffff, 0.8); rimLight.position.set(0, 5, -5); scene3d.add(rimLight);

let currentMesh3d = null, currentGeometryType = 'cube', customModel = null, overlayTexture = null;
let backgroundImageEl = null;
let activeColors = [ new THREE.Color('#FF6B8B'), new THREE.Color('#4CC9F0'), new THREE.Color('#F9C74F'), new THREE.Color('#9B5DE5') ];
let layers = [];
let selectedLayerId = null;
let isDraggingLayer = false;
let dragStart = { x: 0, y: 0, layerX: 0, layerY: 0 };

function ensureUIControls() {
  const paramsGroup = document.querySelector('.accordion-group:first-child .accordion-content');
  if (!paramsGroup) return;
  if (!document.getElementById('intensity')) {
    const row = document.createElement('div'); row.className = 'control-row';
    row.innerHTML = `<label>Интенсивность</label><input type="range" id="intensity" min="0" max="2" step="0.01" value="1.0"><span class="value-display" id="intensityVal">1.00</span>`;
    paramsGroup.appendChild(row);
    document.getElementById('intensity').addEventListener('input', () => { updateUniformsFromUI(); schedulePBRUpdate(); });
  }
  if (!document.getElementById('tile3dScale')) {
    const row = document.createElement('div'); row.className = 'control-row';
    row.innerHTML = `<label>Масштаб 3D</label><input type="range" id="tile3dScale" min="0.2" max="5" step="0.02" value="1.0"><span class="value-display" id="tile3dScaleVal">1.00</span>`;
    paramsGroup.appendChild(row);
    document.getElementById('tile3dScale').addEventListener('input', () => { updateUniformsFromUI(); schedulePBRUpdate(); });
  }
}

const uniforms = {
  uScale: { value: 0.8 }, uIntensity: { value: 1.0 }, uPatternType: { value: 0 },
  uColor0: { value: new THREE.Vector3() }, uColor1: { value: new THREE.Vector3() }, uColor2: { value: new THREE.Vector3() }, uColor3: { value: new THREE.Vector3() },
  uColor4: { value: new THREE.Vector3() }, uColor5: { value: new THREE.Vector3() }, uColor6: { value: new THREE.Vector3() }, uColor7: { value: new THREE.Vector3() },
  uColorsCount: { value: 4 }, uSaturation: { value: 1.5 }, uBlendMode: { value: 0 },
  uRotation: { value: 0 }, uOffset: { value: new THREE.Vector2(0,0) }, uMirror: { value: 0 },
  uOctaves: { value: 3 }, uPersistence: { value: 0.5 }, uLacunarity: { value: 2.0 },
  uTileEnabled: { value: 0 }, uOverlayTexture: { value: null }, uUseOverlay: { value: 1 },
  uWarpEnable: { value: 0 }, uWarpStrength: { value: 0.3 }, uWarpOctaves: { value: 2 },
  uShowRelief: { value: 0 }, uReliefStrength: { value: 1.0 }, uTile3DScale: { value: 1.0 },
  uTime: { value: 0 }, uOverlayScale: { value: 1.0 }, uExportMode: { value: 0 }
};

function updateColorUniforms() {
  const lastColor = activeColors.length ? activeColors[activeColors.length-1] : new THREE.Color(1,1,1);
  for (let i=0; i<8; i++) {
    const c = i < activeColors.length ? activeColors[i] : lastColor;
    uniforms[`uColor${i}`].value.set(c.r, c.g, c.b);
  }
  uniforms.uColorsCount.value = activeColors.length;
}
updateColorUniforms();

let pbrUpdateTimeout;
function schedulePBRUpdate() {
  clearTimeout(pbrUpdateTimeout);
  pbrUpdateTimeout = setTimeout(updatePBRPreviews, 300);
}

async function updatePBRPreviews() {
  const pbrGrid = document.getElementById('pbrGrid');
  if (!pbrGrid) return;
  if (pbrGrid.children.length === 0) {
    const maps = ['basecolor', 'normal', 'roughness', 'metallic', 'height', 'ao'];
    const names = ['Base Color', 'Normal', 'Roughness', 'Metallic', 'Height', 'AO'];
    maps.forEach((type, i) => {
      const div = document.createElement('div'); div.className = 'pbr-item';
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
      const span = document.createElement('span'); span.textContent = names[i];
      div.appendChild(canvas); div.appendChild(span); pbrGrid.appendChild(div);
    });
  }

  const maps = ['basecolor', 'normal', 'roughness', 'metallic', 'height', 'ao'];
  for (let i = 0; i < maps.length; i++) {
    const canvas = pbrGrid.children[i].querySelector('canvas');
    const blob = await renderPBRMap(128, maps[i]);
    const img = new Image();
    img.onload = () => { 
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 128, 128); 
    };
    img.src = URL.createObjectURL(blob);
  }
}

// --- Шейдеры (полные, с поддержкой PBR-экспорта) ---
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
uniform float uScale;
uniform float uIntensity;
uniform int uPatternType;
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uColor4;
uniform vec3 uColor5;
uniform vec3 uColor6;
uniform vec3 uColor7;
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
uniform float uTime;
uniform int uExportMode;
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vNormalW;

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}
vec2 hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(vec2(p.x * p.y, p.y * p.x)) * 2.0 - 1.0;
}
float perlinNoise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 grad00 = hash(i);
  vec2 grad10 = hash(i + vec2(1.0, 0.0));
  vec2 grad01 = hash(i + vec2(0.0, 1.0));
  vec2 grad11 = hash(i + vec2(1.0, 1.0));
  float dot00 = dot(grad00, f);
  float dot10 = dot(grad10, f - vec2(1.0, 0.0));
  float dot01 = dot(grad01, f - vec2(0.0, 1.0));
  float dot11 = dot(grad11, f - vec2(1.0, 1.0));
  return mix(mix(dot00, dot10, u.x), mix(dot01, dot11, u.x), u.y) * 0.5 + 0.5;
}
float fbmPerlin(vec2 st, int oct, float pers, float lac) {
  float val = 0.0, amp = 0.5, freq = 2.0;
  for(int i=0; i < 6; i++) {
    if(i >= oct) break;
    val += amp * (perlinNoise(st * freq) * 2.0 - 1.0);
    amp *= pers;
    freq *= lac;
  }
  return val * 0.5 + 0.5;
}
float worley(vec2 uv) {
  vec2 p = floor(uv);
  vec2 f = fract(uv);
  float res = 1.0;
  for(int j=-1; j <= 1; j++)
    for(int i=-1; i <= 1; i++) {
      vec2 b = vec2(float(i), float(j));
      vec2 r = b - f + random(p + b);
      res = min(res, dot(r,r));
    }
  return sqrt(res);
}
float truchetPattern(vec2 uv, float t) {
  uv = fract(uv * 3.0) - 0.5;
  float angle = sin(t + uv.x * 10.0) * cos(t + uv.y * 10.0);
  return step(length(uv), 0.4 + 0.2 * sin(angle * 20.0 + t));
}
vec2 domainWarp(vec2 uv, float strength, int octaves) {
  vec2 warped = uv;
  for(int i=0; i < 5; i++) {
    if(i >= octaves) break;
    warped += strength * vec2(sin(warped.y * 3.14159 * 2.0 * float(i+1) + uTime), cos(warped.x * 3.14159 * 2.0 * float(i+1) + uTime));
  }
  return warped;
}
float reactionDiffusion(vec2 uv) {
  vec2 p = uv * 4.0;
  float a = sin(p.x * 3.0) * cos(p.y * 3.0);
  float b = cos(p.x * 4.2) * sin(p.y * 4.2);
  return clamp(a * 0.5 + b * 0.5 + 0.5, 0.0, 1.0);
}
float flowField(vec2 uv) {
  vec2 q = uv * 3.0;
  float angle = sin(q.y * 0.7) * cos(q.x * 0.5);
  vec2 gradient = vec2(cos(angle), sin(angle));
  uv += gradient * 0.1;
  float field = sin(uv.x * 10.0) * cos(uv.y * 10.0);
  return smoothstep(-0.3, 0.7, field);
}
float wfcPattern(vec2 uv) {
  vec2 tile = floor(uv * 8.0);
  float hashVal = random(tile);
  int rule = int(floor(hashVal * 6.0));
  float pattern = 0.0;
  vec2 sub = fract(uv * 8.0);
  if(rule == 0) pattern = step(0.5, sub.x) * step(0.5, sub.y);
  else if(rule == 1) pattern = step(0.5, sub.x + sub.y);
  else if(rule == 2) pattern = step(0.5, sub.x - sub.y + 0.5);
  else if(rule == 3) pattern = sin(sub.x * 3.14159 * 4.0) * 0.5 + 0.5;
  else if(rule == 4) pattern = (sub.x > 0.25 && sub.x < 0.75 && sub.y > 0.25 && sub.y < 0.75) ? 1.0 : 0.0;
  else pattern = fract(sub.x * 3.0 + sub.y * 2.0);
  return pattern;
}
float ridgedMF(vec2 uv, int oct, float pers, float lac) {
  float val = 0.0, amp = 0.5, freq = 2.0;
  for(int i=0; i < 6; i++) {
    if(i >= oct) break;
    float n = perlinNoise(uv * freq) * 2.0 - 1.0;
    n = 1.0 - abs(n);
    val += amp * n;
    amp *= pers;
    freq *= lac;
  }
  return clamp(val, 0.0, 1.0);
}
float checker(vec2 uv, float freq) {
  vec2 p = floor(uv * freq);
  return mod(p.x + p.y, 2.0);
}
float stripes(vec2 uv, float freq) {
  return step(0.5, fract(uv.x * freq));
}
float circles(vec2 uv, float freq) {
  vec2 center = vec2(0.5, 0.5);
  float radius = length(uv - center) * freq;
  return fract(radius * 2.0);
}
float grid(vec2 uv, float freq) {
  vec2 g = fract(uv * freq);
  return max(step(0.92, g.x), step(0.92, g.y));
}
float tiles(vec2 uv, float freq) {
  vec2 f = fract(uv * freq);
  float line = step(0.75, f.x) + step(0.75, f.y);
  return clamp(1.0 - line, 0.0, 1.0);
}
float wood(vec2 uv, float freq) {
  vec2 center = vec2(0.5, 0.5);
  float dist = length(uv - center) * 2.0;
  float rings = sin(dist * freq * 12.0 + sin(uv.x * 8.0) * 1.5);
  return clamp(rings * 0.5 + 0.5, 0.0, 1.0);
}
float marble(vec2 uv, float freq) {
  float noise = fbmPerlin(uv * freq * 3.0, 4, 0.6, 2.0);
  float veins = sin((uv.x * freq * 5.0 + noise * 3.0) * 3.14159);
  return clamp(veins * 0.6 + 0.5, 0.0, 1.0);
}
float linearGradient(vec2 uv) { return uv.x; }
float radialGradient(vec2 uv) { return length(uv - 0.5) * 1.414; }
float angularGradient(vec2 uv) { return atan(uv.y - 0.5, uv.x - 0.5) / (2.0 * 3.14159) + 0.5; }

vec3 getColor(float t) {
  if (uColorsCount <= 1) return uColor0;
  float seg = 1.0 / float(uColorsCount - 1);
  float clampedT = clamp(t, 0.0, 1.0);
  int baseIdx = int(floor(clampedT / seg));
  if (baseIdx < 0) baseIdx = 0;
  if (baseIdx >= uColorsCount - 1) {
    if (uColorsCount == 2) return uColor1;
    else if (uColorsCount == 3) return uColor2;
    else if (uColorsCount == 4) return uColor3;
    else if (uColorsCount == 5) return uColor4;
    else if (uColorsCount == 6) return uColor5;
    else if (uColorsCount == 7) return uColor6;
    else return uColor7;
  }
  float localT = (clampedT - float(baseIdx) * seg) / seg;
  vec3 c1 = uColor0;
  vec3 c2 = uColor1;
  if (baseIdx == 0) { c1 = uColor0; c2 = uColor1; }
  else if (baseIdx == 1) { c1 = uColor1; c2 = uColor2; }
  else if (baseIdx == 2) { c1 = uColor2; c2 = uColor3; }
  else if (baseIdx == 3) { c1 = uColor3; c2 = uColor4; }
  else if (baseIdx == 4) { c1 = uColor4; c2 = uColor5; }
  else if (baseIdx == 5) { c1 = uColor5; c2 = uColor6; }
  else if (baseIdx == 6) { c1 = uColor6; c2 = uColor7; }
  return mix(c1, c2, localT);
}

float computePattern(vec2 uv) {
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
  float patternValue;
  if(uPatternType == 0) { 
    float w1 = sin(st.x * 8.0) * cos(st.y * 8.0);
    float w2 = sin(st.y * 12.0 + st.x * 5.0);
    patternValue = (w1 + w2) * 0.6 + 0.5;
  }
  else if(uPatternType == 1) { 
    patternValue = worley(st * 3.5);
    patternValue = pow(patternValue * 1.2, 0.8);
  }
  else if(uPatternType == 2) { patternValue = fbmPerlin(st, uOctaves, uPersistence, uLacunarity); }
  else if(uPatternType == 4) { patternValue = random(st); }
  else if(uPatternType == 5) { patternValue = reactionDiffusion(st); }
  else if(uPatternType == 6) { patternValue = wfcPattern(st); }
  else if(uPatternType == 7) { patternValue = flowField(st); }
  else if(uPatternType == 12) { patternValue = ridgedMF(st, uOctaves, uPersistence, uLacunarity); }
  else if(uPatternType == 8) { patternValue = checker(st, 4.0); }
  else if(uPatternType == 9) { patternValue = stripes(st, 6.0); }
  else if(uPatternType == 10) { patternValue = circles(st, 3.0); }
  else if(uPatternType == 11) { patternValue = grid(st, 6.0); }
  else if(uPatternType == 14) { patternValue = wood(st, 0.8); }
  else if(uPatternType == 15) { patternValue = marble(st, 1.2); }
  else if(uPatternType == 16) { patternValue = tiles(st, 5.0); }
  else if(uPatternType == 17) { patternValue = linearGradient(uv); }
  else if(uPatternType == 18) { patternValue = radialGradient(uv); }
  else if(uPatternType == 19) { patternValue = angularGradient(uv); }
  else if(uPatternType == 3) { patternValue = truchetPattern(st * 3.0, uTime); patternValue = patternValue * 0.8 + 0.2; }
  else { patternValue = fbmPerlin(st, uOctaves, uPersistence, uLacunarity); }
  return clamp(patternValue * uIntensity, 0.0, 1.0);
}

void main() {
  vec3 blend = abs(vNormalW);
  blend = pow(blend, vec3(2.0));
  blend /= (blend.x + blend.y + blend.z);
  vec2 uvX = vWorldPosition.yz;
  vec2 uvY = vWorldPosition.xz;
  vec2 uvZ = vWorldPosition.xy;
  float triScale = 0.8;
  uvX *= triScale;
  uvY *= triScale;
  uvZ *= triScale;
  float patX = computePattern(uvX);
  float patY = computePattern(uvY);
  float patZ = computePattern(uvZ);
  float patternValue = patX * blend.x + patY * blend.y + patZ * blend.z;
  
  // Для PBR-экспорта:
  // 0 - basecolor, 1 - normal, 2 - roughness, 3 - metallic, 4 - height, 5 - ao
  if (uExportMode == 0) {
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
  } else if (uExportMode == 1) {
    // Normal map: из градиента высоты
    vec3 grad = vec3(dFdx(patternValue), dFdy(patternValue), 0.0);
    vec3 normal = normalize(vec3(-grad.x * 2.0, -grad.y * 2.0, 1.0));
    gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
  } else if (uExportMode == 2) {
    // Roughness
    float roughness = clamp(patternValue * 0.8 + 0.2, 0.0, 1.0);
    gl_FragColor = vec4(roughness, roughness, roughness, 1.0);
  } else if (uExportMode == 3) {
    // Metallic
    float metallic = clamp(patternValue * 0.9, 0.0, 1.0);
    gl_FragColor = vec4(metallic, metallic, metallic, 1.0);
  } else if (uExportMode == 4) {
    // Height (дислейсмент)
    gl_FragColor = vec4(patternValue, patternValue, patternValue, 1.0);
  } else if (uExportMode == 5) {
    // Ambient Occlusion
    float ao = clamp(patternValue * 0.7 + 0.3, 0.0, 1.0);
    gl_FragColor = vec4(ao, ao, ao, 1.0);
  } else {
    gl_FragColor = vec4(0.5, 0.5, 1.0, 1.0);
  }
}
`;

let currentMaterial = null;
function createMaterial() {
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide });
  if (uniforms.uOverlayTexture.value) {
    uniforms.uOverlayTexture.value.wrapS = THREE.RepeatWrapping;
    uniforms.uOverlayTexture.value.wrapT = THREE.RepeatWrapping;
  }
  return mat;
}
function updateMaterial() {
  if (currentMaterial) currentMaterial.dispose();
  currentMaterial = createMaterial();
  if (plane2d) plane2d.material = currentMaterial;
  if (currentMesh3d) {
    if (customModel) customModel.traverse(c => { if (c.isMesh) c.material = currentMaterial; });
    else currentMesh3d.material = currentMaterial;
  }
  schedulePBRUpdate();
}
let plane2d = new THREE.Mesh(new THREE.PlaneGeometry(2,2), createMaterial());
scene2d.add(plane2d);
currentMaterial = plane2d.material;

const colorContainer = document.getElementById('colorListContainer');
const addColorBtn = document.getElementById('addColorBtn');
function rebuildColorUI() {
  colorContainer.innerHTML = '';
  activeColors.forEach((col, idx) => {
    const div = document.createElement('div'); div.className = 'color-item';
    const colorInput = document.createElement('input'); colorInput.type = 'color'; colorInput.value = '#' + col.getHexString(); colorInput.className = 'color-circle-input';
    colorInput.addEventListener('input', (e) => { activeColors[idx] = new THREE.Color(e.target.value); updateColorUniforms(); updateMaterial(); });
    div.appendChild(colorInput);
    if (activeColors.length > 2) {
      const removeBtn = document.createElement('button'); removeBtn.className = 'remove-color-btn'; removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', (e) => { e.stopPropagation(); if (activeColors.length > 2) { activeColors.splice(idx,1); rebuildColorUI(); updateColorUniforms(); updateMaterial(); } });
      div.appendChild(removeBtn);
    }
    colorContainer.appendChild(div);
  });
}
addColorBtn.addEventListener('click', () => { if (activeColors.length < 8) { activeColors.push(new THREE.Color('#FFB347')); rebuildColorUI(); updateColorUniforms(); updateMaterial(); } });
rebuildColorUI();

function updateUniformsFromUI() {
  uniforms.uScale.value = parseFloat(document.getElementById('scale').value);
  const intensityEl = document.getElementById('intensity');
  if (intensityEl) uniforms.uIntensity.value = parseFloat(intensityEl.value);
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
  const tile3dEl = document.getElementById('tile3dScale');
  if (tile3dEl) uniforms.uTile3DScale.value = parseFloat(tile3dEl.value);
  const vals = {
    scaleVal: uniforms.uScale.value.toFixed(2), octavesVal: uniforms.uOctaves.value,
    persistenceVal: uniforms.uPersistence.value.toFixed(2), lacunarityVal: uniforms.uLacunarity.value.toFixed(2),
    saturationVal: uniforms.uSaturation.value.toFixed(2), rotateVal: uniforms.uRotation.value + '°',
    offsetXVal: uniforms.uOffset.value.x.toFixed(2), offsetYVal: uniforms.uOffset.value.y.toFixed(2),
    warpStrengthVal: uniforms.uWarpStrength.value.toFixed(2), warpOctavesVal: uniforms.uWarpOctaves.value,
    reliefStrengthVal: uniforms.uReliefStrength.value.toFixed(2)
  };
  if (document.getElementById('intensityVal')) vals.intensityVal = uniforms.uIntensity.value.toFixed(2);
  if (document.getElementById('tile3dScaleVal')) vals.tile3dScaleVal = uniforms.uTile3DScale.value.toFixed(2);
  for (let id in vals) { const el = document.getElementById(id); if (el) el.innerText = vals[id]; }
  renderer2d.render(scene2d, camera2d);
  renderer3d.render(scene3d, camera3d);
  if (layers.some(l => l.syncWithPattern)) generateOverlayTexture();
  schedulePBRUpdate();
}
const controlIds = ['scale','octaves','persistence','lacunarity','saturation','blendMode','rotate','offsetX','offsetY','mirror','warpStrength','warpOctaves','reliefStrength'];
controlIds.forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', updateUniformsFromUI); });
document.getElementById('warpEnable')?.addEventListener('change', updateUniformsFromUI);
document.getElementById('relief2d')?.addEventListener('change', updateUniformsFromUI);
document.getElementById('bgOpacity')?.addEventListener('input', (e) => {
  document.getElementById('bgOpacityVal').innerText = parseFloat(e.target.value).toFixed(2);
  generateOverlayTexture();
});
ensureUIControls();
updateUniformsFromUI();

const noisePatterns = [{name:"Волны", v:0},{name:"Перлин", v:2},{name:"Симплекс", v:4},{name:"Вороного", v:1}];
const fractalPatterns = [{name:"Реакция-диффузия", v:5},{name:"Потоковое поле", v:7},{name:"WFC", v:6},{name:"Гребневый мультифрактал", v:12}];
const gradientPatterns = [{name:"Линейный градиент", v:17},{name:"Радиальный градиент", v:18},{name:"Угловой градиент", v:19}];
const geometricPatterns = [{name:"Шахматная доска", v:8},{name:"Полосы", v:9},{name:"Концентрические круги", v:10},{name:"Сетка", v:11},{name:"Плитка", v:16},{name:"Древесина", v:14},{name:"Мрамор", v:15},{name:"Truchet", v:3}];
function populateSelect(id, items, cur) {
  const sel = document.getElementById(id); if (!sel) return; sel.innerHTML = '';
  items.forEach(i => { const o = document.createElement('option'); o.value=i.v; o.textContent=i.name; if(i.v===cur) o.selected=true; sel.appendChild(o); });
  sel.addEventListener('change', e => { uniforms.uPatternType.value = parseInt(e.target.value); updateUniformsFromUI(); if (window.innerWidth <= 860) closeMenu(); });
}
populateSelect('selectNoise', noisePatterns, uniforms.uPatternType.value);
populateSelect('selectFractal', fractalPatterns, uniforms.uPatternType.value);
populateSelect('selectGradient', gradientPatterns, uniforms.uPatternType.value);
populateSelect('selectGeometric', geometricPatterns, uniforms.uPatternType.value);

const resizeHandle = document.getElementById('resizeHandle');
const textureCol = document.querySelector('.texture-column');
const view3dCol = document.querySelector('.view3d-column');
let isResizing = false;
resizeHandle?.addEventListener('mousedown', (e) => {
  isResizing = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const wrapperRect = document.querySelector('.preview-wrapper').getBoundingClientRect();
  const newTextureWidth = e.clientX - wrapperRect.left;
  if (newTextureWidth > 200 && newTextureWidth < wrapperRect.width - 200) {
    textureCol.style.flex = `0 0 ${newTextureWidth}px`;
    view3dCol.style.flex = '1';
    updateSizes();
  }
});
document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
  }
});

// ---- Зум и Пан для 2D текстуры ----
const zoomPanContainer = document.getElementById('zoomPanContainer');
let zoomScale = 1;
let panX = 0, panY = 0;
let isPanning = false;
let startPanX = 0, startPanY = 0;
function updateZoomPan() {
  if (container2d.firstChild) {
    container2d.firstChild.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
  }
}
zoomPanContainer?.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  zoomScale = Math.min(Math.max(0.5, zoomScale + delta), 4);
  updateZoomPan();
}, { passive: false });
zoomPanContainer?.addEventListener('mousedown', (e) => {
  isPanning = true;
  startPanX = e.clientX - panX;
  startPanY = e.clientY - panY;
  zoomPanContainer.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  panX = e.clientX - startPanX;
  panY = e.clientY - startPanY;
  updateZoomPan();
});
window.addEventListener('mouseup', () => {
  isPanning = false;
  if (zoomPanContainer) zoomPanContainer.style.cursor = 'grab';
});
zoomPanContainer?.addEventListener('dblclick', () => {
  zoomScale = 1; panX = 0; panY = 0;
  updateZoomPan();
});

const savePresetBtn = document.getElementById('savePresetBtn');
const loadPresetInput = document.getElementById('loadPresetInput');
const loadPresetBtn = document.getElementById('loadPresetBtn');
function getCurrentPreset() {
  return {
    colors: activeColors.map(c => c.getHexString()),
    uniforms: { scale:uniforms.uScale.value, octaves:uniforms.uOctaves.value, persistence:uniforms.uPersistence.value, lacunarity:uniforms.uLacunarity.value, saturation:uniforms.uSaturation.value, blendMode:uniforms.uBlendMode.value, rotation:uniforms.uRotation.value, offsetX:uniforms.uOffset.value.x, offsetY:uniforms.uOffset.value.y, mirror:uniforms.uMirror.value, warpEnable:uniforms.uWarpEnable.value, warpStrength:uniforms.uWarpStrength.value, warpOctaves:uniforms.uWarpOctaves.value, reliefStrength:uniforms.uReliefStrength.value, intensity:uniforms.uIntensity.value, tile3dScale:uniforms.uTile3DScale.value },
    patternType:uniforms.uPatternType.value
  };
}
function applyPreset(p) {
  if (!p.colors) return;
  activeColors = p.colors.map(h => new THREE.Color('#'+h));
  rebuildColorUI(); updateColorUniforms();
  if (p.uniforms) { Object.keys(p.uniforms).forEach(k => { const el = document.getElementById(k); if(el) el.value = p.uniforms[k]; }); updateUniformsFromUI(); }
  if (p.patternType !== undefined) uniforms.uPatternType.value = p.patternType;
  updateMaterial();
}
savePresetBtn.onclick = () => { const p = getCurrentPreset(); const blob = new Blob([JSON.stringify(p)], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`preset_${Date.now()}.json`; a.click(); };
loadPresetBtn.onclick = () => loadPresetInput.click();
loadPresetInput.onchange = e => { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = ev => { try { applyPreset(JSON.parse(ev.target.result)); } catch(e) { alert('Ошибка'); } }; r.readAsText(f); };

function createGeometry(type) {
  if(type==='cube') return new THREE.BoxGeometry(1.2,1.2,1.2);
  if(type==='torus') return new THREE.TorusKnotGeometry(0.85,0.22,200,32,3,4);
  if(type==='sphere') return new THREE.SphereGeometry(0.9,128,128);
  return new THREE.CylinderGeometry(0.8,0.8,1.2,64);
}
function update3dModel() {
  if(currentMesh3d) scene3d.remove(currentMesh3d);
  if(customModel) { customModel.traverse(c=>{if(c.isMesh) c.material = currentMaterial;}); scene3d.add(customModel); currentMesh3d=customModel; }
  else { const m = new THREE.Mesh(createGeometry(currentGeometryType), currentMaterial); scene3d.add(m); currentMesh3d=m; }
  const box = new THREE.Box3().setFromObject(currentMesh3d); controls3d.target.copy(box.getCenter(new THREE.Vector3())); controls3d.update(); updateSizes();
}
document.getElementById('geometrySelect')?.addEventListener('change', e => { customModel=null; currentGeometryType=e.target.value; update3dModel(); });
document.getElementById('modelFileInput')?.addEventListener('change', e => {
  if(!e.target.files[0]) return;
  const url = URL.createObjectURL(e.target.files[0]);
  new GLTFLoader().load(url, gltf => {
    if(currentMesh3d) scene3d.remove(currentMesh3d);
    customModel = gltf.scene; const box = new THREE.Box3().setFromObject(customModel); const size = box.getSize(new THREE.Vector3()).length();
    const scl = 1.2 / size; customModel.scale.set(scl,scl,scl); customModel.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(scl));
    update3dModel(); URL.revokeObjectURL(url);
    document.getElementById('modelStatus').textContent='Модель загружена';
    setTimeout(()=>document.getElementById('modelStatus').textContent='',2000);
  }, undefined, () => document.getElementById('modelStatus').textContent='Ошибка');
});

document.getElementById('bgImageInput')?.addEventListener('change', e => {
  if (e.target.files[0]) {
    const img = new Image();
    img.onload = () => { backgroundImageEl = img; generateOverlayTexture(); };
    img.src = URL.createObjectURL(e.target.files[0]);
    document.getElementById('clearBgBtn')?.classList.remove('hidden');
  }
});
document.getElementById('clearBgBtn')?.addEventListener('click', () => { backgroundImageEl = null; document.getElementById('clearBgBtn')?.classList.add('hidden'); generateOverlayTexture(); });

async function generateOverlayTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (backgroundImageEl) {
    const bgOpacity = document.getElementById('bgOpacity') ? parseFloat(document.getElementById('bgOpacity').value) : 1.0;
    ctx.globalAlpha = bgOpacity; drawImageCover(ctx, backgroundImageEl, size, size); ctx.globalAlpha = 1.0;
  }
  const syncRotation = uniforms.uRotation.value, syncOffsetX = uniforms.uOffset.value.x, syncOffsetY = uniforms.uOffset.value.y, syncMirror = uniforms.uMirror.value;
  for (const layer of layers) {
    ctx.save();
    let rot = layer.rotation, offX = layer.x, offY = layer.y, mirror = layer.mirror || 0;
    if (layer.syncWithPattern) { rot = syncRotation; offX = syncOffsetX; offY = syncOffsetY; mirror = syncMirror; }
    ctx.translate(size / 2, size / 2); ctx.rotate(rot * Math.PI / 180);
    if (layer.syncWithPattern) ctx.translate(offX * size, offY * size);
    else ctx.translate((offX - 0.5) * size, (offY - 0.5) * size);
    if (mirror === 1 || mirror === 3) ctx.scale(-1, 1);
    if (mirror === 2 || mirror === 3 ) ctx.scale(1, -1);
    ctx.scale(layer.scale, layer.scale);
    const img = layer.imgElement, imgW = img.width, imgH = img.height;
    const tileX = Math.max(1, layer.tileX || 1), tileY = Math.max(1, layer.tileY || 1);
    if (tileX === 1 && tileY === 1) ctx.drawImage(img, -imgW / 2, -imgH / 2, imgW, imgH);
    else {
      const tileW = imgW, tileH = imgH;
      const neededX = Math.min(20, Math.ceil((size / layer.scale) / tileW) + 2);
      const neededY = Math.min(20, Math.ceil((size / layer.scale) / tileH) + 2);
      const startTX = -Math.floor(neededX / 2), startTY = -Math.floor(neededY / 2);
      for (let ty = 0; ty < neededY; ty++) for (let tx = 0; tx < neededX; tx++) ctx.drawImage(img, (startTX + tx) * tileW, (startTY + ty) * tileH, tileW, tileH);
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping; texture.needsUpdate = true;
  if (overlayTexture) overlayTexture.dispose?.();
  overlayTexture = texture;
  uniforms.uOverlayTexture.value = overlayTexture;
  uniforms.uUseOverlay.value = (layers.length > 0 || backgroundImageEl) ? 1 : 0;
  const clearBtn = document.getElementById('clearOverlayBtn');
  if (layers.length > 0) clearBtn.classList.remove('hidden');
  else clearBtn.classList.add('hidden');
  renderer2d.render(scene2d, camera2d);
}
function drawImageCover(ctx, img, w, h) {
  const ratio = Math.max(w / img.width, h / img.height);
  const centerShift_x = (w - img.width * ratio) / 2, centerShift_y = (h - img.height * ratio) / 2;
  ctx.drawImage(img, 0, 0, img.width, img.height, centerShift_x, centerShift_y, img.width * ratio, img.height * ratio);
}

const overlayLayersDiv = document.getElementById('overlayLayersList');
const layerOpacitySlider = document.getElementById('layerOpacity');
const layerOpacityVal = document.getElementById('layerOpacityVal');
function updateLayersUI() {
  if (!overlayLayersDiv) return;
  overlayLayersDiv.innerHTML = '';
  layers.forEach(layer => {
    const div = document.createElement('div'); div.className = `layer-item ${selectedLayerId === layer.id ? 'selected' : ''}`; div.dataset.id = layer.id;
    const thumb = document.createElement('img'); thumb.className = 'layer-thumb'; thumb.src = layer.imgElement.src;
    const nameSpan = document.createElement('span'); nameSpan.className = 'layer-name'; nameSpan.textContent = layer.name;
    const controls = document.createElement('div'); controls.className = 'layer-controls';
    const delBtn = document.createElement('button'); delBtn.textContent = '🗑'; delBtn.title = 'Удалить';
    delBtn.onclick = (e) => { e.stopPropagation(); deleteLayerById(layer.id); };
    controls.appendChild(delBtn);
    div.appendChild(thumb); div.appendChild(nameSpan); div.appendChild(controls);
    const extraDiv = document.createElement('div'); extraDiv.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; width:100%; align-items:center;';
    const scaleRow = document.createElement('div'); scaleRow.style.display = 'flex'; scaleRow.style.alignItems = 'center'; scaleRow.style.gap = '6px';
    scaleRow.innerHTML = `<span style="font-size:0.7rem;">Масштаб:</span><input type="range" min="0.1" max="2.0" step="0.01" value="${layer.scale}" style="width:80px;"><span style="font-size:0.7rem;">${layer.scale.toFixed(2)}</span>`;
    scaleRow.querySelector('input').addEventListener('input', (e) => { layer.scale = parseFloat(e.target.value); scaleRow.querySelector('span:last-child').innerText = layer.scale.toFixed(2); generateOverlayTexture(); });
    extraDiv.appendChild(scaleRow);
    const syncRow = document.createElement('div'); syncRow.style.display = 'flex'; syncRow.style.alignItems = 'center'; syncRow.style.gap = '6px';
    const syncCheck = document.createElement('input'); syncCheck.type = 'checkbox'; syncCheck.checked = layer.syncWithPattern || false;
    syncCheck.addEventListener('change', (e) => { layer.syncWithPattern = e.target.checked; generateOverlayTexture(); });
    syncRow.appendChild(syncCheck); syncRow.appendChild(document.createTextNode('Синхр.')); extraDiv.appendChild(syncRow);
    const tileRow = document.createElement('div'); tileRow.style.display = 'flex'; tileRow.style.alignItems = 'center'; tileRow.style.gap = '6px';
    tileRow.innerHTML = `<span style="font-size:0.7rem;">Повт X:</span><input type="number" min="1" max="10" step="1" value="${layer.tileX || 1}" style="width:50px;"><span style="font-size:0.7rem;">Y:</span><input type="number" min="1" max="10" step="1" value="${layer.tileY || 1}" style="width:50px;">`;
    const inpX = tileRow.querySelector('input:first-of-type'), inpY = tileRow.querySelector('input:last-of-type');
    inpX.addEventListener('change', () => { layer.tileX = Math.max(1, parseInt(inpX.value) || 1); generateOverlayTexture(); });
    inpY.addEventListener('change', () => { layer.tileY = Math.max(1, parseInt(inpY.value) || 1); generateOverlayTexture(); });
    extraDiv.appendChild(tileRow);
    div.appendChild(extraDiv);
    div.addEventListener('click', (e) => { if (!e.target.closest('.layer-controls')) selectLayer(layer.id); });
    overlayLayersDiv.appendChild(div);
  });
  if (selectedLayerId && layerOpacitySlider) {
    const layer = layers.find(l => l.id === selectedLayerId);
    if (layer) { layerOpacitySlider.value = layer.opacity; if (layerOpacityVal) layerOpacityVal.innerText = layer.opacity.toFixed(2); }
  }
}
function selectLayer(id) { selectedLayerId = id; updateLayersUI(); }
function deleteLayerById(id) {
  const idx = layers.findIndex(l => l.id === id);
  if (idx !== -1) { layers.splice(idx,1); if (selectedLayerId === id) selectedLayerId = null; generateOverlayTexture(); updateLayersUI(); }
}
document.getElementById('clearOverlayBtn')?.addEventListener('click', () => { layers = []; selectedLayerId = null; generateOverlayTexture(); updateLayersUI(); });
if (layerOpacitySlider) {
  layerOpacitySlider.addEventListener('input', () => {
    if (selectedLayerId) {
      const layer = layers.find(l => l.id === selectedLayerId);
      if (layer) { layer.opacity = parseFloat(layerOpacitySlider.value); if (layerOpacityVal) layerOpacityVal.innerText = layer.opacity.toFixed(2); generateOverlayTexture(); updateLayersUI(); }
    }
  });
}

// ---- Загрузка слоёв ----
async function loadFilesAsLayers(files) {
  for (const file of files) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    layers.push({ id: Math.random().toString(36) + Date.now(), imgElement: img, name: file.name, x: 0.5, y: 0.5, scale: 0.4, rotation: 0, mirror: 0, opacity: 1.0, syncWithPattern: false, tileX: 1, tileY: 1, replaceMode: false, width: img.width, height: img.height });
    selectLayer(layers[layers.length-1].id);
  }
  generateOverlayTexture(); updateLayersUI();
}
document.getElementById('multiTextureInput')?.addEventListener('change', async (e) => { if (e.target.files.length) await loadFilesAsLayers(Array.from(e.target.files)); e.target.value = ''; });

const canvas2dElem = renderer2d.domElement;
canvas2dElem.style.cursor = 'crosshair';
canvas2dElem.addEventListener('dragover', (e) => { e.preventDefault(); canvas2dElem.style.border = '2px dashed #4CC9F0'; });
canvas2dElem.addEventListener('dragleave', () => { canvas2dElem.style.border = 'none'; });
canvas2dElem.addEventListener('drop', async (e) => { e.preventDefault(); canvas2dElem.style.border = 'none'; const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')); if (files.length) await loadFilesAsLayers(files); });
function getCanvasCoords(e) {
  const rect = canvas2dElem.getBoundingClientRect();
  const scaleX = canvas2dElem.width / rect.width, scaleY = canvas2dElem.height / rect.height;
  let clientX, clientY;
  if (e.touches) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; } else { clientX = e.clientX; clientY = e.clientY; }
  let canvasX = (clientX - rect.left) * scaleX, canvasY = (clientY - rect.top) * scaleY;
  canvasX = Math.min(Math.max(0, canvasX), canvas2dElem.width); canvasY = Math.min(Math.max(0, canvasY), canvas2dElem.height);
  return { x: canvasX / canvas2dElem.width, y: canvasY / canvas2dElem.height };
}
canvas2dElem.addEventListener('mousedown', (e) => {
  e.preventDefault(); const uv = getCanvasCoords(e);
  let hitLayer = null;
  for (let i = layers.length-1; i >= 0; i--) {
    const l = layers[i];
    if (l.tileX > 1 || l.tileY > 1 || l.syncWithPattern) continue;
    let dx = uv.x - l.x, dy = uv.y - l.y;
    const ang = -l.rotation * Math.PI / 180, cos = Math.cos(ang), sin = Math.sin(ang);
    const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
    const halfW = (l.width / 1024) * l.scale * 0.5, halfH = (l.height / 1024) * l.scale * 0.5;
    if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) { hitLayer = l; break; }
  }
  if (hitLayer) { selectLayer(hitLayer.id); isDraggingLayer = true; dragStart = { x: uv.x, y: uv.y, layerX: hitLayer.x, layerY: hitLayer.y }; canvas2dElem.style.cursor = 'grabbing'; }
  else selectLayer(null);
});
window.addEventListener('mousemove', (e) => {
  if (!isDraggingLayer || selectedLayerId === null) return;
  const uv = getCanvasCoords(e); const layer = layers.find(l => l.id === selectedLayerId);
  if (layer) {
    let newX = dragStart.layerX + (uv.x - dragStart.x), newY = dragStart.layerY + (uv.y - dragStart.y);
    newX = Math.min(Math.max(0, newX), 1); newY = Math.min(Math.max(0, newY), 1);
    layer.x = newX; layer.y = newY; generateOverlayTexture(); updateLayersUI();
  }
});
window.addEventListener('mouseup', () => { isDraggingLayer = false; if (zoomPanContainer) zoomPanContainer.style.cursor = 'grab'; });
canvas2dElem.addEventListener('wheel', (e) => {
  e.preventDefault(); if (selectedLayerId === null) return;
  const layer = layers.find(l => l.id === selectedLayerId); if (!layer) return;
  const delta = e.deltaY > 0 ? -0.05 : 0.05;
  if (e.ctrlKey) { if (!layer.syncWithPattern) layer.rotation = (layer.rotation + delta * 20) % 360; }
  else { let newScale = layer.scale + delta; newScale = Math.min(Math.max(0.1, newScale), 2.0); layer.scale = newScale; }
  generateOverlayTexture(); updateLayersUI();
});

document.getElementById('export2DBtn')?.addEventListener('click', async () => {
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
    const content = await zip.generateAsync({type: "blob"});
    downloadBlob(content, `pbr_${res}.zip`);
  } else if (format === 'svg') {
    const imgData = renderer2d.domElement.toDataURL('image/png');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${res}" height="${res}" viewBox="0 0 ${res} ${res}"><image width="${res}" height="${res}" href="${imgData}"/></svg>`;
    downloadBlob(new Blob([svg], {type:'image/svg+xml'}), `texture.svg`);
  } else {
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const exportCanvas = document.createElement('canvas'); exportCanvas.width = res; exportCanvas.height = res;
    exportCanvas.getContext('2d').drawImage(renderer2d.domElement, 0, 0, res, res);
    exportCanvas.toBlob(blob => downloadBlob(blob, `texture.${format}`), mime, 0.95);
  }
});
document.getElementById('exportModelBtn')?.addEventListener('click', async () => {
  const format = document.getElementById('exportModelFormat').value;
  try {
    // Генерируем текстуру из текущего шейдера (без оверлея, только паттерн)
    const textureBlob = await captureTextureImage();
    const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = URL.createObjectURL(textureBlob); });
    const texture = new THREE.CanvasTexture(img);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(uniforms.uTile3DScale.value, uniforms.uTile3DScale.value);
    const mat = new THREE.MeshStandardMaterial({ map: texture });
    let exportScene = new THREE.Scene();
    let meshToExport;
    if (customModel) {
      const cloned = customModel.clone();
      cloned.traverse(ch => { if(ch.isMesh) { ch.material = mat; ch.material.map = texture; } });
      exportScene.add(cloned);
      meshToExport = cloned;
    } else {
      const geom = createGeometry(currentGeometryType);
      meshToExport = new THREE.Mesh(geom, mat);
      exportScene.add(meshToExport);
    }
    // Обновляем UV-повтор для текстуры
    if (meshToExport) {
      meshToExport.traverse(ch => {
        if (ch.isMesh && ch.material) {
          ch.material.map = texture;
          ch.material.map.wrapS = THREE.RepeatWrapping;
          ch.material.map.wrapT = THREE.RepeatWrapping;
          ch.material.map.repeat.set(uniforms.uTile3DScale.value, uniforms.uTile3DScale.value);
        }
      });
    }
    if (format === 'glb') {
      new GLTFExporter().parse(exportScene, result => downloadBlob(new Blob([result], {type:'application/octet-stream'}), 'model.glb'), {binary:true});
    } else if (format === 'gltf') {
      new GLTFExporter().parse(exportScene, (result) => { const jsonStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2); downloadBlob(new Blob([jsonStr], {type:'application/json'}), 'model.gltf'); }, {binary: false});
    } else if (format === 'obj') {
      const obj = new OBJExporter().parse(exportScene);
      const mtl = `newmtl material0\nmap_Kd texture.png\n`;
      const zip = new JSZip(); zip.file("model.obj", obj); zip.file("model.mtl", mtl); zip.file("texture.png", textureBlob);
      downloadBlob(await zip.generateAsync({type: "blob"}), 'model_obj.zip');
    }
  } catch(e) { alert("Ошибка экспорта: "+e.message); }
});
function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function cloneUniforms(src) { const dst = {}; for (const key in src) dst[key] = { value: src[key].value }; return dst; }

async function renderPBRMap(res, type) {
  const modeMap = { 'basecolor': 0, 'normal': 1, 'roughness': 2, 'metallic': 3, 'height': 4, 'ao': 5 };
  const tuni = cloneUniforms(uniforms);
  tuni.uUseOverlay = { value: 0 };
  tuni.uShowRelief = { value: 0 };
  tuni.uExportMode = { value: modeMap[type] !== undefined ? modeMap[type] : 0 };
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
async function captureTextureImage() {
  const tuni = cloneUniforms(uniforms);
  tuni.uShowRelief = { value: 0 };
  tuni.uUseOverlay = { value: 0 };
  tuni.uExportMode = { value: 0 };
  const sc = new THREE.Scene(); const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); cam.position.z = 1;
  const mat = new THREE.ShaderMaterial({ uniforms: tuni, vertexShader, fragmentShader });
  sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  offscreenRenderer.setSize(1024, 1024);
  offscreenRenderer.render(sc, cam);
  const blob = await new Promise(r => offscreenRenderer.domElement.toBlob(r, 'image/png'));
  mat.dispose();
  return blob;
}

const menuToggle = document.getElementById('menuToggle');
const patternBar = document.getElementById('patternBar');
const menuOverlay = document.getElementById('menuOverlay');
function openMenu() { patternBar.classList.add('open'); menuOverlay.classList.add('active'); document.body.style.overflow = 'hidden'; }
function closeMenu() { patternBar.classList.remove('open'); menuOverlay.classList.remove('active'); document.body.style.overflow = ''; }
menuToggle?.addEventListener('click', (e) => { e.stopPropagation(); if (patternBar.classList.contains('open')) closeMenu(); else openMenu(); });
menuOverlay?.addEventListener('click', closeMenu);
let touchStartX = 0, touchEndX = 0;
patternBar?.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
patternBar?.addEventListener('touchend', e => {
  touchEndX = e.changedTouches[0].screenX;
  if (touchStartX - touchEndX > 50) closeMenu();
}, {passive: true});

function initAccordion() {
  const headers = document.querySelectorAll('.accordion-header');
  headers.forEach(header => {
    // Убираем старые обработчики, чтобы не дублировать
    header.removeEventListener('click', header._clickHandler);
    const handler = () => {
      const group = header.closest('.accordion-group');
      if (group) {
        group.classList.toggle('open');
      }
    };
    header.addEventListener('click', handler);
    header._clickHandler = handler;
  });
  // На десктопе оставляем все открытыми по умолчанию? Нет, пусть пользователь сам решает.
  // Если хотите, чтобы некоторые были открыты по умолчанию — добавьте класс open в HTML.
}
// Вызываем после загрузки DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAccordion);
} else {
  initAccordion();
}

function initMobileTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = {
    texture: document.getElementById('tab-texture'),
    view3d: document.getElementById('tab-view3d'),
    pbr: document.getElementById('tab-pbr')
  };
  if (!tabs.length) return;
  const activateTab = (target) => {
    tabs.forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${target}"]`).classList.add('active');
    Object.values(contents).forEach(content => content?.classList.remove('active'));
    if (target === 'texture') contents.texture?.classList.add('active');
    if (target === 'view3d') contents.view3d?.classList.add('active');
    if (target === 'pbr') contents.pbr?.classList.add('active');
    setTimeout(() => { updateSizes(); renderer2d.render(scene2d, camera2d); renderer3d.render(scene3d, camera3d); }, 50);
  };
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      activateTab(target);
    });
  });
  if (!document.querySelector('.tab-content.active')) {
    activateTab('texture');
  }
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 860) {
      const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
      if (activeTab) activateTab(activeTab);
    }
  });
}

function initIntegration() {
  const btn = document.getElementById('integrationDownloadBtn');
  const select = document.getElementById('integrationSelect');
  if (btn && select) {
    btn.addEventListener('click', () => {
      const engine = select.value;
      let url = '';
      if (engine === 'blender') url = 'https://github.com/PatternForge/blender-addon/releases/latest/download/patternforge_blender.zip';
      else if (engine === 'unity') url = 'https://github.com/PatternForge/unity-package/releases/latest/download/PatternForge.unitypackage';
      else if (engine === 'godot') url = 'https://github.com/PatternForge/godot-plugin/releases/latest/download/patternforge_godot.zip';
      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        a.target = '_blank';
        a.click();
      } else {
        alert(`Скачивание аддона для ${select.options[select.selectedIndex]?.text} временно недоступно.`);
      }
    });
  }
}

function animate() {
  requestAnimationFrame(animate);
  uniforms.uTime.value += 0.01;
  renderer2d.render(scene2d, camera2d);
  controls3d.update();
  renderer3d.render(scene3d, camera3d);
}
animate();
update3dModel();
generateOverlayTexture();
initMobileTabs();
initIntegration();
