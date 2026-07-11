<template>
  <div class="search-bar">
    <div class="search-input-wrapper">
      <input
        v-model="query"
        type="text"
        placeholder="搜索文档..."
        @keyup.enter="handleSearch"
        class="search-input"
      />
      <button @click="handleSearch" class="search-button">
        <span>🔍</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  'search': [query: string];
}>();

const query = ref('');

const handleSearch = () => {
  if (query.value.trim()) {
    emit('search', query.value.trim());
  }
};
</script>

<style scoped>
.search-bar {
  position: absolute;
  top: 2rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(15px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 24px;
  padding: 0.6rem 1.2rem;
  min-width: 450px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  color: white;
  font-size: 1rem;
  outline: none;
  padding: 0.3rem 0.5rem;
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.search-button {
  background: transparent;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 1.2rem;
  padding: 0.3rem 0.6rem;
  transition: transform 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-button:hover {
  transform: scale(1.1);
}
</style>
