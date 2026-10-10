// Smolish Video Downloader: tiny zero-dependency server (Node 18+).
// Serves index.html and streams the 1080p file from the CDN with a
// Content-Disposition header, so the browser saves it directly.
//
// Run:  node server.js        (then open http://localhost:3000)
// Port: PORT=8080 node server.js

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const CDN_HOST = 'cdn.smolish.com';

// Request the CDN file. Only follows redirects that stay on the CDN host.
function fetchFromCdn(host, p, method, hops, cb) {
  let finished = false;
  const done = (err, res) => { if (!finished) { finished = true; cb(err, res); } };

  const req = https.request(
    { host, path: p, method, headers: { 'user-agent': 'smolish-downloader' } },
    (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc && hops < 3) {
        res.resume();
        let u;
        try { u = new URL(loc, 'https://' + host + p); } catch (e) { return done(new Error('bad redirect')); }
        if (u.protocol !== 'https:' || u.hostname !== CDN_HOST) return done(new Error('redirect blocked'));
        finished = true; // hand over to the next hop
        return fetchFromCdn(u.hostname, u.pathname + u.search, method, hops + 1, cb);
      }
      done(null, res);
    }
  );
  req.on('error', done);
  req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  req.end();
  return req;
}

function text(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/dl') {
    const id = url.searchParams.get('id') || '';
    if (!/^\d{6,25}$/.test(id)) return text(res, 400, 'Invalid video id');

    const checkOnly = url.searchParams.has('check');
    const cdnPath = '/videos/' + id + '/1080p.mp4';

    const upReq = fetchFromCdn(CDN_HOST, cdnPath, checkOnly ? 'HEAD' : 'GET', 0, (err, up) => {
      if (err) return text(res, 502, 'Could not reach the CDN');
      if (up.statusCode !== 200) {
        up.resume();
        return text(res, up.statusCode === 404 || up.statusCode === 403 ? 404 : 502, 'Video not available');
      }
      if (checkOnly) { up.resume(); return text(res, 200, 'ok'); }

      const headers = {
        'content-type': 'video/mp4',
        'content-disposition': 'attachment; filename="smolish-' + id + '.mp4"',
        'cache-control': 'no-store',
      };
      if (up.headers['content-length']) headers['content-length'] = up.headers['content-length'];
      res.writeHead(200, headers);
      up.pipe(res);
      up.on('error', () => res.destroy());
      res.on('close', () => up.destroy()); // stop pulling if the user cancels
    });
    res.on('close', () => { if (upReq && !res.writableEnded) upReq.destroy(); });
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) return text(res, 500, 'index.html not found next to server.js');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  }

  text(res, 404, 'Not found');
});

server.listen(PORT, () => console.log('Smolish Video Downloader running on http://localhost:' + PORT));
