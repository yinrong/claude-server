import 'package:shared_preferences/shared_preferences.dart';

/// 可注入的抽象接口（用于测试替换）
abstract class OnboardingStorage {
  bool get isDone;
  Future<void> markDone();
  Future<void> reset();
}

/// 首次启动引导服务（实现 OnboardingStorage）
/// 使用 SharedPreferences 持久化引导完成状态
class OnboardingService implements OnboardingStorage {
  static const String _keyOnboardingDone = 'onboarding_done';

  final SharedPreferences _prefs;

  OnboardingService(this._prefs);

  @override
  bool get isDone => _prefs.getBool(_keyOnboardingDone) ?? false;

  @override
  Future<void> markDone() async {
    await _prefs.setBool(_keyOnboardingDone, true);
  }

  @override
  Future<void> reset() async {
    await _prefs.remove(_keyOnboardingDone);
  }

  /// 工厂方法：异步创建（生产环境使用）
  static Future<OnboardingService> create() async {
    final prefs = await SharedPreferences.getInstance();
    return OnboardingService(prefs);
  }
}

/// 基于 Map 的内存实现（仅测试使用，不依赖 Flutter/SharedPreferences）
class InMemoryOnboardingStorage implements OnboardingStorage {
  bool _done;

  InMemoryOnboardingStorage({bool initialDone = false}) : _done = initialDone;

  @override
  bool get isDone => _done;

  @override
  Future<void> markDone() async {
    _done = true;
  }

  @override
  Future<void> reset() async {
    _done = false;
  }
}
