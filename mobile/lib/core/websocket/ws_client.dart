import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../config/app_config.dart';

/// WebSocket 事件类型（Server → Client）
enum WsEventType {
  history,  // 连接时回放 PTY 历史缓存
  output,   // PTY 实时输出（含 ANSI 转义）
  status,   // Agent 等待输入状态变化
  exit,     // PTY 进程退出
  unknown,
}

/// 从服务端收到的 WS 消息
class WsEvent {
  final WsEventType type;
  final Map<String, dynamic> raw;

  const WsEvent({required this.type, required this.raw});

  /// output 事件的数据字符串
  String? get outputData => raw['data'] as String?;

  /// status 事件：agentId
  String? get statusAgentId => raw['agentId'] as String?;

  /// status 事件：是否等待输入
  bool? get waitingForInput => raw['waitingForInput'] as bool?;

  /// history 事件：历史片段列表
  List<String>? get historyChunks {
    final chunks = raw['chunks'];
    if (chunks is List) return chunks.cast<String>();
    return null;
  }

  static WsEvent fromJson(Map<String, dynamic> json) {
    final typeStr = json['type'] as String? ?? '';
    final type = switch (typeStr) {
      'history' => WsEventType.history,
      'output' => WsEventType.output,
      'status' => WsEventType.status,
      'exit' => WsEventType.exit,
      _ => WsEventType.unknown,
    };
    return WsEvent(type: type, raw: json);
  }
}

/// WebSocket 连接状态
enum WsState { disconnected, connecting, connected, reconnecting }

/// 计算指数退避延迟（秒），纯函数，方便测试
///
/// [attempt] 从 0 开始的重试次数
/// [maxDelay] 上限（默认 30 秒）
int calcBackoffDelay(int attempt, {int maxDelay = 30}) {
  // 1 → 2 → 4 → 8 → 16 → 30（上限）
  final delay = 1 << attempt; // 2^attempt
  return delay.clamp(1, maxDelay);
}

/// WebSocket 客户端封装
/// - 自动重连（指数退避，最大 30s）
/// - 心跳 ping（每 30s）
/// - 订阅多个 Agent，重连后自动恢复订阅
class WsClient {
  final String agentId;
  final void Function(WsEvent)? onEvent;
  final void Function(WsState)? onStateChange;

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _pingTimer;
  Timer? _reconnectTimer;

  /// 重连次数，用于退避计算（成功后重置为 0）
  int _reconnectAttempt = 0;

  bool _disposed = false;

  WsState _state = WsState.disconnected;
  WsState get state => _state;

  /// 已订阅的额外 agentId 列表（不含初始 agentId）
  /// 重连成功后会自动重新订阅
  final List<String> _subscribedAgents = [];

  /// 只读访问订阅列表（测试用）
  List<String> get subscribedAgents => List.unmodifiable(_subscribedAgents);

  WsClient({
    required this.agentId,
    this.onEvent,
    this.onStateChange,
  });

  /// 建立连接
  void connect() {
    if (_disposed) return;
    _setState(WsState.connecting);
    _doConnect();
  }

  void _doConnect() {
    if (_disposed) return;
    final wsUrl =
        '${AppConfig.instance.wsBaseUrl}/ws?agentId=$agentId';
    try {
      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));
      _sub = _channel!.stream.listen(
        _onData,
        onError: _onError,
        onDone: _onDone,
      );
      _setState(WsState.connected);
      _startPing();
      _reconnectAttempt = 0; // 成功连接后重置退避计数
      _resubscribeAll();   // 重连后恢复所有已订阅 Agent
    } catch (e) {
      _scheduleReconnect();
    }
  }

  /// 重连成功后重新发送所有已订阅的 sub 消息
  void _resubscribeAll() {
    for (final id in _subscribedAgents) {
      _channel?.sink.add(jsonEncode({'type': 'sub', 'agentId': id}));
    }
  }

  void _onData(dynamic raw) {
    if (raw is! String) return;
    try {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      final event = WsEvent.fromJson(json);
      onEvent?.call(event);
    } catch (_) {
      // 忽略解析错误
    }
  }

  void _onError(Object error) {
    _cleanup();
    _scheduleReconnect();
  }

  void _onDone() {
    _cleanup();
    if (!_disposed) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_disposed) return;
    _setState(WsState.reconnecting);
    final delay = calcBackoffDelay(_reconnectAttempt);
    _reconnectTimer = Timer(Duration(seconds: delay), () {
      if (!_disposed) _doConnect();
    });
    // 递增重试次数（上限：使最大延迟不超过 30s，即 attempt <= 5 时 2^5=32 → clamp=30）
    _reconnectAttempt = (_reconnectAttempt + 1).clamp(0, 10);
  }

  void _startPing() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_state == WsState.connected) {
        _channel?.sink.add(jsonEncode({'type': 'ping'}));
      }
    });
  }

  /// 订阅额外的 Agent（对应 WS 协议 {type: "sub", agentId: "..."}）
  /// 记录到内部列表，重连后自动恢复
  void subscribeAgent(String id) {
    if (!_subscribedAgents.contains(id)) {
      _subscribedAgents.add(id);
    }
    if (_state == WsState.connected) {
      _channel?.sink.add(jsonEncode({'type': 'sub', 'agentId': id}));
    }
  }

  /// 取消订阅某个 Agent
  void unsubscribeAgent(String id) {
    _subscribedAgents.remove(id);
    // 注意：WS 协议暂无 unsub 消息，只移除本地列表以避免重连后重新订阅
  }

  /// 发送键盘输入（对应 WS 协议 {type: "input", data: "..."}）
  void sendInput(String text) {
    if (_state != WsState.connected) return;
    _channel?.sink.add(jsonEncode({'type': 'input', 'data': text}));
  }

  void _cleanup() {
    _pingTimer?.cancel();
    _pingTimer = null;
    _sub?.cancel();
    _sub = null;
    _channel?.sink.close();
    _channel = null;
  }

  void _setState(WsState s) {
    if (_state == s) return;
    _state = s;
    onStateChange?.call(s);
  }

  /// 释放所有资源
  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _cleanup();
    _setState(WsState.disconnected);
  }
}
