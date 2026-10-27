import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Block Safari's page zoom gestures; the editor has its own pinch handling.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

// Keep bottom sheets above the iOS keyboard instead of letting Safari pan
// the whole editor.
const vv = window.visualViewport;
if (vv) {
  const onVV = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
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
