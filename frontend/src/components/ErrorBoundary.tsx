import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

/**
 * App-wide error boundary. Without one, any render-time exception unmounts
 * React to a blank white screen — on a field device that strands the crew
 * with no way back. This catches the crash and shows a recoverable screen.
 *
 * Styling is deliberately hardcoded (not theme variables): the boundary must
 * render even if the theme layer is part of what failed. Colors match the
 * PWA manifest's dark theme so it still looks like the app.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Unexpected error",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Logged for the device console / remote diagnostics.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0f172a",
          color: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          boxSizing: "border-box",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: 380, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5, color: "#94a3b8", marginBottom: 20 }}>
            The app hit an unexpected error. Your saved work isn't lost — logged
            jobs and queued data are stored on this device and will sync once
            the app is back up.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                width: "100%",
                padding: "13px 16px",
                background: "#5dd6c2",
                color: "#06231f",
                border: "none",
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Reload app
            </button>
            <button
              onClick={() => window.location.assign("/")}
              style={{
                width: "100%",
                padding: "13px 16px",
                background: "transparent",
                color: "#e2e8f0",
                border: "1px solid #334155",
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Go to Jobs
            </button>
          </div>
          {this.state.message && (
            <div
              style={{
                marginTop: 16,
                fontSize: 11,
                color: "#64748b",
                fontFamily: "monospace",
                wordBreak: "break-word",
              }}
            >
              {this.state.message}
            </div>
          )}
        </div>
      </div>
    );
  }
}
