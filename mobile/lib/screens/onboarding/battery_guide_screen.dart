import 'dart:io';
import 'package:flutter/material.dart';
import '../../services/onboarding_service.dart';
import '../home/home_screen.dart';

/// 首次启动省电引导页
///
/// - Android：引导用户关闭电池优化（保持 WS 长连接稳定）
/// - iOS：引导用户开启后台 App 刷新
/// - "我知道了" 记录 onboarding_done flag，跳转首页
class BatteryGuideScreen extends StatelessWidget {
  final OnboardingStorage storage;

  const BatteryGuideScreen({super.key, required this.storage});

  @override
  Widget build(BuildContext context) {
    final isAndroid = Platform.isAndroid;
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 顶部图标
              Center(
                child: Icon(
                  Icons.battery_saver_outlined,
                  size: 72,
                  color: theme.colorScheme.primary,
                ),
              ),
              const SizedBox(height: 24),
              // 标题
              Center(
                child: Text(
                  '保持后台连接',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Center(
                child: Text(
                  '为了让 App 随时收到 Agent 工作通知，\n请按以下步骤操作',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
              const SizedBox(height: 32),
              // 平台专属说明
              _PlatformSteps(isAndroid: isAndroid),
              const Spacer(),
              // 按钮区
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (isAndroid) ...[
                    FilledButton.icon(
                      icon: const Icon(Icons.settings_outlined),
                      label: const Text('去设置（电池优化）'),
                      onPressed: () => _openBatterySettings(context),
                    ),
                    const SizedBox(height: 12),
                  ],
                  OutlinedButton(
                    onPressed: () => _dismiss(context),
                    child: const Text('我知道了，稍后设置'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openBatterySettings(BuildContext context) async {
    // Android Intent：跳转到"忽略电池优化"设置页
    // 使用 url_launcher 或 platform channel，此处用占位实现
    // 实际接入时替换为：
    //   await AppSettings.openAppSettings(type: AppSettingsType.batteryOptimization);
    // 或者：
    //   const channel = MethodChannel('com.example.claude_mobile/settings');
    //   await channel.invokeMethod('openBatteryOptimization');
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('请手动前往：设置 → 电池优化 → 找到本 App → 选择不优化'),
        duration: Duration(seconds: 4),
      ),
    );
  }

  Future<void> _dismiss(BuildContext context) async {
    await storage.markDone();
    if (!context.mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const HomeScreen()),
      (_) => false,
    );
  }
}

/// 平台专属操作步骤说明
class _PlatformSteps extends StatelessWidget {
  final bool isAndroid;

  const _PlatformSteps({required this.isAndroid});

  @override
  Widget build(BuildContext context) {
    final steps = isAndroid
        ? [
            '打开手机 设置',
            '进入 电池 → 电池优化（或"省电管理"）',
            '找到本 App（Claude Mobile）',
            '选择 不优化（或"无限制"）',
          ]
        : [
            '打开手机 设置',
            '进入 通用 → 后台 App 刷新',
            '确认 Claude Mobile 已开启',
          ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: steps
          .asMap()
          .entries
          .map(
            (e) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _StepBadge(number: e.key + 1),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      e.value,
                      style: Theme.of(context).textTheme.bodyLarge,
                    ),
                  ),
                ],
              ),
            ),
          )
          .toList(),
    );
  }
}

class _StepBadge extends StatelessWidget {
  final int number;

  const _StepBadge({required this.number});

  @override
  Widget build(BuildContext context) {
    return CircleAvatar(
      radius: 14,
      backgroundColor: Theme.of(context).colorScheme.primaryContainer,
      child: Text(
        '$number',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.bold,
          color: Theme.of(context).colorScheme.onPrimaryContainer,
        ),
      ),
    );
  }
}
