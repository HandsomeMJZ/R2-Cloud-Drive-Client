# R2 Cloud Drive API 说明文档

> 版本：v1.1.5  
> 基础 URL：`https://your-worker.workers.dev`  
> 所有 API 响应均为 JSON 格式（除非标注为二进制/HTML）

---

## 目录

- [1. 通用说明](#1-通用说明)
- [2. 认证 API](#2-认证-api)
- [3. 文件管理 API](#3-文件管理-api)
- [4. 分片上传 API（R2 Multipart）](#4-分片上传-apir2-multipart)
- [5. 分布式上传 API](#5-分布式上传-api)
- [6. 剪贴板 API](#6-剪贴板-api)
- [7. 存储节点管理 API](#7-存储节点管理-api)
- [8. 容量查询 API](#8-容量查询-api)
- [9. 共享文件夹 API（公开）](#9-共享文件夹-api公开)
- [10. 存储节点 Worker API（节点模式）](#10-存储节点-worker-api节点模式)
- [11. 孤儿文件清扫 API](#11-孤儿文件清扫-api)
- [12. 错误码参考](#12-错误码参考)

---

## 1. 通用说明

### 鉴权方式

- 设置了 `ACCESS_PASSWORD` 的 Worker，管理端 API 需要先通过 `/api/login` 获取会话 Cookie
- 未设置密码则为公开访问，所有 API 无需鉴权
- 共享文件夹（`/shared`）下的下载和列表 API 始终公开
- 剪贴板 API 无需登录（便于跨页面保持状态）
- 存储节点 API（`/api/node/*`）使用 `Authorization: Bearer <token>` 鉴权

### 路径规范

- 所有文件路径使用虚拟路径，**不以 `/` 开头或结尾**
- 不允许包含控制字符（`\u0000-\u001F`）、`.` 和 `..`
- 示例：`folder/subfolder/file.txt`（正确），`/folder/file.txt`（错误）

### 通用错误响应格式

```json
{
  "ok": false,
  "error": "错误描述信息"
}
```

---

## 2. 认证 API

### 2.1 登录

```http
POST /api/login
Content-Type: application/json
```

**请求体：**

```json
{
  "password": "your-password"
}
```

**成功响应（200）：**

```json
{
  "ok": true
}
```

> 响应头 `Set-Cookie` 包含 `r2drive_session` Cookie，有效期 7 天。

**失败响应（200，密码错误）：**

```json
{
  "ok": false
}
```

**无密码模式（200）：**

> 未设置 `ACCESS_PASSWORD` 时，任意请求直接返回成功。

```json
{
  "ok": true
}
```

---

### 2.2 登出

```http
POST /api/logout
```

**响应（200）：**

```json
{}
```

> 响应头 `Set-Cookie` 会清空 `r2drive_session`。

---

## 3. 文件管理 API

### 3.1 列出目录

```http
GET /api/list?path=folder/subfolder
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 否 | 虚拟目录路径，省略则为根目录 |

**成功响应（200）：**

```json
{
  "folders": ["documents", "photos", "videos"],
  "files": [
    {
      "name": "readme.txt",
      "size": 1024,
      "uploaded": "2026-05-28T10:30:00.000Z",
      "etag": "abc123def456"
    },
    {
      "name": "image.png",
      "size": 204800,
      "uploaded": "2026-05-27T08:15:00.000Z",
      "etag": "xyz789abc012"
    }
  ]
}
```

---

### 3.2 上传文件（直传）

> 适用于 ≤ 512 KB 的小文件。大文件请使用分片上传或分布式上传。

```http
POST /api/upload?path=folder/file.txt
Content-Type: text/plain

（文件二进制内容）
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 目标虚拟路径 |

**成功响应（200）：**

```json
{
  "ok": true
}
```

**失败响应（400）：**

```json
{
  "ok": false,
  "error": "Missing path"
}
```

---

### 3.3 下载文件

```http
GET /api/download?path=folder/file.txt
```

```http
HEAD /api/download?path=folder/file.txt
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件虚拟路径 |

**支持 Range 请求：**

```http
GET /api/download?path=video.mp4
Range: bytes=0-1048575
```

**成功响应（200 完整 / 206 部分）：**

- 响应头：`Content-Type`、`Content-Length`、`Accept-Ranges: bytes`、`Content-Disposition`
- 响应体：文件二进制内容
- Range 请求：`Content-Range: bytes 0-1048575/104857600`

**失败响应：**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 path 参数 |
| 404 | 文件不存在 |

---

### 3.4 删除文件/文件夹

```http
DELETE /api/delete?path=folder/file.txt
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 要删除的虚拟路径（文件或文件夹） |

**成功响应（200）：**

```json
{
  "ok": true
}
```

> 删除文件夹时，内部采用批量 D1 操作，元数据删除完成后立即返回。  
> R2 实际对象清理在后台异步执行，不影响响应速度。

**失败响应：**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 path 参数 |

---

### 3.5 批量删除

```http
POST /api/delete-batch
Content-Type: application/json
```

**请求体：**

```json
{
  "paths": [
    "folder/file1.txt",
    "folder/subdir",
    "another/file2.pdf"
  ]
}
```

**成功响应（200）：**

```json
{
  "ok": true,
  "deleted": 3,
  "cleanupFailed": 0
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | boolean | 操作是否成功 |
| `deleted` | number | 删除的文件/文件夹总数 |
| `cleanupFailed` | number | R2 清理失败数（通常为 0，异步清理） |

**失败响应（400）：**

```json
{
  "ok": false,
  "error": "Missing paths"
}
```

---

### 3.6 重命名/移动

```http
POST /api/rename
Content-Type: application/json
```

**请求体：**

```json
{
  "from": "folder/oldname.txt",
  "to": "folder/newname.txt"
}
```

**成功响应（200）：**

```json
{
  "ok": true
}
```

**失败响应：**

| 状态码 | 示例 |
|--------|------|
| 400 | `{"ok":false,"error":"Missing fields"}` |
| 404 | `{"ok":false,"error":"not found"}` |

---

### 3.7 新建文件夹

```http
POST /api/mkdir
Content-Type: application/json
```

**请求体：**

```json
{
  "path": "folder/new-subfolder"
}
```

**成功响应（200）：**

```json
{
  "ok": true
}
```

**失败响应（400）：**

```json
{
  "ok": false,
  "error": "Missing path"
}
```

---

## 4. 分片上传 API（R2 Multipart）

> 适用于超过 Worker 请求体限制的文件，使用 R2 原生 Multipart Upload。

### 4.1 初始化分片上传

```http
POST /api/multipart/init
Content-Type: application/json
```

**请求体：**

```json
{
  "path": "large/file.zip",
  "contentType": "application/zip"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 目标虚拟路径 |
| `contentType` | string | 否 | MIME 类型，省略则从文件名推断 |

**成功响应（200）：**

```json
{
  "key": "multipart_a1b2c3d4_file.zip",
  "uploadId": "abc123-def456-ghi789"
}
```

---

### 4.2 上传分片

```http
POST /api/multipart/part?path=large/file.zip&uploadId=abc123-def456-ghi789&partNumber=1
Content-Type: application/octet-stream

（分片二进制内容）
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件虚拟路径（需与 init 时一致） |
| `uploadId` | string | 是 | 初始化返回的 uploadId |
| `partNumber` | number | 是 | 分片编号，从 1 开始 |

**成功响应（200）：**

> 返回 R2 原生的 Part 对象，包含 `partNumber` 和 `etag`。

```json
{
  "partNumber": 1,
  "etag": "abc123def456"
}
```

---

### 4.3 完成分片上传

```http
POST /api/multipart/complete
Content-Type: application/json
```

**请求体：**

```json
{
  "path": "large/file.zip",
  "uploadId": "abc123-def456-ghi789",
  "parts": [
    { "partNumber": 1, "etag": "abc123def456" },
    { "partNumber": 2, "etag": "xyz789uvw012" }
  ]
}
```

**成功响应（200）：**

```json
{
  "ok": true,
  "key": "multipart_a1b2c3d4_file.zip",
  "etag": "final-etag-hash"
}
```

---

### 4.4 中止分片上传

```http
POST /api/multipart/abort
Content-Type: application/json
```

**请求体：**

```json
{
  "path": "large/file.zip",
  "uploadId": "abc123-def456-ghi789"
}
```

**成功响应（200）：**

```json
{
  "ok": true
}
```

---

## 5. 分布式上传 API

> 适用于大文件（> 512 KB），将文件分片分布到主控 R2 和外部存储节点。
> 分片分配采用**平方加权轮询算法**：按剩余容量的平方作为权重，使新增空节点获得指数级优先分配，快速填平容量差距。

### 5.1 初始化分布式上传

```http
POST /api/distributed/init
Content-Type: application/json
```

**请求体：**

```json
{
  "path": "videos/big-file.mp4",
  "size": 1073741824,
  "contentType": "video/mp4",
  "chunkSize": 33554432,
  "parts": 32
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 目标虚拟路径 |
| `size` | number | 是 | 文件总大小（字节） |
| `contentType` | string | 否 | MIME 类型 |
| `chunkSize` | number | 是 | 每个分片大小（字节） |
| `parts` | number | 是 | 总分片数 |

**成功响应（200）：**

```json
{
  "ok": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "distribution": [
    { "nodeName": "主控账号", "nodeId": "main", "parts": 12, "bytes": 402653184 },
    { "nodeName": "节点A", "nodeId": "abc-123", "parts": 10, "bytes": 335544320 },
    { "nodeName": "节点B", "nodeId": "def-456", "parts": 10, "bytes": 335544320 }
  ],
  "parts": [
    {
      "partNumber": 1,
      "size": 33554432,
      "uploadUrl": "/api/distributed/main-part?sessionId=550e8400...&partNumber=1&token=abc123",
      "directUploadUrl": "",
      "token": ""
    },
    {
      "partNumber": 2,
      "size": 33554432,
      "uploadUrl": "/api/distributed/node-part?sessionId=550e8400...&partNumber=2&token=def456",
      "directUploadUrl": "https://node-a.workers.dev/api/node/part?key=r2drive_node_part_550e8400..._000002&size=33554432",
      "token": ""
    }
  ]
}
```

**失败响应（409，文件太小）：**

```json
{
  "ok": false,
  "error": "file below distributed threshold"
}
```

---

### 5.2 上传分片到主控

```http
PUT /api/distributed/main-part?sessionId=550e8400...&partNumber=1&token=abc123
Content-Type: application/octet-stream

（分片二进制内容）
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 初始化返回的 sessionId |
| `partNumber` | number | 是 | 分片编号 |
| `token` | string | 是 | 分片对应的 uploadToken |

**成功响应（200）：**

```json
{
  "ok": true,
  "key": "r2drive_node_part_550e8400..._000001"
}
```

---

### 5.3 上传分片到外部节点（中继模式）

```http
PUT /api/distributed/node-part?sessionId=550e8400...&partNumber=2&token=def456
Content-Type: application/octet-stream

（分片二进制内容）
```

> 此接口由主控 Worker 中继转发到目标节点。也可使用 `directUploadUrl` 直传节点。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 初始化返回的 sessionId |
| `partNumber` | number | 是 | 分片编号 |
| `token` | string | 是 | 分片对应的 uploadToken |

**成功响应（200）：**

```json
{
  "ok": true,
  "key": "r2drive_node_part_550e8400..._000002",
  "nodeId": "abc-123"
}
```

**节点上传失败（502）：**

```json
{
  "ok": false,
  "error": "node upload failed",
  "nodeId": "abc-123",
  "status": 502,
  "detail": "connect timeout"
}
```

---

### 5.4 完成分布式上传

```http
POST /api/distributed/complete
Content-Type: application/json
```

**请求体：**

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**成功响应（200）：**

```json
{
  "ok": true
}
```

> 完成后：manifest JSON 写入主控 R2，D1 文件映射创建，节点用量更新，临时 session 清除。

---

### 5.5 中止分布式上传

```http
POST /api/distributed/abort
Content-Type: application/json
```

**请求体：**

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**成功响应（200）：**

```json
{
  "ok": true
}
```

---

## 6. 剪贴板 API

> 剪贴板数据保存在 D1 中，24 小时过期。无需登录即可访问。

### 6.1 保存剪贴板

```http
POST /api/clipboard?id=cb_1234567890_abc
Content-Type: application/json
```

**请求体：**

```json
{
  "items": ["file1.txt", "folder1", "image.png"],
  "action": "copy",
  "sourcePath": "my-folder"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `items` | string[] | 是 | 文件/文件夹名称列表 |
| `action` | string | 否 | `"copy"` 或 `"cut"`，默认 `"copy"` |
| `sourcePath` | string | 否 | 源目录路径 |

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 否 | 剪贴板 ID，默认 `"default"` |

**成功响应（200）：**

```json
{
  "ok": true
}
```

---

### 6.2 读取剪贴板

```http
GET /api/clipboard?id=cb_1234567890_abc
```

**成功响应（200，有数据）：**

```json
{
  "items": ["file1.txt", "folder1"],
  "action": "copy",
  "sourcePath": "my-folder"
}
```

**成功响应（200，无数据）：**

```json
{
  "items": [],
  "action": null,
  "sourcePath": ""
}
```

---

### 6.3 清除剪贴板

```http
DELETE /api/clipboard?id=cb_1234567890_abc
```

**成功响应（200）：**

```json
{
  "ok": true
}
```

---

### 6.4 粘贴（服务端执行复制/移动）

```http
POST /api/clipboard/paste
Content-Type: application/json
```

**请求体：**

```json
{
  "action": "copy",
  "items": ["file1.txt", "folder1"],
  "sourcePath": "my-folder",
  "targetPath": "dest-folder"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | `"copy"` 或 `"cut"` |
| `items` | string[] | 是 | 要粘贴的文件/文件夹名称 |
| `sourcePath` | string | 是 | 源目录路径 |
| `targetPath` | string | 是 | 目标目录路径 |

**成功响应（200，全部成功）：**

```json
{
  "ok": true,
  "action": "copy",
  "sourcePath": "my-folder",
  "targetPath": "dest-folder",
  "results": [
    {
      "name": "file1.txt",
      "from": "my-folder/file1.txt",
      "to": "dest-folder/file1.txt",
      "ok": true,
      "type": "file",
      "copied": 1
    },
    {
      "name": "folder1",
      "from": "my-folder/folder1",
      "to": "dest-folder/folder1",
      "ok": true,
      "type": "folder",
      "copied": 3
    }
  ]
}
```

**部分成功（207）：**

```json
{
  "ok": false,
  "action": "cut",
  "sourcePath": "my-folder",
  "targetPath": "dest-folder",
  "results": [
    {
      "name": "file1.txt",
      "from": "my-folder/file1.txt",
      "to": "dest-folder/file1.txt",
      "ok": true,
      "type": "file",
      "moved": 1
    },
    {
      "name": "conflict.pdf",
      "from": "my-folder/conflict.pdf",
      "to": "dest-folder/conflict.pdf",
      "ok": false,
      "error": "destination is a folder"
    }
  ]
}
```

---

## 7. 存储节点管理 API

### 7.1 获取节点列表

```http
GET /api/storage-nodes
```

**成功响应（200）：**

```json
{
  "nodes": [
    {
      "id": "abc-123",
      "name": "节点A",
      "url": "https://node-a.workers.dev",
      "enabled": true,
      "weight": 1,
      "createdAt": "2026-05-01T12:00:00.000Z"
    },
    {
      "id": "def-456",
      "name": "节点B",
      "url": "https://node-b.workers.dev",
      "enabled": false,
      "weight": 1,
      "createdAt": "2026-05-15T08:00:00.000Z"
    }
  ]
}
```

> 注意：响应中不包含 `token`，token 仅保存在服务端。

---

### 7.2 添加/更新节点

```http
POST /api/storage-nodes
Content-Type: application/json
```

**请求体（新增节点）：**

```json
{
  "name": "节点C",
  "url": "https://node-c.workers.dev",
  "token": "my-node-secret-token",
  "enabled": true,
  "weight": 2
}
```

**请求体（更新已有节点）：**

```json
{
  "id": "abc-123",
  "name": "节点A（重命名）",
  "url": "https://node-a-new.workers.dev",
  "token": "new-token",
  "enabled": false
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 否 | 更新时需要；新增省略则自动生成 UUID |
| `name` | string | 是 | 节点显示名称 |
| `url` | string | 是 | 节点 Worker 地址 |
| `token` | string | 是 | 节点的 `STORAGE_NODE_TOKEN` |
| `enabled` | boolean | 否 | 是否启用，默认 `true` |
| `weight` | number | 否 | 分配权重，默认 1 |

**成功响应（200）：**

```json
{
  "ok": true,
  "node": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "节点C",
    "url": "https://node-c.workers.dev",
    "enabled": true,
    "weight": 2,
    "createdAt": "2026-05-28T15:00:00.000Z"
  }
}
```

---

### 7.3 删除节点

```http
DELETE /api/storage-nodes?id=abc-123
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 节点 ID |

**成功响应（200）：**

```json
{
  "ok": true
}
```

---

### 7.4 测试节点连通性

```http
POST /api/storage-nodes/test?id=abc-123
```

**成功响应（200，一切正常）：**

```json
{
  "ok": true,
  "ping": true,
  "storage": true,
  "used": 524288000,
  "total": 10737418240
}
```

**部分失败（502，可以 ping 通但容量接口不可用）：**

```json
{
  "ok": false,
  "ping": true,
  "storage": false,
  "error": "storage unavailable"
}
```

**完全失败（502，无法连接）：**

```json
{
  "ok": false,
  "error": "ping failed"
}
```

---

## 8. 容量查询 API

### 8.1 获取存储容量

```http
GET /api/storage
```

**成功响应（200）：**

```json
{
  "used": 2147483648,
  "total": 32212254720,
  "nodes": [
    {
      "id": "main",
      "name": "主控账号",
      "used": 1073741824,
      "total": 10737418240,
      "online": true
    },
    {
      "id": "abc-123",
      "name": "节点A",
      "used": 536870912,
      "total": 10737418240,
      "online": true,
      "storageAvailable": true
    },
    {
      "id": "def-456",
      "name": "节点B",
      "used": 0,
      "total": 10737418240,
      "online": false,
      "storageAvailable": false
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `used` | number | 总已用字节数（所有节点合计） |
| `total` | number | 总容量字节数（所有节点合计） |
| `nodes` | array | 各节点明细 |
| `nodes[].online` | boolean | 节点是否在线 |
| `nodes[].storageAvailable` | boolean | 容量接口是否可用（仅外部节点有此字段） |

---

## 9. 共享文件夹 API（公开）

> 共享文件夹路径：`shared/`。所有 API 无需登录。

### 9.1 列出共享目录

```http
GET /api/shared-list?path=subfolder
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 否 | 共享目录下的子路径 |

**成功响应（200）：**

```json
{
  "folders": ["public-docs", "images"],
  "files": [
    {
      "name": "welcome.pdf",
      "size": 1048576,
      "uploaded": "2026-05-20T10:00:00.000Z",
      "etag": "abc123"
    },
    {
      "name": "guide.txt",
      "size": 2048,
      "uploaded": "2026-05-18T14:30:00.000Z",
      "etag": "def456"
    }
  ]
}
```

---

### 9.2 下载共享文件

```http
GET /api/download?path=shared/public-docs/welcome.pdf
```

> 与普通下载接口相同，但 `path` 以 `shared/` 开头时无需鉴权。支持 Range 请求。

---

## 10. 存储节点 Worker API（节点模式）

> 同一份 `worker.js` 部署为存储节点时，提供以下 API。  
> 鉴权方式：`Authorization: Bearer <STORAGE_NODE_TOKEN>`

### 10.1 健康检查

```http
GET /api/node/ping?key=ping
Authorization: Bearer your-node-token
```

**成功响应（200）：**

```json
{
  "ok": true,
  "name": "R2 Storage Node"
}
```

---

### 10.2 容量查询

```http
GET /api/node/storage?key=storage
Authorization: Bearer your-node-token
```

**成功响应（200）：**

```json
{
  "ok": true,
  "used": 1073741824,
  "total": 10737418240
}
```

---

### 10.3 上传分片

```http
PUT /api/node/part?key=r2drive_node_part_xxx&size=33554432
Authorization: Bearer your-node-token
Content-Type: application/octet-stream

（分片二进制内容）
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | string | 是 | 分片存储 key |
| `size` | number | 否 | 期望分片大小（用于校验） |

**成功响应（200）：**

```json
{
  "ok": true,
  "key": "r2drive_node_part_xxx"
}
```

---

### 10.4 下载分片

```http
GET /api/node/part?key=r2drive_node_part_xxx
Authorization: Bearer your-node-token
```

> 支持 `Range` 请求头，返回 206 Partial Content。

**成功响应：**

- 完整请求 → 200，`Content-Length`，`Content-Type: application/octet-stream`
- Range 请求 → 206，`Content-Range: bytes 0-1048575/33554432`

---

### 10.5 删除分片

```http
DELETE /api/node/part?key=r2drive_node_part_xxx
Authorization: Bearer your-node-token
```

**成功响应（200）：**

```json
{
  "ok": true
}
```

---

## 11. 孤儿文件清扫 API

> 需要登录。扫描 R2 存储桶中未被任何 D1 文件映射引用的残留对象，支持扫描和清理两种操作。

### 11.1 扫描孤儿文件

```http
POST /api/orphan-cleanup
Content-Type: application/json
```

**请求体（扫描）：**

```json
{
  "action": "scan"
}
```

**成功响应（200）：**

```json
{
  "ok": true,
  "action": "scan",
  "orphans": [
    { "key": "file_a1b2c3d4_unreferenced.bin", "size": 1048576 },
    { "key": "r2drive_node_part_old_session_000001", "size": 33554432 }
  ],
  "totalSize": 34603008,
  "totalObjects": 109
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `orphans` | array | 孤儿对象列表，每项包含 `key` 和 `size` |
| `totalSize` | number | 孤儿对象总大小（字节） |
| `totalObjects` | number | R2 存储桶中对象总数 |

---

### 11.2 清理孤儿文件

```http
POST /api/orphan-cleanup
Content-Type: application/json
```

**请求体（清理）：**

```json
{
  "action": "clean",
  "keys": [
    "file_a1b2c3d4_unreferenced.bin",
    "r2drive_node_part_old_session_000001"
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | 固定为 `"clean"` |
| `keys` | string[] | 是 | 要删除的 R2 对象 key 列表 |

**成功响应（200）：**

```json
{
  "ok": true,
  "action": "clean",
  "deleted": 2,
  "failed": 0,
  "freedBytes": 34603008
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `deleted` | number | 成功删除的对象数 |
| `failed` | number | 删除失败的对象数 |
| `freedBytes` | number | 释放的存储空间（字节） |

**失败响应（400）：**

```json
{
  "ok": false,
  "error": "no keys provided"
}
```

---

## 12. 错误码参考

| 状态码 | 说明 | 常见原因 |
|--------|------|---------|
| 200 | 成功 | — |
| 206 | 部分内容（Range 请求） | — |
| 207 | 多状态（粘贴部分成功） | 部分文件复制/移动失败 |
| 302 | 重定向到登录页 | 未登录访问管理页面 |
| 400 | 请求参数错误 | 缺少必填参数、路径格式错误 |
| 401 | 未授权 | Cookie 过期或无效；节点 token 错误 |
| 404 | 未找到 | 文件/文件夹不存在；session 已过期 |
| 409 | 冲突 | 文件大小未达到分布式上传阈值 |
| 416 | Range 不满足 | 请求的字节范围超出文件大小 |
| 500 | 服务器内部错误 | 配置缺失、R2/D1 操作失败 |
| 502 | 网关错误 | 外部节点无法连接 |

**所有 API 错误响应均遵循统一格式：**

```json
{
  "ok": false,
  "error": "人类可读的错误描述"
}
```

---

> 文档版本：v1.1.4 · 最后更新：2026-05-28
