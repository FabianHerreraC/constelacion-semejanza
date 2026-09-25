import fs from 'fs';
const [,, src, out] = process.argv;
const lines = fs.readFileSync(src, 'utf8').trim().split(/\r?\n/).slice(1);
const rows = lines.map(l => {
  const c = l.split(',');
  // nombre could contain commas: take last 7 as values, 4 fixed prefix
  const v = c.slice(-7).map(Number);
  const hora = c[c.length - 8];
  const nombre = c.slice(2, c.length - 8).join(',').trim();
  return { a: Number(c[1]), n: nombre, h: hora, v };
});
fs.writeFileSync(out, '// Generado desde el CSV de Supabase (ensayo). No editar a mano.\nexport const DATA = ' + JSON.stringify(rows) + ';\n');
console.log(rows.length, rows[0]);
