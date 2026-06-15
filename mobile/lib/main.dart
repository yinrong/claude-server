import 'package:flutter/material.dart';
import 'core/config/app_config.dart';
import 'app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppConfig.init();
  runApp(const ClaudeApp());
}
