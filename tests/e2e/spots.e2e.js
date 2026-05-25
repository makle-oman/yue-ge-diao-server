// 一次性 e2e 跑通 spots 模块 7 个接口；输出每一步的简短摘要
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
  // 0. login
  console.log('① POST /auth/dev-login');
  const login = await call('/auth/dev-login', {
    openid: 'dev_spots_test',
    nickname: '钓点测试员',
  });
  console.log('   →', shortJson(login.body));
  assert(login.body.code === 200, 'login code=200');
  const token = login.body.data.token;
  const meId = login.body.data.user.id;
  console.log('   token=' + token.slice(0, 30) + '...  userId=' + meId);

  // 1. create 3 spots
  // 北京颐和园昆明湖（野钓/湖），怀柔水库（野钓/水库），天津滨海海钓码头（海钓/海）
  const spots = [
    {
      name: '颐和园昆明湖',
      type: 'wild',
      waterType: 'lake',
      lat: 39.9999,
      lng: 116.2755,
      accuracy: 12,
      address: '北京市海淀区颐和园路',
      city: '北京',
      description: '颐和园湖区可垂钓，环境优雅',
      fishSpecies: ['鲫鱼', '鲤鱼', '草鱼'],
      facilities: { park: true, toilet: true, paid: true },
      photos: ['spots/seed/yiheyuan-1.webp'],
    },
    {
      name: '怀柔水库',
      type: 'wild',
      waterType: 'reservoir',
      lat: 40.316,
      lng: 116.6334,
      accuracy: 20,
      address: '北京市怀柔区',
      city: '北京',
      description: '北京近郊大型水库，鲈鱼花鲢出名',
      fishSpecies: ['鲫鱼', '鳙鱼', '鲶鱼'],
      facilities: { park: false, toilet: false, paid: false },
      photos: ['spots/seed/huairou-1.webp', 'spots/seed/huairou-2.webp'],
    },
    {
      name: '滨海新区海钓码头',
      type: 'sea',
      waterType: 'sea',
      lat: 39.0345,
      lng: 117.7028,
      accuracy: 30,
      address: '天津市滨海新区',
      city: '天津',
      description: '海钓爱好者码头，按位收费',
      fishSpecies: ['鲈鱼', '黄花鱼', '梭鱼'],
      facilities: { park: true, toilet: true, paid: true },
    },
  ];

  console.log('\n② POST /spots/create × 3');
  const createdIds = [];
  for (const s of spots) {
    const r = await call('/spots/create', s, token);
    console.log('   ' + s.name + ' →', shortJson(r.body));
    assert(r.body.code === 200, `create ${s.name} code=200`);
    if (r.body.code === 200) createdIds.push(r.body.data.id);
  }
  console.log('   createdIds=' + JSON.stringify(createdIds));

  // 用户当前位置：北京天安门（39.9087, 116.3975）
  const me = { lat: 39.9087, lng: 116.3975 };

  // 2. list 半径 20km，应能看到颐和园（≈12km），看不到怀柔水库（≈47km）和海钓码头（≈170km）
  console.log('\n③ POST /spots/list  radius=20000');
  const list20 = await call(
    '/spots/list',
    { ...me, radius: 20000, limit: 50 },
    null,
  );
  console.log('   →', shortJson(list20.body));
  assert(list20.body.code === 200, 'list code=200');
  const names20 = (list20.body.data.list || []).map((x) => x.name);
  console.log('   names@20km=' + JSON.stringify(names20));
  assert(names20.includes('颐和园昆明湖'), '颐和园应在 20km 内');
  assert(!names20.includes('滨海新区海钓码头'), '海钓码头不应在 20km 内');

  // 3. list 半径 100km，应能看到颐和园+怀柔（≈47km），看不到海钓码头
  console.log('\n④ POST /spots/list  radius=100000');
  const list100 = await call(
    '/spots/list',
    { ...me, radius: 100000, limit: 50 },
    null,
  );
  const names100 = (list100.body.data.list || []).map((x) => x.name);
  console.log('   names@100km=' + JSON.stringify(names100));
  assert(names100.includes('颐和园昆明湖'), '颐和园应在 100km 内');
  assert(names100.includes('怀柔水库'), '怀柔水库应在 100km 内');
  assert(!names100.includes('滨海新区海钓码头'), '海钓码头不应在 100km 内');

  // 4. list 半径 200km，所有 3 个钓点应可见
  console.log('\n⑤ POST /spots/list  radius=200000');
  const list200 = await call(
    '/spots/list',
    { ...me, radius: 200000, limit: 50 },
    null,
  );
  const namesAll = (list200.body.data.list || []).map((x) => x.name);
  console.log('   names@200km=' + JSON.stringify(namesAll));
  assert(namesAll.length >= 3, '200km 内应至少 3 个钓点');

  // 5. nearby（与 list 相似，扁平 list）
  console.log('\n⑥ POST /spots/nearby  radius=100000');
  const nearby = await call(
    '/spots/nearby',
    { ...me, radius: 100000, limit: 50 },
    null,
  );
  console.log('   →', shortJson(nearby.body));
  assert(
    Array.isArray(nearby.body.data?.list),
    'nearby 返回 list 数组',
  );

  // 6. search 关键词 "水库"，应只命中怀柔水库
  console.log('\n⑦ POST /spots/search  keyword=水库');
  const search = await call('/spots/search', { keyword: '水库' }, null);
  console.log('   →', shortJson(search.body));
  const nameSearch = (search.body.data?.list || []).map((x) => x.name);
  assert(nameSearch.includes('怀柔水库'), 'keyword=水库 命中怀柔水库');

  // 7. search by city + hasParking, 应命中颐和园 / 滨海（都 park:true），不命中怀柔（park:false）
  console.log('\n⑧ POST /spots/search  hasParking=true');
  const hp = await call('/spots/search', { hasParking: true }, null);
  const nameHp = (hp.body.data?.list || []).map((x) => x.name);
  console.log('   names=' + JSON.stringify(nameHp));
  assert(nameHp.includes('颐和园昆明湖'), 'hasParking=true 命中颐和园');
  assert(nameHp.includes('滨海新区海钓码头'), 'hasParking=true 命中滨海');
  assert(!nameHp.includes('怀柔水库'), 'hasParking=true 不应命中怀柔水库');

  // 8. detail
  const targetId = createdIds[0];
  console.log('\n⑨ POST /spots/detail  spotId=' + targetId);
  const detail = await call('/spots/detail', { spotId: targetId }, token);
  console.log('   →', shortJson(detail.body, 350));
  assert(detail.body.code === 200, 'detail code=200');
  assert(detail.body.data.yourWantStatus === false, '初次访问 yourWantStatus=false');

  // 9. want
  console.log('\n⑩ POST /spots/want  action=want');
  const want = await call(
    '/spots/want',
    { spotId: targetId, action: 'want' },
    token,
  );
  console.log('   →', shortJson(want.body));
  assert(want.body.code === 200, 'want code=200');
  assert(want.body.data.wantCount === 1, 'want 后 wantCount=1');

  // 重复 want（幂等）
  console.log('\n⑪ POST /spots/want  action=want（重复，预期 no-op）');
  const want2 = await call(
    '/spots/want',
    { spotId: targetId, action: 'want' },
    token,
  );
  assert(want2.body.data.wantCount === 1, '重复 want 仍 wantCount=1');

  // detail 再看一次，yourWantStatus 应变 true
  console.log('\n⑫ POST /spots/detail  spotId=' + targetId + '（验证 yourWantStatus）');
  const detail2 = await call('/spots/detail', { spotId: targetId }, token);
  assert(detail2.body.data.yourWantStatus === true, 'want 后 yourWantStatus=true');
  assert(detail2.body.data.wantCount === 1, 'want 后 detail.wantCount=1');

  // unwant
  console.log('\n⑬ POST /spots/want  action=unwant');
  const unwant = await call(
    '/spots/want',
    { spotId: targetId, action: 'unwant' },
    token,
  );
  console.log('   →', shortJson(unwant.body));
  assert(unwant.body.data.wantCount === 0, 'unwant 后 wantCount=0');

  // 10. history（catches 表空，但接口必须正常返回，weekTrend 7 个 0）
  console.log('\n⑭ POST /spots/history  spotId=' + targetId);
  const history = await call('/spots/history', { spotId: targetId }, null);
  console.log('   →', shortJson(history.body, 400));
  assert(history.body.code === 200, 'history code=200');
  assert(Array.isArray(history.body.data.catches), 'history.catches 是数组');
  assert(history.body.data.catches.length === 0, '初次 catches 应为空');
  assert(history.body.data.weekTrend.length === 7, 'weekTrend 长度=7');
  assert(
    history.body.data.weekTrend.every((d) => d.count === 0),
    'weekTrend 全 0',
  );

  // 11. 错误路径：找不存在的 spotId
  console.log('\n⑮ POST /spots/detail  spotId=99999999（不存在）');
  const noSpot = await call('/spots/detail', { spotId: '99999999' }, token);
  console.log('   →', shortJson(noSpot.body));
  assert(noSpot.body.code === 404, '不存在的 spotId 应 404');

  // 12. 错误路径：非法 spotId 格式
  console.log('\n⑯ POST /spots/detail  spotId="abc"（非法格式）');
  const badSpot = await call('/spots/detail', { spotId: 'abc' }, token);
  console.log('   →', shortJson(badSpot.body));
  assert(
    badSpot.body.code === 400,
    `非法 spotId 应 400, 实际 code=${badSpot.body.code}`,
  );

  // 13. 错误路径：未登录访问 create
  console.log('\n⑰ POST /spots/create  无 token');
  const noAuth = await call(
    '/spots/create',
    { name: 'x', type: 'wild', lat: 39, lng: 116 },
    null,
  );
  console.log('   →', shortJson(noAuth.body));
  assert(noAuth.body.code === 401, '无 token 应 401');

  // 14. 错误路径：精度太低
  console.log('\n⑱ POST /spots/create  accuracy=100m（太低）');
  const lowAcc = await call(
    '/spots/create',
    {
      name: '低精度点',
      type: 'wild',
      waterType: 'river',
      lat: 39.92,
      lng: 116.4,
      accuracy: 100,
      city: '北京',
    },
    token,
  );
  console.log('   →', shortJson(lowAcc.body));
  assert(
    lowAcc.body.code === 403,
    `精度 > 50m 应 403, 实际 code=${lowAcc.body.code}`,
  );

  console.log(
    process.exitCode === 1
      ? '\n❌ 部分断言失败，查看上面的 ❌'
      : '\n✅ 全部断言通过！',
  );
})();
