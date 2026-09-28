import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { firebaseAuth } from "@/lib/firebase";
import { installAuthFetch } from "@/lib/api";
import { setAuthTokenGetter } from "@workspace/api-client-react";

setAuthTokenGetter(async () => firebaseAuth.currentUser?.getIdToken() ?? null);
// Plain fetch() calls used across the pages get the Firebase ID token automatically.
installAuthFetch();

createRoot(document.getElementById("root")!).render(<App />);
