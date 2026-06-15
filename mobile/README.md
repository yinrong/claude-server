# Claude Server Mobile

Flutter 手机客户端，用于监督和控制 claude-server 上运行的 AI Agent。

## 功能

- Agent 列表 + 实时 ⏳/●/○ 状态
- 快速回复（直接向 Agent 发送指令）
- 对话历史查看
- 文件浏览（Agent 工作目录）
- Diff / 代码变更查看
- WS 长连接保活（指数退避重连）
- 首次启动省电模式引导

## 环境要求

- Flutter 3.27+（安装在 `~/flutter`，已在本机配置）
- Android SDK（安装在 `~/Android`，已在本机配置）
- Android 设备或模拟器

## 配置服务器地址

默认连接 `http://localhost:4282`（dev 环境）。

修改方式：编辑 `lib/core/config/app_config.dart`：
```dart
static const String defaultBaseUrl = 'http://<your-server-ip>:4280';
```

## 安装依赖

```bash
cd mobile
export PATH="$HOME/flutter/bin:$PATH"
flutter pub get
```

## 运行测试

```bash
cd mobile
export PATH="$HOME/flutter/bin:$PATH"
flutter test
# 当前：90 passed
```

## 构建 APK（Android）

```bash
cd mobile
export PATH="$HOME/flutter/bin:$PATH"
export ANDROID_HOME="$HOME/Android"
flutter build apk --release
# 产物：build/app/outputs/flutter-apk/app-release.apk
```

## 安装到手机

```bash
# 通过 USB 连接手机（开启 USB 调试），或启动模拟器
export PATH="$HOME/flutter/bin:$HOME/Android/platform-tools:$PATH"
flutter install
# 或直接 adb install build/app/outputs/flutter-apk/app-release.apk
```

## 开发模式运行

```bash
cd mobile
export PATH="$HOME/flutter/bin:$PATH"
flutter run
```

## 项目结构

```
lib/
├── main.dart                    # 入口
├── app.dart                     # 根组件 + 路由
├── core/
│   ├── api/api_client.dart      # HTTP 客户端（/api/v2）
│   ├── config/app_config.dart   # 服务器地址配置
│   └── websocket/ws_client.dart # WS 客户端（保活 + 重连）
├── models/                      # Agent / ApiResponse 等数据模型
├── providers/                   # 状态管理（Provider）
├── screens/
│   ├── home/                    # Agent 列表页
│   ├── agent_detail/            # 详情页（历史 + 快速回复）
│   ├── file_browser/            # 文件浏览页
│   ├── diff_viewer/             # Diff 查看页
│   └── onboarding/              # 首次启动省电引导
└── services/
    └── onboarding_service.dart  # 首次启动 flag 持久化
```

## 连接的服务端 API

| 接口 | 说明 |
|------|------|
| GET /api/v2/agents | Agent 列表 |
| GET /api/v2/agents/:id | Agent 详情 |
| POST /api/v2/agents/:id/input | 发送指令 |
| GET /api/v2/agents/:id/history | 对话历史（支持 since_ts） |
| GET /api/v2/agents/:id/diff | git diff 变更 |
| GET /api/browse?path= | 目录浏览 |
| GET /api/download?path= | 文件内容 |
| WS /ws?agentId= | 实时输出 + 状态事件 |
