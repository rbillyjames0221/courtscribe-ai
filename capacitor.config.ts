import type { CapacitorConfig } from '@capacitor/cli'

// Android shell for the future APK. Not built yet — see README "Android (Capacitor)".
const config: CapacitorConfig = {
  appId: 'ph.courtscribe.app',
  appName: 'CourtScribe AI',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: { androidScheme: 'https' },
}

export default config
