# 客户端内部结构分析

分析对象：官方 macOS x64 包 `SCNet-4.1.0-x64.zip`（`计算服务.app`），
以及包内 `app.asar`。结论仅适用于该版本。

## 1. 官方分发

- 下载页：<https://www1.scnet.cn/ui/mall/mobile/client/download>
- 更新源（electron-updater `generic` provider）：
  - macOS：`https://dlcdn.scnet.cn/client/mac/latest-mac.yml`
  - Windows：`https://dlcdn.scnet.cn/client/win/latest.yml`
- `latest-mac.yml`（4.1.0）列出四个文件，均为 SHA-512（base64）：

  | 文件 | 大小 |
  | --- | --- |
  | `SCNet-4.1.0-x64.zip` | 257,716,007 |
  | `SCNet-4.1.0-arm64.zip` | 247,991,484 |
  | `SCNet-4.1.0-x64.dmg` | 258,287,735 |
  | `SCNet-4.1.0-arm64.dmg` | 248,631,975 |

  官方站点的下载按钮就是读这两个 yml，没有 Linux 条目。

### 下载中断的特征

`mac-x64.zip` 若只下到部分字节，本地文件头（local file header）齐全，
但末尾没有中央目录（End of Central Directory），因此
`unzip`/`7z` 报 `End-of-central-directory signature not found`，
同时 `7z l` 仍能列出前 245 个条目。用 `curl -C -` 从同一 URL 续传即可，
续传前后校验和与 `latest-mac.yml` 一致。

## 2. 包结构

```
计算服务.app/Contents/
├── Info.plist                     CFBundleIdentifier com.sugon.sacp / 4.1.0 / LSMinimumSystemVersion 13.0
├── MacOS/计算服务                 32 KB Electron 启动桩
├── Frameworks/Electron Framework.framework    CFBundleVersion 44.7.0
└── Resources/
    ├── app.asar                   135 MB
    ├── app.asar.unpacked/         node_modules（见下）
    ├── bin/uv                     macOS x86_64 静态二进制，uv 0.9.x
    ├── agent-browser/agent-browser  macOS x86_64，agent-browser 0.39.0
    ├── agent-skills/              内置技能（scnet-job-diagnosis、cua-driver、skill-creator…）
    ├── agent-plugins/             内置插件（documents、pdf、spreadsheets…）
    ├── connectors/                连接器包（contract-review、levo-music…）
    ├── home-scenarios/            首页场景目录
    ├── cli/index.js               内置 CLI 入口
    ├── cua/worker.mjs             CUA utility process worker
    ├── tray*.png / icon.icns
    └── app-update.yml             provider: generic → dlcdn.scnet.cn/client/mac
```

`app.asar/package.json`：

```json
{ "name": "scnet-client", "version": "4.1.0",
  "main": "dist-electron/main/index.js", "type": "module",
  "packageManager": "bun@1.4.0",
  "engines": { "bun": ">=1.4.0", "node": ">=24.18.1" },
  "dependencies": {
    "@larksuiteoapi/node-sdk": "^1.74.0", "@napi-rs/canvas": "1.0.2",
    "@trycua/cua-driver": "0.34.1", "docx": "9.9.0", "electron-store": "^11.0.2",
    "electron-updater": "^6.8.9", "exceljs": "4.4.0", "mammoth": "1.13.0",
    "msedge-tts": "2.1.0", "node-pty": "1.1.0", "ssh2": "^1.17.0",
    "unpdf": "1.8.1", "ws": "^8.22.0" },
  "patchedDependencies": {
    "@earendil-works/pi-ai@1.1.0": "…", "@earendil-works/pi-coding-agent@1.1.0": "…",
    "exceljs@4.4.0": "…" },
  "scnetBuild": { "commit": "8363e92", "channel": "release", "baseVersion": "4.1.0" } }
```

即：客户端内置了自己的 agent 运行时（`pi-coding-agent` + `pi-ai` 打补丁），
对话/工具/skills 全部跑在本地 Electron 主进程，不依赖某个平台专属服务。
主进程是 `electron-vite` 产物（`dist-electron/main/*.js`，多 chunk、压缩但未混淆），
渲染层是 `dist/`（React 静态资源）。

## 3. 为什么 Linux 可行（代码证据）

主进程里 Linux 分支是现成的，`grep` 结果即可说明问题：

```js
// uv / 连接器运行时目录：按平台 + 架构拼接
join(process.resourcesPath, "bin")
join(app.getAppPath(), ".cache/tools/uv",
     "darwin" === process.platform ? "mac" : "win32" === process.platform ? "win" : "linux",
     process.arch)

// 运行平台白名单
if (!m || !["darwin", "linux", "win32"].includes(process.platform))
  throw Error("Unsupported runtime platform")

// 剪贴板 / 终端 / 托盘 / 徽标
y.showBadge && ["darwin", "linux"].includes(process.platform) && (app.badgeCount = s.size)
"linux" === t && (r.WAYLAND_DISPLAY ? wl-paste : xclip/xsel …)
isEncryptionAvailable() && ("linux" !== process.platform || "basic_text" !== getSelectedStorageBackend())

// 连接器支持的平台声明
connector.json / plugin.json 里 platforms: z.enum(["darwin","win32","linux"])
```

也就是说「没有 Linux 版」纯粹是发布策略，而不是代码不支持。

## 4. 平台相关的仅四处

1. **Electron 运行时**：darwin 版整个替换为同版本 Linux 构建；
2. **原生 node 模块**：`node-pty`、`@napi-rs/canvas`、`@trycua/cua-driver`、`@ubjs/node`；
3. **两个独立可执行文件**：`resources/bin/uv`、`resources/agent-browser/agent-browser`；
4. **入口/图标/包元数据**：`Info.plist`、`icon.icns`、`app-update.yml`、`.desktop`。

其中 2、3 都有上游 Linux 变体：

- `@napi-rs/canvas` → `@napi-rs/canvas-linux-x64-gnu`（同版本 1.0.2 存在）；
- `@trycua/cua-driver` → optionalDependencies 已声明
  `cua-driver-linux-x64-gnu` / `cua-driver-linux-arm64-gnu`；
- `@ubjs/node`（uniffi N-API 运行时）→ `@ubjs/node-linux-x64-gnu`（0.31.0-3/5/6 存在）；
- `agent-browser` → npm 包内自带 `bin/agent-browser-linux-x64`；
- `uv` → 官方发布 Linux 静态二进制，PyPI wheel 里也有；
- `node-pty` → npm 包不含 Linux 预编译，需要按 Electron ABI 编译（见 packaging.md）。

`ssh2` 的原生加速模块 `sshcrypto.node` 缺失会自动回退：

```js
try { binding = require('./crypto/build/Release/sshcrypto.node'); } catch {}
```

## 5. 验证方式

1. `xwininfo -root -tree` 能看到 `"计算服务": ("scnet-client" "scnet-client") 1200x741`；
2. `xwd` 抓窗口 + 手写 PNG 解码，确认界面渲染正常（`docs/screenshot-linux.png`）；
3. `ELECTRON_RUN_AS_NODE=1 ./scnet-client smoke.cjs` 逐个 `require` 原生模块，
   确认 ABI 与 `dlopen` 都通过；
4. deb 解包后再跑一遍，确认打包路径没有破坏相对引用。
