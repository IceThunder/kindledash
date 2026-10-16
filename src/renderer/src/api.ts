import type { KindleDashApi } from '../../preload/index'

declare global {
  interface Window {
    kd: KindleDashApi
  }
}

export const kd = window.kd
