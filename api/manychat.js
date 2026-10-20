// Recibe cada mensaje nuevo de Instagram o Facebook desde ManyChat (acción "External Request")
// y lo guarda en Firestore, colección "inbox", para que aparezca en /panel.
//
// Variables de entorno en Vercel:
//   PANEL_WEBHOOK_TOKEN       texto secreto que ManyChat manda en el encabezado "x-panel-token"
//   FIREBASE_SERVICE_ACCOUNT  JSON completo de la cuenta de servicio de Firebase (Configuración del proyecto → Cuentas de servicio)

const admin = require("firebase-admin");

function db() {
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin.firestore();
}

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const CANALES = { instagram: "Instagram", ig: "Instagram", facebook: "Facebook", fb: "Facebook", messenger: "Facebook", whatsapp: "WhatsApp" };

module.exports = async (req, res) => {
  if (req.method === "GET") return res.status(200).json({ ok: true, servicio: "panel-tania" });
  if (req.method !== "POST") return res.status(405).json({ error: "Usa POST" });

  const token = process.env.PANEL_WEBHOOK_TOKEN;
  if (!token || req.headers["x-panel-token"] !== token) return res.status(401).json({ error: "Token inválido" });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return res.status(500).json({ error: "Falta FIREBASE_SERVICE_ACCOUNT" });

  let b = req.body || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }

  const contactId = clip(b.id || b.user_id || b.contact_id, 80).replace(/[^A-Za-z0-9_-]/g, "");
  const text = clip(b.text || b.last_input_text || b.message, 2000);
  const channel = CANALES[clip(b.channel, 20).toLowerCase()] || "Otro";
  if (!contactId) return res.status(400).json({ error: "Falta id del contacto" });

  const ref = db().collection("inbox").doc(`${channel.toLowerCase()}_${contactId}`);
  const now = new Date().toISOString();

  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() : {};
    const messages = (prev.messages || []).concat(text ? [{ text, at: now }] : []).slice(-30);
    tx.set(ref, {
      contactId,
      channel,
      name: clip(b.name || b.full_name, 120) || prev.name || "",
      username: clip(b.username || b.ig_username, 80).replace(/^@/, "") || prev.username || "",
      phone: clip(b.phone, 30).replace(/\D/g, "") || prev.phone || "",
      lastText: text || prev.lastText || "",
      lastAt: now,
      createdAt: prev.createdAt || now,
      // un chat archivado vuelve a "nuevo" si la persona escribe otra vez; uno registrado se queda registrado
      status: prev.status === "registrado" ? "registrado" : "nuevo",
      prospectId: prev.prospectId || null,
      messages,
    });
  });

  res.status(200).json({ ok: true });
};
