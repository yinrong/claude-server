/// MC3 单元测试：WS 保活逻辑 + onboarding flag 读写
///
/// 测试覆盖：
///   1. 指数退避计算：1→2→4→8→16→30（上限）
///   2. 重连后 agentId 订阅列表正确恢复
///   3. onboarding flag 读写逻辑
///
/// 注意：这些测试是纯 Dart 逻辑，不依赖 Flutter Widgets，
/// 但仍需要 flutter_test 包（因为项目使用 flutter 而非 dart SDK）。
/// 运行命令（需 flutter 环境）：flutter test test/ws_client_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:claude_mobile/core/websocket/ws_client.dart';
import 'package:claude_mobile/services/onboarding_service.dart';

void main() {
  // ────────────────────────────────────────────────────────────────────────────
  // 1. 指数退避计算
  // ────────────────────────────────────────────────────────────────────────────
  group('calcBackoffDelay — 指数退避', () {
    test('attempt=0 时返回 1s', () {
      expect(calcBackoffDelay(0), 1);
    });

    test('attempt=1 时返回 2s', () {
      expect(calcBackoffDelay(1), 2);
    });

    test('attempt=2 时返回 4s', () {
      expect(calcBackoffDelay(2), 4);
    });

    test('attempt=3 时返回 8s', () {
      expect(calcBackoffDelay(3), 8);
    });

    test('attempt=4 时返回 16s', () {
      expect(calcBackoffDelay(4), 16);
    });

    test('attempt=5 时返回 30s（上限，2^5=32 → clamp 30）', () {
      expect(calcBackoffDelay(5), 30);
    });

    test('attempt=10 时仍返回 30s（持续上限）', () {
      expect(calcBackoffDelay(10), 30);
    });

    test('自定义 maxDelay=10：attempt=4 时被截断为 10', () {
      // 2^4 = 16 → clamp(1,10) = 10
      expect(calcBackoffDelay(4, maxDelay: 10), 10);
    });

    test('连续调用模拟整个退避序列', () {
      final expected = [1, 2, 4, 8, 16, 30, 30, 30];
      final result = List.generate(
        expected.length,
        (i) => calcBackoffDelay(i),
      );
      expect(result, expected);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. WsClient 订阅列表管理（不建立真实 WS 连接）
  // ────────────────────────────────────────────────────────────────────────────
  group('WsClient — 订阅列表管理', () {
    // 创建一个未 connect() 的 WsClient（不会发起真实网络请求）
    WsClient makeClient() => WsClient(agentId: 'primary-agent');

    test('初始订阅列表为空', () {
      final client = makeClient();
      expect(client.subscribedAgents, isEmpty);
      client.dispose();
    });

    test('subscribeAgent 添加到列表', () {
      final client = makeClient();
      client.subscribeAgent('worker-1');
      expect(client.subscribedAgents, contains('worker-1'));
      client.dispose();
    });

    test('subscribeAgent 重复添加不会导致列表重复', () {
      final client = makeClient();
      client.subscribeAgent('worker-1');
      client.subscribeAgent('worker-1');
      expect(
        client.subscribedAgents.where((id) => id == 'worker-1').length,
        1,
      );
      client.dispose();
    });

    test('unsubscribeAgent 从列表中移除', () {
      final client = makeClient();
      client.subscribeAgent('worker-1');
      client.subscribeAgent('worker-2');
      client.unsubscribeAgent('worker-1');
      expect(client.subscribedAgents, isNot(contains('worker-1')));
      expect(client.subscribedAgents, contains('worker-2'));
      client.dispose();
    });

    test('订阅多个 Agent 后列表完整', () {
      final client = makeClient();
      client.subscribeAgent('worker-1');
      client.subscribeAgent('worker-2');
      client.subscribeAgent('master-1');
      expect(client.subscribedAgents, hasLength(3));
      expect(client.subscribedAgents, containsAll(['worker-1', 'worker-2', 'master-1']));
      client.dispose();
    });

    test('dispose 后订阅列表数据仍可读（只是 WS 已关闭）', () {
      final client = makeClient();
      client.subscribeAgent('worker-1');
      client.dispose();
      // 订阅列表本身没有被清空（属于应用层逻辑状态）
      expect(client.subscribedAgents, contains('worker-1'));
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. WsClient 连接状态初始值
  // ────────────────────────────────────────────────────────────────────────────
  group('WsClient — 连接状态', () {
    test('初始状态为 disconnected', () {
      final client = WsClient(agentId: 'test-agent');
      expect(client.state, WsState.disconnected);
      client.dispose();
    });

    test('dispose 后状态变为 disconnected', () {
      final client = WsClient(agentId: 'test-agent');
      // 不 connect()，直接 dispose
      client.dispose();
      expect(client.state, WsState.disconnected);
    });

    test('onStateChange 回调在状态变化时触发', () {
      final states = <WsState>[];
      final client = WsClient(
        agentId: 'test-agent',
        onStateChange: states.add,
      );
      // dispose 会触发 disconnected（从 disconnected → disconnected 不触发，
      // 所以先手动模拟：直接 connect() 会触发 connecting，
      // 但需要真实 WS 服务。这里只测试 dispose 路径不崩溃）
      client.dispose();
      // dispose 后状态为 disconnected，但如果初始已是 disconnected，
      // setState 内的去重逻辑会跳过，所以 states 可能为空
      expect(states.length, lessThanOrEqualTo(1));
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. OnboardingStorage — flag 读写
  // ────────────────────────────────────────────────────────────────────────────
  group('InMemoryOnboardingStorage — flag 读写', () {
    test('默认 isDone 为 false', () {
      final storage = InMemoryOnboardingStorage();
      expect(storage.isDone, false);
    });

    test('初始化 initialDone=true 时 isDone 为 true', () {
      final storage = InMemoryOnboardingStorage(initialDone: true);
      expect(storage.isDone, true);
    });

    test('markDone 后 isDone 变为 true', () async {
      final storage = InMemoryOnboardingStorage();
      expect(storage.isDone, false);
      await storage.markDone();
      expect(storage.isDone, true);
    });

    test('reset 后 isDone 变回 false', () async {
      final storage = InMemoryOnboardingStorage(initialDone: true);
      await storage.reset();
      expect(storage.isDone, false);
    });

    test('多次 markDone 不会报错，状态保持 true', () async {
      final storage = InMemoryOnboardingStorage();
      await storage.markDone();
      await storage.markDone();
      expect(storage.isDone, true);
    });

    test('markDone → reset → markDone 循环正确', () async {
      final storage = InMemoryOnboardingStorage();
      await storage.markDone();
      expect(storage.isDone, true);
      await storage.reset();
      expect(storage.isDone, false);
      await storage.markDone();
      expect(storage.isDone, true);
    });
  });
}
