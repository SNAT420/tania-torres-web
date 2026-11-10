# Agente de mensajes de Tania (Ollama en la Mac)

Lee los mensajes de Instagram y Facebook que ya llegan al panel (ManyChat → /api/manychat → Firestore `inbox`),
escribe una respuesta sugerida con los datos reales de las casas de la página y la deja en el panel.
Tú o Tania la revisan, la copian y la mandan. El agente no le contesta solo a nadie.

## 1. Preparar la Mac (una vez)

```bash
mkdir -p ~/agente-tania && cd ~/agente-tania
# copia aquí agente.py
ollama pull qwen2.5:7b          # 8 GB de RAM: qwen2.5:3b · 16 GB o más: qwen2.5:14b
python3 -m pip install firebase-admin
```

## 2. Probarlo como si fueras cliente (no toca nada)

```bash
python3 agente.py chat
```

Prueba cosas como: "hola, info de la casa de Tonalá", "tienen algo en Zapopan con Infonavit?",
"me hacen descuento?", "quiero vender mi casa". Revisa que no invente precios ni diga nombres de fraccionamientos.
Si usas otro modelo: `OLLAMA_MODEL=qwen2.5:14b python3 agente.py chat`

## 3. Conectarlo a la bandeja del panel

1. Firebase → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada.
   (Es la misma clave que está en Vercel como `FIREBASE_SERVICE_ACCOUNT`.)
2. Guarda el archivo en `~/agente-tania/cuenta-servicio.json`. No lo subas a GitHub ni lo mandes por chat: da acceso total a la base.
3. Aplica `panel-borradores.patch` al repo (muestra la respuesta sugerida y el botón "Copiar respuesta" en Mensajes):
   ```bash
   cd tania-torres-web && git apply ~/agente-tania/panel-borradores.patch && git commit -am "Panel: respuesta sugerida del agente" && git push
   ```
4. Arranca el agente:
   ```bash
   cd ~/agente-tania && python3 agente.py borradores
   ```
   Cada minuto revisa los mensajes nuevos. Si la Mac está apagada no pasa nada: los mensajes siguen llegando al panel, solo sin borrador.

## Qué guarda en cada mensaje (`inbox`)
`draft` (texto), `draftHandoff` (pasar a Tania), `draftReason`, `draftInterest`, `draftAppt` (cita sugerida), `draftFor`, `draftAt`.
Las citas no se crean solas: el agente las sugiere y tú las registras con el botón "Registrar".
