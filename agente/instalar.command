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


try:  # el Python de python.org en Mac no trae certificados; certifi viene con firebase-admin
    import certifi, ssl
    _SSL = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL = None

_cache = {"t": 0, "casas": []}


def casas():
    if time.time() - _cache["t"] < 600:
        return _cache["casas"]
    url = f"https://firestore.googleapis.com/v1/projects/{PROYECTO}/databases/(default)/documents/properties?pageSize=100"
    with urllib.request.urlopen(url, timeout=20, context=_SSL) as r:
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
            "id": d["name"].rsplit("/", 1)[-1],
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
VOZ = """Redactas mensajes para Tania Torres, asesora inmobiliaria en Guadalajara y zona metropolitana.
Una persona revisa tu texto antes de mandarlo. Escribe como Tania en primera persona: español de México, cercano, profesional, breve (2 a 4 renglones), como un mensaje de WhatsApp.

Cómo suena Tania:
- Habla ella misma ("te comparto", "con gusto te la enseño", "déjame revisarlo"). Nunca "mi equipo", "nuestro equipo" ni "tu solicitud".
- No uses "Por favor", ni "Estimado", ni listas numeradas. Si hay dos opciones, dilas en una frase.
- Haz solo una pregunta al final, la más útil para avanzar.
- Ejemplo: "Claro, tengo dos en Zapopan que aceptan Infonavit: un departamento de 2 recámaras desde $5,556,632 y una casa nueva de 3 recámaras desde $3,503,420. ¿Cuál te gustaría conocer?"
"""

DATOS = f"""
Reglas que no se rompen:
- Usa SOLO los datos de la lista de casas de abajo. Si no está en la lista, no lo afirmes: di que lo confirmas.
- Nunca inventes precios, medidas, créditos, disponibilidad ni fechas.
- Ubicación: solo di el municipio. Nunca nombres de fraccionamientos, colonias ni calles. La ubicación exacta se comparte al confirmar la visita.
- Los precios son "desde". No prometas montos de crédito ni aprobaciones.
- Sin emojis. No ofrezcas "consultas gratis".
- WhatsApp de Tania: {WHATSAPP}. Página: {PAGINA}.
"""

REGLAS = VOZ + """- Si toca pasarlo a Tania, la respuesta igual va natural: "Eso lo vemos directo; dime qué casa te interesa y lo revisamos." No digas que lo vas a pasar a alguien.
""" + DATOS + """
Antes de escribir, clasifica el último mensaje del cliente en uno de estos tipos y contesta según el tipo:
- "vago": solo "info", "información", "precio", "disponible?", "me interesa", "ubicación", un emoji o algo sin decir qué casa. NO mandes la lista de casas. Saluda, preséntate si es el primer mensaje y pregunta qué casa vio o en qué zona busca. Ejemplo: "Buenas tardes, gracias por escribirme. Soy Tania Torres, asesora inmobiliaria. Claro, con gusto te doy información. ¿Qué casa viste o en qué zona estás buscando?"
- "casa": pregunta por una casa que se puede identificar en la lista (por municipio, precio o tipo). Da precio desde, recámaras, baños y créditos que acepta, y ofrece fotos o visita. Si hay dos o más que podrían ser, menciónalas en una frase y pregunta cuál.
- "busqueda": dice qué busca (zona, presupuesto, recámaras o crédito). Recomienda solo las que cumplan; si ninguna cumple, dilo con honestidad y pregunta si le interesa algo parecido.
- "visita": quiere ver una casa. Pregunta qué casa (si no se sabe), qué día y horario, y cómo piensa comprar (Infonavit, Fovissste, bancario o contado).
- "credito": pregunta por créditos o trámites. Explica en una frase que Tania lo acompaña con el trámite y pregunta qué crédito tiene o si ya sabe cuánto le prestan.
- "vender": quiere vender o rentar su casa. Pregunta colonia y número de recámaras, y marca pasar_a_tania.
- "tania": descuento, negociar, apartar, papeles, escrituras, quejas o algo que no sepas. Contesta natural y marca pasar_a_tania.
- "otro": cualquier otra cosa. Contesta breve y lleva la plática a qué está buscando.

Saludos:
- Si es el primer mensaje de la persona, empieza con el saludo que se indica abajo y preséntate en una frase ("Soy Tania Torres, asesora inmobiliaria").
- Si no es el primero, no vuelvas a saludar ni a presentarte; ve directo a lo que preguntó.
- Solo ves los mensajes del cliente, no lo que Tania ya contestó. No repitas preguntas que el cliente ya respondió en sus mensajes.
- Si pide descuento, negociar, apartar, hablar de papeles, escrituras o algo que no sepas: marca pasar_a_tania.
- Si quiere vender o rentar su casa, pregunta colonia y número de recámaras, y marca pasar_a_tania.

Responde SOLO con este JSON:
{"respuesta": "texto para el cliente",
  "tipo": "vago" | "casa" | "busqueda" | "visita" | "credito" | "vender" | "tania" | "otro",
  "pasar_a_tania": true o false,
  "motivo": "por qué Tania debe tomarlo, o vacío",
  "interes": "Comprar" | "Vender" | "Rentar" | "Crédito" | "Otro",
  "cita": null o {"casa": "...", "fecha": "AAAA-MM-DD o vacío", "hora": "HH:MM o vacío"}}"""

SEGUIMIENTO = VOZ + DATOS + """
Tarea: escribe UN mensaje de seguimiento para un prospecto que no ha vuelto a escribir.
- Salúdalo por su primer nombre y retoma lo que buscaba (usa sus notas). No repitas un mensaje genérico.
- Si en la lista hay una casa que le queda mejor por municipio, precio o crédito, menciónala con su precio "desde".
- Propón un paso concreto y fácil: conocerla esta semana o mandarle fotos.
- No lo presiones ni le reclames que no ha contestado.
Responde SOLO con este JSON: {"mensaje": "texto"}"""

COINCIDENCIA = VOZ + DATOS + """
Tarea: llegó una casa nueva. Decide si le queda a este prospecto según lo que buscaba (municipio, presupuesto, recámaras, crédito, operación).
Si no hay datos suficientes para pensar que le interesa, di que no. Es mejor no molestar a alguien que mandarle algo que no busca.
Si sí le queda, escribe un mensaje corto avisándole de la casa con su precio "desde" y ofreciéndole fotos o una visita.
Responde SOLO con este JSON: {"le_queda": true o false, "razon": "en pocas palabras", "mensaje": "texto o vacío"}"""


def modelo(sistema, mensajes, con_casas=True):
    """Manda la conversación a Ollama y regresa el JSON que contesta."""
    hoy = datetime.now(TZ).strftime("%d/%m/%Y %H:%M")
    sistema += f"\n\nHoy es {hoy}."
    if con_casas:
        sistema += "\n\nCasas disponibles:\n" + json.dumps(casas(), ensure_ascii=False, indent=1)
    cuerpo = {"model": MODELO, "stream": False, "options": {"temperature": 0.3},
              "messages": [{"role": "system", "content": sistema}] + mensajes}
    if MODELO.startswith("gpt-oss"):
        cuerpo["think"] = "low"   # piensa poco: responde más rápido
    else:
        cuerpo["format"] = "json"
        if MODELO.startswith("qwen3"):
            cuerpo["think"] = False   # sin modo "pensar": más rápido y gasta menos
    req = urllib.request.Request(OLLAMA, json.dumps(cuerpo).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        texto = json.load(r)["message"]["content"]
    try:
        return json.loads(texto[texto.index("{"):texto.rindex("}") + 1])
    except ValueError:
        return {"_crudo": texto}


def saludo():
    h = datetime.now(TZ).hour
    return "Buenos días" if 5 <= h < 12 else "Buenas tardes" if 12 <= h < 19 else "Buenas noches"


def pedir(historial, primero=False):
    contexto = (f"\n\nEs el PRIMER mensaje de esta persona. Saludo que corresponde ahora: \"{saludo()}\"." if primero
                else "\n\nNo es el primer mensaje de esta persona: no la saludes de nuevo.")
    out = modelo(REGLAS + contexto, historial)
    if "_crudo" in out:
        out = {"respuesta": out["_crudo"], "pasar_a_tania": True, "motivo": "El modelo no respondió en el formato esperado"}
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
        r = modelo(SEGUIMIENTO, [{"role": "user", "content": f"Prospecto: {ficha(p)}\nDías sin contacto: {dias_desde(p.get('lastContact'))}"}])
        if r.get("mensaje"):
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
                       con_casas=False)
            if r.get("le_queda") and r.get("mensaje"):
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
    else:
        chat()
AGENTE_EOF

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
chmod +x probar.command iniciar.command detener.command revisar.command

echo
echo "== Instalado =="
echo "Ahora vamos a probarlo. Escribe como si fueras cliente; 'salir' para terminar."
echo
./probar.command
