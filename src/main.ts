import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { themeController } from './theme/themeController'
import './assets/base.css'
import './theme/theme.css'

await themeController.init()

void createApp(App).use(router).mount('#app')
