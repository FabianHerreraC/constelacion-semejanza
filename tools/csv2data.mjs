// Convierte el CSV exportado de Supabase en data.js.
//   node tools/csv2data.mjs <csv> data.js [--desde AAAA-MM-DD]
// Lee las columnas por nombre. Descarta las filas con visible=false y, con --desde,
// las anteriores a esa fecha (las pruebas de montaje).
import fs from 'fs';

const args = process.argv.slice(2);
const flag = args.indexOf('--desde');
const desde = flag >= 0 ? args.splice(flag, 2)[1] : null;
const [src, out] = args;
const KEYS = ['semejanza', 'inteligencia_humana', 'existencia', 'cuerpo', 'creacion_o_descubrimiento', 'pertenencia', 'datos'];

// CSV mínimo con comillas (un nombre puede traer comas)
function parse(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = ''; if (row.some(x => x !== '')) rows.push(row); row = [];
    } else f += c;
  }
  row.push(f); if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

const [head, ...body] = parse(fs.readFileSync(src, 'utf8'));
const col = name => head.indexOf(name);
for (const k of ['aparicion', 'nombre', 'hora', ...KEYS]) if (col(k) < 0) throw new Error(`Falta la columna ${k}`);

let hidden = 0, early = 0;
const rows = [];
for (const r of body) {
  if (col('visible') >= 0 && r[col('visible')] === 'false') { hidden++; continue; }
  if (desde && r[col('hora')] < desde) { early++; continue; }
  rows.push({ a: Number(r[col('aparicion')]), n: r[col('nombre')].trim(), h: r[col('hora')], v: KEYS.map(k => Number(r[col(k)])) });
}
fs.writeFileSync(out, '// Generado desde el CSV de Supabase. No editar a mano: node tools/csv2data.mjs\nexport const DATA = ' + JSON.stringify(rows) + ';\n');
console.log(`${rows.length} respuestas (descartadas: ${hidden} ocultas, ${early} anteriores a ${desde ?? '—'})`);
