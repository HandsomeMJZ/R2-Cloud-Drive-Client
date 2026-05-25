# R2 Cloud Drive API 说明文档

本文档根据当前 `worker.js` 实际路由整理，面向后续桌面端、移动端或命令行软件对接使用。

## 1. 基础信息

- 基准地址：`https://cloud.junzhen.qzz.io`，例如 `https://cloud.example.com`
- 数据格式：大多数管理接口使用 JSON；上传和下载接口直接传输二进制文件流。
- 路径格式：接口中的 `path` 是虚拟文件路径，不要以 `/` 开头，例如 `docs/a.txt`；真实 R2 对象会存储在桶根目录，并通过 KV 文件表和目录索引映射。
- URL 参数必须编码：例如 `shared/测试 1.png` 应写成 `shared%2F%E6%B5%8B%E8%AF%95%201.png`。
- 如果设置了 `ACCESS_PASSWORD`，除公开接口外都需要先登录并携带 Cookie。
- 如果未设置 `ACCESS_PASSWORD`，主 API 视为公开访问，`/api/login` 会直接返回 `{ "ok": true }`。

示例变量：

```bash
BASE="https://cloud.junzhen.qzz.io"
COOKIE="cookie.txt"
```

## 2. 认证接口

### 2.1 登录

```http
POST /api/login
Content-Type: application/json
```

请求体：

```json
{
  "password": "你的 ACCESS_PASSWORD"
}
```

成功响应：

```json
{
  "ok": true
}
```

登录成功后，服务端会设置 Cookie：

```text
r2drive_session=...; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
```

客户端软件需要保存并在后续请求中携带这个 Cookie。Cookie 有效期为 7 天。

curl 示例：

```bash
curl -i -c "$COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"password":"你的密码"}' \
  "$BASE/api/login"
```

### 2.2 登出

```http
POST /api/logout
```

响应：

```json
{}
```

curl 示例：

```bash
curl -b "$COOKIE" -c "$COOKIE" -X POST "$BASE/api/logout"
```

## 3. 公开接口

### 3.1 共享目录页面

```http
GET /shared
GET /shared?path=子目录
```

返回 HTML 页面，供浏览器访问。

### 3.2 获取共享目录列表

```http
GET /api/shared-list?path=子目录
```

无需登录。`path` 为空表示 `shared/` 根目录。

响应：

```json
{
  "folders": ["images"],
  "files": [
    {
      "name": "demo.png",
      "size": 12345,
      "uploaded": "2026-05-24T12:00:00.000Z"
    }
  ]
}
```

curl 示例：

```bash
curl "$BASE/api/shared-list?path=images"
```

### 3.3 下载共享文件

```http
GET /api/download?path=shared/文件名
```

未登录时，只允许下载 `shared/` 前缀下的文件。

curl 示例：

```bash
curl -L -o demo.png "$BASE/api/download?path=shared%2Fdemo.png"
```

### 3.4 剪贴板接口

这些接口当前不要求登录，主要给网页端跨页面保存复制/剪切状态使用，普通客户端通常可以不接。

```http
GET /api/clipboard?id=default
POST /api/clipboard?id=default
DELETE /api/clipboard?id=default
```

POST 请求体：

```json
{
  "items": ["a.txt", "b.txt"],
  "action": "copy",
  "sourcePath": "docs"
}
```

响应：

```json
{
  "ok": true
}
```

## 4. 文件管理接口

本节接口在设置了 `ACCESS_PASSWORD` 时都需要携带登录 Cookie。

### 4.1 获取文件列表

```http
GET /api/list?path=目录
```

`path` 为空表示根目录。返回当前目录的直接子文件夹和直接子文件。

响应：

```json
{
  "folders": ["docs", "images"],
  "files": [
    {
      "name": "a.txt",
      "size": 1024,
      "uploaded": "2026-05-24T12:00:00.000Z",
      "etag": "..."
    }
  ]
}
```

curl 示例：

```bash
curl -b "$COOKIE" "$BASE/api/list?path=docs"
```

注意：目录来自 KV 文件表和每目录独立的 KV 目录索引，不再依赖 R2 前缀或 `.keep` 占位对象。上传、新建、删除、移动、复制会同步更新索引，减少 KV prefix list 最终一致性导致的刷新延迟。

### 4.2 下载文件

```http
GET /api/download?path=文件路径
```

返回文件二进制流。响应头会包含：

- `Content-Type`
- `Content-Disposition: attachment`
- `Content-Length`
- `Accept-Ranges: bytes`
- `Content-Range`，仅 `Range` 请求返回 `206` 时存在
- `ETag`，普通 R2 文件会返回；分布式 manifest 文件不一定返回

curl 示例：

```bash
curl -L -b "$COOKIE" -o a.txt "$BASE/api/download?path=docs%2Fa.txt"
```

Range 下载示例：

```bash
curl -L -b "$COOKIE" \
  -H "Range: bytes=0-1048575" \
  -o part.bin \
  "$BASE/api/download?path=videos%2Fbig.mp4"
```

说明：

- 普通 R2 文件和分布式 manifest 文件都支持单段 `Range` 请求。
- 范围合法时返回 `206 Partial Content`，范围超出时返回 `416 Range Not Satisfiable`。
- 网页端对 512 MiB 及以上文件会优先使用分段 Range 下载，并在操作栏显示进度、已下载大小和实时速度。
- 分布式文件下载时，主控 Worker 会继续按较小 Range 从存储节点读取分片，降低单次长连接和子请求失败导致的提前结束概率。

### 4.3 普通上传

```http
POST /api/upload?path=目标文件路径
Content-Type: application/octet-stream
```

请求体直接传文件二进制。服务端会根据文件扩展名设置 R2 的 Content-Type。

响应：

```json
{
  "ok": true
}
```

curl 示例：

```bash
curl -b "$COOKIE" \
  --data-binary "@./a.txt" \
  "$BASE/api/upload?path=docs%2Fa.txt"
```

建议：当前网页端把 `90 MiB` 以内文件走普通上传；更大的文件建议走分片上传，避免 Cloudflare 单次请求体限制。

### 4.4 新建文件夹

```http
POST /api/mkdir
Content-Type: application/json
```

请求体：

```json
{
  "path": "docs/new-folder"
}
```

响应：

```json
{
  "ok": true
}
```

实现细节：文件夹记录写入 KV 文件表，并同步更新父目录索引；不会在 R2 中创建 `.keep` 占位对象。

### 4.5 删除文件或文件夹

```http
DELETE /api/delete?path=文件或文件夹路径
```

如果 `path` 是文件夹，服务端会删除 KV 中该虚拟目录下的所有映射，并同步更新相关目录索引；如果是文件，则删除单个映射。没有其他映射引用的 R2 对象或分布式分片会被清理。

响应：

```json
{
  "ok": true
}
```

curl 示例：

```bash
curl -b "$COOKIE" -X DELETE "$BASE/api/delete?path=docs%2Fa.txt"
```

### 4.6 重命名文件

```http
POST /api/rename
Content-Type: application/json
```

请求体：

```json
{
  "from": "docs/a.txt",
  "to": "docs/b.txt"
}
```

响应：

```json
{
  "ok": true
}
```

注意：`/api/rename` 支持文件和文件夹路径，底层通过 KV 文件表移动映射并同步更新目录索引；真实 R2 对象仍保留在根目录。

### 4.7 服务端粘贴

```http
POST /api/clipboard/paste
Content-Type: application/json
```

请求体：

```json
{
  "action": "copy",
  "items": ["a.txt", "folder-a"],
  "sourcePath": "docs",
  "targetPath": "backup"
}
```

`action` 可为 `copy` 或 `cut`。`items` 是源目录下的直接文件或文件夹名称，不要带 `/`。

响应：

```json
{
  "ok": true,
  "action": "copy",
  "sourcePath": "docs",
  "targetPath": "backup",
  "results": []
}
```

网页端粘贴成功或部分成功后会自动刷新当前目录。客户端软件可根据 `results` 判断单项失败；如果存在失败项，接口会返回 `207`。

### 4.8 获取容量信息

```http
GET /api/storage
```

响应：

```json
{
  "used": 123456,
  "total": 10737418240,
  "nodes": [
    {
      "id": "main",
      "name": "主控账号",
      "used": 123456,
      "total": 10737418240,
      "online": true
    }
  ]
}
```

`total` 默认按每个主控或节点 `10 GiB` 计算。

## 5. R2 Multipart 大文件上传

适合没有配置存储节点、但文件超过普通上传建议大小时使用。

当前网页端分片策略：

- 普通上传阈值：`90 MiB`
- 默认分片大小：`32 MiB`
- 最大分片大小：`90 MiB`
- 最大 part 数：`10000`

### 5.1 初始化

```http
POST /api/multipart/init
Content-Type: application/json
```

请求体：

```json
{
  "path": "videos/big.mp4",
  "contentType": "video/mp4"
}
```

响应：

```json
{
  "key": "videos/big.mp4",
  "uploadId": "..."
}
```

### 5.2 上传单个分片

```http
POST /api/multipart/part?path=文件路径&uploadId=上传ID&partNumber=1
Content-Type: application/octet-stream
```

请求体为该分片二进制。

响应是 R2 multipart part 信息，通常包含：

```json
{
  "partNumber": 1,
  "etag": "..."
}
```

客户端需要保存每个 part 的响应，并原样传给 complete 接口。

### 5.3 完成上传

```http
POST /api/multipart/complete
Content-Type: application/json
```

请求体：

```json
{
  "path": "videos/big.mp4",
  "uploadId": "...",
  "parts": [
    { "partNumber": 1, "etag": "..." },
    { "partNumber": 2, "etag": "..." }
  ]
}
```

响应：

```json
{
  "ok": true,
  "key": "videos/big.mp4",
  "etag": "..."
}
```

### 5.4 取消上传

```http
POST /api/multipart/abort
Content-Type: application/json
```

请求体：

```json
{
  "path": "videos/big.mp4",
  "uploadId": "..."
}
```

响应：

```json
{
  "ok": true
}
```

## 6. 分布式节点大文件上传

超过 100 MiB 的文件可以走分布式上传；主控账号会作为本地存储节点加入分配池，外部存储节点也会一起参与。分片按节点已用容量/总容量均衡分配，并结合主控 KV 中的节点用量估算，避免节点 R2 容量列表延迟导致连续上传分配不准。新增空节点会优先获得分片。主控 R2 根目录保存 manifest 索引，并通过 KV 映射到目标路径。普通客户端可以优先尝试该流程，如果返回 `409`，再回退到 R2 Multipart。

### 6.1 初始化分布式上传

```http
POST /api/distributed/init
Content-Type: application/json
```

请求体：

```json
{
  "path": "videos/big.mp4",
  "size": 1048576000,
  "contentType": "video/mp4",
  "chunkSize": 33554432,
  "parts": 32
}
```

响应：

```json
{
  "ok": true,
  "sessionId": "...",
  "parts": [
    {
      "partNumber": 1,
      "size": 33554432,
      "uploadUrl": "https://node.example.com/api/node/part?key=...",
      "token": "节点密钥"
    }
  ]
}
```

### 6.2 上传分片到节点

对初始化返回的每个 part 执行。外部节点分片会带有 `token`，主控账号分片的 `uploadUrl` 是同源 `/api/distributed/main-part?...`，`token` 为空。

```http
PUT part.uploadUrl
Authorization: Bearer part.token  # 仅外部节点分片需要
Content-Type: application/octet-stream
```

请求体为对应分片二进制。

节点成功响应：

```json
{
  "ok": true,
  "key": "r2drive_node_part_..."
}
```

### 6.3 完成分布式上传

```http
POST /api/distributed/complete
Content-Type: application/json
```

请求体：

```json
{
  "sessionId": "..."
}
```

响应：

```json
{
  "ok": true
}
```

主控会在 R2 根目录写入 manifest，在 KV 文件表和目录索引中映射到目标 `path`，并更新主控账号及外部节点的用量估算。之后下载仍然使用普通下载接口：

```http
GET /api/download?path=videos/big.mp4
```

### 6.4 取消分布式上传

```http
POST /api/distributed/abort
Content-Type: application/json
```

请求体：

```json
{
  "sessionId": "..."
}
```

响应：

```json
{
  "ok": true
}
```

注意：分布式上传会把节点 token 返回给已登录客户端，用于直传分片。客户端软件应只在可信环境中使用，不要把 token 写入日志或暴露给未授权用户。

## 7. 存储节点管理接口

这些接口用于主控管理节点配置，需要登录 Cookie。

### 7.1 获取节点列表

```http
GET /api/storage-nodes
```

响应不会返回 token：

```json
{
  "nodes": [
    {
      "id": "node-1",
      "name": "节点 1",
      "url": "https://node.example.com",
      "enabled": true
    }
  ]
}
```

### 7.2 新增或更新节点

```http
POST /api/storage-nodes
Content-Type: application/json
```

请求体：

```json
{
  "id": "node-1",
  "name": "节点 1",
  "url": "https://node.example.com",
  "token": "节点 STORAGE_NODE_TOKEN",
  "enabled": true
}
```

`id` 可省略，省略时服务端生成 UUID。同 ID 会覆盖更新。分片分配不再使用权重字段，而是按节点容量占用率和主控侧用量估算自动均衡。

响应：

```json
{
  "ok": true,
  "node": {
    "id": "node-1",
    "name": "节点 1",
    "url": "https://node.example.com",
    "enabled": true
  }
}
```

### 7.3 删除节点

```http
DELETE /api/storage-nodes?id=node-1
```

响应：

```json
{
  "ok": true
}
```

### 7.4 测试节点

```http
POST /api/storage-nodes/test?id=node-1
```

成功响应：

```json
{
  "ok": true,
  "ping": true,
  "storage": true,
  "used": 123456,
  "total": 10737418240
}
```

## 8. 存储节点内部接口

节点 Worker 使用这些接口接收主控或客户端上传的分片。调用时必须携带：

```http
Authorization: Bearer <节点 STORAGE_NODE_TOKEN>
```

如果节点未设置 `STORAGE_NODE_TOKEN`，会退回使用 `ACCESS_PASSWORD` 作为 Bearer token；两者都没有时，节点接口不可用。

### 8.1 节点连通性

```http
GET /api/node/ping
Authorization: Bearer <token>
```

响应：

```json
{
  "ok": true,
  "name": "R2 Storage Node"
}
```

### 8.2 节点容量

```http
GET /api/node/storage
Authorization: Bearer <token>
```

响应：

```json
{
  "ok": true,
  "used": 123456,
  "total": 10737418240
}
```

### 8.3 分片读写删除

```http
PUT /api/node/part?key=分片Key
GET /api/node/part?key=分片Key
DELETE /api/node/part?key=分片Key
Authorization: Bearer <token>
```

PUT 请求体为二进制分片，成功响应：

```json
{
  "ok": true,
  "key": "分片Key"
}
```

GET 返回二进制分片；DELETE 返回：

```json
{
  "ok": true
}
```

节点接口带有 CORS 响应头，允许浏览器直传分片。

## 9. WebDAV / Nextcloud 兼容

已移除。当前服务端只提供网页和 JSON API，不再提供 /dav、/remote.php/dav/...、PROPFIND、MKCOL、MOVE、COPY 等 WebDAV/Nextcloud 兼容入口。文件夹移动、复制、粘贴、重命名请使用本文档中的 JSON API。

## 10. 常见状态码

- `200`：请求成功。
- `204`：节点 CORS 预检或内部删除成功时可能返回，无响应体。
- `400`：缺少必要参数或请求体格式错误。
- `401`：未登录、Cookie 无效，或节点 Bearer token 错误。
- `404`：文件、目录、节点或上传会话不存在。
- `409`：目标无效，或分布式上传没有可用存储节点。
- `502`：主控测试节点失败。

## 11. 推荐对接流程

普通文件管理客户端：

1. `POST /api/login`，保存 `r2drive_session` Cookie。
2. `GET /api/list?path=...` 展示目录。
3. 小文件用 `POST /api/upload?path=...`。
4. 大文件先尝试分布式上传；如果返回 `409`，使用 R2 Multipart。
5. 下载统一用 `GET /api/download?path=...`；大文件客户端建议使用 `Range` 分段下载，并按 `Content-Range`/`Content-Length` 校验每段长度。
6. 删除、新建文件夹、重命名分别调用 `/api/delete`、`/api/mkdir`、`/api/rename`；复制/剪切粘贴调用 `/api/clipboard/paste`。

兼容性优先的客户端：

WebDAV / Nextcloud 兼容入口已移除，请直接对接 JSON API。文件夹移动、复制、粘贴和重命名均由 KV 文件表完成，客户端不需要枚举 R2 前缀。
