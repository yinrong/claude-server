// 纯 Dart 逻辑测试，不依赖 Flutter Widget
// 测试 FileBrowserProvider 核心逻辑：
//   T1. browse(path) 后 entries 被正确填充，currentPath 更新
//   T2. viewFile(path) 后 fileContent 被填充
//   T3. 浏览子目录后 currentPath 正确更新
//
// 运行方式：flutter test test/file_browser_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:claude_mobile/providers/file_browser_provider.dart';
import 'package:claude_mobile/core/api/api_client.dart';

void main() {
  // ── T1: browse(path) 填充 entries，currentPath 更新 ──────────────────────────
  // 模拟路径：ApiClient.browseDir → FileBrowserProvider.browse → entries/currentPath

  group('T1: browse(path) 填充 entries，currentPath 更新', () {
    test('browse 后 entries 被正确填充，currentPath 设为传入路径', () async {
      final provider = FileBrowserProvider.withBrowseFn(
        browseFn: (path) async => [
          const DirEntry(name: 'src', path: '/workspace/src', isDir: true),
          const DirEntry(name: 'README.md', path: '/workspace/README.md', isDir: false),
        ],
        downloadFn: (_) async => '',
      );

      await provider.browse('/workspace');

      expect(provider.currentPath, '/workspace');
      expect(provider.entries.length, 2);
      expect(provider.entries[0].name, 'src');
      expect(provider.entries[0].isDir, true);
      expect(provider.entries[1].name, 'README.md');
      expect(provider.entries[1].isDir, false);
    });

    test('browse 初始状态 entries 为空，currentPath 为 null', () {
      final provider = FileBrowserProvider.withBrowseFn(
        browseFn: (path) async => [],
        downloadFn: (_) async => '',
      );

      expect(provider.currentPath, isNull);
      expect(provider.entries, isEmpty);
    });

    test('browse 空目录时 entries 为空，currentPath 正确更新', () async {
      final provider = FileBrowserProvider.withBrowseFn(
        browseFn: (path) async => [],
        downloadFn: (_) async => '',
      );

      await provider.browse('/empty-dir');

      expect(provider.currentPath, '/empty-dir');
      expect(provider.entries, isEmpty);
    });
  });

  // ── T2: viewFile(path) 后 fileContent 被填充 ─────────────────────────────────
  // 模拟路径：ApiClient.downloadFile → FileBrowserProvider.viewFile → fileContent

  group('T2: viewFile(path) 后 fileContent 被填充', () {
    test('viewFile 后 fileContent 被填充', () async {
      const expectedContent = 'hello world\nline 2\n';

      final provider = FileBrowserProvider.withBrowseFn(
        browseFn: (path) async => [],
        downloadFn: (path) async => expectedContent,
      );

      await provider.viewFile('/workspace/hello.txt');

      expect(provider.fileContent, expectedContent);
    });

    test('fileContent 初始为 null', () {
      final provider = FileBrowserProvider.withBrowseFn(
        browseFn: (path) async => [],
        downloadFn: (_) async => '',
      );

      expect(provider.fileContent, isNull);
    });

    test('viewFile 接收正确的 path 参数', () async {
      String? receivedPath;

      final provider = FileBrowserProvider.withBrowseFn(
        browseFn: (path) async => [],
        downloadFn: (path) async {
          receivedPath = path;
          return 'content';
        },
      );

      await provider.viewFile('/workspace/src/main.dart');

      expect(receivedPath, '/workspace/src/main.dart');
    });
  });

  // ── T3: 浏览子目录后 currentPath 正确更新 ─────────────────────────────────────

  group('T3: 浏览子目录后 currentPath 正确更新', () {
    test('从父目录浏览到子目录时 currentPath 更新', () async {
      final provider = FileBrowserProvider.withBrowseFn(
        browseFn: (path) async {
          if (path == '/workspace') {
            return [
              const DirEntry(name: 'src', path: '/workspace/src', isDir: true),
            ];
          } else if (path == '/workspace/src') {
            return [
              const DirEntry(name: 'main.dart', path: '/workspace/src/main.dart', isDir: false),
            ];
          }
          return [];
        },
        downloadFn: (_) async => '',
      );

      await provider.browse('/workspace');
      expect(provider.currentPath, '/workspace');
      expect(provider.entries.length, 1);

      await provider.browse('/workspace/src');
      expect(provider.currentPath, '/workspace/src');
      expect(provider.entries.length, 1);
      expect(provider.entries[0].name, 'main.dart');
    });

    test('browse 调用时会传递正确的 path 参数', () async {
      final browsedPaths = <String>[];

      final provider = FileBrowserProvider.withBrowseFn(
        browseFn: (path) async {
          browsedPaths.add(path);
          return [];
        },
        downloadFn: (_) async => '',
      );

      await provider.browse('/workspace/src/lib');

      expect(browsedPaths, ['/workspace/src/lib']);
      expect(provider.currentPath, '/workspace/src/lib');
    });
  });
}
