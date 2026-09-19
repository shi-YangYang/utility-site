import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/constants/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTitleAlign: 'center',
          headerShadowVisible: false,
          headerTintColor: Colors.text,
          headerStyle: { backgroundColor: Colors.card },
          contentStyle: { backgroundColor: Colors.background },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add" options={{ title: '截图记账' }} />
        <Stack.Screen name="manual" options={{ title: '手动记一笔' }} />
        <Stack.Screen name="record/[id]" options={{ title: '记录详情' }} />
      </Stack>
    </>
  );
}
