# Tablero de Concurso

Aplicación web de una sola página para dirigir un **concurso en directo en el
aula**: crea grupos, reparte a los participantes al azar, lanza preguntas al
vuelo con cuenta atrás, concede puntos y proclama al ganador. Todo se guarda
en el navegador — sin servidor, sin backend, sin registros.

Construida con HTML/CSS/JavaScript puro. **Vite** y **Tailwind CSS** solo
intervienen en desarrollo y compilación; la web desplegada no lleva
librerías en tiempo de ejecución.

## Pensada para la TV del aula

El tablero se proyecta en una **smart TV grande del aula** usada como monitor.
La imagen proyectada sale degradada (negros lavados, reflejos, menos detalle),
así que la piel visual de la app — **«Marcador nocturno»** — se apoya solo en
contraste y color plano, sin brillos, neones ni detalle fino:

- Fondo negro plano y texto secundario claro, legible desde el fondo del aula.
- Cada grupo luce una **franja gruesa de su color** (rueda cromática, colores
  saturados); la puntuación es el elemento dominante de cada tarjeta.
- Tipografía agrandada: la pregunta, la cuenta atrás y los nombres se leen
  sin esfuerzo en la proyección (y la app sigue viéndose razonable en
  portátil).

**No hay interacción del alumnado**: la TV es solo salida; el profesor
controla todo desde el portátil con el teclado.

## ¿Cómo funciona?

1. **Preparación** — elige entre 2 y 10 grupos (se nombran solos con su color:
   rojo, naranja, verde…) y añade jugadores por nombre. Cada jugador cae en
   un grupo aleatorio elegido entre los que **menos miembros** tienen, así
   ningún grupo se queda vacío mientras otros se llenan. Se puede quitar a un
   jugador o a un grupo vacío en cualquier momento.
2. **Pregunta al vuelo** — en el tablero, la franja superior pide la pregunta:
   escríbela, ajusta los segundos (de 5 a 300, de 5 en 5; por defecto 30) y
   pulsa **«Mostrar y arrancar»**. La pregunta aparece gigante con la cuenta
   atrás y su barra de progreso; la corona 👑 marca al grupo líder.
3. **Puntuar** — el botón **+1** de una tarjeta concede el punto. Puntuar ES
   parar: el tiempo se detiene automáticamente, la tarjeta gana se llena de
   su color con un flash breve y confeti atiende el punto, y la franja
   confirma «¡Punto para el Rojo!». No hay botón de parada. Una pregunta
   admite varios puntos hasta que pases de página.
4. **Tiempo agotado** — la franja se vuelve roja con «⏱ ¡Tiempo!» y suena un
   aviso; igualmente puedes conceder +1 a mano.
5. **Deshacer** — el chip «↩ deshacer punto» en la esquina de la franja
   revierte la última puntuación; es repetible (registro de los últimos 20
   puntos) y funciona incluso cambiando de pregunta.
6. **Siguiente pregunta** — limpia la franja y vuelve al borrador para la
   ronda siguiente.
7. **Terminar concurso** — congela el tablero y anuncia al ganador en pantalla
   completa (con empates, ganadores compartidos). «Archivar y volver al
   inicio» guarda la partida con su fecha y ganador en «Partidas anteriores»
   (se conservan las últimas 20) y limpia el tablero.

El interruptor 🔊/🔇 de la barra superior apaga el sonido (avisos de Web
Audio, sin ficheros externos); la preferencia se recuerda entre sesiones.

Todo el estado del concurso se autoguarda en `localStorage` tras cada cambio
(`contestBoard:current`, `contestBoard:history` y `contestBoard:sound`) y
sobrevive a refrescos: refrescar en mitad de una pregunta conserva la
pregunta; el tiempo restante no, la cuenta atrás vuelve a su valor inicial.

## Ejecutar en local

```bash
npm install
npm run dev
# → http://localhost:5173
```

Compilación de producción y previsualización local:

```bash
npm run build
npm run preview
```

## Pruebas

```bash
npm run test:unit        # lógica + UI (Vitest)
npm run test:e2e         # Playwright contra vite preview
```

Vitest, jsdom/linkedom, Playwright, Vite y Tailwind son **devDependencies**
exclusivamente.

> Nota: en la batería de e2e, el test de preparación («crea N grupos con
> nombre de color») puede fallar de vez en cuando por un fallo puntual del
> entorno; si te pasa, relanza el fichero una vez con la suite completa y
> pasa: es un flake conocido, no un fallo del producto.

## Publicar en GitHub Pages

El repositorio incluye una GitHub Action (`.github/workflows/pages.yml`)
que compila con Vite y despliega la carpeta `dist/`:

1. Sube este repositorio a GitHub (las fuentes están en la raíz del repo).
2. Ve a **Settings → Pages**.
3. En **Build and deployment**, elige **Source: GitHub Actions**.
4. Haz push a `main` (o ejecuta manualmente el workflow **Deploy to GitHub
   Pages**).
5. La web aparecerá en `https://<tu-usuario>.github.io/collaborative_game/`
   (el primer despliegue puede tardar un par de minutos).

---

Creado como proyecto de la asignatura Programación I (UPM, 2026/27).
