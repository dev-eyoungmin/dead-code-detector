<script setup lang="ts">
import Comp from './Comp.vue';
import { vueHelper } from './vue-util';

const title = vueHelper();
</script>

<template>
  <h1>{{ title }}</h1>
  <Comp />
</template>
