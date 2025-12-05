const http = require('http');
const { promises: fs } = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function resolveFile(requestPath) {
  let normalized = path.normalize(requestPath).replace(/^([.]{2}[\\/])+/g, '');
  normalized = normalized.replace(/^([/\\\\])+/g, '');

  if (!normalized) {
    return path.resolve(ROOT, 'sistema_de_simulacao_zenith.html');
  }

  if (normalized === 'mobile' || normalized === 'mobile.html') {
    return path.resolve(ROOT, 'sistema_de_simulacao_zenith_mobile.html');
  }

  return path.resolve(ROOT, normalized);
}

async function sendFile(res, filePath) {
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado');
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erro interno no servidor');
    }
  }
}

const server = http.createServer(async (req, res) => {
  const safePath = decodeURI(req.url.split('?')[0]);
  const filePath = resolveFile(safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acesso negado');
    return;
  }

  await sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
