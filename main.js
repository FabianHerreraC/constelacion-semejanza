import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DATA } from './data.js';
import { PROPS } from './props.js';

const R = 10;            // radio de la esfera de polos
const N = DATA.length;
const K = PROPS.length;

// ---------- Ejes: 7 direcciones cuyos 14 polos (±d) quedan repartidos en la esfera ----------
function axisDirections(k) {
  const g = Math.PI * (3 - Math.sqrt(5));
  let d = [];
  for (let i = 0; i < k; i++) {                 // Fibonacci en la semiesfera superior
    const y = 1 - (i + 0.5) / k;
    const r = Math.sqrt(1 - y * y);
    d.push(new THREE.Vector3(Math.cos(g * i) * r, y, Math.sin(g * i) * r));
  }
  for (let it = 0; it < 400; it++) {            // repulsión entre los 14 polos
    const f = d.map(() => new THREE.Vector3());
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      if (i === j) continue;
      for (const s of [1, -1]) {
        const diff = d[i].clone().sub(d[j].clone().multiplyScalar(s));
        const l = Math.max(diff.length(), 1e-3);
        f[i].add(diff.multiplyScalar(1 / (l * l * l)));
      }
    }
    d = d.map((v, i) => v.add(f[i].multiplyScalar(0.01)).normalize());
  }
  return d;
}
const DIRS = axisDirections(K);

// ---------- Posiciones: proyección lineal 7D → 3D ----------
const lean = v => v / 50 - 1;                    // 0..100 → −1..1
const raw = DATA.map(p => {
  const out = new THREE.Vector3();
  p.v.forEach((v, i) => out.addScaledVector(DIRS[i], lean(v)));
  return out;
});
const maxLen = Math.max(...raw.map(v => v.length()));
const POS = raw.map(v => v.multiplyScalar((R * 0.82) / maxLen));

// ---------- Escena ----------
const stage = document.getElementById('stage');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
camera.position.set(0, 4, 34);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.appendChild(renderer.domElement);

const labels = new CSS2DRenderer();
labels.domElement.style.position = 'absolute';
labels.domElement.style.inset = '0';
labels.domElement.style.pointerEvents = 'none';
stage.appendChild(labels.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.minDistance = 8;
controls.maxDistance = 90;
controls.addEventListener('start', () => { controls.autoRotate = false; });

// Ejes: una línea tenue de polo a polo
{
  const g = new THREE.BufferGeometry();
  const a = [];
  DIRS.forEach(d => { a.push(...d.clone().multiplyScalar(-R).toArray(), ...d.clone().multiplyScalar(R).toArray()); });
  g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe6e6e6 })));
}

// Polos: nodos negros + etiquetas
const poleNodes = [];
const poleGeo = new THREE.SphereGeometry(0.16, 16, 12);
const inkMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
PROPS.forEach((p, i) => {
  for (const side of ['a', 'b']) {
    const pos = DIRS[i].clone().multiplyScalar(side === 'a' ? -R : R);
    const m = new THREE.Mesh(poleGeo, inkMat);
    m.position.copy(pos);
    scene.add(m);

    const el = document.createElement('div');
    el.className = 'pole';
    el.innerHTML = `<b>${p.num} · ${p.titulo} · ${side === 'a' ? '0' : '100'}</b>${p[side]}`;
    el.style.pointerEvents = 'auto';
    const lab = new CSS2DObject(el);
    lab.position.copy(pos.clone().multiplyScalar(1.07));
    scene.add(lab);
    const node = { axis: i, side, el, pos };
    el.addEventListener('click', e => { e.stopPropagation(); selectPole(node); });
    poleNodes.push(node);
  }
});

// Personas: esferas instanciadas; tamaño según intensidad media
const dotGeo = new THREE.SphereGeometry(1, 14, 10);
const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const dots = new THREE.InstancedMesh(dotGeo, dotMat, N);
const BASE_SCALE = [];
const INK = new THREE.Color(0x111111), GHOST = new THREE.Color(0xd0d0d0), HOT = new THREE.Color(0x000000);
{
  const m = new THREE.Matrix4();
  DATA.forEach((p, i) => {
    const intensity = p.v.reduce((s, v) => s + Math.abs(lean(v)), 0) / K;
    const s = 0.045 + 0.1 * intensity;
    BASE_SCALE.push(s);
    m.makeScale(s, s, s).setPosition(POS[i]);
    dots.setMatrixAt(i, m);
    dots.setColorAt(i, INK);
  });
}
dots.renderOrder = 2;
scene.add(dots);

// Hilos: de cada persona al polo hacia el que se inclina, con opacidad ∝ |inclinación|
const threadGeo = new THREE.BufferGeometry();
const tPos = new Float32Array(N * K * 6);
const tCol = new Float32Array(N * K * 8);   // RGBA por vértice
const WEIGHT = new Float32Array(N * K);
DATA.forEach((p, i) => {
  p.v.forEach((v, a) => {
    const l = lean(v);
    const pole = DIRS[a].clone().multiplyScalar(l < 0 ? -R : R);
    const o = (i * K + a) * 6;
    tPos.set(POS[i].toArray(), o);
    tPos.set(pole.toArray(), o + 3);
    WEIGHT[i * K + a] = Math.abs(l);
  });
});
threadGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
threadGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 4));
const threads = new THREE.LineSegments(threadGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
threads.renderOrder = 1;
scene.add(threads);

// Hilos negros; la fuerza (0 = invisible, 1 = negro) va en el alfa.
function paintThreads(strengthOf) {
  for (let s = 0; s < N * K; s++) {
    const k = strengthOf(s);
    tCol[s * 8 + 3] = k;
    tCol[s * 8 + 7] = k;
  }
  threadGeo.attributes.color.needsUpdate = true;
}
const idle = s => 0.16 * WEIGHT[s] ** 1.5;
paintThreads(idle);

// ---------- Selección ----------
const panel = document.getElementById('panel');
const whoEl = document.createElement('div');
whoEl.className = 'who';
const who = new CSS2DObject(whoEl);
who.visible = false;
scene.add(who);

let hovered = -1, selected = -1, selectedPole = null;

function tintDots(fn) {
  for (let i = 0; i < N; i++) dots.setColorAt(i, fn(i));
  dots.instanceColor.needsUpdate = true;
}
function scaleDot(i, f) {
  const m = new THREE.Matrix4();
  const s = BASE_SCALE[i] * f;
  m.makeScale(s, s, s).setPosition(POS[i]);
  dots.setMatrixAt(i, m);
  dots.instanceMatrix.needsUpdate = true;
}

function clear() {
  if (selected >= 0) scaleDot(selected, 1);
  selected = -1;
  selectedPole = null;
  who.visible = false;
  panel.hidden = true;
  poleNodes.forEach(n => n.el.classList.remove('on', 'dim'));
  tintDots(() => INK);
  paintThreads(idle);
}

function selectPerson(i) {
  clear();
  selected = i;
  const p = DATA[i];
  scaleDot(i, 1.9);
  tintDots(j => (j === i ? HOT : GHOST));
  paintThreads(s => (Math.floor(s / K) === i ? 0.25 + 0.75 * WEIGHT[s] : 0.04 * WEIGHT[s]));
  poleNodes.forEach(n => {
    const l = lean(p.v[n.axis]);
    const toward = (l < 0 && n.side === 'a') || (l > 0 && n.side === 'b');
    n.el.classList.toggle('dim', !toward);
  });

  whoEl.textContent = p.n || '—';
  who.position.copy(POS[i]);
  who.visible = true;

  document.getElementById('p-name').textContent = p.n || '—';
  document.getElementById('p-meta').textContent = `Aparición ${p.a} · ${p.h}`;
  document.getElementById('p-rows').innerHTML = PROPS.map((q, a) => {
    const v = p.v[a];
    return `<li>
      <div class="t"><span>${q.num} ${q.titulo}</span><strong>${v}</strong></div>
      <div class="bar"><span class="dot" style="left:${v}%"></span></div>
      <div class="ends"><span class="${v < 50 ? 'lean' : ''}">${q.a}</span><span class="${v > 50 ? 'lean' : ''}">${q.b}</span></div>
    </li>`;
  }).join('');
  panel.hidden = false;
}

function selectPole(node) {
  const same = selectedPole === node;
  clear();
  if (same) return;
  selectedPole = node;
  const toward = i => {
    const v = DATA[i].v[node.axis];
    return node.side === 'a' ? v < 50 : v > 50;
  };
  node.el.classList.add('on');
  poleNodes.forEach(n => { if (n !== node) n.el.classList.add('dim'); });
  tintDots(i => (toward(i) ? HOT : GHOST));
  paintThreads(s => {
    const i = Math.floor(s / K), a = s % K;
    return a === node.axis && toward(i) ? 0.15 + 0.55 * WEIGHT[s] : 0.03 * WEIGHT[s];
  });
  const count = DATA.filter((_, i) => toward(i)).length;
  document.getElementById('count').textContent = `${count} de ${N}`;
}

// Picking
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  // Para que los puntos pequeños sean fáciles de tocar, se toma el más cercano al rayo en pantalla.
  let best = -1, bestD = Infinity;
  const tol = ev.pointerType === 'touch' ? 22 : 12;
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    v.copy(POS[i]).project(camera);
    const dx = (v.x - ndc.x) * r.width / 2, dy = (v.y - ndc.y) * r.height / 2;
    const d = Math.hypot(dx, dy);
    if (d < tol && (d < bestD - 2 || (Math.abs(d - bestD) <= 2 && v.z < 0))) { best = i; bestD = d; }
  }
  return best;
}

let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const i = pick(e);
  if (i >= 0) selectPerson(i);
  else { clear(); document.getElementById('count').textContent = N; }
});
renderer.domElement.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  const i = pick(e);
  if (i === hovered) return;
  if (hovered >= 0 && hovered !== selected) scaleDot(hovered, 1);
  hovered = i;
  if (i >= 0 && i !== selected) scaleDot(i, 1.6);
  stage.classList.toggle('pointing', i >= 0);
});
document.getElementById('close').addEventListener('click', () => { clear(); document.getElementById('count').textContent = N; });
window.addEventListener('keydown', e => { if (e.key === 'Escape') { clear(); document.getElementById('count').textContent = N; } });

// ---------- Pantalla completa ----------
const fsBtn = document.getElementById('fs');
const root = document.documentElement;
const canFS = root.requestFullscreen || root.webkitRequestFullscreen;
if (!canFS) fsBtn.hidden = true;
fsBtn.addEventListener('click', () => {
  const on = document.fullscreenElement || document.webkitFullscreenElement;
  if (on) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
});
const syncFS = () => {
  const on = document.fullscreenElement || document.webkitFullscreenElement;
  fsBtn.textContent = on ? 'Salir' : 'Pantalla completa';
};
document.addEventListener('fullscreenchange', syncFS);
document.addEventListener('webkitfullscreenchange', syncFS);

// ---------- Bucle ----------
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  camera.aspect = w / h;
  // Distancia para que la esfera (más el margen de las etiquetas) quepa en el lado más corto
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const tanMin = Math.min(Math.tan(half), Math.tan(half) * camera.aspect);
  const fit = (R * (w < 640 ? 1.35 : 1.25)) / tanMin + R * 0.3;
  if (!resize.done) { camera.position.setLength(fit); resize.done = true; }
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
document.getElementById('count').textContent = N;

// Las etiquetas del fondo se atenúan para que no se encimen con las del frente
const tmp = new THREE.Vector3();
function depthFade() {
  const camLen = camera.position.length();
  poleNodes.forEach(n => {
    const d = tmp.copy(n.pos).sub(camera.position).length();
    const t = THREE.MathUtils.clamp((d - (camLen - R)) / (2 * R), 0, 1); // 0 frente, 1 fondo
    n.el.style.setProperty('--depth', (1 - 0.72 * t).toFixed(2));
  });
}

renderer.setAnimationLoop(() => {
  controls.update();
  depthFade();
  renderer.render(scene, camera);
  labels.render(scene, camera);
});
