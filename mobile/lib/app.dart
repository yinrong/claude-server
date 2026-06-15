import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/agents_provider.dart';
import 'screens/home/home_screen.dart';
import 'screens/onboarding/battery_guide_screen.dart';
import 'services/onboarding_service.dart';

/// App 根组件
/// 注入全局 Provider，配置路由和主题
class ClaudeApp extends StatelessWidget {
  /// 引导存储（允许测试注入 InMemoryOnboardingStorage）
  final OnboardingStorage? onboardingStorage;

  const ClaudeApp({super.key, this.onboardingStorage});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AgentsProvider()),
      ],
      child: MaterialApp(
        title: 'Claude Mobile',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF7C3AED), // 紫色主题，与 Web 端 Catppuccin 呼应
          ),
          useMaterial3: true,
        ),
        home: _StartupRouter(onboardingStorage: onboardingStorage),
      ),
    );
  }
}

/// 启动路由器：根据 onboarding 状态决定首屏
///
/// - 首次启动（onboarding_done = false）→ BatteryGuideScreen
/// - 已完成引导 → HomeScreen
class _StartupRouter extends StatefulWidget {
  final OnboardingStorage? onboardingStorage;

  const _StartupRouter({this.onboardingStorage});

  @override
  State<_StartupRouter> createState() => _StartupRouterState();
}

class _StartupRouterState extends State<_StartupRouter> {
  OnboardingStorage? _storage;
  bool _loading = true;
  bool _showOnboarding = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    // 允许测试注入，生产环境用真实 SharedPreferences
    final storage =
        widget.onboardingStorage ?? await OnboardingService.create();
    if (!mounted) return;
    setState(() {
      _storage = storage;
      _showOnboarding = !storage.isDone;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (_showOnboarding && _storage != null) {
      return BatteryGuideScreen(storage: _storage!);
    }

    return const HomeScreen();
  }
}
