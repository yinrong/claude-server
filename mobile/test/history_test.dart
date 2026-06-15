// 纯 Dart 逻辑测试，不依赖 Flutter Widget
// 测试 AgentDetailProvider 的历史记录功能（MC6）：
//   T1. loadHistory 调用后 history 列表被正确填充
//   T2. loadMore 传入正确的 sinceTs 参数（最早一条记录的 ts 作为上界）
//   T3. isLoadingHistory 在加载期间为 true，完成后为 false
//
// 运行方式：flutter test test/history_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:claude_mobile/providers/agent_detail_provider.dart';
import 'package:claude_mobile/models/api_response.dart';
import 'package:claude_mobile/core/api/api_client.dart';

// ── 辅助：fake GetHistory 函数 ─────────────────────────────────────────────

class _GetHistoryTracker {
  int callCount = 0;
  int? lastSinceTs;
  bool shouldThrow = false;
  String errorMessage = 'network error';

  // 用于控制返回的数据
  List<OutputChunk> chunksToReturn = [];

  Future<HistoryData> call(String agentId, {int? sinceTs, int limit = 500}) async {
    callCount++;
    lastSinceTs = sinceTs;
    if (shouldThrow) {
      throw ApiException(errorMessage);
    }
    return HistoryData(
      chunks: chunksToReturn,
      total: chunksToReturn.length,
      sinceTs: sinceTs,
    );
  }
}

// ── 辅助：构建 provider ──────────────────────────────────────────────────────

AgentDetailProvider _makeProvider({
  String agentId = 'worker-1',
  required _GetHistoryTracker historyTracker,
}) {
  return AgentDetailProvider.withGetHistory(
    agentId: agentId,
    sendInputFn: (_, __) async {},
    getHistoryFn: historyTracker.call,
  );
}

void main() {
  // ── T1: loadHistory 后 history 列表被正确填充 ──────────────────────────────

  group('T1: loadHistory 填充 history 列表', () {
    test('loadHistory 返回数据后 history 列表非空', () async {
      final tracker = _GetHistoryTracker()
        ..chunksToReturn = [
          OutputChunk(agentId: 'worker-1', data: 'hello', ts: 1000),
          OutputChunk(agentId: 'worker-1', data: 'world', ts: 2000),
        ];
      final provider = _makeProvider(historyTracker: tracker);

      await provider.loadHistory();

      expect(provider.history.length, 2);
      expect(provider.history[0].data, 'hello');
      expect(provider.history[1].data, 'world');
    });

    test('loadHistory 空数据时 history 为空列表', () async {
      final tracker = _GetHistoryTracker()..chunksToReturn = [];
      final provider = _makeProvider(historyTracker: tracker);

      await provider.loadHistory();

      expect(provider.history, isEmpty);
    });

    test('loadHistory 调用了 getHistoryFn', () async {
      final tracker = _GetHistoryTracker();
      final provider = _makeProvider(agentId: 'agent-42', historyTracker: tracker);

      await provider.loadHistory();

      expect(tracker.callCount, 1);
    });

    test('loadHistory 失败时 history 保持不变，不抛出异常', () async {
      final tracker = _GetHistoryTracker()..shouldThrow = true;
      final provider = _makeProvider(historyTracker: tracker);

      // 不应抛出异常
      await expectLater(provider.loadHistory(), completes);
      expect(provider.history, isEmpty);
    });
  });

  // ── T2: loadMore 传入正确的 sinceTs 参数 ──────────────────────────────────

  group('T2: loadMore 使用最早一条记录的 ts 作为上界', () {
    test('loadMore 传入最早一条记录的 ts', () async {
      // 先加载一批历史，最早的 ts=100
      final tracker = _GetHistoryTracker()
        ..chunksToReturn = [
          OutputChunk(agentId: 'worker-1', data: 'old msg', ts: 100),
          OutputChunk(agentId: 'worker-1', data: 'newer msg', ts: 500),
        ];
      final provider = _makeProvider(historyTracker: tracker);
      await provider.loadHistory();

      // 再次 loadMore，此时应该用最早记录 ts=100 作为 sinceTs 上界
      tracker.chunksToReturn = [
        OutputChunk(agentId: 'worker-1', data: 'even older', ts: 50),
      ];
      await provider.loadMore();

      // loadMore 调用时传入的 sinceTs 应为最早记录的 ts（100）
      expect(tracker.lastSinceTs, 100);
    });

    test('history 为空时 loadMore 不调用 getHistoryFn', () async {
      final tracker = _GetHistoryTracker();
      final provider = _makeProvider(historyTracker: tracker);

      // history 为空，loadMore 应该不做任何事
      await provider.loadMore();

      expect(tracker.callCount, 0);
    });

    test('loadMore 加载到的旧数据被追加到 history 前面', () async {
      final tracker = _GetHistoryTracker()
        ..chunksToReturn = [
          OutputChunk(agentId: 'worker-1', data: 'msg at 200', ts: 200),
          OutputChunk(agentId: 'worker-1', data: 'msg at 300', ts: 300),
        ];
      final provider = _makeProvider(historyTracker: tracker);
      await provider.loadHistory();

      // loadMore 返回更早的消息
      tracker.chunksToReturn = [
        OutputChunk(agentId: 'worker-1', data: 'msg at 50', ts: 50),
        OutputChunk(agentId: 'worker-1', data: 'msg at 100', ts: 100),
      ];
      await provider.loadMore();

      // 更早的消息应该在前面
      expect(provider.history.length, 4);
      expect(provider.history[0].ts, 50);
      expect(provider.history[1].ts, 100);
      expect(provider.history[2].ts, 200);
      expect(provider.history[3].ts, 300);
    });
  });

  // ── T3: isLoadingHistory 状态在加载期间为 true，完成后为 false ───────────────

  group('T3: isLoadingHistory 状态变化', () {
    test('初始状态 isLoadingHistory 为 false', () {
      final tracker = _GetHistoryTracker();
      final provider = _makeProvider(historyTracker: tracker);
      expect(provider.isLoadingHistory, false);
    });

    test('loadHistory 完成后 isLoadingHistory 为 false', () async {
      final tracker = _GetHistoryTracker();
      final provider = _makeProvider(historyTracker: tracker);

      await provider.loadHistory();

      expect(provider.isLoadingHistory, false);
    });

    test('loadHistory 期间 isLoadingHistory 为 true', () async {
      bool? loadingDuringCall;
      late AgentDetailProvider capturedProvider;

      final provider = AgentDetailProvider.withGetHistory(
        agentId: 'w1',
        sendInputFn: (_, __) async {},
        getHistoryFn: (agentId, {sinceTs, limit = 500}) async {
          // 此时 loadHistory 已设置 _isLoadingHistory = true
          loadingDuringCall = capturedProvider.isLoadingHistory;
          return HistoryData(chunks: [], total: 0);
        },
      );
      capturedProvider = provider;

      await provider.loadHistory();

      expect(loadingDuringCall, true,
          reason: '调用 getHistoryFn 时 isLoadingHistory 应为 true');
      expect(provider.isLoadingHistory, false,
          reason: '加载完成后 isLoadingHistory 应为 false');
    });

    test('loadHistory 失败后 isLoadingHistory 也恢复为 false', () async {
      final tracker = _GetHistoryTracker()..shouldThrow = true;
      final provider = _makeProvider(historyTracker: tracker);

      await provider.loadHistory();

      expect(provider.isLoadingHistory, false);
    });

    test('loadMore 完成后 isLoadingHistory 为 false', () async {
      final tracker = _GetHistoryTracker()
        ..chunksToReturn = [
          OutputChunk(agentId: 'worker-1', data: 'initial', ts: 1000),
        ];
      final provider = _makeProvider(historyTracker: tracker);
      await provider.loadHistory();

      tracker.chunksToReturn = [];
      await provider.loadMore();

      expect(provider.isLoadingHistory, false);
    });
  });
}
