/**
 * 全局注册组件的 TypeScript 类型声明
 * 让模板里直接使用 <JcIcon>（无需 import）时 vue-tsc 不报错
 */
export {}

declare module 'vue' {
  interface GlobalComponents {
    JcIcon: typeof import('@/components/icons/JcIcon.vue')['default']
  }
}
