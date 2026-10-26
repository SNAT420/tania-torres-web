// Visor 3D de propiedades. Arma la casa en tiempo real a partir de un JSON de medidas (ver /modelos/*.json).
// Unidades en metros. En el JSON: x = frente (desde la izquierda viendo la casa desde la calle),
// z = fondo (0 = límite del terreno con la banqueta), y = altura.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const T = 0.06;            // grosor de cada cara interior de muro
const TE = 0.1;            // grosor del aplanado exterior
const PUERTA = 2.1, VANO = 2.25, ZOCLO = 0.08;
const ORO = '#C9A96E';

// ───────────────────────── Texturas hechas en canvas (no se descarga nada)
const texCache = {};
function canvasTex(key, size, draw) {
  if (texCache[key]) return texCache[key].clone();
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  texCache[key] = t; return t.clone();
}
function grano(c, s, n, a, tam = 2) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,255,255'},${Math.random() * a})`;
    c.fillRect(Math.random() * s, Math.random() * s, tam, tam);
  }
}
function manchas(c, s, n, a, r) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * s, y = Math.random() * s, rr = r * (.4 + Math.random());
    const g = c.createRadialGradient(x, y, 0, x, y, rr);
    const v = Math.random() < .5 ? '0,0,0' : '255,255,255';
    g.addColorStop(0, `rgba(${v},${a})`); g.addColorStop(1, `rgba(${v},0)`);
    c.fillStyle = g; c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
}
const TEX = {
  pintura: () => canvasTex('pintura', 256, (c, s) => { c.fillStyle = '#f4f4f4'; c.fillRect(0, 0, s, s); manchas(c, s, 60, .018, 40); grano(c, s, 5000, .025, 1); }),
  azulejo: () => canvasTex('azulejo', 512, (c, s) => {                 // loseta 40x40 como la actual
    const n = 2, w = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { c.fillStyle = `hsl(36,${8 + Math.random() * 4}%,${82 + Math.random() * 4}%)`; c.fillRect(i * w, j * w, w, w); }
    manchas(c, s, 40, .05, 50); grano(c, s, 4000, .05, 1.5);
    c.strokeStyle = '#a69e90'; c.lineWidth = 4;
    for (let i = 0; i <= n; i++) { c.beginPath(); c.moveTo(i * w, 0); c.lineTo(i * w, s); c.moveTo(0, i * w); c.lineTo(s, i * w); c.stroke(); }
  }),
  porcelanato: () => canvasTex('porcelanato', 1024, (c, s) => {        // 60x120 tono arena, colocado a junta corrida
    c.fillStyle = '#D9D2C6'; c.fillRect(0, 0, s, s);
    manchas(c, s, 120, .04, 90); grano(c, s, 9000, .03, 1.5);
    c.strokeStyle = 'rgba(120,110,95,.55)'; c.lineWidth = 3; c.beginPath();
    c.moveTo(0, 1.5); c.lineTo(s, 1.5); c.moveTo(0, s / 2); c.lineTo(s, s / 2);
    c.moveTo(1.5, 0); c.lineTo(1.5, s / 2); c.moveTo(s / 2, s / 2); c.lineTo(s / 2, s);
    c.stroke();
  }),
  madera: () => canvasTex('madera', 1024, (c, s) => {
    const h = s / 8;
    for (let r = 0; r < 8; r++) {
      let x = -((r * 337) % s);
      while (x < s) {
        const w = s * (.38 + Math.random() * .35);
        c.fillStyle = `hsl(${28 + Math.random() * 6},${38 + Math.random() * 10}%,${40 + Math.random() * 8}%)`; c.fillRect(x, r * h, w, h);
        for (let k = 0; k < 14; k++) {
          c.strokeStyle = `rgba(60,32,12,${.05 + Math.random() * .1})`; c.lineWidth = 1 + Math.random() * 2;
          const yy = r * h + Math.random() * h; c.beginPath(); c.moveTo(x, yy);
          c.bezierCurveTo(x + w * .3, yy + (Math.random() - .5) * 8, x + w * .6, yy + (Math.random() - .5) * 8, x + w, yy); c.stroke();
        }
        c.strokeStyle = 'rgba(40,22,8,.45)'; c.lineWidth = 2; c.strokeRect(x, r * h, w, h);
        x += w;
      }
    }
  }),
  pasto: () => canvasTex('pasto', 512, (c, s) => {
    c.fillStyle = '#4F6E2E'; c.fillRect(0, 0, s, s); manchas(c, s, 50, .12, 60);
    for (let i = 0; i < 26000; i++) {
      c.strokeStyle = `hsl(${78 + Math.random() * 30},${35 + Math.random() * 25}%,${20 + Math.random() * 26}%)`; c.lineWidth = 1;
      const x = Math.random() * s, y = Math.random() * s; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - .5) * 3, y - 3 - Math.random() * 4); c.stroke();
    }
  }),
  concreto: () => canvasTex('concreto', 512, (c, s) => { c.fillStyle = '#B4AFA6'; c.fillRect(0, 0, s, s); manchas(c, s, 80, .06, 50); grano(c, s, 12000, .07, 1.5); }),
  adoquin: () => canvasTex('adoquin', 512, (c, s) => {
    c.fillStyle = '#5d5852'; c.fillRect(0, 0, s, s);
    const n = 8, w = s / n, h = w / 2;
    for (let y = 0; y < n * 2; y++) for (let x = -1; x < n; x++) {
      const ox = (y % 2) * w / 2;
      c.fillStyle = `hsl(30,${5 + Math.random() * 6}%,${50 + Math.random() * 14}%)`;
      c.fillRect(x * w + ox + 2, y * h + 2, w - 4, h - 4);
    }
    grano(c, s, 6000, .06, 1.5);
  }),
  malla: () => canvasTex('malla', 128, (c, s) => {
    c.clearRect(0, 0, s, s); c.strokeStyle = 'rgba(200,205,210,1)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(s, s); c.moveTo(s, 0); c.lineTo(0, s); c.stroke();
  }),
  fondo: () => canvasTex('fondo', 1024, (c, s) => {
    const g = c.createRadialGradient(s * .5, s * .42, 0, s * .5, s * .5, s * .75);
    g.addColorStop(0, '#24232c'); g.addColorStop(.55, '#121219'); g.addColorStop(1, '#07070c');
    c.fillStyle = g; c.fillRect(0, 0, s, s); grano(c, s, 20000, .02, 1);
  }),
};
const ESCALA_TEX = { azulejo: .8, porcelanato: 1.2, madera: 1.8, pasto: 2.2, concreto: 2.5, adoquin: 1.6, malla: .12 };
function tex(nombre, w, d) { const t = TEX[nombre](); const e = ESCALA_TEX[nombre] || 1; t.repeat.set(w / e, d / e); t.needsUpdate = true; return t; }

// ───────────────────────── Materiales
const matCache = {};
function std(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: .85, metalness: 0, ...extra }); }
function pintura(color) {   // muro pintado (DoubleSide para que el corte de planta se vea sólido)
  return matCache['p' + color] || (matCache['p' + color] = std(color, { map: TEX.pintura(), roughness: .92, side: THREE.DoubleSide }));
}
const M = {
  tela: std('#8E877C', { roughness: .95 }), telaOsc: std('#4E4A45', { roughness: .95 }), cojinOro: std('#C9A96E', { roughness: .8 }),
  madera: std('#7A5434', { roughness: .6 }), maderaClara: std('#B48B62', { roughness: .6 }),
  negro: std('#18181b', { roughness: .45, metalness: .5 }), dorado: std(ORO, { roughness: .28, metalness: 1 }),
  blanco: std('#F4F2EE', { roughness: .3 }), laca: std('#EEEBE5', { roughness: .4 }), cubierta: std('#2A2A2D', { roughness: .25 }),
  sabana: std('#EEEBE4', { roughness: .95 }), cobija: std('#B89B68', { roughness: .95 }),
  vidrio: new THREE.MeshPhysicalMaterial({ color: '#d7e6ec', transparent: true, opacity: .22, roughness: .03, metalness: 0, envMapIntensity: 1.5, depthWrite: false }),
  espejo: std('#dfe8ea', { metalness: 1, roughness: .04 }), hoja: std('#3C6B37', { roughness: .8 }), hoja2: std('#4E7E40', { roughness: .8 }),
  maceta: std('#2A2A2E', { roughness: .6 }), tapete: std('#C2B7A5', { roughness: 1 }), pantalla: std('#0a0a0c', { roughness: .15, metalness: .3 }),
  acero: std('#a9adb2', { metalness: .9, roughness: .3 }), llanta: std('#141416', { roughness: .8 }), carro: std('#30343a', { metalness: .7, roughness: .3 }),
  cristalAuto: std('#0d1014', { metalness: .4, roughness: .1 }), luzCalida: new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffcf8a', emissiveIntensity: 2.2 }),
};

// ───────────────────────── Geometría básica
function caja(w, h, d, mat, sombra = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, .001), Math.max(h, .001), Math.max(d, .001)), mat);
  m.castShadow = sombra; m.receiveShadow = true; return m;
}
function rcaja(w, h, d, mat, r = .04) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * .999), mat);
  m.castShadow = true; m.receiveShadow = true; return m;
}
function cil(rt, rb, h, mat, seg = 24) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.castShadow = true; m.receiveShadow = true; return m; }
function en(g, m, x, y, z) { m.position.set(x, y, z); g.add(m); return m; }

// Divide un muro en rectángulos dejando libres puertas y ventanas.
function rectsMuro(u0, u1, H, huecos) {
  const hs = huecos.filter(h => h.a > u0 + .001 && h.de < u1 - .001).map(h => ({ ...h, de: Math.max(h.de, u0), a: Math.min(h.a, u1) })).sort((a, b) => a.de - b.de);
  const out = []; let u = u0;
  for (const h of hs) {
    if (h.de > u) out.push({ u0: u, u1: h.de, y0: 0, y1: H });
    if (h.y0 > 0) out.push({ u0: h.de, u1: h.a, y0: 0, y1: Math.min(h.y0, H) });
    if (h.y1 < H) out.push({ u0: h.de, u1: h.a, y0: h.y1, y1: H });
    u = Math.max(u, h.a);
  }
  if (u < u1) out.push({ u0: u, u1, y0: 0, y1: H });
  return out.filter(r => r.y1 - r.y0 > .001 && r.u1 - r.u0 > .001);
}
function alturasHueco(a) {
  if (a.tipo === 'puerta') return [0, a.alto || PUERTA];
  if (a.tipo === 'vano') return [0, a.alto || VANO];
  return [a.antepecho ?? .95, a.dintel || PUERTA];
}

// ───────────────────────── Muebles
function planta(escala = 1) {
  const g = new THREE.Group();
  en(g, cil(.17, .13, .42, M.maceta, 20), 0, .21, 0);
  for (let i = 0; i < 9; i++) {
    const h = new THREE.Mesh(new THREE.IcosahedronGeometry(.13 + Math.random() * .07, 1), i % 2 ? M.hoja : M.hoja2);
    h.castShadow = true; en(g, h, (Math.random() - .5) * .3, .55 + Math.random() * .5, (Math.random() - .5) * .3);
  }
  g.scale.setScalar(escala); return g;
}
function mueble(f) {
  const g = new THREE.Group(); const a = (m, x, y, z) => en(g, m, x, y, z);
  switch (f.tipo) {
    case 'sofa':
      a(rcaja(2.1, .42, .92, M.tela, .06), 0, .23, 0);
      a(rcaja(2.1, .48, .22, M.tela, .07), 0, .66, -.35);
      a(rcaja(.2, .3, .92, M.tela, .06), -.95, .56, 0); a(rcaja(.2, .3, .92, M.tela, .06), .95, .56, 0);
      a(rcaja(.84, .14, .64, M.tela, .06), -.43, .5, .08); a(rcaja(.84, .14, .64, M.tela, .06), .43, .5, .08);
      a(rcaja(.42, .36, .13, M.cojinOro, .06), -.55, .72, -.2); a(rcaja(.42, .36, .13, M.telaOsc, .06), .55, .72, -.2);
      for (const x of [-.95, .95]) for (const z of [-.38, .38]) a(cil(.02, .02, .06, M.negro, 8), x, .03, z);
      break;
    case 'mesaCentro': a(cil(.42, .42, .04, M.maderaClara, 40), 0, .42, 0); a(cil(.06, .2, .4, M.negro, 16), 0, .2, 0); a(cil(.07, .07, .14, M.dorado, 16), .15, .51, .05); break;
    case 'muebleTV':
      a(rcaja(1.8, .45, .42, M.madera, .02), 0, .26, 0); a(caja(1.8, .02, .42, M.dorado), 0, .495, 0);
      a(rcaja(1.45, .82, .04, M.pantalla, .015), 0, 1.25, -.17);
      for (const x of [-.8, .8]) a(caja(.04, .04, .36, M.negro), x, .02, 0);
      break;
    case 'comedor': {
      a(rcaja(1.45, .05, .88, M.maderaClara, .02), 0, .75, 0);
      for (const [x, z] of [[-.6, -.33], [.6, -.33], [-.6, .33], [.6, .33]]) a(caja(.05, .72, .05, M.negro), x, .36, z);
      for (const [x, z, r] of [[-.36, -.64, 0], [.36, -.64, 0], [-.36, .64, Math.PI], [.36, .64, Math.PI]]) {
        const s = new THREE.Group();
        en(s, rcaja(.44, .06, .44, M.tela, .025), 0, .46, 0); en(s, rcaja(.44, .46, .05, M.tela, .025), 0, .72, -.2);
        for (const [p, q] of [[-.19, -.19], [.19, -.19], [-.19, .19], [.19, .19]]) en(s, caja(.025, .45, .025, M.negro), p, .22, q);
        s.position.set(x, 0, z); s.rotation.y = r; g.add(s);
      }
      break;
    }
    case 'lampara': {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(.07, .3, .24, 32, 1, true), std(ORO, { metalness: 1, roughness: .3, side: THREE.DoubleSide }));
      a(l, 0, 1.98, 0); a(caja(.008, .38, .008, M.negro, false), 0, 2.29, 0);
      a(new THREE.Mesh(new THREE.SphereGeometry(.05, 12, 8), M.luzCalida), 0, 1.9, 0);
      const luz = new THREE.PointLight('#ffd49a', 2.2, 4.5, 1.8); luz.position.y = 1.85; g.add(luz);
      break;
    }
    case 'planta': g.add(planta(f.escala || 1)); break;
    case 'tapete': { const t = new THREE.Mesh(new RoundedBoxGeometry(f.w || 2, .014, f.d || 1.5, 2, .006), M.tapete); t.receiveShadow = true; a(t, 0, .007, 0); break; }
    case 'cocina': {
      const L = f.largo || 2.2, R = .76, B = L - R;
      a(rcaja(B, .84, .6, M.laca, .01), -R / 2, .44, 0);
      a(caja(B + .02, .04, .63, M.cubierta), -R / 2, .88, .01);
      a(rcaja(B, .7, .36, M.laca, .01), -R / 2, 1.88, -.12);
      a(caja(B, .03, .36, M.dorado), -R / 2, 1.52, -.12);
      a(caja(.55, .015, .4, M.negro), -R / 2 - .3, .906, .03);
      a(caja(.45, .02, .38, M.acero), -R / 2 + .4, .9, .03);
      a(rcaja(.72, 1.85, .68, M.acero, .03), L / 2 - R / 2, .93, .02);
      for (let i = 0; i < 3; i++) a(caja(.22, .014, .02, M.dorado), -L / 2 + .25 + i * .48, .78, .31);
      break;
    }
    case 'wc':
      a(rcaja(.38, .38, .5, M.blanco, .12), 0, .2, .06); a(rcaja(.4, .4, .17, M.blanco, .04), 0, .58, -.2);
      a(rcaja(.38, .03, .46, M.blanco, .1), 0, .4, .08);
      break;
    case 'lavabo':
      a(rcaja(.62, .48, .45, M.madera, .02), 0, .58, 0); a(rcaja(.64, .05, .47, M.blanco, .02), 0, .845, 0);
      a(cil(.012, .012, .2, M.dorado, 10), 0, .96, -.15);
      a(rcaja(.5, .7, .02, M.espejo, .01), 0, 1.48, -.215); a(caja(.54, .02, .02, M.dorado), 0, 1.84, -.205);
      break;
    case 'regadera': {
      const s = f.lado || .9;
      a(caja(s, .05, s, M.blanco), 0, .025, 0);
      a(caja(s, 1.95, .012, M.vidrio, false), 0, 1.0, s / 2); a(caja(.012, 1.95, s, M.vidrio, false), s / 2, 1.0, 0);
      a(caja(.02, 1.95, .02, M.dorado), s / 2, 1.0, s / 2);
      a(cil(.1, .1, .015, M.dorado, 24), -.2, 2.08, -.2);
      break;
    }
    case 'cama': {
      const A = f.ancho || 1.4;
      a(rcaja(A + .06, .28, 2.04, M.maderaClara, .03), 0, .16, 0);
      a(rcaja(A - .02, .22, 1.96, M.sabana, .08), 0, .41, .02);
      a(rcaja(A + .1, 1.05, .1, M.telaOsc, .04), 0, .55, -1.0);
      a(rcaja(A + .02, .06, .95, M.cobija, .03), 0, .54, .5);
      a(rcaja(A * .42, .14, .36, M.blanco, .06), -A * .24, .58, -.74); a(rcaja(A * .42, .14, .36, M.blanco, .06), A * .24, .58, -.74);
      break;
    }
    case 'buro':
      a(rcaja(.46, .48, .4, M.madera, .02), 0, .27, 0); a(caja(.3, .015, .02, M.dorado), 0, .36, .2);
      a(cil(.05, .07, .22, M.dorado, 16), 0, .62, 0); a(cil(.1, .13, .14, M.sabana, 20), 0, .79, 0);
      break;
    case 'closet': {
      const L = f.largo || 1.8;
      a(rcaja(L, 2.3, .6, M.maderaClara, .015), 0, 1.15, 0);
      for (let i = 1; i < 3; i++) a(caja(.008, 2.26, .605, M.madera), -L / 2 + i * L / 3, 1.15, 0);
      for (let i = 0; i < 3; i++) a(caja(.02, .45, .03, M.dorado), -L / 2 + (i + .5) * L / 3 + .1, 1.15, .31);
      break;
    }
    case 'escritorio':
      a(rcaja(1.2, .04, .55, M.maderaClara, .015), 0, .75, 0);
      a(caja(.03, .73, .5, M.negro), -.57, .365, 0); a(caja(.03, .73, .5, M.negro), .57, .365, 0);
      a(rcaja(.46, .06, .46, M.tela, .025), 0, .47, .5); a(rcaja(.46, .5, .05, M.tela, .025), 0, .75, .72);
      a(cil(.06, .08, .03, M.dorado, 16), .4, .785, -.12); a(cil(.008, .008, .4, M.dorado, 8), .4, .98, -.12);
      break;
  }
  g.position.set(f.x, 0, f.z); g.rotation.y = (f.rot || 0) * Math.PI / 180;
  return g;
}
function auto() {
  const g = new THREE.Group();
  en(g, rcaja(1.76, .55, 4.05, M.carro, .18), 0, .55, 0);
  en(g, rcaja(1.56, .5, 2.05, M.cristalAuto, .16), 0, 1.02, -.15);
  en(g, rcaja(1.5, .06, 1.75, M.carro, .03), 0, 1.27, -.18);
  for (const x of [-.82, .82]) for (const z of [-1.3, 1.3]) {
    const r = cil(.33, .33, .24, M.llanta, 28); r.rotation.z = Math.PI / 2; en(g, r, x, .33, z);
    const rin = cil(.2, .2, .245, M.acero, 20); rin.rotation.z = Math.PI / 2; en(g, rin, x, .33, z);
  }
  for (const x of [-.6, .6]) { en(g, caja(.32, .07, .02, M.luzCalida, false), x, .68, 2.03); en(g, caja(.32, .06, .02, std('#7a1515', { emissive: '#5a0b0b' }), false), x, .7, -2.03); }
  return g;
}

// ───────────────────────── Visor
export function crearVisor(contenedor, cfg, { onListo, calidad = 'auto' } = {}) {
  const W = cfg.lote.frente, FONDO = cfg.lote.fondo, Z0 = cfg.casa.z0, Z1 = cfg.casa.z1, H = cfg.casa.altura, LOSA = cfg.casa.losa;
  const NIV = H + LOSA, nPisos = cfg.pisos.length, ALTO = nPisos * NIV;
  const movil = calidad === 'baja' || (calidad === 'auto' && (matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600));

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, movil ? 1.75 : 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  contenedor.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = TEX.fondo();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), .04).texture;
  scene.environmentIntensity = .55;

  const camera = new THREE.PerspectiveCamera(40, 1, .1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .07;
  controls.maxPolarAngle = Math.PI * .47; controls.minDistance = 3.5; controls.maxDistance = 38;
  controls.autoRotate = true; controls.autoRotateSpeed = .5;
  controls.enablePan = !movil;

  // Luces
  scene.add(new THREE.HemisphereLight('#fff4e2', '#3a3328', .55));
  const sol = new THREE.DirectionalLight('#fff0d8', 2.6);
  sol.position.set(-9, 16, -11); sol.target.position.set(W / 2, 0, FONDO / 2);
  sol.castShadow = true; sol.shadow.mapSize.set(movil ? 2048 : 4096, movil ? 2048 : 4096);
  Object.assign(sol.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 });
  sol.shadow.bias = -.0002; sol.shadow.normalBias = .025; sol.shadow.radius = 4;
  scene.add(sol, sol.target);

  // Todo el modelo vive en "raiz", reflejado para que la izquierda del JSON sea la izquierda en pantalla
  const raiz = new THREE.Group(); raiz.scale.x = -1; raiz.position.x = W; scene.add(raiz);
  const variantes = [];
  function doble(mesh, mA, mR) { variantes.push({ mesh, actual: mA, renovado: mR }); mesh.material = mA; return mesh; }
  const soloActual = new THREE.Group(), soloRenovado = new THREE.Group(); raiz.add(soloActual, soloRenovado);
  const grupoPiso = cfg.pisos.map(() => new THREE.Group()); grupoPiso.forEach(g => raiz.add(g));
  const techo = new THREE.Group(); raiz.add(techo);
  const ext = cfg.exterior || {}, fach = cfg.fachada;

  // ── Base tipo maqueta
  {
    const m = .55, x0 = -m, x1 = W + m, z0 = -1.25 - m, z1 = FONDO + m, r = .35;
    const s = new THREE.Shape();
    s.moveTo(x0 + r, z0); s.lineTo(x1 - r, z0); s.quadraticCurveTo(x1, z0, x1, z0 + r); s.lineTo(x1, z1 - r); s.quadraticCurveTo(x1, z1, x1 - r, z1);
    s.lineTo(x0 + r, z1); s.quadraticCurveTo(x0, z1, x0, z1 - r); s.lineTo(x0, z0 + r); s.quadraticCurveTo(x0, z0, x0 + r, z0);
    const base = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: .32, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelSegments: 3 }), std('#17171d', { roughness: .55, metalness: .2 }));
    base.rotation.x = Math.PI / 2; base.position.y = -.02; base.receiveShadow = true; raiz.add(base);
    const pts = s.getPoints(12).map(p => new THREE.Vector3(p.x, .005, p.y));
    raiz.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: ORO, transparent: true, opacity: .65 })));
    const sombra = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: .35 }));
    sombra.rotation.x = -Math.PI / 2; sombra.position.y = -.36; sombra.receiveShadow = true; raiz.add(sombra);
    const bq = caja(W + .4, .1, 1.2, std('#fff', { map: tex('concreto', W, 1.2), roughness: .9 })); bq.position.set(W / 2, .05, -.62); raiz.add(bq);
    const guar = caja(W + .4, .14, .14, std('#c9c4bb')); guar.position.set(W / 2, .07, -1.25); raiz.add(guar);
  }

  // ── Cochera
  {
    const pasto = caja(W, .05, Z0, std('#fff', { map: tex('pasto', W, Z0), roughness: 1 })); pasto.position.set(W / 2, .025, Z0 / 2); soloActual.add(pasto);
    for (const x of cfg.auto ? [cfg.auto.x - .82, cfg.auto.x + .82] : [1.05, 3.05]) { const h = caja(.5, .06, Z0 - .2, std('#fff', { map: tex('concreto', .5, Z0) })); h.position.set(x, .03, Z0 / 2); soloActual.add(h); }
    const piso = caja(W, .06, Z0, std('#fff', { map: tex('adoquin', W, Z0), roughness: .8 })); piso.position.set(W / 2, .03, Z0 / 2); soloRenovado.add(piso);
    const jar = rcaja(1.25, .38, .42, std('#2A2A2E', { roughness: .5 }), .03); jar.position.set(.75, .19, Z0 - .35); soloRenovado.add(jar);
    for (let i = 0; i < 4; i++) { const p = planta(.75); p.children[0].visible = false; p.position.set(.32 + i * .28, .2, Z0 - .35); soloRenovado.add(p); }
    if (cfg.auto) { const a = auto(); a.position.set(cfg.auto.x, 0, cfg.auto.z); a.rotation.y = (cfg.auto.rot || 0) * Math.PI / 180; raiz.add(a); }
  }
  // ── Reja al frente
  {
    const g = new THREE.Group(); const mp = std('#a3a8ad', { metalness: .8, roughness: .35 });
    for (let x = 0; x <= W + .01; x += W / 3) en(g, cil(.035, .035, 1.7, mp, 12), x, .85, .04);
    const malla = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.5), new THREE.MeshStandardMaterial({ map: tex('malla', W, 1.5), transparent: true, alphaTest: .4, side: THREE.DoubleSide, metalness: .7, roughness: .4 }));
    malla.castShadow = true; en(g, malla, W / 2, .82, .04);
    for (const y of [1.6, 1.72]) en(g, caja(W, .006, .006, mp), W / 2, y, .04);
    soloActual.add(g);

    const h = new THREE.Group(); const b = std('#141416', { metalness: .6, roughness: .35 });
    en(h, rcaja(W, .4, .22, std('#2A2A2E', { roughness: .5 }), .02), W / 2, .2, .11);
    for (let x = .06; x < W; x += .1) en(h, caja(.028, 1.45, .028, b), x, 1.12, .11);
    en(h, caja(W, .05, .06, b), W / 2, 1.85, .11); en(h, caja(W, .015, .07, M.dorado), W / 2, 1.88, .11);
    soloRenovado.add(h);
  }
  // ── Patio
  {
    const PZ = Z1, PD = FONDO - PZ;
    const pA = caja(W, .05, PD, std('#c9c6a8', { map: tex('pasto', W, PD), roughness: 1 })); pA.position.set(W / 2, .025, PZ + PD / 2); soloActual.add(pA);
    const pR = caja(W, .05, PD, std('#fff', { map: tex('pasto', W, PD), roughness: 1 })); pR.position.set(W / 2, .025, PZ + PD / 2); soloRenovado.add(pR);
    const deck = caja(W, .08, 1.1, std('#fff', { map: tex('madera', W, 1.1), roughness: .6 })); deck.position.set(W / 2, .045, PZ + .55); soloRenovado.add(deck);
    const pa = ext.patio?.actual || {}, pr = ext.patio?.renovado || {};
    const bA = pintura(pa.barda || '#888'), bR = pintura(pr.barda || '#eee');
    for (const [w, d, x, z] of [[W, .15, W / 2, FONDO - .075], [.15, PD, .075, PZ + PD / 2], [.15, PD, W - .075, PZ + PD / 2]]) {
      const b = caja(w, 2.4, d, bA); b.position.set(x, 1.2, z); doble(b, bA, bR); raiz.add(b);
      const cap = caja(w + .04, .04, d + .04, std('#bdb8ae')); cap.position.set(x, 2.42, z); raiz.add(cap);
    }
    if (pa.techo) {
      const rej = new THREE.Group(); const m = std('#5a3d2c', { metalness: .6, roughness: .6 });
      for (let x = 0; x <= W; x += .35) en(rej, caja(.022, .022, PD, m), x, 2.55, PZ + PD / 2);
      for (let z = PZ; z <= FONDO; z += .35) en(rej, caja(W, .022, .022, m), W / 2, 2.55, z);
      soloActual.add(rej);
    }
    for (const [x, z, s] of [[.45, FONDO - .45, 1.5], [W - .45, FONDO - .45, 1.3], [W - .45, PZ + 1.5, 1]]) { const p = planta(s); p.position.set(x, .05, z); soloRenovado.add(p); }
  }

  // ── Habitaciones
  const huecosPorPiso = cfg.pisos.map((_, i) => (cfg.aberturas || []).filter(a => a.piso === i).map(a => { const [y0, y1] = alturasHueco(a); return { ...a, y0, y1 }; }));
  const enLinea = (lista, eje, v) => lista.filter(h => h.eje === eje && Math.abs(h.en - v) < .01);
  const esBorde = (eje, v) => eje === 'z' ? (Math.abs(v - Z0) < .01 || Math.abs(v - Z1) < .01) : (Math.abs(v) < .01 || Math.abs(v - W) < .01);
  const etiquetas = [];
  const exteriorDe = (lado, nivel) => { const k = lado === 'S' ? (nivel === 0 ? 'baja' : 'alta') : 'lateral'; return [pintura(fach.actual[k]), pintura(fach.renovado[k])]; };
  const zocloA = std('#cfc8bc', { roughness: .5 }), zocloR = std('#f2efe9', { roughness: .4 });

  function muro(g, eje, v, u0, u1, desp, grosor, huecos, mA, mR, yBase, alto) {
    for (const r of rectsMuro(u0, u1, alto, huecos)) {
      const L = r.u1 - r.u0, h = r.y1 - r.y0, uc = (r.u0 + r.u1) / 2;
      const m = eje === 'z' ? caja(L, h, grosor, mA) : caja(grosor, h, L, mA);
      if (eje === 'z') m.position.set(uc, yBase + r.y0 + h / 2, v + desp); else m.position.set(v + desp, yBase + r.y0 + h / 2, uc);
      doble(m, mA, mR); g.add(m);
    }
  }

  cfg.pisos.forEach((piso, nivel) => {
    const g = grupoPiso[nivel], y = nivel * NIV, huecos = huecosPorPiso[nivel];
    for (const c of piso.cuartos) {
      const x0 = c.x, x1 = c.x + c.w, z0 = c.z, z1 = c.z + c.d;
      const lados = c.muros ?? ['S', 'N', 'W', 'E'];
      const colA = l => pintura(c.muro.actualLados?.[l] || c.muro.actual);
      const colR = l => pintura(c.muro.renovadoLados?.[l] || c.muro.renovado);
      const def = { S: ['z', z0, x0, x1, 1], N: ['z', z1, x0, x1, -1], W: ['x', x0, z0, z1, 1], E: ['x', x1, z0, z1, -1] };
      for (const l of lados) {
        const [eje, v, a, b, s] = def[l];
        const hs = enLinea(huecos, eje, v);
        muro(g, eje, v, a, b, s * T / 2, T, hs, colA(l), colR(l), y, H);
        muro(g, eje, v, a + .001, b - .001, s * (T + .006), .012, hs.filter(h => h.y0 === 0), zocloA, zocloR, y, ZOCLO);   // zoclo
      }
      for (const l of ['S', 'N', 'W', 'E']) {             // aplanado exterior
        const [eje, v, a, b, s] = def[l];
        if (!esBorde(eje, v)) continue;
        const [mA, mR] = exteriorDe(l, nivel);
        const ea = eje === 'z' && Math.abs(a) < .01 ? TE : 0, eb = eje === 'z' && Math.abs(b - W) < .01 ? TE : 0;
        muro(g, eje, v, a - ea, b + eb, -s * TE / 2, TE, enLinea(huecos, eje, v), mA, mR, y, NIV);
      }
      if (c.conPiso !== false) {
        const tA = std('#fff', { map: tex(c.piso.actual, c.w, c.d), roughness: .5 });
        const tR = std('#fff', { map: tex(c.piso.renovado, c.w, c.d), roughness: c.piso.renovado === 'madera' ? .55 : .22 });
        const lado = std('#b8b2a8'), plA = pintura(cfg.plafon.actual), plR = pintura(cfg.plafon.renovado);
        const losa = new THREE.Mesh(new THREE.BoxGeometry(c.w, LOSA, c.d)); losa.receiveShadow = true; losa.castShadow = true;
        losa.position.set(x0 + c.w / 2, y - LOSA / 2 + .001, z0 + c.d / 2);
        const v = { mesh: losa, actual: [lado, lado, tA, plA, lado, lado], renovado: [lado, lado, tR, plR, lado, lado] };
        variantes.push(v); losa.material = v.actual; g.add(losa);
      }
      if (c.etiqueta !== false) etiquetas.push({ nivel, texto: c.nombre, medidas: `${c.w.toFixed(1)} × ${c.d.toFixed(1)} m`, pos: new THREE.Vector3(W - (x0 + c.w / 2), y + 1.0, z0 + c.d / 2) });
    }

    // Ventanas, puertas y marcos
    for (const h of huecos) {
      if (h.tipo === 'vano') continue;
      const L = h.a - h.de, alto = h.y1 - h.y0, uc = (h.de + h.a) / 2, yc = y + h.y0 + alto / 2;
      const borde = esBorde(h.eje, h.en), frente = h.eje === 'z' && Math.abs(h.en - Z0) < .01;
      const fuera = h.eje === 'z' ? (Math.abs(h.en - Z0) < .01 ? -1 : 1) : (Math.abs(h.en) < .01 ? -1 : 1);
      const colocar = (obj, off = 0, yy = yc, destino = g) => {
        if (h.eje === 'z') obj.position.set(uc, yy, h.en + off); else { obj.position.set(h.en + off, yy, uc); obj.rotation.y = Math.PI / 2; }
        destino.add(obj); return obj;
      };
      if (h.tipo === 'ventana') {
        colocar(caja(L - .04, alto - .04, .012, M.vidrio, false));
        const mA = std('#ecebe7', { metalness: .4, roughness: .35 }), mR = std('#141416', { metalness: .55, roughness: .3 });
        const fr = new THREE.Group();
        for (const [w, hh, x, yy] of [[L, .05, 0, alto / 2 - .025], [L, .05, 0, -alto / 2 + .025], [.05, alto, -L / 2 + .025, 0], [.05, alto, L / 2 - .025, 0], [.035, alto, 0, 0]]) {
          const m = caja(w, hh, .07, mA); m.position.set(x, yy, 0); doble(m, mA, mR); fr.add(m);
        }
        colocar(fr);
        if (borde) colocar(caja(L + .12, .04, .16, std('#d8d3ca', { roughness: .5 })), fuera * (TE + .04), y + h.y0 - .02);   // repisón
        if (frente) {                                  // protección de herrería (estado actual)
          const rej = new THREE.Group(); const mr = std('#1b1b1d', { metalness: .6, roughness: .4 });
          for (let x = -L / 2 + .09; x < L / 2; x += .12) en(rej, caja(.016, alto, .016, mr), x, 0, 0);
          for (const yy of [-alto / 2 + .05, 0, alto / 2 - .05]) en(rej, caja(L, .02, .02, mr), 0, yy, 0);
          colocar(rej, -(TE + .07), yc, soloActual);
        }
      }
      if (h.tipo === 'puerta') {
        const mmA = std('#e9e6df', { roughness: .45 }), mmR = h.principal ? std('#141416', { metalness: .5, roughness: .3 }) : std('#f3f0ea', { roughness: .4 });
        const marco = new THREE.Group(), prof = (borde ? TE : 0) + T * 2 + .02;
        for (const [w, hh, x, yy] of [[.05, alto, -L / 2 - .02, 0], [.05, alto, L / 2 + .02, 0], [L + .09, .05, 0, alto / 2 + .02]]) {
          const m = caja(w, hh, prof, mmA); m.position.set(x, yy, borde ? fuera * TE / 2 : 0); doble(m, mmA, mmR); marco.add(m);
        }
        colocar(marco);
        // hoja abierta hacia el lado indicado en "abre" (+ o -)
        const abre = h.abre === '-' ? -1 : 1, ang = (h.principal ? 1.25 : 1.35) * abre;
        const hA = h.principal ? std('#1c1c1e', { metalness: .5, roughness: .45 }) : std('#f1efe9', { roughness: .45 });
        const hR = h.principal ? std('#6E4A2C', { roughness: .5 }) : std('#EDE9E1', { roughness: .4 });
        const piv = new THREE.Group(); const hoja = rcaja(L - .03, alto - .02, .045, hA, .008); doble(hoja, hA, hR);
        hoja.position.set((L - .03) / 2, 0, 0); piv.add(hoja);
        const jal = caja(.025, h.principal ? .45 : .12, .05, M.dorado); jal.position.set(L - .12, 0, 0); piv.add(jal);
        if (h.eje === 'z') { piv.position.set(h.de + .015, yc, h.en + abre * (T + .03)); piv.rotation.y = -ang; }
        else { piv.position.set(h.en + abre * (T + .03), yc, h.de + .015); piv.rotation.y = -Math.PI / 2 + ang; }
        g.add(piv);
        if (h.principal) {
          const lamp = new THREE.Group();
          en(lamp, caja(.1, .32, .08, M.dorado), 0, 0, 0);
          en(lamp, caja(.06, .02, .05, M.luzCalida, false), 0, -.17, -.02);
          const l = new THREE.SpotLight('#ffcf8a', 6, 4, .7, .6, 1.5); l.position.set(0, -.15, -.05); l.target.position.set(0, -2, -.4); lamp.add(l, l.target);
          lamp.position.set(h.a + .32, y + 2.15, h.en - TE - .05); soloRenovado.add(lamp);
          const farol = new THREE.Group(); en(farol, caja(.18, .28, .18, M.negro), 0, 0, 0); en(farol, caja(.12, .18, .19, std('#e9dcb5', { emissive: '#3a2a10' }), false), 0, 0, 0);
          farol.position.set(h.a + .3, y + 2.1, h.en - TE - .1); soloActual.add(farol);
        }
      }
    }
  });

  // ── Fachada renovada: marquesina y celosía de madera
  if (fach.marquesina) {
    const q = fach.marquesina, L = q.a - q.de, xc = (q.de + q.a) / 2;
    en(soloRenovado, caja(L, .1, q.saliente, std('#1d1d20', { roughness: .4, metalness: .3 })), xc, q.y, Z0 - TE - q.saliente / 2);
    en(soloRenovado, caja(L, .015, .02, M.dorado), xc, q.y - .05, Z0 - TE - q.saliente);
    en(soloRenovado, caja(L - .1, .012, .03, M.luzCalida, false), xc, q.y - .056, Z0 - TE - q.saliente / 2);
  }
  if (fach.listones) {
    const q = fach.listones; const mad = std('#c79a6a', { map: tex('madera', .1, 2), roughness: .55 });
    for (let x = q.de + .03; x < q.a - .02; x += .085) en(soloRenovado, caja(.05, q.y1 - q.y0, .05, mad), x, (q.y0 + q.y1) / 2, Z0 - TE - .04);
  }

  // ── Escalera y barandales
  if (cfg.escalera) {
    const e = cfg.escalera, n = e.escalones, dz = (e.z1 - e.z0) / n, dy = NIV / n;
    const mA = pintura(e.color.actual), mR = std('#fff', { map: tex('madera', e.w, dz), roughness: .5 });
    const cuerpo = pintura('#d8d2c6');
    for (let i = 0; i < n; i++) {
      const zc = e.z0 + dz * (i + .5), hy = dy * (i + 1);
      en(grupoPiso[0], caja(e.w - .02, hy - .04, dz, cuerpo), e.x + e.w / 2, (hy - .04) / 2, zc);
      const hu = caja(e.w - .02, .04, dz + .03, mA); doble(hu, mA, mR); en(grupoPiso[0], hu, e.x + e.w / 2, hy - .02, zc - .015);
    }
    const xh = e.x + .04, largo = Math.hypot(e.z1 - e.z0, NIV);
    const pmA = std('#e9e6df', { metalness: .3 }), pmR = std('#141416', { metalness: .6, roughness: .3 });
    const pm = cil(.022, .022, largo, pmA, 10); doble(pm, pmA, pmR);
    pm.position.set(xh, NIV / 2 + .9, (e.z0 + e.z1) / 2); pm.rotation.x = Math.atan2(e.z1 - e.z0, NIV); grupoPiso[0].add(pm);
    for (let i = 1; i < n; i += 2) { const p = caja(.02, .9, .02, pmA); doble(p, pmA, pmR); en(grupoPiso[0], p, xh, dy * (i + 1) + .45, e.z0 + dz * (i + .5)); }
  }
  if (cfg.barandal) {
    const b = cfg.barandal, y = b.piso * NIV;
    const mA = std('#e9e6df', { metalness: .3 }), mR = std('#141416', { metalness: .6, roughness: .3 });
    const top = caja(.05, .05, b.z1 - b.z0, mA); doble(top, mA, mR); en(grupoPiso[b.piso], top, b.x, y + .95, (b.z0 + b.z1) / 2);
    for (let z = b.z0 + .05; z < b.z1; z += .11) { const p = caja(.018, .93, .018, mA); doble(p, mA, mR); en(grupoPiso[b.piso], p, b.x, y + .47, z); }
  }

  // ── Azotea
  {
    const y = ALTO, P = cfg.casa.pretil, D = Z1 - Z0;
    en(techo, caja(W + 2 * TE, LOSA, D + 2 * TE, std('#fff', { map: tex('concreto', W, D), roughness: .9 })), W / 2, y - LOSA / 2, Z0 + D / 2);
    const iA = std('#9e3b2a', { roughness: .9 }), iR = std('#8c8780', { roughness: .9 });
    const imp = caja(W, .01, D, iA, false); doble(imp, iA, iR); en(techo, imp, W / 2, y + .005, Z0 + D / 2);
    const [fA, fR] = [pintura(fach.actual.alta), pintura(fach.renovado.alta)];
    const capA = std('#c9c2b5', { roughness: .6 }), capR = std('#1d1d20', { roughness: .4, metalness: .3 });
    for (const [w, d, x, z] of [[W + 2 * TE, .15, W / 2, Z0 - TE + .075], [W + 2 * TE, .15, W / 2, Z1 + TE - .075], [.15, D, -TE + .075, Z0 + D / 2], [.15, D, W + TE - .075, Z0 + D / 2]]) {
      const p = caja(w, P, d, fA); doble(p, fA, fR); en(techo, p, x, y + P / 2, z);
      const c = caja(w + .03, .05, d + .03, capA); doble(c, capA, capR); en(techo, c, x, y + P + .025, z);
    }
    en(soloRenovado, caja(W + 2 * TE + .02, .045, .03, M.dorado), W / 2, NIV - .02, Z0 - TE - .015);
    const tin = new THREE.Group();
    en(tin, cil(.52, .55, 1.15, std('#1f1f22', { roughness: .5 }), 32), 0, .62, 0); en(tin, cil(.3, .52, .16, std('#1f1f22', { roughness: .5 }), 32), 0, 1.27, 0);
    en(tin, caja(1.2, .1, 1.2, std('#9b968e')), 0, .05, 0);
    tin.position.set(W - .85, y, Z1 - .9); techo.add(tin);
  }

  // ── Muebles
  for (const modo of ['actual', 'renovado']) for (const f of cfg.muebles?.[modo] || []) {
    const m = mueble(f); m.position.y += f.piso * NIV; m.userData.modo = modo; grupoPiso[f.piso].add(m);
  }

  // ── Etiquetas HTML
  const capa = document.createElement('div'); capa.className = 'casa3d-etiquetas'; contenedor.appendChild(capa);
  for (const e of etiquetas) {
    e.el = document.createElement('div'); e.el.className = 'casa3d-etiqueta';
    e.el.innerHTML = `<strong>${e.texto}</strong><span>${e.medidas}${cfg.aproximado ? ' aprox.' : ''}</span>`;
    capa.appendChild(e.el);
  }

  // ── Oclusión ambiental (sombras de contacto en esquinas) en computadora
  let composer = null;
  if (!movil) {
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const gtao = new GTAOPass(scene, camera, 1, 1);
      gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = .9;
      gtao.updateGtaoMaterial({ radius: .35, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 16 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      composer.addPass(gtao); composer.addPass(new OutputPass());
    } catch (e) { console.warn('Sin oclusión ambiental', e); composer = null; }
  }

  // ── Estado, vistas y cámara
  let modo = 'actual', vista = 'fachada', camAnim = null, margenInf = 0;
  const corte = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const vistas = {
    fachada: { pos: new THREE.Vector3(W / 2 - 7.2, 4.6, -8.2), target: new THREE.Vector3(W / 2, 2.6, Z0 + 1.5) },
    alta:    { pos: new THREE.Vector3(W / 2 + 2.2, NIV + 13.5, (Z0 + Z1) / 2 - 7), target: new THREE.Vector3(W / 2, NIV, (Z0 + Z1) / 2 + .2) },
    baja:    { pos: new THREE.Vector3(W / 2 + 2.2, 13.5, (Z0 + Z1) / 2 - 7), target: new THREE.Vector3(W / 2, 0, (Z0 + Z1) / 2 + .2) },
  };
  const posDe = v => {
    const p = vistas[v]; const k = v === 'fachada' ? (camera.aspect > 1 ? 1 : 1.05) : (camera.aspect > 1 ? 1.32 : 1.04);
    return p.target.clone().add(p.pos.clone().sub(p.target).multiplyScalar(k));
  };
  controls.addEventListener('start', () => { controls.autoRotate = false; camAnim = null; });

  function aplicar() {
    for (const v of variantes) v.mesh.material = v[modo];
    soloActual.visible = modo === 'actual'; soloRenovado.visible = modo === 'renovado';
    grupoPiso.forEach((g, i) => {
      g.visible = vista !== 'baja' || i === 0;
      g.children.forEach(ch => { if (ch.userData.modo) ch.visible = ch.userData.modo === modo; });
    });
    techo.visible = vista === 'fachada';
    // corte de sección: en las plantas los muros se cortan a 1.55 m para ver adentro
    if (vista === 'fachada') renderer.clippingPlanes = [];
    else { corte.constant = (vista === 'alta' ? NIV : 0) + 1.55; renderer.clippingPlanes = [corte]; }
    const nivel = vista === 'alta' ? nPisos - 1 : vista === 'baja' ? 0 : -1;
    for (const e of etiquetas) e.activa = e.nivel === nivel;
  }
  function irA(v, dur = 1.2) { camAnim = { from: camera.position.clone(), fromT: controls.target.clone(), to: posDe(v), toT: vistas[v].target.clone(), t: 0, dur }; }

  function ajustar() {
    const w = contenedor.clientWidth, h = contenedor.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.fov = w < h ? 56 : 38;
    if (margenInf > 0) camera.setViewOffset(w, h, 0, margenInf * .5, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  }
  const ro = new ResizeObserver(ajustar); ro.observe(contenedor); ajustar();

  camera.position.copy(posDe('fachada')).add(new THREE.Vector3(-5, 4, -6)); controls.target.copy(vistas.fachada.target);
  irA('fachada', 2.4);

  const reloj = new THREE.Clock(), tmp = new THREE.Vector3();
  let vivo = true, cuadros = 0, tiempo = 0;
  // Calidad automática: si el equipo va lento, se apagan los efectos pesados
  function revisarRendimiento(dt) {
    if (calidad !== 'auto' || cuadros > 400) return;
    cuadros++; if (cuadros < 20) return;
    tiempo += dt;
    if (cuadros % 60 === 0) {
      const prom = tiempo / 60; tiempo = 0;
      if (prom > .04 && composer) { composer = null; }
      else if (prom > .04 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); ajustar(); }
    }
  }
  function loop() {
    if (!vivo) return;
    requestAnimationFrame(loop);
    const dtReal = reloj.getDelta(), dt = Math.min(dtReal, .05);
    revisarRendimiento(dtReal);
    if (camAnim) {
      camAnim.t += dt / camAnim.dur; const k = 1 - Math.pow(1 - Math.min(camAnim.t, 1), 3);
      camera.position.lerpVectors(camAnim.from, camAnim.to, k); controls.target.lerpVectors(camAnim.fromT, camAnim.toT, k);
      if (camAnim.t >= 1) camAnim = null;
    }
    controls.update();
    if (composer) composer.render(); else renderer.render(scene, camera);
    const w = contenedor.clientWidth, h = contenedor.clientHeight;
    for (const e of etiquetas) {
      if (!e.activa) { e.el.style.opacity = 0; continue; }
      tmp.copy(e.pos).project(camera);
      e.el.style.opacity = (tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1) ? 1 : 0;
      e.el.style.transform = `translate(-50%,-50%) translate(${(tmp.x * .5 + .5) * w}px,${(-tmp.y * .5 + .5) * h}px)`;
    }
  }
  aplicar(); loop(); requestAnimationFrame(() => onListo?.());

  return {
    setModo(m) { modo = m; aplicar(); },
    setVista(v) { vista = v; aplicar(); irA(v); controls.autoRotate = false; },
    setMargenInferior(px) { margenInf = px; ajustar(); },
    girar(on) { controls.autoRotate = on; },
    destruir() { vivo = false; ro.disconnect(); composer?.dispose?.(); renderer.dispose(); pmrem.dispose(); contenedor.innerHTML = ''; },
  };
}
