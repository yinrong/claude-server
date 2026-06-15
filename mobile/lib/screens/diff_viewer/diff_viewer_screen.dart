import 'package:flutter/material.dart';
import '../../core/api/api_client.dart';
import 'diff_line.dart';

/// Diff 查看页（MC8）
/// 展示指定 agent 工作目录的 git diff HEAD 内容
class DiffViewerScreen extends StatefulWidget {
  final String agentId;
  final String agentName;

  const DiffViewerScreen({
    super.key,
    required this.agentId,
    required this.agentName,
  });

  @override
  State<DiffViewerScreen> createState() => _DiffViewerScreenState();
}

class _DiffViewerScreenState extends State<DiffViewerScreen> {
  bool _loading = false;
  String? _error;
  List<DiffLine> _lines = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final diff = await ApiClient.instance.getDiff(widget.agentId);
      setState(() {
        _lines = parseDiff(diff);
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.agentName} — 变更'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: '刷新',
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text('加载失败：$_error', style: const TextStyle(color: Colors.red)),
        ),
      );
    }
    if (_lines.isEmpty) {
      return const Center(child: Text('暂无变更'));
    }
    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: _lines.length,
      itemBuilder: (context, i) => _DiffLineWidget(line: _lines[i]),
    );
  }
}

class _DiffLineWidget extends StatelessWidget {
  final DiffLine line;

  const _DiffLineWidget({required this.line});

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (line.type) {
      DiffLineType.added => (
          Colors.green.shade900.withValues(alpha: 0.35),
          Colors.green.shade300
        ),
      DiffLineType.removed => (
          Colors.red.shade900.withValues(alpha: 0.35),
          Colors.red.shade300
        ),
      DiffLineType.hunk => (
          Colors.blue.shade900.withValues(alpha: 0.25),
          Colors.blue.shade300
        ),
      DiffLineType.header => (
          Colors.transparent,
          Colors.grey.shade400
        ),
      DiffLineType.context => (Colors.transparent, Colors.grey.shade200),
    };

    return Container(
      color: bg,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
      child: Text(
        line.content,
        style: TextStyle(
          fontFamily: 'monospace',
          fontSize: 12,
          color: fg,
          height: 1.4,
        ),
      ),
    );
  }
}
