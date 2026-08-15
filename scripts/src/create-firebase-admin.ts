import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fs from "node:fs";

const email = (process.env.CINTEXA_ADMIN_EMAIL ?? "cintexadmin@cintexa.com").trim().toLowerCase();
const name = process.env.CINTEXA_ADMIN_NAME ?? "Cintexa Admin";
const password = process.env.CINTEXA_ADMIN_PASSWORD;
const projectId = process.env.FIREBASE_PROJECT_ID ?? "cintexa-nexus";
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!password || password.length < 8) {
  console.error("CINTEXA_ADMIN_PASSWORD must be provided and contain at least 8 characters.");
  process.exit(1);
}

if (!credentialsPath || !fs.existsSync(credentialsPath)) {
  console.error("GOOGLE_APPLICATION_CREDENTIALS must point to a Firebase service-account JSON file.");
  console.error("Download a service account from Firebase Console > Project settings > Service accounts.");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(fs.readFileSync(credentialsPath, "utf8"))),
    projectId,
  });
}

const auth = getAuth();
const firestore = getFirestore();

async function main() {
  let user;
  try {
    user = await auth.getUserByEmail(email);
    user = await auth.updateUser(user.uid, { displayName: name, password, disabled: false });
    console.log(`Firebase admin account updated: ${email}`);
  } catch (error: any) {
    if (error?.code !== "auth/user-not-found") throw error;
    user = await auth.createUser({ email, password, displayName: name, disabled: false });
    console.log(`Firebase admin account created: ${email}`);
  }

  await auth.setCustomUserClaims(user.uid, { admin: true });
  await firestore.collection("users").doc(user.uid).set({
    name,
    email,
    role: "admin",
    status: "active",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log("Admin custom claim and Firestore profile configured successfully.");
}

main().catch((error) => {
  console.error("Failed to provision Firebase admin account:", error);
  process.exitCode = 1;
});
