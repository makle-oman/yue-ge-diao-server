// 一次性 e2e 跑通 teams 模块 6 个接口 + users/teams 聚合
// 运行：(后端起在 :3000) 然后 `node tests/e2e/teams.e2e.js`
const http = require('http');

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
  // 0. 三个 dev 用户：A 队长 / B 申请者 / C 申请者
  // ────────────────────────────────────────────────────────────────────
  console.log('① POST /auth/dev-login × 3  (A 队长 / B 申请者 / C 申请者)');
  const loginA = await call('/auth/dev-login', {
    openid: 'dev_teams_a',
    nickname: '组队测试·队长A',
  });
  const loginB = await call('/auth/dev-login', {
    openid: 'dev_teams_b',
    nickname: '组队测试·申请B',
  });
  const loginC = await call('/auth/dev-login', {
    openid: 'dev_teams_c',
    nickname: '组队测试·申请C',
  });
  assert(loginA.body.code === 200, 'A login code=200');
  assert(loginB.body.code === 200, 'B login code=200');
  assert(loginC.body.code === 200, 'C login code=200');
  const tokenA = loginA.body.data.token;
  const tokenB = loginB.body.data.token;
  const tokenC = loginC.body.data.token;
  const meAId = loginA.body.data.user.id;
  const meBId = loginB.body.data.user.id;
  const meCId = loginC.body.data.user.id;
  console.log('   A.id=' + meAId + '  B.id=' + meBId + '  C.id=' + meCId);

  // ────────────────────────────────────────────────────────────────────
  // 1. 准备一个钓点
  // ────────────────────────────────────────────────────────────────────
  console.log('\n② POST /spots/create  (准备钓点)');
  const spotResp = await call(
    '/spots/create',
    {
      name: '组队测试·虚拟江',
      type: 'wild',
      waterType: 'river',
      lat: 32.1234,
      lng: 118.7654,
      accuracy: 10,
      address: '测试地址',
      city: '南京',
      fishSpecies: ['鲫鱼', '鲤鱼'],
    },
    tokenA,
  );
  assert(spotResp.body.code === 200, 'spot create code=200');
  const spotId = spotResp.body.data.id;
  console.log('   spotId=' + spotId);

  // ────────────────────────────────────────────────────────────────────
  // 2. 鉴权
  // ────────────────────────────────────────────────────────────────────
  console.log('\n③ POST /teams/list  (未带 token)');
  const noAuth = await call('/teams/list', { filter: 'all' });
  assert(noAuth.body.code === 401, '未带 token 应 401');

  // ────────────────────────────────────────────────────────────────────
  // 3. A 发起组队
  // ────────────────────────────────────────────────────────────────────
  console.log('\n④ POST /teams/create  (A 发起组队)');
  const startIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString(); // 明天
  const endIso = new Date(Date.now() + 28 * 3600 * 1000).toISOString();
  const createTeam = await call(
    '/teams/create',
    {
      spotId,
      startTime: startIso,
      endTime: endIso,
      targetFish: ['鲫鱼', '鲤鱼'],
      maxPeople: 3,
      costMode: 'aa',
      needCarpool: true,
      note: 'e2e 测试用组队',
    },
    tokenA,
  );
  assert(createTeam.body.code === 200, 'team create code=200');
  const teamId = createTeam.body.data.id;
  console.log('   teamId=' + teamId);

  // ────────────────────────────────────────────────────────────────────
  // 4. 详情
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑤ POST /teams/detail  (A 视角)');
  const dA = await call('/teams/detail', { teamId }, tokenA);
  assert(dA.body.code === 200, 'detail code=200');
  assert(dA.body.data.owner.id === meAId, 'owner = A');
  assert(dA.body.data.joinedCount === 1, '创建后 joinedCount=1 (含 owner)');
  assert(dA.body.data.maxPeople === 3, 'maxPeople=3');
  assert(dA.body.data.status === 'recruiting', '初始 status=recruiting');
  assert(dA.body.data.members.length === 1, '初始 members 长度=1');
  assert(
    dA.body.data.members[0].status === 'approved',
    'owner member 自动 approved',
  );
  assert(
    dA.body.data.yourMemberStatus === 'approved',
    'A 视角 yourMemberStatus=approved',
  );

  // ────────────────────────────────────────────────────────────────────
  // 5. B 申请
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑥ POST /teams/apply  (B 申请加入)');
  const applyB = await call(
    '/teams/apply',
    { teamId, message: 'B 想加入' },
    tokenB,
  );
  assert(applyB.body.code === 200, 'B apply code=200');
  assert(applyB.body.data.status === 'pending', 'B status=pending');

  console.log('\n⑦ POST /teams/apply  (B 再次申请 → 409)');
  const applyBAgain = await call('/teams/apply', { teamId }, tokenB);
  assert(applyBAgain.body.code === 409, 'B 再次申请 → 409');

  // ────────────────────────────────────────────────────────────────────
  // 6. A 不能申请自己组队
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑧ POST /teams/apply  (A 申请自己 → 400)');
  const applyA = await call('/teams/apply', { teamId }, tokenA);
  assert(applyA.body.code === 400, '队长申请自己 → 400');

  // ────────────────────────────────────────────────────────────────────
  // 7. B 不能审核
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑨ POST /teams/review  (B 非队长 → 403)');
  const reviewByB = await call(
    '/teams/review',
    { teamId, userId: meBId, action: 'approve' },
    tokenB,
  );
  assert(reviewByB.body.code === 403, '非队长 review → 403');

  // ────────────────────────────────────────────────────────────────────
  // 8. A 审核通过 B
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑩ POST /teams/review  (A approve B)');
  const approveB = await call(
    '/teams/review',
    { teamId, userId: meBId, action: 'approve' },
    tokenA,
  );
  assert(approveB.body.code === 200, 'approve B code=200');
  assert(approveB.body.data.status === 'approved', 'B status=approved');

  const d2 = await call('/teams/detail', { teamId }, tokenA);
  assert(d2.body.data.joinedCount === 2, 'approve 后 joinedCount=2');
  assert(d2.body.data.status === 'recruiting', '还没满 status=recruiting');

  // ────────────────────────────────────────────────────────────────────
  // 9. C 申请并被 reject
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑪ POST /teams/apply  (C 申请)');
  const applyC = await call('/teams/apply', { teamId }, tokenC);
  assert(applyC.body.code === 200, 'C apply code=200');

  console.log('\n⑫ POST /teams/review  (A reject C)');
  const rejectC = await call(
    '/teams/review',
    { teamId, userId: meCId, action: 'reject' },
    tokenA,
  );
  assert(rejectC.body.code === 200, 'reject C code=200');
  assert(rejectC.body.data.status === 'rejected', 'C status=rejected');

  console.log('\n⑬ POST /teams/apply  (C 被拒后重新申请 → ok)');
  const applyC2 = await call('/teams/apply', { teamId }, tokenC);
  assert(applyC2.body.code === 200, 'C 重新申请 → 200');

  console.log('\n⑭ POST /teams/review  (A approve C → 满员)');
  const approveC = await call(
    '/teams/review',
    { teamId, userId: meCId, action: 'approve' },
    tokenA,
  );
  assert(approveC.body.code === 200, 'approve C code=200');

  const d3 = await call('/teams/detail', { teamId }, tokenA);
  assert(d3.body.data.joinedCount === 3, '满员 joinedCount=3');
  assert(d3.body.data.status === 'full', '满员 status=full');

  // ────────────────────────────────────────────────────────────────────
  // 10. 满员后新申请被拒
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑮ POST /auth/dev-login  (D)');
  const loginD = await call('/auth/dev-login', {
    openid: 'dev_teams_d',
    nickname: '组队测试·D',
  });
  const tokenD = loginD.body.data.token;
  console.log('   ⑯ D 申请满员组队 → 400');
  const applyD = await call('/teams/apply', { teamId }, tokenD);
  assert(applyD.body.code === 400, '满员后申请 → 400');

  // ────────────────────────────────────────────────────────────────────
  // 11. B 退队 → joinedCount-1 + status 回到 recruiting
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑰ POST /teams/cancel-apply  (B 退队)');
  const cancelB = await call('/teams/cancel-apply', { teamId }, tokenB);
  assert(cancelB.body.code === 200, 'cancel B code=200');

  const d4 = await call('/teams/detail', { teamId }, tokenA);
  assert(d4.body.data.joinedCount === 2, '退队后 joinedCount=2');
  assert(d4.body.data.status === 'recruiting', 'full → recruiting');

  // ────────────────────────────────────────────────────────────────────
  // 12. 列表 & users/teams 聚合
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑱ POST /teams/list  (filter=all)');
  const listAll = await call('/teams/list', { filter: 'all', limit: 20 }, tokenA);
  assert(listAll.body.code === 200, 'list code=200');
  const found = listAll.body.data.list.find((t) => t.id === teamId);
  assert(!!found, '我们的 team 应在列表中');
  if (found) {
    assert(found.yourMemberStatus === 'approved', 'A 视角 yourMemberStatus=approved');
    assert(found.costMode === 'aa', 'costMode 透传');
    assert(found.needCarpool === true, 'needCarpool=true');
  }

  console.log('\n⑲ POST /teams/list  (filter=carpool)');
  const listCarpool = await call(
    '/teams/list',
    { filter: 'carpool', limit: 20 },
    tokenA,
  );
  assert(
    listCarpool.body.data.list.some((t) => t.id === teamId),
    'carpool 过滤包含我们的 team',
  );

  console.log('\n⑳ POST /users/teams  role=owner (A)');
  const aOwner = await call('/users/teams', { role: 'owner' }, tokenA);
  assert(aOwner.body.code === 200, 'users/teams code=200');
  assert(
    aOwner.body.data.list.some((t) => t.id === teamId),
    'A.owner 列表包含 team',
  );

  console.log('\n㉑ POST /users/teams  role=joined (C)');
  const cJoined = await call('/users/teams', { role: 'joined' }, tokenC);
  assert(
    cJoined.body.data.list.some((t) => t.id === teamId),
    'C.joined 列表包含 team',
  );

  // ────────────────────────────────────────────────────────────────────
  // 13. 错误兜底
  // ────────────────────────────────────────────────────────────────────
  console.log('\n㉒ POST /teams/detail  teamId="99999999"');
  const noTeam = await call('/teams/detail', { teamId: '99999999' }, tokenA);
  assert(noTeam.body.code === 404, '不存在 team → 404');

  console.log('\n㉓ POST /teams/create  endTime <= startTime');
  const badTime = await call(
    '/teams/create',
    {
      spotId,
      startTime: startIso,
      endTime: startIso,
      maxPeople: 3,
      costMode: 'aa',
    },
    tokenA,
  );
  assert(badTime.body.code === 400, '结束<=开始 → 400');

  console.log('\n㉔ POST /teams/create  spotId="99999999"');
  const badSpot = await call(
    '/teams/create',
    {
      spotId: '99999999',
      startTime: startIso,
      endTime: endIso,
      maxPeople: 3,
      costMode: 'aa',
    },
    tokenA,
  );
  assert(badSpot.body.code === 404, '不存在 spot → 404');

  console.log('\n㉕ POST /teams/create  maxPeople=1 (<2)');
  const badMax = await call(
    '/teams/create',
    {
      spotId,
      startTime: startIso,
      endTime: endIso,
      maxPeople: 1,
      costMode: 'aa',
    },
    tokenA,
  );
  assert(badMax.body.code === 400, 'maxPeople<2 → 400');

  console.log('\n✅ teams e2e 跑完');
})();
