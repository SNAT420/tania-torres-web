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
