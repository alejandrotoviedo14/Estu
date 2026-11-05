# Estu

Web de seguimiento del Movistar Estudiantes (Primera FEB, con agenda de las tres plantillas).

## Fuentes de datos

- **FEB (baloncestoenvivo.feb.es)**: calendario completo, resultados, clasificación y actas (box score) de cada partido (`feb.js`). Es la fuente de estadísticas.
- **Web oficial del club (movistarestudiantes.com)**: plantilla con fotos, dorsal, posición, altura, categoría, cuerpo técnico, historial de clubes (`club.js`) y noticias (WordPress). Es la fuente de identidad de los jugadores.
- **Agenda del club (Google Calendar público)**: horas y pabellón de los próximos partidos de las tres plantillas.
- `data.json`: respaldo para historia del club y destacados de jugadores.

Los jugadores se cruzan entre club y FEB por dorsal y apellido.

Los partidos ya jugados se cachean en `feb-state.json` y no se vuelven a descargar.

## Ejecutar

```bash
npm install
npm start
```

Variables de entorno opcionales: `PORT`, `DATA_DIR` (donde se guarda el estado), `SYNC_MINUTES` (por defecto 15), `FEB_GROUP`, `FEB_SEASON`, `FEB_TEAM_ID`, `ICS_URL`.

## Endpoints

- `GET /api/data`: todo lo que consume la web.
- `GET /api/match/:id`: acta de un partido (id de la FEB).
- `GET /api/sync`: fuerza una sincronización.
- `GET /calendario/partido/:id.ics`: un partido para el calendario del móvil.
- `GET /calendario/temporada.ics`: todos los partidos de la temporada.
- `GET /api/news`, `GET /health`.

## Tests

```bash
node --test tests/parsers.test.js
```

Los tests usan HTML guardado en `tests/fixtures/` de la FEB, el club y los perfiles de jugador. Si una web cambia su maquetación, fallan y avisan antes de que la web se rompa.

## Persistencia

El estado (partidos cacheados, plantilla, historial) se guarda en `DATA_DIR`. Si no se define, se usa `./data`, que está en `.gitignore`. En un hosting con disco efímero, apunta `DATA_DIR` a un volumen persistente.

## App instalable

La web tiene `manifest.webmanifest` y un service worker (`public/sw.js`). Se puede añadir a la pantalla de inicio y, con la última versión de los datos guardada, se consulta sin conexión.
