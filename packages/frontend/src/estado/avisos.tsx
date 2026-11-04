import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  texto: string;
  accion?: { texto: string; fn: () => void };
}
const Ctx = createContext<(texto: string, accion?: Toast['accion']) => void>(() => undefined);

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const avisar = useCallback((texto: string, accion?: Toast['accion']) => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l, { id, texto, accion }]);
    if (!accion) setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={avisar}>
      {children}
      <div className="toasts" aria-live="polite" role="status">
        {lista.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.texto}</span>
            {t.accion && (
              <button
                onClick={() => {
                  t.accion!.fn();
                  setLista((l) => l.filter((x) => x.id !== t.id));
                }}
              >
                {t.accion.texto}
              </button>
            )}
            <button aria-label="Cerrar aviso" onClick={() => setLista((l) => l.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useAvisos = () => useContext(Ctx);
