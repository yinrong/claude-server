import 'package:flutter/foundation.dart';
import '../models/agent.dart';
import '../core/api/api_client.dart';
import '../core/websocket/ws_client.dart';

/// Agent 列表状态管理
/// 使用 Provider（ChangeNotifier 模式）
///
/// 职责：
/// 1. 拉取并缓存 Agent 列表（HTTP GET /api/v2/agents）
/// 2. 通过全局 WS 连接监听 status 事件，实时更新 waitingForInput 状态
class AgentsProvider extends ChangeNotifier {
  List<Agent> _agents = [];
  bool _loading = false;
  String? _error;

  /// 全局 WS 客户端（连接到第一个 Agent，监听所有 Agent 的 status 事件）
  /// 使用 firstAgentId 作为 WS 连接入口，服务端会推送所有 Agent 的 status 广播
  WsClient? _ws;

  /// WS 连接状态，供 UI 订阅
  WsState _wsState = WsState.disconnected;
  WsState get wsState => _wsState;

  /// 允许测试注入自定义 WsClient 工厂
  @visibleForTesting
  WsClient Function(String agentId)? wsClientFactory;

  List<Agent> get agents => List.unmodifiable(_agents);
  bool get loading => _loading;
  String? get error => _error;

  /// 是否有 Agent（用于空状态判断）
  bool get hasAgents => _agents.isNotEmpty;

  /// 刷新 Agent 列表（从 /api/v2/agents 拉取）
  /// 列表加载后若有 Agent，启动 WS 连接以接收实时 status 事件
  Future<void> refresh() async {
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      _agents = await ApiClient.instance.listAgents();
      _error = null;
      _ensureWsConnected();
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = e.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  /// 更新单个 Agent 的实时状态（来自 WS status 事件）
  void updateAgentStatus(String agentId, {bool? waitingForInput}) {
    final idx = _agents.indexWhere((a) => a.id == agentId);
    if (idx < 0) return;
    _agents = List.of(_agents);
    _agents[idx] = _agents[idx].copyWith(waitingForInput: waitingForInput);
    notifyListeners();
  }

  /// 确保 WS 已连接（列表非空时调用）
  /// 使用第一个 Agent 的 id 作为 WS 连接入口
  /// 服务端 status 事件会广播所有 Agent 的状态变化（含 agentId 字段）
  void _ensureWsConnected() {
    if (_agents.isEmpty) return;
    if (_ws != null) return; // 已连接，不重复建立

    final firstAgentId = _agents.first.id;
    _ws = (wsClientFactory ?? _defaultWsFactory)(firstAgentId);
    _ws!.connect();
  }

  WsClient _defaultWsFactory(String agentId) {
    return WsClient(
      agentId: agentId,
      onEvent: _handleWsEvent,
      onStateChange: (s) {
        _wsState = s;
        notifyListeners();
      },
    );
  }

  void _handleWsEvent(WsEvent event) {
    if (event.type != WsEventType.status) return;
    final agentId = event.statusAgentId;
    final waiting = event.waitingForInput;
    if (agentId == null) return;
    updateAgentStatus(agentId, waitingForInput: waiting);
  }

  @override
  void dispose() {
    _ws?.dispose();
    _ws = null;
    super.dispose();
  }

  // ── 测试专用 ──────────────────────────────────────────────────────────────────

  /// 直接注入 Agent 列表，绕过 HTTP（仅供单元测试使用）
  @visibleForTesting
  void seedAgentsForTest(List<Agent> agents) {
    _agents = List.of(agents);
    notifyListeners();
  }

  /// 将 WsEvent 直接路由到内部 handler（仅供单元测试使用）
  @visibleForTesting
  void handleWsEventForTest(WsEvent event) {
    _handleWsEvent(event);
  }
}
