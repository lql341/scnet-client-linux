# scnet-client-linux

中文 | [English](README.md)

将官方 SCNet 客户端（应用名「计算服务」，bundle identifier `com.sugon.sacp`）的 macOS
Electron 发行包，转换为可运行的 Linux x64 构建流水线。

当前目标版本：**4.1.0**（Electron **44.7.0**），见 [`VERSION`](VERSION)。
打包修订号见 `DEB_REVISION`（当前 `4.1.0-2`，修复菜单图标与窗口按钮）。

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

- 对厂商 JavaScript 的任何修改：`app.asar` 内容逐字节沿用；
- 功能重写；
- 支持承诺。这不是官方发行版。

仓库中不含厂商二进制与构建产物。构建时从厂商 CDN 下载归档，并按 `latest-mac.yml` 公布的
SHA-512 校验。[Releases](https://github.com/lql341/scnet-client-linux/releases)
附带一个预构建安装包，用于评估；它包含厂商客户端本体，且未签名。

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
    └── agent-skills/ agent-plugins/ connectors/ home-scenarios/ cli/ cua/
scnet-client_4.1.0_amd64.deb
```

### 运行

```bash
build/linux/launcher.sh                          # 便携运行
sudo apt install ./scnet-client_4.1.0_amd64.deb  # 安装后从菜单启动「SCNet 计算服务」
```

启动器在系统能够提供 Chromium 沙箱时保留沙箱——setuid-root 的 `chrome-sandbox`，或非特权
user namespace（含 Ubuntu 23.10+ 的 `apparmor_restrict_unprivileged_userns` 限制）；两者
都不可用时才退化为 `--no-sandbox`。`SCNET_NO_SANDBOX=1` 可强制退化。

配置写入 `~/.sclaw/`，与 macOS、Windows 版本一致。

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

## 对厂商代码的补丁

除下列三处外，`app.asar` 逐字节沿用。这三个精确字符串补丁无法避免：厂商自绘标题栏，且只实现了
macOS 与 Windows 两种形态。

| 补丁 | 文件 | 原因 |
| --- | --- | --- |
| `window-controls-overlay` | `dist-electron/main/index.js` | 否则 Linux 窗口没有最小化、最大化与关闭 |
| `window-chrome-modern` | `dist/static/js/async/*.js` | 渲染 36 px 拖拽条，为上述按钮预留空间 |
| `window-chrome-compat` | `dist/compat/static/js/async/*.js` | 兼容 UI 同理，经 `scnet-platform-windows` 布局类 |

三者必须一起应用：只开第一项会让按钮压在应用头部之上。
[`scripts/patch-vendor.cjs`](scripts/patch-vendor.cjs) 在模式缺失或存在多个匹配时使构建失败，
因此上游改动不会静默地让窗口控件消失。代码证据见
[`docs/design_CN.md`](docs/design_CN.md#47-窗口装饰)。

窗口按钮由 Chromium 绘制（`titleBarOverlay` 机制），因此在 GTK 与 Qt 桌面上外观一致，位置也在
Linux 期望的右上角。

## 图标

`icon.icns` 内含 32/64/128/256/512/1024 px 的 PNG 表示。构建会原样提取，并对缺失尺寸重采样，
共安装 13 个尺寸（16–1024）到 `/usr/share/icons/hicolor/<size>x<size>/apps/`，并在
`postinst`/`postrm` 中刷新图标缓存。

只装一张 1024 px 图像并不够：菜单与面板按主题索引解析 `Icon=`，主题无法满足请求尺寸、或
`icon-theme.cache` 陈旧时都不会显示图标——这正是此前菜单没有图标的原因。

各项替换的依据见 [`docs/design_CN.md`](docs/design_CN.md)。

## 仓库结构

```text
scnet-client-linux/
├── VERSION                        目标上游版本
├── README.md / README_CN.md       概览，英文 / 中文
├── scripts/
│   ├── build-linux.sh             构建流水线（8 个阶段，幂等）
│   ├── check-upstream.sh          对比目标版本与线上发行源
│   ├── patch-vendor.cjs           窗口装饰补丁（精确匹配，漂移即失败）
│   ├── smoke-native.cjs           原生产物冒烟测试（构建过程中执行）
│   └── extract-icons.py           从 .icns 提取并重采样图标集
├── docs/
│   ├── design.md / design_CN.md          包结构分析、替换依据、打包决策
│   ├── verification.md / verification_CN.md  验证流程、实测结果、未知项
│   └── screenshot-linux.png              Linux 窗口（含原生窗口控件）
└── .github/workflows/check.yml    静态检查与策略检查（禁止提交厂商二进制）
```

`build/`、`app/`、厂商归档与 `.deb` 均由 Git 忽略；仓库内容不派生自厂商包。

## 验证

构建过程在任一原生产物缺失时立即失败，随后执行
[`scripts/smoke-native.cjs`](scripts/smoke-native.cjs)：加载全部平台相关产物，并对无需显示环境
的部分做功能验证（`node-pty` 生成/读取/退出、`@napi-rs/canvas` PNG 编码、`ssh2`、
`@ubjs/node`、`@trycua/cua-driver` 的 Rust `dlopen`，以及 `uv`、`agent-browser` 可执行文件）。

交互验证在 Debian 13 x64/X11 上执行：窗口标题「计算服务」、尺寸 1200×741，右上角为最小化与
关闭（可缩放窗口另有最大化），最小化通过模拟点击验证，图标经 `Gtk.IconTheme` 在 7 个尺寸下
解析成功，且解包 `.deb` 后行为相同。命令与结果见
[`docs/verification_CN.md`](docs/verification_CN.md)。

## 已知限制

| 范围 | 状态 |
| --- | --- |
| 登录、HPC 作业提交、SSH 会话、文件传输 | 未做端到端验证 |
| 电脑操作（CUA） | 库可加载；点击/截图未验证；需要 X11/Wayland 权限与 `libXtst` |
| 自动更新 | 不可用：更新源仅提供 macOS/Windows 产物，`electron-updater` 也无法替换 Linux 包体。升级方式为重新构建 |
| 代码签名 | 无 |
| 托盘图标 | 需要 `libayatana-appindicator3` 或 `libappindicator3` |
| 登录后的最大化按钮 | 未直接观察；窗口以 `maximizable: true` 创建，而登录窗口本身不允许最大化 |
| 同一配置目录多实例 | 受单实例锁与会话恢复影响，偶发无窗口启动；终止残留实例后重试 |
| 厂商支持 | 无；这不是官方发行版 |

## 升级到新的上游版本

1. `scripts/check-upstream.sh` 给出新版本与文件清单。
2. 更新 `VERSION` 与 `MAC_ZIP_SHA512`（x64 zip 的 SHA-512，由 `latest-mac.yml` 的 base64 解码）。
3. 若内置 Electron 版本变化（`Frameworks/Electron Framework.framework/Versions/A/Resources/
   Info.plist`），更新 `ELECTRON_VERSION`；`node-pty` 会自动重编译。同时确认
   `scripts/patch-vendor.cjs` 的三个模式仍存在——缺失时构建会失败，需要按新的窗口代码重新推导，
   而不是忽略。
4. 依据新的 `app.asar/package.json` 对齐原生模块版本（`CANVAS_VERSION`、
   `CUA_DRIVER_VERSION`、`UBJS_VERSION`、`NODE_PTY_VERSION`、`AGENT_BROWSER_VERSION`、
   `UV_VERSION`）。
5. 重新构建；内置冒烟测试必须通过，然后按 [`docs/verification_CN.md`](docs/verification_CN.md)
   重做交互验证。

若上游新增原生依赖（`.node`、`.so`），必须补齐对应的官方 `linux-x64-gnu` 变体，否则相关功能
会在运行时失败。

## 文档

- [`docs/design_CN.md`](docs/design_CN.md) — 上游包结构分析、替换依据、asar 与 ABI 决策、打包布局
- [`docs/verification_CN.md`](docs/verification_CN.md) — 验证流程、实测结果、剩余未知项

## 免责声明

本项目与曙光智算、国家超算互联网（SCNet）无关联，未获其认可或支持。仓库不重新分发任何厂商
代码或二进制；构建产物由使用者从厂商分发包在本地生成。使用与再分发是否符合厂商条款，由构建者
或安装者自行负责。

## 许可证

本仓库内的脚本与文档采用 MIT 许可，见 [LICENSE](LICENSE)。上游客户端版权归其权利人所有，
不受该许可影响。
