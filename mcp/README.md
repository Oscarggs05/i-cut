# i-cut MCP: que Claude edite tus vídeos en directo

Este servidor [MCP](https://modelcontextprotocol.io) deja que Claude use todas las funciones de i-cut sobre el proyecto que tienes abierto. Claude no trabaja a ciegas en otro sitio: cada cosa que hace (un corte, un texto, un filtro, un keyframe…) se aplica en tu editor y la ves en pantalla al momento, con un aviso arriba que dice qué está haciendo. Todo queda en el historial, así que puedes deshacer cualquier paso con el botón de siempre.

```
Claude ──MCP──▶ servidor i-cut-mcp (tu ordenador) ──WebSocket──▶ i-cut abierto en el navegador
```

## Qué puede hacer Claude

54 herramientas que cubren el editor entero:

| Área | Herramientas |
| --- | --- |
| Ver | `get_project`, `get_frame`, `get_frames` (Claude mira fotogramas del vídeo), `list_catalog` |
| Proyectos | `list_projects`, `create_project`, `open_project`, `close_project`, `rename_project`, `duplicate_project`, `delete_project`, `undo`, `redo` |
| Archivos | `import_media` (ruta, URL o base64), `request_files_from_user` (te pide que elijas archivos del móvil o del ordenador), `add_clip`, `add_sound_effect` |
| Línea de tiempo | `playback`, `select_clip`, `split_clip`, `cut_range`, `delete_clip`, `duplicate_clip`, `move_clip`, `trim_clip` |
| Clips | `set_speed` (velocidad y curvas), `set_volume`, `set_transform`, `set_filter`, `set_adjust`, `set_effect`, `set_animation`, `set_transition`, `set_chroma`, `crop_clip`, `reverse_clip`, `stabilize_clip`, `set_voice`, `extract_audio`, `freeze_frame`, `add_keyframe`, `remove_keyframes` |
| Texto | `add_text` (con plantillas animadas), `add_sticker`, `update_text` |
| Automático | `generate_captions` (subtítulos karaoke con Whisper), `style_captions`, `remove_silences` (silencios y muletillas) |
| Lienzo | `set_canvas` (formato y fondo), `create_collage`, `update_collage` |
| Exportar | `export_video`: exporta en el dispositivo, te muestra los botones para guardar o compartir y deja una copia en tu ordenador |

Los procesos largos (exportar, subtítulos, silencios, invertir, estabilizar) siguen su curso en el editor aunque tarden; Claude espera el resultado con `wait_for_job`.

## Instalación (una vez)

Necesitas [Node.js](https://nodejs.org) 18 o superior.

```bash
git clone https://github.com/Oscarggs05/i-cut.git
cd i-cut/mcp
npm install
```

### Claude Desktop

Abre **Ajustes › Desarrollador › Editar configuración** (el archivo `claude_desktop_config.json`) y añade:

```json
{
  "mcpServers": {
    "i-cut": {
      "command": "node",
      "args": ["/ruta/completa/a/i-cut/mcp/server.mjs"]
    }
  }
}
```

En Windows la ruta va con barras dobles, por ejemplo `"C:\\Users\\oscar\\i-cut\\mcp\\server.mjs"`. Reinicia Claude Desktop.

### Claude Code

```bash
claude mcp add i-cut -- node /ruta/completa/a/i-cut/mcp/server.mjs
```

## Conectar el editor

1. Abre [i-cut.vercel.app](https://i-cut.vercel.app) en el mismo ordenador (Chrome o Edge).
2. Pulsa el botón **Claude** (arriba a la derecha) y luego **Conectar**. La dirección por defecto, `ws://localhost:7333/bridge`, es la buena.
3. Si el navegador pregunta si la web puede acceder a otros dispositivos o apps de tu red, pulsa **Permitir**: es la conexión con el servidor de tu ordenador.
4. El punto del botón se pone verde. Pídele a Claude lo que quieras, por ejemplo:
   - «Importa los vídeos de ~/Desktop/viaje, quita los silencios y pon subtítulos estilo karaoke».
   - «Haz un collage 2×2 con los cuatro primeros clips y exporta en 1080p».
   - «Mira el vídeo y sugiere dónde cortar; luego hazlo».

La próxima vez i-cut se reconecta solo. Si Claude dice que el editor no está conectado, él mismo te dará el enlace para abrirlo.

Los vídeos que exporta Claude se guardan también en `~/Movies/i-cut` (Mac) o `~/Videos/i-cut` (Windows/Linux). Puedes cambiar la carpeta con `--save-dir`.

## Desde el iPhone o claude.ai (modo HTTP)

Para usar el editor del iPhone, o conectar el servidor como conector personalizado en claude.ai (web, app de escritorio o app del iPhone), el servidor tiene que ser accesible por https. Lo más sencillo es un túnel gratuito de Cloudflare:

```bash
# Terminal 1: el túnel (te da una URL https://algo.trycloudflare.com)
cloudflared tunnel --url http://localhost:7333

# Terminal 2: el servidor en modo HTTP con esa URL
node server.mjs --http --public-url https://algo.trycloudflare.com
```

El servidor imprime dos cosas:

- **La URL del conector MCP** (`https://algo.trycloudflare.com/mcp/<token>`). En claude.ai ve a **Ajustes › Conectores › Añadir conector personalizado** y pégala.
- **El enlace para abrir el editor ya conectado**. Ábrelo en el iPhone (o en cualquier navegador): i-cut se conecta solo.

El token va en las dos URL y protege el acceso: no las compartas. Se guarda en `~/.i-cut-mcp.json`; bórralo para generar uno nuevo. La URL de `trycloudflare.com` cambia cada vez que arrancas el túnel, así que tendrás que actualizar el conector; con un túnel con nombre de Cloudflare (o ngrok con dominio fijo) la URL se mantiene.

## Opciones

```
node server.mjs [--http] [--port 7333] [--host 127.0.0.1] [--public-url URL]
                [--app https://i-cut.vercel.app] [--origins URL,URL] [--save-dir DIR]
```

- `--app`: dónde está i-cut, si usas tu propio despliegue.
- `--origins`: otras direcciones de i-cut que pueden conectarse (por ejemplo una vista previa de Vercel). Por defecto se aceptan `https://i-cut.vercel.app` y cualquier `localhost`.
- Todas las opciones también valen como variables de entorno: `ICUT_PORT`, `ICUT_PUBLIC_URL`, `ICUT_SAVE_DIR`…

## Seguridad

- Por defecto el servidor solo escucha en tu ordenador (`127.0.0.1`).
- Solo acepta el editor si la página es i-cut (comprueba el origen) y, si la conexión viene de fuera de tu ordenador, si trae el token.
- Los archivos que importa Claude viajan del servidor a tu navegador con un enlace de un solo uso. Nada sale de tus dispositivos salvo lo que pase por el túnel si lo activas.

## Cómo funciona (para desarrolladores)

- `tools.mjs`: el esquema de cada herramienta que ve Claude.
- `server.mjs`: el servidor MCP (stdio o HTTP), el puente WebSocket con el editor, la transferencia de archivos y los trabajos largos. Si Claude Desktop arranca dos copias, la segunda reenvía las llamadas a la primera.
- `../src/claude/`: el lado del editor. `bridge.ts` mantiene la conexión, `commands.ts` implementa cada herramienta con las mismas acciones que los botones (por eso todo se ve en directo y se puede deshacer) y `ClaudeUI.tsx` dibuja el botón, el panel y el aviso de actividad.

Para añadir una herramienta: defínela en `tools.mjs` y añade su comando con el mismo nombre en `src/claude/commands.ts`.
