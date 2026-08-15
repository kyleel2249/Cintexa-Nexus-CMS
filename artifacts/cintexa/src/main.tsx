import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { firebaseAuth } from "@/lib/firebase";
import { setAuthTokenGetter } from "@workspace/api-client-react";

setAuthTokenGetter(async () => firebaseAuth.currentUser?.getIdToken() ?? null);

createRoot(document.getElementById("root")!).render(<App />);
