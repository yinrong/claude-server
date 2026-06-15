import 'package:flutter/foundation.dart';
import '../models/agent.dart';
import '../models/api_response.dart';
import '../core/api/api_client.dart';
import '../core/websocket/ws_client.dart';

/// sendInput 函数签名：接受 agentId 和 text，返回 Future<void>
typedef SendInputFn = Future<void> Function(String agentId, String text);

/// getHistory 函数签名：接受 agentId 和可选 sinceTs，返回 HistoryData
typedef GetHistoryFn = Future<HistoryData> Function(
  String agentId, {
  int? sinceTs,
  int limit,
});

/// 单个 Agent 详情页的状态管理
/// 包含实时输出（WS）+ 历史记录（HTTP 增量拉取）+ 快速回复（HTTP POST）
class AgentDetailProvider extends ChangeNotifier {
  final String agentId;
  final SendInputFn _sendInputFn;
  final GetHistoryFn _getHistoryFn;

  Agent? _agent;
  final List<String> _outputLines = [];
  bool _waitingForInput = false;
  WsState _wsState = WsState.disconnected;
  String? _error;

  // 快速回复状态
  bool _isSending = false;
  String? _sendError;

  // 历史记录状态（MC6）
  final List<OutputChunk> _history = [];
  bool _isLoadingHistory = false;

  WsClient? _ws;
  int? _lastHistoryTs;

  AgentDetailProvider(this.agentId)
      : _sendInputFn = ApiClient.instance.sendInput,
        _getHistoryFn = ApiClient.instance.getHistory;

  /// 测试注入构造函数，允许传入 fake sendInput 函数
  @visibleForTesting
  AgentDetailProvider.withSendInput({
    required this.agentId,
    required SendInputFn sendInputFn,
  })  : _sendInputFn = sendInputFn,
        _getHistoryFn = ApiClient.instance.getHistory;

  /// 测试注入构造函数，允许传入 fake getHistory 函数（MC6）
  @visibleForTesting
  AgentDetailProvider.withGetHistory({
    required this.agentId,
    required SendInputFn sendInputFn,
    required GetHistoryFn getHistoryFn,
  })  : _sendInputFn = sendInputFn,
        _getHistoryFn = getHistoryFn;

  Agent? get agent => _agent;
  List<String> get outputLines => List.unmodifiable(_outputLines);
  bool get waitingForInput => _waitingForInput;
  WsState get wsState => _wsState;
  String? get error => _error;
  bool get isSending => _isSending;
  String? get sendError => _sendError;

  // 历史记录 getter（MC6）
  List<OutputChunk> get history => List.unmodifiable(_history);
  bool get isLoadingHistory => _isLoadingHistory;

  /// 初始化：加载 Agent 信息，连接 WebSocket
  Future<void> init() async {
    await _loadAgent();
    _connectWs();
  }

  Future<void> _loadAgent() async {
    try {
      _agent = await ApiClient.instance.getAgent(agentId);
      _error = null;
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = e.toString();
    }
    notifyListeners();
  }

  void _connectWs() {
    _ws = WsClient(
      agentId: agentId,
      onEvent: _handleWsEvent,
      onStateChange: (state) {
        _wsState = state;
        notifyListeners();
      },
    );
    _ws!.connect();
  }

  void _handleWsEvent(WsEvent event) {
    switch (event.type) {
      case WsEventType.history:
        final chunks = event.historyChunks ?? [];
        _outputLines.addAll(chunks);
        notifyListeners();
        break;

      case WsEventType.output:
        final data = event.outputData;
        if (data != null) {
          _outputLines.add(data);
          notifyListeners();
        }
        break;

      case WsEventType.status:
        if (event.statusAgentId == agentId) {
          _waitingForInput = event.waitingForInput ?? false;
          notifyListeners();
        }
        break;

      case WsEventType.exit:
        // PTY 退出，更新 agent 状态
        _agent = _agent?.copyWith(status: 'stopped');
        notifyListeners();
        break;

      case WsEventType.unknown:
        break;
    }
  }

  /// 发送文字输入（走 WS PTY stdin，用于终端透传）
  void sendInput(String text) {
    _ws?.sendInput(text);
  }

  /// 快速回复：通过 HTTP POST /api/v2/agents/:id/input 发送文字指令
  /// 更新 isSending / sendError 状态，通知 UI
  Future<void> sendText(String text) async {
    _isSending = true;
    _sendError = null;
    notifyListeners();

    try {
      await _sendInputFn(agentId, text);
      _sendError = null;
    } on ApiException catch (e) {
      _sendError = e.message;
    } catch (e) {
      _sendError = e.toString();
    } finally {
      _isSending = false;
      notifyListeners();
    }
  }

  /// 加载历史记录（MC6）：从服务端拉取该 Agent 的输出历史
  Future<void> loadHistory() async {
    _isLoadingHistory = true;
    notifyListeners();

    try {
      final data = await _getHistoryFn(agentId);
      _history
        ..clear()
        ..addAll(data.chunks);
    } on ApiException {
      // 加载失败，保持 history 不变
    } catch (_) {
      // 其他异常，保持 history 不变
    } finally {
      _isLoadingHistory = false;
      notifyListeners();
    }
  }

  /// 加载更早的历史记录（MC6）：分页向前加载
  /// 用当前 history 中最早一条的 ts 作为 since_ts 上界
  Future<void> loadMore() async {
    if (_history.isEmpty) return;

    // 找到最早一条记录的 ts
    final earliestTs = _history.map((c) => c.ts).reduce((a, b) => a < b ? a : b);

    _isLoadingHistory = true;
    notifyListeners();

    try {
      final data = await _getHistoryFn(agentId, sinceTs: earliestTs);
      // 将更早的消息插入到 history 前面
      _history.insertAll(0, data.chunks);
    } on ApiException {
      // 加载失败，保持 history 不变
    } catch (_) {
      // 其他异常，保持 history 不变
    } finally {
      _isLoadingHistory = false;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _ws?.dispose();
    super.dispose();
  }
}
