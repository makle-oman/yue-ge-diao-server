# e2e 集成测试（HTTP 直打）

目前没接正式 test runner，这里的 *.e2e.js 都是用 `node:http` 直接打后端接口的快速集成测试。

## 前置条件

后端服务先跑起来（`npm run start:dev`），监听 `http://localhost:3000/api`。

## 跑法

```bash
node tests/e2e/spots.e2e.js
```

成功输出末尾 `✅ 全部断言通过！`。

## 已覆盖

- **spots.e2e.js** — F2 钓点模块 18 个断言：
  - dev-login 拿 token
  - create × 3（颐和园 / 怀柔水库 / 滨海海钓码头）
  - list / nearby 三档半径（20km / 100km / 200km）
  - search 关键词 / hasParking
  - detail（含 yourWantStatus）
  - want / unwant / 幂等
  - history + weekTrend
  - 错误路径：spotId 不存在 → 404、非法 spotId → 400、未登录 → 401、accuracy>50m → 403

## 注意：DB fixture 残留

脚本每次 create 同名钓点，不清理也不报错。如果 list 输出里看到同名条目重复多次（id=1,4,7,…），是历史 fixture，不是 bug。
后续接 CI 时可以在 setup 阶段先 SQL 清理，或把 fixture 名字带上 run-id 后缀。
