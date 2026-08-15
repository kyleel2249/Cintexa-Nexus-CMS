import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Firebase Web configuration is safe to ship with the client application.
// Environment variables remain supported for deployments, while these public
// project values provide a working local Windows setup when .env is absent.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyAmJlj9GJSuo9sZavyLdCRQQbQA6Ccj9o",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "cintexa-nexus.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "cintexa-nexus",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "cintexa-nexus.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "754370362256",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:754370362256:web:a27f3150c243ded6229115",
};

const requiredKeys = Object.entries(firebaseConfig).filter(([, value]) => !value);
if (requiredKeys.length) {
  console.warn(`Firebase configuration is incomplete. Missing: ${requiredKeys.map(([key]) => key).join(", ")}`);
}

const app = initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(app);
export const firestore = getFirestore(app);
export const firebaseStorage = getStorage(app);
export default app;
