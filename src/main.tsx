import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./index.css";
import { TRPCProvider } from "@/providers/trpc";
import { I18nProvider } from "@/i18n";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <TRPCProvider>
          <App />
        </TRPCProvider>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>
);
