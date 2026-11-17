// Points manifest.xml at a different host: node tools/set-host.js https://you.github.io/psakit
const fs = require('fs'), path = require('path');
const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https:\/\//.test(base)) { console.error('Usage: node tools/set-host.js https://your-host/path'); process.exit(1); }
const file = path.join(__dirname, '..', 'manifest.xml');
const xml = fs.readFileSync(file, 'utf8');
const hosts = new Set([...xml.matchAll(/DefaultValue="(https:\/\/[^"]+?)\/(?:assets|src|README)/g)].map((m) => m[1]));
let out = xml;
for (const h of hosts) out = out.split(`"${h}/`).join(`"${base}/`);
fs.writeFileSync(file, out);
console.log(`manifest.xml now points to ${base}`);
