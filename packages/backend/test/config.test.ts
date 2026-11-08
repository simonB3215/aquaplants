import { cargarConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://x@localhost/x',
  PAYLOADS_DATABASE_URL: 'postgres://x@localhost/y',
  JWT_SECRET: 'x'.repeat(32),
};

describe('TRUST_PROXY (D-30: Netlify → Render son 2 proxies)', () => {
  test.each([
    [undefined, 0],
    ['false', 0],
    ['true', 1],
    ['2', 2],
  ])('%s → %d', (valor, esperado) => {
    expect(cargarConfig({ ...base, ...(valor === undefined ? {} : { TRUST_PROXY: valor }) }).TRUST_PROXY).toBe(esperado);
  });

  test('rechaza valores no numéricos', () => {
    expect(() => cargarConfig({ ...base, TRUST_PROXY: 'loopback' })).toThrow(/TRUST_PROXY/);
  });
});
