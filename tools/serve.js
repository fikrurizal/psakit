// Serves the add-in over HTTPS on port 3000, which is what the manifest points to by default.
// Needs Microsoft's locally trusted certificate: run "npm run certs" once first.
const https = require('https'), fs = require('fs'), path = require('path'), os = require('os');
const root = path.join(__dirname, '..');
const certDir = path.join(os.homedir(), '.office-addin-dev-certs');
let tls;
try {
  tls = { key: fs.readFileSync(path.join(certDir, 'localhost.key')), cert: fs.readFileSync(path.join(certDir, 'localhost.crt')) };
} catch (e) {
  console.error('No certificate found. Run "npm run certs" once, then "npm start" again.');
  process.exit(1);
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.md': 'text/plain', '.xml': 'application/xml', '.svg': 'image/svg+xml' };
https.createServer(tls, (req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '');
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(file).pipe(res);
}).listen(3000, () => console.log('Serving on https://localhost:3000. Sideload manifest.xml in Excel. Press Ctrl+C to stop.'));
