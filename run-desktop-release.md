# 桌面版启动脚本

## Release 正式模式

双击根目录的 `run-desktop-release.cmd`，或在项目根目录执行：

```cmd
run-desktop-release.cmd
```

脚本会检查构建环境、在缺少前端依赖时自动安装，准备 Perfetto 引擎资源，然后编译最新的 Release 程序并打开。构建需要 Node.js 22.12+、Rust、Visual Studio C++ 构建工具和 Windows SDK，详细要求见 README.md。首次准备需要联网，Release 编译可能耗时数分钟。

启动的程序位于 `src-tauri/target/release/visualstream.exe`，内嵌前端与解析资源，不依赖本地开发服务；脚本在程序启动后退出。此脚本只构建可运行程序，不生成安装包。

已有构建结果时，可以跳过编译直接启动：

```cmd
run-desktop-release.cmd --no-build
```

该选项不检查 Node.js 或 Rust，直接运行已有的 Release 程序，也不会包含上次构建之后的代码修改；如果尚未构建，会提示先运行默认命令。重新构建前应关闭已打开的 Release 程序。

需要安装包时执行：

```cmd
npm run desktop:build
```

安装包输出到 `src-tauri/target/release/bundle/nsis/`。

## Debug 开发模式

原 `run-desktop.cmd` 已更名为 `run-desktop-debug.cmd`。双击运行后会启动前端开发服务和 Debug 客户端，支持界面热更新，适合修改代码时使用。保持命令窗口开启，按 Ctrl+C 停止。

Debug 使用 5174 端口，浏览器版的 `run.cmd` 使用 5173 端口，两者可以同时运行。
