# i-cut

Editor de vídeo gratuito para iPhone, al estilo CapCut. Todo se procesa en el propio teléfono: sin marcas de agua, sin cuenta, sin pagos y sin subir tus vídeos a ningún servidor.

Es una app web instalable (PWA): se abre desde Safari, se añade a la pantalla de inicio y a partir de ahí funciona a pantalla completa como una app, incluso sin conexión.

## Funciones

**Edición**
- Proyectos guardados en el iPhone, con portada, duplicar, renombrar y borrar.
- Pista principal magnética con miniaturas, más pistas de superposición (picture-in-picture), texto, stickers y audio.
- Línea de tiempo táctil con cursor fijo en el centro: desliza para moverte, pellizca para hacer zoom, mantén pulsado un clip para moverlo o reordenarlo y arrastra los tiradores blancos para recortar.
- Dividir, duplicar, eliminar, congelar fotograma, extraer audio y silenciar.
- Deshacer y rehacer ilimitado (80 pasos).

**Vídeo**
- Velocidad de 0,1x a 10x.
- 15 filtros (Cine, Vintage, B y N, Teal, Película…) con intensidad.
- 12 ajustes: brillo, contraste, saturación, exposición, temperatura, matiz, luces, sombras, desvanecer, viñeta, grano y nitidez.
- 13 efectos animados: glitch, VHS, temblor, pulso, RGB, píxel, espejo, flash, cine viejo, arcoíris, desenfoque, caleidoscopio y negativo.
- 12 transiciones: fundido, negro, destello, deslizar, zoom, barrido, círculo, desenfoque, píxeles y giro.
- Animaciones de entrada, salida y bucle (aparecer, zoom, deslizar, rebote, giro, latido, flotar, Ken Burns…).
- Transformar con gestos (mover, pellizcar, girar con dos dedos) o con controles: girar 90°, espejo, ajustar o rellenar.
- Croma (pantalla verde o azul) para superposiciones.
- Opacidad y formato del lienzo: 9:16, 16:9, 1:1, 4:5, 4:3, 3:4, 21:9 u original, con fondo desenfocado o de color.

**Texto**
- Texto con 12 fuentes, estilos predefinidos, color, contorno, fondo, sombra, alineación, tamaño y espaciado.
- Más de 70 stickers y emojis.
- Efecto máquina de escribir y todas las animaciones.
- Subtítulos automáticos (beta) con Whisper ejecutándose en el propio iPhone.

**Audio**
- Música desde la app Archivos, voz en off grabada con el micrófono, audio sacado de otro vídeo y 8 efectos de sonido generados en el dispositivo.
- Volumen hasta 200 %, fundido de entrada y de salida, y velocidad.

**Exportación**
- MP4 H.264 + AAC desde 480p hasta 4K, a 24, 25, 30, 50 o 60 fps, en tres niveles de calidad.
- Codificación por hardware del iPhone (WebCodecs). En iOS anteriores a 16.4 se graba en tiempo real.
- «Guardar en Fotos / Compartir» abre el menú de compartir de iOS (opción «Guardar vídeo»).

## Cómo usarla en el iPhone

1. Abre la URL publicada en **Safari**.
2. Pulsa **Compartir → Añadir a pantalla de inicio**.
3. Abre i-cut desde el icono. Así se ve a pantalla completa y iOS no borra tus proyectos.

Requisitos: iOS 16.4 o superior para exportar rápido (con iOS 15 funciona en modo tiempo real). Se recomienda iOS 17 o superior.

## Desarrollo

```bash
npm install
npm run dev       # servidor local; abre la URL «Network» desde el iPhone en la misma Wi‑Fi
npm run build     # genera dist/
npm run preview   # sirve dist/ para probar la versión de producción
```

Para probar en el iPhone durante el desarrollo, la cámara y el micrófono exigen HTTPS. Lo más cómodo es desplegar una vista previa en Netlify (cada pull request genera una) o usar un túnel como `cloudflared tunnel --url http://localhost:5173`.

## Despliegue en Netlify

El repositorio ya incluye `netlify.toml`:

1. En Netlify: **Add new site → Import an existing project → GitHub** y elige este repositorio.
2. Netlify detecta la configuración: comando `npm run build` y carpeta `dist`.
3. Despliega. Cada cambio en `main` se publica solo, y cada pull request tiene su propia URL de prueba.

La app pesa unos 2 MB y es estática, así que el plan gratuito sobra.

## ¿Netlify limita el uso de la GPU?

No. Netlify (igual que Vercel, Cloudflare Pages o GitHub Pages) solo sirve los archivos de la app. El renderizado y la codificación ocurren en el iPhone:

- **Vista previa y render:** WebGL2, que en iOS funciona sobre Metal, es decir, la GPU del iPhone.
- **Codificación:** WebCodecs usa el codificador de vídeo por hardware del iPhone, el mismo que la app Cámara.
- **Audio:** Web Audio mezcla en tiempo real y `OfflineAudioContext` renderiza la mezcla final.

Por eso el hosting da igual para el rendimiento. Los límites reales los pone Safari en iOS:

| Límite | Qué significa | Cómo lo maneja i-cut |
| --- | --- | --- |
| WebCodecs requiere iOS 16.4+ | Sin él no hay codificación por hardware | Modo de grabación en tiempo real como respaldo |
| Codificador AAC nativo solo en las versiones más recientes de iOS | Sin él no hay audio en el MP4 | Codificador AAC en WebAssembly que se carga solo cuando hace falta |
| Memoria limitada por pestaña | Exportar vídeos muy largos en 4K puede cerrar Safari | Decodificación fotograma a fotograma, miniaturas pequeñas y aviso para bajar resolución si falla |
| La exportación se para si sales de la app o se bloquea la pantalla | El iPhone suspende las páginas en segundo plano | Bloqueo de pantalla activo (Wake Lock) durante la exportación |
| El selector de fotos puede convertir vídeos HEVC/HDR | Safari a veces entrega una copia H.264 en lugar del original | Ninguna opción web lo evita; la app nativa (ver abajo) sí |
| Almacenamiento web | Safari borra los datos de webs no usadas en 7 días | Instalada en la pantalla de inicio no aplica; además se pide almacenamiento persistente |
| No se puede escribir directamente en Fotos | Hace falta un paso más | Menú de compartir → «Guardar vídeo» |

**Por qué no ffmpeg.wasm:** necesita `SharedArrayBuffer` (cabeceras COOP/COEP), pesa unos 30 MB, codifica por CPU sin aceleración y en iPhone suele quedarse sin memoria. WebCodecs usa el chip de vídeo del iPhone y es mucho más rápido.

## Alternativas de hosting

- **Netlify:** bien tal cual; el plan gratuito sobra para una app estática de 2 MB.
- **Cloudflare Pages:** igual de sencillo y con tráfico ilimitado en el plan gratuito. Lee el mismo `public/_headers`. Comando `npm run build`, carpeta `dist`.
- **Vercel:** detecta Vite automáticamente, sin configuración.
- **GitHub Pages:** también vale, aunque sin vistas previas por pull request.

## Siguiente paso opcional: app nativa con Capacitor

Si en algún momento quieres publicarla en la App Store o saltarte los límites de Safari, el mismo código se puede envolver con [Capacitor](https://capacitorjs.com):

- Acceso al vídeo original de Fotos (HEVC/HDR sin conversión) y guardado directo en el carrete.
- Exportación en segundo plano usando AVFoundation.
- Icono y distribución por la App Store.

Requiere un Mac con Xcode y una cuenta de Apple Developer (99 $/año para la App Store; para instalarla solo en tu iPhone basta una cuenta gratuita, con reinstalación cada 7 días). Mi recomendación es empezar con la PWA en Netlify, que ya se siente como una app, y pasar a Capacitor solo si necesitas esas tres cosas.

## Arquitectura

```
src/
  engine/      motor: modelo de timeline, compositor WebGL2, shaders, audio, reproductor, exportación
  media/       importación de archivos, miniaturas, ondas de audio, efectos de sonido, subtítulos
  store/       estado del editor (zustand) con deshacer/rehacer, acciones e IndexedDB
  ui/          pantallas y paneles táctiles
public/        manifiesto PWA, service worker e iconos
```

- **Compositor (`engine/renderer.ts`, `engine/shaders.ts`):** dibuja cada fotograma en la GPU: fondo desenfocado, clip principal, transición (dos framebuffers mezclados por shader), superposiciones y textos. Los filtros, ajustes, croma y efectos son un único shader por capa.
- **Vista previa (`engine/player.ts`):** elementos `<video>` silenciados alimentan las texturas y el sonido se mezcla con Web Audio. En iOS el volumen de `<video>` es de solo lectura, y Web Audio es la única forma de controlarlo.
- **Exportación (`engine/export.ts`):** recorre la línea de tiempo fotograma a fotograma, decodifica con [Mediabunny](https://mediabunny.dev) y WebCodecs, renderiza con el mismo compositor y codifica a MP4. La mezcla de audio se hace con el mismo grafo que la vista previa, así que lo que oyes es lo que se exporta.
- **Datos:** proyectos y archivos en IndexedDB, dentro del iPhone.

Se ha usado [Concat](https://github.com/jub0t/Concat) como referencia de funciones y de experiencia de uso. No se ha copiado código: Concat es un motor nativo en Rust con licencia AGPL‑3.0 y esta app está escrita desde cero para la web.

## Licencias de terceros

- [Mediabunny](https://github.com/Vanilagy/mediabunny) (MPL‑2.0): lectura, decodificación y escritura de MP4.
- [@mediabunny/aac-encoder](https://www.npmjs.com/package/@mediabunny/aac-encoder): codificador AAC de FFmpeg compilado a WebAssembly (LGPL), cargado solo cuando el navegador no tiene uno nativo.
- [Transformers.js](https://github.com/huggingface/transformers.js) (Apache‑2.0) y modelos Whisper de OpenAI (MIT), descargados bajo demanda para los subtítulos.
- React (MIT), Zustand (MIT) y fuentes de Google Fonts (OFL).
