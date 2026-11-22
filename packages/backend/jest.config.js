/** Jest + ts-jest en modo ESM. Las pruebas de integración usan PostgreSQL y MongoDB reales. */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151001] } }] },
  testTimeout: 30000,
  // En GitHub Actions, cada prueba fallida queda además como anotación del job (visible sin abrir el registro).
  reporters: ['default', ['<rootDir>/test/reporteJson.cjs', {}], ...(process.env.GITHUB_ACTIONS ? [['github-actions', { silent: false }]] : [])],
};
