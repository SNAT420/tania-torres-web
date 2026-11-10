#!/usr/bin/env python3
"""Agente de mensajes de Tania Torres (corre en la Mac con Ollama).

No contesta solo a los clientes: escribe una respuesta sugerida en el panel
(/panel, pestaña Mensajes) y Santi o Tania la revisan y la mandan.

Uso:
  python3 agente.py chat         -> pruebas: tú escribes como si fueras cliente
  python3 agente.py borradores   -> revisa la bandeja del panel cada minuto y deja borradores

Variables opcionales:
  OLLAMA_MODEL   modelo de Ollama (por defecto gpt-oss:20b)
  FIREBASE_KEY   ruta al JSON de la cuenta de servicio (por defecto ./cuenta-servicio.json)
"""
import json, os, re, sys, time, unicodedata, urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

MODELO = os.environ.get("OLLAMA_MODEL", "gpt-oss:20b")
OLLAMA = "http://localhost:11434/api/chat"
PROYECTO = "tania-torres-web"
WHATSAPP = "33 2277 5288"
PAGINA = "tania-torres-asesora-inmobiliaria.vercel.app"
TZ = ZoneInfo("America/Mexico_City")
MUNICIPIOS = ["Tlajomulco", "Tlaquepaque", "Tonalá", "Zapopan", "Guadalajara", "El Salto", "Juanacatlán"]


# ---------- casas (se leen de la página, son públicas) ----------
def _valor(v):
    if "stringValue" in v: return v["stringValue"]
    if "integerValue" in v: return int(v["integerValue"])
    if "doubleValue" in v: return v["doubleValue"]
    if "booleanValue" in v: return v["booleanValue"]
    if "arrayValue" in v: return [_valor(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v: return {k: _valor(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def _sin_acentos(t):
    return unicodedata.normalize("NFD", t).encode("ascii", "ignore").decode().lower()


def municipio(ubicacion):
    u = _sin_acentos(ubicacion or "")
    for m in MUNICIPIOS:
        if _sin_acentos(m) in u:
            return m
    return "zona metropolitana de Guadalajara"


_cache = {"t": 0, "casas": []}


def casas():
    if time.time() - _cache["t"] < 600:
        return _cache["casas"]
    url = f"https://firestore.googleapis.com/v1/projects/{PROYECTO}/databases/(default)/documents/properties?pageSize=100"
    with urllib.request.urlopen(url, timeout=20) as r:
        docs = json.load(r).get("documents", [])
    lista = []
    for d in docs:
        p = {k: _valor(v) for k, v in d.get("fields", {}).items()}
        # quita los nombres de fraccionamiento antes de que el modelo los vea
        mun = municipio(p.get("location", ""))
        ocultar = [x.strip() for x in (p.get("location") or "").split(",")
                   if x.strip() and _sin_acentos(mun) not in _sin_acentos(x) and "jalisco" not in _sin_acentos(x)]
        def limpio(t):
            for n in ocultar:
                t = re.sub(re.escape(n), "", t, flags=re.I)
            return re.sub(r"\s+,", ",", re.sub(r"(en|,)\s*,", r"\1", re.sub(r"[ \t]{2,}", " ", t))).strip(" ,")
        lista.append({
            "titulo": limpio(p.get("title", "")),
            "operacion": p.get("type", "venta"),
            "precio_desde": p.get("price"),
            "municipio": mun,
            "recamaras": p.get("beds") or None,
            "banos": p.get("baths") or None,
            "m2_construccion": p.get("size") or None,
            "estacionamientos": p.get("parking") or None,
            "descripcion": limpio(p.get("description") or "")[:500],
        })
    _cache.update(t=time.time(), casas=lista)
    return lista


# ---------- el modelo ----------
REGLAS = f"""Eres el asistente que redacta respuestas para Tania Torres, asesora inmobiliaria en Guadalajara y zona metropolitana.
Tu texto lo revisa una persona antes de mandarlo. Escribe como Tania: español de México, cercano, profesional, breve (2 a 5 renglones).

Reglas que no se rompen:
- Usa SOLO los datos de la lista de casas de abajo. Si no está en la lista, no lo afirmes: di que lo confirmas.
- Nunca inventes precios, medidas, créditos, disponibilidad ni fechas.
- Ubicación: solo di el municipio. Nunca nombres de fraccionamientos, colonias ni calles, aunque aparezcan en la descripción. La ubicación exacta se comparte al confirmar la visita.
- Los precios son "desde". No prometas montos de crédito ni aprobaciones.
- Sin emojis. No ofrezcas "consultas gratis".
- Si quiere visitar, pregunta qué casa, qué día y horario, y cómo piensa comprar (Infonavit, Fovissste, bancario o contado).
- Si pide descuento, negociar, apartar, hablar de papeles, escrituras o algo que no sepas: marca pasar_a_tania.
- Si quiere vender o rentar su casa, pregunta colonia y número de recámaras, y marca pasar_a_tania.
- WhatsApp de Tania: {WHATSAPP}. Página: {PAGINA}.

Responde SOLO con este JSON:
{{"respuesta": "texto para el cliente",
  "pasar_a_tania": true o false,
  "motivo": "por qué Tania debe tomarlo, o vacío",
  "interes": "Comprar" | "Vender" | "Rentar" | "Crédito" | "Otro",
  "cita": null o {{"casa": "...", "fecha": "AAAA-MM-DD o vacío", "hora": "HH:MM o vacío"}}}}"""


def pedir(historial):
    hoy = datetime.now(TZ).strftime("%A %d de %B de %Y, %H:%M")
    sistema = REGLAS + f"\n\nHoy es {hoy}.\n\nCasas disponibles:\n" + json.dumps(casas(), ensure_ascii=False, indent=1)
    cuerpo = {"model": MODELO, "stream": False, "options": {"temperature": 0.3},
              "messages": [{"role": "system", "content": sistema}] + historial}
    if MODELO.startswith("gpt-oss"):
        cuerpo["think"] = "low"   # piensa poco: responde más rápido
    else:
        cuerpo["format"] = "json"
    req = urllib.request.Request(OLLAMA, json.dumps(cuerpo).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        texto = json.load(r)["message"]["content"]
    try:
        out = json.loads(texto[texto.index("{"):texto.rindex("}") + 1])
    except ValueError:
        out = {"respuesta": texto, "pasar_a_tania": True, "motivo": "El modelo no respondió en el formato esperado"}
    out.setdefault("respuesta", "")
    out.setdefault("pasar_a_tania", False)
    return out


# ---------- modo prueba ----------
def chat():
    print(f"Modelo: {MODELO} · {len(casas())} casas cargadas. Escribe como cliente. 'salir' para terminar.\n")
    historial = []
    while True:
        msg = input("Cliente: ").strip()
        if msg.lower() in ("salir", "exit", "/bye"):
            break
        historial.append({"role": "user", "content": msg})
        r = pedir(historial)
        print(f"\nTania (borrador): {r['respuesta']}")
        if r.get("pasar_a_tania"):
            print(f"  >> Pasar a Tania: {r.get('motivo', '')}")
        if r.get("cita"):
            print(f"  >> Cita sugerida: {r['cita']}")
        print()
        historial.append({"role": "assistant", "content": r["respuesta"]})


# ---------- modo bandeja del panel ----------
def borradores():
    import firebase_admin
    from firebase_admin import credentials, firestore
    llave = os.environ.get("FIREBASE_KEY", os.path.join(os.path.dirname(os.path.abspath(__file__)), "cuenta-servicio.json"))
    firebase_admin.initialize_app(credentials.Certificate(llave))
    db = firestore.client()
    print(f"Revisando la bandeja cada minuto con {MODELO}. Ctrl+C para detener.")
    while True:
        try:
            for doc in db.collection("inbox").where("status", "==", "nuevo").stream():
                m = doc.to_dict()
                if not m.get("messages") or m.get("draftFor") == m.get("lastAt"):
                    continue  # ya tiene borrador para el último mensaje
                historial = [{"role": "user", "content": x["text"]} for x in m["messages"][-10:] if x.get("text")]
                r = pedir(historial)
                doc.reference.update({
                    "draft": r["respuesta"],
                    "draftHandoff": bool(r.get("pasar_a_tania")),
                    "draftReason": r.get("motivo", ""),
                    "draftInterest": r.get("interes", ""),
                    "draftAppt": r.get("cita"),
                    "draftFor": m.get("lastAt"),
                    "draftAt": datetime.now(TZ).isoformat(),
                })
                print(f"[{datetime.now(TZ):%H:%M}] Borrador para {m.get('name') or m.get('username') or doc.id}")
        except Exception as e:
            print("Error:", e)
        time.sleep(60)


if __name__ == "__main__":
    modo = sys.argv[1] if len(sys.argv) > 1 else "chat"
    {"chat": chat, "borradores": borradores}.get(modo, chat)()
