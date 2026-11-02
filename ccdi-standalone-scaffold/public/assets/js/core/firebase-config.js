/**
 * CINTEXA CCDI — Firebase bootstrap
 * -----------------------------------------------------------------------
 * Fill in the values below from Firebase Console → Project settings →
 * General → "Your apps" → SDK setup and configuration.
 *
 * DO NOT commit real production keys to a public repository. Firebase web
 * API keys are not secret in the traditional sense (they identify the
 * project, not authorize access) but you should still restrict them via
 * Firebase App Check / API key restrictions in Google Cloud Console.
 * -----------------------------------------------------------------------
 */

// Firebase v10 modular SDK (loaded from CDN in index.html as ES modules)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getStorage,
  connectStorageEmulator,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import {
  getFunctions,
  connectFunctionsEmulator,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';

// -------------------------------------------------------------------------
// REPLACE with your Firebase project config (see docs/DEPLOYMENT.md)
// -------------------------------------------------------------------------
export const firebaseConfig = {
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// Set to true while developing against the Firebase Local Emulator Suite
export const USE_EMULATORS = false;

export const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const auth = getAuth(app);
export const storage = getStorage(app);
export const fns = getFunctions(app);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);
}

export const APP_META = {
  name: 'CINTEXA CCDI',
  fullName: 'CINTEXA Advanced Cyber Defense & Security Intelligence',
  phase: 'Phase 4 — Core Security Engines',
  version: '4.0.0',
};
