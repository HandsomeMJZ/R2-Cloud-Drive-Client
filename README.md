# R2 Cloud Drive Client

基于 **Electron** 的桌面客户端，用于连接和管理 [R2 Cloud Drive](https://github.com/) API 服务（一个运行在 Cloudflare Workers 上的云盘）。

## 功能

- 📁 **文件管理** — 浏览、上传、下载、新建文件夹、删除、重命名
- 🖼️ **相册视图** — 图片缩略图预览，适合浏览图片目录
- ⚡ **快传访问** — 常用文件夹 / 最近文件快捷入口
- 🔄 **大文件上传** — 自动选择分片策略（分布式 > R2 Multipart > 普通上传）
- ⬇️ **智能下载** — Range 分段下载 + 自动重试 + 传输进度
- 🔐 **密码保护** — 支持配置了 `ACCESS_PASSWORD` 的服务端
- 🌙 **夜间模式**
- 🖥️ **无边框窗口** — 自定义标题栏
- 📦 **存储节点管理** — 查看、新增、测试、删除存储节点
- 📂 **WebDAV 兼容** — 服务端提供 `/dav` 接口，客户端可通过 REST API 操作

## 截图

> TODO: 添加截图

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 18
- npm（随 Node.js 一同安装）

### 安装依赖

```bash
npm install
```

### 运行开发模式

```bash
npm start
```

或

```bash
npm run dev
```

### 代码检查

```bash
npm run check
```

## 构建

### Windows

```bash
npm run dist:win
```

输出到 `release-windows/` 目录。

### macOS

```bash
npm run dist:mac
```

### Linux

```bash
npm run dist:linux
```

### 通用构建

```bash
npm run dist
```

## 使用说明

1. 启动客户端后，会弹出**连接**对话框。
2. 填写 **API 基准地址**（默认 `https://cloud.junzhen.qzz.io`）。
3. 如果服务端设置了 `ACCESS_PASSWORD`，在**访问密码**处输入密码；否则留空即可。
4. 点击**连接**进入云盘首页。

### 上传文件

- 点击 **上传** 按钮，选择一个或多个文件
- 小于 **90 MiB** 的文件走普通上传
- 大于 **90 MiB** 的文件优先尝试**分布式上传**，若服务端未配置节点则自动降级为 **R2 Multipart 分片上传**

### 下载文件

- 点击文件操作栏中的下载按钮
- 大文件自动启用 **Range 分段下载**，支持断点续传
- 可在设置中配置默认下载路径

## 项目结构

```
r2-cloud-drive-client/
├── src/
│   ├── main/
│   │   ├── main.js          # Electron 主进程
│   │   └── apiClient.js     # API 客户端封装
│   ├── preload/
│   │   └── preload.js       # 预加载脚本（暴露 API 到渲染进程）
│   └── renderer/
│       ├── index.html        # 主界面 HTML
│       ├── renderer.js       # 渲染进程逻辑
│       └── styles.css        # 样式
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

## API 文档

详细的 API 说明见 [API说明文档.md](./API说明文档.md)。

## 技术栈

- [Electron](https://www.electronjs.org/) — 桌面应用框架
- [electron-builder](https://www.electron.build/) — 打包构建
- [Cloudflare R2](https://developers.cloudflare.com/r2/) — 对象存储（服务端）

## 许可

[MIT](./LICENSE)

---

> **注意**：该客户端需要配合 [R2 Cloud Drive Worker](https://github.com/) 服务端使用。服务端部署在 Cloudflare Workers 上，提供 REST API 和 WebDAV 接口。
