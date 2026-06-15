/// 标准响应格式：{ ok, data, error, ts }
/// 对应服务端 /api/v2 的统一响应结构
class ApiResponse<T> {
  final bool ok;
  final T? data;
  final String? error;
  final int ts;

  const ApiResponse({
    required this.ok,
    this.data,
    this.error,
    required this.ts,
  });

  factory ApiResponse.fromJson(
    Map<String, dynamic> json,
    T Function(dynamic)? fromData,
  ) {
    return ApiResponse<T>(
      ok: json['ok'] as bool,
      data: json['data'] != null && fromData != null
          ? fromData(json['data'])
          : json['data'] as T?,
      error: json['error'] as String?,
      ts: json['ts'] as int? ?? 0,
    );
  }

  bool get isSuccess => ok && error == null;
}

/// 历史记录条目
class OutputChunk {
  final String agentId;
  final String data;
  final int ts;

  const OutputChunk({
    required this.agentId,
    required this.data,
    required this.ts,
  });

  factory OutputChunk.fromJson(Map<String, dynamic> json) {
    return OutputChunk(
      agentId: json['agent_id'] as String? ?? '',
      data: json['data'] as String? ?? '',
      ts: json['ts'] as int? ?? 0,
    );
  }
}

/// /api/v2/agents/:id/history 的 data 字段
class HistoryData {
  final List<OutputChunk> chunks;
  final int total;
  final int? sinceTs;

  const HistoryData({
    required this.chunks,
    required this.total,
    this.sinceTs,
  });

  factory HistoryData.fromJson(Map<String, dynamic> json) {
    final rawChunks = json['chunks'] as List<dynamic>? ?? [];
    return HistoryData(
      chunks: rawChunks
          .map((e) => OutputChunk.fromJson(e as Map<String, dynamic>))
          .toList(),
      total: json['total'] as int? ?? 0,
      sinceTs: json['since_ts'] as int?,
    );
  }
}
