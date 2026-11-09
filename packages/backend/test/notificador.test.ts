import { destino, ResendNotificador } from '../src/adapters/notificador.js';

const m = { destinatarios: ['supervisor@aquaplants.cl', 'encargado@aquaplants.cl'], asunto: 'Alerta CRÍTICA', texto: 'Valor fuera de rango' };

describe('Notificador SMTP: destinatarios', () => {
  test('sin NOTIFICACIONES_SOLO_A usa los destinatarios originales', () => {
    expect(destino({ NOTIFICACIONES_SOLO_A: undefined }, m)).toEqual({ to: m.destinatarios, subject: m.asunto, text: m.texto });
    expect(destino({ NOTIFICACIONES_SOLO_A: '  ' }, m).to).toEqual(m.destinatarios);
  });

  test('con NOTIFICACIONES_SOLO_A envía únicamente a esa dirección', () => {
    const d = destino({ NOTIFICACIONES_SOLO_A: 'demo@example.com' }, m);
    expect(d.to).toEqual(['demo@example.com']);
    expect(d.subject).toBe('[DEMO] Alerta CRÍTICA');
    expect(d.text).toContain('supervisor@aquaplants.cl');
  });
});

describe('Notificador HTTP (Resend)', () => {
  const cfg = { RESEND_API_KEY: 're_prueba', RESEND_FROM: 'AquaPlants <onboarding@resend.dev>', NOTIFICACIONES_SOLO_A: 'demo@example.com' };

  test('envía por HTTPS con la clave en la cabecera y respeta NOTIFICACIONES_SOLO_A', async () => {
    const llamadas: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return new Response('{"id":"x"}', { status: 200 });
    }) as unknown as typeof fetch;
    await new ResendNotificador(cfg, http).enviar(m);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe('https://api.resend.com/emails');
    expect((llamadas[0].init.headers as Record<string, string>).authorization).toBe('Bearer re_prueba');
    const cuerpo = JSON.parse(String(llamadas[0].init.body));
    expect(cuerpo).toMatchObject({ from: cfg.RESEND_FROM, to: ['demo@example.com'], subject: '[DEMO] Alerta CRÍTICA' });
    expect(cuerpo.text).toContain('supervisor@aquaplants.cl');
  });

  test('si Resend rechaza, lanza error (la alerta queda pendiente/fallida, nunca «enviada»)', async () => {
    const http = (async () => new Response('{"message":"API key is invalid"}', { status: 401 })) as unknown as typeof fetch;
    await expect(new ResendNotificador(cfg, http).enviar(m)).rejects.toThrow(/401.*API key is invalid/);
  });
});
