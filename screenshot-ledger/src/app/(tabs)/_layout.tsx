import { Ionicons } from '@expo/vector-icons';
import { router, Tabs } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: 'center',
        headerShadowVisible: false,
        headerTintColor: Colors.text,
        headerStyle: { backgroundColor: Colors.card },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.subText,
        tabBarStyle: { backgroundColor: Colors.card },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '账本',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt-outline" size={size} color={color} />
          ),
          headerRight: () => (
            <Pressable
              hitSlop={8}
              onPress={() => router.push('/add')}
              style={styles.headerButton}>
              <Ionicons name="add-circle" size={26} color={Colors.primary} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="summary"
        options={{
          title: '汇总',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pie-chart-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerButton: {
    marginRight: Spacing.lg,
  },
});
