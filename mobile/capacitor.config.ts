import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor wraps the existing dibs web app (HTML/CSS/JS) into a real native
// iOS + Android app you can submit to the App Store and Google Play — without
// rewriting the UI. Put the web build (index.html + dibs-api.js + assets) in
// the `webDir` folder below.
const config: CapacitorConfig = {
  appId: 'app.dibs.mobile',          // reverse-DNS bundle id (must be unique)
  appName: 'dibs',
  webDir: 'www',                      // folder containing your built web app
  backgroundColor: '#f3ecda',
  ios: {
    contentInset: 'always',
  },
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    // For live reload during development you can point this at your dev server:
    // url: 'http://192.168.1.20:5173', cleartext: true
  },
  plugins: {
    Camera: {},
    Preferences: {},
  },
};

export default config;
