import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/file_browser_provider.dart';
import '../../core/api/api_client.dart';

/// 文件浏览页（MC7）
/// 支持：
///  - 显示当前路径 + 目录条目列表
///  - 点击目录进入子目录
///  - 点击文件显示文件内容（等宽字体代码预览）
///  - 顶部返回按钮（返回上级目录）
class FileBrowserScreen extends StatelessWidget {
  final String initialPath;

  const FileBrowserScreen({super.key, required this.initialPath});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => FileBrowserProvider()..browse(initialPath),
      child: const _FileBrowserView(),
    );
  }
}

class _FileBrowserView extends StatelessWidget {
  const _FileBrowserView();

  @override
  Widget build(BuildContext context) {
    return Consumer<FileBrowserProvider>(
      builder: (context, provider, _) {
        final currentPath = provider.currentPath ?? '';
        final parentPath = _parentOf(currentPath);

        return Scaffold(
          appBar: AppBar(
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('文件浏览', style: TextStyle(fontSize: 16)),
                if (currentPath.isNotEmpty)
                  Text(
                    currentPath,
                    style: const TextStyle(
                      fontSize: 11,
                      fontFamily: 'monospace',
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
            leading: parentPath != null
                ? IconButton(
                    icon: const Icon(Icons.arrow_back),
                    tooltip: '返回上级目录',
                    onPressed: () => provider.browse(parentPath),
                  )
                : null,
          ),
          body: _buildBody(context, provider),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, FileBrowserProvider provider) {
    if (provider.loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (provider.error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            '加载失败：${provider.error}',
            style: const TextStyle(color: Colors.red),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    // 显示文件内容（代码预览模式）
    if (provider.fileContent != null) {
      return _FileContentView(content: provider.fileContent!);
    }

    // 显示目录列表
    final entries = provider.entries;
    if (entries.isEmpty) {
      return const Center(child: Text('（空目录）'));
    }

    return ListView.builder(
      itemCount: entries.length,
      itemBuilder: (context, index) {
        final entry = entries[index];
        return _EntryTile(
          entry: entry,
          onTap: () => _handleTap(context, provider, entry),
        );
      },
    );
  }

  void _handleTap(
    BuildContext context,
    FileBrowserProvider provider,
    DirEntry entry,
  ) {
    if (entry.isDir) {
      provider.browse(entry.path);
    } else {
      provider.viewFile(entry.path);
    }
  }

  /// 返回父目录路径，根目录返回 null
  String? _parentOf(String path) {
    if (path.isEmpty) return null;
    final trimmed = path.endsWith('/') ? path.substring(0, path.length - 1) : path;
    final lastSlash = trimmed.lastIndexOf('/');
    if (lastSlash <= 0) return null; // '/' 本身或无斜杠，无父目录
    return trimmed.substring(0, lastSlash);
  }
}

/// 单个目录条目行
class _EntryTile extends StatelessWidget {
  final DirEntry entry;
  final VoidCallback onTap;

  const _EntryTile({required this.entry, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(
        entry.isDir ? Icons.folder : Icons.insert_drive_file,
        color: entry.isDir ? Colors.amber : Colors.blueGrey,
      ),
      title: Text(
        entry.name,
        style: const TextStyle(fontFamily: 'monospace', fontSize: 14),
      ),
      trailing: entry.isDir ? const Icon(Icons.chevron_right) : null,
      onTap: onTap,
    );
  }
}

/// 文件内容预览（等宽字体，可滚动）
class _FileContentView extends StatelessWidget {
  final String content;

  const _FileContentView({required this.content});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(12),
      child: SelectableText(
        content,
        style: const TextStyle(
          fontFamily: 'monospace',
          fontSize: 12,
          height: 1.5,
        ),
      ),
    );
  }
}
