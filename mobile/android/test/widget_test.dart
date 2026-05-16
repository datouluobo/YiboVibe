import 'package:flutter_test/flutter_test.dart';
import 'package:yibovibe_mobile/main.dart';

void main() {
  testWidgets('App starts', (WidgetTester tester) async {
    await tester.pumpWidget(const YiboVibeApp());
    expect(find.text('YiboVibe'), findsOneWidget);
  });
}
