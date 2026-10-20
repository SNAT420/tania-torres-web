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
