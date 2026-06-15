import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../../models/agent.dart';
import '../../models/api_response.dart';

/// HTTP 客户端封装
/// 调用 /api/v2 接口，处理标准响应格式 {ok, data, error, ts}
class ApiClient {
  static ApiClient? _instance;
  static ApiClient get instance => _instance ??= ApiClient._();

  ApiClient._();

  /// 仅供测试时注入自定义配置
  @visibleForTesting
  static void resetForTest() => _instance = null;

  String get _base => AppConfig.instance.serverUrl;

  final _client = http.Client();

  // ── GET /api/v2/agents ────────────────────────────────────────────────────

  Future<List<Agent>> listAgents() async {
    final resp = await _get('/api/v2/agents');
    final parsed = ApiResponse<List<Agent>>.fromJson(
      resp,
      (data) => (data as List<dynamic>)
          .map((e) => Agent.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
    if (!parsed.isSuccess) throw ApiException(parsed.error ?? 'listAgents failed');
    return parsed.data ?? [];
  }

  // ── GET /api/v2/agents/:id ────────────────────────────────────────────────

  Future<Agent> getAgent(String agentId) async {
    final resp = await _get('/api/v2/agents/$agentId');
    final parsed = ApiResponse<Agent>.fromJson(
      resp,
      (data) => Agent.fromJson(data as Map<String, dynamic>),
    );
    if (!parsed.isSuccess) throw ApiException(parsed.error ?? 'getAgent failed');
    return parsed.data!;
  }

  // ── GET /api/v2/agents/:id/history ───────────────────────────────────────

  Future<HistoryData> getHistory(
    String agentId, {
    int? sinceTs,
    int limit = 500,
  }) async {
    final query = {
      if (sinceTs != null) 'since_ts': sinceTs.toString(),
      'limit': limit.toString(),
    };
    final resp = await _get('/api/v2/agents/$agentId/history', query: query);
    final parsed = ApiResponse<HistoryData>.fromJson(
      resp,
      (data) => HistoryData.fromJson(data as Map<String, dynamic>),
    );
    if (!parsed.isSuccess) throw ApiException(parsed.error ?? 'getHistory failed');
    return parsed.data!;
  }

  // ── GET /api/browse?path= ─────────────────────────────────────────────────

  /// 浏览指定目录，返回目录条目列表
  /// 服务端返回格式：{ ok: true, data: [{ name, path, isDir }] }
  Future<List<DirEntry>> browseDir(String path) async {
    final resp = await _get('/api/browse', query: {'path': path});
    final parsed = ApiResponse<List<DirEntry>>.fromJson(
      resp,
      (data) => (data as List<dynamic>)
          .map((e) => DirEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
    if (!parsed.isSuccess) throw ApiException(parsed.error ?? 'browseDir failed');
    return parsed.data ?? [];
  }

  // ── GET /api/download?path= ───────────────────────────────────────────────

  /// 下载文件内容，返回字符串
  Future<String> downloadFile(String path) async {
    final uri = Uri.parse('$_base/api/download').replace(
      queryParameters: {'path': path},
    );
    final response = await _client.get(
      uri,
      headers: {'Accept': 'text/plain, application/octet-stream, */*'},
    );
    if (response.statusCode >= 400) {
      throw ApiException('downloadFile failed: HTTP ${response.statusCode}');
    }
    return utf8.decode(response.bodyBytes);
  }

  // ── GET /api/v2/agents/:id/diff ──────────────────────────────────────────

  Future<String> getDiff(String agentId) async {
    final resp = await _get('/api/v2/agents/$agentId/diff');
    final parsed = ApiResponse<Map<String, dynamic>>.fromJson(
      resp,
      (data) => data as Map<String, dynamic>,
    );
    if (!parsed.isSuccess) throw ApiException(parsed.error ?? 'getDiff failed');
    return (parsed.data?['diff'] as String?) ?? '';
  }

  // ── POST /api/v2/agents/:id/input ─────────────────────────────────────────

  Future<void> sendInput(String agentId, String text) async {
    final resp = await _post(
      '/api/v2/agents/$agentId/input',
      body: {'text': text},
    );
    final parsed = ApiResponse<dynamic>.fromJson(resp, null);
    if (!parsed.isSuccess) throw ApiException(parsed.error ?? 'sendInput failed');
  }

  // ── 内部工具方法 ───────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> _get(
    String path, {
    Map<String, String>? query,
  }) async {
    final uri = Uri.parse('$_base$path').replace(queryParameters: query);
    final response = await _client.get(
      uri,
      headers: {'Accept': 'application/json'},
    );
    return _decode(response);
  }

  Future<Map<String, dynamic>> _post(
    String path, {
    required Map<String, dynamic> body,
  }) async {
    final uri = Uri.parse('$_base$path');
    final response = await _client.post(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: jsonEncode(body),
    );
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    final decoded = jsonDecode(utf8.decode(response.bodyBytes));
    if (decoded is Map<String, dynamic>) return decoded;
    throw ApiException('Unexpected response format: ${response.body}');
  }
}

class ApiException implements Exception {
  final String message;
  const ApiException(this.message);

  @override
  String toString() => 'ApiException: $message';
}

/// 目录条目，对应服务端 /api/browse 返回的条目
class DirEntry {
  final String name;
  final String path;
  final bool isDir;

  const DirEntry({
    required this.name,
    required this.path,
    required this.isDir,
  });

  factory DirEntry.fromJson(Map<String, dynamic> json) {
    return DirEntry(
      name: json['name'] as String? ?? '',
      path: json['path'] as String? ?? '',
      isDir: json['isDir'] as bool? ?? false,
    );
  }
}
