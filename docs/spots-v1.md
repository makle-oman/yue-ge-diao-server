# Spots 模块（F2 钓点） · 后端交付说明 v1

> 交付时间：2026-05-25
> 范围：后端 NestJS 7 个接口 + geohash 空间索引工具 + 18 个断言 e2e
> 前端联调：待接（前端可按 §6 接入指引调用）

---

## 1. 概览

钓点（spots）模块对应需求文档 F2，提供"地图首页/附近/搜索/详情/标记想去/历史鱼获"全套查询和上报。

后端能力：

| # | 接口 | 鉴权 | 用途 |
|---|------|-----|------|
| 1 | `POST /api/spots/list` | 公开 | 首页地图/列表，按经纬度+半径取邻域，按距离排序，cursor 分页 |
| 2 | `POST /api/spots/nearby` | 公开 | "发鱼获"前选钓点，扁平 list，无分页 |
| 3 | `POST /api/spots/search` | 公开 | 关键词 / 类型 / 水域 / 城市 / 评分 / 停车厕所 多条件搜索，cursor 分页 |
| 4 | `POST /api/spots/detail` | 需登录 | 钓点详情，含 7/30 天鱼获数、最近鱼获时间、当前用户 `yourWantStatus` |
| 5 | `POST /api/spots/create` | 需登录 | 用户上报钓点，accuracy<50m 防作弊，自动算 geohash，默认 `approved` |
| 6 | `POST /api/spots/want` | 需登录 | 标记/取消想去，事务内更新 want_count，幂等 |
| 7 | `POST /api/spots/history` | 公开 | 钓点的历史鱼获列表 + 7 天趋势柱图数据 |

---

## 2. 接口契约

约定信封：所有响应包裹在 `{code, msg, data, traceId}`，`code===200` 为成功，其它（含 400/401/403/404/500）一律业务失败。下方 schema 均指 `data` 字段。

### 2.1 `POST /spots/list`

**请求：**

```json
{
  "lat": 39.9087,       // 必填，纬度 [-90, 90]
  "lng": 116.3975,      // 必填，经度 [-180, 180]
  "radius": 20000,      // 选填，米；默认 5000；支持任意正数
  "limit": 20,          // 选填，默认 20
  "cursor": null,       // 选填，base64({o:offset})
  "city": "北京",        // 选填，精确匹配
  "type": "wild"        // 选填，wild|black|paid|sea
}
```

**响应：**

```json
{
  "list": [
    {
      "id": "7",
      "name": "颐和园昆明湖",
      "type": "wild",
      "waterType": "lake",
      "lat": 39.9999,
      "lng": 116.2755,
      "address": "北京市海淀区颐和园路",
      "city": "北京",
      "distance": 14525,     // 米，按 Haversine 算的直线距离
      "avgRating": 0,
      "ratingCount": 0,
      "wantCount": 0,
      "photos": ["spots/seed/yiheyuan-1.webp"],
      "fishSpecies": ["鲫鱼","鲤鱼","草鱼"],
      "createdAt": "2026-05-25T02:52:58.696Z"
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

服务端逻辑：
1. `precisionForRadius(radius)` 决定 geohash 精度（3-7，越大越细）。
2. `neighbors(lat, lng, precision)` 算出 9 个 geohash 前缀。
3. SQL `WHERE LEFT(geohash, p) IN (...)` 粗筛。
4. 内存里跑 Haversine 精算距离，丢弃 `>radius` 的，按距离升序排。
5. Cursor 分页（base64 编码 `{o: offset}`）。

### 2.2 `POST /spots/nearby`

请求和 list 一样（不要 `cursor`），响应只有 `{list}`，扁平、不分页，最多 `limit` 条（默认 50）。

### 2.3 `POST /spots/search`

**请求：**

```json
{
  "keyword": "水库",        // 选填，对 name 和 city 做 LIKE
  "type": "wild",          // 选填
  "waterType": "reservoir",// 选填
  "city": "北京",           // 选填
  "minRating": 4,          // 选填
  "hasParking": true,      // 选填，JSON_EXTRACT(facilities,'$.park')=true
  "hasToilet": true,       // 选填
  "limit": 20,             // 选填
  "cursor": null
}
```

**响应：** 同 list（但元素无 `distance`，因为搜索不传当前位置）。

**排序：** `avg_rating DESC, (rating_count + want_count) DESC, created_at DESC`（评分>热度>新鲜）。

### 2.4 `POST /spots/detail`

**请求：** `{"spotId": "7"}`

**响应（除基础字段外的关键扩展）：**

```json
{
  "id": "7",
  "name": "颐和园昆明湖",
  "...": "其它基础字段同 list 元素",
  "description": "颐和园湖区可垂钓，环境优雅",
  "facilities": {"paid":true,"park":true,"toilet":true},
  "creatorId": "2",
  "creatorName": "钓点测试员",
  "creatorAvatar": null,
  "createdAt": "2026-05-25T02:52:58.696Z",
  "updatedAt": "2026-05-25T02:52:58.696Z",
  "catchCount7Days": 0,
  "catchCount30Days": 0,
  "lastCatchTime": null,
  "yourWantStatus": false       // 当前用户是否已标记"想去"
}
```

后端并发跑 4 个查询（7 天鱼获数 / 30 天鱼获数 / 最近一条鱼获 / 当前用户 wantStatus），用 `Promise.all` 聚合。

### 2.5 `POST /spots/create`

**请求：**

```json
{
  "name": "颐和园昆明湖",   // 必填，1-50 字
  "type": "wild",         // 必填，wild|black|paid|sea
  "waterType": "lake",    // 选填，river|lake|reservoir|pond|sea
  "lat": 39.9999,         // 必填
  "lng": 116.2755,        // 必填
  "accuracy": 12,         // 选填，定位精度米。>50 直接 403
  "address": "...",        // 选填
  "city": "北京",          // 选填
  "description": "...",    // 选填
  "fishSpecies": ["鲫鱼"], // 选填，字符串数组
  "facilities": {"park":true,"toilet":true,"paid":true},   // 选填
  "photos": ["spots/seed/yiheyuan-1.webp"]                  // 选填
}
```

**响应：** `{"id":"7","status":"approved","createdAt":"..."}`

防作弊：`accuracy>50m` → `403 定位精度 100m 太低，必须 < 50m`。
status：当前默认 `approved`（无审核）。`spots.service.ts` 里有 `TODO(content-review)` 标记，接入 `imgSecCheck/msgSecCheck` 后改回 `pending`。

### 2.6 `POST /spots/want`

**请求：** `{"spotId": "7", "action": "want"}`（或 `"unwant"`）

**响应：** `{"ok": true, "wantCount": 1}`

实现细节：`prisma.$transaction` 内：
- 先查 `spotWants` 联合主键 `(spotId, userId)`；
- want + 不存在 → 插 want 行 + `wantCount: { increment: 1 }`；
- unwant + 已存在 → 删 want 行 + `wantCount = max(0, cur - 1)`（防御性钳制不为负）；
- 其它（重复 want / 重复 unwant）→ no-op，幂等。

### 2.7 `POST /spots/history`

**请求：**

```json
{
  "spotId": "7",
  "days": 7,         // 选填，默认 7。鱼获列表过滤窗口
  "limit": 20,
  "cursor": null
}
```

**响应：**

```json
{
  "catches": [
    {
      "id": "...",
      "userId": "...",
      "userName": "钓友xxx",
      "userAvatar": null,
      "photos": [],
      "fishSpecies": ["鲫鱼"],
      "weight": 500,        // 克
      "length": 25,         // 厘米
      "content": "...",
      "likeCount": 0,
      "commentCount": 0,
      "createdAt": "..."
    }
  ],
  "weekTrend": [
    {"date": "2026-05-19", "count": 0},
    {"date": "2026-05-20", "count": 0},
    {"date": "2026-05-21", "count": 0},
    {"date": "2026-05-22", "count": 0},
    {"date": "2026-05-23", "count": 0},
    {"date": "2026-05-24", "count": 0},
    {"date": "2026-05-25", "count": 0}
  ],
  "total": 0,
  "nextCursor": null,
  "hasMore": false
}
```

`weekTrend` 固定 7 个桶（最近 7 天，按本地日 `YYYY-MM-DD` 聚合），与 `days` 参数无关 —— `days` 只影响 `catches` 列表的窗口。

---

## 3. Geohash 空间索引：设计要点

`src/common/utils/geohash.ts` 自实现，无外部依赖。

### 3.1 精度→半径映射

```ts
precisionForRadius(radiusM):
  <=170m   -> 7   // cell.smaller=153m,  9-cell coverage ≈ 459m
  <=900m   -> 6   // cell.smaller=610m,  9-cell coverage ≈ 1.8km
  <=5_500  -> 5   // cell.smaller=4.89km,9-cell coverage ≈ 14.7km
  <=29_000 -> 4   // cell.smaller=19.5km,9-cell coverage ≈ 58.5km
  else     -> 3   // cell.smaller=156km, 9-cell coverage ≈ 468km
```

约束：**cell 短边 × 1.5 ≥ 查询半径**（保证 9 格圆环覆盖整个查询圆）。

### 3.2 `neighbors()` 算法

不是用"输入点 ± dCell"探，而是：

1. 先 `encode(lat,lng,precision)` 得到中心 cell 的 hash。
2. `decode(hash)` 解出该 cell 的真实 bbox `[latMin, latMax, lngMin, lngMax]`。
3. 取 cell 的几何中心 `(latC, lngC)`，cell 宽度 `dLat = latMax-latMin`、`dLng = lngMax-lngMin`。
4. 9 个探点：`{(latC+dy, lngC+dx) | dy,dx ∈ {-dLat,0,dLat} × {-dLng,0,dLng}}`，每个 encode 一次。

**为什么这样：** 直接用"输入点 ± cell_width 度数"探，遇上输入点接近自己 cell 边缘时，探点会越过相邻 cell 进入更外面那格。改成"从自己 cell 的几何中心 ± cell 真实宽度"，永远精确落到相邻 cell 的几何中心，鲁棒。

地理坐标和 geohash bit-split 没有简单整数倍关系（偶数精度 lng 宽是 lat 高的 2 倍），所以靠 decode 拿真实 bbox 才安全。

### 3.3 `distanceM()`

标准 Haversine，球半径 6_371_000 m。返回米。

---

## 4. 数据库表

涉及 3 张表（schema 已在 `prisma/schema.prisma`，未改动）：

| 表 | 用途 | 关键索引 |
|----|------|---------|
| `spots` | 钓点主表 | `geohash` 普通索引（前缀查询走 `LEFT(geohash, p) IN (...)`），`creator_id`、`type`、`city`、`status` |
| `spot_wants` | 用户标记想去（多对多）| 复合主键 `(spot_id, user_id)`，FK 级联删除 |
| `catches` | history 接口读 | `spot_id`、`review_status`、`created_at` |

`spots.want_count` 是冗余计数，由 want/unwant 接口在事务里同步维护，避免 `COUNT(*)` 实时算。

---

## 5. 测试覆盖

`tests/e2e/spots.e2e.js`，18 个断言：

| 步骤 | 断言数 | 覆盖 |
|------|-------|------|
| dev-login | 1 | 拿 token |
| create × 3 | 3 | 三种类型钓点（湖/水库/海）|
| list@20km / 100km / 200km | 4 | 距离过滤精确性 + geohash 邻域正确性 |
| nearby | 1 | 返回扁平 list |
| search keyword=水库 | 1 | LIKE 命中 |
| search hasParking=true | 3 | JSON_EXTRACT 复合过滤 |
| detail 初次 | 2 | 字段完整 + yourWantStatus=false |
| want + 重复want + detail | 3 | 幂等 + wantCount 同步 + yourWantStatus=true |
| unwant | 1 | wantCount 归 0 |
| history 空 | 5 | catches 数组 + weekTrend 7 桶全 0 |
| 错误路径 404/400/401/403 | 4 | 不存在 / 非法格式 / 未登录 / 精度过低 |
| **合计** | **18 ✔** | |

运行：

```bash
# 终端 A
npm run start:dev

# 终端 B
node tests/e2e/spots.e2e.js
# 成功末尾打印 "✅ 全部断言通过！"
```

---

## 6. 前端接入指引

照搬 `约个钓-前端联调进度-v1.md` §7 的模板。

```ts
// yue-ge-diao/src/api/spots.ts
import { http } from '@/utils/request';

export interface SpotListItem {
  id: string; name: string; type: string; waterType: string | null;
  lat: number; lng: number; address: string | null; city: string | null;
  distance?: number; avgRating: number; ratingCount: number; wantCount: number;
  photos: string[]; fishSpecies: string[]; createdAt: string;
}

export function listSpots(params: {
  lat: number; lng: number; radius?: number; limit?: number; cursor?: string|null;
  city?: string; type?: 'wild'|'black'|'paid'|'sea';
}) {
  return http.post<{list: SpotListItem[]; nextCursor: string|null; hasMore: boolean}>(
    '/spots/list', params,
  );
}

export function nearbySpots(params: {lat:number;lng:number;radius?:number;limit?:number}) {
  return http.post<{list: SpotListItem[]}>('/spots/nearby', params);
}

export function searchSpots(params: {
  keyword?: string; type?: string; waterType?: string; city?: string;
  minRating?: number; hasParking?: boolean; hasToilet?: boolean;
  limit?: number; cursor?: string|null;
}) {
  return http.post<{list: SpotListItem[]; nextCursor: string|null; hasMore: boolean}>(
    '/spots/search', params,
  );
}

export function spotDetail(spotId: string) {
  return http.post('/spots/detail', { spotId });
}

export function createSpot(payload: {
  name: string; type: 'wild'|'black'|'paid'|'sea'; waterType?: string;
  lat: number; lng: number; accuracy?: number;
  address?: string; city?: string; description?: string;
  fishSpecies?: string[]; facilities?: Record<string, boolean>;
  photos?: string[];
}) {
  return http.post<{id: string; status: string; createdAt: string}>('/spots/create', payload);
}

export function wantSpot(spotId: string, action: 'want'|'unwant') {
  return http.post<{ok: boolean; wantCount: number}>('/spots/want', { spotId, action });
}

export function spotHistory(spotId: string, opts: {days?:number;limit?:number;cursor?:string|null} = {}) {
  return http.post('/spots/history', { spotId, ...opts });
}
```

页面调用示例：

```ts
// 首页地图 onShow 拉附近钓点
const loc = await uni.getLocation({ type: 'gcj02' });
const { list } = await nearbySpots({ lat: loc.latitude, lng: loc.longitude, radius: 5000 });
// list 已按距离升序，每个 item 有 distance 字段
```

---

## 7. 已知 TODO / 后续

| 优先级 | 项 | 备注 |
|--------|----|------|
| P0 | 内容审核 | 接入微信 `imgSecCheck/msgSecCheck` 后，`SpotsService.defaultCreateStatus` 改回 `'pending'`，并加管理员审核接口 |
| P1 | seed 钓点（北京 / 上海 / 广州 各 5-10 个） | 现在 DB 只有 e2e 测试残留的脏 fixture |
| P1 | 精度 8 之上的高精度查询（半径 < 100m）| 现 `precisionForRadius` 最大到 7，半径 100m 内的"超近"查询走精度 7 ≈ 153m cell，对外圈条件略宽 |
| P1 | 后端缓存（city 维度热钓点）| TopN 钓点缓存到 Redis，刷首页时直接读 |
| P2 | 钓点编辑接口（仅 creator） | 当前 create 后不可改 |
| P2 | spots 软删除 | 现 hard delete via SQL，被举报的钓点没有 status 流转 |
| P2 | 距离排序之外的"综合得分排序"（list 默认）| 评分/热度/新鲜的加权混排，需要后续 A/B |

---

## 8. 变更日志

- **2026-05-25 v1**：首版交付，7 个接口 + geohash 工具 + 18 个 e2e 断言通过。
