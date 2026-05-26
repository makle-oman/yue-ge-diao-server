// 一次性 e2e 跑通 catches 模块 5 个接口 + users 聚合 2 个接口；输出每一步的简短摘要
const http = require('http');

const BASE = 'http://localhost:3000/api';

function call(path, body, token) {
  const data = JSON.stringify(body ?? {});
  const opts = {
    method: 'POST',
    hostname: 'localhost',
    port: 3000,
    path: '/api' + path,
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
  // 0. 两个 dev 用户：A（发鱼获的人） / B（看别人鱼获的人）
  // ────────────────────────────────────────────────────────────────────
  console.log('① POST /auth/dev-login × 2  (A 发鱼获 / B 看鱼获)');
  const loginA = await call('/auth/dev-login', {
    openid: 'dev_catches_a',
    nickname: '鱼获测试员A',
  });
  const loginB = await call('/auth/dev-login', {
    openid: 'dev_catches_b',
    nickname: '鱼获测试员B',
  });
  assert(loginA.body.code === 200, 'A login code=200');
  assert(loginB.body.code === 200, 'B login code=200');
  const tokenA = loginA.body.data.token;
  const tokenB = loginB.body.data.token;
  const meAId = loginA.body.data.user.id;
  const meBId = loginB.body.data.user.id;
  console.log('   A.id=' + meAId + '  B.id=' + meBId);

  // ────────────────────────────────────────────────────────────────────
  // 1. 给 A 准备一个钓点，方便 create catch 关联
  // ────────────────────────────────────────────────────────────────────
  console.log('\n② POST /spots/create  (为鱼获测试准备一个钓点)');
  const spotResp = await call(
    '/spots/create',
    {
      name: '鱼获测试·虚拟湖',
      type: 'wild',
      waterType: 'lake',
      lat: 30.0,
      lng: 120.0,
      accuracy: 10,
      address: '测试地址',
      city: '测试市',
      fishSpecies: ['鲫鱼', '鲤鱼'],
    },
    tokenA,
  );
  assert(spotResp.body.code === 200, 'spot create code=200');
  const spotId = spotResp.body.data.id;
  console.log('   spotId=' + spotId);

  // ────────────────────────────────────────────────────────────────────
  // 2. A 创建 3 条鱼获：
  //    ② 公开 + 关联 spot
  //    ② 公开 + 仅 lat/lng（无 spot）
  //    ② 私密（locationVisible=false）
  // ────────────────────────────────────────────────────────────────────
  console.log('\n③ POST /catches/create × 3');
  const catches = [
    {
      photos: ['catches/seed/a-1.webp'],
      fishSpecies: ['鲫鱼'],
      weight: 800,
      length: 25,
      technique: 'hand',
      bait: '红虫',
      content: '今早 5 点起竿，板鲫连竿',
      spotId,
      locationVisible: true,
    },
    {
      photos: ['catches/seed/a-2.webp', 'catches/seed/a-2b.webp'],
      fishSpecies: ['翘嘴'],
      weight: 1200,
      length: 32,
      technique: 'lure',
      bait: '亮片',
      content: '路亚断口，翘嘴爆口',
      lat: 30.001,
      lng: 120.001,
      locationVisible: true,
    },
    {
      photos: ['catches/seed/a-3.webp'],
      fishSpecies: ['鲤鱼'],
      weight: 3500, // 最大
      length: 55,
      technique: 'taiwan',
      content: '深夜守钓，鲤鱼 7 斤',
      lat: 30.002,
      lng: 120.002,
      locationVisible: false, // 私密
    },
  ];
  const createdIds = [];
  for (const c of catches) {
    const r = await call('/catches/create', c, tokenA);
    console.log('   →', shortJson(r.body));
    assert(r.body.code === 200, `create code=200 (${c.fishSpecies[0]})`);
    if (r.body.code === 200) createdIds.push(r.body.data.id);
  }
  assert(createdIds.length === 3, '已创建 3 条鱼获');

  // ────────────────────────────────────────────────────────────────────
  // 3. 列表 recommend
  // ────────────────────────────────────────────────────────────────────
  console.log('\n④ POST /catches/list  tab=recommend');
  const listRec = await call(
    '/catches/list',
    { tab: 'recommend', limit: 20 },
    tokenB,
  );
  console.log('   →', shortJson(listRec.body));
  assert(listRec.body.code === 200, 'recommend code=200');
  const recIds = (listRec.body.data.list || []).map((x) => x.id);
  for (const id of createdIds) {
    assert(recIds.includes(id), `recommend 应含 catchId=${id}`);
  }

  // ────────────────────────────────────────────────────────────────────
  // 4. 列表 nearby（lat/lng 接近）
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑤ POST /catches/list  tab=nearby');
  const listNear = await call(
    '/catches/list',
    { tab: 'nearby', lat: 30.0, lng: 120.0, radius: 50000, limit: 20 },
    tokenB,
  );
  console.log('   →', shortJson(listNear.body));
  assert(listNear.body.code === 200, 'nearby code=200');
  const nearIds = (listNear.body.data.list || []).map((x) => x.id);
  assert(
    nearIds.includes(createdIds[1]),
    'nearby 应含「翘嘴」(自带 lat/lng)',
  );

  // ────────────────────────────────────────────────────────────────────
  // 5. nearby 缺参数 → 400
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑥ POST /catches/list  tab=nearby  缺 lat/lng');
  const listNearBad = await call(
    '/catches/list',
    { tab: 'nearby', limit: 20 },
    tokenB,
  );
  console.log('   →', shortJson(listNearBad.body));
  assert(listNearBad.body.code === 400, 'nearby 缺 lat/lng 应 400');

  // ────────────────────────────────────────────────────────────────────
  // 6. follow tab：B 没 follow 任何人 → list 空
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑦ POST /catches/list  tab=follow  (B 未 follow，预期空)');
  const listFollow = await call(
    '/catches/list',
    { tab: 'follow', limit: 20 },
    tokenB,
  );
  assert(listFollow.body.code === 200, 'follow code=200');
  assert(
    Array.isArray(listFollow.body.data.list) &&
      listFollow.body.data.list.length === 0,
    'follow tab 应返回空 list',
  );

  // ────────────────────────────────────────────────────────────────────
  // 7. detail：B 看 A 的公开鱼获，lat/lng 应可见；看 A 的私密鱼获，lat/lng 应为 null
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑧ POST /catches/detail  公开 catchId=' + createdIds[1]);
  const detailPub = await call(
    '/catches/detail',
    { catchId: createdIds[1] },
    tokenB,
  );
  console.log('   →', shortJson(detailPub.body, 350));
  assert(detailPub.body.code === 200, 'detail public code=200');
  assert(detailPub.body.data.lat === 30.001, 'public catch.lat 可见');
  assert(detailPub.body.data.locationVisible === true, 'locationVisible=true');
  assert(detailPub.body.data.yourLikeStatus === false, '初次 yourLikeStatus=false');
  assert(
    detailPub.body.data.yourCollectStatus === false,
    '初次 yourCollectStatus=false',
  );

  console.log('\n⑨ POST /catches/detail  私密 catchId=' + createdIds[2]);
  const detailPri = await call(
    '/catches/detail',
    { catchId: createdIds[2] },
    tokenB,
  );
  console.log('   →', shortJson(detailPri.body, 350));
  assert(detailPri.body.code === 200, 'detail private code=200');
  assert(detailPri.body.data.lat === null, 'private catch.lat=null');
  assert(detailPri.body.data.lng === null, 'private catch.lng=null');
  assert(
    detailPri.body.data.locationVisible === false,
    'locationVisible=false',
  );

  // ────────────────────────────────────────────────────────────────────
  // 8. like + 幂等 + unlike
  // ────────────────────────────────────────────────────────────────────
  const targetId = createdIds[0];
  console.log('\n⑩ POST /catches/like  action=like  catchId=' + targetId);
  const like1 = await call(
    '/catches/like',
    { catchId: targetId, action: 'like' },
    tokenB,
  );
  console.log('   →', shortJson(like1.body));
  assert(like1.body.code === 200, 'like code=200');
  assert(like1.body.data.likeCount === 1, 'like 后 likeCount=1');

  console.log('\n⑪ POST /catches/like  action=like (重复，幂等 no-op)');
  const like2 = await call(
    '/catches/like',
    { catchId: targetId, action: 'like' },
    tokenB,
  );
  assert(like2.body.data.likeCount === 1, '重复 like 仍 likeCount=1');

  console.log('\n⑫ POST /catches/detail  验证 yourLikeStatus=true');
  const detailAfterLike = await call(
    '/catches/detail',
    { catchId: targetId },
    tokenB,
  );
  assert(
    detailAfterLike.body.data.yourLikeStatus === true,
    'like 后 yourLikeStatus=true',
  );

  console.log('\n⑬ POST /catches/like  action=unlike');
  const unlike = await call(
    '/catches/like',
    { catchId: targetId, action: 'unlike' },
    tokenB,
  );
  assert(unlike.body.data.likeCount === 0, 'unlike 后 likeCount=0');

  // ────────────────────────────────────────────────────────────────────
  // 9. collect + 幂等 + uncollect
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑭ POST /catches/collect  action=collect');
  const col1 = await call(
    '/catches/collect',
    { catchId: targetId, action: 'collect' },
    tokenB,
  );
  console.log('   →', shortJson(col1.body));
  assert(col1.body.data.favCount === 1, 'collect 后 favCount=1');

  console.log('\n⑮ POST /catches/collect  action=collect (重复，幂等)');
  const col2 = await call(
    '/catches/collect',
    { catchId: targetId, action: 'collect' },
    tokenB,
  );
  assert(col2.body.data.favCount === 1, '重复 collect 仍 favCount=1');

  console.log('\n⑯ POST /catches/collect  action=uncollect');
  const uncol = await call(
    '/catches/collect',
    { catchId: targetId, action: 'uncollect' },
    tokenB,
  );
  assert(uncol.body.data.favCount === 0, 'uncollect 后 favCount=0');

  // ────────────────────────────────────────────────────────────────────
  // 10. users 聚合接口：/users/catches  +  /users/catches/stats
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑰ POST /users/catches  (A 看自己 all)');
  const myCatchesAll = await call(
    '/users/catches',
    { visibility: 'all', limit: 20 },
    tokenA,
  );
  console.log('   →', shortJson(myCatchesAll.body));
  assert(myCatchesAll.body.code === 200, 'A users.catches all code=200');
  assert(
    myCatchesAll.body.data.list.length >= 3,
    'A 看自己 all，至少 3 条（含私密）',
  );

  console.log('\n⑱ POST /users/catches  (A 看自己 public)');
  const myCatchesPub = await call(
    '/users/catches',
    { visibility: 'public', limit: 20 },
    tokenA,
  );
  const myPubIds = myCatchesPub.body.data.list.map((x) => x.id);
  assert(
    myPubIds.includes(createdIds[0]) && myPubIds.includes(createdIds[1]),
    'A 看自己 public 含 2 条公开',
  );
  assert(
    !myPubIds.includes(createdIds[2]),
    'A 看自己 public 不含私密',
  );

  console.log('\n⑲ POST /users/catches  (A 看自己 private)');
  const myCatchesPri = await call(
    '/users/catches',
    { visibility: 'private', limit: 20 },
    tokenA,
  );
  const myPriIds = myCatchesPri.body.data.list.map((x) => x.id);
  assert(
    myPriIds.length === 1 && myPriIds[0] === createdIds[2],
    'A 看自己 private 仅 1 条（鲤鱼）',
  );

  console.log('\n⑳ POST /users/catches  (B 看 A.userId 的鱼获，只能看公开)');
  const bSeesA = await call(
    '/users/catches',
    { userId: meAId, limit: 20 },
    tokenB,
  );
  const bSeesAIds = bSeesA.body.data.list.map((x) => x.id);
  assert(bSeesA.body.code === 200, 'B 看 A code=200');
  assert(
    bSeesAIds.includes(createdIds[0]) && bSeesAIds.includes(createdIds[1]),
    'B 看 A 含 2 条公开',
  );
  assert(
    !bSeesAIds.includes(createdIds[2]),
    'B 看 A 不应含 A 的私密鱼获',
  );

  console.log('\n㉑ POST /users/catches  (B 试图看 A 的 private → 403)');
  const bForbid = await call(
    '/users/catches',
    { userId: meAId, visibility: 'private' },
    tokenB,
  );
  console.log('   →', shortJson(bForbid.body));
  assert(bForbid.body.code === 403, 'B 看他人 private 应 403');

  console.log('\n㉒ POST /users/catches/stats  (A 看自己)');
  const myStats = await call('/users/catches/stats', {}, tokenA);
  console.log('   →', shortJson(myStats.body));
  assert(myStats.body.code === 200, 'A stats code=200');
  assert(myStats.body.data.total >= 3, 'A.total >= 3');
  assert(myStats.body.data.monthCount >= 3, 'A.monthCount >= 3 (本月内新建)');
  assert(
    myStats.body.data.heaviest &&
      myStats.body.data.heaviest.weightG === 3500,
    'A.heaviest.weightG = 3500（鲤鱼）',
  );

  console.log('\n㉓ POST /users/catches/stats  (B 看 A，仅 public 算)');
  const bStats = await call(
    '/users/catches/stats',
    { userId: meAId },
    tokenB,
  );
  console.log('   →', shortJson(bStats.body));
  assert(bStats.body.code === 200, 'B stats code=200');
  assert(
    bStats.body.data.heaviest &&
      bStats.body.data.heaviest.weightG === 1200,
    'B 看 A.heaviest.weightG=1200（翘嘴，私密鲤鱼被过滤）',
  );

  // ────────────────────────────────────────────────────────────────────
  // 11. 错误路径
  // ────────────────────────────────────────────────────────────────────
  console.log('\n㉔ POST /catches/detail  catchId="99999999"（不存在）');
  const noCatch = await call(
    '/catches/detail',
    { catchId: '99999999' },
    tokenB,
  );
  console.log('   →', shortJson(noCatch.body));
  assert(noCatch.body.code === 404, '不存在的 catchId 应 404');

  console.log('\n㉕ POST /catches/detail  catchId="abc"（非法格式）');
  const badCatch = await call('/catches/detail', { catchId: 'abc' }, tokenB);
  console.log('   →', shortJson(badCatch.body));
  assert(badCatch.body.code === 400, '非法 catchId 应 400');

  console.log('\n㉖ POST /catches/create  无 token');
  const noAuth = await call(
    '/catches/create',
    { photos: ['x.webp'], fishSpecies: ['鲫鱼'] },
    null,
  );
  console.log('   →', shortJson(noAuth.body));
  assert(noAuth.body.code === 401, '无 token 应 401');

  console.log(
    process.exitCode === 1
      ? '\n❌ 部分断言失败，查看上面的 ❌'
      : '\n✅ 全部断言通过！',
  );
})();
