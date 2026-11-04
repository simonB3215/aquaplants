import { destino } from '../src/adapters/notificador.js';

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
