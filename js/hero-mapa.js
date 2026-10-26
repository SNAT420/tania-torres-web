// Hero: el planeta de noche en dorado se acerca hasta Guadalajara y aparecen las zonas donde trabaja Tania.
// Mismo estilo que la animación de los videos. Datos: /mapa/zmg.json (INEGI, Natural Earth, códigos postales).
import * as THREE from 'three';

const GDL = { lat: 20.625, lon: -103.36 };
const rad = Math.PI / 180;
const v3 = (lat, lon, r = 1) => {
  const la = lat * rad, lo = lon * rad;
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, -Math.cos(la) * Math.sin(lo) * r);
};
const suave = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const banda = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a)));

function lineas(anillos, r) {
  const pos = [];
  for (const a of anillos) for (let i = 0; i < a.length - 2; i += 2) {
    const p = v3(a[i + 1], a[i], r), q = v3(a[i + 3], a[i + 2], r);
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
}
function relleno(anillo, r) {
  const pts = []; for (let i = 0; i < anillo.length - 2; i += 2) pts.push(new THREE.Vector2(anillo[i], anillo[i + 1]));
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts)); const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) { const v = v3(p.getY(k), p.getX(k), r); p.setXYZ(k, v.x, v.y, v.z); }
  return g;
}

export async function iniciarHeroMapa(contenedor, capaPines) {
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [datos, textura] = await Promise.all([
    fetch('/mapa/zmg.json').then(r => r.json()),
    new THREE.TextureLoader().loadAsync('/img/mapa/tierra-noche.jpg'),
  ]);
  textura.colorSpace = THREE.SRGBColorSpace; textura.anisotropy = 4;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'hero-mapa-canvas';
  contenedor.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, .001, 20);

  // Planeta y atmósfera dorada
  const globoMat = new THREE.MeshBasicMaterial({ map: textura, transparent: true });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), globoMat));
  const atmMat = new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
    uniforms: { c: { value: new THREE.Color('#c9a96e') }, o: { value: 1 } },
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 c; uniform float o; varying vec3 vN; void main(){ float i = pow(max(0.0, 0.72 - dot(vN, vec3(0.0, 0.0, 1.0))), 2.6); gl_FragColor = vec4(c, i * o); }',
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.08, 96, 64), atmMat));

  // Capas de líneas (se encienden y apagan según la altura, como en el video)
  const oro = '#c9a96e', oroClaro = '#e4c98a';
  const capa = (anillos, r, color) => { const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }); const l = new THREE.LineSegments(lineas(anillos, r), m); scene.add(l); return m; };
  const mMexico = capa(datos.mexico, 1.0012, oroClaro);
  const mEstados = capa(datos.estados, 1.001, oro);
  const mJalisco = capa(datos.jalisco, 1.0011, oroClaro);
  const mMunicipios = capa(datos.municipios, 1.0006, oro);
  const mCP = capa(datos.cp, 1.0003, oro);
  const mZMG = capa(datos.zmg.flatMap(z => z.anillos), 1.0007, oroClaro);
  const rellenoMat = new THREE.MeshBasicMaterial({ color: oro, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  for (const z of datos.zmg) for (const a of z.anillos) scene.add(new THREE.Mesh(relleno(a, 1.0005), rellenoMat));

  // Pines HTML de las 5 zonas
  const pines = datos.zmg.map(z => {
    const el = document.createElement('a'); el.className = 'hero-pin'; el.href = '#zonas'; el.dataset.zona = z.id;
    el.innerHTML = `<i></i><span>${z.nombre}</span>`; capaPines.appendChild(el);
    return { el, pos: v3(z.etiqueta[1], z.etiqueta[0], 1.0008) };
  });

  // Cámara: de la órbita hasta la ciudad, con una inclinación final para que se sienta en 3D
  const ALT0 = 2.7, ALT1 = .0145;
  const tmp = new THREE.Vector3(), objetivo = new THREE.Vector3(), norte = new THREE.Vector3(), este = new THREE.Vector3();
  let t0 = null, s = reducido ? 1 : 0, ancho = 1, alto = 1, px = 0, py = 0;
  const DUR = 6.8;
  function colocarCamara(tiempo) {
    const e = suave(s);
    const altFin = ALT1 * (ancho > 820 ? 1 : 1.25);
    const alt = Math.exp(Math.log(ALT0) + (Math.log(altFin) - Math.log(ALT0)) * e);
    const cs = suave(Math.min(1, s / .62));
    const lat = 6 + (GDL.lat - 6) * cs, lon = -58 + (GDL.lon + 58) * cs;
    const n = v3(lat, lon); objetivo.copy(n);
    norte.copy(v3(lat + .5, lon)).sub(n).normalize(); este.crossVectors(norte, n).normalize();
    const incl = banda(s, .72, 1) * .62;
    // al final la vista "respira": gira despacio y sigue un poco al mouse
    const giro = s >= 1 && !reducido ? Math.sin(tiempo * .00012) * .35 + px * .12 : 0;
    const dir = norte.clone().multiplyScalar(-Math.cos(giro)).add(este.clone().multiplyScalar(Math.sin(giro)));
    camera.position.copy(n).addScaledVector(n, alt * Math.cos(incl + py * .05)).addScaledVector(dir, alt * Math.sin(incl + py * .05));
    camera.up.copy(norte); camera.lookAt(objetivo);
    camera.near = alt * .05; camera.far = alt + 3; camera.updateProjectionMatrix();
    // opacidades por altura
    globoMat.opacity = .25 + .75 * banda(alt, .03, .2);
    atmMat.uniforms.o.value = banda(alt, .25, 1.2);
    mMexico.opacity = .75 * banda(alt, .03, .08) * (1 - banda(alt, 1.4, 2.4) * .5);
    mEstados.opacity = .4 * banda(alt, .05, .12) * banda(-alt, -1.6, -.5);
    mJalisco.opacity = .9 * banda(alt, .02, .05) * banda(-alt, -.9, -.2);
    mMunicipios.opacity = .35 * banda(-alt, -.32, -.1) * (1 - banda(-alt, -.05, -.025) * .6);
    mCP.opacity = .22 * banda(-alt, -.06, -.028);
    mZMG.opacity = .95 * banda(-alt, -.14, -.05);
    rellenoMat.opacity = .07 * banda(-alt, -.06, -.025);
    return alt;
  }
  const textoHero = contenedor.parentElement.querySelector('.hero-content');
  const limiteTexto = () => textoHero ? textoHero.getBoundingClientRect().bottom - contenedor.getBoundingClientRect().top + 10 : 0;
  function ajustar() {
    ancho = contenedor.clientWidth; alto = contenedor.clientHeight;
    renderer.setSize(ancho, alto); camera.aspect = ancho / alto;
    // en computadora el mapa vive a la derecha del texto; en celular, abajo
    if (ancho > 820) camera.setViewOffset(ancho, alto, -ancho * .2, 0, ancho, alto);
    else camera.setViewOffset(ancho, alto, 0, -alto * .36, ancho, alto);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(ajustar); ro.observe(contenedor); ajustar();
  addEventListener('pointermove', e => { px = e.clientX / innerWidth - .5; py = e.clientY / innerHeight - .5; }, { passive: true });

  // un solo ciclo de dibujo; se pausa cuando el hero no se ve o la pestaña está oculta
  let visible = true, corriendo = false;
  const arrancar = () => { if (!corriendo) { corriendo = true; requestAnimationFrame(cuadro); } };
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) arrancar(); }).observe(contenedor);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) arrancar(); });
  new ResizeObserver(() => arrancar()).observe(contenedor);

  contenedor.classList.add('listo');
  function cuadro(tiempo) {
    if (!visible || document.hidden) { corriendo = false; return; }
    if (!reducido) {
      if (t0 === null) t0 = tiempo + 350;
      s = Math.min(1, Math.max(0, (tiempo - t0) / 1000 / DUR));
    }
    colocarCamara(tiempo);
    renderer.render(scene, camera);
    const mostrar = banda(s, .9, 1);
    for (const p of pines) {
      tmp.copy(p.pos).project(camera);
      const x = (tmp.x * .5 + .5) * ancho, y = (-tmp.y * .5 + .5) * alto;
      const dentro = tmp.z < 1 && x > 0 && x < ancho && y > (ancho > 820 ? 60 : limiteTexto()) && y < alto;
      p.el.style.opacity = dentro ? mostrar : 0;
      p.el.style.pointerEvents = dentro && mostrar > .5 ? 'auto' : 'none';
      p.el.style.transform = `translate(${x}px, ${y}px)`;
    }
    if (reducido) { corriendo = false; return; }
    requestAnimationFrame(cuadro);
  }
  arrancar();
  return { destruir() { ro.disconnect(); renderer.dispose(); } };
}
