import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Block Safari's page zoom gestures; the editor has its own pinch handling.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

// Installed on the Home Screen with a translucent status bar, iOS can report
// a viewport shorter than the screen by the status bar's height, which leaves
// a black strip under the app. Size it to the physical screen instead.
// Desktop installs (Chrome, Edge) open in a resizable window, where sizing to
// the screen would push the bottom of the editor out of view.
const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || matchMedia('(display-mode: standalone)').matches;
const desktopWindow = matchMedia('(hover: hover) and (pointer: fine)').matches && !/iPhone|iPad|iPod/.test(navigator.userAgent);
if (standalone && !desktopWindow) {
  const fit = () => {
    const portrait = window.innerHeight >= window.innerWidth;
    const screenH = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    document.documentElement.style.setProperty('--app-h', `${Math.max(window.innerHeight, screenH)}px`);
  };
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
}

// Keep bottom sheets above the iOS keyboard instead of letting Safari pan
// the whole editor.
const vv = window.visualViewport;
if (vv) {
  const onVV = () => {
    const kb = Math.max(0, (document.body.clientHeight || window.innerHeight) - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${kb > 80 ? kb : 0}px`);
    if (window.scrollY) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', onVV);
  vv.addEventListener('scroll', onVV);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is optional */ });
  });
}
