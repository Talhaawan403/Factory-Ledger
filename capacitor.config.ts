import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.factoryledger.app',
  appName: 'Factory Ledger',
  webDir: 'dist',
  backgroundColor: '#0E0E10',
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK'
    },
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    }
  }
};

export default config;
