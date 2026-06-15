// 注意：需要 flutter 环境才能运行（flutter test）
// 不依赖 Flutter Widget，纯 Dart 逻辑测试

import 'package:flutter_test/flutter_test.dart';
import 'package:claude_mobile/models/agent.dart';
import 'package:claude_mobile/models/api_response.dart';
import 'package:claude_mobile/core/websocket/ws_client.dart';

void main() {
  group('Agent 模型', () {
    test('fromJson 完整解析', () {
      final agent = Agent.fromJson({
        'id': 'worker-1',
        'name': 'Worker 1',
        'type': 'worker',
        'adapter_type': 'claude-code',
        'status': 'running',
        'waitingForInput': false,
        'created_at': '2024-06-01T12:00:00.000Z',
      });

      expect(agent.id, 'worker-1');
      expect(agent.name, 'Worker 1');
      expect(agent.type, 'worker');
      expect(agent.status, 'running');
      expect(agent.waitingForInput, false);
    });

    test('fromJson 缺失字段使用默认值', () {
      final agent = Agent.fromJson({'id': 'x'});
      expect(agent.name, 'x'); // name 默认回退到 id
      expect(agent.type, 'worker');
      expect(agent.status, 'unknown');
      expect(agent.waitingForInput, false);
    });

    test('copyWith 只更新指定字段', () {
      final original = Agent.fromJson({
        'id': 'a1',
        'status': 'running',
        'waitingForInput': false,
      });
      final updated = original.copyWith(waitingForInput: true);
      expect(updated.id, 'a1');
      expect(updated.status, 'running');
      expect(updated.waitingForInput, true);
    });
  });

  group('ApiResponse 模型', () {
    test('isSuccess 在 ok=true 时为 true', () {
      final resp = ApiResponse<String>.fromJson(
        {'ok': true, 'data': 'hello', 'error': null, 'ts': 1000},
        (d) => d as String,
      );
      expect(resp.isSuccess, true);
      expect(resp.data, 'hello');
    });

    test('isSuccess 在 ok=false 时为 false', () {
      final resp = ApiResponse<String>.fromJson(
        {'ok': false, 'data': null, 'error': 'not found', 'ts': 2000},
        null,
      );
      expect(resp.isSuccess, false);
      expect(resp.error, 'not found');
    });
  });

  group('OutputChunk 模型', () {
    test('fromJson 正确解析', () {
      final chunk = OutputChunk.fromJson({
        'agent_id': 'a1',
        'data': 'hello world\r\n',
        'ts': 9999,
      });
      expect(chunk.agentId, 'a1');
      expect(chunk.data, 'hello world\r\n');
      expect(chunk.ts, 9999);
    });
  });

  group('WsEvent 解析', () {
    test('output 事件解析', () {
      final event = WsEvent.fromJson({'type': 'output', 'data': 'abc'});
      expect(event.type, WsEventType.output);
      expect(event.outputData, 'abc');
    });

    test('status 事件解析', () {
      final event = WsEvent.fromJson({
        'type': 'status',
        'agentId': 'w1',
        'waitingForInput': true,
      });
      expect(event.type, WsEventType.status);
      expect(event.statusAgentId, 'w1');
      expect(event.waitingForInput, true);
    });

    test('history 事件解析', () {
      final event = WsEvent.fromJson({
        'type': 'history',
        'chunks': ['a', 'b', 'c'],
      });
      expect(event.type, WsEventType.history);
      expect(event.historyChunks, ['a', 'b', 'c']);
    });

    test('未知事件类型不抛出', () {
      final event = WsEvent.fromJson({'type': 'unknown_future_type'});
      expect(event.type, WsEventType.unknown);
    });
  });
}
