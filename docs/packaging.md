# 打包细节

`build-linux.sh` 的九个阶段，以及每个阶段踩过的坑。

## 0. 获取官方 macOS 包

```bash
curl -sSL -C - -o mac-x64.zip https://dlcdn.scnet.cn/client/mac/SCNet-4.1.0-x64.zip
unzip -q mac-x64.zip -d app      # app/计算服务.app/...
```

`-C -` 支持续传，官方 CDN 返回 `206`。校验用 `latest-mac.yml` 里的 base64 SHA-512。

## 1. Electron 运行时

```bash
curl -o electron.zip https://npmmirror.com/mirrors/electron/44.7.0/electron-v44.7.0-linux-x64.zip
unzip -q electron.zip -d build/work/electron
```

版本必须与 `Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist`
里的 `CFBundleVersion` 一致（44.7.0）。填错不会立刻报错，但原生模块 ABI 会对不上。

## 2. 解包 app.asar

```bash
npx @electron/asar extract "app/计算服务.app/Contents/Resources/app.asar" build/work/app
```

## 3. 安装 Linux 原生模块

```bash
npm pack @napi-rs/canvas-linux-x64-gnu@1.0.2 \
         @trycua/cua-driver-linux-x64-gnu@0.34.1 \
         @ubjs/node-linux-x64-gnu@0.31.0-3
```

把解包出来的 `package/` 按 npm 作用域放进 `build/work/app/node_modules/`。
版本号必须和 `app.asar/package.json` 里锁定的一致（canvas 用精确版本，其它是 optionalDeps）。

## 4. node-pty 按 Electron ABI 编译

npm 上的 `node-pty@1.1.0` 只带 darwin/win32 预编译，Linux 需要自己编译：

```bash
# 1) 头文件：node-gyp 对镜像的 SHASUMS 校验会失败（remote undefined），
#    所以直接下 tarball 到 ~/.cache/node-gyp/<version> 并写 installVersion
mkdir -p ~/.cache/node-gyp/44.7.0
curl -o h.tgz https://cdn.npmmirror.com/binaries/electron/v44.7.0/node-v44.7.0-headers.tar.gz
tar xzf h.tgz --strip-components=1 -C ~/.cache/node-gyp/44.7.0
printf '11' > ~/.cache/node-gyp/44.7.0/installVersion

# 2) 编译
npm i node-pty@1.1.0 --ignore-scripts
cd node_modules/node-pty
npx node-gyp@11 rebuild --nodedir=$HOME/.cache/node-gyp/44.7.0 --target=44.7.0 --arch=x64

# 3) 放到位（node-pty 的加载顺序：build/Release → build/Debug → prebuilds/<platform>-<arch>）
cp build/Release/pty.node <app>/node_modules/node-pty/prebuilds/linux-x64/pty.node
```

Linux 上不需要 darwin 那个 `spawn-helper`。

## 5. 两个独立二进制

| 目标 | 来源 |
| --- | --- |
| `resources/bin/uv` | uv 0.9.9 wheel（`uv-0.9.9-py3-none-manylinux_2_17_x86_64…whl`）里的 `uv-0.9.9.data/scripts/uv`，静态二进制，直接可用 |
| `resources/agent-browser/agent-browser` | `agent-browser@0.39.0` 包内 `bin/agent-browser-linux-x64` |

`agent-browser` 版本要和包内 macOS 二进制一致（`agent-browser --version` → `0.39.0`），
主进程用 `resourcesPath/agent-browser/agent-browser` 这个固定路径拉起 MCP server。

`uv` 只要求能执行；主进程把它当 `uv`/`python` 供给器，版本不作为契约。
如果希望严格对齐，用 `strings` 看包内 macOS uv 的版本再选相近的 Linux 版本。

## 6. 重新打包 asar

```bash
npx @electron/asar pack build/work/app build/linux/resources/app.asar --unpack-dir node_modules
```

**为什么整份 `node_modules` 都 unpack：**

1. `@trycua/cua-driver` 通过 `dlopen` 打开 `libcua_driver_sdk.so`，asar 虚拟路径
   `…/app.asar/node_modules/…/x.so` 会报 `Not a directory`；
2. 主进程 fork CUA worker 时用的是
   `join(process.resourcesPath, "app.asar.unpacked", "node_modules/@trycua/cua-driver/dist/index.js")`，
   该文件必须真实存在于 `app.asar.unpacked` 下；
3. 上游原本也是按包粒度 unpack（`@napi-rs/canvas*`、`@trycua/*`、`@ubjs/*`、`jszip`、
   `node-pty`、`ssh2`），整份 unpack 更省心。

asar 完整性校验（fuses 里的 `EnableEmbeddedAsarIntegrityValidation`）未启用，
重打包不会触发校验失败；`ELECTRON_RUN_AS_NODE` 也可用，说明 `RunAsNode` fuse 开着。

## 7. 复制非 asar 资源

`agent-skills/`、`agent-plugins/`、`connectors/`、`home-scenarios/`、`cli/`、`cua/`、
`en.lproj/`、`tray*.png`、`app-update.yml` 都是纯数据/JS，原样复制即可。
`app-update.yml` 保持原样（Linux 上自动更新不可用，见 README）。

## 8. 图标与启动器

- 图标：`icon.icns` 是容器，内部是多个 PNG 块；脚本按 IHDR 宽高挑最大的（1024×1024）导出；
- 启动器：优先用 setuid 的 `chrome-sandbox`；其次用非特权 user namespace
  （`/proc/sys/user/max_user_namespaces` > 0 且 `unprivileged_userns_clone` ≠ 0，
  且 `apparmor_restrict_unprivileged_userns` ≠ 1）；两者都不可用时才退化为
  `--no-sandbox`，否则 Electron 会以
  `The SUID sandbox helper binary was found, but is not configured correctly` 退出。
  可用 `SCNET_NO_SANDBOX=1` 强制退化（如远程桌面、容器里）。

## 9. deb 布局

```
/opt/scnet-client/                     整个 build/linux（含 launcher.sh）
/usr/bin/scnet-client -> /opt/scnet-client/launcher.sh
/usr/share/applications/scnet-client.desktop
/usr/share/icons/hicolor/1024x1024/apps/scnet-client.png
```

`postinst` 把 `chrome-sandbox` 设成 `root:root 4755` 并刷新桌面数据库；
依赖里同时写 `t64` 与非 `t64` 包名，兼容 Debian 12/13 与 Ubuntu 22.04/24.04。

## 升级到新上游版本

1. `check-upstream.sh` 看新版本号与 sha512；
2. 更新 `build-linux.sh` 顶部的 `MAC_ZIP_URL` / `APP_VERSION` / `MAC_ZIP_SHA512`；
3. 检查 `Frameworks/.../Info.plist` 的 Electron 版本是否变化（变了要改 `ELECTRON_VERSION` 并重编 node-pty）；
4. 对照新 `app.asar/package.json` 更新 canvas / cua-driver / ubjs / agent-browser 版本；
5. 若新增原生依赖（`.node`/`.so`/`.dylib`），必须补对应 `linux-*-gnu` 包，否则相关功能静默失效。

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `Not a directory` 加载 `.so` | asar 内路径无法 `dlopen`，确认 `--unpack-dir node_modules` 生效 |
| `Failed to load native module: pty.node` | node-pty 没用 Electron 头文件编译，ABI 不匹配，重跑第 4 步 |
| 启动即退出，提示 SUID sandbox | 用 `launcher.sh`（会自动判断）；或 `chmod 4755 chrome-sandbox`（需 root） |
| 启动后无输出、退出码 0 | 已有实例在跑（单实例锁），不是崩溃 |
| 界面空白 + cookie 警告 | 正常提示（`file://` 下不存 cookie），不影响功能 |
| 托盘图标不显示 | 缺少 `libayatana-appindicator`/`libappindicator3`，装对应包 |
