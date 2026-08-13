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
import ServerRestartBanner from "./components/ServerRestartBanner";
import RolePreviewSwitch from "./components/RolePreviewSwitch";
import BottomNav from "./components/BottomNav";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import MechanicSign from "./pages/MechanicSign";

// ── STATIC IMPORTS, deliberately. Route code splitting was reverted 2026-08-13.
//
// Splitting cut the initial download from 462 KB to 174 KB gzipped, which was
// real. It also made the SERVICE-WORKER UPDATE fatal, and that trade is not
// close.
//
// applyWaitingUpdate() sends SKIP_WAITING, and Workbox evicts the old precache
// the moment the new worker activates. It then waits 150 ms before reloading so
// React can unmount. With one bundle that window was harmless: all the code was
// already in memory. With split routes, any chunk not yet loaded had just been
// deleted, so the app could break in the gap between "old precache gone" and
// "page reloaded" - crews saw a black screen that only a manual refresh cleared.
//
// lib/lazyRoute.ts was written for the neighbouring problem (a chunk missing
// after a deploy) and does not cover this one: the failure happens while the
// page is mid-teardown, where a reload guard has nothing useful to do.
//
// Re-landing this needs the update path fixed first, not the routes changed
// back. See RUNBOOKS "App update showed a black screen".
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import DVIRPage from "./pages/DVIR";
import LongDistance from "./pages/LongDistance";
import DocumentLibrary from "./pages/DocumentLibrary";
import Reimbursement from "./pages/Reimbursement";
import OffJob from "./pages/OffJob";
import Availability from "./pages/Availability";
import ReportBug from "./pages/ReportBug";
import RequestFeature from "./pages/RequestFeature";
import Tools from "./pages/Tools";
import Bulletin from "./pages/Bulletin";

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
        {/* Persistent crew bottom nav; self-hides on public + admin routes */}
        <BottomNav />
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  </StrictMode>
);
