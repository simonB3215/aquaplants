// Reporter mínimo: guarda la evidencia de ejecución en docs/evidencias/pruebas-backend.json
const fs = require('node:fs');
const path = require('node:path');

class ReporteJson {
  onRunComplete(_ctx, res) {
    const salida = path.resolve(__dirname, '../../../docs/evidencias/pruebas-backend.json');
    fs.mkdirSync(path.dirname(salida), { recursive: true });
    const casos = res.testResults.flatMap((f) =>
      f.testResults.map((t) => ({ archivo: path.basename(f.testFilePath), suite: t.ancestorTitles.join(' › '), prueba: t.title, estado: t.status, ms: t.duration })),
    );
    fs.writeFileSync(
      salida,
      JSON.stringify(
        { ejecutado_en: new Date().toISOString(), node: process.version, total: res.numTotalTests, aprobadas: res.numPassedTests, fallidas: res.numFailedTests, casos },
        null,
        2,
      ),
    );
  }
}
module.exports = ReporteJson;
