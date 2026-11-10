# scnet-client-linux

中文 | [English](README.md)

将官方 SCNet 客户端（应用名「计算服务」，bundle identifier `com.sugon.sacp`）的 macOS
Electron 发行包，转换为可运行的 Linux x64 构建流水线。

当前目标版本：**4.1.1**（Electron **44.7.0**），见 [`VERSION`](VERSION)。打包修订号 **2**，
见 [`CHANGELOG.md`](CHANGELOG.md)。

```bash
scripts/check-upstream.sh   # 对比本仓库目标版本与线上发行源
```

厂商仅发布 Windows、macOS 与 Android 版本。应用本身是平台中立的 Electron 代码——主进程已经
包含 Linux 分支（运行时供给、剪贴板、托盘、存储、终端），因此平台相关部分可以被替换，而不必
重写。本仓库提供该替换流程、Debian 打包定义以及支撑这些结论的证据。

## 范围

包含：

- 将 Electron 运行时、原生 node 模块与独立可执行文件替换为 Linux 版本；
- 重新打包 `app.asar`，使 Linux 原生产物可被正确解析；
- 打包：便携目录、`.deb`、桌面入口、非特权启动器；
- 记录已验证内容、验证方式与未知项。

不包含：

- 对厂商 JavaScript 的修改：厂商文件一律按发行内容使用，新增内容仅为两个 HTML 入口中的各一个
  `<script>` 标签及其加载的文件；
- 功能重写；
- 支持承诺。本构建用于 Linux 移植测试阶段的内部试验。

仓库中不含厂商二进制与构建产物。构建时从厂商 CDN 下载归档，并按 `latest-mac.yml` 公布的
SHA-512 校验。仓库不发布预构建包，可安装的 `.deb` 只能由流水线生成；该包内含厂商客户端本体，
且未签名。

## 环境要求

| 组件 | 版本 / 说明 |
| --- | --- |
| 主机 | Debian 12/13 或 Ubuntu 22.04/24.04，x86-64 |
| 构建工具 | `bash curl unzip python3 nodejs npm gcc g++ make dpkg-deb fakeroot` |
| 磁盘 | `build/work` 与 `build/cache` 约 3 GB，产物约 750 MB |
| 网络 | 厂商 CDN（`dlcdn.scnet.cn`）、npm registry、PyPI 镜像、Electron 镜像 |

Windows 与 macOS 不作为构建主机支持。

## 构建

```bash
git clone https://github.com/lql341/scnet-client-linux.git
cd scnet-client-linux
scripts/build-linux.sh                 # 完整流水线，缓存已就绪时约 5 分钟
scripts/build-linux.sh --portable-only # 跳过 .deb
scripts/build-linux.sh --clean         # 先清空 build/
```

流水线可重复执行：下载缓存在 `build/cache/`，中间产物在 `build/work/`，产物已存在的阶段会跳过。

| 阶段 | 动作 |
| --- | --- |
| 0 | 下载 `SCNet-<version>-x64.zip`，校验 SHA-512，解包 |
| 1 | 下载 `electron-v44.7.0-linux-x64.zip` |
| 2 | 解包 `app.asar`，应用窗口装饰补丁 |
| 3 | 安装 `@napi-rs/canvas`、`@trycua/cua-driver`、`@ubjs/node` 的 Linux 版本 |
| 4 | 按 Electron ABI 编译 `node-pty` |
| 5 | 下载 `uv` 与 `agent-browser` 的 Linux 可执行文件 |
| 6 | 重新打包 `app.asar`（`--unpack-dir node_modules`）、复制资源、自检 |
| 7 | 提取图标集（16–1024 px），生成 `launcher.sh` |
| 8 | 构建 Debian 包 |

产物：

```text
build/linux/                                便携目录
├── scnet-client                            Electron 44.7.0 运行时
├── launcher.sh                             按沙箱能力选择启动参数
└── resources/
    ├── app.asar                            重新打包，JavaScript 未改动
    ├── app.asar.unpacked/                  含 Linux 原生模块的 node_modules
    ├── bin/uv                              uv 0.9.9（静态）
    ├── agent-browser/agent-browser          agent-browser 0.39.0
    └── agent-skills/ agent-plugins/ cli/ cua/
scnet-client_4.1.1-3_amd64.deb
```

### 运行

```bash
build/linux/launcher.sh                          # 便携运行
sudo apt install ./scnet-client_4.1.1-3_amd64.deb  # 安装后从菜单启动「SCNet 计算服务」
```

启动器在系统能够提供 Chromium 沙箱时保留沙箱——setuid-root 的 `chrome-sandbox`，或非特权
user namespace（含 Ubuntu 23.10+ 的 `apparmor_restrict_unprivileged_userns` 限制）；两者
都不可用时才退化为 `--no-sandbox`。`SCNET_NO_SANDBOX=1` 可强制退化。

配置写入 `~/.sclaw/`，与 macOS、Windows 版本一致。

## 凭据落盘

厂商客户端会在用户目录里写下三处敏感信息。本项目只改文件权限，不改这套机制——厂商 `app.asar`
保持原样：

| 文件 | 内容 | 保护方式 |
| --- | --- | --- |
| `~/.sclaw/agent/scnet-credentials/<hash>.json` | SCNet API key（`sk-…`） | 明文，客户端创建时即为 0600 |
| `~/.sclaw/agent/mcp-oauth.json` | 第三方 MCP 服务的 OAuth token | 明文，取决于 `umask` |
| `~/.config/scnet-client/config.json` | 会话 token；若勾选过「记住密码」，还含账号密码 | 见下文 |

「记住密码」的值是 `local-v1:` + base64(iv‖tag‖AES-256-GCM)，AES 密钥由
`sha256(JSON.stringify(["local-v1:", baseUrl, userId]))` 派生 —— 而这两个字段就存在同一条 JSON 里。
也就是说，能读到该文件的人都能离线还原密码；这是混淆而非加密，且 macOS 与 Windows 上完全相同。

本构建做了什么：启动器在启动客户端前设置 `umask 077`，并把已存在的 `config.json`/`auth.json`
重置为 0600，因此在默认 `umask` 的系统上不再出现其他用户可读的情况。做不到什么：修不了派生方式
本身——共用机器上请勿勾选「记住密码」，改用 API key 路径，并在机器退役时到 SCNet 控制台吊销密钥。

## 扩展面板

构建会在渲染层注入一个小面板，不修改厂商代码：分中心用量、账单与 CSV 导出、传输任务、连通性检测、
控制台入口与主题切换。宿主操作缺失时相关模块自行停用。详见
[`docs/extension-design.zh-CN.md`](docs/extension-design.zh-CN.md)。

## 替换项

| 组件 | 厂商 macOS 产物 | Linux 替换 | 来源 |
| --- | --- | --- | --- |
| Electron 运行时 | 44.7.0 darwin | `electron-v44.7.0-linux-x64` | Electron 镜像 |
| `node-pty` 1.1.0 | `prebuilds/darwin-*` | 编译产物 `prebuilds/linux-x64/` | Electron 头文件 |
| `@napi-rs/canvas` 1.0.2 | `canvas-darwin-*` | `@napi-rs/canvas-linux-x64-gnu` | npm |
| `@trycua/cua-driver` 0.34.1 | `cua-driver-darwin-*` | `@trycua/cua-driver-linux-x64-gnu` | npm |
| `@ubjs/node` 0.31.0-3 | `node-darwin-*` | `@ubjs/node-linux-x64-gnu` | npm |
| `agent-browser` 0.39.0 | Mach-O 可执行文件 | `bin/agent-browser-linux-x64` | npm，同版本 |
| `uv` | Mach-O 可执行文件 | `uv` 0.9.9 静态二进制 | PyPI wheel |
| `ssh2` 原生加速 | `sshcrypto.node`（darwin） | 不提供，回退纯 JS | — |
| `app.asar` | 部分 unpack 列表 | `--unpack-dir node_modules` 重新打包 | `@electron/asar` |
| 图标与入口 | `icon.icns`、`Info.plist` | 提取的 PNG、`.desktop`、启动器 | — |

`ssh2` 的原生加速模块在上游即为可选（`try { require(...) } catch {}`），缺失只影响批量传输
吞吐，不损失功能。

## 窗口控件与厂商代码补丁

厂商在应用外壳内自绘最小化/最大化/关闭控件簇（`WindowTools`），只在 macOS（红绿灯）与
Windows（`titleBarOverlay`）上向平台索取按钮。Linux 既没有系统标题栏，也没有平台按钮；而厂商
控件簇只出现在登录页（`AuthShell`，且 `showMax=false`）与旧版 `compat` 外壳的 `AppWindowHeader`
中，当前渲染器的主路由并不渲染它，因此主窗口与登录窗口都可能完全没有控件。

为 Linux 启用 Chromium 覆盖层曾被尝试并否决：它会在厂商字形之上再画一套按钮，而覆盖层背景全透明，
厂商字形会与平台按钮并列显示。

最终方案不改动厂商路径，只在缺少控件簇的页面补一个后备实现：

| 补丁 | 目标 | 改动 |
| --- | --- | --- |
| `login-window-controls` | `dist/index.html`、`dist/compat/index.html` | 加载 `window-controls.js` |

[`scripts/window-controls.js`](scripts/window-controls.js) 仅在**不存在 `.window-tools` 元素时**
通过既有 preload 桥渲染最小化、最大化/还原与关闭三个按钮，一旦外壳渲染出厂商控件簇即自行移除。
最大化状态经 `host.invoke('window.is-maximized')` 读取：点击后以及窗口尺寸变化时（窗口管理器
双击标题栏拖动区或使用快捷键最大化）都会重新查询，图标与提示不会停留在旧状态。该脚本在其他平台
不生效，因此任一时刻只有一套控件。

`app.asar` 中其余文件均按发行内容沿用。上述改动为增量改动：两个 HTML 入口各一个 `<script>`
标签，外加该标签加载的文件。

## 图标

`icon.icns` 内含 32/64/128/256/512/1024 px 的 PNG 表示。构建会原样提取，并对缺失尺寸重采样，
共安装 13 个尺寸（16–1024）到 `/usr/share/icons/hicolor/<size>x<size>/apps/`，并在
`postinst`/`postrm` 中刷新图标缓存。

仅安装一张 1024 px 图像不够：菜单与面板按主题索引解析 `Icon=`，主题无法满足请求尺寸或
`icon-theme.cache` 陈旧时均不显示图标，此前菜单缺少图标即由此造成。

各项替换的依据见 [`docs/design.zh-CN.md`](docs/design.zh-CN.md)，文档索引见
[`docs/README.md`](docs/README.md)。

## 仓库结构

```text
scnet-client-linux/
├── VERSION                        目标上游版本
├── CHANGELOG.md                   按打包修订记录的仓库变更
├── README.md / README.zh-CN.md    概览，英文 / 中文
├── scripts/
│   ├── build-linux.sh             构建流水线（阶段 0–8，幂等）
│   ├── versions.env               固定依赖版本与打包修订号
│   ├── check-upstream.sh          对比目标版本与线上发行源
│   ├── check-docs.sh              校验文档与版本来源一致
│   ├── patch-vendor.cjs           窗口装饰补丁（精确匹配，漂移即失败）
│   ├── window-controls.js         Linux 后备窗口控件（最小化/最大化/关闭）
│   ├── smoke-native.cjs           原生产物冒烟测试（构建过程中执行）
│   └── extract-icons.py           从 .icns 提取并重采样图标集
├── packaging/
│   ├── launcher.sh                按沙箱能力选择启动参数，安装为 launcher.sh
│   └── debian/                    control.in、桌面入口、postinst、postrm
├── docs/
│   ├── README.md                   文档索引与编辑约定
│   ├── design.md / design.zh-CN.md          包结构分析、替换依据、打包决策
│   ├── verification.md / verification.zh-CN.md  验证流程、实测结果、未知项
│   └── assets/screenshot-linux.png             Linux 窗口（含后备窗口控件）
└── .github/workflows/check.yml    静态检查与策略检查（禁止提交厂商二进制）
```

`build/`、`app/`、厂商归档与 `.deb` 均由 Git 忽略；仓库内容不派生自厂商包。

## 验证

构建过程在任一原生产物缺失时立即失败，随后执行
[`scripts/smoke-native.cjs`](scripts/smoke-native.cjs)：加载全部平台相关产物，并对无需显示环境
的部分做功能验证（`node-pty` 生成/读取/退出、`@napi-rs/canvas` PNG 编码、`ssh2`、
`@ubjs/node`、`@trycua/cua-driver` 的 Rust `dlopen`，以及 `uv`、`agent-browser` 可执行文件）。

交互验证在 Debian 13 x64/X11 上针对 4.1.0 执行，并在 Ubuntu 26.04.1 x64/X11 上针对 4.1.1 重做：
窗口标题「计算服务」、尺寸 1200×768，右上角为最小化、最大化/还原与关闭；最大化经控件点击与
窗口管理器两条路径验证，图标随之同步，登录页与登录后的主路由都覆盖到；最小化通过模拟点击验证；
图标经 `Gtk.IconTheme` 在 7 个尺寸下解析成功，且解包 `.deb` 后行为相同。命令与结果见
[`docs/verification.zh-CN.md`](docs/verification.zh-CN.md)。

## 已知限制

| 范围 | 状态 |
| --- | --- |
| 登录、HPC 作业提交、SSH 会话、文件传输 | 未做端到端验证 |
| 电脑操作（CUA） | 库可加载；点击/截图未验证；需要 X11/Wayland 权限与 `libXtst` |
| 自动更新 | 不可用：更新源仅提供 macOS/Windows 产物，`electron-updater` 也无法替换 Linux 包体。升级方式为重新构建 |
| 代码签名 | 无 |
| 托盘图标 | 已在 `Recommends: libayatana-appindicator3-1 | libappindicator3-1` 中声明；库存在时指示器可正常注册，否则「关闭」会留下无窗口进程 |
| 关闭主窗口 | 隐藏到托盘而非退出（厂商 `close` 处理）；无托盘指示器的环境下进程继续无窗口运行 |
| 平铺窗口管理器、分数缩放 | 未验证；最大化按钮依赖窗口管理器对 frameless 窗口的处理 |
| 同一配置目录多实例 | 受单实例锁与会话恢复影响，偶发无窗口启动；终止残留实例后重试 |
| MCP OAuth（第三方服务） | 授权走 `127.0.0.1` 回环重定向，流程可完成；但厂商只在 macOS（AppleScript）与 Windows（`oauth-return.ps1`）上关闭并唤起浏览器标签，Linux 上该标签会留在浏览器里。一方连接器用 SCNet 会话授权，无需 OAuth |
| 支持 | 内部测试构建，无支持承诺 |

## 升级到新的上游版本

1. `scripts/check-upstream.sh` 给出新版本与线上发行源的文件清单。
2. 更新 `VERSION`，并更新 [`scripts/versions.env`](scripts/versions.env) 中的 `MAC_ZIP_SHA512`
   （x64 zip 的 SHA-512，由 `latest-mac.yml` 的 base64 解码）。
3. 若内置 Electron 版本变化（`Frameworks/Electron Framework.framework/Versions/A/Resources/
   Info.plist`），在同一文件中更新 `ELECTRON_VERSION`；`node-pty` 会自动重新编译。确认
   `scripts/patch-vendor.cjs` 的补丁模式仍然匹配：缺失时构建失败，需按新包的窗口代码重新推导。
4. 依据新的 `app.asar/package.json` 对齐原生模块与二进制版本（`CANVAS_VERSION`、
   `CUA_DRIVER_VERSION`、`UBJS_VERSION`、`NODE_PTY_VERSION`、`AGENT_BROWSER_VERSION`、
   `UV_VERSION`），均在 `scripts/versions.env` 中。
5. 对比新旧 `Resources/` 目录树。阶段 6 会复制 `agent-plugins`、`agent-skills`、`cli`、`cua`、
   `en.lproj`、`tray*.png`、`app-update.yml` 与 OAuth 相关图片；上游新增、改名或删除的条目
   （4.1.1 删除了 `connectors/`、`home-scenarios/`，新增两个 OAuth PNG）须与该清单对齐，否则
   `cp -a` 会使构建失败。
6. 在 [`CHANGELOG.md`](CHANGELOG.md) 中为新版本 `<version>-1` 增加条目。
7. 重新构建；内置冒烟测试必须通过。随后运行 `scripts/check-docs.sh`，并按
   [`docs/verification.zh-CN.md`](docs/verification.zh-CN.md) 重做交互验证。

若上游新增原生依赖（`.node`、`.so`），须补齐对应的官方 `linux-x64-gnu` 变体，否则相关功能会在
运行时失败。

## 文档

- [`CHANGELOG.md`](CHANGELOG.md) — 按打包修订记录的仓库变更
- [`docs/design.zh-CN.md`](docs/design.zh-CN.md) — 上游包结构分析、替换依据、asar 与 ABI 决策、打包布局
- [`docs/verification.zh-CN.md`](docs/verification.zh-CN.md) — 验证流程、实测结果、剩余未知项
- [`docs/extension-design.zh-CN.md`](docs/extension-design.zh-CN.md) — 移植之外的新增功能：分中心用量、账单、通知、诊断、主题；机制、验证与边界

## 状态

本仓库用于桌面客户端 Linux 移植测试阶段的内部评估。仓库不含厂商二进制，构建产物由厂商分发包在
本地生成。未经授权请勿将构建产物分发至组织之外；是否符合厂商条款由构建者或安装者自行确认。

## 许可证

本仓库内的脚本与文档采用 MIT 许可，见 [LICENSE](LICENSE)。上游客户端版权归其权利人所有，
不受该许可影响。
