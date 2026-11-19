# Cómo contribuir a i-cut

¡Gracias por querer ayudar! i-cut es un editor de vídeo gratuito que funciona entero en el dispositivo, y cualquier mejora cuenta: arreglar un fallo, proponer una idea, mejorar la documentación o traducirla.

*English speakers: issues and pull requests in English are welcome. The app UI is in Spanish for now.*

## Antes de empezar

- **¿Has encontrado un fallo?** Abre una [incidencia de error](https://github.com/Oscarggs05/i-cut/issues/new?template=bug_report.yml). Indica tu dispositivo, sistema y navegador: muchos fallos solo ocurren en Safari para iPhone.
- **¿Tienes una idea?** Abre una [propuesta](https://github.com/Oscarggs05/i-cut/issues/new?template=feature_request.yml) o coméntala en [Discusiones](https://github.com/Oscarggs05/i-cut/discussions).
- **¿Buscas por dónde empezar?** Mira las incidencias con la etiqueta [`good first issue`](https://github.com/Oscarggs05/i-cut/labels/good%20first%20issue). Comenta en la que quieras para que nadie más la coja a la vez.
- Para cambios grandes, abre antes una incidencia y comenta el enfoque. Así no pierdes trabajo si la idea no encaja.

## Preparar el entorno

Necesitas [Node 22](https://nodejs.org) (está fijado en `.nvmrc`).

```bash
git clone https://github.com/Oscarggs05/i-cut.git && cd i-cut && npm install && npm run dev
```

`npm run dev` abre un servidor local. Para probar en el iPhone, abre la URL «Network» desde la misma Wi‑Fi; la cámara y el micrófono exigen HTTPS, así que para eso usa un túnel (por ejemplo `cloudflared tunnel --url http://localhost:5173`). Encontrarás más detalles técnicos en [DEVELOPING.md](DEVELOPING.md).

## Cómo está organizado

| Carpeta | Qué contiene |
| --- | --- |
| `src/ui` | Pantallas y paneles de React (editor, línea de tiempo, hojas de herramientas) |
| `src/engine` | Motor: renderizado WebGL2, reproducción, exportación con WebCodecs, audio, keyframes |
| `src/media` | Importación, subtítulos con Whisper, estabilización, limpieza de silencios |
| `src/store` | Estado (zustand), acciones del editor y guardado en IndexedDB |
| `src/claude` | Lado del editor del servidor MCP para Claude |
| `mcp` | Servidor MCP en Node ([mcp/README.md](mcp/README.md)) |

## Reglas del proyecto

- **Todo se procesa en el dispositivo.** No añadas servidores, analíticas ni llamadas que suban vídeos o datos del usuario.
- **El iPhone es lo primero.** El diseño de escritorio vive dentro de la media query de escritorio al final de `src/styles.css`; un cambio para PC no debe alterar cómo se ve en el móvil.
- **Textos de la interfaz en español**, con un tono claro y cercano.
- **Sin dependencias pesadas** si se puede evitar: la app pesa unos 2 MB y se usa con datos móviles.

## Enviar un pull request

1. Haz un fork y crea una rama a partir de `main`.
2. Haz tus cambios y comprueba que todo compila:
   ```bash
   npm run typecheck && npm run build
   ```
3. Pruébalo a mano en un navegador. Si tocas la interfaz, añade capturas de antes y después al pull request, a ser posible en tamaño iPhone y en PC.
4. Abre el pull request contra `main` y rellena la plantilla. La integración continua (GitHub Actions) comprueba los tipos y la compilación en cada pull request.
5. Cada cambio que entra en `main` se publica automáticamente en https://i-cut.vercel.app.

Si tu cambio es visible para el usuario, añade una línea en la sección «Sin publicar» del [CHANGELOG](CHANGELOG.md).

## Licencia

Al contribuir aceptas que tu aportación se publique bajo la [licencia MIT](LICENSE) del proyecto.
