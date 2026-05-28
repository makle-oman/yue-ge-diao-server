// 一次性 e2e 跑通 comments 模块 4 个接口；覆盖一二级评论 / 点赞 / 删除权限 / 拍平 / 错误兜底
// 运行：(后端已起在 :3000) 然后 `node tests/e2e/comments.e2e.js`
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

function shortJson(obj, maxLen = 200) {
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
  // 0. 两个 dev 用户：A（鱼获主） / B（评论的人）
  // ────────────────────────────────────────────────────────────────────
  console.log('① POST /auth/dev-login × 2  (A 鱼获主 / B 评论者)');
  const loginA = await call('/auth/dev-login', {
    openid: 'dev_comments_a',
    nickname: '评论测试·主A',
  });
  const loginB = await call('/auth/dev-login', {
    openid: 'dev_comments_b',
    nickname: '评论测试·客B',
  });
  assert(loginA.body.code === 200, 'A login code=200');
  assert(loginB.body.code === 200, 'B login code=200');
  const tokenA = loginA.body.data.token;
  const tokenB = loginB.body.data.token;
  const meAId = loginA.body.data.user.id;
  const meBId = loginB.body.data.user.id;
  console.log('   A.id=' + meAId + '  B.id=' + meBId);

  // ────────────────────────────────────────────────────────────────────
  // 1. A 发一条鱼获，方便后续评论
  // ────────────────────────────────────────────────────────────────────
  console.log('\n② POST /catches/create  (A 准备一条鱼获)');
  const createCatch = await call(
    '/catches/create',
    {
      photos: ['https://example.com/comment-test.jpg'],
      fishSpecies: ['鲫鱼'],
      weight: 320,
      length: 22,
      technique: 'taiwan',
      content: '评论测试用鱼获',
      locationVisible: true,
      allowComments: true,
    },
    tokenA,
  );
  assert(createCatch.body.code === 200, 'create code=200');
  const catchId = createCatch.body.data.id;
  console.log('   catchId=' + catchId + '  reviewStatus=' + createCatch.body.data.reviewStatus);

  // 注:若默认审核状态为 pending,需要 DB 直接置 approved 才能测;
  //    本脚本假设环境的 defaultReviewStatus 为 approved（dev/test 环境）
  if (createCatch.body.data.reviewStatus !== 'approved') {
    console.log('   ⚠ catch 当前为 ' + createCatch.body.data.reviewStatus + ',后续 comments 接口会 404');
    console.log('   ⚠ dev 环境请把 CATCH_DEFAULT_REVIEW_STATUS=approved');
  }

  // ────────────────────────────────────────────────────────────────────
  // 2. 鉴权
  // ────────────────────────────────────────────────────────────────────
  console.log('\n③ POST /comments/list  (未带 token)');
  const noAuth = await call('/comments/list', { catchId });
  assert(noAuth.body.code === 401, '未带 token 应 401');

  // ────────────────────────────────────────────────────────────────────
  // 3. B 发一级评论 + A 回复（二级）+ B 再发一级
  // ────────────────────────────────────────────────────────────────────
  console.log('\n④ POST /comments/create  (B 发一级评论)');
  const c1 = await call(
    '/comments/create',
    { catchId, content: '这条鱼不错!' },
    tokenB,
  );
  assert(c1.body.code === 200, '一级评论 code=200');
  assert(c1.body.data.parentId === null, '一级评论 parentId=null');
  const c1Id = c1.body.data.id;

  console.log('\n⑤ POST /comments/create  (A 作者回复 B)');
  const r1 = await call(
    '/comments/create',
    { catchId, content: '谢谢支持', parentId: c1Id },
    tokenA,
  );
  assert(r1.body.code === 200, '二级回复 code=200');
  assert(r1.body.data.parentId === c1Id, '二级回复 parentId 指向 c1');

  console.log('\n⑥ POST /comments/create  (B 回复 A 的回复 → 应拍平到 c1)');
  const r2 = await call(
    '/comments/create',
    { catchId, content: '不客气', parentId: r1.body.data.id },
    tokenB,
  );
  assert(r2.body.code === 200, '三级回复(被拍平) code=200');
  assert(
    r2.body.data.parentId === c1Id,
    '三级回复 parentId 应拍平为 c1Id(实际=' + r2.body.data.parentId + ')',
  );

  console.log('\n⑦ POST /comments/create  (B 再发一级评论)');
  const c2 = await call(
    '/comments/create',
    { catchId, content: '收藏了' },
    tokenB,
  );
  assert(c2.body.code === 200, '二级评论 code=200');
  const c2Id = c2.body.data.id;

  // ────────────────────────────────────────────────────────────────────
  // 4. 列表（new 排序 + replies 整组）
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑧ POST /comments/list  sort=new');
  const list1 = await call(
    '/comments/list',
    { catchId, sort: 'new', limit: 20 },
    tokenB,
  );
  assert(list1.body.code === 200, 'list code=200');
  const list = list1.body.data.list;
  assert(list.length === 2, '一级评论数 = 2 (实际 ' + list.length + ')');
  assert(list[0].id === c2Id, 'new 排序最新在前 → 第一条应是 c2');
  const c1Row = list.find((x) => x.id === c1Id);
  assert(!!c1Row, 'c1 应在列表中');
  assert(
    c1Row.replies && c1Row.replies.length === 2,
    'c1 应有 2 条 replies (实际 ' + (c1Row.replies?.length ?? 0) + ')',
  );
  assert(list1.body.data.total === 4, 'total 应为 4 (2 一级 + 2 回复)');
  assert(list1.body.data.allowComments === true, 'allowComments=true');

  // 鱼获主标签
  const replyByA = c1Row.replies.find((r) => r.userId === meAId);
  assert(!!replyByA, 'A 的回复应被识别');
  assert(replyByA.isAuthor === true, 'A 的回复 isAuthor=true');

  // ────────────────────────────────────────────────────────────────────
  // 5. 点赞 / 取消
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑨ POST /comments/like  action=like (B 给 c2 点赞,自己赞自己也可)');
  const lk1 = await call(
    '/comments/like',
    { commentId: c2Id, action: 'like' },
    tokenB,
  );
  assert(lk1.body.code === 200 && lk1.body.data.likeCount === 1, 'like c2 → 1');

  console.log('\n⑩ POST /comments/like  action=like (B 再点一次,幂等)');
  const lk2 = await call(
    '/comments/like',
    { commentId: c2Id, action: 'like' },
    tokenB,
  );
  assert(lk2.body.data.likeCount === 1, '幂等 like → 仍为 1');

  console.log('\n⑪ POST /comments/like  action=unlike');
  const lk3 = await call(
    '/comments/like',
    { commentId: c2Id, action: 'unlike' },
    tokenB,
  );
  assert(lk3.body.data.likeCount === 0, 'unlike → 0');

  // ────────────────────────────────────────────────────────────────────
  // 6. 删除权限
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑫ POST /comments/remove  (B 想删 A 的回复 → 403)');
  const delForbidden = await call(
    '/comments/remove',
    { commentId: r1.body.data.id },
    tokenB,
  );
  assert(delForbidden.body.code === 403, 'B 删非自己评论 → 403');

  console.log('\n⑬ POST /comments/remove  (A 作为鱼获主删 B 的 c2 → 应允许)');
  const delOk = await call('/comments/remove', { commentId: c2Id }, tokenA);
  assert(delOk.body.code === 200, '鱼获主删评论 → 200');
  assert(delOk.body.data.removed === 1, '只删了 1 条(c2 无 reply)');

  console.log('\n⑭ POST /comments/remove  (B 删自己的 c1 → 连带 2 个 reply)');
  const delCascade = await call(
    '/comments/remove',
    { commentId: c1Id },
    tokenB,
  );
  assert(delCascade.body.code === 200, '删一级 → 200');
  assert(
    delCascade.body.data.removed === 3,
    '一级 + 2 reply = 3 条 (实际 ' + delCascade.body.data.removed + ')',
  );
  assert(
    delCascade.body.data.commentCount === 0,
    '删完后 catch.commentCount = 0',
  );

  // ────────────────────────────────────────────────────────────────────
  // 7. 错误兜底
  // ────────────────────────────────────────────────────────────────────
  console.log('\n⑮ POST /comments/list  catchId="99999999"');
  const noCatch = await call(
    '/comments/list',
    { catchId: '99999999' },
    tokenB,
  );
  assert(noCatch.body.code === 404, '鱼获不存在 → 404');

  console.log('\n⑯ POST /comments/create  parentId 不属于该 catchId');
  const wrongParent = await call(
    '/comments/create',
    { catchId, content: 'x', parentId: '99999999' },
    tokenB,
  );
  assert(wrongParent.body.code === 404, '非法 parentId → 404');

  console.log('\n⑰ POST /comments/create  content 为空');
  const emptyContent = await call(
    '/comments/create',
    { catchId, content: '   ' },
    tokenB,
  );
  assert(
    emptyContent.body.code === 400,
    '空内容 → 400 (实际 ' + emptyContent.body.code + ')',
  );

  console.log('\n⑱ POST /comments/create  content 超长');
  const longContent = await call(
    '/comments/create',
    { catchId, content: 'x'.repeat(501) },
    tokenB,
  );
  assert(longContent.body.code === 400, '>500 字 → 400');

  console.log('\n✅ comments e2e 跑完');
})();
