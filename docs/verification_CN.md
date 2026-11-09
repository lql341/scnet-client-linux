# 验证

已执行的操作、参考系统与实测结果。未列出的内容即为未验证。参考系统为 Debian 13（trixie）
x86-64、X11 会话、单块可容纳 1200×741 的显示器；测试期间无 root 权限，`.deb` 以
`dpkg-deb -x` 解包，而非通过 `apt` 安装。

## 0. 版本覆盖范围

第 1–7 节记录的是 4.1.0-3 在参考系统（Debian 13）上的首次验证。4.1.1 构建在另一台机器上做了
端到端复核：Ubuntu 26.04.1 x86-64，X11（XFCE）会话：

| 复核项 | 结果 |
| --- | --- |
| 完整流水线（`scripts/build-linux.sh`） | 退出码 0，产出 `scnet-client_4.1.1-1_amd64.deb`（195 MB） |
| 第 1 节冒烟测试 | 输出一致，七项全部通过 |
| 第 2 节，登录窗口 | 正常渲染，标题「计算服务」，类 `scnet-client`，1200×768；厂商 `.window-tools` 提供最小化与关闭，后备实现自行退出（无重复控件） |
| 第 2 节，主路由 | 复制已有的 4.1.0 配置后，4.1.1 直接渲染仪表盘（侧边栏显示「SCNet v4.1.1」）；`.window-tools` 数量为 `0`，后备实现挂载且有三个按钮 |
| 第 2 节，控件 | 最大化 1200×768 → 2560×1440 并可还原，提示切换为「还原 / Restore」；`wmctrl -b add,maximized_vert,maximized_horz` 不经点击即翻转图标；最小化后 `IsUnMapped`，`wmctrl -i -a` 后回到 `IsViewable` |
| 第 3 节，图标 | `Gtk.IconTheme` 在 16–512 px 均可解析 `scnet-client`（1024 px 回退到 512 px 图，符合预期） |
| 第 4 节，沙箱探测 | 该机 `kernel.apparmor_restrict_unprivileged_userns=1` 且便携版 `chrome-sandbox` 非 setuid，启动器按设计选择 `--no-sandbox` |
| 第 5 节，打包 | `Version: 4.1.1-1`，13 个图标尺寸，`desktop-file-validate` 退出码 0，`apt-get -s install` 可解出依赖并给出 4.1.0-4 → 4.1.1-1 升级，解包目录可直接启动 |
| 连接器目录 | `#/mcp` 页面列出服务下发的连接器（万方数据、Repilot、智慧芽、BioBuddy 等），不依赖 4.1.1 已删除的 `Resources/connectors` |

4.1.1 仍未重跑：`apt` 真实安装（第二台机器同样无 root）与托盘图标交互。下文 4.1.0-3 的各行保持原记录。

复核中有两个适用于两个版本的观察。通过厂商通道「关闭」主窗口时窗口被隐藏而非退出——窗口模块
注册了 `on("close", e => { hide(); e.preventDefault(); })`——进程在无窗口状态下继续运行，需通过托盘
图标或重新启动才回到前台；这与第 7 节的「无窗口启动」是同一现象。另外，4.1.0 写出的配置可在
4.1.1 下直接沿用，未见迁移提示。

## 1. 构建内置检查

`scripts/build-linux.sh` 在异常时中止构建，而不是产出不完整的包：

| 检查 | 阶段 | 失败行为 |
| --- | --- | --- |
| 厂商归档 SHA-512 | 0 | 中止；续传失败后重下一次 |
| 补丁模式存在且唯一 | 2 | 报出补丁 id 并中止 |
| 原生产物齐全 | 6b | 列出缺失产物并中止 |
| `desktop-file-validate` | 8 | 桌面入口非法则中止 |
| 原生冒烟测试 | 6b | 首个失败模块即中止 |

`scripts/smoke-native.cjs` 在 Electron 运行时内以 `ELECTRON_RUN_AS_NODE=1` 执行，检查项：

| 项目 | 断言 |
| --- | --- |
| `node-pty` | 生成 `/bin/sh -c "printf pty-ok"`，读取输出，退出码 0 |
| `@napi-rs/canvas` | 创建 16×16 画布、填充并编码 PNG |
| `ssh2` | `Client` 导出为函数 |
| `@ubjs/node` | 原生运行时加载，导出 `resolveLibPath` |
| `@trycua/cua-driver` | 从 `app.asar.unpacked` 经 `dlopen` 加载 Rust SDK |
| `resources/bin/uv` | 可执行并输出版本 |
| `resources/agent-browser/agent-browser` | 可执行并输出版本 |

参考系统上的实际输出：

```text
ok   node-pty (spawn/read/exit)
ok   @napi-rs/canvas (16x16, 115 B PNG)
ok   ssh2 (Client export)
ok   @ubjs/node (native runtime loaded)
ok   @trycua/cua-driver (174 exports)
ok   resources/bin/uv (uv 0.9.9)
ok   resources/agent-browser/agent-browser (agent-browser 0.39.0)
all checks passed
```

## 2. 窗口与布局

方法：以空配置目录启动，轮询 `xwininfo -root -tree` 取得窗口，用 `xwd` 抓取并解码为 PNG 检查。
若系统上装有旧版本，先终止旧实例，并按窗口 id 仅抓取被测实例的窗口。

| 观察项 | 结果 |
| --- | --- |
| 窗口出现 | 标题「计算服务」，class `scnet-client`，1200×741 |
| 首帧时间 | 首次启动 5–20 秒 |
| 渲染内容 | 登录页正常；存在会话时仪表盘正常 |
| 登录窗口控件 | 右上角一组最小化与关闭，无重复 |
| 最小化生效 | XTEST 模拟点击后 map state 变为 `IsUnMapped` |
| 恢复生效 | `_NET_ACTIVE_WINDOW` 后回到 `IsViewable` |
| 悬停状态 | 指针移到控件上会出现悬停底色，确认命中区域 |
| 后备控件簇 | 存在 `.window-tools` 时 `window-controls.js` 报告 `hasRoot: false`，即自行退出 |
| 主路由控件簇 | 当前渲染器主路由 `.window-tools` 数量为 `0`，由后备实现挂载三个按钮 |
| 通过控件最大化 | DevTools 协议点击：`window.is-maximized` false→true，视口 1200×768→1920×1047，图标与提示变为「还原 / Restore」 |
| 通过控件还原 | 再次点击回到 1200×768，图标恢复为最大化 |
| 窗口管理器最大化 | `wmctrl -b add,maximized_vert,maximized_horz` 不经点击即把图标切为「还原」；移除状态后恢复 |

通过 DevTools 协议检查 DOM 确认：登录窗口渲染了厂商的 `.window-tools`（`.min item … size-30px`），
且发布的包内 `function y()` 在 Linux 返回 `undefined`，即未启用 Chromium 覆盖层。当前渲染器的主路由
不挂载厂商控件簇，因此那里的控件面就是后备实现；其最大化状态从 `window.is-maximized` 读取，并在
尺寸变化时重新查询。

最大化/还原相关的行是在 stage 6 重打包的 `app.asar`（含更新后的脚本，与流水线产物一致）上验证的，
不是在重新构建的 `.deb` 上；第 5 节对应 4.1.0-3 包。第 0 节记录了同一批行在 4.1.1 产物上的复核结果。

未验证：平铺窗口管理器下的表现与分数缩放。登录窗口只显示两个控件是厂商设计：`showMax=false`，且
窗口以 `maximizable: false` 创建。第 0 节记录了窗口与登录控件相关各行的 4.1.1 复核结果。

## 3. 图标集成

方法：以 `dpkg-deb -x` 解包到临时根目录，加入标准 `index.theme`，用 `gtk-update-icon-cache`
重建缓存，再通过 `Gtk.IconTheme` 在多个尺寸下解析 `scnet-client`。

| 请求尺寸 | 解析结果 |
| --- | --- |
| 16 | `16x16/apps/scnet-client.png` |
| 24 | `24x24/apps/scnet-client.png` |
| 32 | `32x32/apps/scnet-client.png` |
| 48 | `48x48/apps/scnet-client.png` |
| 64 | `64x64/apps/scnet-client.png` |
| 128 | `128x128/apps/scnet-client.png` |
| 256 | `256x256/apps/scnet-client.png` |

`desktop-file-validate` 对安装的入口返回 0。参考系统未实际通过 `apt` 安装（无 root）：
`postinst`/`postrm` 仅为 `chown`/`chmod`/刷新缓存动作，已审阅但未经 `dpkg` 执行。

## 4. 沙箱

方法：以干净配置目录启动启动器并检查主进程 argv，再用 `SCNET_NO_SANDBOX=1` 强制退化。

| 场景 | argv | 结果 |
| --- | --- | --- |
| 参考系统默认 | 无 `--no-sandbox` | 窗口出现；该机器启用了非特权 user namespace |
| `SCNET_NO_SANDBOX=1` | `--no-sandbox` | 窗口出现 |
| 安装形态 | `postinst` 后 `chrome-sandbox` 为 setuid | 未执行（无 root）；仅审阅了启动器的 setuid 分支 |

## 5. 打包

| 检查 | 结果 |
| --- | --- |
| `dpkg-deb -c` 布局 | `/opt/scnet-client`、`/usr/bin/scnet-client` 软链、桌面入口、13 个图标尺寸 |
| 解包后启动 | 从解包目录可正常出窗口 |
| 版本 | `4.1.0-3`（复核时为 `4.1.1-1`） |
| 依赖 | 同时列出 `t64` 与旧包名，覆盖 Debian 12/13 与 Ubuntu 22.04/24.04 |

## 6. 可重复性

开发过程中流水线被反复执行。已缓存阶段直接复用；冷启动需下载约 390 MB（厂商归档、Electron
运行时、三个 npm 包、两个二进制），在参考系统上约五分钟。

## 7. 未验证项

- 登录、HPC 作业提交、SSH 会话、文件传输、Notebook 生命周期；
- 电脑操作（CUA）：库可加载，但未执行指针与截图动作；驱动需要 X11/Wayland 权限与 `libXtst`；
- 自动更新：更新源不含 Linux 产物，`electron-updater` 也无法替换该布局，因此功能不可用；
- 托盘图标：需要 `libayatana-appindicator3`/`libappindicator3`，本机未安装；
- 同一配置目录多实例：测试中偶发无窗口启动，源于单实例锁与会话恢复；终止残留实例后重启即可
  恢复，未进一步排查；
- ARM64：流水线仅支持 x86-64，尽管上游提供 arm64 macOS 构建，四个原生包也有
  `linux-arm64-gnu` 变体。
