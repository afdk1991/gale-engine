/// <reference types="vite/client" />
import type { GaleApi } from '../shared/types'

declare global {
  interface Window {
    gale: GaleApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

export {}
