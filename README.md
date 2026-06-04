# R2 Cloud Drive Client

R2 Cloud Drive Client 是一个基于 Electron 的桌面网盘客户端，用于连接 R2 Cloud Drive 服务端，完成文件管理、相册浏览、大文件传输、自动同步、多端同步、存储节点管理和桌面托盘后台运行。

## 功能概览

- 文件管理：浏览、新建文件夹、上传、下载、重命名、删除、复制、剪切和粘贴。
- 媒体预览：支持图片、视频、音频、文本/代码文件预览，预览窗口内可直接下载。
- 大文件传输：支持普通上传、R2 Multipart、分布式上传、Range 分段下载和任务栏进度。
- 自动同步：可添加多个本地目录，按间隔扫描并上传新增/修改文件。
- 相册同步：将本地图片、视频目录同步到云端 `相册` 目录。
- 多端同步：保存同步目录列表，可发现远端更新并同步到本机。
- 批次通知：上传、下载都支持“全部完成后通知”开关。
- 桌面体验：支持系统托盘、最小化到托盘、关闭行为配置、开机自启动、下载完成通知。
- 存储节点管理：新增、编辑、测试、禁用和删除外部存储节点。

## 运行环境

- Windows 10/11
- Node.js 18 或更高版本
- npm
- 可访问的 R2 Cloud Drive 服务端 API

## 快速开始

```powershell
npm.cmd install
npm.cmd start
```

首次启动后，在设置或引导弹窗中填写服务端 API 地址，例如：

```text
https://your-worker.example.com
```

如果服务端启用了访问密码，登录时填写对应密码。

## 常用脚本

```powershell
npm.cmd run dev       # 开发模式启动
npm.cmd run check     # JS 语法检查
npm.cmd run pack      # 生成解包目录
npm.cmd run dist:win  # 生成 Windows 安装包和便携版
```

Windows 构建产物默认输出到 `release-windows/`。

## Windows 安装包

项目使用 `electron-builder` 的 NSIS 安装器。当前安装器已启用引导式安装和安装目录选择：

- `oneClick: false`
- `allowToChangeInstallationDirectory: true`
- 桌面快捷方式和开始菜单快捷方式默认创建
- 安装器、卸载器、窗口和通知图标使用 `assets/icons/icon.ico` / `icon.png`

打包后常见产物：

```text
release-windows/R2 Cloud Drive Setup 0.1.0.exe
release-windows/R2 Cloud Drive 0.1.0.exe
release-windows/win-unpacked/R2 Cloud Drive.exe
```

## 自动同步说明

自动同步位于左侧“自动同步”页面：

1. 点击“添加文件夹”选择本地目录。
2. 设置自动同步间隔，范围 1-1440 分钟。
3. 可选择开机自启动，让客户端随系统启动后在后台执行同步。
4. 点击“立即同步全部”可手动触发所有启用任务。

同步逻辑会跳过临时文件、仍在写入的文件和远端已是最新的文件。远端判断会同时参考上传时间和文件大小，减少重复上传。

## 项目结构

```text
assets/icons/                 应用、托盘、安装器图标
src/main/main.js              Electron 主进程、窗口、托盘、IPC
src/main/apiClient.js         服务端 API、上传下载、错误处理
src/main/backupManager.js     自动同步调度、扫描和上传
src/preload/preload.js        安全暴露给渲染层的 API
src/renderer/index.html       桌面端界面
src/renderer/renderer.js      桌面端交互逻辑
src/renderer/styles.css       桌面端样式
src/mobile/                   移动端页面资源
API说明文档.md                服务端 API 文档
技术文档.md                   客户端技术实现文档
```

## 图标说明

桌面端文件列表和同步弹窗的文件类型图标使用本地 CSS 绘制，不依赖远程 Material Icons 字体，因此离线环境下不会显示成破碎图标或 ligature 文本。

应用图标资源：

```text
assets/icons/icon.ico
assets/icons/icon.icns
assets/icons/icon.png
assets/icons/tray.png
```

替换图标后重新运行 `npm.cmd run dist:win` 即可更新安装包、窗口、托盘和通知图标。

## 配置文件

客户端配置保存在 Electron 用户数据目录的 `config.json` 中，主要字段包括：

- `baseUrl`：服务端 API 地址。
- `downloadDir`：默认下载目录。
- `backupJobs`：自动同步任务列表。
- `backupIntervalMinutes`：自动同步间隔。
- `backupAutoStart`：是否开机自启动。
- `downloadBatchNotify`：是否在下载批次全部结束后发送通知。
- `closeBehavior`：关闭行为，支持 `ask`、`tray`、`quit`。
- `minimizeBehavior`：最小化行为，支持 `taskbar`、`tray`。
- `startHiddenToTray`：启动后是否隐藏到托盘。
- `autoSyncEnabled`：是否启用多端自动同步。

## 故障排查

- 安装时不能选择目录：请确认使用的是新构建的 NSIS Setup 包，而不是旧版安装包或便携版。
- 任务栏/托盘图标异常：重新构建后测试，确认 `assets/icons/` 下图标存在且未损坏。
- 文件列表图标显示文字或破碎：当前版本已改为本地 CSS 图标，重新启动客户端即可。
- 自动同步没有执行：检查任务是否启用、服务端地址是否可用、客户端是否仍在运行。
- 上传失败：进入“传输列表”查看错误，必要时在“存储节点查看”中测试节点连通性。

## 更多文档

- [技术文档.md](./技术文档.md)
- [API说明文档.md](./API说明文档.md)
