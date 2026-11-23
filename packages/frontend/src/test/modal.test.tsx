import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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

/** Defecto reportado en la revisión del CRUD: al escribir un número el foco saltaba a la «X». */
function FormularioDePrueba() {
  const [valor, setValor] = useState('');
  return (
    <Modal titulo="Nueva especie" abierto onCerrar={() => setValor('')}>
      <label>
        pH mín.
        <input value={valor} onChange={(e) => setValor(e.target.value)} />
      </label>
    </Modal>
  );
}

test('el foco inicial va al primer campo y se queda ahí al escribir', () => {
  render(<FormularioDePrueba />);
  const campo = screen.getByLabelText('pH mín.');
  expect(document.activeElement).toBe(campo);
  fireEvent.change(campo, { target: { value: '5' } });
  fireEvent.change(campo, { target: { value: '5,6' } });
  expect((campo as HTMLInputElement).value).toBe('5,6');
  expect(document.activeElement).toBe(campo);
});

test('Escape cierra con la función más reciente', () => {
  let cerrado = 0;
  const { rerender } = render(<Modal titulo="A" abierto onCerrar={() => (cerrado = 1)}><input /></Modal>);
  rerender(<Modal titulo="A" abierto onCerrar={() => (cerrado = 2)}><input /></Modal>);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(cerrado).toBe(2);
});
