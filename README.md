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
- Para mostrar el botón "Ver en 3D" en una propiedad, en el panel de admin pon el nombre del archivo (sin `.json`) en el campo **Modelo 3D**. Ejemplo: `casa-tonala-2rec`.
- Medidas en metros. `x` se mide desde la izquierda viendo la casa desde la calle, `z` desde la banqueta hacia el fondo.
- Si las medidas son aproximadas, deja `"aproximado": true` para que el visor lo diga.
