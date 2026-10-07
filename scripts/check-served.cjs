// Trava contra a classe de bug que ja derrubou todos os botoes 1x:
// escapes que o TS interpreta dentro do template HTML e quebram o JS servido.
// Uso: npm run check:served
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "index.ts"), "utf8");
const problems = [];
// '\n' com aspas simples dentro do template vira quebra de linha real no HTML servido
for (const m of src.matchAll(/'\s*\\n\s*'/g)) problems.push("single-quoted \\n em index " + m.index);
// \' vira ' no HTML servido e quebra strings JS
for (const m of src.matchAll(/\\'/g)) problems.push("\\' em index " + m.index);
for (const m of src.matchAll(/\\"/g)) problems.push('\\" em index (vira " no HTML e quebra strings JS) ' + m.index);
if (problems.length) {
  console.log("SERVED-JS RISCO:");
  problems.slice(0, 10).forEach((p) => console.log(" - " + p));
  process.exit(1);
}
console.log("served-js ok");
