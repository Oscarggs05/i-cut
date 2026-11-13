// Tool definitions shared by every transport. The editor in the browser
// implements each tool (src/claude/commands.ts); the bridge only forwards
// calls, except for the tools marked `local`, which the bridge answers itself.
//
// Conventions used in every tool:
// - Times are seconds on the project timeline unless a field says "source".
// - Positions (x, y) are offsets of the center as a fraction of the canvas
//   width/height: 0 is centered, -0.5 is the left/top edge, 0.5 the right/bottom.
// - Clip ids come from get_project. Every edit is one undo step in the editor.

const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const clipId = str('Clip id from get_project.');
const clipIdOptional = str('Clip id from get_project. Defaults to the selected clip.');
const anim = (what) => ({
  description: `${what} animation, or null to remove it.`,
  anyOf: [obj({ id: str('Animation id (see list_catalog).'), duration: num('Seconds (for loops: seconds per cycle).') }, ['id']), { type: 'null' }],
});

const textStyle = {
  font: str('Font id (see list_catalog: Montserrat, Anton, Bebas Neue, Pacifico, Lobster, Permanent Marker, Playfair Display, Oswald, Caveat, Press Start 2P, Courier, Sistema).'),
  size: num('Font size in pixels on a 1080 px wide canvas (20 to 400). Default 84.'),
  color: str('Text color, #rrggbb.'),
  bold: bool('Bold.'),
  italic: bool('Italic.'),
  align: str('left, center or right.', { enum: ['left', 'center', 'right'] }),
  stroke_color: str('Outline color, #rrggbb.'),
  stroke_width: num('Outline width in pixels (0 to 30).'),
  bg_color: str('Background box color, #rrggbb.'),
  bg_opacity: num('Background box opacity, 0 to 1 (0 hides it).'),
  shadow: bool('Drop shadow.'),
  letter_spacing: num('Letter spacing in pixels (-10 to 60).'),
  uppercase: bool('Show in capitals.'),
  glow: bool('Neon glow.'),
  word_anim: str('Word-by-word animation: none, karaoke, highlight, box, pop, reveal, bounce, wave.'),
  highlight: str('Color of the highlighted (spoken) word, #rrggbb.'),
  x: num('Horizontal offset of the center, fraction of the canvas width (-0.5 to 0.5).'),
  y: num('Vertical offset of the center, fraction of the canvas height (-0.5 to 0.5). Captions sit at 0.28.'),
  scale: num('Scale factor (1 = normal).'),
  rotation: num('Degrees.'),
  opacity: num('0 to 1.'),
};

export const TOOLS = [
  // ── Connection and overview ────────────────────────────────────────────
  {
    name: 'connection_status',
    local: true,
    description: 'Tells whether the i-cut editor is connected to this server and how the user can connect it. Call this first if another tool says the editor is not connected.',
    inputSchema: obj({}),
  },
  {
    name: 'wait_for_job',
    local: true,
    description: 'Waits (up to ~45 s per call) for a long operation that an earlier tool left running (export, captions, silence removal, reverse, stabilize, waiting for the user to pick files) and returns its result. Call it again while it says it is still running.',
    inputSchema: obj({ job_id: str('The job id an earlier tool returned.') }, ['job_id']),
  },
  {
    name: 'get_project',
    description: 'Returns the open project: name, format, duration, playhead, selection, assets and every clip on each track (main, overlays, texts, audios) with ids, timeline start/end and settings. Call it before editing and after big changes. Set raw=true to also get the full project JSON.',
    inputSchema: obj({ raw: bool('Include the full project JSON.') }),
  },
  {
    name: 'list_catalog',
    description: 'Lists every preset id the editor accepts: filters, effects, transitions, animations (in/out/loop), fonts, text templates, word animations, stickers, voices, sound effects, speed curve presets, collage templates, formats, speech models and caption languages.',
    inputSchema: obj({}),
  },
  {
    name: 'get_frame',
    description: 'Renders the preview at a moment of the timeline and returns it as an image, so you can see what the video looks like. Also moves the editor playhead there.',
    inputSchema: obj({
      time: num('Seconds. Defaults to the playhead.'),
      width: num('Image width in pixels (160 to 1080). Default 540.'),
    }),
  },
  {
    name: 'get_frames',
    description: 'Returns several preview frames at once (a quick visual review of the whole edit). Give `times`, or `count` frames spread over the video.',
    inputSchema: obj({
      times: { type: 'array', items: { type: 'number' }, description: 'Seconds on the timeline.' },
      count: num('Number of evenly spaced frames when `times` is not given (1 to 12). Default 6.'),
      width: num('Width of each image (120 to 720). Default 320.'),
    }),
  },

  // ── Projects ───────────────────────────────────────────────────────────
  {
    name: 'list_projects',
    description: 'Lists the projects saved in the editor (id, name, duration, last change) and which one is open.',
    inputSchema: obj({}),
  },
  {
    name: 'create_project',
    description: 'Creates a new empty project and opens it in the editor (closing the current one; it is saved automatically).',
    inputSchema: obj({
      name: str('Project name.'),
      aspect: str('Format: original, 9:16, 16:9, 1:1, 4:5, 4:3, 3:4, 21:9. Default 9:16.'),
    }),
  },
  {
    name: 'open_project',
    description: 'Opens a saved project in the editor (the current one is saved first).',
    inputSchema: obj({ project_id: str('Project id from list_projects.') }, ['project_id']),
  },
  {
    name: 'close_project',
    description: 'Saves and closes the open project and returns to the project list.',
    inputSchema: obj({}),
  },
  {
    name: 'rename_project',
    description: 'Renames a project (the open one by default).',
    inputSchema: obj({ name: str('New name.'), project_id: str('Defaults to the open project.') }, ['name']),
  },
  {
    name: 'duplicate_project',
    description: 'Makes a copy of a saved project (the open one by default).',
    inputSchema: obj({ project_id: str('Defaults to the open project.'), name: str('Name of the copy.') }),
  },
  {
    name: 'delete_project',
    description: 'Deletes a project and its media for good. This cannot be undone: only do it when the user asked for it.',
    inputSchema: obj({ project_id: str('Project id.'), confirm: bool('Must be true.') }, ['project_id', 'confirm']),
  },
  {
    name: 'undo',
    description: 'Undoes the last edit (yours or the user\'s), like the editor\'s undo button.',
    inputSchema: obj({ steps: num('How many steps. Default 1.') }),
  },
  {
    name: 'redo',
    description: 'Redoes what undo undid.',
    inputSchema: obj({ steps: num('How many steps. Default 1.') }),
  },

  // ── Media ──────────────────────────────────────────────────────────────
  {
    name: 'import_media',
    long: true,
    description: 'Imports a video, photo or audio file into the open project and places it. Give `path` (a file on the computer running this MCP server), `url` (downloaded by this server) or `base64` + `filename`. target: main (main track, at the end or at `index`), overlay (picture-in-picture at `at`), audio (audio track at `at`), library (only import; use add_clip later).',
    inputSchema: obj({
      path: str('Absolute path of a local file.'),
      url: str('http(s) URL of a media file.'),
      base64: str('File contents in base64 (small files only).'),
      filename: str('File name with extension (required with base64, optional otherwise).'),
      target: str('main, overlay, audio or library. Default: main for video/photo, audio for audio files.', { enum: ['main', 'overlay', 'audio', 'library'] }),
      at: num('Timeline seconds where overlay/audio clips start. Default: playhead.'),
      index: num('Position on the main track (0 = first). Default: the end.'),
    }),
  },
  {
    name: 'request_files_from_user',
    long: true,
    description: 'Shows a button in the editor asking the user to choose files from their device (camera roll, Files…), then imports them. Use it when the media is on the user\'s phone or computer and you cannot reach it by path. Waits until the user picks or cancels.',
    inputSchema: obj({
      message: str('What to ask for, shown to the user (in Spanish).'),
      accept: str('video, image, audio or any. Default any.', { enum: ['video', 'image', 'audio', 'any'] }),
      multiple: bool('Allow several files. Default true.'),
      target: str('main, overlay, audio or library. Default main (audio files go to the audio track).', { enum: ['main', 'overlay', 'audio', 'library'] }),
      at: num('Timeline seconds for overlay/audio clips. Default: playhead.'),
    }),
  },
  {
    name: 'add_clip',
    description: 'Places an asset that is already in the project (see get_project assets) on a track again.',
    inputSchema: obj({
      asset_id: str('Asset id.'),
      track: str('main, overlay or audio.', { enum: ['main', 'overlay', 'audio'] }),
      index: num('Main track position. Default: end.'),
      at: num('Timeline seconds for overlay/audio. Default: playhead.'),
      in: num('Source start in seconds. Default 0.'),
      out: num('Source end in seconds (for photos: in + shown duration). Default: whole file / 3 s for photos.'),
    }, ['asset_id', 'track']),
  },
  {
    name: 'add_sound_effect',
    description: 'Adds one of the built-in sound effects (pop, ding, whoosh, boom, click, rise, laser, coin) on the audio track.',
    inputSchema: obj({ effect: str('Sound effect id.'), at: num('Timeline seconds. Default: playhead.'), volume: num('0 to 2. Default 1.') }, ['effect']),
  },

  // ── Timeline ───────────────────────────────────────────────────────────
  {
    name: 'playback',
    description: 'Moves the playhead, plays or pauses the preview in the editor.',
    inputSchema: obj({
      action: str('seek, play or pause.', { enum: ['seek', 'play', 'pause'] }),
      time: num('Seconds (for seek, or where play starts).'),
    }, ['action']),
  },
  {
    name: 'select_clip',
    description: 'Selects a clip in the editor (highlights it on the timeline and preview) or clears the selection with null.',
    inputSchema: obj({ clip_id: { type: ['string', 'null'], description: 'Clip id or null.' } }, ['clip_id']),
  },
  {
    name: 'split_clip',
    description: 'Splits a clip in two at a timeline time. Returns the ids of both halves.',
    inputSchema: obj({ clip_id: clipIdOptional, time: num('Timeline seconds where to cut. Default: playhead.') }),
  },
  {
    name: 'cut_range',
    description: 'Removes a stretch of the timeline [start, end) from the main track (splitting clips as needed) and moves texts, overlays and audio after it so they stay in sync. Good for "cut from 0:12 to 0:15".',
    inputSchema: obj({ start: num('Timeline seconds.'), end: num('Timeline seconds.') }, ['start', 'end']),
  },
  {
    name: 'delete_clip',
    description: 'Deletes a clip (video, photo, text, sticker or audio). Main-track clips after it move left.',
    inputSchema: obj({ clip_id: clipId }, ['clip_id']),
  },
  {
    name: 'duplicate_clip',
    description: 'Duplicates a clip right after itself. Returns the new id.',
    inputSchema: obj({ clip_id: clipId }, ['clip_id']),
  },
  {
    name: 'move_clip',
    description: 'Moves a clip: main-track clips change order with `index`; overlays, texts and audio move to `start` seconds.',
    inputSchema: obj({ clip_id: clipId, index: num('New main-track position (0 = first).'), start: num('New timeline start in seconds.') }, ['clip_id']),
  },
  {
    name: 'trim_clip',
    description: 'Trims a clip. Videos and audio: `in`/`out` are source seconds of the file. Photos: `duration` is how long it shows. Texts and stickers: `start`/`duration` on the timeline. You can also trim by timeline seconds with `timeline_start`/`timeline_end` (videos/audio).',
    inputSchema: obj({
      clip_id: clipId,
      in: num('Source in point (seconds of the file).'),
      out: num('Source out point (seconds of the file).'),
      duration: num('Seconds on screen (photos, texts, stickers).'),
      start: num('Timeline start (texts, stickers, overlays, audio).'),
      timeline_start: num('Keep the part of the clip from this timeline second…'),
      timeline_end: num('…to this timeline second.'),
    }, ['clip_id']),
  },

  // ── Clip settings ──────────────────────────────────────────────────────
  {
    name: 'set_speed',
    description: 'Changes playback speed of a video or audio clip: a constant `speed` (0.1 to 10), a speed curve preset (montage, hero, bullet, jump, flashIn, flashOut) or custom curve points.',
    inputSchema: obj({
      clip_id: clipId,
      speed: num('Constant speed, 0.1 to 10 (removes any curve).'),
      curve: str('Speed curve preset id, or "none" to remove the curve.'),
      curve_points: { type: 'array', items: obj({ x: num('Position in the clip, 0 to 1.'), v: num('Speed 0.1 to 10.') }, ['x', 'v']), description: 'Custom speed curve.' },
    }, ['clip_id']),
  },
  {
    name: 'set_volume',
    description: 'Volume, fades and mute of a video or audio clip. If the clip has keyframes, volume is written into a keyframe at `time`.',
    inputSchema: obj({
      clip_id: clipId,
      volume: num('0 to 2 (1 = original).'),
      fade_in: num('Seconds.'),
      fade_out: num('Seconds.'),
      muted: bool('Mute the clip (videos).'),
      time: num('Timeline seconds for the keyframe when the clip has keyframes. Default: playhead.'),
    }, ['clip_id']),
  },
  {
    name: 'set_transform',
    description: 'Position, scale, rotation, flips and opacity of a video, photo, text or sticker. fit="fit" shows the whole frame, fit="fill" covers the canvas. If the clip has keyframes, values are written into a keyframe at `time` (use add_keyframe to animate).',
    inputSchema: obj({
      clip_id: clipId,
      x: num('Center offset, fraction of the canvas width (-0.5 to 0.5).'),
      y: num('Center offset, fraction of the canvas height (-0.5 to 0.5).'),
      scale: num('1 = fits the canvas (0.1 to 5).'),
      rotation: num('Degrees.'),
      opacity: num('0 to 1.'),
      flip_h: bool('Mirror horizontally.'),
      flip_v: bool('Flip vertically.'),
      fit: str('fit or fill.', { enum: ['fit', 'fill'] }),
      reset: bool('Reset position, scale, rotation, flips and keyframes first.'),
      time: num('Timeline seconds for the keyframe when the clip has keyframes. Default: playhead.'),
    }, ['clip_id']),
  },
  {
    name: 'set_filter',
    description: 'Applies a color filter (vivid, warm, cool, cine, bw, noir, sepia, vintage, faded, rosy, film, moody, bright, teal, dream, or none) to a video or photo.',
    inputSchema: obj({
      clip_id: clipIdOptional,
      filter: str('Filter id.'),
      intensity: num('0 to 1. Default 1.'),
      apply_to_all: bool('Apply to every clip on the main track.'),
    }, ['filter']),
  },
  {
    name: 'set_adjust',
    description: 'Color adjustments of a video or photo. Values go from -100 to 100 (fade, vignette, grain and sharpen from 0 to 100); 0 is neutral.',
    inputSchema: obj({
      clip_id: clipIdOptional,
      brightness: num(''), contrast: num(''), saturation: num(''), exposure: num(''), temperature: num(''), tint: num(''),
      highlights: num(''), shadows: num(''), fade: num(''), vignette: num(''), grain: num(''), sharpen: num(''),
      reset: bool('Set every adjustment back to 0 first.'),
      apply_to_all: bool('Copy the result to every clip on the main track.'),
    }),
  },
  {
    name: 'set_effect',
    description: 'Animated visual effect on a clip or text: glitch, vhs, shake, zoom (pulse), rgb, pixel, mirror, flash, oldfilm, hue, blur, kaleido, invert, or none.',
    inputSchema: obj({ clip_id: clipId, effect: str('Effect id.'), intensity: num('0.05 to 1. Default 0.6.') }, ['clip_id', 'effect']),
  },
  {
    name: 'set_animation',
    description: 'In, out and loop animations of a clip, text or sticker. In/out: fade, zoomIn, zoomOut, slideLeft, slideRight, slideUp, slideDown, pop, spin, typewriter (texts only, in). Loop: pulse, float, wiggle, kenburns, shake. Omit a field to leave it as is.',
    inputSchema: obj({ clip_id: clipId, in: anim('Entrance'), out: anim('Exit'), loop: anim('Loop') }, ['clip_id']),
  },
  {
    name: 'set_transition',
    description: 'Transition between a main-track clip and the next one: fade, black, white, slideLeft, slideRight, slideUp, zoom, wipe, circle, blur, pixel, spin, or none.',
    inputSchema: obj({
      clip_id: str('The main-track clip BEFORE the cut.'),
      transition: str('Transition id.'),
      duration: num('Seconds (0.1 to 2). Default 0.5.'),
      apply_to_all: bool('Use the same transition on every cut.'),
    }, ['transition']),
  },
  {
    name: 'set_chroma',
    description: 'Green screen: removes a background color from a clip (usually an overlay).',
    inputSchema: obj({
      clip_id: clipId,
      enabled: bool('false removes the effect.'),
      color: str('Key color, #rrggbb. Default #00ff00.'),
      similarity: num('0 to 0.5. Default 0.12.'),
      smoothness: num('0 to 0.3. Default 0.08.'),
    }, ['clip_id']),
  },
  {
    name: 'crop_clip',
    description: 'Crops a video or photo. Give a rectangle in fractions of the source (x, y, w, h from 0 to 1), or an `aspect` like "1:1", "9:16", "16:9", "4:5" for a centered crop. `radius` rounds the corners. reset=true removes the crop.',
    inputSchema: obj({
      clip_id: clipId,
      x: num('Left edge, 0 to 1.'), y: num('Top edge, 0 to 1.'), w: num('Width, 0 to 1.'), h: num('Height, 0 to 1.'),
      aspect: str('Centered crop with this width:height ratio.'),
      radius: num('Corner rounding, 0 to 0.5 of the shorter side.'),
      reset: bool('Remove the crop.'),
    }, ['clip_id']),
  },
  {
    name: 'reverse_clip',
    long: true,
    description: 'Plays a video clip backwards (renders a reversed copy on the device, can take a while) or back forwards with reversed=false.',
    inputSchema: obj({ clip_id: clipId, reversed: bool('true = backwards (default), false = original direction.') }, ['clip_id']),
  },
  {
    name: 'stabilize_clip',
    long: true,
    description: 'Stabilizes a shaky video clip (analyzes the motion on the device). level 1 low, 2 recommended, 3 maximum, 0 off.',
    inputSchema: obj({ clip_id: clipId, level: num('0 to 3. Default 2.') }, ['clip_id']),
  },
  {
    name: 'set_voice',
    description: 'Voice changer for a clip with sound: none, chipmunk, child, deep, monster, robot, alien, echo, hall, phone, megaphone, radio, underwater.',
    inputSchema: obj({ clip_id: clipIdOptional, voice: str('Voice id.'), apply_to_all: bool('Every main-track clip.') }, ['voice']),
  },
  {
    name: 'extract_audio',
    description: 'Moves the sound of a video clip to its own audio clip and mutes the video.',
    inputSchema: obj({ clip_id: clipId }, ['clip_id']),
  },
  {
    name: 'freeze_frame',
    long: true,
    description: 'Inserts a 3 s still of the frame at `time` into the main track (splitting the clip there).',
    inputSchema: obj({ time: num('Timeline seconds. Default: playhead.') }),
  },
  {
    name: 'add_keyframe',
    description: 'Adds (or updates) a keyframe on a clip at a timeline time. Values not given keep what the clip shows at that moment. Animatable: x, y, scale, rotation, opacity (videos, photos, texts), filter (filter intensity) and volume. Add two or more keyframes to animate, e.g. scale 1 at 0 s and 1.3 at 3 s for a zoom.',
    inputSchema: obj({
      clip_id: clipId,
      time: num('Timeline seconds (inside the clip).'),
      values: obj({ x: num(''), y: num(''), scale: num(''), rotation: num(''), opacity: num(''), filter: num(''), volume: num('') }),
      ease: str('Easing towards the next keyframe: linear, smooth, in, out. Default smooth.', { enum: ['linear', 'smooth', 'in', 'out'] }),
    }, ['clip_id', 'time']),
  },
  {
    name: 'remove_keyframes',
    description: 'Removes the keyframe at `time`, or all keyframes of the clip when time is omitted.',
    inputSchema: obj({ clip_id: clipId, time: num('Timeline seconds.') }, ['clip_id']),
  },

  // ── Text ───────────────────────────────────────────────────────────────
  {
    name: 'add_text',
    description: 'Adds a text on screen. Use `template` for a ready-made animated look (karaoke, highlight, box, pop, reveal, bounce, neon, simple, tv, typewriter, cinema, wave, impact, label, retro, slide) and tweak any style field.',
    inputSchema: obj({
      text: str('The text (new lines allowed).'),
      start: num('Timeline seconds. Default: playhead.'),
      duration: num('Seconds. Default 3.'),
      template: str('Text template id.'),
      ...textStyle,
    }, ['text']),
  },
  {
    name: 'add_sticker',
    description: 'Adds an emoji or word sticker (any emoji, or LOL, WOW, OMG, NEW, SALE, LIVE).',
    inputSchema: obj({
      sticker: str('Emoji or word.'),
      start: num('Timeline seconds. Default: playhead.'),
      duration: num('Seconds. Default 3.'),
      x: num('Center offset (-0.5 to 0.5).'), y: num('Center offset (-0.5 to 0.5).'), scale: num('Default 1.'), rotation: num('Degrees.'),
    }, ['sticker']),
  },
  {
    name: 'update_text',
    description: 'Changes a text, sticker or caption: content, timing, template and any style field.',
    inputSchema: obj({
      clip_id: clipId,
      text: str('New text.'),
      start: num('Timeline seconds.'),
      duration: num('Seconds.'),
      template: str('Apply a text template first.'),
      ...textStyle,
    }, ['clip_id']),
  },

  // ── Automatic tools ────────────────────────────────────────────────────
  {
    name: 'generate_captions',
    long: true,
    description: 'Transcribes the project audio on the device (Whisper) and adds animated captions word by word. Replaces earlier automatic captions. The first time it downloads the speech model.',
    inputSchema: obj({
      language: str('spanish, english, catalan, portuguese, french, italian or german. Default spanish.'),
      model: str('base (fast), small (accurate, default on phones), medium or turbo (computers).'),
      words_per_line: num('1 to 10. Default 4.'),
      template: str('Caption template: karaoke, highlight, box, pop, reveal, bounce, neon, simple, tv. Default karaoke.'),
    }),
  },
  {
    name: 'style_captions',
    description: 'Restyles every automatic caption at once (template and/or style fields).',
    inputSchema: obj({ template: str('Caption template id.'), ...textStyle }),
  },
  {
    name: 'remove_silences',
    long: true,
    description: 'Cuts pauses (and optionally filler sounds like "eh", "mmm") out of the speech on the main track, keeping texts, overlays and music in sync.',
    inputSchema: obj({
      min_pause: num('Shortest pause to cut, seconds (0.2 to 2). Default 0.5.'),
      margin: num('Silence kept around speech, seconds (0 to 0.4). Default 0.12.'),
      fillers: bool('Also cut filler sounds (uses speech recognition). Default false.'),
      filler_words: bool('With fillers: also cut words like "o sea", "bueno", "pues".'),
      language: str('Language for filler detection. Default spanish.'),
      model: str('Speech model for filler detection.'),
    }),
  },

  // ── Canvas and layout ──────────────────────────────────────────────────
  {
    name: 'set_canvas',
    description: 'Project format and background shown where the video does not fill the canvas.',
    inputSchema: obj({
      aspect: str('original, 9:16, 16:9, 1:1, 4:5, 4:3, 3:4 or 21:9.'),
      background: str('blur or color.', { enum: ['blur', 'color'] }),
      color: str('Background color, #rrggbb.'),
      blur: num('Background blur 0 to 1.'),
    }),
  },
  {
    name: 'create_collage',
    long: true,
    description: 'Builds a collage (several videos/photos on screen at once) from a template: v2, h2, v3, h3, top1b2, left1r2, g4, top1b3, v4, mosaic5, g6, g9, pip. Use the main-track clips starting at `from_time` (default), or assets already in the project with `asset_ids`.',
    inputSchema: obj({
      template: str('Collage template id.'),
      asset_ids: { type: 'array', items: { type: 'string' }, description: 'Assets to place, in cell order (added at the end of the timeline).' },
      from_time: num('With project clips: timeline second of the first clip to use. Default: playhead.'),
      aspect: str('Canvas format. Default: current (9:16 if original).'),
      gap: num('Spacing between cells, fraction of the shorter side (0 to 0.08). Default 0.012.'),
      radius: num('Corner rounding of each cell (0 to 0.5). Default 0.'),
      color: str('Color between cells, #rrggbb. Default white.'),
    }, ['template']),
  },
  {
    name: 'update_collage',
    description: 'Changes the template, format, spacing, corners or color of an existing collage (collage id from get_project).',
    inputSchema: obj({
      collage_id: str('Collage id.'),
      template: str('Collage template id.'), aspect: str('Format.'), gap: num('0 to 0.08.'), radius: num('0 to 0.5.'), color: str('#rrggbb.'),
    }, ['collage_id']),
  },

  // ── Export ─────────────────────────────────────────────────────────────
  {
    name: 'export_video',
    long: true,
    description: 'Exports the project to an MP4 on the device (hardware encoding). The user gets buttons to save/share it, and when `save_to` is given (or by default when this server runs on a computer) a copy is written there. Can take a while: use wait_for_job if it returns a job id.',
    inputSchema: obj({
      resolution: num('Short side in pixels: 480, 720, 1080, 1440 or 2160. Default 1080.'),
      fps: num('24, 25, 30, 50 or 60. Default 30.'),
      quality: str('low, medium or high. Default high.', { enum: ['low', 'medium', 'high'] }),
      save_to: str('File or folder on the computer running this server. Default ~/Movies/i-cut (or ~/Videos/i-cut). Use "none" to skip saving a copy.'),
    }),
  },
];

/** Tools the bridge answers without the editor. */
export const LOCAL_TOOLS = new Set(TOOLS.filter((t) => t.local).map((t) => t.name));
