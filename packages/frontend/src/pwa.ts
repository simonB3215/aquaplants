/**
 * Registro del service worker (solo en producción). El SW cachea únicamente
 * recursos estáticos de la aplicación; nunca respuestas de /api ni credenciales.
 * No se prometen notificaciones push ni ejecución en segundo plano.
 */
export function registrarServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const avisar = () => window.dispatchEvent(new CustomEvent('aquaplants:actualizacion', { detail: reg }));
      if (reg.waiting && navigator.serviceWorker.controller) avisar();
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        nuevo?.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) avisar();
        });
      });
      let recargado = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (recargado) return;
        recargado = true;
        window.location.reload();
      });
      setInterval(() => void reg.update(), 30 * 60_000);
    } catch (e) {
      console.warn('Service worker no registrado:', e);
    }
  });
}
