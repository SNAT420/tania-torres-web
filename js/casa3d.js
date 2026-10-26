// Visor 3D de propiedades. Arma la casa a partir de un JSON de medidas (ver /modelos/*.json).
// Unidades en metros. Eje x = frente (izquierda→derecha viendo desde la calle),
// eje z = fondo (0 = banqueta), eje y = altura.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const T = 0.06;          // grosor de cada cara interior de muro
const TE = 0.1;          // grosor del aplanado exterior
const PUERTA = 2.1, VANO = 2.25;

// ───────────────────────── Texturas hechas en canvas (sin descargar nada)
function canvasTex(size, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function ruido(ctx, s, n, alpha) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,255,255'},${Math.random() * alpha})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
}
const TEX = {
  azulejo: () => canvasTex(256, (c, s) => {          // loseta 40x40 como la actual
    c.fillStyle = '#D9D4CB'; c.fillRect(0, 0, s, s); ruido(c, s, 1800, .05);
    c.strokeStyle = '#b9b2a6'; c.lineWidth = 3;
    for (let i = 0; i <= 2; i++) { c.beginPath(); c.moveTo(i * s / 2, 0); c.lineTo(i * s / 2, s); c.moveTo(0, i * s / 2); c.lineTo(s, i * s / 2); c.stroke(); }
  }),
  porcelanato: () => canvasTex(512, (c, s) => {      // 60x120 claro
    c.fillStyle = '#D8D1C5'; c.fillRect(0, 0, s, s); ruido(c, s, 2500, .035);
    c.strokeStyle = '#c4bcae'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(s / 2, 0); c.lineTo(s / 2, s); c.moveTo(0, s / 2); c.lineTo(s / 2, s / 2); c.moveTo(s / 2, 0); c.lineTo(s, 0); c.moveTo(0, 0); c.lineTo(s / 2, 0); c.moveTo(s / 2, s * .25); c.lineTo(s, s * .25); c.moveTo(s/2, s*.75); c.lineTo(s, s*.75); c.stroke();
  }),
  madera: () => canvasTex(512, (c, s) => {
    const tonos = ['#A97E55', '#9F7550', '#B3875C', '#A27A52', '#AD8259'];
    const h = s / 8;
    for (let r = 0; r < 8; r++) {
      let x = -((r * 97) % s);
      while (x < s) {
        const w = s * (.45 + Math.random() * .4);
        c.fillStyle = tonos[(Math.random() * tonos.length) | 0]; c.fillRect(x, r * h, w, h);
        c.strokeStyle = 'rgba(60,35,15,.35)'; c.lineWidth = 2; c.strokeRect(x, r * h, w, h);
        for (let k = 0; k < 6; k++) { c.strokeStyle = 'rgba(70,40,20,.10)'; c.beginPath(); const yy = r * h + Math.random() * h; c.moveTo(x, yy); c.bezierCurveTo(x + w * .3, yy + 3, x + w * .6, yy - 3, x + w, yy); c.stroke(); }
        x += w;
      }
    }
  }),
  pasto: () => canvasTex(256, (c, s) => {
    c.fillStyle = '#5E7F3A'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 5000; i++) { c.fillStyle = `hsl(${80 + Math.random() * 30},${35 + Math.random() * 25}%,${22 + Math.random() * 22}%)`; c.fillRect(Math.random() * s, Math.random() * s, 1.5, 3); }
  }),
  concreto: () => canvasTex(256, (c, s) => {
    c.fillStyle = '#A9A59D'; c.fillRect(0, 0, s, s); ruido(c, s, 4000, .08);
    c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, s / 2); c.lineTo(s, s / 2); c.stroke();
  }),
  adoquin: () => canvasTex(256, (c, s) => {
    c.fillStyle = '#7E7870'; c.fillRect(0, 0, s, s);
    const n = 8, w = s / n;
    for (let y = 0; y < n; y++) for (let x = -1; x < n; x++) {
      const ox = (y % 2) * w / 2;
      c.fillStyle = `hsl(30,${6 + Math.random() * 6}%,${44 + Math.random() * 12}%)`;
      c.fillRect(x * w + ox + 2, y * w / 1 + 2, w - 4, w - 4);
    }
  }),
  asfalto: () => canvasTex(256, (c, s) => { c.fillStyle = '#26262a'; c.fillRect(0, 0, s, s); ruido(c, s, 6000, .12); }),
  malla: () => {
    const t = canvasTex(128, (c, s) => {
      c.clearRect(0, 0, s, s); c.strokeStyle = 'rgba(190,195,200,1)'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(s, s); c.moveTo(s, 0); c.lineTo(0, s); c.stroke();
    });
    return t;
  },
};
function texRepeat(nombre, w, d) {
  const t = TEX[nombre](); const escala = { azulejo: .8, porcelanato: 1.2, madera: 1.6, pasto: 1.5, concreto: 2, adoquin: 1.2, asfalto: 3, malla: .12 }[nombre] || 1;
  t.repeat.set(w / escala, d / escala); return t;
}

// ───────────────────────── Utilidades de geometría
function caja(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, .001), Math.max(h, .001), Math.max(d, .001)), mat);
  m.castShadow = true; m.receiveShadow = true; return m;
}
function std(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: .85, metalness: 0, ...extra }); }

// Divide un muro de largo L y alto H en rectángulos, dejando los huecos de puertas y ventanas.
function rectsMuro(u0, u1, H, huecos) {
  const hs = huecos.filter(h => h.a > u0 + .001 && h.de < u1 - .001).map(h => ({ ...h, de: Math.max(h.de, u0), a: Math.min(h.a, u1) })).sort((a, b) => a.de - b.de);
  const out = []; let u = u0;
  for (const h of hs) {
    if (h.de > u) out.push({ u0: u, u1: h.de, y0: 0, y1: H });
    if (h.y0 > 0) out.push({ u0: h.de, u1: h.a, y0: 0, y1: h.y0 });
    if (h.y1 < H) out.push({ u0: h.de, u1: h.a, y0: h.y1, y1: H });
    u = Math.max(u, h.a);
  }
  if (u < u1) out.push({ u0: u, u1, y0: 0, y1: H });
  return out;
}
function alturasHueco(a) {
  if (a.tipo === 'puerta') return [0, PUERTA];
  if (a.tipo === 'vano') return [0, VANO];
  return [a.antepecho ?? .95, PUERTA];
}

// ───────────────────────── Muebles (cajas sencillas con acabados de marca)
const M = {
  tela: std('#8C8478'), telaOsc: std('#55504A'), cojin: std('#C9B48A'), madera: std('#8A6440', { roughness: .7 }),
  maderaClara: std('#B89068', { roughness: .7 }), negro: std('#1E1E21', { roughness: .5, metalness: .3 }),
  dorado: std('#C9A96E', { roughness: .35, metalness: .8 }), blanco: std('#F3F1EC', { roughness: .4 }),
  cubierta: std('#2B2B2E', { roughness: .35 }), sabana: std('#EDEAE3'), cobija: std('#C9B48A'),
  vidrio: new THREE.MeshStandardMaterial({ color: '#cfe3ea', transparent: true, opacity: .28, roughness: .05, metalness: .1 }),
  hoja: std('#3F6B3A'), maceta: std('#2A2A2E'), tapete: std('#BDB2A0'), pantalla: std('#0c0c0e', { roughness: .2 }),
};
function mueble(f) {
  const g = new THREE.Group(); const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  switch (f.tipo) {
    case 'sofa': {
      add(caja(2.1, .42, .9, M.tela), 0, .21, 0);
      add(caja(2.1, .45, .2, M.tela), 0, .62, -.35);
      add(caja(.18, .25, .9, M.tela), -.96, .55, 0); add(caja(.18, .25, .9, M.tela), .96, .55, 0);
      add(caja(.45, .35, .12, M.cojin), -.5, .62, -.2); add(caja(.45, .35, .12, M.telaOsc), .5, .62, -.2);
      break;
    }
    case 'mesaCentro': add(caja(.9, .06, .55, M.madera), 0, .4, 0); add(caja(.8, .37, .45, M.negro), 0, .18, 0); break;
    case 'muebleTV': add(caja(1.8, .45, .4, M.madera), 0, .22, 0); add(caja(1.4, .8, .05, M.pantalla), 0, 1.2, -.17); add(caja(1.8, .02, .4, M.dorado), 0, .455, 0); break;
    case 'comedor': {
      add(caja(1.4, .05, .85, M.maderaClara), 0, .75, 0);
      add(caja(.08, .72, .08, M.negro), -.6, .36, -.33); add(caja(.08, .72, .08, M.negro), .6, .36, -.33);
      add(caja(.08, .72, .08, M.negro), -.6, .36, .33); add(caja(.08, .72, .08, M.negro), .6, .36, .33);
      for (const [x, z, r] of [[-.35, -.62, 0], [.35, -.62, 0], [-.35, .62, Math.PI], [.35, .62, Math.PI]]) {
        const s = new THREE.Group(); const en = (m, a, b, c) => { m.position.set(a, b, c); s.add(m); };
        en(caja(.42, .05, .42, M.tela), 0, .45, 0);
        en(caja(.42, .45, .05, M.tela), 0, .7, -.19);
        for (const [a, b] of [[-.18, -.18], [.18, -.18], [-.18, .18], [.18, .18]]) en(caja(.03, .45, .03, M.negro), a, .22, b);
        s.position.set(x, 0, z); s.rotation.y = r; g.add(s);
      }
      break;
    }
    case 'lampara': {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(.08, .32, .25, 24, 1, true), M.dorado); l.position.y = 2.0; l.material.side = THREE.DoubleSide; g.add(l);
      add(caja(.01, .35, .01, M.negro), 0, 2.3, 0);
      const luz = new THREE.PointLight('#ffd9a0', 1.6, 4, 1.5); luz.position.y = 1.85; g.add(luz);
      break;
    }
    case 'planta': {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(.17, .13, .4, 20), M.maceta); m.position.y = .2; m.castShadow = true; g.add(m);
      for (let i = 0; i < 7; i++) { const h = new THREE.Mesh(new THREE.SphereGeometry(.16 + Math.random() * .06, 10, 8), M.hoja); h.position.set((Math.random() - .5) * .25, .55 + Math.random() * .45, (Math.random() - .5) * .25); h.castShadow = true; g.add(h); }
      break;
    }
    case 'tapete': add(new THREE.Mesh(new THREE.BoxGeometry(f.w || 2, .012, f.d || 1.5), M.tapete), 0, .006, 0).receiveShadow = true; break;
    case 'cocina': {
      const L = f.largo || 2.2; const refri = .75;
      add(caja(L - refri, .86, .6, M.blanco), -refri / 2, .43, 0);
      add(caja(L - refri, .04, .62, M.cubierta), -refri / 2, .88, 0);
      add(caja(L - refri, .7, .35, M.blanco), -refri / 2, 1.85, -.13);
      add(caja(.5, .02, .4, M.negro), -refri / 2 - .3, .905, .02);
      add(caja(.7, 1.8, .65, std('#9DA0A4', { metalness: .6, roughness: .3 })), L / 2 - refri / 2, .9, 0);
      for (let i = 0; i < 3; i++) add(caja(.25, .015, .015, M.dorado), -L / 2 + .3 + i * .5, .78, .31);
      break;
    }
    case 'wc': add(caja(.38, .4, .5, M.blanco), 0, .2, .05); add(caja(.4, .4, .18, M.blanco), 0, .55, -.22); break;
    case 'lavabo': add(caja(.6, .5, .45, M.madera), 0, .55, 0); add(caja(.62, .06, .47, M.blanco), 0, .83, 0); add(caja(.5, .7, .02, std('#dfe8ea', { metalness: .9, roughness: .05 })), 0, 1.45, -.21); add(caja(.52, .02, .02, M.dorado), 0, 1.81, -.2); break;
    case 'regadera': {
      const s = .9; add(caja(s, .05, s, M.blanco), 0, .025, 0);
      add(caja(s, 1.95, .015, M.vidrio), 0, 1.0, s / 2); add(caja(.015, 1.95, s, M.vidrio), s / 2, 1.0, 0);
      add(caja(.02, 1.95, .02, M.dorado), s / 2, 1.0, s / 2);
      add(caja(.2, .02, .2, M.dorado), -.2, 2.05, -.2);
      break;
    }
    case 'cama': {
      const A = f.ancho || 1.4;
      add(caja(A, .3, 2.0, M.madera), 0, .15, 0); add(caja(A - .04, .2, 1.95, M.sabana), 0, .4, .01);
      add(caja(A, 1.0, .08, M.telaOsc), 0, .5, -1.0);
      add(caja(A - .04, .05, 1.0, M.cobija), 0, .52, .45);
      add(caja(A * .4, .12, .35, M.blanco), -A * .23, .56, -.75); add(caja(A * .4, .12, .35, M.blanco), A * .23, .56, -.75);
      break;
    }
    case 'buro': add(caja(.45, .5, .4, M.madera), 0, .25, 0); add(caja(.12, .3, .12, M.dorado), 0, .65, 0); break;
    case 'closet': { const L = f.largo || 1.8; add(caja(L, 2.3, .6, M.maderaClara), 0, 1.15, 0); add(caja(.01, 2.25, .61, M.negro), 0, 1.15, 0); add(caja(.02, .4, .03, M.dorado), -.08, 1.15, .31); add(caja(.02, .4, .03, M.dorado), .08, 1.15, .31); break; }
    case 'escritorio': add(caja(1.2, .04, .55, M.maderaClara), 0, .75, 0); add(caja(.04, .73, .5, M.negro), -.56, .37, 0); add(caja(.04, .73, .5, M.negro), .56, .37, 0); add(caja(.45, .05, .45, M.tela), 0, .46, .55); add(caja(.45, .5, .05, M.tela), 0, .73, .76); break;
  }
  g.position.set(f.x, 0, f.z); g.rotation.y = (f.rot || 0) * Math.PI / 180;
  return g;
}

// ───────────────────────── Constructor principal
export function crearVisor(contenedor, cfg, { onListo } = {}) {
  const W = cfg.lote.frente, Z0 = cfg.casa.z0, Z1 = cfg.casa.z1, H = cfg.casa.altura, LOSA = cfg.casa.losa;
  const NIV = H + LOSA;                         // altura de cada nivel
  const nPisos = cfg.pisos.length, ALTO = nPisos * NIV;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  contenedor.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0b12');
  scene.fog = new THREE.Fog('#0b0b12', 30, 70);

  const camera = new THREE.PerspectiveCamera(42, 1, .1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .08;
  controls.maxPolarAngle = Math.PI * .49; controls.minDistance = 4; controls.maxDistance = 40;
  controls.autoRotate = true; controls.autoRotateSpeed = .6;
  controls.addEventListener('start', () => { controls.autoRotate = false; camAnim = null; });

  // Luces
  scene.add(new THREE.HemisphereLight('#fff6e8', '#2a2a33', 1.1));
  const sol = new THREE.DirectionalLight('#fff1dc', 2.2);
  sol.position.set(-10, 18, -8); sol.target.position.set(W / 2, 0, (Z0 + Z1) / 2);
  sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048);
  Object.assign(sol.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 50 });
  sol.shadow.bias = -.0004; sol.shadow.normalBias = .02;
  scene.add(sol, sol.target);

  // Lo que cambia entre "Así está" y "Así podría quedar"
  const variantes = [];  // { mesh, actual: material, renovado: material }
  const soloActual = new THREE.Group(), soloRenovado = new THREE.Group();
  scene.add(soloActual, soloRenovado);
  function doble(mesh, matA, matR) { variantes.push({ mesh, actual: matA, renovado: matR }); mesh.material = matA; return mesh; }
  const matCache = {};
  const colorMat = (c) => matCache[c] || (matCache[c] = std(c, { roughness: .92 }));

  // Grupos por nivel (para cortar la casa)
  const grupoPiso = cfg.pisos.map(() => new THREE.Group());
  grupoPiso.forEach(g => scene.add(g));
  const techo = new THREE.Group(); scene.add(techo);

  // ── Terreno y calle
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), std('#121218'));
  suelo.rotation.x = -Math.PI / 2; suelo.position.y = -.02; suelo.receiveShadow = true; scene.add(suelo);
  const calle = new THREE.Mesh(new THREE.PlaneGeometry(40, 7), std('#fff', { map: texRepeat('asfalto', 40, 7) }));
  calle.rotation.x = -Math.PI / 2; calle.position.set(W / 2, -.01, -4.7); calle.receiveShadow = true; scene.add(calle);
  const banq = caja(40, .12, 1.2, std('#8d8a84')); banq.position.set(W / 2, .06, -.6); scene.add(banq);

  // Vecinos (volúmenes discretos para dar contexto)
  const matVecino = std('#3b3b45', { roughness: 1 });
  const vecinos = new THREE.Group(); scene.add(vecinos);
  for (const dx of [-W, W]) {
    const v = caja(W - .02, ALTO + .5, Z1 - Z0, matVecino); v.position.set(dx + W / 2, (ALTO + .5) / 2, (Z0 + Z1) / 2); vecinos.add(v);
    const pat = caja(W - .02, 2.4, cfg.lote.fondo - Z1, matVecino); pat.position.set(dx + W / 2, 1.2, (Z1 + cfg.lote.fondo) / 2); vecinos.add(pat);
    const lote = caja(W - .02, .05, Z0, std('#2c2c33')); lote.position.set(dx + W / 2, .02, Z0 / 2); scene.add(lote);
  }

  // ── Cochera (frente)
  const ext = cfg.exterior || {};
  {
    const pasto = new THREE.Mesh(new THREE.BoxGeometry(W, .04, Z0 - .02), std('#fff', { map: texRepeat('pasto', W, Z0) }));
    pasto.position.set(W / 2, .02, Z0 / 2); pasto.receiveShadow = true; soloActual.add(pasto);
    for (const x of [1.15, 3.1]) { const h = caja(.5, .05, Z0 - .2, std('#a8a39b')); h.position.set(x, .03, Z0 / 2); soloActual.add(h); }
    const piso = new THREE.Mesh(new THREE.BoxGeometry(W, .05, Z0 - .02), std('#fff', { map: texRepeat('adoquin', W, Z0) }));
    piso.position.set(W / 2, .025, Z0 / 2); piso.receiveShadow = true; soloRenovado.add(piso);
    const jardinera = caja(1.4, .35, .45, std('#2A2A2E')); jardinera.position.set(3.6, .18, Z0 - .4); soloRenovado.add(jardinera);
    for (let i = 0; i < 4; i++) { const h = new THREE.Mesh(new THREE.SphereGeometry(.18, 10, 8), M.hoja); h.position.set(3.1 + i * .33, .45, Z0 - .4); h.castShadow = true; soloRenovado.add(h); }
  }
  // Reja al frente
  {
    const postes = new THREE.Group();
    const matPoste = std('#9aa0a6', { metalness: .6, roughness: .4 });
    for (let x = 0; x <= W + .01; x += W / 3) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 1.7, 10), matPoste); p.position.set(x, .85, .05); p.castShadow = true; postes.add(p); }
    const malla = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.5), new THREE.MeshStandardMaterial({ map: texRepeat('malla', W, 1.5), transparent: true, alphaTest: .3, side: THREE.DoubleSide, metalness: .5, roughness: .5 }));
    malla.position.set(W / 2, .85, .05); malla.castShadow = true; postes.add(malla);
    for (const y of [1.15, 1.45, 1.7]) { const al = caja(W, .008, .008, matPoste); al.position.set(W / 2, y + .02, .05); postes.add(al); }
    soloActual.add(postes);

    const herr = new THREE.Group();
    const barra = std('#151517', { metalness: .5, roughness: .35 });
    const base = caja(W, .35, .2, std('#2A2A2E')); base.position.set(W / 2, .175, .1); herr.add(base);
    for (let x = .05; x < W; x += .11) { const b = caja(.03, 1.45, .03, barra); b.position.set(x, 1.07, .1); herr.add(b); }
    const top = caja(W, .05, .06, barra); top.position.set(W / 2, 1.8, .1); herr.add(top);
    const tope = caja(W, .02, .07, M.dorado); tope.position.set(W / 2, 1.835, .1); herr.add(tope);
    soloRenovado.add(herr);
  }

  // ── Patio (fondo)
  {
    const PZ = Z1, PF = cfg.lote.fondo, PD = PF - PZ;
    const pisoA = new THREE.Mesh(new THREE.BoxGeometry(W, .04, PD), std('#fff', { map: texRepeat('pasto', W, PD) })); pisoA.position.set(W / 2, .02, PZ + PD / 2); pisoA.receiveShadow = true; soloActual.add(pisoA);
    const pisoR = new THREE.Mesh(new THREE.BoxGeometry(W, .04, PD), std('#fff', { map: texRepeat('pasto', W, PD) })); pisoR.position.set(W / 2, .02, PZ + PD / 2); pisoR.receiveShadow = true; soloRenovado.add(pisoR);
    const deck = caja(W, .08, 1.2, std('#fff', { map: texRepeat('madera', W, 1.2) })); deck.position.set(W / 2, .04, PZ + .6); soloRenovado.add(deck);
    const pa = ext.patio?.actual || {}, pr = ext.patio?.renovado || {};
    const bardaA = colorMat(pa.barda || '#888'), bardaR = colorMat(pr.barda || '#eee');
    for (const [w, d, x, z] of [[W, .15, W / 2, PF - .075], [.15, PD, .075, PZ + PD / 2], [.15, PD, W - .075, PZ + PD / 2]]) {
      const b = caja(w, 2.4, d, bardaA); b.position.set(x, 1.2, z); doble(b, bardaA, bardaR); scene.add(b);
    }
    if (pa.techo) {
      const rej = new THREE.Group(); const m = std('#5a3d2c', { metalness: .5, roughness: .6 });
      for (let x = 0; x <= W; x += .35) { const b = caja(.025, .025, PD, m); b.position.set(x, 2.55, PZ + PD / 2); rej.add(b); }
      for (let z = PZ; z <= PF; z += .35) { const b = caja(W, .025, .025, m); b.position.set(W / 2, 2.55, z); rej.add(b); }
      soloActual.add(rej);
    }
    for (const [x, z] of [[.45, PF - .45], [W - .45, PF - .45]]) { const p = mueble({ tipo: 'planta', x, z }); p.scale.setScalar(1.4); soloRenovado.add(p); }
  }

  // ── Habitaciones, muros y losas
  const huecosPorPiso = cfg.pisos.map((_, i) => (cfg.aberturas || []).filter(a => a.piso === i).map(a => { const [y0, y1] = alturasHueco(a); return { ...a, y0, y1 }; }));
  const enLinea = (lista, eje, valor) => lista.filter(h => h.eje === eje && Math.abs(h.en - valor) < .01);
  const etiquetas = [];
  const fach = cfg.fachada;
  const exteriorDe = (lado, nivel) => {
    const k = lado === 'S' ? (nivel === 0 ? 'baja' : 'alta') : 'lateral';
    return [colorMat(fach.actual[k]), colorMat(fach.renovado[k])];
  };

  function muro(grupo, eje, en, u0, u1, desplaz, grosor, huecos, matA, matR, yBase, alto) {
    for (const r of rectsMuro(u0, u1, alto, huecos)) {
      const largo = r.u1 - r.u0, h = r.y1 - r.y0, uc = (r.u0 + r.u1) / 2;
      const m = eje === 'z' ? caja(largo, h, grosor, matA) : caja(grosor, h, largo, matA);
      if (eje === 'z') m.position.set(uc, yBase + r.y0 + h / 2, en + desplaz); else m.position.set(en + desplaz, yBase + r.y0 + h / 2, uc);
      doble(m, matA, matR); grupo.add(m);
    }
  }

  cfg.pisos.forEach((piso, nivel) => {
    const g = grupoPiso[nivel], y = nivel * NIV;
    const huecos = huecosPorPiso[nivel];
    for (const c of piso.cuartos) {
      const x0 = c.x, x1 = c.x + c.w, z0 = c.z, z1 = c.z + c.d;
      const lados = c.muros ?? ['S', 'N', 'W', 'E'];
      const colA = (l) => colorMat(c.muro.actualLados?.[l] || c.muro.actual);
      const colR = (l) => colorMat(c.muro.renovadoLados?.[l] || c.muro.renovado);
      const def = { S: ['z', z0, x0, x1, +T / 2], N: ['z', z1, x0, x1, -T / 2], W: ['x', x0, z0, z1, +T / 2], E: ['x', x1, z0, z1, -T / 2] };
      for (const l of lados) {
        const [eje, en, a, b, off] = def[l];
        muro(g, eje, en, a, b, off, T, enLinea(huecos, eje, en), colA(l), colR(l), y, H);
      }
      // aplanado exterior si el lado da al exterior de la casa
      for (const l of ['S', 'N', 'W', 'E']) {
        const [eje, en, a, b] = def[l];
        const esExt = (eje === 'z' && (Math.abs(en - Z0) < .01 || Math.abs(en - Z1) < .01)) || (eje === 'x' && (Math.abs(en) < .01 || Math.abs(en - W) < .01));
        if (!esExt) continue;
        const sale = (l === 'S' || l === 'W') ? -TE / 2 : TE / 2;
        const [mA, mR] = exteriorDe(l, nivel);
        const hs = enLinea(huecos, eje, en).map(h => ({ ...h }));
        muro(g, eje, en, a - (eje === 'z' && Math.abs(a) < .01 ? TE : 0), b + (eje === 'z' && Math.abs(b - W) < .01 ? TE : 0), sale, TE, hs, mA, mR, y, NIV);
      }
      // piso
      if (c.conPiso !== false) {
        const tA = std('#fff', { map: texRepeat(c.piso.actual, c.w, c.d), roughness: .6 });
        const tR = std('#fff', { map: texRepeat(c.piso.renovado, c.w, c.d), roughness: c.piso.renovado === 'madera' ? .7 : .35 });
        const pA = colorMat('#bdb7ad'), pl = [colorMat(cfg.plafon.actual), colorMat(cfg.plafon.renovado)];
        const geo = new THREE.BoxGeometry(c.w, LOSA, c.d);
        const losa = new THREE.Mesh(geo, [pA, pA, tA, pl[0], pA, pA]); losa.receiveShadow = true; losa.castShadow = true;
        losa.position.set(x0 + c.w / 2, y - LOSA / 2, z0 + c.d / 2);
        variantes.push({ mesh: losa, actual: [pA, pA, tA, pl[0], pA, pA], renovado: [pA, pA, tR, pl[1], pA, pA] });
        g.add(losa);
      }
      if (c.etiqueta !== false) etiquetas.push({ nivel, texto: c.nombre, medidas: `${c.w.toFixed(1)} × ${c.d.toFixed(1)} m`, pos: new THREE.Vector3(W - (x0 + c.w / 2), y + 1.2, z0 + c.d / 2) });
    }
    // ventanas y puerta principal
    for (const h of huecos) {
      if (h.tipo === 'vano') continue;
      const largo = h.a - h.de, alto = h.y1 - h.y0, uc = (h.de + h.a) / 2, yc = y + h.y0 + alto / 2;
      const esExt = (h.eje === 'z' && (Math.abs(h.en - Z0) < .01 || Math.abs(h.en - Z1) < .01)) || (h.eje === 'x' && (Math.abs(h.en) < .01 || Math.abs(h.en - W) < .01));
      const sitio = (obj, off = 0) => { if (h.eje === 'z') obj.position.set(uc, yc, h.en + off); else { obj.position.set(h.en + off, yc, uc); obj.rotation.y = Math.PI / 2; } g.add(obj); return obj; };
      if (h.tipo === 'ventana') {
        sitio(caja(largo, alto, .01, M.vidrio));
        const marcoA = std('#e9e9e6', { metalness: .3, roughness: .4 }), marcoR = std('#151517', { metalness: .4, roughness: .35 });
        const fr = new THREE.Group();
        for (const [w, hh, x, yy] of [[largo, .04, 0, alto / 2], [largo, .04, 0, -alto / 2], [.04, alto, -largo / 2, 0], [.04, alto, largo / 2, 0], [.03, alto, 0, 0]]) {
          const m = caja(w, hh, .08, marcoA); m.position.set(x, yy, 0); doble(m, marcoA, marcoR); fr.add(m);
        }
        sitio(fr);
        if (esExt && h.eje === 'z' && Math.abs(h.en - Z0) < .01) {   // protección (herrería) actual al frente
          const rej = new THREE.Group(); const mr = std('#1b1b1d', { metalness: .5 });
          for (let x = -largo / 2 + .1; x < largo / 2; x += .12) { const b = caja(.018, alto, .018, mr); b.position.set(x, 0, 0); rej.add(b); }
          for (const yy of [-alto / 2 + .05, 0, alto / 2 - .05]) { const b = caja(largo, .02, .02, mr); b.position.set(0, yy, 0); rej.add(b); }
          rej.position.set(uc, yc, h.en - .16); soloActual.add(rej);
        }
      }
      if (h.tipo === 'puerta' && h.principal) {
        const hojaA = std('#1c1c1e', { metalness: .4, roughness: .5 }), hojaR = std('#7A5534', { roughness: .55 });
        const hoja = caja(largo - .04, alto - .02, .05, hojaA); doble(hoja, hojaA, hojaR);
        const piv = new THREE.Group(); hoja.position.set((largo - .04) / 2, 0, 0); piv.add(hoja);
        const jal = caja(.02, .35, .04, M.dorado); jal.position.set(largo - .15, 0, -.05); piv.add(jal);
        piv.position.set(h.de + .02, yc, h.en - .03); piv.rotation.y = -1.1; g.add(piv);
        // lámpara de fachada
        const lamp = caja(.12, .3, .12, M.dorado); lamp.position.set(h.a + .3, y + 2.2, h.en - .12); soloRenovado.add(lamp);
        const luz = new THREE.PointLight('#ffcf8a', 1.2, 3, 2); luz.position.set(h.a + .3, y + 2.0, h.en - .4); soloRenovado.add(luz);
        const farol = caja(.2, .3, .2, M.negro); farol.position.set(h.a + .3, y + 2.15, h.en - .15); soloActual.add(farol);
      }
    }
  });

  // ── Escalera
  if (cfg.escalera) {
    const e = cfg.escalera, n = e.escalones, dz = (e.z1 - e.z0) / n, dy = NIV / n;
    const mA = colorMat(e.color.actual), mR = colorMat(e.color.renovado);
    for (let i = 0; i < n; i++) {
      const s = caja(e.w - .02, dy * (i + 1), dz, mA); s.position.set(e.x + e.w / 2, dy * (i + 1) / 2, e.z0 + dz * (i + .5));
      doble(s, mA, mR); grupoPiso[0].add(s);
    }
  }
  if (cfg.barandal) {
    const b = cfg.barandal, y = b.piso * NIV;
    const mA = std('#e9e9e6', { metalness: .3 }), mR = std('#151517', { metalness: .5, roughness: .35 });
    const top = caja(.05, .05, b.z1 - b.z0, mA); top.position.set(b.x, y + .95, (b.z0 + b.z1) / 2); doble(top, mA, mR); grupoPiso[b.piso].add(top);
    for (let z = b.z0 + .05; z < b.z1; z += .12) { const p = caja(.02, .93, .02, mA); p.position.set(b.x, y + .47, z); doble(p, mA, mR); grupoPiso[b.piso].add(p); }
  }

  // ── Azotea con pretil
  {
    const y = nPisos * NIV, P = cfg.casa.pretil, D = Z1 - Z0;
    const mA = colorMat('#9e9a92'), mR = colorMat('#8f8a82');
    const losa = caja(W + 2 * TE, LOSA, D + 2 * TE, mA); losa.position.set(W / 2, y - LOSA / 2, Z0 + D / 2); doble(losa, mA, mR); techo.add(losa);
    const [fA, fR] = [colorMat(fach.actual.alta), colorMat(fach.renovado.alta)];
    for (const [w, d, x, z] of [[W + 2 * TE, .15, W / 2, Z0 - TE + .075], [W + 2 * TE, .15, W / 2, Z1 + TE - .075], [.15, D, -TE + .075, Z0 + D / 2], [.15, D, W + TE - .075, Z0 + D / 2]]) {
      const p = caja(w, P, d, fA); p.position.set(x, y + P / 2, z); doble(p, fA, fR); techo.add(p);
    }
    // franja dorada en la fachada renovada
    const fr = caja(W + 2 * TE + .02, .05, .03, M.dorado); fr.position.set(W / 2, NIV, Z0 - TE - .015); soloRenovado.add(fr);
    const tinaco = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 1.2, 24), std('#2b2b2e')); tinaco.position.set(W - .8, y + .6, Z1 - .9); tinaco.castShadow = true; techo.add(tinaco);
  }

  // ── Muebles
  for (const modo of ['actual', 'renovado']) {
    for (const f of cfg.muebles?.[modo] || []) {
      const m = mueble(f); m.position.y += f.piso * NIV;
      const g = new THREE.Group(); g.add(m); g.userData.piso = f.piso; g.userData.modo = modo;
      grupoPiso[f.piso].add(g);
    }
  }

  // ── Espejo: en el JSON x se mide desde la izquierda viendo la casa desde la calle.
  // La cámara ve desde la calle hacia el fondo, así que se refleja el modelo para que coincida.
  const raiz = new THREE.Group();
  [...scene.children].forEach(c => { if (!c.isLight) raiz.add(c); });
  raiz.scale.x = -1; raiz.position.x = W; scene.add(raiz);

  // ── Etiquetas HTML
  const capa = document.createElement('div'); capa.className = 'casa3d-etiquetas'; contenedor.appendChild(capa);
  for (const e of etiquetas) {
    e.el = document.createElement('div'); e.el.className = 'casa3d-etiqueta';
    e.el.innerHTML = `<strong>${e.texto}</strong><span>${e.medidas}${cfg.aproximado ? ' aprox.' : ''}</span>`;
    capa.appendChild(e.el);
  }

  // ── Estado y cámara
  let modo = 'actual', vista = 'fachada', camAnim = null;
  const centro = new THREE.Vector3(W / 2, 0, (Z0 + Z1) / 2);
  const vistas = {
    fachada: { pos: new THREE.Vector3(W / 2 - 6.5, 4.4, -7.5), target: new THREE.Vector3(W / 2, 2.9, Z0 + 1) },
    alta:    { pos: new THREE.Vector3(W / 2 + 2, NIV + 14.5, (Z0 + Z1) / 2 - 6.5), target: new THREE.Vector3(W / 2, NIV, (Z0 + Z1) / 2 + .3) },
    baja:    { pos: new THREE.Vector3(W / 2 + 2, 14.5, (Z0 + Z1) / 2 - 6.5), target: new THREE.Vector3(W / 2, 0, (Z0 + Z1) / 2 + .3) },
  };
  // En pantallas anchas (computadora) las vistas de planta se alejan un poco para que quepa la casa
  const posDe = (v) => { const p = vistas[v]; const k = v === 'fachada' ? 1 : (camera.aspect > 1 ? 1.4 : 1.06); return p.target.clone().add(p.pos.clone().sub(p.target).multiplyScalar(k)); };
  camera.position.copy(vistas.fachada.pos).add(new THREE.Vector3(-4, 3, -5)); controls.target.copy(vistas.fachada.target);
  camAnim = { from: camera.position.clone(), fromT: controls.target.clone(), to: vistas.fachada.pos, toT: vistas.fachada.target, t: 0, dur: 2.2 };

  function aplicar() {
    for (const v of variantes) v.mesh.material = v[modo];
    soloActual.visible = modo === 'actual'; soloRenovado.visible = modo === 'renovado';
    grupoPiso.forEach((g, i) => {
      g.visible = vista === 'fachada' || (vista === 'alta' ? true : i === 0);
      g.children.forEach(ch => { if (ch.userData.modo) ch.visible = ch.userData.modo === modo; });
    });
    techo.visible = vista === 'fachada'; vecinos.visible = vista === 'fachada';
    const nivelEtiq = vista === 'alta' ? nPisos - 1 : vista === 'baja' ? 0 : -1;
    for (const e of etiquetas) e.activa = e.nivel === nivelEtiq;
  }
  function irA(v) {
    const p = vistas[v]; camAnim = { from: camera.position.clone(), fromT: controls.target.clone(), to: posDe(v), toT: p.target, t: 0, dur: 1.1 };
  }

  let margenInf = 0;   // espacio que tapa el panel de botones: se recorre la imagen hacia arriba
  function ajustar() {
    const w = contenedor.clientWidth, h = contenedor.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h;
    camera.fov = w < h ? 60 : 40;   // en celular vertical se abre un poco el lente
    if (margenInf > 0) camera.setViewOffset(w, h, 0, margenInf * .5, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(ajustar); ro.observe(contenedor); ajustar();

  const reloj = new THREE.Clock(); const tmp = new THREE.Vector3();
  let vivo = true;
  function loop() {
    if (!vivo) return;
    requestAnimationFrame(loop);
    const dt = Math.min(reloj.getDelta(), .05);
    if (camAnim) {
      camAnim.t += dt / camAnim.dur; const k = 1 - Math.pow(1 - Math.min(camAnim.t, 1), 3);
      camera.position.lerpVectors(camAnim.from, camAnim.to, k); controls.target.lerpVectors(camAnim.fromT, camAnim.toT, k);
      if (camAnim.t >= 1) camAnim = null;
    }
    controls.update();
    renderer.render(scene, camera);
    const w = contenedor.clientWidth, h = contenedor.clientHeight;
    for (const e of etiquetas) {
      if (!e.activa) { e.el.style.opacity = 0; continue; }
      tmp.copy(e.pos).project(camera);
      const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      e.el.style.opacity = vis ? 1 : 0;
      e.el.style.transform = `translate(-50%,-50%) translate(${(tmp.x * .5 + .5) * w}px,${(-tmp.y * .5 + .5) * h}px)`;
    }
  }
  aplicar(); loop(); requestAnimationFrame(() => onListo?.());

  return {
    setModo(m) { modo = m; aplicar(); },
    setVista(v) { vista = v; aplicar(); irA(v); controls.autoRotate = false; },
    girar(on) { controls.autoRotate = on; },
    setMargenInferior(px) { margenInf = px; ajustar(); },
    destruir() { vivo = false; ro.disconnect(); renderer.dispose(); contenedor.innerHTML = ''; },
    _debug: { scene, camera, renderer },
  };
}
