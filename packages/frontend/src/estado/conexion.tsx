import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/cliente';

/**
 * Estado de conectividad DEL CLIENTE. Se distingue (prompt §19):
 *  1. Teléfono sin Internet (navigator.onLine)
 *  3. API inaccesible → «Sin conexión con el servidor»
 * Ninguno de los dos marca las torres como desconectadas: eso solo lo decide el
 * servidor a partir de la última comunicación de cada dispositivo.
 */
export type EstadoCliente = 'en_linea' | 'sin_internet' | 'servidor_caido';
const Ctx = createContext<EstadoCliente>('en_linea');

export function ProveedorConexion({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [servidorOk, setServidorOk] = useState(true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const quitar = api.suscribir((e) => {
      if (e === 'servidor_caido') setServidorOk(false);
      if (e === 'servidor_ok') setServidorOk(true);
    });
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      quitar();
    };
  }, []);
  const estado: EstadoCliente = !online ? 'sin_internet' : servidorOk ? 'en_linea' : 'servidor_caido';
  return <Ctx.Provider value={estado}>{children}</Ctx.Provider>;
}

export const useConexion = () => useContext(Ctx);
