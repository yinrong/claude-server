// 纯 Dart 逻辑测试，不依赖 Flutter Widget
// 测试 AgentDetailProvider 的 sendText（HTTP API 快速回复路径）：
//   T1. sendText 调用 sendInputFn 时传入正确的 agentId 和 text
//   T2. 发送期间 isSending 为 true，完成后为 false
//   T3. 发送失败时 sendError 非空
//
// 运行方式：flutter test test/agent_detail_provider_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:claude_mobile/providers/agent_detail_provider.dart';
import 'package:claude_mobile/core/api/api_client.dart';

// ── 辅助：构造可追踪调用的 sendInputFn ────────────────────────────────────────

class _SendInputTracker {
  String? lastAgentId;
  String? lastText;
  bool shouldThrow = false;
  String errorMessage = 'network error';

  /// 供注入给 AgentDetailProvider 的函数
  Future<void> call(String agentId, String text) async {
    lastAgentId = agentId;
    lastText = text;
    if (shouldThrow) {
      throw ApiException(errorMessage);
    }
  }
}

// ── 测试辅助：构建不需要真实 WS 的 Provider ────────────────────────────────────

AgentDetailProvider _makeProvider({
  String agentId = 'worker-1',
  required _SendInputTracker tracker,
}) {
  return AgentDetailProvider.withSendInput(
    agentId: agentId,
    sendInputFn: tracker.call,
  );
}

void main() {
  // ── T1: sendText 传入正确的 agentId 和 text ───────────────────────────────

  group('T1: sendText 参数传递正确', () {
    test('调用时 agentId 和 text 被正确转发给 sendInputFn', () async {
      final tracker = _SendInputTracker();
      final provider = _makeProvider(agentId: 'worker-42', tracker: tracker);

      await provider.sendText('hello world');

      expect(tracker.lastAgentId, 'worker-42');
      expect(tracker.lastText, 'hello world');
    });

    test('不同 agentId 时传入的 agentId 也正确', () async {
      final tracker = _SendInputTracker();
      final provider = _makeProvider(agentId: 'master-1', tracker: tracker);

      await provider.sendText('dispatch task');

      expect(tracker.lastAgentId, 'master-1');
      expect(tracker.lastText, 'dispatch task');
    });

    test('空字符串 text 也被原样传递', () async {
      final tracker = _SendInputTracker();
      final provider = _makeProvider(agentId: 'w1', tracker: tracker);

      await provider.sendText('');

      expect(tracker.lastAgentId, 'w1');
      expect(tracker.lastText, '');
    });
  });

  // ── T2: 发送中 isSending=true，完成后 isSending=false ─────────────────────

  group('T2: isSending 状态变化', () {
    test('初始状态 isSending 为 false', () {
      final tracker = _SendInputTracker();
      final provider = _makeProvider(tracker: tracker);
      expect(provider.isSending, false);
    });

    test('发送成功后 isSending 恢复为 false', () async {
      final tracker = _SendInputTracker();
      final provider = _makeProvider(tracker: tracker);

      await provider.sendText('some text');

      expect(provider.isSending, false);
    });

    test('发送期间 isSending 为 true', () async {
      // 在 sendInputFn 执行过程中同步检查 isSending 状态
      bool? sendingDuringCall;
      late AgentDetailProvider capturedProvider;

      final provider = AgentDetailProvider.withSendInput(
        agentId: 'w1',
        sendInputFn: (agentId, text) async {
          // 此时 sendText 已设置 _isSending = true，尚未 finally
          sendingDuringCall = capturedProvider.isSending;
        },
      );
      capturedProvider = provider;

      await provider.sendText('trigger check');

      expect(sendingDuringCall, true, reason: '调用 sendInputFn 时 isSending 应为 true');
      expect(provider.isSending, false, reason: '调用完成后 isSending 应为 false');
    });

    test('发送失败后 isSending 也恢复为 false', () async {
      final tracker = _SendInputTracker()..shouldThrow = true;
      final provider = _makeProvider(tracker: tracker);

      await provider.sendText('will fail');

      expect(provider.isSending, false);
    });
  });

  // ── T3: 发送失败时 sendError 非空 ─────────────────────────────────────────

  group('T3: 发送失败时 sendError 非空', () {
    test('sendInputFn 抛出 ApiException 时 sendError 被设置', () async {
      final tracker = _SendInputTracker()
        ..shouldThrow = true
        ..errorMessage = 'connection refused';
      final provider = _makeProvider(tracker: tracker);

      await provider.sendText('will fail');

      expect(provider.sendError, isNotNull);
      expect(provider.sendError, contains('connection refused'));
    });

    test('成功发送后 sendError 为 null', () async {
      final tracker = _SendInputTracker();
      final provider = _makeProvider(tracker: tracker);

      await provider.sendText('success');

      expect(provider.sendError, isNull);
    });

    test('成功后失败，sendError 被更新', () async {
      final tracker = _SendInputTracker();
      final provider = _makeProvider(tracker: tracker);

      // 第一次成功
      await provider.sendText('ok');
      expect(provider.sendError, isNull);

      // 第二次失败
      tracker.shouldThrow = true;
      tracker.errorMessage = 'timeout';
      await provider.sendText('fail');
      expect(provider.sendError, isNotNull);
      expect(provider.sendError, contains('timeout'));
    });

    test('失败后再次成功，sendError 被清空', () async {
      final tracker = _SendInputTracker()..shouldThrow = true;
      final provider = _makeProvider(tracker: tracker);

      // 先失败
      await provider.sendText('fail first');
      expect(provider.sendError, isNotNull);

      // 再成功，error 应清空
      tracker.shouldThrow = false;
      await provider.sendText('succeed after');
      expect(provider.sendError, isNull);
    });
  });
}
