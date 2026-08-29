import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './assets/base.css'

void createApp(App).use(router).mount('#app')
