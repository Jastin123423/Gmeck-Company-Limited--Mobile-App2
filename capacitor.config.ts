import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.diocres.hardwaresolutions',
  appName: 'Gmeck POS',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SystemBars: {
      style: 'DARK',
      hidden: false
    },
    SplashScreen: {
      launchShowDuration: 300,
      launchAutoHide: true,
      backgroundColor: '#020617',
      showSpinner: false
    }
  },
  android: {
    backgroundColor: '#020617',
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
