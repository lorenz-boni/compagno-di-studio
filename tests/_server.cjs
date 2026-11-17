// Server statico minimo per i test (ignora i parametri ?v=...).
const http = require('http'), fs = require('fs'), path = require('path');
module.exports = function serve(root, port) {
  return http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const p = path.join(root, u === '/' ? 'index.html' : u);
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'text/plain' });
    fs.createReadStream(p).pipe(res);
  }).listen(port);
};
