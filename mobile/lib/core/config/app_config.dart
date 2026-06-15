import 'package:shared_preferences/shared_preferences.dart';

/// 应用配置管理
/// 服务器地址支持运行时修改，持久化到 SharedPreferences
class AppConfig {
  static const String _keyServerUrl = 'server_url';
  static const String defaultServerUrl = 'http://localhost:4282';

  static AppConfig? _instance;
  static AppConfig get instance => _instance!;

  final SharedPreferences _prefs;

  AppConfig._(this._prefs);

  static Future<AppConfig> init() async {
    final prefs = await SharedPreferences.getInstance();
    _instance = AppConfig._(prefs);
    return _instance!;
  }

  /// 当前服务器 HTTP 基础地址，例如 http://192.168.1.100:4282
  String get serverUrl {
    return _prefs.getString(_keyServerUrl) ?? defaultServerUrl;
  }

  Future<void> setServerUrl(String url) async {
    await _prefs.setString(_keyServerUrl, url.trimRight().replaceAll(RegExp(r'/$'), ''));
  }

  /// 将 http(s):// 转换为 ws(s):// 用于 WebSocket 连接
  String get wsBaseUrl {
    return serverUrl
        .replaceFirst(RegExp(r'^http://'), 'ws://')
        .replaceFirst(RegExp(r'^https://'), 'wss://');
  }
}
