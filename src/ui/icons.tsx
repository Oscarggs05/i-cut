const P: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  close: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  scissors: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
  speed: 'M12 21a9 9 0 119-9M12 12l5-3M3 12h2M12 3v2M19 12h2',
  volume: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14',
  mute: 'M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6z',
  filter: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v18M3 12h18',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z',
  sticker: 'M12 2a10 10 0 1010 10h-6a4 4 0 01-4-4zM15.5 2.5l6 6M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  layers: 'M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
  crop: 'M6 2v14a2 2 0 002 2h14M18 22V8a2 2 0 00-2-2H2',
  aspect: 'M3 5h18v14H3zM7 9v6M17 9v6',
  bg: 'M3 3h18v18H3zM3 15l5-5 4 4 3-3 6 6',
  anim: 'M5 12h3l3-8 4 16 3-8h3',
  rotate: 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5',
  flipH: 'M12 3v18M16 7l4 5-4 5zM8 7l-4 5 4 5z',
  flipV: 'M3 12h18M7 8l5-4 5 4zM7 16l5 4 5-4z',
  opacity: 'M12 2.7l5.7 5.6a8 8 0 11-11.4 0z',
  freeze: 'M12 2v20M2 12h20M5 5l14 14M19 5L5 19',
  mic: 'M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v3',
  extract: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  palette: 'M12 22a10 10 0 110-20c5.5 0 10 4 10 9a5 5 0 01-5 5h-2a2 2 0 00-1 3.7A2 2 0 0112 22zM7.5 10.5h.01M12 7.5h.01M16.5 10.5h.01',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  transition: 'M4 4h7v16H4zM13 4h7v16h-7zM9 12h6',
  export: 'M12 15V3M7 8l5-5 5 5M5 14v6h14v-6',
  share: 'M4 12v8h16v-8M16 6l-4-4-4 4M12 2v13',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h.01M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5',
  fullscreen: 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6',
  reset: 'M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8M3 3v5h5',
  video: 'M23 7l-7 5 7 5zM1 5h15v14H1z',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21',
};

export function Icon({ name, size = 24, fill = false }: { name: keyof typeof P | string; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={fill ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? ''} />
    </svg>
  );
}
