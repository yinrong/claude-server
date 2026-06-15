// diff_line.dart — diff 文本行解析模型
//
// 将 git diff 文本按行分类为：
//   added    (+)
//   removed  (-)
//   hunk     (@@)
//   header   (diff --git / --- / +++)
//   context  (普通上下文行或空行)

enum DiffLineType { added, removed, hunk, header, context }

class DiffLine {
  final DiffLineType type;
  final String content;

  const DiffLine({required this.type, required this.content});

  /// 从单行文本解析
  factory DiffLine.parse(String line) {
    if (line.startsWith('diff ') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ')) {
      return DiffLine(type: DiffLineType.header, content: line);
    }
    if (line.startsWith('@@')) {
      return DiffLine(type: DiffLineType.hunk, content: line);
    }
    if (line.startsWith('+')) {
      return DiffLine(type: DiffLineType.added, content: line);
    }
    if (line.startsWith('-')) {
      return DiffLine(type: DiffLineType.removed, content: line);
    }
    return DiffLine(type: DiffLineType.context, content: line);
  }
}

/// 将完整的 diff 文本解析为 DiffLine 列表
List<DiffLine> parseDiff(String diffText) {
  if (diffText.isEmpty) return [];
  return diffText.split('\n').map(DiffLine.parse).toList();
}
