<script setup>
import ToastHost from './components/ToastHost.vue';
</script>

<template>
  <div class="app-shell">
    <router-view />
    <ToastHost />
  </div>
</template>
