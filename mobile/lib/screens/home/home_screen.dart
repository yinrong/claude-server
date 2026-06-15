import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/agents_provider.dart';
import '../../models/agent.dart';
import '../agent_detail/agent_detail_screen.dart';
import '../../core/websocket/ws_client.dart';

/// 首页：Agent 列表
/// MC2 阶段为占位实现，MC3 完善完整 UI
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    // 首次加载时拉取 Agent 列表
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AgentsProvider>().refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Claude Agents'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: '刷新',
            onPressed: () => context.read<AgentsProvider>().refresh(),
          ),
        ],
      ),
      body: Consumer<AgentsProvider>(
        builder: (context, provider, _) {
          return Column(
            children: [
              // WS 连接状态条（connected 时隐藏，节省空间）
              _WsStatusBar(state: provider.wsState),

              // 列表主体
              Expanded(
                child: _buildBody(context, provider),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildBody(BuildContext context, AgentsProvider provider) {
    if (provider.loading && provider.agents.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (provider.error != null && provider.agents.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 48, color: Colors.red),
            const SizedBox(height: 8),
            Text(provider.error!, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => provider.refresh(),
              child: const Text('重试'),
            ),
          ],
        ),
      );
    }

    if (!provider.hasAgents) {
      return const Center(
        child: Text('暂无 Agent，请先在服务端创建。'),
      );
    }

    return RefreshIndicator(
      onRefresh: provider.refresh,
      child: ListView.builder(
        itemCount: provider.agents.length,
        itemBuilder: (context, index) {
          return _AgentTile(agent: provider.agents[index]);
        },
      ),
    );
  }
}

class _AgentTile extends StatelessWidget {
  final Agent agent;

  const _AgentTile({required this.agent});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: _statusIndicator(agent),
      title: Row(
        children: [
          Flexible(
            child: Text(
              agent.name,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 6),
          _TypeBadge(type: agent.type),
        ],
      ),
      subtitle: Text(
        agent.adapterType,
        style: Theme.of(context)
            .textTheme
            .bodySmall
            ?.copyWith(color: Colors.grey),
      ),
      trailing: agent.waitingForInput
          ? const Tooltip(
              message: '等待输入',
              child: Text('⏳', style: TextStyle(fontSize: 18)),
            )
          : null,
      onTap: () {
        Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => AgentDetailScreen(agentId: agent.id),
        ));
      },
    );
  }

  /// 状态指示圆点：● 绿（running）/ ○ 灰（stopped）/ ● 红（error）
  Widget _statusIndicator(Agent agent) {
    final (color, filled) = switch (agent.status) {
      'running' => (Colors.green, true),
      'stopped' => (Colors.grey, false),
      'error' => (Colors.red, true),
      _ => (Colors.orange, true),
    };
    return SizedBox(
      width: 20,
      height: 20,
      child: CircleAvatar(
        radius: 8,
        backgroundColor: filled ? color : Colors.transparent,
        child: filled
            ? null
            : CircleAvatar(
                radius: 7,
                backgroundColor: Colors.white,
                child: CircleAvatar(
                  radius: 6,
                  backgroundColor: color,
                ),
              ),
      ),
    );
  }
}

/// WS 连接状态条（显示在 Agent 列表顶部）
///
/// - connected：不显示（SizedBox.shrink）
/// - connecting / reconnecting：橙色 + 转圈
/// - disconnected：红色圆点
class _WsStatusBar extends StatelessWidget {
  final WsState state;

  const _WsStatusBar({required this.state});

  @override
  Widget build(BuildContext context) {
    if (state == WsState.connected) return const SizedBox.shrink();

    final (color, label, showSpinner) = switch (state) {
      WsState.connected => (Colors.green, '已连接', false),
      WsState.connecting => (Colors.orange, '连接中...', true),
      WsState.reconnecting => (Colors.orange, '重连中...', true),
      WsState.disconnected => (Colors.red, '已断线', false),
    };

    return Material(
      color: color.withOpacity(0.12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Row(
          children: [
            if (showSpinner)
              SizedBox(
                width: 12,
                height: 12,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: color,
                ),
              )
            else
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: color,
                  shape: BoxShape.circle,
                ),
              ),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                color: color.withOpacity(0.9),
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// master/worker 类型标签
class _TypeBadge extends StatelessWidget {
  final String type;

  const _TypeBadge({required this.type});

  @override
  Widget build(BuildContext context) {
    final isMaster = type == 'master';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: isMaster
            ? Colors.deepPurple.withOpacity(0.15)
            : Colors.blue.withOpacity(0.12),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: isMaster
              ? Colors.deepPurple.withOpacity(0.4)
              : Colors.blue.withOpacity(0.3),
          width: 0.8,
        ),
      ),
      child: Text(
        isMaster ? 'master' : 'worker',
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w500,
          color: isMaster ? Colors.deepPurple : Colors.blue.shade700,
        ),
      ),
    );
  }
}
