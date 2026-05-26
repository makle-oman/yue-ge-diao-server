// 一次性 e2e 跑通 /common/upload 接口 + 静态文件回读；输出每一步的简短摘要
// 前置：后端已 pnpm start:dev 起在 3000 端口
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000/api';
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sample.png');
const FIXTURE_BYTES = fs.readFileSync(FIXTURE_PATH);

/** JSON POST，复用 spots/catches e2e 同款 */
function call(p, body, token) {
  const data = JSON.stringify(body ?? {});
  const opts = {
    method: 'POST',
    hostname: 'localhost',
    port: 3000,
    path: '/api' + p,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

/**
 * multipart/form-data POST。
 * @param fields - 普通字段（暂未用）
 * @param fileField - 文件字段名（与 controller 里 @UseInterceptors(FileInterceptor('file')) 对齐）
 * @param fileName  - 客户端文件名
 * @param fileMime  - 客户端声明的 Content-Type
 * @param fileBytes - 文件 Buffer
 */
function uploadMultipart(p, token, fileField, fileName, fileMime, fileBytes) {
  const boundary = '----diaoyuFormBoundary' + Date.now().toString(16);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\n` +
      `Content-Type: ${fileMime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const payload = Buffer.concat([head, fileBytes, tail]);

  const opts = {
    method: 'POST',
    hostname: 'localhost',
    port: 3000,
    path: '/api' + p,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    req.write(payload);
    req.end();
  });
}

/** GET 一个绝对 URL，返回 { status, contentType, byteLength } */
function fetchUrl(absUrl) {
  const u = new URL(absUrl);
  const opts = {
    method: 'GET',
    hostname: u.hostname,
    port: u.port || 80,
    path: u.pathname,
  };
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'],
          byteLength: Buffer.concat(chunks).length,
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

function shortJson(obj, maxLen = 220) {
  const s = JSON.stringify(obj);
  return s.length <= maxLen ? s : s.slice(0, maxLen) + '...';
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
  // ────────────────────────────────────────────────────────────────────
  // 0. 准备 token（dev-login 兜底）
  // ────────────────────────────────────────────────────────────────────
  console.log('① POST /auth/dev-login  (上传需要登录态)');
  const login = await call('/auth/dev-login', {
    openid: 'dev_upload',
    nickname: '上传测试员',
  });
  assert(login.body.code === 200, 'login code=200');
  const token = login.body.data.token;
  console.log('   token=' + token.slice(0, 16) + '...');

  // ────────────────────────────────────────────────────────────────────
  // 1. 未登录 → 401
  // ────────────────────────────────────────────────────────────────────
  console.log('\n② 未带 token 上传  → 期望 401');
  const noAuth = await uploadMultipart(
    '/common/upload',
    null,
    'file',
    'sample.png',
    'image/png',
    FIXTURE_BYTES,
  );
  assert(noAuth.status === 401, `status=401 (got ${noAuth.status})`);
  assert(
    noAuth.body && noAuth.body.code === 401,
    `envelope code=401 (got ${noAuth.body && noAuth.body.code})`,
  );

  // ────────────────────────────────────────────────────────────────────
  // 2. 合法 PNG → 200 + url 可访问
  // ────────────────────────────────────────────────────────────────────
  console.log('\n③ 合法 PNG 上传  → 期望 200 + url 可 GET');
  const ok = await uploadMultipart(
    '/common/upload',
    token,
    'file',
    'sample.png',
    'image/png',
    FIXTURE_BYTES,
  );
  assert(ok.body && ok.body.code === 200, `envelope code=200`);
  assert(
    ok.body && ok.body.data && typeof ok.body.data.url === 'string',
    'data.url is string',
  );
  assert(
    ok.body && ok.body.data && ok.body.data.mime === 'image/png',
    `data.mime=image/png`,
  );
  assert(
    ok.body && ok.body.data && ok.body.data.sizeBytes === FIXTURE_BYTES.length,
    `data.sizeBytes=${FIXTURE_BYTES.length}`,
  );
  console.log('   url=' + (ok.body && ok.body.data && ok.body.data.url));

  // GET 一遍这个 url
  const fetched = await fetchUrl(ok.body.data.url);
  assert(fetched.status === 200, `GET url status=200 (got ${fetched.status})`);
  assert(
    /image\/png/i.test(String(fetched.contentType || '')),
    `GET url Content-Type 含 image/png (got ${fetched.contentType})`,
  );
  assert(
    fetched.byteLength === FIXTURE_BYTES.length,
    `GET url byteLength=${FIXTURE_BYTES.length}`,
  );

  // ────────────────────────────────────────────────────────────────────
  // 3. 非法 mime（text/plain）→ 400
  // ────────────────────────────────────────────────────────────────────
  console.log('\n④ 上传 text/plain  → 期望 400');
  const wrongMime = await uploadMultipart(
    '/common/upload',
    token,
    'file',
    'hello.txt',
    'text/plain',
    Buffer.from('hello world'),
  );
  assert(
    wrongMime.status === 400,
    `status=400 (got ${wrongMime.status}) body=${shortJson(wrongMime.body)}`,
  );

  // ────────────────────────────────────────────────────────────────────
  // 4. 超大文件（11MB）→ 413 或 400
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑤ 上传 11MB 文件  → 期望 413/400');
  const big = Buffer.alloc(11 * 1024 * 1024, 0xff);
  // 把首字节改成 PNG 签名以骗过 fileFilter（让大小校验先触发）；但 multer 的
  // limits.fileSize 是先触发的，所以会先在 multer 那一层被拒掉
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(big);
  const tooBig = await uploadMultipart(
    '/common/upload',
    token,
    'file',
    'big.png',
    'image/png',
    big,
  );
  assert(
    tooBig.status === 413 || tooBig.status === 400,
    `status in {400,413} (got ${tooBig.status}) body=${shortJson(tooBig.body)}`,
  );

  // ────────────────────────────────────────────────────────────────────
  // 5. 缺少 file 字段 → 400
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑥ 缺少 file 字段  → 期望 400');
  // 用普通 JSON POST 触发 “file 缺失” 路径
  const noFile = await call('/common/upload', {}, token);
  assert(
    noFile.status === 400,
    `status=400 (got ${noFile.status}) body=${shortJson(noFile.body)}`,
  );

  console.log('\n— upload e2e done —');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
