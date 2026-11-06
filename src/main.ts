import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
import { initializeTheme } from './core/theme'
import { initializeHost } from './host'

await initializeHost()
initializeTheme()
createApp(App).use(createPinia()).mount('#app')
