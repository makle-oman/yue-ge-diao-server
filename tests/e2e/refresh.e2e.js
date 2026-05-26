// 一次性 e2e:覆盖 /auth/dev-login 双 token + /auth/refresh 换新 + 防滥用
// 前置:后端已 pnpm start:dev 起在 3000 端口
const http = require('http');

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

function shortJson(obj, maxLen = 220) {
  const s = JSON.stringify(obj);
  return s.length <= maxLen ? s : s.slice(0, maxLen) + '...';
}

function decodeJwtPayload(token) {
  // 不验签,仅 base64-decode payload 看字段(测试用,生产不要这么搞)
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
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
  // 1. dev-login 返回 {token, refreshToken, user}
  // ────────────────────────────────────────────────────────────────────
  console.log('① POST /auth/dev-login  → 期望返回双 token');
  const login = await call('/auth/dev-login', {
    openid: 'refresh_test_' + Date.now(),
    nickname: 'refresh测试员',
  });
  assert(login.body && login.body.code === 200, 'login code=200');
  const { token, refreshToken, user } = login.body.data || {};
  assert(typeof token === 'string' && token.length > 20, 'token 非空字符串');
  assert(typeof refreshToken === 'string' && refreshToken.length > 20, 'refreshToken 非空字符串');
  assert(user && user.id, 'user.id 存在');

  const accessPayload = decodeJwtPayload(token);
  const refreshPayload = decodeJwtPayload(refreshToken);
  assert(accessPayload && accessPayload.typ === 'access', `access.typ=access (got ${accessPayload && accessPayload.typ})`);
  assert(refreshPayload && refreshPayload.typ === 'refresh', `refresh.typ=refresh (got ${refreshPayload && refreshPayload.typ})`);
  assert(accessPayload.sub === user.id, 'access.sub === user.id');
  assert(refreshPayload.sub === user.id, 'refresh.sub === user.id');
  // 过期差:refresh 应远晚于 access(30d vs 30m)
  const expDelta = refreshPayload.exp - accessPayload.exp;
  assert(expDelta > 24 * 3600, `refresh exp - access exp > 24h (got ${expDelta}s)`);

  // ────────────────────────────────────────────────────────────────────
  // 2. access token 可调业务接口
  // ────────────────────────────────────────────────────────────────────
  console.log('\n② access token 调 /users/me  → 期望 200');
  const me = await call('/users/me', {}, token);
  assert(me.body && me.body.code === 200, `me code=200 (got ${me.status})`);
  assert(me.body.data && me.body.data.id === user.id, `me.data.id=${user.id}`);

  // ────────────────────────────────────────────────────────────────────
  // 3. refresh token 不能当 access 用(防滥用)
  // ────────────────────────────────────────────────────────────────────
  console.log('\n③ 用 refresh token 调 /users/me  → 期望 401 (typ 不是 access)');
  const abuse = await call('/users/me', {}, refreshToken);
  assert(abuse.status === 401, `status=401 (got ${abuse.status})`);

  // ────────────────────────────────────────────────────────────────────
  // 4. /auth/refresh 用 refresh 换新一对
  // ────────────────────────────────────────────────────────────────────
  console.log('\n④ /auth/refresh  → 期望返回新 {token, refreshToken}');
  // 延迟 1s,避免新签 token 的 iat 与旧 token 同秒导致 JWT 字符串完全相同
  await new Promise((r) => setTimeout(r, 1100));
  const refreshed = await call('/auth/refresh', { refreshToken });
  assert(refreshed.body && refreshed.body.code === 200, `refresh code=200 (got ${refreshed.status})`);
  const newToken = refreshed.body.data && refreshed.body.data.token;
  const newRefresh = refreshed.body.data && refreshed.body.data.refreshToken;
  assert(typeof newToken === 'string' && newToken.length > 20, 'new token 非空');
  assert(typeof newRefresh === 'string' && newRefresh.length > 20, 'new refreshToken 非空');
  assert(newToken !== token, 'new token !== 旧 access');
  const newAccessPayload = decodeJwtPayload(newToken);
  const newRefreshPayload = decodeJwtPayload(newRefresh);
  assert(newAccessPayload.typ === 'access', 'new access.typ=access');
  assert(newRefreshPayload.typ === 'refresh', 'new refresh.typ=refresh');
  assert(newAccessPayload.sub === user.id, 'new access.sub === user.id');

  // ────────────────────────────────────────────────────────────────────
  // 5. 新 access token 可调业务接口
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑤ 用新 access 调 /users/me  → 期望 200');
  const me2 = await call('/users/me', {}, newToken);
  assert(me2.body && me2.body.code === 200, `me2 code=200 (got ${me2.status})`);

  // ────────────────────────────────────────────────────────────────────
  // 6. access token 不能当 refresh 用(防"无限续期")
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑥ 用 access token 调 /auth/refresh  → 期望 401 (typ 不是 refresh)');
  const wrongType = await call('/auth/refresh', { refreshToken: token });
  assert(
    wrongType.status === 401,
    `status=401 (got ${wrongType.status}) body=${shortJson(wrongType.body)}`,
  );

  // ────────────────────────────────────────────────────────────────────
  // 7. 非法 refreshToken → 401
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑦ 非法 refreshToken=abc  → 期望 401');
  const garbage = await call('/auth/refresh', { refreshToken: 'abc.def.ghi' });
  assert(garbage.status === 401, `status=401 (got ${garbage.status})`);

  // ────────────────────────────────────────────────────────────────────
  // 8. 空 refreshToken → 400 (DTO 拦截)
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑧ 空 refreshToken  → 期望 400 (DTO @IsNotEmpty)');
  const empty = await call('/auth/refresh', { refreshToken: '' });
  assert(empty.status === 400, `status=400 (got ${empty.status}) body=${shortJson(empty.body)}`);

  // ────────────────────────────────────────────────────────────────────
  // 9. 缺 refreshToken 字段 → 400
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑨ 缺 refreshToken 字段  → 期望 400');
  const missing = await call('/auth/refresh', {});
  assert(missing.status === 400, `status=400 (got ${missing.status}) body=${shortJson(missing.body)}`);

  console.log('\n— refresh e2e done —');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
