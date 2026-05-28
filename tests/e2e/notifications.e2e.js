// 一次性 e2e 跑通 notifications 模块
//   /notifications/list   /notifications/unread-count   /notifications/read
// 同时验证赞/评论/组队事件触发的通知（A 操作 → B 收到）
// 运行：(后端起在 :3000) 然后 `node tests/e2e/notifications.e2e.js`
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  // ────────────────────────────────────────────────────────────────────
  // 0. 两个 dev 用户:A(动作发起者) / B(通知接收者)
  // ────────────────────────────────────────────────────────────────────
  console.log('① POST /auth/dev-login × 2  (A 触发动作 / B 接收通知)');
  const loginA = await call('/auth/dev-login', {
    openid: 'dev_notif_a',
    nickname: '通知测试·A',
  });
  const loginB = await call('/auth/dev-login', {
    openid: 'dev_notif_b',
    nickname: '通知测试·B',
  });
  assert(loginA.body.code === 200, 'A login code=200');
  assert(loginB.body.code === 200, 'B login code=200');
  const tokenA = loginA.body.data.token;
  const tokenB = loginB.body.data.token;
  const meAId = loginA.body.data.user.id;
  const meBId = loginB.body.data.user.id;
  console.log('   A.id=' + meAId + '  B.id=' + meBId);

  // ────────────────────────────────────────────────────────────────────
  // 1. 未带 token 401
  // ────────────────────────────────────────────────────────────────────
  console.log('\n② POST /notifications/list  (未带 token)');
  const noAuth = await call('/notifications/list', {});
  assert(noAuth.body.code === 401, '未带 token 应 401');

  // ────────────────────────────────────────────────────────────────────
  // 2. 先把 B 历史通知清空,便于断言计数
  // ────────────────────────────────────────────────────────────────────
  console.log('\n③ B 清空历史未读 (all=true)');
  const clear = await call('/notifications/read', { all: true }, tokenB);
  assert(clear.body.code === 200, 'clear code=200');
  const b0 = await call('/notifications/unread-count', {}, tokenB);
  assert(b0.body.code === 200, 'B unread-count code=200');
  assert(b0.body.data.total === 0, '清空后 total=0');

  // ────────────────────────────────────────────────────────────────────
  // 3. B 准备一个钓点 + 一条鱼获
  // ────────────────────────────────────────────────────────────────────
  console.log('\n④ B 准备钓点 + 鱼获');
  const spotResp = await call(
    '/spots/create',
    {
      name: '通知测试·虚拟湖',
      type: 'wild',
      waterType: 'lake',
      lat: 31.5,
      lng: 119.5,
      accuracy: 10,
      address: '测试地址',
      city: '常州',
      fishSpecies: ['鲫鱼'],
    },
    tokenB,
  );
  assert(spotResp.body.code === 200, 'B spot create code=200');
  const spotId = spotResp.body.data.id;

  const catchResp = await call(
    '/catches/create',
    {
      photos: ['notif/seed/b-1.webp'],
      fishSpecies: ['鲫鱼'],
      weight: 600,
      content: 'B 的鱼获,等 A 来赞',
      spotId,
      locationVisible: true,
    },
    tokenB,
  );
  assert(catchResp.body.code === 200, 'B catch create code=200');
  const catchId = catchResp.body.data.id;
  console.log('   catchId=' + catchId);

  // ────────────────────────────────────────────────────────────────────
  // 4. A 点赞 B 的鱼获 → B 收到 catch_like
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑤ A 赞 B 的鱼获');
  const like = await call(
    '/catches/like',
    { catchId, action: 'like' },
    tokenA,
  );
  assert(like.body.code === 200, 'like code=200');

  await sleep(100); // 给 emit 一点时间(虽然是同步 await,这里保险)
  let listB = await call('/notifications/list', { limit: 10 }, tokenB);
  assert(listB.body.code === 200, 'B list code=200');
  let likeNotif = listB.body.data.list.find((n) => n.type === 'catch_like');
  assert(!!likeNotif, 'B 收到 catch_like');
  if (likeNotif) {
    assert(likeNotif.actor && likeNotif.actor.id === meAId, 'catch_like actor=A');
    assert(likeNotif.refType === 'catch' && likeNotif.refId === catchId, 'refType=catch refId 一致');
    assert(likeNotif.group === 'like', 'group=like');
    assert(likeNotif.readAt === null, '新通知 readAt=null');
  }

  // ────────────────────────────────────────────────────────────────────
  // 5. A 重复赞(幂等) → 不应再产生第二条通知
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑥ A 重复赞 (幂等,不应再发通知)');
  await call('/catches/like', { catchId, action: 'like' }, tokenA);
  listB = await call('/notifications/list', { type: 'catch_like', limit: 10 }, tokenB);
  const likeCount = listB.body.data.list.filter(
    (n) => n.type === 'catch_like' && n.refId === catchId,
  ).length;
  assert(likeCount === 1, 'catch_like 只有 1 条 (幂等)');

  // ────────────────────────────────────────────────────────────────────
  // 6. A 收藏 B 的鱼获 → catch_collect
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑦ A 收藏 B 的鱼获');
  await call('/catches/collect', { catchId, action: 'collect' }, tokenA);
  listB = await call('/notifications/list', { limit: 10 }, tokenB);
  const collectNotif = listB.body.data.list.find((n) => n.type === 'catch_collect');
  assert(!!collectNotif, 'B 收到 catch_collect');

  // ────────────────────────────────────────────────────────────────────
  // 7. A 评论 B 的鱼获 → catch_comment;再 B 回复 A → comment_reply
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑧ A 评论 B 的鱼获');
  const cmt = await call(
    '/comments/create',
    { catchId, content: '帅啊,这条多重?' },
    tokenA,
  );
  assert(cmt.body.code === 200, 'A 评论 code=200');
  const commentId = cmt.body.data.id;

  listB = await call('/notifications/list', { group: 'comment', limit: 10 }, tokenB);
  const cmtNotif = listB.body.data.list.find((n) => n.type === 'catch_comment');
  assert(!!cmtNotif, 'B 收到 catch_comment');
  if (cmtNotif) {
    assert(cmtNotif.payload && cmtNotif.payload.excerpt, 'catch_comment 带 excerpt');
  }

  console.log('\n⑨ B 回复 A 的评论 → A 收到 comment_reply');
  await call(
    '/comments/create',
    { catchId, parentId: commentId, content: '600 克板鲫' },
    tokenB,
  );
  const listA = await call('/notifications/list', { limit: 10 }, tokenA);
  const replyNotif = listA.body.data.list.find((n) => n.type === 'comment_reply');
  assert(!!replyNotif, 'A 收到 comment_reply');

  // ────────────────────────────────────────────────────────────────────
  // 8. B 赞 A 的评论 → A 收到 comment_like
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑩ B 赞 A 的评论');
  await call('/comments/like', { commentId, action: 'like' }, tokenB);
  const listA2 = await call('/notifications/list', { group: 'like', limit: 10 }, tokenA);
  const cLike = listA2.body.data.list.find((n) => n.type === 'comment_like');
  assert(!!cLike, 'A 收到 comment_like');

  // ────────────────────────────────────────────────────────────────────
  // 9. 自己给自己不应发通知:A 评论自己鱼获前先准备 A 的鱼获
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑪ A 准备自己一条鱼获,自己点赞自己 → 不应产生通知');
  const aCatch = await call(
    '/catches/create',
    {
      photos: ['notif/seed/a-1.webp'],
      fishSpecies: ['鲤鱼'],
      weight: 1200,
      content: 'A 的鱼获,自赞',
      spotId,
      locationVisible: true,
    },
    tokenA,
  );
  const aCatchId = aCatch.body.data.id;
  await call('/catches/like', { catchId: aCatchId, action: 'like' }, tokenA);
  const listA3 = await call(
    '/notifications/list',
    { type: 'catch_like', limit: 50 },
    tokenA,
  );
  const selfLike = listA3.body.data.list.find(
    (n) => n.type === 'catch_like' && n.refId === aCatchId,
  );
  assert(!selfLike, '自己赞自己不应产生通知');

  // ────────────────────────────────────────────────────────────────────
  // 10. 未读数 + 分组
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑫ B unread-count');
  const u = await call('/notifications/unread-count', {}, tokenB);
  assert(u.body.code === 200, 'unread-count code=200');
  console.log('   →', shortJson(u.body.data));
  assert(u.body.data.total >= 3, 'B 未读 >=3 (like + collect + comment)');
  assert(u.body.data.byGroup.like >= 2, 'like 分组 >=2 (catch_like + catch_collect)');
  assert(u.body.data.byGroup.comment >= 1, 'comment 分组 >=1');

  // ────────────────────────────────────────────────────────────────────
  // 11. 按 group=like 拉列表 → 只含 like/collect/comment_like
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑬ B list group=like 仅含 like 系类型');
  const onlyLike = await call(
    '/notifications/list',
    { group: 'like', limit: 50 },
    tokenB,
  );
  const allLikeGroup = onlyLike.body.data.list.every(
    (n) => n.group === 'like',
  );
  assert(allLikeGroup, 'group=like 列表内所有项 group=like');

  // ────────────────────────────────────────────────────────────────────
  // 12. unreadOnly=true 应只拿到未读
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑭ B unreadOnly=true 全部未读');
  const onlyUnread = await call(
    '/notifications/list',
    { unreadOnly: true, limit: 50 },
    tokenB,
  );
  const allUnread = onlyUnread.body.data.list.every((n) => n.readAt === null);
  assert(allUnread, 'unreadOnly=true 所有项 readAt=null');

  // ────────────────────────────────────────────────────────────────────
  // 13. 标记单条已读
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑮ B 标记一条已读');
  const oneId = onlyUnread.body.data.list[0].id;
  const oneRead = await call('/notifications/read', { ids: [oneId] }, tokenB);
  assert(oneRead.body.code === 200, 'read by ids code=200');
  assert(oneRead.body.data.updated === 1, '只标记 1 条');

  // ────────────────────────────────────────────────────────────────────
  // 14. 组队场景:B 发起组队 → A 申请 → B 收到 team_apply
  //     B approve → A 收到 team_review_approved
  //     A cancelApply → B 收到 team_member_left
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑯ B 发起组队');
  const startIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const endIso = new Date(Date.now() + 28 * 3600 * 1000).toISOString();
  const teamResp = await call(
    '/teams/create',
    {
      spotId,
      startTime: startIso,
      endTime: endIso,
      targetFish: ['鲫鱼'],
      maxPeople: 3,
      costMode: 'aa',
    },
    tokenB,
  );
  assert(teamResp.body.code === 200, 'B team create code=200');
  const teamId = teamResp.body.data.id;

  console.log('\n⑰ A 申请 → B 应收到 team_apply');
  await call('/teams/apply', { teamId, message: '想加入' }, tokenA);
  let teamListB = await call(
    '/notifications/list',
    { type: 'team_apply', limit: 5 },
    tokenB,
  );
  const applyNotif = teamListB.body.data.list.find(
    (n) => n.type === 'team_apply' && n.refId === teamId,
  );
  assert(!!applyNotif, 'B 收到 team_apply');

  console.log('\n⑱ B 通过 A → A 应收到 team_review_approved');
  await call(
    '/teams/review',
    { teamId, userId: meAId, action: 'approve' },
    tokenB,
  );
  let teamListA = await call(
    '/notifications/list',
    { type: 'team_review_approved', limit: 5 },
    tokenA,
  );
  const approvedNotif = teamListA.body.data.list.find(
    (n) => n.type === 'team_review_approved' && n.refId === teamId,
  );
  assert(!!approvedNotif, 'A 收到 team_review_approved');

  console.log('\n⑲ A 退队 → B 应收到 team_member_left');
  await call('/teams/cancel-apply', { teamId }, tokenA);
  teamListB = await call(
    '/notifications/list',
    { type: 'team_member_left', limit: 5 },
    tokenB,
  );
  const leftNotif = teamListB.body.data.list.find(
    (n) => n.type === 'team_member_left' && n.refId === teamId,
  );
  assert(!!leftNotif, 'B 收到 team_member_left');

  // ────────────────────────────────────────────────────────────────────
  // 15. 标记某 group 全部已读
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑳ B 把 team 分组全部标已读');
  const teamReadAll = await call(
    '/notifications/read',
    { all: true, group: 'team' },
    tokenB,
  );
  assert(teamReadAll.body.code === 200, 'team read all code=200');
  const afterTeamRead = await call('/notifications/unread-count', {}, tokenB);
  assert(afterTeamRead.body.data.byGroup.team === 0, 'team 分组未读=0');

  // ────────────────────────────────────────────────────────────────────
  // 16. 错误用例:read 不带 ids 也不带 all → 400
  // ────────────────────────────────────────────────────────────────────
  console.log('\n㉑ /notifications/read 既无 ids 也无 all → 400');
  const noArg = await call('/notifications/read', {}, tokenB);
  assert(noArg.body.code === 400, '无参数 400');

  console.log('\n✅ notifications e2e 执行完毕');
  console.log('   exitCode=' + (process.exitCode || 0));
})();
