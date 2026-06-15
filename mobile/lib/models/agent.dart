/// Agent 数据模型，对应服务端 agents 表
class Agent {
  final String id;
  final String name;
  final String type; // 'master' | 'worker'
  final String adapterType; // 'claude-code' | 'stream' | 'mock'
  final String status; // 'running' | 'stopped' | 'error'
  final bool waitingForInput;
  final DateTime createdAt;
  /// Agent 的工作目录（来自 config.cwd），可能为 null
  final String? cwd;

  const Agent({
    required this.id,
    required this.name,
    required this.type,
    required this.adapterType,
    required this.status,
    required this.waitingForInput,
    required this.createdAt,
    this.cwd,
  });

  factory Agent.fromJson(Map<String, dynamic> json) {
    final config = json['config'] as Map<String, dynamic>?;
    return Agent(
      id: json['id'] as String,
      name: json['name'] as String? ?? json['id'] as String,
      type: json['type'] as String? ?? 'worker',
      adapterType: json['adapter_type'] as String? ?? 'unknown',
      status: json['status'] as String? ?? 'unknown',
      waitingForInput: json['waitingForInput'] as bool? ?? false,
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'] as String) ?? DateTime.now()
          : DateTime.now(),
      cwd: config?['cwd'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'type': type,
        'adapter_type': adapterType,
        'status': status,
        'waitingForInput': waitingForInput,
        'created_at': createdAt.toIso8601String(),
        if (cwd != null) 'config': {'cwd': cwd},
      };

  Agent copyWith({
    String? status,
    bool? waitingForInput,
    String? cwd,
  }) {
    return Agent(
      id: id,
      name: name,
      type: type,
      adapterType: adapterType,
      status: status ?? this.status,
      waitingForInput: waitingForInput ?? this.waitingForInput,
      createdAt: createdAt,
      cwd: cwd ?? this.cwd,
    );
  }
}
