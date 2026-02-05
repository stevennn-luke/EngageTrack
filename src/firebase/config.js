import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: "AIzaSyDuOURiewhrGKZSrJTFT-bjKdydtcpFUxw",
  authDomain: "attention-detection.firebaseapp.com",
  projectId: "attention-detection",
  storageBucket: "attention-detection.firebasestorage.app",
  messagingSenderId: "938727467811",
  appId: "1:938727467811:web:6b7c1174984860c4927a96",
  measurementId: "G-XFWVC4PS0S"
};

// Singleton pattern for HMR support
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Try to initialize with settings, fallback to existing instance if HMR re-runs this
let firestoreDb;
try {
  firestoreDb = initializeFirestore(app, { experimentalForceLongPolling: true });
} catch (e) {
  firestoreDb = getFirestore(app);
}
export const db = firestoreDb;

export const analytics = getAnalytics(app);

export default app;