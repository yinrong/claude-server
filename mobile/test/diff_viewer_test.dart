// diff_viewer_test.dart
// 测试 diff 文本按行解析，分类 + 行 / - 行 / @@ 行 / 普通行
// 运行：flutter test test/diff_viewer_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:claude_mobile/screens/diff_viewer/diff_line.dart';

void main() {
  group('DiffLine 解析', () {
    test('+ 开头行被识别为 added', () {
      final line = DiffLine.parse('+    print("hello");');
      expect(line.type, DiffLineType.added);
      expect(line.content, '+    print("hello");');
    });

    test('- 开头行被识别为 removed', () {
      final line = DiffLine.parse('-    print("world");');
      expect(line.type, DiffLineType.removed);
      expect(line.content, '-    print("world");');
    });

    test('@@ 开头行被识别为 hunk', () {
      final line = DiffLine.parse('@@ -1,4 +1,5 @@');
      expect(line.type, DiffLineType.hunk);
      expect(line.content, '@@ -1,4 +1,5 @@');
    });

    test('普通行被识别为 context', () {
      final line = DiffLine.parse('    int x = 1;');
      expect(line.type, DiffLineType.context);
      expect(line.content, '    int x = 1;');
    });

    test('diff --git 开头行被识别为 header', () {
      final line = DiffLine.parse('diff --git a/file.dart b/file.dart');
      expect(line.type, DiffLineType.header);
    });

    test('--- 开头行被识别为 header', () {
      final line = DiffLine.parse('--- a/file.dart');
      expect(line.type, DiffLineType.header);
    });

    test('+++ 开头行被识别为 header', () {
      final line = DiffLine.parse('+++ b/file.dart');
      expect(line.type, DiffLineType.header);
    });

    test('空行被识别为 context', () {
      final line = DiffLine.parse('');
      expect(line.type, DiffLineType.context);
      expect(line.content, '');
    });
  });

  group('parseDiff — 整体文本解析', () {
    const sampleDiff = '''diff --git a/lib/foo.dart b/lib/foo.dart
index abc1234..def5678 100644
--- a/lib/foo.dart
+++ b/lib/foo.dart
@@ -1,4 +1,5 @@
 void main() {
-  print("old");
+  print("new");
+  print("extra");
 }''';

    test('解析出正确行数', () {
      final lines = parseDiff(sampleDiff);
      expect(lines.length, 10);
    });

    test('包含正确数量的 added / removed / hunk / header / context 行', () {
      final lines = parseDiff(sampleDiff);
      final added = lines.where((l) => l.type == DiffLineType.added).length;
      final removed = lines.where((l) => l.type == DiffLineType.removed).length;
      final hunk = lines.where((l) => l.type == DiffLineType.hunk).length;
      final header = lines.where((l) => l.type == DiffLineType.header).length;
      final context = lines.where((l) => l.type == DiffLineType.context).length;

      expect(added, 2);
      expect(removed, 1);
      expect(hunk, 1);
      expect(header, 4);   // diff --git / index ... / --- / +++
      expect(context, 2);  // " void main() {", " }"
    });

    test('空字符串返回空列表', () {
      final lines = parseDiff('');
      expect(lines, isEmpty);
    });
  });
}
