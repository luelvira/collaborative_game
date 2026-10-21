# Diseño: Tablero de concurso para TV de aula (rediseño visual + pregunta con temporizador)

**Fecha:** 2026-10-21 · **Estado:** aprobado en conversación (playback validado por el usuario el 2026-10-21)

## Intento y por qué

La app dirige un concurso en clase: el profesor crea grupos (asignación aleatoria ya implementada), hace preguntas por voz y el grupo que responde correctamente se lleva un punto; al final se muestra el ganador. El tablero se proyecta en una **smart TV grande del aula con formato de pizarra**, usada **como monitor**:

- **No hay componente táctil** (el uso como monitor lo anula). El profesor controla todo desde el portátil/teclado. Cualquier idea de buzz-in o interacción del alumnado queda fuera.
- La imagen proyectada como monitor **sale degradada**: negros lavados, reflejos con luz ambiente, menos finura de detalle. El tema actual "neón sobre negro" (brillos, text-shadows, bordes cian al 30%) brilla en un portátil, no en esta TV.

Dos problemas a resolver:

1. **Legibilidad/contraste en proyección** — miedo explícito del usuario ("poco contraste en el monitor").
2. **Engagement** — hoy la app es un marcador pasivo; el momento de puntuar cambia solo un número. La clase mira la pantalla si la pantalla tiene contenido: pregunta en vivo, cuenta atrás y celebración del punto.

## Objetivos

- Rediseño visual completo ("Marcador nocturno"): conocible desde el fondo del aula, con solo contraste y color plano, sin depender de brillos o detalle fino.
- Pregunta actual **escrita al vuelo** por el profesor, mostrada en pantalla con **temporizador** configurable.
- Los tres momentos fuertes del concurso tienen presencia: en directo (pregunta+cuenta atrás), puntuar (flash de color+confeti) y tiempo agotado.
- Un **deshacer** que cubra un dedo torpe al puntuar (sustituye al −1 por tarjeta).

## No objetivos y anti-objetivos

- **No:** entrada del alumnado (touch, móviles, buzz-in). La TV es solo salida.
- **No:** banco de preguntas ni importaciones; las preguntas se escriben al vuelo.
- **No:** −1 por tarjeta (se quita del tablero en juego); el deshacer único lo cubre.
- **Anti:** automatismos silenciosos que dejen al profesor sin control (p. ej. puntuar/seguir automáticamente al acabar el tiempo).
- **Anti:** volver a introducir elementos decorativos que dependan de brillo, opacidad baja o detalle fino.

## Dirección visual acordada ("Marcador nocturno", opción B del companion)

- **Fondo negro plano** (~#0a0a0f). Fuera: gradientes de fondo, `text-shadow` de neón, glows, sombras de color y bordes a opacidad <50%.
- **Identidad de equipo por color pleno y saturado**: franja/borde superior grueso (8–10 px) del color del equipo en cada tarjeta; se elimina el chip lateral de 10 px. La rueda de colores y `colorFor()` de `lib.js` se mantienen.
- **Texto secundario claro** (~#cfd2dc, no el gris tenue `#9a9ab8`). Nada de texto o bordes que solo se distingan por opacidad.
- **Tipografía agrandada** para la TV: nombres de grupo, pregunta y controles en juego un par de tallas por encima de lo actual; la puntuación sigue siendo el elemento dominante de la tarjeta.
- El mismo tratamiento de piel en las tres vistas (inicio, preparación, tablero) y en el podio del ganador. La app debe seguir viéndose razonable en portátil.

## Flujo del concurso en la vista de juego

Estado nuevo sobre el tablero: **franja superior a todo el ancho** con la pregunta.

Máquina de estados de la pregunta (por ronda):

1. **Borrador** — el profesor escribe la pregunta (input en la franja), ajusta los segundos (30 por defecto, editable) y pulsa «Mostrar y arrancar». Hasta entonces la franja muestra una invitación a escribir.
2. **En directo** — pregunta gigante, cuenta atrás grande con barra de progreso, corona 👑 en el grupo líder (si hay), y sonido (apgable, Web Audio, sin ficheros externos) al expirar. Puntuar es posible en cualquier momento.
3. **Puntuado** — pulsar **+1** de un grupo: el tiempo se detiene automáticamente (puntuar ES parar; el temporizador ya no vuelve a arrancar en esa ronda), la tarjeta ganadora llena **todo su color** con un flash breve (~0.8 s) y confeti; el resto de tarjetas se atenúa un instante; la franja confirma "¡Punto para el Rojo!". El disparo del flash es el propio +1 de la tarjeta; **no existe botón de parar**.
4. **Expirado** — franja en rojo "⏱ ¡Tiempo!" + sonido; el profesor puede puntuar a mano (+1). Puntuar desde expirado celebra igual que desde en directo.
5. **Cambio de ronda** — botón «Siguiente pregunta» limpia la franja y vuelve al borrador.

**Cierre de la ronda:** una pregunta admite **varios puntos** hasta que el profesor pase de página (por ejemplo, acertada a medias por dos equipos). Cada +1 dispara su celebración y actualiza el mensaje de la franja; la ronda la cierra siempre el profesor con «Siguiente pregunta».

**Deshacer:** chip pequeño, gris apagado, redondeado, "↩ deshacer punto", en la esquina de la franja (control del profesor, no botón de juego). Deshace el último punto concedido. Visible desde el puntuado/expirado hasta lanzar la siguiente pregunta.

## Lo que no se toca

Grupos, colores por rueda cromática, asignación aleatoria anti-hambre, persistencia en `localStorage` (`contestBoard:current` + `contestBoard:history`), historial "Past plays", podio de ganadores y flujo de setup conservan su lógica actual; solo cambian de piel (se mantienen tal cual, salvo el tamaño de letra del setup, que sube con el resto).

## Decisiones ya tomadas (por el usuario, en conversación)

- **Toda la interfaz pasa a castellano**, incluidos los nombres de grupo derivados de la rueda de color (los 12 nombres de `colorName()` pasan a español: "rojo", "azul"…). Los grupos ya archivados en el historial mantienen sus nombres congelados tal como se guardaron (si alguno aparece en inglés es histórico, no un descuido).
- Dirección visual B: oscuro plano, no claro (opción A) y no tarjetas completamente pintadas (opción C).
- Celebración con **flash de color de toda la tarjeta** (~0.8 s) + confeti (opción B), no el resalte persistente sutil (opción A). El usuario pidió "cogerlo con pinzas": la variante B se asume, y el flash es breve por diseño.
- Deshacer pequeño y discreto, no como elemento de juego.
- Los −1 desaparecen del tablero en juego (el usuario lo considera correcto).
- Preguntas al vuelo, una por una; sin lista preparada.
- Sin interacción táctil del alumnado.
- El tiempo se para al puntuar; no hay botón dedicado de parada.
- **Una pregunta puede puntuar a varios grupos** (partido en dos hasta que el profesor pase de página); cada puntuación repite la celebración.

## Restricciones técnicas (del proyecto existente)

- Vanilla ES modules, **sin dependencias ni CDN** (la única excepción actual: Tailwind como `@import` base en `styles.css`, que ya se usa como estilos; no añadir ninguna más).
- Sonido apagable **con Web Audio API** (oscilador), sin ficheros de audio externos.
- Animaciones respetan `prefers-reduced-motion` (ya implementado: desactivarlas si procede).
- La lógica pura vive en `lib.js` (testeada con `node --test`); el DOM en `app.js`. Los tests Playwright existentes (`tests/`) no deben romperse salvo por cambios deliberados de UI.
- Todo el estado del concurso sigue persistiéndose en cada mutación (refrescar no pierde nada).

## Delegado al builder (calls que el builder puede tomar)

- Escala tipográfica exacta y valores de px del sistema visual.
- Colores exactos dentro de la paleta pactada (negro plano, secundario claro, colores de equipo saturados) siempre que cumplan la dirección y AA de contraste.
- Implementación concreta de confeti y flash (CSS/JS), cuidando el rendimiento (el proyecto ya optimizó repintados en scroll y animaciones — mantener ese cuidado).
- Forma de integrar la máquina de estados de la pregunta en `lib.js` (nuevas acciones: setQuestion, startTimer, tick, award, advanceRound, undo… y su serialización).

## Calls del autor (ya decididos, no volver a preguntar)

- **Deshacer repetible**: un registro de los últimos puntos concedidos (límite ~20) permite deshacer varias veces seguidas; cada pulsación revierte la última puntuación, actualiza la franja y devuelve la capacidad de seguir puntuando.
- **Sesiones antiguas**: las partidas guardadas antes del rediseño siguen cargando ("Continue"); los campos nuevos de la ronda se hidratan a Borrador sin romper el estado.
- **"Terminar concurso" en mitad de una ronda**: se descarta la pregunta en curso y se muestra el podio; la franja es exclusiva de la fase de juego.
- **Toggle de sonido**: pequeño interruptor en la barra superior de la vista de juego (persistente en `localStorage`, no hay panel de ajustes; el sonido ES parte del engagement, arranca activo y puede apagarse).
- **+1 sin ronda activa** (desde Borrador): celebra igual (flash + mensaje en la franja + chip deshacer); simplemente no hay temporizador al que parar.
- Persistir el estado de la pregunta y la fase en `contestBoard:current` (refrescar en mitad de una pregunta no la pierde). **El tiempo restante NO se persiste**: si se refresca en directo, la pregunta se mantiene con la cuenta atrás reiniciada a su valor inicial.
- La corona de líder es decorativa (emoji), no un dato.
