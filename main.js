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
// Sólo cuentan los ejes encendidos con los botones; al principio, ninguno.
const active = new Array(K).fill(false);
const fade = new Float32Array(K);                // 0..1, sigue a `active` con animación
function targetPositions() {
  const raw = DATA.map(p => {
    const out = new THREE.Vector3();
    p.v.forEach((v, i) => { if (active[i]) out.addScaledVector(DIRS[i], lean(v)); });
    return out;
  });
  const maxLen = Math.max(1e-6, ...raw.map(v => v.length()));
  return raw.map(v => v.multiplyScalar((R * 0.82) / maxLen));
}
const POS = DATA.map(() => new THREE.Vector3());  // posición actual (animada)
let TARGET = targetPositions();

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
const axisLines = DIRS.map(d => {
  const g = new THREE.BufferGeometry().setFromPoints([d.clone().multiplyScalar(-R), d.clone().multiplyScalar(R)]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0 }));
  l.visible = false;
  scene.add(l);
  return l;
});

// Polos: nodos negros + etiquetas
const poleNodes = [];
const poleGeo = new THREE.SphereGeometry(0.16, 16, 12);
const inkMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
PROPS.forEach((p, i) => {
  for (const side of ['a', 'b']) {
    const pos = DIRS[i].clone().multiplyScalar(side === 'a' ? -R : R);
    const m = new THREE.Mesh(poleGeo, inkMat);
    m.position.copy(pos);
    m.scale.setScalar(0);
    scene.add(m);

    const el = document.createElement('div');
    el.className = 'pole';
    el.innerHTML = `<b>${p.num} · ${p.titulo} · ${side === 'a' ? '0' : '100'}</b>${p[side]}`;
    el.style.pointerEvents = 'auto';
    const lab = new CSS2DObject(el);
    lab.position.copy(pos.clone().multiplyScalar(1.07));
    scene.add(lab);
    const node = { axis: i, side, el, pos, mesh: m, lab };
    lab.visible = false;
    el.addEventListener('click', e => { e.stopPropagation(); selectPole(node); });
    poleNodes.push(node);
  }
});

// Personas: esferas instanciadas; tamaño según intensidad media
const dotGeo = new THREE.SphereGeometry(1, 14, 10);
const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const dots = new THREE.InstancedMesh(dotGeo, dotMat, N);
const BASE_SCALE = [];
const FACTOR = new Float32Array(N).fill(1);      // agrandado por hover o selección
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

// Hilos negros; la fuerza (0 = invisible, 1 = negro) va en el alfa, por el fundido del eje.
let strength = null;
function paintThreads(strengthOf = strength) {
  strength = strengthOf;
  for (let s = 0; s < N * K; s++) {
    const k = strengthOf(s) * fade[s % K];
    tCol[s * 8 + 3] = k;
    tCol[s * 8 + 7] = k;
  }
  threadGeo.attributes.color.needsUpdate = true;
}
const idle = s => 0.16 * WEIGHT[s] ** 1.5;
paintThreads(idle);

// ---------- Selección ----------
const panel = document.getElementById('panel');
const filterEl = document.getElementById('filter');
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
const M = new THREE.Matrix4();
function placeDot(i) {
  const s = BASE_SCALE[i] * FACTOR[i];
  M.makeScale(s, s, s).setPosition(POS[i]);
  dots.setMatrixAt(i, M);
}
function scaleDot(i, f) {
  FACTOR[i] = f;
  placeDot(i);
  dots.instanceMatrix.needsUpdate = true;
}

function clear() {
  if (selected >= 0) scaleDot(selected, 1);
  selected = -1;
  selectedPole = null;
  filterEl.hidden = true;
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
  filterEl.textContent = `${count} de ${N} se inclinan hacia «${PROPS[node.axis][node.side]}»`;
  filterEl.hidden = false;
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
  else clear();
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
document.getElementById('close').addEventListener('click', clear);
window.addEventListener('keydown', e => { if (e.key === 'Escape') clear(); });

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

// ---------- Botones de las 7 proposiciones ----------
const axesNav = document.getElementById('axes');
// Promedio y desviación estándar (muestral) de cada proposición
const STATS = PROPS.map((_, i) => {
  const xs = DATA.map(p => p.v[i]);
  const mean = xs.reduce((s, x) => s + x, 0) / N;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (N - 1));
  return { mean, sd };
});
const axisBtns = PROPS.map((p, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-pressed', 'false');
  const { mean, sd } = STATS[i];
  // Gana la proposición hacia la que cae el promedio; a menos de 5 puntos de 50 es un triunfo ajustado
  const wins = mean < 50 ? 'a' : 'b';
  const close = Math.abs(mean - 50) < 5;
  b.title = `Gana: «${p[wins]}»${close ? ' (por poco)' : ''}\nPromedio ${mean.toFixed(1)} · desviación estándar ${sd.toFixed(1)}\n0 = ${p.a}\n100 = ${p.b}`;
  b.innerHTML = `<i class="stat">${Math.round(mean)}<small>±${Math.round(sd)}</small><em class="kw${close ? ' close' : ''}">${p['k' + wins]}</em></i><span>${p.num}</span> ${p.titulo}`;
  b.addEventListener('click', () => toggleAxis(i));
  axesNav.appendChild(b);
  return b;
});
function toggleAxis(i) {
  active[i] = !active[i];
  axisBtns[i].setAttribute('aria-pressed', String(active[i]));
  if (!active[i] && selectedPole && selectedPole.axis === i) clear();
  TARGET = targetPositions();
}
window.addEventListener('keydown', e => {
  const n = Number(e.key);
  if (n >= 1 && n <= K && !e.metaKey && !e.ctrlKey) toggleAxis(n - 1);
});

// Anima el fundido de los ejes y el desplazamiento de los puntos hacia su destino
function animate() {
  let fading = false, moving = false;
  for (let a = 0; a < K; a++) {
    const goal = active[a] ? 1 : 0;
    if (fade[a] === goal) continue;
    fade[a] += (goal - fade[a]) * 0.12;
    if (Math.abs(goal - fade[a]) < 0.004) fade[a] = goal;
    fading = true;
    const f = fade[a];
    axisLines[a].visible = f > 0;
    axisLines[a].material.opacity = f;
  }
  if (fading) poleNodes.forEach(n => {
    const f = fade[n.axis];
    n.mesh.scale.setScalar(f);
    n.lab.visible = f > 0.02;
    n.el.style.setProperty('--fade', f.toFixed(2));
  });
  for (let i = 0; i < N; i++) {
    const p = POS[i], t = TARGET[i];
    if (p.distanceToSquared(t) < 1e-6) { if (!p.equals(t)) { p.copy(t); moving = true; } continue; }
    p.lerp(t, 0.08);
    moving = true;
  }
  if (moving) {
    for (let i = 0; i < N; i++) {
      placeDot(i);
      for (let a = 0; a < K; a++) tPos.set([POS[i].x, POS[i].y, POS[i].z], (i * K + a) * 6);
    }
    dots.instanceMatrix.needsUpdate = true;
    threadGeo.attributes.position.needsUpdate = true;
    dots.computeBoundingSphere();
    if (selected >= 0) who.position.copy(POS[selected]);
  }
  if (fading) paintThreads();
}

renderer.setAnimationLoop(() => {
  animate();
  controls.update();
  depthFade();
  renderer.render(scene, camera);
  labels.render(scene, camera);
});
