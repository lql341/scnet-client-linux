# 设计说明

对厂商发行包的分析，以及每项替换的依据。所有观察均针对 SCNet 桌面客户端 **4.1.1** 的
macOS x64 发行包（`SCNet-4.1.1-x64.zip`）。文中引用的是实际代码片段；未经证实的内容在
[`verification_CN.md`](verification_CN.md) 中标注为未验证。

## 1. 分发方式

客户端通过 `electron-updater` 的 generic feed 分发：

| 渠道 | 清单地址 |
| --- | --- |
| macOS | `https://dlcdn.scnet.cn/client/mac/latest-mac.yml` |
| Windows | `https://dlcdn.scnet.cn/client/win/latest.yml` |

4.1.1 的 `latest-mac.yml` 列出四个产物，均带 base64 编码的 SHA-512：

| 文件 | 大小（字节） |
| --- | --- |
| `SCNet-4.1.1-x64.zip` | 257,627,218 |
| `SCNet-4.1.1-arm64.zip` | 247,902,758 |
| `SCNet-4.1.1-x64.dmg` | 258,195,702 |
| `SCNet-4.1.1-arm64.dmg` | 248,542,343 |

清单中没有 Linux 条目，下载页也只标注 macOS 13+、Windows 10+ 与 Android。

### 截断的归档

未下载完整的 zip 会保留本地文件头，但缺失中央目录：`unzip` 报
`End-of-central-directory signature not found`，而 `7z l` 仍能列出截断点之前的条目。
对同一 URL 使用 `curl -C -` 续传即可，最终文件与清单中的 SHA-512 逐字节一致。

## 2. 包结构

```text
计算服务.app/Contents/
├── Info.plist                    CFBundleIdentifier com.sugon.sacp，4.1.1，LSMinimumSystemVersion 13.0
├── MacOS/计算服务                Electron 启动桩
├── Frameworks/Electron Framework.framework    CFBundleVersion 44.7.0
└── Resources/
    ├── app.asar                  135 MB
    ├── app.asar.unpacked/        node_modules（部分解包）
    ├── bin/uv                    macOS x86-64 可执行文件
    ├── agent-browser/agent-browser   macOS x86-64，0.39.0
    ├── agent-skills/             内置技能
    ├── agent-plugins/            内置插件（documents、pdf、spreadsheets、媒体）
    ├── cli/index.js              内置 CLI 入口
    ├── cua/worker.mjs            电脑操作 worker
    ├── scnet-wordmark.png、oauth-app-icons.png、oauth-return.ps1
    ├── tray*.png、icon.icns
    └── app-update.yml            provider: generic，url: .../client/mac
```

`app.asar` 是 `electron-vite` 产物：`dist-electron/main/*.js`（多分块，压缩但未混淆）、
`dist/`（React 渲染层资源），以及运行时依赖：

```json
{ "name": "scnet-client", "version": "4.1.1",
  "main": "dist-electron/main/index.js", "type": "module",
  "packageManager": "bun@1.4.0",
  "engines": { "bun": ">=1.4.0", "node": ">=24.18.1" },
  "dependencies": {
    "@napi-rs/canvas": "1.0.2", "@trycua/cua-driver": "0.34.1", "node-pty": "1.1.0",
    "ssh2": "^1.17.0", "electron-updater": "^6.8.9", "@larksuiteoapi/node-sdk": "^1.74.0",
    "docx": "9.9.0", "exceljs": "4.4.0", "mammoth": "1.13.0", "msedge-tts": "2.1.0",
    "unpdf": "1.8.1", "ws": "^8.22.0" },
  "patchedDependencies": { "@earendil-works/pi-ai@1.1.0": "…",
                          "@earendil-works/pi-coding-agent@1.1.0": "…",
                          "exceljs@4.4.0": "…" },
  "scnetBuild": { "commit": "c5b623c", "channel": "release", "baseVersion": "4.1.1" } }
```

由此可得两个对本仓库有决定作用的事实：

- agent 运行时被打进应用，在 Electron 主进程内运行；对话、工具与技能链路不依赖任何平台专属服务。
- `@earendil-works/pi-*` 打了补丁，因此从 npm 源码重建并不等价于发行包。这也是本项目逐字节
  沿用厂商 `app.asar`、而不重建它的原因。

依赖块自 4.1.0 起未变：固定的原生包版本（4.3 节）、`node-pty` 与两个独立二进制（4.4、4.5 节）
全部沿用，因此 4.1.1 的升级只需改版本号与校验和。

### 内置资源目录的变化

4.1.1 去掉了 4.1.0 中的两个顶层 `Resources/` 目录，并新增三个文件：

| 路径 | 4.1.0 | 4.1.1 |
| --- | --- | --- |
| `connectors/` | 内置连接器目录（`catalog.json` 加各版本 zip），由 `join(process.resourcesPath, "connectors")` 读取 | 已移除；打包态查找路径不复存在，目录改为 `userData/resource-catalog-v3.json`，由 `connectors.refresh-resources` 填充 |
| `home-scenarios/` | 内置场景目录 | 已移除；场景存储位于 `userData/home-scenarios`，文件为 `home-scenarios-replay.json` |
| `scnet-wordmark.png`、`oauth-app-icons.png` | 无 | OAuth 窗口的背景与 logo，从 `process.resourcesPath` 读取 |
| `oauth-return.ps1` | 无 | PowerShell 辅助脚本，仅在 `process.platform === "win32"` 时调用 |

构建会复制两个 PNG、跳过 PowerShell 脚本，并且不再尝试复制 `connectors/` 与 `home-scenarios/`，
使组装出的资源集与上游实际读取的内容一致。
## 3. Linux 可行的依据

主进程本身平台中立，且已包含 Linux 分支。以下是 `dist-electron/main/index.js` 中的代表性片段：

```js
// 运行时供给：平台 + 架构目录
join(app.isPackaged ? process.resourcesPath : …)
"darwin" === process.platform ? "mac" : "win32" === process.platform ? "win" : "linux"

// 连接器运行时的受支持平台白名单
if (!m || !["darwin", "linux", "win32"].includes(process.platform))
  throw Error("Unsupported runtime platform")

// 徽标、剪贴板、终端、存储
y.showBadge && ["darwin", "linux"].includes(process.platform) && (app.badgeCount = s.size)
"linux" === t && (r.WAYLAND_DISPLAY ? … : xclip/xsel …)
isEncryptionAvailable() && ("linux" !== process.platform || "basic_text" !== …)

// connector/plugin 清单声明 platforms: ["darwin","win32","linux"]
```

macOS 专属行为仅集中在下列四处，其余为已处理 Linux 的共享代码。

## 4. 平台相关面

| 范围 | 项目 | 替换策略 |
| --- | --- | --- |
| 运行时 | Electron 44.7.0 darwin | 同版本 Linux x64 构建 |
| 原生模块 | `node-pty`、`@napi-rs/canvas`、`@trycua/cua-driver`、`@ubjs/node` | 官方 `linux-x64-gnu` 变体；`node-pty` 自行编译 |
| 独立可执行文件 | `resources/bin/uv`、`resources/agent-browser/agent-browser` | 同工具的 Linux 构建 |
| 打包 | `Info.plist`、`icon.icns`、`app-update.yml` | `.desktop`、多尺寸 PNG、启动器；更新源原样保留 |
| 窗口装饰 | macOS 左侧红绿灯、Windows overlay | 窗口控件覆盖层，位于右上 |

### 4.1 Electron 运行时

`Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist` 的
`CFBundleVersion` 为 44.7.0，标准镜像提供 `electron-v44.7.0-linux-x64.zip`。更换 Electron
大版本会破坏此处编译的原生模块 ABI，因此版本被固定，并由构建过程强制一致（addon 用同一套
头文件编译）。

### 4.2 node-pty

`node-pty@1.1.0` 只提供 darwin 与 win32 预编译，其加载顺序为：

```js
const dirs = ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`];
```

因此该 addon 针对 Electron 44.7.0 头文件编译，并安装到
`node_modules/node-pty/prebuilds/linux-x64/pty.node`。Linux 使用 `forkpty`，darwin 的
`spawn-helper` 在 Linux 上无对应物，也不需要。

头文件获取细节：`node-gyp --dist-url=https://npmmirror.com/mirrors/electron/` 会因镜像的
`SHASUMS256.txt` 中没有 Electron 头文件条目而校验失败（`remote undefined`）。构建因此直接下载
`node-v<version>-headers.tar.gz` 到 `~/.cache/node-gyp/<version>`，写入 `installVersion`
标记，并以 `--nodedir` 编译。

### 4.3 canvas、cua-driver、ubjs

三者都被厂商清单精确固定，因此 Linux 包必须使用相同版本，而不是 `latest`：

| 模块 | Linux 包 | 说明 |
| --- | --- | --- |
| `@napi-rs/canvas@1.0.2` | `@napi-rs/canvas-linux-x64-gnu@1.0.2` | N-API，无需按 ABI 重编 |
| `@trycua/cua-driver@0.34.1` | `@trycua/cua-driver-linux-x64-gnu@0.34.1` | 提供 `libcua_driver_sdk.so` 与 `cua_driver_node_runtime.node` |
| `@ubjs/node@0.31.0-3` | `@ubjs/node-linux-x64-gnu@0.31.0-3` | cua-driver 依赖的 uniffi N-API 运行时 |

上游 `@trycua/cua-driver` 清单本身就声明了 Linux 可选依赖：

```json
"optionalDependencies": {
  "@trycua/cua-driver-linux-x64-gnu": "0.34.1",
  "@trycua/cua-driver-linux-arm64-gnu": "0.34.1", … }
```

`cua-driver` 在导入时通过 `@ubjs/node` 的 `resolveLibPath` 定位原生库，参数为
`npmPackageBase: "@trycua/cua-driver-"`、`tripleStyle: "node"`，即对应上面的包名。

### 4.4 agent-browser

使用浏览器工具时，客户端以 `mcp --tools core` 启动
`resources/agent-browser/agent-browser`：

```js
if (app.isPackaged)
  return join(process.resourcesPath, "agent-browser",
              "win32" === process.platform ? "agent-browser.exe" : "agent-browser")
```

路径固定，因此 Linux 可执行文件必须装在该位置。npm 包 `agent-browser@0.39.0`（发行包内
macOS 二进制自报的版本）提供 `bin/agent-browser-linux-x64`。

### 4.5 uv

打包形态下，供给器把 `resources/bin` 作为 `uv` 目录，并从自身 `ready.json` 记录的位置执行
`uv`/`python3`；二进制本身只是工具入口，客户端不对其版本做断言。构建安装 `uv 0.9.9` 静态
Linux 二进制。若需与厂商二进制严格对齐，应先读取 macOS `uv` 的版本字符串，再选择最接近的
Linux 发行版。

### 4.6 ssh2

`ssh2` 的原生加速为可选加载：

```js
try { binding = require('./crypto/build/Release/sshcrypto.node'); } catch {}
```

本项目不编译 Linux addon，走纯 JS 路径：功能完整，仅在批量传输时较慢。

### 4.7 窗口控件

厂商以 `titleBarStyle: "hidden"` 创建窗口，标题栏由应用自绘，窗口按钮交给平台：

```js
{ …, titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 16 }, titleBarOverlay: y(), … }

function w(e="light",t=36){return{color:"#00000000",height:t,symbolColor:"dark"===e?"#ffffff":"#1a1c1f"}}
function y(e="light",t=36){return"darwin"===process.platform||("win32"===process.platform?w(e,t):void 0)}
```

macOS 由系统绘制红绿灯，Windows 通过 `titleBarOverlay` 让 Chromium 自绘按钮，Linux 两者都没有。
应用为此内置了页面内的控件簇 `WindowTools`，渲染条件为 `darwin || (win32 && isMainWindow)`
之外：

```js
let a="darwin"===s.H.context.platform, t="win32"===s.H.context.platform&&s.H.context.isMainWindow
…
return (s,b) => a||t ? null : h("div", {class:"window-tools …"}, [ … min / max / close … ])
```

因此在 Linux 上，只要挂载了该组件（登录页 `AuthShell`，且 `showMax=false`；以及旧版 `compat`
外壳的 `AppWindowHeader`）控件簇就会渲染，按钮本身可用。但当前渲染器的主路由根本没有挂载
`WindowTools`，所以在 Linux 上主窗口与登录窗口都可能完全没有控件。

**尝试并否决的方案：Chromium 覆盖层。** 为 Linux 启用 `titleBarOverlay`（并在两个渲染层中预留
36 px）后出现了两套重叠控件：Chromium 的圆形按钮压在厂商 `WindowTools` 字形之上。覆盖层背景色为
全透明，没有任何绘制会清除该条带，于是厂商字形就与平台按钮并列显示。反过来隐藏厂商控件簇则会破坏
主窗口——在 Linux 上 `WindowTools` 是厂商唯一的实现。

**采用的方案：** 不触碰厂商路径（不启用覆盖层，`WindowTools` 保持可见，仍是主要控件面），只在缺少
控件簇的页面补一个后备实现：

| 补丁 | 目标 | 改动 |
| --- | --- | --- |
| `login-window-controls` | `dist/index.html`、`dist/compat/index.html` | 加载 `window-controls.js` |

[`scripts/window-controls.js`](../scripts/window-controls.js) 观察文档变化，仅在**不存在
`.window-tools` 元素时**渲染最小化、最大化/还原与关闭三个按钮，一旦外壳渲染出厂商控件簇即自行
移除。最大化图标与提示跟随 `host.invoke('window.is-maximized')`：点击后与窗口尺寸变化时都会重新
查询，因此窗口管理器发起的最大化（双击拖动区、Super+Up）也能正确反映。它在其他平台不生效，也不会
在已有控件的窗口上重复添加，因此任一时刻只有一套控件。

Linux 上的结果：当前主路由没有厂商控件簇，由后备实现提供右上角的最小化/最大化/关闭（实测
1200×768 → 1920×1047 并可还原）；在挂载了厂商 `WindowTools` 的页面（登录页 `AuthShell` 与
旧版 compat 头部）后备实现自行退出，厂商字形仍是唯一控件；登录页因厂商传入 `showMax=false`
只显示最小化与关闭。

## 5. asar 重打包

厂商 asar 只把少数包标记为解包（`@napi-rs/canvas*`、`@trycua/*`、`@ubjs/*`、`jszip`、
`node-pty`、`ssh2`）。本项目改为解包整个 `node_modules`，原因有三：

1. `@trycua/cua-driver` 需要 `dlopen` `libcua_driver_sdk.so`。asar 内部路径会报
   `cannot open shared object file: Not a directory`，因为 asar 只模拟文件内容读取，不模拟
   共享库加载。
2. 客户端 fork 电脑操作 worker 时使用了硬编码的解包路径
   `join(process.resourcesPath, "app.asar.unpacked", "node_modules/@trycua/cua-driver/dist/index.js")`。
3. 新增的 Linux 包不在厂商 asar 头部中。仅写入 `app.asar.unpacked` 的文件对归档内的模块解析
   不可见。

另考虑并否决的方案：把应用作为普通 `resources/app/` 目录发布。这样会去掉 asar 层，但
`app.isPackaged` 仍为真，(2) 中硬编码的 `app.asar.unpacked` 路径就必须在厂商 JavaScript
内修改。重打包保持了厂商代码逐字节不变，这是更强的不变量。

该构建未启用 asar 完整性校验（`EnableEmbeddedAsarIntegrityValidation`）——重打包后的归档
可正常加载，`ELECTRON_RUN_AS_NODE` 亦可用，说明 `RunAsNode` 处于开启状态。

## 6. 启动器策略

便携安装下 `chrome-sandbox` 无法设置 setuid。启动器按顺序探测：

1. setuid-root 的 `chrome-sandbox`；
2. 非特权 user namespace：`user.max_user_namespaces > 0`，存在
   `kernel.unprivileged_userns_clone` 时其值不为 0，且
   `kernel.apparmor_restrict_unprivileged_userns != 1`；
3. 以上都不可用时使用 `--no-sandbox`。

`SCNET_NO_SANDBOX=1` 强制走第 3 步。`.deb` 的 `postinst` 额外把 `chrome-sandbox` 设为
`root:root 4755`，因此安装形态走第 1 步。

## 7. 打包

```text
/opt/scnet-client/                      build/linux 产物
/usr/bin/scnet-client -> /opt/scnet-client/launcher.sh
/usr/share/applications/scnet-client.desktop
/usr/share/icons/hicolor/<size>x<size>/apps/scnet-client.png   （13 个尺寸）
```

图标：`icon.icns` 是一串带类型的分块，其中的 PNG 表示被原样提取，缺失尺寸由预乘 alpha 的
box 滤波生成（`scripts/extract-icons.py`）。安装 16 至 1024 共 13 个尺寸，并由
`postinst`/`postrm` 刷新图标缓存。

在 Linux 上只安装一张 1024×1024 图像并不够：菜单实现会按主题索引解析 `Icon=`，
主题无法满足请求尺寸（或 `icon-theme.cache` 陈旧）时就不显示图标。提供完整尺寸阶梯并刷新
缓存，才能让条目在应用菜单与面板中正常出现。

依赖同时列出 `t64` 与旧包名，以便在 Debian 12/13 与 Ubuntu 22.04/24.04 上安装。

`app-update.yml` 原样复制。Linux 上 `electron-updater` 无法更新非 AppImage 布局，且更新源
本身不含 Linux 产物，因此更新入口在设计上即不可用，而不是被补丁禁用。

## 8. 不变量

- `app.asar` 中的 JavaScript 除 `patch-vendor.cjs` 声明的三处窗口装饰改动外不做修改，其余字节
  与厂商一致。
- 原生模块版本等于厂商清单固定的版本。
- 所有平台相关产物在构建期被校验（`scripts/smoke-native.cjs`）。
- 仓库不含厂商二进制；厂商归档在构建期下载并校验。
