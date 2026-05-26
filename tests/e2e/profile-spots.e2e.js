// 一次性 e2e 跑通 /users/spots + /users/spots/stats 两个聚合接口
// 前置：后端已 pnpm start:dev 起在 3000 端口
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
  // 0. 两个 dev 用户：A（创建钓点的人） / B（看 A 钓点的人）
  // ────────────────────────────────────────────────────────────────────
  console.log('① POST /auth/dev-login × 2  (A 创钓点 / B 看钓点)');
  const loginA = await call('/auth/dev-login', {
    openid: 'dev_spots_a',
    nickname: '钓点测试员A',
  });
  const loginB = await call('/auth/dev-login', {
    openid: 'dev_spots_b',
    nickname: '钓点测试员B',
  });
  assert(loginA.body.code === 200, 'loginA code=200');
  assert(loginB.body.code === 200, 'loginB code=200');
  const tokenA = loginA.body.data.token;
  const tokenB = loginB.body.data.token;
  const userIdA = String(loginA.body.data.user.id);
  console.log('   userIdA=' + userIdA);

  // ────────────────────────────────────────────────────────────────────
  // 1. 未登录 → 401
  // ────────────────────────────────────────────────────────────────────
  console.log('\n② /users/spots 未带 token  → 期望 401');
  const noAuth = await call('/users/spots', { tab: 'all' }, null);
  assert(noAuth.status === 401, `status=401 (got ${noAuth.status})`);
  assert(
    noAuth.body && noAuth.body.code === 401,
    `envelope code=401 (got ${noAuth.body && noAuth.body.code})`,
  );

  // ────────────────────────────────────────────────────────────────────
  // 2. A 用户先建 2 个钓点（一近一远，便于聚合数据非零）
  // ────────────────────────────────────────────────────────────────────
  console.log('\n③ A 创建 2 个测试钓点');
  // 北京近似坐标，避免 geohash 冲突
  const baseLat = 39.9 + Math.random() * 0.01;
  const baseLng = 116.4 + Math.random() * 0.01;
  const spot1 = await call(
    '/spots/create',
    {
      name: 'A的测试钓点-1-' + Date.now(),
      type: 'wild',
      waterType: 'river',
      lat: baseLat,
      lng: baseLng,
      accuracy: 10,
      city: '北京',
      fishSpecies: ['鲫鱼', '鲤鱼'],
      facilities: { park: true, toilet: true },
    },
    tokenA,
  );
  const spot2 = await call(
    '/spots/create',
    {
      name: 'A的测试钓点-2-' + Date.now(),
      type: 'paid',
      waterType: 'pond',
      lat: baseLat + 0.001,
      lng: baseLng + 0.001,
      accuracy: 10,
      city: '北京',
      fishSpecies: ['翘嘴'],
    },
    tokenA,
  );
  assert(
    spot1.body && spot1.body.code === 200,
    `create spot1 code=200 (body=${shortJson(spot1.body)})`,
  );
  assert(
    spot2.body && spot2.body.code === 200,
    `create spot2 code=200 (body=${shortJson(spot2.body)})`,
  );
  const spot1Id = spot1.body && spot1.body.data && spot1.body.data.id;
  const spot2Id = spot2.body && spot2.body.data && spot2.body.data.id;
  console.log(`   spot1Id=${spot1Id} spot2Id=${spot2Id}`);

  // ────────────────────────────────────────────────────────────────────
  // 3. A 看自己 — list 应至少含刚才 2 个
  // ────────────────────────────────────────────────────────────────────
  console.log('\n④ A 看自己的钓点  → 期望 list 至少含 2 条');
  const selfAll = await call('/users/spots', { tab: 'all' }, tokenA);
  assert(selfAll.body && selfAll.body.code === 200, 'envelope code=200');
  const selfList = (selfAll.body && selfAll.body.data && selfAll.body.data.list) || [];
  assert(Array.isArray(selfList), 'data.list is array');
  const selfIds = new Set(selfList.map((s) => s.id));
  assert(selfIds.has(spot1Id), `list 含 spot1 (id=${spot1Id})`);
  assert(selfIds.has(spot2Id), `list 含 spot2 (id=${spot2Id})`);
  // 验证字段
  const sample = selfList.find((s) => s.id === spot1Id);
  assert(sample && sample.name && sample.type, 'item has name/type');
  assert(sample && typeof sample.lat === 'number', 'item lat is number');
  assert(sample && typeof sample.wantCount === 'number', 'item wantCount is number');
  assert(sample && Array.isArray(sample.fishSpecies), 'item fishSpecies is array');

  // ────────────────────────────────────────────────────────────────────
  // 4. tab=published 与 tab=review（自看）
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑤ A 看 tab=published  → approved 才出现');
  const selfPub = await call('/users/spots', { tab: 'published' }, tokenA);
  assert(selfPub.body && selfPub.body.code === 200, 'published code=200');
  const pubList = (selfPub.body && selfPub.body.data && selfPub.body.data.list) || [];
  // defaultCreateStatus === 'approved'，所以 2 条都该在
  const pubIds = new Set(pubList.map((s) => s.id));
  assert(pubIds.has(spot1Id), 'published 含 spot1');
  assert(pubIds.has(spot2Id), 'published 含 spot2');

  console.log('\n⑥ A 看 tab=review  → 当前应没有 spot1/spot2(都是 approved)');
  const selfRev = await call('/users/spots', { tab: 'review' }, tokenA);
  assert(selfRev.body && selfRev.body.code === 200, 'review code=200');
  const revList = (selfRev.body && selfRev.body.data && selfRev.body.data.list) || [];
  const revIds = new Set(revList.map((s) => s.id));
  assert(!revIds.has(spot1Id), 'review 不含 spot1');
  assert(!revIds.has(spot2Id), 'review 不含 spot2');

  // ────────────────────────────────────────────────────────────────────
  // 5. keyword 搜索（用 spot1 名称的关键片段）
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑦ A 用 keyword 搜自己的 spot1');
  const kwResp = await call(
    '/users/spots',
    { keyword: 'A的测试钓点-1', tab: 'all' },
    tokenA,
  );
  assert(kwResp.body && kwResp.body.code === 200, 'keyword code=200');
  const kwList = (kwResp.body && kwResp.body.data && kwResp.body.data.list) || [];
  const kwIds = new Set(kwList.map((s) => s.id));
  assert(kwIds.has(spot1Id), 'keyword 命中 spot1');
  assert(!kwIds.has(spot2Id), 'keyword 不命中 spot2');

  // ────────────────────────────────────────────────────────────────────
  // 6. B 看 A 的钓点（公开视角）
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑧ B 用 userId 看 A 的钓点  → 期望同样含 spot1/spot2');
  const peerList = await call(
    '/users/spots',
    { userId: userIdA, tab: 'all' },
    tokenB,
  );
  assert(peerList.body && peerList.body.code === 200, 'peer list code=200');
  const peerIds = new Set(
    (peerList.body.data && peerList.body.data.list ? peerList.body.data.list : []).map(
      (s) => s.id,
    ),
  );
  assert(peerIds.has(spot1Id), 'peer list 含 spot1');
  assert(peerIds.has(spot2Id), 'peer list 含 spot2');

  // ────────────────────────────────────────────────────────────────────
  // 7. stats：A 自看
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑨ A 看自己的 stats  → total>=2, monthAdd>=2');
  const selfStats = await call('/users/spots/stats', {}, tokenA);
  assert(selfStats.body && selfStats.body.code === 200, 'stats code=200');
  const sd = selfStats.body && selfStats.body.data;
  assert(sd && typeof sd.total === 'number', 'data.total is number');
  assert(sd && sd.total >= 2, `data.total>=2 (got ${sd && sd.total})`);
  assert(sd && typeof sd.reviewing === 'number', 'data.reviewing is number');
  assert(sd && typeof sd.monthAdd === 'number', 'data.monthAdd is number');
  assert(sd && sd.monthAdd >= 2, `data.monthAdd>=2 (got ${sd && sd.monthAdd})`);
  assert(
    sd && (sd.hottest === null || typeof sd.hottest === 'object'),
    'data.hottest is null or object',
  );

  // ────────────────────────────────────────────────────────────────────
  // 8. stats：B 看 A
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑩ B 看 A 的 stats  → reviewing=0 (看别人不暴露审核中)');
  const peerStats = await call('/users/spots/stats', { userId: userIdA }, tokenB);
  assert(peerStats.body && peerStats.body.code === 200, 'peer stats code=200');
  const pd = peerStats.body && peerStats.body.data;
  assert(pd && typeof pd.total === 'number', 'peer data.total is number');
  assert(pd && pd.total >= 2, `peer data.total>=2 (got ${pd && pd.total})`);
  assert(pd && pd.reviewing === 0, `peer data.reviewing=0 (got ${pd && pd.reviewing})`);

  // ────────────────────────────────────────────────────────────────────
  // 9. 分页：limit=1，nextCursor 应非空
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑪ limit=1 拿到 nextCursor → 再翻一页');
  const pg1 = await call('/users/spots', { tab: 'all', limit: 1 }, tokenA);
  assert(pg1.body && pg1.body.code === 200, 'page1 code=200');
  const pg1Data = pg1.body && pg1.body.data;
  assert(pg1Data && pg1Data.list && pg1Data.list.length === 1, 'page1 length=1');
  assert(typeof pg1Data.nextCursor === 'string' && pg1Data.nextCursor.length > 0, 'page1 nextCursor 非空');
  const pg2 = await call(
    '/users/spots',
    { tab: 'all', limit: 1, cursor: pg1Data.nextCursor },
    tokenA,
  );
  assert(pg2.body && pg2.body.code === 200, 'page2 code=200');
  const pg2Data = pg2.body && pg2.body.data;
  assert(pg2Data && pg2Data.list && pg2Data.list.length >= 1, 'page2 length>=1');
  assert(
    pg2Data.list[0].id !== pg1Data.list[0].id,
    `page2[0].id != page1[0].id (got ${pg1Data.list[0].id} vs ${pg2Data.list[0].id})`,
  );

  // ────────────────────────────────────────────────────────────────────
  // 10. 非法 userId → 400
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑫ 非法 userId  → 期望 400');
  const badUid = await call('/users/spots', { userId: 'abc' }, tokenA);
  assert(
    badUid.status === 400,
    `status=400 (got ${badUid.status}) body=${shortJson(badUid.body)}`,
  );
  assert(
    badUid.body && /userId/.test(String(badUid.body.msg || '')),
    `msg 包含 "userId" (got msg=${badUid.body && badUid.body.msg})`,
  );

  console.log('\n— profile-spots e2e done —');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
