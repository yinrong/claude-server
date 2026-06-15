// 纯 Dart 逻辑测试，不依赖 Flutter Widget
// 测试 AgentsProvider 的核心逻辑：
//   T1. listAgents 响应正确解析为 Agent 列表（JSON → Agent.fromJson 路径）
//   T2. WS status 事件正确更新 Agent 的 waitingForInput 状态
//   T3. 空列表时 hasAgents 为 false
//
// 运行方式：flutter test test/agents_provider_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:claude_mobile/models/agent.dart';
import 'package:claude_mobile/providers/agents_provider.dart';
import 'package:claude_mobile/core/websocket/ws_client.dart';

// ── 辅助：构造 Agent JSON ──────────────────────────────────────────────────────

Map<String, dynamic> _agentJson({
  String id = 'worker-1',
  String name = 'Worker 1',
  String type = 'worker',
  String adapterType = 'claude-code',
  String status = 'running',
  bool waitingForInput = false,
}) =>
    {
      'id': id,
      'name': name,
      'type': type,
      'adapter_type': adapterType,
      'status': status,
      'waitingForInput': waitingForInput,
      'created_at': '2024-06-01T12:00:00.000Z',
    };

void main() {
  // ── T1: listAgents 响应解析 ────────────────────────────────────────────────
  // 模拟路径：服务端 JSON → ApiResponse<List<Agent>> → Agent.fromJson

  group('T1: listAgents 响应解析', () {
    test('从 JSON 数组正确构建 Agent 列表', () {
      // 模拟 ApiClient.listAgents 内部解析逻辑
      final rawList = [
        _agentJson(id: 'master-1', name: 'Master', type: 'master'),
        _agentJson(id: 'worker-1', name: 'Worker 1', type: 'worker'),
      ];

      final agents = rawList
          .map((e) => Agent.fromJson(e))
          .toList();

      expect(agents.length, 2);
      expect(agents[0].id, 'master-1');
      expect(agents[0].type, 'master');
      expect(agents[1].id, 'worker-1');
      expect(agents[1].type, 'worker');
      expect(agents[1].status, 'running');
      expect(agents[1].waitingForInput, false);
    });

    test('waitingForInput=true 字段正确传递', () {
      final agent = Agent.fromJson(
        _agentJson(id: 'w2', waitingForInput: true, status: 'running'),
      );
      expect(agent.waitingForInput, true);
      expect(agent.status, 'running');
    });

    test('adapterType 正确读取 adapter_type 字段', () {
      final agent = Agent.fromJson(
        _agentJson(id: 'w3', adapterType: 'stream'),
      );
      expect(agent.adapterType, 'stream');
    });
  });

  // ── T2: WS status 事件更新 waitingForInput ─────────────────────────────────
  // 模拟路径：WsEvent(status) → _handleWsEvent → updateAgentStatus → copyWith

  group('T2: WS status 事件更新 waitingForInput', () {
    test('status 事件将目标 Agent 的 waitingForInput 设为 true', () {
      final provider = AgentsProvider();
      provider.seedAgentsForTest([
        Agent.fromJson(_agentJson(id: 'w1', waitingForInput: false)),
        Agent.fromJson(_agentJson(id: 'w2', waitingForInput: false)),
      ]);

      provider.handleWsEventForTest(WsEvent.fromJson({
        'type': 'status',
        'agentId': 'w1',
        'waitingForInput': true,
      }));

      // w1 更新为 true，w2 不变
      expect(provider.agents.firstWhere((a) => a.id == 'w1').waitingForInput, true);
      expect(provider.agents.firstWhere((a) => a.id == 'w2').waitingForInput, false);
    });

    test('status 事件将 waitingForInput 设回 false', () {
      final provider = AgentsProvider();
      provider.seedAgentsForTest([
        Agent.fromJson(_agentJson(id: 'w1', waitingForInput: true)),
      ]);

      provider.handleWsEventForTest(WsEvent.fromJson({
        'type': 'status',
        'agentId': 'w1',
        'waitingForInput': false,
      }));

      expect(provider.agents.first.waitingForInput, false);
    });

    test('非 status 类型事件不影响 Agent 列表', () {
      final provider = AgentsProvider();
      provider.seedAgentsForTest([
        Agent.fromJson(_agentJson(id: 'w1', waitingForInput: false)),
      ]);

      // output 事件不应改变任何状态
      provider.handleWsEventForTest(
        WsEvent.fromJson({'type': 'output', 'data': 'hello'}),
      );

      expect(provider.agents.first.waitingForInput, false);
    });

    test('agentId 不在列表中的 status 事件被安全忽略', () {
      final provider = AgentsProvider();
      provider.seedAgentsForTest([
        Agent.fromJson(_agentJson(id: 'w1', waitingForInput: false)),
      ]);

      // 不应抛出异常
      expect(
        () => provider.handleWsEventForTest(WsEvent.fromJson({
          'type': 'status',
          'agentId': 'nonexistent',
          'waitingForInput': true,
        })),
        returnsNormally,
      );
      expect(provider.agents.first.waitingForInput, false);
    });
  });

  // ── T3: hasAgents 空状态判断 ───────────────────────────────────────────────

  group('T3: hasAgents 空状态判断', () {
    test('初始状态 hasAgents 为 false，agents 为空', () {
      final provider = AgentsProvider();
      expect(provider.hasAgents, false);
      expect(provider.agents, isEmpty);
    });

    test('有 Agent 时 hasAgents 为 true', () {
      final provider = AgentsProvider();
      provider.seedAgentsForTest([
        Agent.fromJson(_agentJson(id: 'w1')),
      ]);
      expect(provider.hasAgents, true);
    });

    test('注入空列表时 hasAgents 为 false', () {
      final provider = AgentsProvider();
      provider.seedAgentsForTest([]);
      expect(provider.hasAgents, false);
    });

    test('多个 Agent 时 hasAgents 为 true 且数量正确', () {
      final provider = AgentsProvider();
      provider.seedAgentsForTest([
        Agent.fromJson(_agentJson(id: 'w1')),
        Agent.fromJson(_agentJson(id: 'w2')),
      ]);
      expect(provider.hasAgents, true);
      expect(provider.agents.length, 2);
    });
  });
}
