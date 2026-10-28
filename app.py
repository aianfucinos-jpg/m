"""
Miauguau — Backend Flask basado en el esquema de base de datos del proyecto
(esquema original en miauguau.sql, traducido a SQLite para que la app funcione
sin necesidad de instalar un servidor MySQL).

============================================================================
  ESQUEMA DE LA BASE DE DATOS  (fiel a miauguau.sql)
============================================================================
  6 tablas, exactamente las del proyecto:

    USUARIOS            (id, correo, nombre, creado_en, actualizado_en)
    MASCOTAS            (id, nombre, especie, sexo, edad, tamaño,
                         descripcion, direccion_imagen, estado,
                         es_urgente, esta_esterilizado, esta_vacunado,
                         creado_por_id, creado_en, actualizado_en)
    SOLICITUDES_ADOPCION (id, mascota_id, usuario_id, nombre, correo,
                         mensaje, estado, creado_en, actualizado_en)
    MENSAJES_CONTACTO   (id, nombre, correo, mensaje, asunto, usuario_id,
                         estado, respuesta_admin, creado_en, actualizado_en)
    SUSCRIPTORES_DIARIO (id, correo, usuario_id, estado, creado_en)
    FAVORITOS           (id, usuario_id, mascota_id, creado_en)

  No se crean tablas adicionales.  El contenido editorial que no vive en la
  BD (estadísticas, pasos, testimonios, blog, temas, timeline, galería, FAQ,
  info de contacto, redes, base de conocimientos del chatbot) se define como
  constantes Python en este archivo y se sirve desde el backend — nunca
  hardcodeado en el frontend.

============================================================================
  QUÉ SALE DE LA BD Y QUÉ SALE DEL BACKEND
============================================================================
  BD (dinámico / generado por usuarios):
    • Mascotas que se muestran en /adopciones        → MASCOTAS
    • Mensajes del formulario de contacto            → MENSAJES_CONTACTO
    • Suscripciones al newsletter                    → SUSCRIPTORES_DIARIO
    • Solicitudes de adopción (con mascota_id)       → SOLICITUDES_ADOPCION

  Backend (constantes Python, no en la BD pero sí en el servidor):
    • Estadísticas, pasos, testimonios, blog, historia destacada
    • Temas de concientización, timeline, galería, FAQ
    • Info de contacto, redes sociales, configuración global
    • Base de conocimientos del chatbot (servida vía /api/chatbot)
"""

import json
import sqlite3
import os
import csv
import io
import uuid
from datetime import datetime
from flask import Flask, render_template, request, jsonify, abort, Response, url_for

app = Flask(__name__)


# Filtro Jinja: si la ruta empieza con http(s) la usa tal cual (imagen
# externa tipo Imgur); si no, la resuelve como archivo estático local.
@app.template_filter('img_src')
def img_src_filter(path):
    if not path:
        return ''
    if isinstance(path, str) and path.startswith(('http://', 'https://')):
        return path
    return url_for('static', filename=path)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(BASE_DIR, "miauguau.db")


# ============================================================================
#  CONEXIÓN
# ============================================================================
def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


# ============================================================================
#  CREACIÓN DE TABLAS  (traducción fiel de miauguau.sql a SQLite)
# ============================================================================
def crear_tablas():
    conn = get_db_connection()
    cur = conn.cursor()

    # --- USUARIOS -------------------------------------------------------
    cur.execute("""
    CREATE TABLE IF NOT EXISTS USUARIOS (
        id             TEXT PRIMARY KEY,
        correo         TEXT NOT NULL UNIQUE,
        nombre         TEXT,
        creado_en      DATETIME DEFAULT CURRENT_TIMESTAMP,
        actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # --- MASCOTAS -------------------------------------------------------
    cur.execute("""
    CREATE TABLE IF NOT EXISTS MASCOTAS (
        id                TEXT PRIMARY KEY,
        nombre            TEXT NOT NULL,
        especie           TEXT CHECK(especie IN ('perro','gato','otro')) NOT NULL,
        sexo              TEXT CHECK(sexo IN ('macho','hembra')) NOT NULL,
        edad              INTEGER NOT NULL,
        "tamaño"          TEXT CHECK("tamaño" IN ('pequeño','mediano','grande')) NOT NULL,
        descripcion       TEXT NOT NULL,
        direccion_imagen  TEXT NOT NULL,
        estado            TEXT CHECK(estado IN ('disponible','reservado','adoptado'))
                          NOT NULL DEFAULT 'disponible',
        es_urgente        INTEGER NOT NULL DEFAULT 0,
        esta_esterilizado INTEGER NOT NULL DEFAULT 0,
        esta_vacunado     INTEGER NOT NULL DEFAULT 0,
        creado_por_id     TEXT NOT NULL,
        creado_en         DATETIME DEFAULT CURRENT_TIMESTAMP,
        actualizado_en    DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (creado_por_id) REFERENCES USUARIOS(id) ON DELETE RESTRICT
    );
    """)

    # --- SOLICITUDES_ADOPCION ------------------------------------------
    cur.execute("""
    CREATE TABLE IF NOT EXISTS SOLICITUDES_ADOPCION (
        id             TEXT PRIMARY KEY,
        mascota_id     TEXT NOT NULL,
        usuario_id     TEXT,
        nombre         TEXT NOT NULL,
        correo         TEXT NOT NULL,
        mensaje        TEXT NOT NULL,
        estado         TEXT CHECK(estado IN ('pendiente','aprovada','denegada'))
                       NOT NULL DEFAULT 'pendiente',
        creado_en      DATETIME DEFAULT CURRENT_TIMESTAMP,
        actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (mascota_id) REFERENCES MASCOTAS(id) ON DELETE CASCADE,
        FOREIGN KEY (usuario_id) REFERENCES USUARIOS(id) ON DELETE SET NULL
    );
    """)

    # --- MENSAJES_CONTACTO ---------------------------------------------
    cur.execute("""
    CREATE TABLE IF NOT EXISTS MENSAJES_CONTACTO (
        id              TEXT PRIMARY KEY,
        nombre          TEXT NOT NULL,
        correo          TEXT NOT NULL,
        mensaje         TEXT NOT NULL,
        asunto          TEXT CHECK(asunto IN ('general','adopcion','voluntariado',
                                              'maltrato','emergencia')) NOT NULL,
        usuario_id      TEXT,
        estado          TEXT CHECK(estado IN ('nuevo','leído','contestado'))
                        NOT NULL DEFAULT 'nuevo',
        respuesta_admin TEXT,
        creado_en       DATETIME DEFAULT CURRENT_TIMESTAMP,
        actualizado_en  DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES USUARIOS(id) ON DELETE SET NULL
    );
    """)

    # --- SUSCRIPTORES_DIARIO -------------------------------------------
    cur.execute("""
    CREATE TABLE IF NOT EXISTS SUSCRIPTORES_DIARIO (
        id         TEXT PRIMARY KEY,
        correo     TEXT NOT NULL UNIQUE,
        usuario_id TEXT,
        estado     TEXT CHECK(estado IN ('subscribed','unsubscribed'))
                   NOT NULL DEFAULT 'subscribed',
        creado_en  DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES USUARIOS(id) ON DELETE SET NULL
    );
    """)

    # --- FAVORITOS ------------------------------------------------------
    cur.execute("""
    CREATE TABLE IF NOT EXISTS FAVORITOS (
        id         TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        mascota_id TEXT NOT NULL,
        creado_en  DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (usuario_id, mascota_id),
        FOREIGN KEY (usuario_id) REFERENCES USUARIOS(id) ON DELETE CASCADE,
        FOREIGN KEY (mascota_id) REFERENCES MASCOTAS(id) ON DELETE CASCADE
    );
    """)

    # --- Triggers para actualizado_en (equivale a ON UPDATE CURRENT_TIMESTAMP)
    for tabla in ("USUARIOS", "MASCOTAS", "SOLICITUDES_ADOPCION", "MENSAJES_CONTACTO"):
        cur.execute("""
        CREATE TRIGGER IF NOT EXISTS trg_{t}_updated
        AFTER UPDATE ON {t}
        BEGIN
            UPDATE {t} SET actualizado_en = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;
        """.format(t=tabla))

    conn.commit()
    conn.close()


# ============================================================================
#  DATOS SEMILLA  (solo USUARIOS y MASCOTAS — el resto es contenido editorial)
# ============================================================================
def sembrar_datos():
    conn = get_db_connection()
    cur = conn.cursor()

    # Usuario administrador del refugio (necesario como FK de MASCOTAS.creado_por_id)
    cur.execute("INSERT OR IGNORE INTO USUARIOS (id, correo, nombre) VALUES (?, ?, ?)",
                ("USR-01", "miauguau@miauguau.org", "Refugio Miauguau"))

    # 6 mascotas — los mismos datos que muestra el sitio hoy.
    # creado_en: Luna y Mía son "nuevas" (hoy); las demás hace 60 días.
    from datetime import timedelta
    ahora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    hace_60 = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d %H:%M:%S")

    # Cada tupla: (id, nombre, especie, sexo, edad, tamaño, descripcion,
    #              direccion_imagen, estado, es_urgente, esta_esterilizado,
    #              esta_vacunado, creado_por_id, creado_en)
    mascotas = [
        ("PET-001", "Luna", "perro", "hembra", 2, "mediano",
         "Luna es una perrita dulce y juguetona que llegó a nuestro refugio "
         "después de ser encontrada en la calle. Le encanta jugar con pelotas "
         "y es muy cariñosa con los niños. Está lista para encontrar una "
         "familia que la llene de amor.",
         "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/luna.png", "disponible", 0, 1, 1, "USR-01", ahora),
        ("PET-002", "Max", "perro", "macho", 4, "grande",
         "Max es un perro leal y protector que necesita un hogar con urgencia. "
         "Fue rescatado de una situación de abandono y se ha recuperado "
         "maravillosamente. Es ideal para familias con espacio al aire libre.",
         "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/max.png", "disponible", 1, 1, 1, "USR-01", hace_60),
        ("PET-003", "Mía", "gato", "hembra", 1, "pequeño",
         "Mía es una gatita curiosa y traviesa que siempre está explorando. "
         "Le encanta subirse a los muebles y jugar con hilos. Es perfecta "
         "para departamentos y se lleva bien con otras mascotas.",
         "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/mia.png", "disponible", 0, 1, 1, "USR-01", ahora),
        ("PET-004", "Thor", "perro", "macho", 3, "grande",
         "Thor es un perro enérgico y adiestrado que disfruta los paseos "
         "largos y el ejercicio. Es muy sociable con otros perros y le "
         "encanta correr en el parque. Ideal para personas activas.",
         "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/thor.png", "disponible", 0, 0, 1, "USR-01", hace_60),
        ("PET-005", "Kira", "gato", "hembra", 2, "mediano",
         "Kira es una gata cariñosa y tranquila que ama los mimos y el calor "
         "del hogar. Fue rescatada en condiciones delicadas y ahora busca una "
         "familia que le dé la estabilidad que necesita con urgencia.",
         "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/kira.png", "disponible", 1, 1, 1, "USR-01", hace_60),
        ("PET-006", "Rocky", "perro", "macho", 5, "mediano",
         "Rocky es un perro adulto tranquilo y dócil. No necesita mucho "
         "ejercicio, solo amor y un lugar cómodo para descansar. Es ideal "
         "para personas mayores o familias que buscan un compañero sereno.",
         "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/rocky.png", "disponible", 0, 0, 1, "USR-01", hace_60),
    ]

    cur.executemany("""
        INSERT OR IGNORE INTO MASCOTAS
            (id, nombre, especie, sexo, edad, "tamaño", descripcion,
             direccion_imagen, estado, es_urgente, esta_esterilizado,
             esta_vacunado, creado_por_id, creado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, mascotas)

    conn.commit()
    conn.close()


# ============================================================================
#  CONTENIDO EDITORIAL  (constantes Python — no en la BD, sí en el backend)
# ============================================================================
# Estos datos no tienen tablas en miauguau.sql, así que se administran acá
# (en el backend) y se pasan a las plantillas.  No están hardcodeados en el
# HTML ni en el JS del frontend.

ESTADISTICAS = [
    {"numero": 500, "sufijo": "+", "etiqueta": "Mascotas rescatadas"},
    {"numero": 200, "sufijo": "+", "etiqueta": "Familias felices"},
    {"numero": 50,  "sufijo": "+", "etiqueta": "Voluntarios activos"},
    {"numero": 98,  "sufijo": "%", "etiqueta": "Tasa de adopción"},
]

PASOS_ADOPCION = [
    {"numero": "01", "titulo": "Explorá",
     "texto": "Navegá nuestras mascotas disponibles y encontrá a tu compañero "
              "ideal. Filtrá por tamaño, edad y carácter.",
     "icono": "search", "color_icono": "primary"},
    {"numero": "02", "titulo": "Conocete",
     "texto": "Completá el formulario de contacto y te guiaremos en cada paso. "
              "Conversemos sin compromiso.",
     "icono": "forum", "color_icono": "secondary"},
    {"numero": "03", "titulo": "Adoptá",
     "texto": "Dale un hogar amoroso y comenzá una nueva vida juntos. Te "
              "acompañamos durante la adaptación.",
     "icono": "favorite", "color_icono": "tertiary"},
]

TESTIMONIOS = [
    {"nombre": "María García", "rol": "Adoptó a Luna",
     "texto": "Adoptar a Luna fue la mejor decisión. El equipo de Miauguau nos "
              "acompañó en todo el proceso y hoy tenemos una familia completa.",
     "avatar_num": 1, "estrellas": 5},
    {"nombre": "Carlos Rodríguez", "rol": "Adoptó a Max",
     "texto": "Max llegó a nuestra vida cuando más lo necesitábamos. Gracias a "
              "Miauguau, encontramos al compañero perfecto para nuestros hijos.",
     "avatar_num": 2, "estrellas": 5},
    {"nombre": "Ana Martínez", "rol": "Voluntaria",
     "texto": "Como voluntaria, he visto de primera mano el increíble trabajo "
              "que hacen. Cada mascota recibe el cuidado y amor que merece.",
     "avatar_num": 3, "estrellas": 5},
]

BLOG_POSTS = [
    {"titulo": "Los primeros 30 días: guía para adaptar a tu mascota",
     "extracto": "Consejos prácticos para que la transición del refugio a tu "
                 "hogar sea suave y amorosa.",
     "categoria": "Adopción", "imagen": "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/luna.png", "tiempo_lectura": "5 min de lectura"},
    {"titulo": "Vacunas y esterilización: todo lo que necesitás saber",
     "extracto": "Por qué son esenciales, cuándo aplicarlas y cómo cuidar a tu "
                 "mascota después.",
     "categoria": "Salud", "imagen": "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/kira.png", "tiempo_lectura": "7 min de lectura"},
    {"titulo": "Cómo ser voluntario: 10 formas de ayudar desde casa",
     "extracto": "No necesitás ir al refugio para marcar la diferencia. "
                 "Descubrí cómo aportar.",
     "categoria": "Voluntariado", "imagen": "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/featured-story.png", "tiempo_lectura": "4 min de lectura"},
]

HISTORIA_DESTACADA = {
    "cita": "Llegó a nuestra casa tímida y asustada. Hoy, seis meses después, "
            "es la reina del hogar. No imaginamos la vida sin Luna.",
    "nombre": "María García", "rol": "Adoptó a Luna · Marzo 2024",
    "imagen": "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/featured-story.png",
}

TEMAS_CONCIENCIACION = [
    {"titulo": "Abandono callejero",
     "texto": "Miles de animales son abandonados cada año en las calles, "
              "expuestos al hambre, enfermedades y peligros. Es fundamental "
              "denunciar y educar para prevenir esta situación.",
     "icono": "pets", "color_icono": "primary"},
    {"titulo": "Esterilización",
     "texto": "La esterilización es clave para controlar la sobrepoblación "
              "animal y reducir el número de mascotas en situación de calle. "
              "Es un acto de responsabilidad y amor.",
     "icono": "vaccines", "color_icono": "secondary"},
    {"titulo": "Adopción responsable",
     "texto": "Adoptar es un compromiso de por vida. Implica brindar alimento, "
              "salud, amor y un hogar seguro. No adoptes por impulso, adoptá "
              "con responsabilidad.",
     "icono": "favorite", "color_icono": "tertiary"},
    {"titulo": "Maltrato animal",
     "texto": "El maltrato animal es un delito. Si conocés o presencias algún "
              "caso, no guardes silencio. Denunciá y contribuí a crear una "
              "cultura de respeto hacia los animales.",
     "icono": "shield", "color_icono": "primary"},
    {"titulo": "Educación",
     "texto": "La educación es la herramienta más poderosa para el cambio. "
              "Enseñar a las nuevas generaciones sobre el respeto y cuidado "
              "animal garantiza un futuro mejor.",
     "icono": "school", "color_icono": "secondary"},
    {"titulo": "Voluntariado",
     "texto": "Ser voluntario marca la diferencia en la vida de cientos de "
              "animales. Tu tiempo y dedicación son valiosos para el rescate, "
              "rehabilitación y socialización de mascotas.",
     "icono": "volunteer_activism", "color_icono": "tertiary"},
]

TIMELINE = [
    {"titulo": "Rescate",
     "texto": "Nuestro equipo rescata a animales en situación de calle, "
              "brindándoles seguridad y esperanza desde el primer momento."},
    {"titulo": "Rehabilitación",
     "texto": "Brindamos atención veterinaria y cuidado integral para que "
              "cada mascota se recupere física y emocionalmente."},
    {"titulo": "Adopción",
     "texto": "Encontramos hogares amorosos para cada mascota, asegurando una "
              "compatibilidad real entre la familia y el animal."},
    {"titulo": "Seguimiento",
     "texto": "Acompañamos a las familias en el proceso de adaptación, "
              "resolviendo dudas y asegurando el bienestar del animal."},
]

GALERIA = [
    {"imagen": "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/luna.png", "alt": "Luna, perra rescatada, jugando en el parque",
     "caption": "Luna · 2 años", "clase": "gallery-item--tall"},
    {"imagen": "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/mia.png", "alt": "Mía, gata rescatada, descansando",
     "caption": "Mía · 1 año", "clase": ""},
    {"imagen": "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/hero-pets.png", "alt": "Perro y gato rescatados juntos",
     "caption": "Compañeros de refugio", "clase": "gallery-item--wide"},
    {"imagen": "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/max.png", "alt": "Max, perro rescatado, feliz en su nuevo hogar",
     "caption": "Max · adoptado", "clase": ""},
    {"imagen": "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/kira.png", "alt": "Kira, gata rescatada, mirando a la cámara",
     "caption": "Kira · urgente", "clase": ""},
]

FAQS = [
    {"pregunta": "¿Cuánto cuesta adoptar una mascota?",
     "respuesta": "La adopción tiene un costo simbólico que cubre la vacunación, "
                  "esterilización y microchip de la mascota. Este monto varía "
                  "según el animal y está muy por debajo del costo real de "
                  "estos servicios."},
    {"pregunta": "¿Qué requisitos necesito para adoptar?",
     "respuesta": "Necesitás ser mayor de edad, contar con un espacio seguro "
                  "para la mascota, comprometerte con su cuidado integral y "
                  "completar nuestro formulario de adopción. Realizamos una "
                  "visita previa al hogar."},
    {"pregunta": "¿Puedo devolver una mascota si no me adapto?",
     "respuesta": "Sí, contamos con un período de adaptación de 15 días. Si "
                  "por alguna razón no podés quedarte con la mascota, la "
                  "recibimos de vuelta sin problema. Lo más importante es el "
                  "bienestar del animal."},
    {"pregunta": "¿Cómo puedo ser voluntario?",
     "respuesta": "Podés registrarte como voluntario a través de nuestra "
                  "página de contacto. Necesitamos ayuda con paseos, "
                  "alimentación, limpieza, eventos de adopción y difusión en "
                  "redes sociales."},
    {"pregunta": "¿Las mascotas están vacunadas y esterilizadas?",
     "respuesta": "Sí, todas nuestras mascotas son entregadas con su esquema "
                  "de vacunación completo, desparasitadas, esterilizadas y con "
                  "microchip. Además, cuentan con un chequeo veterinario "
                  "completo."},
]

INFO_CONTACTO = [
    {"icono": "mail", "etiqueta": "Escribinos", "valor": "Miaumail12@gmail.com",
     "valor_html": "", "color_icono": "primary", "tipo": "valor"},
    {"icono": "schedule", "etiqueta": "Horarios", "valor": "",
     "valor_html": "Lun-Vie: 9:00-18:00<br>Sáb: 10:00-14:00",
     "color_icono": "tertiary", "tipo": "valor"},
    {"icono": "share", "etiqueta": "Seguinos", "valor": "", "valor_html": "",
     "color_icono": "primary", "tipo": "social"},
]

REDES_SOCIALES = [
    {"nombre": "Instagram", "icono": "photo_camera", "enlace": "#", "aria_label": "Instagram"},
    {"nombre": "Email",     "icono": "mail",         "enlace": "mailto:Miaumail12@gmail.com", "aria_label": "Email"},
    {"nombre": "Facebook",  "icono": "groups",       "enlace": "#", "aria_label": "Facebook"},
]

CONFIG = {
    "email":              "Miaumail12@gmail.com",
    "horario_corto":      "Lun-Vie 9-18h",
    "horario_largo":      "Lun-Vie: 9:00-18:00<br>Sáb: 10:00-14:00",
    "telefono_emergencia": "0800-ANIMALES",
    "social_proof_text":  "+200 familias ya encontraron a su compañero",
    "copyright_text":     "© 2026 Miauguau. Todos los derechos reservados.",
}


# ============================================================================
#  BASE DE CONOCIMIENTOS DEL CHATBOT  (constante Python, servida vía API)
#  No hay tabla en miauguau.sql para esto, así que vive en el backend.
# ============================================================================
CHATBOT_KNOWLEDGE = [
    {"id": "adopcion", "label": "Adoptar", "icon": "pets",
     "keywords": ["adoptar","adopcion","adopción","quiero adoptar","como adopto",
                  "proceso de adopcion","proceso","pasos para adoptar","trámites"],
     "weight": 2,
     "response": "¡Qué lindo que quieras adoptar! 🐾 El proceso es simple:\n\n"
                 "**1.** Completá el formulario de adopción\n"
                 "**2.** Entrevista corta con nuestro equipo\n"
                 "**3.** Visita al refugio para conocer a tu futura mascota\n"
                 "**4.** ¡Firma del acta y llevala a casa!\n\n"
                 "¿Querés que te detalle algún paso?",
     "actions": [{"label":"Ver mascotas","icon":"pets","nav":"adoptar"},
                 {"label":"Requisitos","icon":"checklist","intent":"requisitos"},
                 {"label":"Costo","icon":"payments","intent":"costo"}],
     "followups": ["requisitos","costo","perros","gatos","horarios"],
     "emergency": False},
    {"id": "requisitos", "label": "Requisitos", "icon": "checklist",
     "keywords": ["requisito","requisitos","necesito para adoptar","que necesito",
                  "condiciones","qué piden","que piden","documentacion"], "weight": 2,
     "response": "Los requisitos para adoptar son:\n\n• Ser mayor de 18 años (con DNI)\n"
                 "• Tener un espacio seguro para la mascota\n"
                 "• Comprometerse con su cuidado integral\n"
                 "• Completar el formulario de adopción\n"
                 "• Visita previa al hogar\n\n"
                 "¡No es complicado! Lo que más nos importa es el bienestar del animal. 🐶",
     "actions": [{"label":"Proceso completo","icon":"route","intent":"adopcion"},
                 {"label":"Ver mascotas","icon":"pets","nav":"adoptar"}],
     "followups": ["adopcion","costo","perros","gatos"], "emergency": False},
    {"id": "costo", "label": "Costo", "icon": "payments",
     "keywords": ["costo","precio","cuanto cuesta","cuánto cuesta","valor","tarifa",
                  "se paga","es gratis","gratis","abonar","cuanto vale"], "weight": 2,
     "response": "La adopción tiene un **costo simbólico** que cubre:\n\n"
                 "• Vacunación completa\n• Esterilización/Castración\n"
                 "• Microchip identificatorio\n• Desparasitación\n\n"
                 "Está muy por debajo del costo real de esos servicios. ¡Es una "
                 "inversión en la salud de tu nuevo amigo! 💚",
     "actions": [{"label":"Qué incluye","icon":"medical_services","intent":"vacunas"},
                 {"label":"Ver mascotas","icon":"pets","nav":"adoptar"}],
     "followups": ["requisitos","vacunas","adopcion","perros"], "emergency": False},
    {"id": "horarios", "label": "Horarios", "icon": "schedule",
     "keywords": ["horario","horarios","cuando","qué hora","que hora","abren",
                  "cierran","visitar","visita","atencion","atención","abierto"], "weight": 2,
     "response": "Nuestros horarios de atención:\n\n"
                 "📅 **Lunes a Viernes:** 9:00 — 18:00\n"
                 "📅 **Sábados:** 10:00 — 14:00\n"
                 "📅 **Domingos:** Cerrado\n\n"
                 "¡Te esperamos! Si venís de lejos, escribinos antes para coordinar. 🕐",
     "actions": [{"label":"Contacto","icon":"mail","intent":"contacto"}],
     "followups": ["contacto","adopcion"], "emergency": False},
    {"id": "vacunas", "label": "Vacunas y salud", "icon": "medical_services",
     "keywords": ["vacunar","vacuna","castrar","castracion","castración","veterinario",
                  "vet","esterilizar","esterilizacion","chip","salud","enfermo",
                  "desparasitar","desparasitacion"], "weight": 2,
     "response": "Todos nuestros animales vienen con su salud al día:\n\n"
                 "💉 Vacunación completa\n✂️ Castrados/Esterilizados\n"
                 "💊 Desparasitados\n🔖 Con chip identificatorio\n\n"
                 "Si necesitás un veterinario de confianza, consultanos que te "
                 "recomendamos algunos. 🩺",
     "actions": [{"label":"Cuidados básicos","icon":"volunteer_activism","intent":"cuidados"},
                 {"label":"Costo de adopción","icon":"payments","intent":"costo"}],
     "followups": ["cuidados","costo","adopcion"], "emergency": False},
    {"id": "cuidados", "label": "Cuidados", "icon": "volunteer_activism",
     "keywords": ["cuidado","cuidados","alimentar","alimentacion","comida","alimento",
                  "bañar","pasear","bañar perro","paseo","ejercicio","jugar","educar",
                  "adiestramiento"], "weight": 2,
     "response": "Consejos básicos de cuidado:\n\n🍖 Alimentación balanceada y agua "
                 "fresca siempre\n🩺 Visitas regulares al veterinario\n"
                 "🚶 Paseos diarios (para perros)\n🧸 Juego y estimulación mental\n"
                 "❤️ Amor y paciencia\n\n¿Tenés alguna pregunta específica sobre cuidados?",
     "actions": [{"label":"Vacunas","icon":"medical_services","intent":"vacunas"},
                 {"label":"Adoptar","icon":"pets","intent":"adopcion"}],
     "followups": ["vacunas","adopcion","perros","gatos"], "emergency": False},
    {"id": "perros", "label": "Perros", "icon": "pets",
     "keywords": ["perro","perrito","can","cachorro","puppy","perra",
                  "perros disponibles","quiero un perro"], "weight": 1.5,
     "response": "¡Tenemos perros increíbles esperando un hogar! 🐶\n\n"
                 "De todas las edades y tamaños: cachorros juguetones, jóvenes "
                 "enérgicos y adultos tranquilos. Cada uno con su propia "
                 "personalidad.\n\nMirá los disponibles en nuestra sección de adopciones:",
     "actions": [{"label":"Ver perros disponibles","icon":"pets","nav":"adoptar"},
                 {"label":"Requisitos","icon":"checklist","intent":"requisitos"}],
     "followups": ["gatos","requisitos","adopcion","cuidados"], "emergency": False},
    {"id": "gatos", "label": "Gatos", "icon": "pets",
     "keywords": ["gato","gatito","felino","minino","gata","gatos disponibles",
                  "quiero un gato","michi"], "weight": 1.5,
     "response": "¡Nuestros gatos son adorables! 🐱\n\nTenemos gatitos juguetones y "
                 "gatos adultos tranquilos. Todos listos para dar y recibir amor. "
                 "Los gatos son ideales para departamentos. 🏠",
     "actions": [{"label":"Ver gatos disponibles","icon":"pets","nav":"adoptar"},
                 {"label":"Requisitos","icon":"checklist","intent":"requisitos"}],
     "followups": ["perros","requisitos","adopcion","cuidados"], "emergency": False},
    {"id": "voluntariado", "label": "Voluntariado", "icon": "volunteer_activism",
     "keywords": ["voluntario","voluntariado","ayudar","colaborar como","ofrecer ayuda",
                  "trabajar","colaborar","sumar","sumarme"], "weight": 2,
     "response": "¡Siempre necesitamos voluntarios! 💪\n\nPodés colaborar de varias "
                 "formas:\n\n🐕 Pasear perros\n🎪 Ayudar en eventos\n📱 Social media\n"
                 "🚗 Transporte de animales\n🧹 Limpieza y cuidado\n\n"
                 "Escribinos a Miaumail12@gmail.com y te contamos más.",
     "actions": [{"label":"Contacto","icon":"mail","intent":"contacto"},
                 {"label":"Horarios","icon":"schedule","intent":"horarios"}],
     "followups": ["contacto","horarios"], "emergency": False},
    {"id": "contacto", "label": "Contacto", "icon": "mail",
     "keywords": ["contacto","contactar","telefono","teléfono","email","mail","whatsapp",
                  "llamar","escribir","como contacto","redes sociales"], "weight": 2,
     "response": "Podés contactarnos de varias formas:\n\n✉️ **Email:** "
                 "Miaumail12@gmail.com\n📸 **Instagram:** @miauguau\n"
                 "👥 **Facebook:** Miauguau Pet Rescue\n📍 O visitá nuestra página "
                 "de contacto\n\n¡Respondemos lo antes posible! 💌",
     "actions": [{"label":"Ir a contacto","icon":"mail","nav":"contacto"},
                 {"label":"Horarios","icon":"schedule","intent":"horarios"}],
     "followups": ["horarios","voluntariado"], "emergency": False},
    {"id": "emergencia", "label": "Emergencia", "icon": "emergency",
     "keywords": ["urgente","emergencia","animal herido","perro herido","gato herido",
                  "maltrato","abandono","denunciar","ayuda urgente","accidente",
                  "atropellado","sangrando"], "weight": 5,
     "response": "🚨 **EMERGENCIA ANIMAL** 🚨\n\nSi encontraste un animal herido o "
                 "en peligro:\n\n📞 **Línea de emergencia:** 0800-ANIMALES\n"
                 "✉️ **Email urgente:** Miaumail12@gmail.com\n"
                 "🚔 **Si hay maltrato:** denunciá al **911**\n\n"
                 "No dudes en actuar, cada minuto cuenta. Si podés, mantené al "
                 "animal seguro y abrigado hasta que llegue ayuda.",
     "actions": [{"label":"Llamar al refugio","icon":"call","href":"tel:08002646253"},
                 {"label":"Enviar email","icon":"mail","href":"mailto:Miaumail12@gmail.com"}],
     "followups": ["contacto","voluntariado"], "emergency": True},
    {"id": "maltrato", "label": "Maltrato animal", "icon": "gavel",
     "keywords": ["maltrato","abuso","golpearon","abusan","denunciar maltrato",
                  "crueldad animal","violencia animal"], "weight": 4,
     "response": "El maltrato animal es **delito** en Argentina (Ley 14.346). 🛡️\n\n"
                 "¿Cómo denunciar?\n\n1. **Tomá fotos/videos** como prueba\n"
                 "2. **Llamá al 911** o denuncia en la comisaría más cercana\n"
                 "3. **Avisanos** para acompañarte en el proceso\n\n"
                 "No mires para otro lado. Tu denuncia puede salvar una vida. 🐾",
     "actions": [{"label":"Emergencia","icon":"emergency","intent":"emergencia"},
                 {"label":"Contacto","icon":"mail","intent":"contacto"}],
     "followups": ["emergencia","contacto"], "emergency": False},
    {"id": "esterilizacion", "label": "Esterilización", "icon": "cut",
     "keywords": ["esterilizar","esterilizacion","castrar","castracion","castración",
                  "operar","cirugia","cirugía","para esterilizar"], "weight": 2,
     "response": "La esterilización es fundamental:\n\n✅ Reduce la sobrepoblación "
                 "animal\n✅ Previene enfermedades (cáncer, infecciones)\n"
                 "✅ Mejora el comportamiento\n✅ Aumenta la esperanza de vida\n\n"
                 "Todos nuestros animales adoptados vienen castrados. Si tenés una "
                 "mascota sin castrar, ¡consultanos sobre campañas gratuitas! 🏥",
     "actions": [{"label":"Vacunas","icon":"medical_services","intent":"vacunas"},
                 {"label":"Adoptar","icon":"pets","intent":"adopcion"}],
     "followups": ["vacunas","cuidados","adopcion"], "emergency": False},
    {"id": "historias", "label": "Historias de adopción", "icon": "auto_stories",
     "keywords": ["historia","historias","testimonio","testimonios","casos exitosos",
                  "experiencia","experiencias","fotos antes y despues"], "weight": 1.5,
     "response": "¡Tenemos hermosas historias de adopción! 📖\n\nCada mascota "
                 "adoptada tiene su viaje: desde el rescate hasta encontrar su hogar "
                 "definitivo. Son historias de transformación, amor y segundas "
                 "oportunidades.\n\nMirá las historias en nuestra sección de "
                 "concientización y el blog.",
     "actions": [{"label":"Ver historias","icon":"auto_stories","nav":"concientizar"},
                 {"label":"Conocer mascotas","icon":"pets","nav":"adoptar"}],
     "followups": ["adopcion","perros","gatos"], "emergency": False},
    {"id": "cachorros", "label": "Cachorros", "icon": "cruelty_free",
     "keywords": ["cachorro","cachorros","bebe","bebé","recien nacido","joven",
                  "jovenes","jóvenes","pequeño","pequeñito"], "weight": 1.5,
     "response": "¡Los cachorros son pura energía y ternura! 🍼\n\nTenemos cachorros "
                 "de perros y gatos. Necesitan atención especial:\n\n• Vacunación en "
                 "curso\n• Alimentación frecuente\n• Mucho juego y socialización\n"
                 "• Paciencia para educar\n\nMirá los disponibles en adopciones:",
     "actions": [{"label":"Ver cachorros","icon":"pets","nav":"adoptar"},
                 {"label":"Cuidados","icon":"volunteer_activism","intent":"cuidados"}],
     "followups": ["perros","gatos","cuidados","vacunas"], "emergency": False},
    {"id": "nombre", "label": "Cómo te llamás", "icon": "badge",
     "keywords": ["como te llamas","cómo te llamas","tu nombre","quien sos",
                  "quién sos","como te digo","que sos"], "weight": 3,
     "response": "Soy **Miau**, el asistente virtual de Miauguau 🐾\n\nEstoy acá "
                 "para ayudarte con todo lo que necesites sobre adopción, cuidado "
                 "animal, y cómo colaborar con el refugio. ¿En qué te puedo ayudar?",
     "actions": [{"label":"Adoptar","icon":"pets","intent":"adopcion"},
                 {"label":"Horarios","icon":"schedule","intent":"horarios"}],
     "followups": ["adopcion","horarios"], "emergency": False},
    {"id": "gracias", "label": "Agradecimientos", "icon": "favorite",
     "keywords": ["gracias","muchas gracias","genial","excelente","perfecto",
                  "increible","increíble","ok","dale","buenisimo","buenisimo",
                  "fantastico","genio"], "weight": 1,
     "response": "¡De nada! Me alegra poder ayudarte 💚\n\nSi tenés más preguntas, "
                 "no dudes en escribirme. Estoy acá para lo que necesites. ¡Que "
                 "tengas un lindo día! 🌟",
     "actions": [{"label":"Adoptar","icon":"pets","intent":"adopcion"},
                 {"label":"Voluntariado","icon":"volunteer_activism","intent":"voluntariado"}],
     "followups": ["adopcion","voluntariado"], "emergency": False},
    {"id": "saludo", "label": "Saludo", "icon": "waving_hand",
     "keywords": ["hola","buenas","buen dia","buenos dias","buenas tardes",
                  "buenas noches","hey","hi","que tal","como estas","cómo estás",
                  "holi","buenas"], "weight": 1,
     "response": "¡Hola! ¡Bienvenido a Miauguau! 🐾\n\nSoy **Miau**, el asistente "
                 "virtual del refugio. ¿En qué puedo ayudarte hoy?",
     "actions": [{"label":"Adoptar","icon":"pets","intent":"adopcion"},
                 {"label":"Horarios","icon":"schedule","intent":"horarios"}],
     "followups": ["adopcion","horarios","voluntariado"], "emergency": False},
    {"id": "despedida", "label": "Despedida", "icon": "waving_hand",
     "keywords": ["chau","adios","adiós","nos vemos","hasta luego","bye","me voy",
                  "listo","gracias chau","nos vemos luego"], "weight": 1,
     "response": "¡Hasta luego! Fue un placer ayudarte 🐾\n\nAcordate que siempre "
                 "podés volver si tenés más preguntas. ¡Esperamos verte pronto en "
                 "el refugio! 💚",
     "actions": [], "followups": [], "emergency": False},
]

CHATBOT_CATEGORIES = [
    {"id": "adopcion", "label": "Adoptar", "icon": "pets", "desc": "Proceso y mascotas"},
    {"id": "horarios", "label": "Horarios", "icon": "schedule", "desc": "Cuándo visitarnos"},
    {"id": "voluntariado", "label": "Voluntariado", "icon": "volunteer_activism", "desc": "Cómo colaborar"},
    {"id": "vacunas", "label": "Salud", "icon": "medical_services", "desc": "Vacunas y cuidados"},
    {"id": "emergencia", "label": "Emergencia", "icon": "emergency", "desc": "Animal en peligro"},
]

CHATBOT_DEFAULT = {
    "id": "default",
    "response": "Mmm, no estoy segura de entender eso 🤔\n\nProbá preguntarme "
                "sobre:\n• Adopción de mascotas\n• Requisitos\n• Costo de "
                "adopción\n• Horarios del refugio\n• Voluntariado\n• Vacunas y "
                "salud\n• Emergencias\n\nO escribi **/** para ver todos los temas.",
    "actions": [{"label": "Ver mascotas", "icon": "pets", "nav": "adoptar"},
                {"label": "Contacto", "icon": "mail", "intent": "contacto"}],
    "followups": ["adopcion", "horarios", "contacto"],
}


# ============================================================================
#  HELPERS
# ============================================================================
def _es_nueva(creado_en):
    """Devuelve True si la mascota fue creada en los últimos 30 días."""
    if not creado_en:
        return False
    try:
        # SQLite CURRENT_TIMESTAMP viene como 'YYYY-MM-DD HH:MM:SS' (UTC)
        dt = datetime.strptime(str(creado_en)[:19], "%Y-%m-%d %H:%M:%S")
        return (datetime.now() - dt).days <= 30
    except (ValueError, TypeError):
        return False


def obtener_mascotas(conn):
    """Lee todas las mascotas de la BD y devuelve una lista enriquecida con
    campos derivados (edad_categoria, es_nueva, tags) para usar en la vista."""
    rows = conn.execute(
        'SELECT *, "tamaño" AS tamano FROM MASCOTAS ORDER BY creado_en ASC'
    ).fetchall()
    resultado = []
    for r in rows:
        d = dict(r)
        # edad_categoria: <=2 años = "joven" (cachorro), >=3 = "adulto"
        d["edad_categoria"] = "joven" if d["edad"] <= 2 else "adulto"
        d["es_nueva"] = _es_nueva(d.get("creado_en"))
        d["es_urgente"] = bool(d["es_urgente"])
        d["esta_esterilizado"] = bool(d["esta_esterilizado"])
        d["esta_vacunado"] = bool(d["esta_vacunado"])

        # Tags derivados de los booleanos de la BD
        tags = []
        if d["es_nueva"]:
            tags.append({"etiqueta": "Nuevo", "tipo": "new"})
        if d["es_urgente"]:
            tags.append({"etiqueta": "Urgente", "tipo": "urgent"})
        if d["esta_vacunado"]:
            tags.append({"etiqueta": "Vacunado", "tipo": "normal"})
        if d["esta_esterilizado"]:
            etiqueta = "Esterilizada" if d["sexo"] == "hembra" else "Esterilizado"
            tags.append({"etiqueta": etiqueta, "tipo": "normal"})
        d["tags"] = tags
        resultado.append(d)
    return resultado


def obtener_mascota(conn, mascota_id):
    row = conn.execute(
        'SELECT *, "tamaño" AS tamano FROM MASCOTAS WHERE id = ?', (mascota_id,)
    ).fetchone()
    return dict(row) if row else None


def _nuevo_id(prefijo):
    return "{}-{}".format(prefijo, uuid.uuid4().hex[:12].upper())


# ============================================================================
#  CONTEXT PROCESSOR  (inyecta config y redes en todas las plantillas)
# ============================================================================
@app.context_processor
def inyectar_globales():
    return {"config": CONFIG, "redes": REDES_SOCIALES}


# ============================================================================
#  RUTAS DE PÁGINAS
# ============================================================================
@app.route("/")
def inicio():
    return render_template("inicio.html",
                           estadisticas=ESTADISTICAS,
                           pasos=PASOS_ADOPCION,
                           testimonios=TESTIMONIOS,
                           blog_posts=BLOG_POSTS,
                           historia_destacada=HISTORIA_DESTACADA)


@app.route("/concientizacion")
def concientizacion():
    return render_template("concientizacion.html",
                           estadisticas=ESTADISTICAS,
                           temas=TEMAS_CONCIENCIACION,
                           timeline=TIMELINE,
                           galeria=GALERIA,
                           faqs=FAQS)


@app.route("/adopciones")
def adopciones():
    conn = get_db_connection()
    mascotas = obtener_mascotas(conn)
    conn.close()
    return render_template("adopciones.html", mascotas=mascotas)


@app.route("/contacto")
def contacto():
    return render_template("contacto.html", info_contacto=INFO_CONTACTO)


# ============================================================================
#  APIs
# ============================================================================
@app.route("/api/mascotas")
def api_mascotas():
    conn = get_db_connection()
    mascotas = obtener_mascotas(conn)
    conn.close()
    return jsonify({"mascotas": mascotas})


@app.route("/api/mascotas/<mascota_id>")
def api_mascota_detalle(mascota_id):
    conn = get_db_connection()
    m = obtener_mascota(conn, mascota_id)
    if not m:
        conn.close()
        abort(404)
    # enriquecer como en obtener_mascotas
    m["edad_categoria"] = "joven" if m["edad"] <= 2 else "adulto"
    m["es_nueva"] = _es_nueva(m.get("creado_en"))
    m["es_urgente"] = bool(m["es_urgente"])
    m["esta_esterilizado"] = bool(m["esta_esterilizado"])
    m["esta_vacunado"] = bool(m["esta_vacunado"])
    tags = []
    if m["es_nueva"]: tags.append({"etiqueta": "Nuevo", "tipo": "new"})
    if m["es_urgente"]: tags.append({"etiqueta": "Urgente", "tipo": "urgent"})
    if m["esta_vacunado"]: tags.append({"etiqueta": "Vacunado", "tipo": "normal"})
    if m["esta_esterilizado"]:
        tags.append({"etiqueta": "Esterilizada" if m["sexo"] == "hembra" else "Esterilizado",
                     "tipo": "normal"})
    m["tags"] = tags
    conn.close()
    return jsonify(m)


@app.route("/api/contacto", methods=["POST"])
def api_contacto():
    """Recibe el formulario de contacto y lo guarda en MENSAJES_CONTACTO.
    Si viene mascota_id (desde el modal de adopción), también crea una
    SOLICITUDES_ADOPCION.

    Si el usuario está logueado (header X-Usuario-Id), se asocia el mensaje
    y la solicitud a ese usuario_id."""
    data = request.get_json(silent=True) or {}
    nombre = (data.get("nombre") or "").strip()
    correo = (data.get("correo") or "").strip()
    mensaje = (data.get("mensaje") or "").strip()
    asunto = (data.get("asunto") or "").strip()
    mascota_id = (data.get("mascota_id") or "").strip() or None

    if not nombre or not correo or not mensaje:
        return jsonify({"ok": False, "error": "Faltan campos obligatorios"}), 400
    if asunto not in ("general", "adopcion", "voluntariado", "maltrato", "emergencia"):
        return jsonify({"ok": False, "error": "Asunto inválido"}), 400

    conn = get_db_connection()
    try:
        usuario_id, _ = _usuario_actual(conn)

        msg_id = _nuevo_id("MSG")
        conn.execute("""
            INSERT INTO MENSAJES_CONTACTO (id, nombre, correo, mensaje, asunto, estado, usuario_id)
            VALUES (?, ?, ?, ?, ?, 'nuevo', ?)
        """, (msg_id, nombre, correo, mensaje, asunto, usuario_id))

        solicitud_id = None
        if mascota_id:
            # verificar que la mascota existe
            m = conn.execute("SELECT id FROM MASCOTAS WHERE id = ?", (mascota_id,)).fetchone()
            if m:
                solicitud_id = _nuevo_id("SOL")
                conn.execute("""
                    INSERT INTO SOLICITUDES_ADOPCION
                        (id, mascota_id, usuario_id, nombre, correo, mensaje, estado)
                    VALUES (?, ?, ?, ?, ?, ?, 'pendiente')
                """, (solicitud_id, mascota_id, usuario_id, nombre, correo, mensaje))

        conn.commit()
        return jsonify({"ok": True, "mensaje_id": msg_id,
                        "solicitud_id": solicitud_id})
    except Exception as e:
        conn.rollback()
        return jsonify({"ok": False, "error": str(e)}), 500
    finally:
        conn.close()


@app.route("/api/newsletter", methods=["POST"])
def api_newsletter():
    """Suscribe un correo a SUSCRIPTORES_DIARIO (UPSERT: si ya existe lo
    reactiva a 'subscribed').

    Si el usuario está logueado (header X-Usuario-Id), se asocia la
    suscripción a ese usuario_id."""
    data = request.get_json(silent=True) or {}
    correo = (data.get("correo") or "").strip().lower()
    if not correo or "@" not in correo:
        return jsonify({"ok": False, "error": "Email inválido"}), 400

    conn = get_db_connection()
    try:
        usuario_id, _ = _usuario_actual(conn)
        sub_id = _nuevo_id("SUB")
        conn.execute("""
            INSERT INTO SUSCRIPTORES_DIARIO (id, correo, usuario_id, estado)
            VALUES (?, ?, ?, 'subscribed')
            ON CONFLICT(correo) DO UPDATE SET estado='subscribed',
                                              usuario_id=excluded.usuario_id
        """, (sub_id, correo, usuario_id))
        conn.commit()
        return jsonify({"ok": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"ok": False, "error": str(e)}), 500
    finally:
        conn.close()


@app.route("/api/solicitudes", methods=["POST"])
def api_solicitudes():
    """Crea una solicitud de adopción directa (mascota_id obligatorio)."""
    data = request.get_json(silent=True) or {}
    mascota_id = (data.get("mascota_id") or "").strip()
    nombre = (data.get("nombre") or "").strip()
    correo = (data.get("correo") or "").strip()
    mensaje = (data.get("mensaje") or "").strip()
    if not mascota_id or not nombre or not correo or not mensaje:
        return jsonify({"ok": False, "error": "Faltan campos obligatorios"}), 400

    conn = get_db_connection()
    try:
        m = conn.execute("SELECT id FROM MASCOTAS WHERE id = ?", (mascota_id,)).fetchone()
        if not m:
            return jsonify({"ok": False, "error": "La mascota no existe"}), 404
        sol_id = _nuevo_id("SOL")
        conn.execute("""
            INSERT INTO SOLICITUDES_ADOPCION (id, mascota_id, nombre, correo, mensaje, estado)
            VALUES (?, ?, ?, ?, ?, 'pendiente')
        """, (sol_id, mascota_id, nombre, correo, mensaje))
        conn.commit()
        return jsonify({"ok": True, "solicitud_id": sol_id})
    except Exception as e:
        conn.rollback()
        return jsonify({"ok": False, "error": str(e)}), 500
    finally:
        conn.close()


# ID del usuario anónimo para favoritos (no hay login todavía).
# Se crea automáticamente al arrancar la app.
USUARIO_ANON_ID = "USR-ANON"


def _asegurar_usuario_anonimo(conn):
    """Crea el usuario anónimo si no existe (para los favoritos sin login)."""
    conn.execute("""
        INSERT OR IGNORE INTO USUARIOS (id, correo, nombre)
        VALUES (?, 'anonimo@miauguau.local', 'Visitante anónimo')
    """, (USUARIO_ANON_ID,))
    conn.commit()


@app.route("/api/favoritos", methods=["POST"])
def api_favoritos():
    """Agrega o quita un favorito del usuario (logueado o anónimo).

    Body JSON:
        { "mascota_id": "PET-001", "accion": "agregar" | "quitar" }

    Header opcional:
        X-Usuario-Id: USR-xxxxx  (si está logueado)

    Si no hay header, usa el usuario anónimo (USR-ANON).
    """
    data = request.get_json(silent=True) or {}
    mascota_id = (data.get("mascota_id") or "").strip()
    accion = (data.get("accion") or "").strip().lower()

    if not mascota_id or accion not in ("agregar", "quitar"):
        return jsonify({"ok": False,
                        "error": "Se requiere mascota_id y accion (agregar|quitar)"}), 400

    conn = get_db_connection()
    try:
        usuario_id, es_anonimo = _usuario_actual(conn)

        # verificar que la mascota exista
        m = conn.execute("SELECT id FROM MASCOTAS WHERE id = ?", (mascota_id,)).fetchone()
        if not m:
            return jsonify({"ok": False, "error": "La mascota no existe"}), 404

        if accion == "agregar":
            # INSERT OR IGNORE = UPSERT simple (la tabla tiene UNIQUE(usuario_id, mascota_id))
            fav_id = _nuevo_id("FAV")
            conn.execute("""
                INSERT OR IGNORE INTO FAVORITOS (id, usuario_id, mascota_id)
                VALUES (?, ?, ?)
            """, (fav_id, usuario_id, mascota_id))
            conn.commit()
            total = conn.execute(
                "SELECT COUNT(*) FROM FAVORITOS WHERE usuario_id = ?", (usuario_id,)
            ).fetchone()[0]
            return jsonify({"ok": True, "accion": "agregar",
                            "mascota_id": mascota_id, "total_favoritos": total,
                            "anonimo": es_anonimo})

        else:  # quitar
            conn.execute("""
                DELETE FROM FAVORITOS
                WHERE usuario_id = ? AND mascota_id = ?
            """, (usuario_id, mascota_id))
            conn.commit()
            total = conn.execute(
                "SELECT COUNT(*) FROM FAVORITOS WHERE usuario_id = ?", (usuario_id,)
            ).fetchone()[0]
            return jsonify({"ok": True, "accion": "quitar",
                            "mascota_id": mascota_id, "total_favoritos": total,
                            "anonimo": es_anonimo})

    except Exception as e:
        conn.rollback()
        return jsonify({"ok": False, "error": str(e)}), 500
    finally:
        conn.close()


@app.route("/api/favoritos", methods=["GET"])
def api_favoritos_listar():
    """Devuelve la lista de mascota_id que el usuario (logueado o anónimo)
    tiene marcadas como favoritas.

    Header opcional:
        X-Usuario-Id: USR-xxxxx

    Respuesta:
        { "ok": true, "mascota_ids": ["PET-001", "PET-003"], "anonimo": false }
    """
    conn = get_db_connection()
    try:
        usuario_id, es_anonimo = _usuario_actual(conn)
        rows = conn.execute(
            "SELECT mascota_id FROM FAVORITOS WHERE usuario_id = ? ORDER BY creado_en",
            (usuario_id,)
        ).fetchall()
        return jsonify({
            "ok": True,
            "mascota_ids": [r["mascota_id"] for r in rows],
            "anonimo": es_anonimo,
            "usuario_id": usuario_id,
        })
    finally:
        conn.close()


@app.route("/api/usuarios", methods=["POST"])
def api_usuarios():
    """Crea un nuevo usuario en la tabla USUARIOS (o devuelve el existente).

    Body JSON: { "nombre": "María", "correo": "maria@email.com" }

    El campo `correo` es UNIQUE en la BD: si ya existe, se devuelve el usuario
    existente (no se crea uno nuevo ni se duplica).
    """
    data = request.get_json(silent=True) or {}
    nombre = (data.get("nombre") or "").strip()
    correo = (data.get("correo") or "").strip().lower()

    # Validaciones
    if not nombre or len(nombre) < 2:
        return jsonify({"ok": False, "error": "El nombre es obligatorio (min 2 caracteres)"}), 400
    if not correo or "@" not in correo or "." not in correo:
        return jsonify({"ok": False, "error": "El correo es inválido"}), 400

    conn = get_db_connection()
    try:
        # ¿Ya existe un usuario con ese correo?
        existente = conn.execute(
            "SELECT id, nombre, correo FROM USUARIOS WHERE correo = ?", (correo,)
        ).fetchone()
        if existente:
            return jsonify({
                "ok": True, "creado": False, "ya_existia": True,
                "usuario": {"id": existente["id"],
                            "nombre": existente["nombre"],
                            "correo": existente["correo"]}
            })

        # Crear nuevo usuario
        user_id = _nuevo_id("USR")
        conn.execute("""
            INSERT INTO USUARIOS (id, correo, nombre)
            VALUES (?, ?, ?)
        """, (user_id, correo, nombre))
        conn.commit()
        return jsonify({
            "ok": True, "creado": True, "ya_existia": False,
            "usuario": {"id": user_id, "nombre": nombre, "correo": correo}
        })
    except sqlite3.IntegrityError as e:
        conn.rollback()
        # Por si hay una race condition y se insertó entre el SELECT y el INSERT
        existente = conn.execute(
            "SELECT id, nombre, correo FROM USUARIOS WHERE correo = ?", (correo,)
        ).fetchone()
        if existente:
            return jsonify({
                "ok": True, "creado": False, "ya_existia": True,
                "usuario": {"id": existente["id"],
                            "nombre": existente["nombre"],
                            "correo": existente["correo"]}
            })
        return jsonify({"ok": False, "error": "Error de integridad: " + str(e)}), 400
    except Exception as e:
        conn.rollback()
        return jsonify({"ok": False, "error": str(e)}), 500
    finally:
        conn.close()


@app.route("/api/login", methods=["POST"])
def api_login():
    """Login: devuelve el usuario cuyo correo coincida.

    Body JSON: { "correo": "maria@email.com" }

    Si el correo existe en USUARIOS, devuelve el usuario (id, nombre, correo).
    Si no existe, devuelve 404.
    """
    data = request.get_json(silent=True) or {}
    correo = (data.get("correo") or "").strip().lower()
    if not correo or "@" not in correo:
        return jsonify({"ok": False, "error": "Correo inválido"}), 400

    conn = get_db_connection()
    try:
        u = conn.execute(
            "SELECT id, nombre, correo FROM USUARIOS WHERE correo = ?", (correo,)
        ).fetchone()
        if not u:
            return jsonify({"ok": False, "error": "No existe una cuenta con ese correo"}), 404
        return jsonify({
            "ok": True,
            "usuario": {"id": u["id"], "nombre": u["nombre"], "correo": u["correo"]}
        })
    finally:
        conn.close()


@app.route("/api/sesion")
def api_sesion():
    """Verifica si el usuario sigue logueado (valida el X-Usuario-Id).

    Útil para restaurar la sesión al recargar la página.
    """
    usuario_id = (request.headers.get("X-Usuario-Id") or "").strip()
    if not usuario_id:
        return jsonify({"ok": True, "logueado": False})

    conn = get_db_connection()
    try:
        u = conn.execute(
            "SELECT id, nombre, correo FROM USUARIOS WHERE id = ?", (usuario_id,)
        ).fetchone()
        if not u:
            return jsonify({"ok": True, "logueado": False})
        return jsonify({
            "ok": True, "logueado": True,
            "usuario": {"id": u["id"], "nombre": u["nombre"], "correo": u["correo"]}
        })
    finally:
        conn.close()


def _usuario_actual(conn):
    """Lee el usuario logueado desde el header X-Usuario-Id.

    Devuelve (usuario_id, es_anonimo):
      - Si hay header y existe el usuario -> (id_real, False)
      - Si no hay header o no existe      -> (USR-ANON, True)
    """
    usuario_id = (request.headers.get("X-Usuario-Id") or "").strip()
    if usuario_id:
        u = conn.execute(
            "SELECT id FROM USUARIOS WHERE id = ?", (usuario_id,)
        ).fetchone()
        if u:
            return u["id"], False
    # fallback: usuario anónimo
    _asegurar_usuario_anonimo(conn)
    return USUARIO_ANON_ID, True


@app.route("/api/chatbot")
def api_chatbot():
    """Devuelve la base de conocimientos del chatbot (constante Python)."""
    return jsonify({
        "knowledge": CHATBOT_KNOWLEDGE,
        "welcomeCategories": CHATBOT_CATEGORIES,
        "defaultResponse": CHATBOT_DEFAULT,
    })


@app.route("/api/estado")
def api_estado():
    """Vuelca el contenido de las 6 tablas en JSON.

    Es un "estado de la BD" en vivo: abrilo en el navegador (o con curl)
    después de interactuar con la página para ver qué se guardó.

    Ejemplo:
        GET /api/estado                 -> todo
        GET /api/estado?tabla=mascotas  -> solo MASCOTAS
        GET /api/estado?tabla=contacto  -> solo MENSAJES_CONTACTO
    """
    conn = get_db_connection()

    # mapeo de nombre corto (URL) -> tabla SQL + label
    tablas_map = [
        ("usuarios",      "USUARIOS",
            "SELECT * FROM USUARIOS ORDER BY creado_en"),
        ("mascotas",      "MASCOTAS",
            'SELECT *, "tamaño" AS tamano FROM MASCOTAS ORDER BY creado_en'),
        ("solicitudes",   "SOLICITUDES_ADOPCION",
            "SELECT s.*, m.nombre AS mascota_nombre "
            "FROM SOLICITUDES_ADOPCION s "
            "LEFT JOIN MASCOTAS m ON m.id = s.mascota_id "
            "ORDER BY s.creado_en DESC"),
        ("contacto",      "MENSAJES_CONTACTO",
            "SELECT * FROM MENSAJES_CONTACTO ORDER BY creado_en DESC"),
        ("suscriptores",  "SUSCRIPTORES_DIARIO",
            "SELECT * FROM SUSCRIPTORES_DIARIO ORDER BY creado_en DESC"),
        ("favoritos",     "FAVORITOS",
            "SELECT f.*, m.nombre AS mascota_nombre, u.correo AS usuario_correo "
            "FROM FAVORITOS f "
            "LEFT JOIN MASCOTAS m ON m.id = f.mascota_id "
            "LEFT JOIN USUARIOS u ON u.id = f.usuario_id "
            "ORDER BY f.creado_en DESC"),
    ]

    filtro = request.args.get("tabla", "").strip().lower()
    if filtro:
        tablas_map = [t for t in tablas_map if t[0] == filtro]
        if not tablas_map:
            return jsonify({"ok": False,
                            "error": "Tabla desconocida. Valores válidos: " +
                                     ", ".join(t[0] for t in [
                                         ("usuarios",), ("mascotas",), ("solicitudes",),
                                         ("contacto",), ("suscriptores",), ("favoritos",)
                                     ])}), 400

    resultado = {}
    totales = {}
    for corto, nombre, query in tablas_map:
        try:
            rows = conn.execute(query).fetchall()
            resultado[corto] = {
                "tabla": nombre,
                "total": len(rows),
                "filas": [dict(r) for r in rows],
            }
            totales[corto] = len(rows)
        except Exception as e:
            resultado[corto] = {"tabla": nombre, "error": str(e), "filas": []}
            totales[corto] = 0

    conn.close()
    return jsonify({
        "generado_en": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "totales": totales,
        "tablas": resultado,
    })


# ============================================================================
#  EXPORTACIÓN A CSV / TXT
# ============================================================================
def _consultas_exportables():
    """Devuelve la lista de (nombre_corto, nombre_tabla, query) para exportar."""
    return [
        ("usuarios",     "USUARIOS",
            "SELECT * FROM USUARIOS ORDER BY creado_en"),
        ("mascotas",     "MASCOTAS",
            'SELECT id, nombre, especie, sexo, edad, "tamaño" AS tamano, '
            "descripcion, direccion_imagen, estado, es_urgente, "
            "esta_esterilizado, esta_vacunado, creado_por_id, "
            "creado_en, actualizado_en FROM MASCOTAS ORDER BY creado_en"),
        ("solicitudes",  "SOLICITUDES_ADOPCION",
            "SELECT s.id, s.mascota_id, m.nombre AS mascota_nombre, "
            "s.usuario_id, s.nombre, s.correo, s.mensaje, s.estado, "
            "s.creado_en, s.actualizado_en "
            "FROM SOLICITUDES_ADOPCION s "
            "LEFT JOIN MASCOTAS m ON m.id = s.mascota_id "
            "ORDER BY s.creado_en DESC"),
        ("contacto",     "MENSAJES_CONTACTO",
            "SELECT * FROM MENSAJES_CONTACTO ORDER BY creado_en DESC"),
        ("suscriptores", "SUSCRIPTORES_DIARIO",
            "SELECT * FROM SUSCRIPTORES_DIARIO ORDER BY creado_en DESC"),
        ("favoritos",    "FAVORITOS",
            "SELECT f.id, f.usuario_id, u.correo AS usuario_correo, "
            "f.mascota_id, m.nombre AS mascota_nombre, f.creado_en "
            "FROM FAVORITOS f "
            "LEFT JOIN MASCOTAS m ON m.id = f.mascota_id "
            "LEFT JOIN USUARIOS u ON u.id = f.usuario_id "
            "ORDER BY f.creado_en DESC"),
    ]


@app.route("/api/exportar")
def api_exportar():
    """Descarga un archivo .csv con TODAS las tablas de la BD.

    Cada tabla va en su propio bloque precedido por una fila con el nombre
    de la tabla y el total de filas, luego una fila de encabezados y las
    filas de datos.  Se abre perfecto en Excel / Google Sheets / Numbers,
    y también es legible como texto plano (.txt).

    Uso:
        - Entrá en el navegador a  /api/exportar
          -> descarga  miauguau_datos.csv
        - O desde la terminal:  curl -O http://localhost:5000/api/exportar
        - O pedí una sola tabla:  /api/exportar?tabla=contacto
    """
    conn = get_db_connection()
    filtro = request.args.get("tabla", "").strip().lower()
    consultas = _consultas_exportables()
    if filtro:
        consultas = [c for c in consultas if c[0] == filtro]
        if not consultas:
            conn.close()
            return jsonify({"ok": False, "error":
                "Tabla desconocida. Valores: usuarios, mascotas, solicitudes, "
                "contacto, suscriptores, favoritos"}), 400

    buf = io.StringIO()
    # BOM para que Excel reconozca los acentos y la ñ
    buf.write("\ufeff")
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL,
                        lineterminator="\n")

    writer.writerow(["MIAUGUAU — Exportación de la base de datos"])
    writer.writerow(["Generado:", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
    writer.writerow([])

    totales = {}
    for corto, nombre, query in consultas:
        try:
            rows = conn.execute(query).fetchall()
        except Exception as e:
            writer.writerow([nombre, "ERROR:", str(e)])
            writer.writerow([])
            continue

        if rows:
            cols = list(rows[0].keys())
        else:
            # sin filas: leer nombres de columna del cursor
            cur2 = conn.execute(query)
            cols = [d[0] for d in cur2.description] if cur2.description else []
        totales[corto] = len(rows)

        writer.writerow([">>> TABLA:", nombre, "—", str(len(rows)), "fila(s)"])
        if cols:
            writer.writerow(cols)
            for r in rows:
                writer.writerow([("" if v is None else str(v)) for v in r])
        writer.writerow([])  # separador entre tablas

    conn.close()

    nombre_archivo = "miauguau_datos_{}.csv".format(
        datetime.now().strftime("%Y%m%d_%H%M%S"))
    return Response(
        buf.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition":
                 'attachment; filename="{}"'.format(nombre_archivo)}
    )


# ============================================================================
#  ARRANQUE
# ============================================================================
def migrar_urls_imagenes():
    """Actualiza las URLs de imágenes de Imgur a GitHub raw en la BD.

    Como los datos semilla usan INSERT OR IGNORE, si la BD ya existía con
    URLs viejas de Imgur, no se actualizan solas.  Esta migración las
    reemplaza para que las imágenes carguen correctamente.

    Se ejecuta en cada arranque (es idempotente: si no hay URLs viejas,
    no hace nada).
    """
    mapeo = {
        # Imgur -> GitHub raw
        "https://i.imgur.com/SIh1GNu.jpeg":
            "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/luna.png",
        "https://i.imgur.com/wxMc1OY.jpeg":
            "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/max.png",
        "https://i.imgur.com/Pi4a3Ip.jpeg":
            "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/mia.png",
        "https://i.imgur.com/P4FjS58.jpeg":
            "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/thor.png",
        "https://i.imgur.com/9BzEKSj.jpeg":
            "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/kira.png",
        "https://i.imgur.com/kcH3Dm1.jpeg":
            "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/rocky.png",
        "https://i.imgur.com/klk6EoG.jpeg":
            "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/hero-pets.png",
        "https://i.imgur.com/U2Xb6La.jpeg":
            "https://raw.githubusercontent.com/aianfucinos-jpg/miauguau-img/main/featured-story.png",
    }
    conn = get_db_connection()
    try:
        for vieja, nueva in mapeo.items():
            # Actualizar MASCOTAS.direccion_imagen
            conn.execute(
                "UPDATE MASCOTAS SET direccion_imagen = ? WHERE direccion_imagen = ?",
                (nueva, vieja)
            )
        conn.commit()
    finally:
        conn.close()


def init_db():
    crear_tablas()
    sembrar_datos()
    migrar_urls_imagenes()


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
