import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThunderIDProvider } from "@thunderid/react";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles.css";

const clientId = import.meta.env.VITE_THUNDER_CLIENT_ID;
const baseUrl = import.meta.env.VITE_THUNDER_BASE_URL;
const thunderidReady = Boolean(clientId && baseUrl);

const SCOPES = ["openid", "profile", "email", "ou", "agent:access", "booking:read", "booking:create", "booking:cancel"];

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      {thunderidReady ? (
        <ThunderIDProvider
          clientId={clientId}
          baseUrl={baseUrl}
          afterSignInUrl={window.location.origin}
          afterSignOutUrl={window.location.origin}
          scopes={SCOPES}
          discovery={{ wellKnown: { enabled: true } }}
        >
          <App authReady />
        </ThunderIDProvider>
      ) : (
        <App authReady={false} />
      )}
    </BrowserRouter>
  </StrictMode>
);
