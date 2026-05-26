// 一次性 e2e 跑通 /users/me + /users/update;输出每一步的简短摘要
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
  // 0. dev 用户登录
  // ────────────────────────────────────────────────────────────────────
  console.log('① POST /auth/dev-login');
  const login = await call('/auth/dev-login', {
    openid: 'dev_me_' + Date.now(),
    nickname: '资料测试员',
  });
  assert(login.body.code === 200, 'login code=200');
  const token = login.body.data.token;
  const userId = String(login.body.data.user.id);
  console.log('   userId=' + userId);

  // ────────────────────────────────────────────────────────────────────
  // 1. /users/me 字段齐全
  // ────────────────────────────────────────────────────────────────────
  console.log('\n② /users/me  → 期望返回完整 MeProfile');
  const me1 = await call('/users/me', {}, token);
  assert(me1.body && me1.body.code === 200, 'envelope code=200');
  const d1 = me1.body && me1.body.data;
  assert(d1 && d1.id === userId, `data.id=${userId}`);
  assert(d1 && typeof d1.openid === 'string', 'data.openid is string');
  assert(d1 && Array.isArray(d1.playStyles), `data.playStyles is array (got ${typeof d1.playStyles})`);
  assert(d1 && d1.playStyles.length === 0, 'data.playStyles 初始为空数组');
  assert(d1 && d1.fishingAgeBand === null, 'data.fishingAgeBand 初始为 null');
  assert(d1 && typeof d1.allowNearby === 'boolean', 'data.allowNearby is boolean');
  assert(d1 && typeof d1.allowShowLoc === 'boolean', 'data.allowShowLoc is boolean');
  assert(d1 && typeof d1.gender === 'number', 'data.gender is number');
  assert(d1 && typeof d1.createdAt === 'string', 'data.createdAt is string (ISO)');

  // ────────────────────────────────────────────────────────────────────
  // 2. /users/update 未登录 → 401
  // ────────────────────────────────────────────────────────────────────
  console.log('\n③ /users/update 未带 token  → 期望 401');
  const noAuth = await call('/users/update', { nickname: 'x' }, null);
  assert(noAuth.status === 401, `status=401 (got ${noAuth.status})`);

  // ────────────────────────────────────────────────────────────────────
  // 3. 合法 update — 全字段
  // ────────────────────────────────────────────────────────────────────
  console.log('\n④ /users/update 全字段  → 期望 200 + 字段被持久化');
  const upd = await call(
    '/users/update',
    {
      nickname: '老王',
      city: '南京',
      gender: 1,
      fishingAgeBand: '3_5y',
      playStyles: ['野钓', '路亚'],
      allowNearby: false,
      allowShowLoc: false,
    },
    token,
  );
  assert(upd.body && upd.body.code === 200, `update code=200`);
  const u = upd.body && upd.body.data;
  assert(u && u.nickname === '老王', `nickname=老王 (got ${u && u.nickname})`);
  assert(u && u.city === '南京', `city=南京 (got ${u && u.city})`);
  assert(u && u.gender === 1, `gender=1 (got ${u && u.gender})`);
  assert(u && u.fishingAgeBand === '3_5y', `fishingAgeBand=3_5y (got ${u && u.fishingAgeBand})`);
  assert(
    u && Array.isArray(u.playStyles) && u.playStyles.length === 2 && u.playStyles[0] === '野钓',
    `playStyles=['野钓','路亚'] (got ${u && JSON.stringify(u.playStyles)})`,
  );
  assert(u && u.allowNearby === false, 'allowNearby=false');
  assert(u && u.allowShowLoc === false, 'allowShowLoc=false');

  // ────────────────────────────────────────────────────────────────────
  // 4. 再 /users/me 拉一遍 — 字段持久化
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑤ /users/me 再拉  → 期望和 ④ 一致');
  const me2 = await call('/users/me', {}, token);
  const d2 = me2.body && me2.body.data;
  assert(d2 && d2.nickname === '老王', `me.nickname=老王`);
  assert(d2 && d2.fishingAgeBand === '3_5y', `me.fishingAgeBand=3_5y`);
  assert(
    d2 && Array.isArray(d2.playStyles) && d2.playStyles.length === 2,
    `me.playStyles.length=2`,
  );
  assert(d2 && d2.allowNearby === false, 'me.allowNearby=false');

  // ────────────────────────────────────────────────────────────────────
  // 5. 部分 update — 只改 nickname,其他不动
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑥ 仅改 nickname  → 期望其他字段保留');
  const upd2 = await call('/users/update', { nickname: '老李' }, token);
  const u2 = upd2.body && upd2.body.data;
  assert(u2 && u2.nickname === '老李', 'nickname=老李');
  assert(u2 && u2.city === '南京', 'city 保留 南京');
  assert(
    u2 && Array.isArray(u2.playStyles) && u2.playStyles.length === 2,
    'playStyles 保留 2 个',
  );

  // ────────────────────────────────────────────────────────────────────
  // 6. playStyles 空数组 → 清空(转 NULL)
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑦ playStyles=[]  → 期望清空');
  const upd3 = await call('/users/update', { playStyles: [] }, token);
  const u3 = upd3.body && upd3.body.data;
  assert(
    u3 && Array.isArray(u3.playStyles) && u3.playStyles.length === 0,
    `playStyles=[] (got ${u3 && JSON.stringify(u3.playStyles)})`,
  );

  // ────────────────────────────────────────────────────────────────────
  // 7. 空 body → no-op + 返回当前 me
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑧ 空 body  → 期望 200 + 返回当前 me');
  const upd4 = await call('/users/update', {}, token);
  assert(upd4.body && upd4.body.code === 200, 'empty update code=200');
  const u4 = upd4.body && upd4.body.data;
  assert(u4 && u4.nickname === '老李', 'empty update 返回最新 nickname');

  // ────────────────────────────────────────────────────────────────────
  // 8. 非法 fishingAgeBand → 400
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑨ 非法 fishingAgeBand=10y  → 期望 400');
  const bad1 = await call('/users/update', { fishingAgeBand: '10y' }, token);
  assert(
    bad1.status === 400,
    `status=400 (got ${bad1.status}) body=${shortJson(bad1.body)}`,
  );

  // ────────────────────────────────────────────────────────────────────
  // 9. 非法 nickname(空串)→ 400
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑩ 空 nickname  → 期望 400');
  const bad2 = await call('/users/update', { nickname: '' }, token);
  assert(
    bad2.status === 400,
    `status=400 (got ${bad2.status}) body=${shortJson(bad2.body)}`,
  );

  // ────────────────────────────────────────────────────────────────────
  // 10. playStyles 元素非 string → 400
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑪ playStyles=[1,2]  → 期望 400');
  const bad3 = await call('/users/update', { playStyles: [1, 2] }, token);
  assert(
    bad3.status === 400,
    `status=400 (got ${bad3.status}) body=${shortJson(bad3.body)}`,
  );

  // ────────────────────────────────────────────────────────────────────
  // 11. gender 越界 → 400
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑫ gender=5  → 期望 400');
  const bad4 = await call('/users/update', { gender: 5 }, token);
  assert(
    bad4.status === 400,
    `status=400 (got ${bad4.status}) body=${shortJson(bad4.body)}`,
  );

  console.log('\n— profile-me e2e done —');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
