const fs = require("fs");
const s = fs.readFileSync("./src/index.ts", "utf8");
const startAnchor = "function filter(m,el)";
const endAnchor = "cd('cd2','2027-02-13T10:00:00-03:00');";
const a = s.indexOf(startAnchor);
const b = s.indexOf(endAnchor, a);
if (a < 0 || b < 0) { console.log("anchors not found", a, b); process.exit(1); }
fs.writeFileSync("./dashcheck.js", s.slice(a, b + endAnchor.length));
console.log("extracted dashboard script");
