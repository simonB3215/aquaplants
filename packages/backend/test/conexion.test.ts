import { resolverCertificado } from '../src/conexion.js';

describe('resolverCertificado (sslrootcert relativo a la raíz del repositorio)', () => {
  const base = 'postgresql://u:c@h:5432/postgres?sslmode=verify-full&sslrootcert=';
  test('ruta relativa → absoluta desde la raíz', () => {
    expect(resolverCertificado(`${base}certificados/supabase-ca.crt`, '/repo')).toMatch(/sslrootcert=([A-Za-z]:)?\/repo\/certificados\/supabase-ca\.crt$/);
  });
  test('rutas absolutas y URLs sin certificado no cambian', () => {
    expect(resolverCertificado(`${base}D:/x/ca.crt`, '/repo')).toBe(`${base}D:/x/ca.crt`);
    expect(resolverCertificado(`${base}/etc/secrets/ca.crt`, '/repo')).toBe(`${base}/etc/secrets/ca.crt`);
    expect(resolverCertificado('postgresql://u:c@h/db?sslmode=require', '/repo')).toBe('postgresql://u:c@h/db?sslmode=require');
    expect(resolverCertificado(undefined)).toBeUndefined();
  });
  test('la raíz por defecto contiene el certificado del repositorio', async () => {
    const { existsSync } = await import('node:fs');
    const url = resolverCertificado(`${base}certificados/supabase-ca.crt`);
    expect(existsSync(url.split('sslrootcert=')[1])).toBe(true);
  });
});
