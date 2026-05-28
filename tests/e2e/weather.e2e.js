// 运行：(后端已起在 :3000) 然后 `node tests/e2e/weather.e2e.js`
const http = require('http');

function call(path, body) {
  const data = JSON.stringify(body ?? {});
  const opts = {
    method: 'POST',
    hostname: 'localhost',
    port: 3000,
    path: '/api' + path,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, body: JSON.parse(txt) });
        } catch {
          resolve({ status: res.statusCode, body: txt });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error('   ❌ ' + msg);
    process.exitCode = 1;
  } else {
    console.log('   ✔  ' + msg);
  }
}

(async () => {
  console.log('① POST /weather/index');
  const idx = await call('/weather/index', { lat: 32.0603, lng: 118.7969 });
  assert(idx.status === 200, 'HTTP 200');
  assert(idx.body.code === 200, 'code=200');
  assert(idx.body.data.score >= 0 && idx.body.data.score <= 100, 'score 0-100');
  assert(typeof idx.body.data.current.weather === 'string', 'current.weather exists');

  console.log('\n② POST /weather/current');
  const cur = await call('/weather/current', { lat: 32.0603, lng: 118.7969 });
  assert(cur.body.code === 200, 'code=200');
  assert(typeof cur.body.data.temperature === 'number', 'temperature number');
  assert(cur.body.data.source === 'mock', 'source=mock');

  console.log('\n③ POST /weather/index invalid lat');
  const bad = await call('/weather/index', { lat: 100, lng: 118.7969 });
  assert(bad.body.code === 400, 'invalid lat → 400');

  console.log('\n✅ weather e2e 跑完');
})();
