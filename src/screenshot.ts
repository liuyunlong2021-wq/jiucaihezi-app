// 独立入口：截图窗不加载 App、Pinia、Gateway、Harness 或项目监听。
import { createApp } from 'vue'
import './styles/design-tokens.css'
import './styles/base.css'
import { useTheme } from './composables/useTheme'
import ScreenshotOverlay from './components/memory/ScreenshotOverlay.vue'
useTheme()
createApp(ScreenshotOverlay).mount('#app')
