import 'package:flutter/foundation.dart';
import '../core/api/api_client.dart';

/// browse 函数签名：接受 path，返回 DirEntry 列表
typedef BrowseFn = Future<List<DirEntry>> Function(String path);

/// download 函数签名：接受 path，返回文件内容字符串
typedef DownloadFn = Future<String> Function(String path);

/// 文件浏览页状态管理
/// 职责：
/// 1. 记录当前目录路径（currentPath）
/// 2. 列出目录条目（entries）
/// 3. 加载文件内容（fileContent）
class FileBrowserProvider extends ChangeNotifier {
  final BrowseFn _browseFn;
  final DownloadFn _downloadFn;

  String? _currentPath;
  List<DirEntry> _entries = [];
  String? _fileContent;
  bool _loading = false;
  String? _error;

  FileBrowserProvider()
      : _browseFn = ApiClient.instance.browseDir,
        _downloadFn = ApiClient.instance.downloadFile;

  /// 测试注入构造函数，允许传入 fake browse/download 函数
  @visibleForTesting
  FileBrowserProvider.withBrowseFn({
    required BrowseFn browseFn,
    required DownloadFn downloadFn,
  })  : _browseFn = browseFn,
        _downloadFn = downloadFn;

  String? get currentPath => _currentPath;
  List<DirEntry> get entries => List.unmodifiable(_entries);
  String? get fileContent => _fileContent;
  bool get loading => _loading;
  String? get error => _error;

  /// 浏览指定目录
  Future<void> browse(String path) async {
    _loading = true;
    _error = null;
    _fileContent = null; // 切换目录时清除文件内容
    notifyListeners();

    try {
      _entries = await _browseFn(path);
      _currentPath = path;
      _error = null;
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = e.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  /// 加载文件内容
  Future<void> viewFile(String path) async {
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      _fileContent = await _downloadFn(path);
      _error = null;
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = e.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }
}
