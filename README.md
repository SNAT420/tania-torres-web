# Tania Torres | Asesora Inmobiliaria

Sitio web de Tania Torres, asesora inmobiliaria en Guadalajara y zona metropolitana.

- Página estática en un solo archivo: `index.html`
- Datos (propiedades, opiniones y configuración) en Firebase Firestore
- Cada cambio que se sube a la rama `main` se publica solo en Vercel

## Panel privado (`/panel`)

- Prospectos por etapa, citas con botón a Google Calendar y mensajes de Instagram y Facebook.
- Entra con la misma cuenta admin de Firebase (taniatorresvivar@gmail.com).
- Los mensajes llegan por ManyChat a `/api/manychat` y se guardan en Firestore (`inbox`).
- Variables en Vercel: `PANEL_WEBHOOK_TOKEN` y `FIREBASE_SERVICE_ACCOUNT`.

## Recorrido 3D (`/modelo3d?m=<modelo>`)

- Cada casa con 3D tiene un archivo en `modelos/<modelo>.json` con sus medidas: cuartos, puertas, ventanas, escalera, colores actuales y la propuesta de remodelación con muebles.
- El visor (`modelo3d.html` + `js/casa3d.js`) arma la casa en tiempo real con Three.js. Tiene los botones "Así está" / "Así podría quedar" y las vistas Fachada / Planta alta / Planta baja.
- Para mostrar el botón "Ver en 3D" en una propiedad hay dos formas: en el panel de admin, poner el nombre del archivo (sin `.json`) en el campo **Modelo 3D**, o agregar la propiedad en `modelos/propiedades.json` (id de Firestore → modelo). A las propiedades vendidas no se les muestra.
- Modelos actuales: `la-arboleda-magenta`, `viande-tlaquepaque` (departamento), `tierra-residencial-zapopan` (3 niveles + roof garden) y `casa-tonala-2rec` (aún sin publicar).
- Tipos y extras: `"tipo": "departamento"`, `modos` (nombres de los botones), `balcones`, `escaleras` (una por nivel), `barandales`, `fachada.paneles` (piedra, color, madera), `azotea.tipo: "roofGarden"` con `cuarto` y `pergola`, aberturas `ventanal`, y muebles como `litera`, `lavadero`, `asador`, `camastro`, `mesaExterior`.
- Medidas en metros. `x` se mide desde la izquierda viendo la casa desde la calle, `z` desde la banqueta hacia el fondo.
- Si las medidas son aproximadas, deja `"aproximado": true` para que el visor lo diga.
- Extras opcionales del JSON: `auto` (coche en la cochera), `fachada.marquesina` y `fachada.listones` (detalles de la fachada renovada), y `abre: "+" | "-"` en cada puerta para el lado hacia donde abre.
- La calidad se ajusta sola: en computadora usa sombras de contacto (oclusión ambiental) y si el equipo va lento las apaga. Para forzarla: `&calidad=alta` o `&calidad=baja`.
