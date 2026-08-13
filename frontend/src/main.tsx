import "./index.css";

import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import App from "./App";

import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import RequireAuth from "./auth/RequireAuth";
import ErrorBoundary from "./components/ErrorBoundary";
import UpdateBanner from "./components/UpdateBanner";
import AvailabilityReminderBanner from "./components/AvailabilityReminderBanner";
import ServerRestartBanner from "./components/ServerRestartBanner";
import RolePreviewSwitch from "./components/RolePreviewSwitch";
import BottomNav from "./components/BottomNav";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import MechanicSign from "./pages/MechanicSign";

// ── Route-level code splitting ────────────────────────────────────────────────
//
// Everything used to be a static import, so the whole app shipped as ONE 1.5 MB
// bundle (462 KB gzipped) that every crew phone downloaded and parsed before it
// could show the timeline. Admin.tsx alone is 9,268 lines and is opened by a
// handful of people, but every crew member paid for it on every cold load and on
// every deploy, over whatever signal they had at the time.
//
// The timeline (App) stays a STATIC import: it is the screen crews open, and
// making the common case wait on a second round trip would be a pessimisation
// dressed as an optimisation. Everything reached by navigating stays lazy.
const Profile = lazy(() => import("./pages/Profile"));
const Admin = lazy(() => import("./pages/Admin"));
const DVIRPage = lazy(() => import("./pages/DVIR"));
const LongDistance = lazy(() => import("./pages/LongDistance"));
const DocumentLibrary = lazy(() => import("./pages/DocumentLibrary"));
const Reimbursement = lazy(() => import("./pages/Reimbursement"));
const OffJob = lazy(() => import("./pages/OffJob"));
const Availability = lazy(() => import("./pages/Availability"));
const ReportBug = lazy(() => import("./pages/ReportBug"));
const RequestFeature = lazy(() => import("./pages/RequestFeature"));
const Tools = lazy(() => import("./pages/Tools"));
const Bulletin = lazy(() => import("./pages/Bulletin"));

/** Shown while a route chunk downloads. Deliberately plain and quiet: on a good
 *  connection it is visible for a few hundred milliseconds, and a spinner that
 *  flashes is more unsettling than a line of text. */
function RouteLoading() {
  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <div className="card" style={{ color: "var(--muted)", fontSize: 13 }}>
        Loading...
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
        {/* App-wide; fixed-position, renders over whatever route is active */}
        <UpdateBanner />
        <AvailabilityReminderBanner />
        {/* Explains the periodic backend recycle instead of leaving a spinner */}
        <ServerRestartBanner />
        {/* Staging-only role preview (self-hides on production) */}
        <RolePreviewSwitch />
        {/* Suspense wraps the routes, not the app: the fallback must never
            replace the bottom nav or the banners above, or a crew member loading
            a screen loses the way back out of it. */}
        <Suspense fallback={<RouteLoading />}>
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
          <Route path="/report-bug" element={<RequireAuth><ReportBug /></RequireAuth>} />
          <Route path="/request-feature" element={<RequireAuth><RequestFeature /></RequireAuth>} />
          <Route path="/availability" element={<RequireAuth><Availability /></RequireAuth>} />
          <Route path="/tools" element={<RequireAuth><Tools /></RequireAuth>} />
          <Route path="/bulletin" element={<RequireAuth><Bulletin /></RequireAuth>} />

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
        </Suspense>
        {/* Persistent crew bottom nav; self-hides on public + admin routes */}
        <BottomNav />
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  </StrictMode>
);
