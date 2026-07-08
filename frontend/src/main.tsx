import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import App from "./App";

import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import RequireAuth from "./auth/RequireAuth";
import ErrorBoundary from "./components/ErrorBoundary";
import UpdateBanner from "./components/UpdateBanner";
import AvailabilityReminderBanner from "./components/AvailabilityReminderBanner";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import MechanicSign from "./pages/MechanicSign";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import DVIRPage from "./pages/DVIR";
import LongDistance from "./pages/LongDistance";
import DocumentLibrary from "./pages/DocumentLibrary";
import Reimbursement from "./pages/Reimbursement";
import OffJob from "./pages/OffJob";
import Availability from "./pages/Availability";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
        {/* App-wide; fixed-position, renders over whatever route is active */}
        <UpdateBanner />
        <AvailabilityReminderBanner />
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          {/* Public - a mechanic with no account signs off a DVIR via an emailed token link */}
          <Route path="/mechanic-sign" element={<MechanicSign />} />

          {/* Protected */}
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
          <Route path="/dvir" element={<RequireAuth><DVIRPage /></RequireAuth>} />
          <Route path="/long-distance" element={<RequireAuth><LongDistance /></RequireAuth>} />
          <Route path="/documents" element={<RequireAuth><DocumentLibrary /></RequireAuth>} />
          <Route path="/reimbursement" element={<RequireAuth><Reimbursement /></RequireAuth>} />
          <Route path="/off-job" element={<RequireAuth><OffJob /></RequireAuth>} />
          <Route path="/availability" element={<RequireAuth><Availability /></RequireAuth>} />

          {/* Everything else requires auth */}
          <Route
            path="/*"
            element={
              <RequireAuth>
                <App />
              </RequireAuth>
            }
          />
        </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  </StrictMode>
);
