import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { Modal } from '../componentes/ui';

afterEach(cleanup);

/** El fondo del modal debe cubrir toda la pantalla aunque se abra dentro de una tarjeta con backdrop-filter. */
test('el modal se monta en <body>, fuera de la tarjeta que lo abre', () => {
  render(
    <section className="tarjeta vidrio" data-testid="tarjeta">
      <Modal titulo="Resolver alerta" abierto onCerrar={() => undefined}>
        <p>contenido</p>
      </Modal>
    </section>,
  );
  const dialogo = screen.getByRole('dialog', { name: 'Resolver alerta' });
  expect(screen.getByTestId('tarjeta').contains(dialogo)).toBe(false);
  expect(dialogo.parentElement?.className).toBe('modal-fondo');
  expect(dialogo.parentElement?.parentElement).toBe(document.body);
});
