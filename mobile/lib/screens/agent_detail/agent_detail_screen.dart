import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/agent_detail_provider.dart';
import '../../core/websocket/ws_client.dart';
import '../../models/api_response.dart';
import '../file_browser/file_browser_screen.dart';
import '../diff_viewer/diff_viewer_screen.dart';

/// Agent 详情页
/// MC5：底部快速回复输入栏，调用 POST /api/v2/agents/:id/input
/// MC6：对话历史查看，ListView 展示历史消息，顶部"加载更多"按钮
class AgentDetailScreen extends StatelessWidget {
  final String agentId;

  const AgentDetailScreen({super.key, required this.agentId});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AgentDetailProvider(agentId)..init(),
      child: const _AgentDetailView(),
    );
  }
}

class _AgentDetailView extends StatefulWidget {
  const _AgentDetailView();

  @override
  State<_AgentDetailView> createState() => _AgentDetailViewState();
}

class _AgentDetailViewState extends State<_AgentDetailView> {
  final _textController = TextEditingController();
  final _focusNode = FocusNode();
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    // 进入页面时自动加载历史记录
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        context.read<AgentDetailProvider>().loadHistory();
      }
    });
  }

  @override
  void dispose() {
    _textController.dispose();
    _focusNode.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _handleSend(AgentDetailProvider provider) async {
    final text = _textController.text.trim();
    if (text.isEmpty) return;

    _textController.clear();
    _focusNode.unfocus();

    await provider.sendText(text);

    if (!mounted) return;

    if (provider.sendError != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('发送失败：${provider.sendError}'),
          backgroundColor: Colors.red.shade700,
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('已发送'),
          duration: Duration(seconds: 1),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AgentDetailProvider>(
      builder: (context, provider, _) {
        final agent = provider.agent;
        return Scaffold(
          appBar: AppBar(
            title: Text(agent?.name ?? provider.agentId),
            actions: [
              // MC7：浏览 Agent 工作目录
              if (agent?.cwd != null)
                IconButton(
                  icon: const Icon(Icons.folder_open),
                  tooltip: '浏览文件',
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) =>
                            FileBrowserScreen(initialPath: agent!.cwd!),
                      ),
                    );
                  },
                ),
              // MC8：查看代码变更（git diff）
              IconButton(
                icon: const Icon(Icons.difference),
                tooltip: '查看变更',
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => DiffViewerScreen(
                        agentId: provider.agentId,
                        agentName: agent?.name ?? provider.agentId,
                      ),
                    ),
                  );
                },
              ),
              _WsStateChip(state: provider.wsState),
              const SizedBox(width: 8),
            ],
          ),
          body: provider.error != null
              ? Center(child: Text(provider.error!))
              : Column(
                  children: [
                    // 等待输入状态条
                    if (provider.waitingForInput)
                      Container(
                        width: double.infinity,
                        color: Colors.amber.shade100,
                        padding: const EdgeInsets.symmetric(
                            vertical: 4, horizontal: 12),
                        child: const Text(
                          '⏳ Agent 正在等待你的输入',
                          style: TextStyle(fontSize: 13),
                        ),
                      ),

                    // 历史消息列表（MC6）
                    Expanded(
                      child: _HistoryListView(
                        history: provider.history,
                        isLoading: provider.isLoadingHistory,
                        scrollController: _scrollController,
                        onLoadMore: () => provider.loadMore(),
                      ),
                    ),

                    // 底部快速回复输入栏
                    _QuickReplyBar(
                      controller: _textController,
                      focusNode: _focusNode,
                      isSending: provider.isSending,
                      onSend: () => _handleSend(provider),
                    ),
                  ],
                ),
        );
      },
    );
  }
}

/// 底部快速回复输入栏
class _QuickReplyBar extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focusNode;
  final bool isSending;
  final VoidCallback onSend;

  const _QuickReplyBar({
    required this.controller,
    required this.focusNode,
    required this.isSending,
    required this.onSend,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          border: Border(
            top: BorderSide(
              color: Theme.of(context).dividerColor,
              width: 0.5,
            ),
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                focusNode: focusNode,
                enabled: !isSending,
                decoration: const InputDecoration(
                  hintText: '向 Agent 发送指令…',
                  border: OutlineInputBorder(),
                  contentPadding:
                      EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  isDense: true,
                ),
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => isSending ? null : onSend(),
                maxLines: 1,
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 44,
              height: 44,
              child: isSending
                  ? const Center(
                      child: SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : IconButton(
                      icon: const Icon(Icons.send),
                      onPressed: onSend,
                      tooltip: '发送',
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 历史消息列表（MC6）
/// 顶部有"加载更多"按钮，消息按时间顺序排列，每条显示时间戳和内容
class _HistoryListView extends StatelessWidget {
  final List<OutputChunk> history;
  final bool isLoading;
  final ScrollController scrollController;
  final VoidCallback onLoadMore;

  const _HistoryListView({
    required this.history,
    required this.isLoading,
    required this.scrollController,
    required this.onLoadMore,
  });

  String _formatTs(int ts) {
    final dt = DateTime.fromMillisecondsSinceEpoch(ts);
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    final s = dt.second.toString().padLeft(2, '0');
    return '${dt.month}/${dt.day} $h:$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    if (isLoading && history.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (history.isEmpty) {
      return const Center(
        child: Text(
          '暂无历史记录',
          style: TextStyle(color: Colors.grey, fontSize: 14),
        ),
      );
    }

    return ListView.builder(
      controller: scrollController,
      padding: const EdgeInsets.only(bottom: 8),
      itemCount: history.length + 1, // +1 for the "load more" header
      itemBuilder: (context, index) {
        // 索引 0 = 顶部"加载更多"按钮
        if (index == 0) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
            child: isLoading
                ? const Center(
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : TextButton.icon(
                    onPressed: onLoadMore,
                    icon: const Icon(Icons.expand_less, size: 16),
                    label: const Text('加载更早记录', style: TextStyle(fontSize: 13)),
                    style: TextButton.styleFrom(
                      minimumSize: Size.zero,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 4),
                    ),
                  ),
          );
        }

        // 历史消息条目（索引从 1 开始）
        final chunk = history[index - 1];
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 时间戳
              Text(
                _formatTs(chunk.ts),
                style: TextStyle(
                  fontSize: 10,
                  color: Colors.grey.shade500,
                  fontFamily: 'monospace',
                ),
              ),
              const SizedBox(width: 8),
              // 消息内容
              Expanded(
                child: Text(
                  chunk.data,
                  style: const TextStyle(
                    fontSize: 12,
                    fontFamily: 'monospace',
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _WsStateChip extends StatelessWidget {
  final WsState state;

  const _WsStateChip({required this.state});

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (state) {
      WsState.connected => ('WS ●', Colors.green),
      WsState.connecting => ('WS …', Colors.orange),
      WsState.reconnecting => ('WS ↺', Colors.orange),
      WsState.disconnected => ('WS ○', Colors.grey),
    };
    return Chip(
      label: Text(label, style: TextStyle(color: color, fontSize: 11)),
      padding: EdgeInsets.zero,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
  }
}
