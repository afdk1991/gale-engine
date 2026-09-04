<script setup lang="ts">
import AppSidebar from './components/AppSidebar.vue'
</script>

<template>
  <AppSidebar />
  <main class="content">
    <RouterView />
  </main>
</template>

<style scoped>
.content { flex: 1; min-width: 0; display: flex; flex-direction: column; }
</style>
