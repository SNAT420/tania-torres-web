#!/bin/bash
# Instalador del agente de mensajes de Tania Torres. Córrelo una vez: bash instalar.command
set -e
DIR="$HOME/agente-tania"
mkdir -p "$DIR"; cd "$DIR"
echo "== Agente de Tania: instalando en $DIR =="

if ! command -v ollama >/dev/null; then
  echo "No encuentro Ollama. Abre la app de Ollama desde Aplicaciones y vuelve a correr esto."; exit 1
fi
if ! curl -s http://localhost:11434 >/dev/null; then
  echo "Ollama no está abierto. Abriéndolo..."; open -a Ollama || true; sleep 5
fi

RAM=$(( $(sysctl -n hw.memsize) / 1073741824 ))
if [ "$RAM" -ge 12 ]; then MODELO="qwen3:8b"; else MODELO="qwen3:4b"; fi
echo "Tu Mac tiene ${RAM} GB de RAM. Uso el modelo: $MODELO"
ollama pull "$MODELO"
echo "$MODELO" > modelo.txt

cat > agente.py <<'AGENTE_EOF'
#!/usr/bin/env python3
"""Agente de mensajes de Tania Torres (corre en la Mac con Ollama).

No contesta solo a los clientes: escribe una respuesta sugerida en el panel
(/panel, pestaña Mensajes) y Santi o Tania la revisan y la mandan.

Uso:
  python3 agente.py chat         -> pruebas: tú escribes como si fueras cliente
  python3 agente.py revisar      -> hace una vuelta completa y termina (para probar)
  python3 agente.py borradores   -> trabaja sin parar:
       cada minuto: respuesta sugerida a mensajes nuevos de Instagram y Facebook
       cada 30 min: mensaje de seguimiento para los prospectos que toca escribir hoy
       cada 10 min: si hay casa nueva en la página, avisa a quién le queda

Variables opcionales:
  OLLAMA_MODEL   modelo de Ollama (por defecto qwen3:8b)
  FIREBASE_KEY   ruta al JSON de la cuenta de servicio (por defecto ./cuenta-servicio.json)
"""
import json, os, re, sys, time, unicodedata, urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

MODELO = os.environ.get("OLLAMA_MODEL", "qwen3:8b")
OLLAMA = "http://localhost:11434/api/chat"
PROYECTO = "tania-torres-web"
WHATSAPP = "33 2277 5288"
PAGINA = "tania-torres-asesora-inmobiliaria.vercel.app/#propiedades"
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


try:  # el Python de python.org en Mac no trae certificados; certifi viene con firebase-admin
    import certifi, ssl
    _SSL = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL = None

_cache = {"t": 0, "casas": [], "ocultar": {}, "precios": set()}


def es_vendida(p):
    return p.get("status") == "vendida" or bool(re.match(r"\s*vendid[ao]", p.get("description") or "", re.I))


def casas():
    if time.time() - _cache["t"] < 600:
        return _cache["casas"]
    url = f"https://firestore.googleapis.com/v1/projects/{PROYECTO}/databases/(default)/documents/properties?pageSize=100"
    with urllib.request.urlopen(url, timeout=20, context=_SSL) as r:
        docs = json.load(r).get("documents", [])
    lista, todos_ocultar, precios = [], {}, set()
    for d in docs:
        p = {k: _valor(v) for k, v in d.get("fields", {}).items()}
        # quita los nombres de fraccionamiento antes de que el modelo los vea
        mun = municipio(p.get("location", ""))
        ocultar = [x.strip() for x in (p.get("location") or "").split(",")
                   if len(x.strip()) > 3 and _sin_acentos(mun) not in _sin_acentos(x) and "jalisco" not in _sin_acentos(x)]
        todos_ocultar.update({n: mun for n in ocultar})
        if es_vendida(p):
            continue  # no ofrecer casas vendidas

        def limpio(t):
            for n in ocultar:
                t = re.sub(re.escape(n), "", t, flags=re.I)
            t = re.sub(r"(?im)^.*agenda tu visita.*$", "", t)
            return re.sub(r"\s+,", ",", re.sub(r"(en|,)\s*,", r"\1", re.sub(r"[ \t]{2,}", " ", t))).strip(" ,\n")
        if p.get("price"):
            precios.add(int(p["price"]))
        lista.append({
            "id": d["name"].rsplit("/", 1)[-1],
            "titulo": limpio(p.get("title", "")),
            "operacion": p.get("type", "venta"),
            "precio_desde": p.get("price"),
            "municipio": mun,
            "recamaras": p.get("beds") or None,
            "banos": p.get("baths") or None,
            "m2_construccion": p.get("size") or None,
            "estacionamientos": p.get("parking") or None,
            "descripcion": limpio(p.get("description") or "")[:600],
        })
    _cache.update(t=time.time(), casas=lista, ocultar=todos_ocultar, precios=precios)
    return lista


# ---------- el modelo ----------
VOZ = """Redactas mensajes para Tania Torres, asesora inmobiliaria en Guadalajara y zona metropolitana (Guadalajara, Zapopan, Tlajomulco, Tlaquepaque y Tonalá).
Una persona revisa tu texto antes de mandarlo. Escribe como Tania en primera persona: español de México, cercano, profesional, breve (2 a 4 renglones), como un mensaje de Messenger o WhatsApp.

Cómo suena Tania:
- Habla ella misma ("te comparto", "con gusto", "déjame revisarlo"). Nunca "mi equipo", "nuestro equipo", "tu solicitud", "estimado cliente".
- No uses "Por favor" ni listas numeradas. Si hay dos opciones, dilas en una frase.
- Tutea a la persona, salvo que ella hable de usted; entonces háblale de usted.
- Termina con UNA sola pregunta, la más útil para avanzar. Si la persona se está despidiendo, no preguntes nada.
- No empujes la cita. Primero informa y deja que vea las casas; la visita se ofrece solo si la pide o si ya mostró interés claro en una casa.
- Comparte la página cuando ayude a ver fotos, precios y todas las casas. Ponla tal cual: {pagina}
- Sin emojis. Nunca ofrezcas "consultas gratis" ni digas "gratis".
"""

DATOS = f"""
Reglas que no se rompen:
- Usa SOLO los datos de la lista de casas de abajo. Lo que no está en la lista no lo afirmes: di que lo confirmas.
- Nunca inventes precios, medidas, créditos, disponibilidad, fechas, enganches ni mensualidades.
- Ubicación: solo el municipio. Nunca nombres de fraccionamientos, colonias ni calles. La ubicación exacta la comparte Tania directamente.
- Los precios son "desde". No prometas montos de crédito, aprobaciones ni que "sí te alcanza".
- Las casas de la lista están publicadas y disponibles; puedes decir que sí está disponible si identificas cuál es.
- WhatsApp de Tania: {WHATSAPP}.
"""

REGLAS = VOZ + DATOS + """
Cómo leer el mensaje. En Facebook la gente escribe poco, con faltas o con mensajes automáticos. Antes de contestar, entiende qué quiere y clasifícalo:

- "vago": "info", "informes", "+info", "imformacion", "precio", "costo", "cuánto?", "$?", "me interesa", "disponible?", "sigue disponible?", "ubicación", "dónde está?", "hola", "buenas", un emoji, un "?" o los mensajes automáticos de Facebook ("¿Me puedes dar más información?", "Hola, ¿sigue disponible?", "Me interesa esta propiedad"). No sabemos qué casa vio. NO mandes la lista de casas ni inventes cuál es. Saluda, preséntate si es el primer mensaje, comparte la página y pregunta qué casa vio o en qué zona busca.
  Ejemplo: "Buenas tardes, gracias por escribirme. Soy Tania Torres, asesora inmobiliaria. Con gusto te doy información. Aquí puedes ver todas mis casas con fotos y precios: {pagina} ¿Cuál fue la que viste o en qué zona estás buscando?"
- "casa": pregunta por una casa que se puede identificar (municipio, precio, tipo o algo de su descripción). Da precio desde, recámaras, baños y créditos que acepta, comparte la página para las fotos y pregunta cómo piensa comprar o si tiene alguna duda. Si dos o más podrían ser, menciónalas en una frase y pregunta cuál.
- "busqueda": dice qué busca (zona, presupuesto, recámaras, crédito). Recomienda solo las que cumplan y comparte la página. Si ninguna cumple, dilo con honestidad y ofrece la más cercana o pregunta si puede ajustar zona o presupuesto.
- "dinero": pregunta enganche, mensualidades, puntos de Infonavit, cuánto le prestan, gastos de escrituración, apartado. No calcules ni inventes cifras. Explica en una frase que depende de su crédito y que Tania le ayuda a revisarlo, y pregunta qué crédito tiene o cuánto le dio su precalificación. Si pregunta con cuánto se aparta o pide descuento, marca pasar_a_tania.
- "credito": pregunta si aceptan Infonavit, Fovissste, bancario, Cofinavit, crédito conyugal, etc. Responde con lo que diga la casa (si se sabe cuál) y di que Tania lo acompaña en el trámite.
- "visita": PIDE ver una casa. Pregunta qué casa (si no se sabe) y qué día y horario le queda; marca pasar_a_tania para que ella confirme.
- "contacto": manda su teléfono, pide que le llamen o quiere hablar por WhatsApp. Agradece, dile que Tania le escribe y comparte el WhatsApp. Marca pasar_a_tania.
- "vender": quiere vender o rentar su casa, o pregunta cuánto cobra Tania. Muestra interés, pregunta en qué colonia está y cuántas recámaras tiene. No digas comisiones. Marca pasar_a_tania.
- "renta": busca rentar (no comprar). Si en la lista hay casas en renta, ofrécelas; si no, di que por ahora Tania tiene casas en venta y pregunta si le interesaría comprar con crédito.
- "fuera": busca fuera de la zona metropolitana de Guadalajara. Di con amabilidad que Tania trabaja en Guadalajara y zona metropolitana, y pregunta si le interesa algo aquí.
- "desconfianza": pregunta si es real, si es fraude o duda. Responde con calma: Tania es asesora inmobiliaria, puede ver sus casas en la página y escribirle por WhatsApp. Nada de presionar.
- "cierre": "gracias", "ok", "lo pienso", "luego te aviso", "ya no me interesa". Despídete breve y amable, deja la puerta abierta, sin preguntas ni insistir.
- "multimedia": mandó foto, audio, sticker o video y no hay texto. Di con amabilidad que por aquí no puedes ver o escuchar el archivo y pídele que te escriba qué busca.
- "tania": queja, negociación, descuento, apartado, papeles, escrituras, otro asesor que quiere compartir comisión, o algo que no sabes. Contesta natural y breve, y marca pasar_a_tania.
- "spam": publicidad, insultos o algo sin relación. Respuesta vacía "" y marca pasar_a_tania.

Si el mensaje trae varias preguntas juntas, contesta todas brevemente en el mismo mensaje.

Saludos:
- Si es el primer mensaje de la persona, empieza con el saludo que se indica abajo y preséntate en una frase ("Soy Tania Torres, asesora inmobiliaria").
- Si no es el primero, no vuelvas a saludar ni a presentarte; ve directo a lo que preguntó.
- Solo ves los mensajes del cliente, no lo que Tania le contestó. Lee todos sus mensajes para entender el contexto ("la de Tonalá" después de "info" significa que pregunta por la casa de Tonalá) y no repitas preguntas que ya respondió.

Responde SOLO con este JSON:
{"respuesta": "texto para el cliente",
  "tipo": "vago" | "casa" | "busqueda" | "dinero" | "credito" | "visita" | "contacto" | "vender" | "renta" | "fuera" | "desconfianza" | "cierre" | "multimedia" | "tania" | "spam",
  "pasar_a_tania": true o false,
  "motivo": "por qué Tania debe tomarlo, o vacío",
  "interes": "Comprar" | "Vender" | "Rentar" | "Crédito" | "Otro",
  "cita": null o {"casa": "...", "fecha": "AAAA-MM-DD o vacío", "hora": "HH:MM o vacío"}}"""

SEGUIMIENTO = VOZ + DATOS + """
Tarea: escribe UN mensaje de seguimiento para un prospecto que no ha vuelto a escribir.
- Salúdalo por su primer nombre y retoma lo que buscaba (usa sus notas). No repitas un mensaje genérico.
- Si en la lista hay una casa que le queda mejor por municipio, precio o crédito, menciónala con su precio "desde".
- Propón un paso fácil: ver las fotos en la página ({pagina}) o resolver alguna duda. La visita solo si ya había mostrado interés claro.
- No lo presiones ni le reclames que no ha contestado.
Responde SOLO con este JSON: {"mensaje": "texto"}"""

COINCIDENCIA = VOZ + DATOS + """
Tarea: llegó una casa nueva. Decide si le queda a este prospecto según lo que buscaba (municipio, presupuesto, recámaras, crédito, operación).
Si no hay datos suficientes para pensar que le interesa, di que no. Es mejor no molestar a alguien que mandarle algo que no busca.
Si sí le queda, escribe un mensaje corto avisándole de la casa con su precio "desde" y compartiéndole la página para ver las fotos ({pagina}).
Responde SOLO con este JSON: {"le_queda": true o false, "razon": "en pocas palabras", "mensaje": "texto o vacío"}"""

VOZ, REGLAS, SEGUIMIENTO, COINCIDENCIA = (x.replace("{pagina}", PAGINA) for x in (VOZ, REGLAS, SEGUIMIENTO, COINCIDENCIA))


TIPOS = ["vago", "casa", "busqueda", "dinero", "credito", "visita", "contacto", "vender", "renta", "fuera",
         "desconfianza", "cierre", "multimedia", "tania", "spam"]
ESQ_RESPUESTA = {"type": "object", "required": ["tipo", "respuesta", "pasar_a_tania", "motivo", "interes"], "properties": {
    "tipo": {"type": "string", "enum": TIPOS},
    "respuesta": {"type": "string"},
    "pasar_a_tania": {"type": "boolean"},
    "motivo": {"type": "string"},
    "interes": {"type": "string", "enum": ["Comprar", "Vender", "Rentar", "Crédito", "Otro"]}}}
ESQ_MENSAJE = {"type": "object", "required": ["mensaje"], "properties": {"mensaje": {"type": "string"}}}
ESQ_COINCIDENCIA = {"type": "object", "required": ["le_queda", "razon", "mensaje"], "properties": {
    "le_queda": {"type": "boolean"}, "razon": {"type": "string"}, "mensaje": {"type": "string"}}}


def modelo(sistema, mensajes, con_casas=True, esquema=None):
    """Manda la conversación a Ollama y regresa el JSON que contesta.
    Con esquema, Ollama obliga al modelo a contestar exactamente con esos campos."""
    hoy = datetime.now(TZ).strftime("%d/%m/%Y %H:%M")
    sistema += f"\n\nHoy es {hoy}."
    if con_casas:
        sistema += "\n\nCasas disponibles:\n" + json.dumps(casas(), ensure_ascii=False, indent=1)
    cuerpo = {"model": MODELO, "stream": False, "options": {"temperature": 0.3},
              "messages": [{"role": "system", "content": sistema}] + mensajes}
    cuerpo["format"] = esquema or "json"
    if MODELO.startswith("gpt-oss"):
        cuerpo["think"] = "low"   # piensa poco: responde más rápido
    elif MODELO.startswith("qwen3"):
        cuerpo["think"] = False   # sin modo "pensar": más rápido y gasta menos
    req = urllib.request.Request(OLLAMA, json.dumps(cuerpo).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        texto = json.load(r)["message"]["content"]
    try:
        out = json.loads(texto[texto.index("{"):texto.rindex("}") + 1])
    except ValueError:
        return {"_crudo": texto}
    if esquema and not all(k in out for k in esquema["required"]):
        out["_crudo"] = texto  # contestó con otra forma: se guarda para revisarlo
    return out


def saludo():
    h = datetime.now(TZ).hour
    return "Buenos días" if 5 <= h < 12 else "Buenas tardes" if 12 <= h < 19 else "Buenas noches"


# ---------- antes y después del modelo ----------
URL_ADJUNTO = re.compile(r"https?://\S*(fbcdn|fbsbx|scontent|cdn\.fbsbx|lookaside)\S*", re.I)
EMOJI = re.compile("[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F900-\U0001F9FF️‍]+")


def preparar(texto):
    """Limpia el mensaje del cliente: adjuntos de Facebook, mensajes vacíos."""
    t = (texto or "").strip()
    if not t or URL_ADJUNTO.fullmatch(t):
        return "[el cliente mandó una foto, audio, sticker o video, sin texto]"
    return URL_ADJUNTO.sub("[archivo adjunto]", t)


def revisar(out):
    """Candados: corrige o marca lo que el modelo no debió escribir."""
    txt, avisos = out.get("respuesta") or "", []
    for n, mun in sorted(_cache["ocultar"].items(), key=lambda x: -len(x[0])):
        if re.search(re.escape(n), txt, re.I):
            # "en Viande, Tlaquepaque" -> "en Tlaquepaque"; "en Viande cuesta" -> "en Tlaquepaque cuesta"
            txt = re.sub(re.escape(n) + r",\s*(?=" + re.escape(mun) + ")", "", txt, flags=re.I)
            txt = re.sub(re.escape(n), mun, txt, flags=re.I)
            avisos.append(f"cambié el nombre del fraccionamiento ({n}) por el municipio")
    if EMOJI.search(txt):
        txt = EMOJI.sub("", txt)
    for m in re.finditer(r"\$\s?([\d][\d,\.]*)", txt):
        num = int(re.sub(r"[^\d]", "", m.group(1).split(".")[0]) or 0)
        if num >= 100000 and num not in _cache["precios"]:
            avisos.append(f"revisa el precio {m.group(0).rstrip('.,')}: no coincide con ninguna casa")
    if re.search(r"gratis|mi equipo|nuestro equipo", txt, re.I):
        avisos.append("revisa la redacción: dice 'gratis' o 'mi equipo'")
    out["respuesta"] = re.sub(r"[ \t]{2,}", " ", txt).strip()
    if avisos:
        out["pasar_a_tania"] = True
        out["motivo"] = "; ".join(filter(None, [out.get("motivo", ""), *avisos]))
    return out


def pedir(historial, primero=False):
    historial = [{"role": h["role"], "content": preparar(h["content"]) if h["role"] == "user" else h["content"]} for h in historial]
    contexto = (f"\n\nEs el PRIMER mensaje de esta persona. Saludo que corresponde ahora: \"{saludo()}\"." if primero
                else "\n\nNo es el primer mensaje de esta persona: no la saludes de nuevo.")
    out = modelo(REGLAS + contexto, historial, esquema=ESQ_RESPUESTA)
    if "_crudo" in out and not out.get("respuesta"):
        out = {"respuesta": "", "tipo": None, "pasar_a_tania": True,
               "motivo": "El modelo no respondió en el formato esperado: " + out["_crudo"][:300]}
    out.setdefault("respuesta", "")
    out.setdefault("pasar_a_tania", False)
    return revisar(out)


# ---------- modo prueba ----------
def chat():
    print(f"Modelo: {MODELO} · {len(casas())} casas cargadas. Escribe como cliente. 'salir' para terminar.\n")
    historial = []
    while True:
        msg = input("Cliente: ").strip()
        if msg.lower() in ("salir", "exit", "/bye"):
            break
        historial.append({"role": "user", "content": msg})
        r = pedir(historial, primero=len(historial) == 1)
        print(f"\nTania (borrador) [{r.get('tipo', '?')}]: {r['respuesta']}")
        if r.get("pasar_a_tania"):
            print(f"  >> Pasar a Tania: {r.get('motivo', '')}")
        if r.get("cita"):
            print(f"  >> Cita sugerida: {r['cita']}")
        print()
        historial.append({"role": "assistant", "content": r["respuesta"]})


# ---------- trabajo con el panel (Firestore) ----------
AQUI = os.path.dirname(os.path.abspath(__file__))


def conectar():
    import firebase_admin
    from firebase_admin import credentials, firestore
    llave = os.environ.get("FIREBASE_KEY", os.path.join(AQUI, "cuenta-servicio.json"))
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(llave))
    return firestore.client()


def log(txt):
    print(f"[{datetime.now(TZ):%d/%m %H:%M}] {txt}", flush=True)


def hoy():
    return datetime.now(TZ).strftime("%Y-%m-%d")


def dias_desde(fecha):
    try:
        return (datetime.now(TZ).date() - datetime.strptime(fecha[:10], "%Y-%m-%d").date()).days
    except (TypeError, ValueError):
        return 0


def ficha(p):
    """Lo que el modelo necesita saber de un prospecto."""
    return json.dumps({k: p.get(k) for k in ("name", "interest", "property", "channel", "stage", "notes", "lastContact")},
                      ensure_ascii=False)


def tarea_bandeja(db):
    """Mensajes nuevos de Instagram y Facebook -> respuesta sugerida."""
    for doc in db.collection("inbox").where("status", "==", "nuevo").stream():
        m = doc.to_dict()
        if not m.get("messages") or m.get("draftFor") == m.get("lastAt"):
            continue  # ya tiene borrador para el último mensaje
        historial = [{"role": "user", "content": x["text"]} for x in m["messages"][-10:] if x.get("text")]
        r = pedir(historial, primero=not m.get("draftFor") and len(m["messages"]) <= 2)
        doc.reference.update({
            "draft": r["respuesta"], "draftHandoff": bool(r.get("pasar_a_tania")), "draftReason": r.get("motivo", ""),
            "draftInterest": r.get("interes", ""), "draftAppt": r.get("cita"), "draftType": r.get("tipo", ""),
            "draftFor": m.get("lastAt"), "draftAt": datetime.now(TZ).isoformat(),
        })
        log(f"Respuesta sugerida para {m.get('name') or m.get('username') or doc.id}")


def tarea_seguimientos(db):
    """Prospectos a los que toca escribir hoy -> mensaje personalizado (lo usa el botón WhatsApp de la pestaña Hoy)."""
    t = hoy()
    for doc in db.collection("prospects").stream():
        p = doc.to_dict()
        if p.get("stage") == "cita":
            continue
        if p.get("nextFollowUp") and p["nextFollowUp"] <= t:
            clave = p["nextFollowUp"]
        elif p.get("stage") == "sinrespuesta" and not p.get("nextFollowUp") and dias_desde(p.get("lastContact")) >= 2:
            clave = p.get("lastContact")
        else:
            continue
        if p.get("aiFollowFor") == clave:
            continue
        r = modelo(SEGUIMIENTO, [{"role": "user", "content": f"Prospecto: {ficha(p)}\nDías sin contacto: {dias_desde(p.get('lastContact'))}"}],
                   esquema=ESQ_MENSAJE)
        if r.get("mensaje"):
            r["mensaje"] = revisar({"respuesta": r["mensaje"]})["respuesta"]
            doc.reference.update({"aiFollow": r["mensaje"], "aiFollowFor": clave, "aiFollowAt": datetime.now(TZ).isoformat()})
            log(f"Seguimiento listo para {p.get('name')}")


def tarea_casas_nuevas(db):
    """Casa nueva en la página -> avisa a los prospectos a los que les queda."""
    archivo = os.path.join(AQUI, "casas-vistas.json")
    actuales = {c["id"]: c for c in casas()}
    if not os.path.exists(archivo):  # primera vez: solo aprende cuáles ya existen
        json.dump(list(actuales), open(archivo, "w"))
        return
    vistas = set(json.load(open(archivo)))
    nuevas = [c for i, c in actuales.items() if i not in vistas]
    if not nuevas:
        return
    prospectos = [d for d in db.collection("prospects").stream()
                  if d.to_dict().get("interest") not in ("Vender", "Rentar")]
    for casa in nuevas:
        log(f"Casa nueva: {casa['titulo']}. Revisando {len(prospectos)} prospectos...")
        for doc in prospectos:
            p = doc.to_dict()
            r = modelo(COINCIDENCIA, [{"role": "user", "content": f"Casa nueva: {json.dumps(casa, ensure_ascii=False)}\nProspecto: {ficha(p)}"}],
                       con_casas=False, esquema=ESQ_COINCIDENCIA)
            if r.get("le_queda") and r.get("mensaje"):
                r["mensaje"] = revisar({"respuesta": r["mensaje"]})["respuesta"]
                doc.reference.update({"aiMatch": {"casa": casa["titulo"], "razon": r.get("razon", ""), "mensaje": r["mensaje"],
                                                  "at": datetime.now(TZ).isoformat()}})
                log(f"  Le queda a {p.get('name')}: {r.get('razon', '')}")
        vistas.add(casa["id"])
        json.dump(sorted(vistas), open(archivo, "w"))


def trabajar(una_vez=False):
    db = conectar()
    log(f"Agente de Tania trabajando con {MODELO}.")
    ultimo = {"seg": 0, "casas": 0}
    while True:
        for nombre, tarea, cada in (("bandeja", tarea_bandeja, 0), ("seg", tarea_seguimientos, 1800), ("casas", tarea_casas_nuevas, 600)):
            if cada and time.time() - ultimo.get(nombre, 0) < cada and not una_vez:
                continue
            try:
                tarea(db)
                ultimo[nombre] = time.time()
            except Exception as e:
                log(f"Error en {nombre}: {e}")
        if una_vez:
            log("Revisión terminada.")
            return
        time.sleep(60)


if __name__ == "__main__":
    modo = sys.argv[1] if len(sys.argv) > 1 else "chat"
    if modo in ("borradores", "trabajar"):
        trabajar()
    elif modo == "revisar":
        trabajar(una_vez=True)
    elif modo == "diagnostico":  # muestra lo que contesta el modelo, sin procesar
        msg = " ".join(sys.argv[2:]) or "info"
        print(f"Modelo {MODELO} · mensaje: {msg}\n")
        print(json.dumps(modelo(REGLAS, [{"role": "user", "content": msg}], esquema=ESQ_RESPUESTA), ensure_ascii=False, indent=1))
    else:
        chat()
AGENTE_EOF

cat > pruebas.py <<'PRUEBAS_EOF'
#!/usr/bin/env python3
"""Examen del agente con mensajes como los que llegan por Facebook e Instagram.

Uso: python3 pruebas.py            -> corre todo y guarda resultados.txt
     python3 pruebas.py vago        -> solo los casos que contienen esa palabra en el nombre

Cada caso es una conversación (solo mensajes del cliente) y lo que se espera de la última respuesta.
"""
import re, sys, time
import agente

PAG = "tania-torres-asesora-inmobiliaria"

# (nombre, mensajes del cliente, tipos aceptados, qué revisar)
#   pagina: debe compartir la página   precio: no debe dar precios   saluda / no_saluda
#   tania: debe marcar pasar a Tania   sin_pregunta: no debe terminar en pregunta   vacio: respuesta vacía
CASOS = [
    ("vago info", ["info"], {"vago"}, {"pagina", "saluda", "sin_precios"}),
    ("vago informes", ["Informes"], {"vago"}, {"pagina", "saluda", "sin_precios"}),
    ("vago +info", ["+info"], {"vago"}, {"pagina", "saluda", "sin_precios"}),
    ("vago con faltas", ["imformacion porfa"], {"vago"}, {"pagina", "saluda", "sin_precios"}),
    ("vago precio", ["Precio?"], {"vago"}, {"pagina", "saluda", "sin_precios"}),
    ("vago cuanto", ["cuanto?"], {"vago"}, {"pagina", "saluda", "sin_precios"}),
    ("vago signo de pesos", ["$?"], {"vago"}, {"pagina", "saluda", "sin_precios"}),
    ("vago disponible", ["Sigue disponible?"], {"vago"}, {"saluda", "sin_precios"}),
    ("vago me interesa", ["Me interesa"], {"vago"}, {"pagina", "saluda", "sin_precios"}),
    ("vago ubicacion", ["Ubicación"], {"vago"}, {"saluda", "sin_precios"}),
    ("vago hola", ["Hola buenas tardes"], {"vago"}, {"saluda", "sin_precios"}),
    ("vago emoji", ["👍"], {"vago", "otro"}, {"saluda", "sin_precios"}),
    ("vago signo", ["?"], {"vago"}, {"saluda", "sin_precios"}),
    ("vago automatico fb", ["¿Me puedes dar más información?"], {"vago"}, {"pagina", "saluda", "sin_precios"}),
    ("vago automatico fb 2", ["Hola. ¿Sigue disponible?"], {"vago"}, {"saluda", "sin_precios"}),
    ("vago mayusculas", ["INFORMACION"], {"vago"}, {"pagina", "saluda", "sin_precios"}),
    ("seguimiento tonala", ["info", "la de Tonalá"], {"casa"}, {"pagina", "no_saluda"}),
    ("seguimiento tlajomulco", ["Precio", "la de tlajomulco de 3 recamaras"], {"casa"}, {"no_saluda"}),
    ("casa directa", ["Hola, cuánto cuesta el departamento de Tlaquepaque?"], {"casa"}, {"saluda", "pagina"}),
    ("busqueda presupuesto", ["busco casa en tlajomulco de menos de 2 millones con infonavit"], {"busqueda"}, {"pagina"}),
    ("busqueda sin opcion", ["tienen algo de 500 mil en zapopan?"], {"busqueda"}, set()),
    ("busqueda recamaras", ["Ocupo 3 recámaras, mi crédito es de 2 millones y medio"], {"busqueda", "dinero"}, set()),
    ("dinero enganche", ["De cuánto es el enganche?"], {"dinero", "vago"}, set()),
    ("dinero mensualidad", ["la de tonala cuanto quedaria de mensualidad?"], {"dinero"}, set()),
    ("dinero puntos", ["Cuántos puntos de Infonavit piden?"], {"dinero", "credito"}, set()),
    ("dinero apartado", ["Con cuánto se aparta la de Zapopan?"], {"dinero", "tania"}, {"tania"}),
    ("credito infonavit", ["Aceptan Infonavit?"], {"credito", "vago"}, set()),
    ("credito conyugal", ["se puede con credito conyugal infonavit y fovissste?"], {"credito", "dinero"}, set()),
    ("varias preguntas", ["Hola me interesa la de Tonalá, acepta infonavit y cuánto es el enganche?"], {"casa", "credito", "dinero"}, {"saluda"}),
    ("visita", ["Quiero ir a ver la de Tonalá el sábado"], {"visita"}, {"tania"}),
    ("contacto telefono", ["3312345678"], {"contacto"}, {"tania"}),
    ("contacto llamada", ["me puede marcar?"], {"contacto"}, {"tania"}),
    ("vender", ["Quiero vender mi casa en Tonalá, cuánto cobra?"], {"vender"}, {"tania"}),
    ("renta", ["Rentan casas? busco renta en zapopan"], {"renta", "busqueda"}, set()),
    ("fuera de zona", ["Tienen casas en Puerto Vallarta?"], {"fuera"}, set()),
    ("desconfianza", ["Esto es real o es fraude?"], {"desconfianza"}, set()),
    ("descuento", ["me la deja mas barata?"], {"tania", "dinero"}, {"tania"}),
    ("asesor", ["Soy asesor, compartes comisión?"], {"tania"}, {"tania"}),
    ("cierre gracias", ["info", "ok gracias"], {"cierre"}, {"no_saluda", "sin_pregunta"}),
    ("cierre lo pienso", ["la de tonala", "lo voy a pensar"], {"cierre"}, {"no_saluda", "sin_pregunta"}),
    ("multimedia vacio", [""], {"multimedia"}, set()),
    ("multimedia foto", ["https://scontent.xx.fbcdn.net/v/t39.jpg?stp=dst"], {"multimedia"}, set()),
    ("spam", ["Gana dinero desde casa, entra a este link bit.ly/xxx"], {"spam"}, {"tania"}),
    ("usted", ["Buenas tardes, ¿me podría dar información de la casa de Zapopan?"], {"casa"}, {"saluda"}),
]


def revisar_caso(r, checks, ultimo):
    fallas, txt = [], r.get("respuesta") or ""
    if "pagina" in checks and PAG not in txt:
        fallas.append("no compartió la página")
    if "sin_precios" in checks and re.search(r"\$\s?\d", txt):
        fallas.append("dio precios sin saber qué casa")
    saludo = re.match(r"\s*(hola|buen[oa]s)", txt, re.I)
    if "saluda" in checks and not saludo:
        fallas.append("no saludó")
    if "no_saluda" in checks and saludo:
        fallas.append("volvió a saludar")
    if "tania" in checks and not r.get("pasar_a_tania"):
        fallas.append("no lo pasó a Tania")
    if "sin_pregunta" in checks and txt.rstrip().endswith("?"):
        fallas.append("terminó con pregunta en una despedida")
    if re.search(r"por favor|mi equipo|gratis", txt, re.I):
        fallas.append("frase prohibida")
    if txt.count("?") > 2:
        fallas.append("hace demasiadas preguntas")
    if len(txt) > 600:
        fallas.append("muy largo")
    return fallas


def main():
    filtro = sys.argv[1] if len(sys.argv) > 1 else ""
    casos = [c for c in CASOS if filtro in c[0]]
    agente.casas()
    salida, ok = [], 0
    print(f"Modelo {agente.MODELO} · {len(casos)} casos\n")
    for nombre, msgs, tipos, checks in casos:
        hist = [{"role": "user", "content": m} for m in msgs]
        t0 = time.time()
        r = agente.pedir(hist, primero=len(msgs) == 1)
        fallas = revisar_caso(r, checks, msgs[-1])
        if r.get("tipo") not in tipos:
            fallas.insert(0, f"tipo {r.get('tipo')} (esperaba {'/'.join(sorted(tipos))})")
        ok += not fallas
        estado = "OK   " if not fallas else "FALLA"
        bloque = (f"[{estado}] {nombre}  ({time.time() - t0:.0f}s)\n"
                  f"  Cliente: {' | '.join(msgs) or '(vacío)'}\n"
                  f"  Tania [{r.get('tipo')}{', pasar a Tania' if r.get('pasar_a_tania') else ''}]: {r.get('respuesta')}\n"
                  + (f"  >> {'; '.join(fallas)}\n" if fallas else "")
                  + (f"  Nota: {r['motivo']}\n" if r.get("motivo") else ""))
        print(bloque, flush=True)
        salida.append(bloque)
    resumen = f"\nResultado: {ok} de {len(casos)} bien ({100 * ok // max(len(casos), 1)}%)"
    print(resumen)
    open("resultados.txt", "w").write(f"Modelo {agente.MODELO}\n\n" + "\n".join(salida) + resumen + "\n")
    print("Guardado en ~/agente-tania/resultados.txt")


if __name__ == "__main__":
    main()
PRUEBAS_EOF

echo "Instalando la conexión con Firebase..."
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q firebase-admin certifi

cat > probar.command <<'EOF'
#!/bin/bash
cd "$HOME/agente-tania" && OLLAMA_MODEL=$(cat modelo.txt) .venv/bin/python agente.py chat
EOF

cat > iniciar.command <<'EOF'
#!/bin/bash
# Deja el agente corriendo solo cada vez que la Mac esté prendida.
cd "$HOME/agente-tania"
if [ ! -f cuenta-servicio.json ]; then
  echo "Falta cuenta-servicio.json en $HOME/agente-tania (la clave de Firebase). Revisa el paso 2 de la guía."; exit 1
fi
PLIST="$HOME/Library/LaunchAgents/com.taniatorres.agente.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.taniatorres.agente</string>
  <key>ProgramArguments</key><array>
    <string>$HOME/agente-tania/.venv/bin/python</string><string>-u</string>
    <string>$HOME/agente-tania/agente.py</string><string>borradores</string></array>
  <key>EnvironmentVariables</key><dict><key>OLLAMA_MODEL</key><string>$(cat modelo.txt)</string></dict>
  <key>WorkingDirectory</key><string>$HOME/agente-tania</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/agente-tania/agente.log</string>
  <key>StandardErrorPath</key><string>$HOME/agente-tania/agente.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Listo. El agente ya está revisando los mensajes del panel. Bitácora: $HOME/agente-tania/agente.log"
EOF

cat > detener.command <<'EOF'
#!/bin/bash
launchctl unload "$HOME/Library/LaunchAgents/com.taniatorres.agente.plist" && echo "Agente detenido."
EOF
cat > revisar.command <<'EOF'
#!/bin/bash
# Una vuelta completa (mensajes, seguimientos y casas nuevas) para probar que todo jale.
cd "$HOME/agente-tania" && OLLAMA_MODEL=$(cat modelo.txt) .venv/bin/python agente.py revisar
EOF
cat > examen.command <<'EOF'
#!/bin/bash
# Examen con mensajes reales de Facebook. Guarda resultados.txt
cd "$HOME/agente-tania" && OLLAMA_MODEL=$(cat modelo.txt) .venv/bin/python pruebas.py "$@"
EOF
chmod +x probar.command iniciar.command detener.command revisar.command examen.command

echo
echo "== Instalado =="
echo "Ahora vamos a probarlo. Escribe como si fueras cliente; 'salir' para terminar."
echo
./probar.command
