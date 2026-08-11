import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AppHeader from "../components/AppHeader";
import BetaTag from "../components/BetaTag";
import { Tile, TileGrid, TileIcons } from "../components/Tile";

/**
 * Tools hub - the bottom-nav "Tools" tab. A grid of every standalone tool, so
 * nothing is buried under Profile. Job-contextual tools (BOL, materials, photos)
 * live in the active-job hub, not here.
 */
export default function Tools() {
  const nav = useNavigate();
  const { user } = useAuth();

  return (
    <div className="container">
      <AppHeader title="Tools" />
      <TileGrid>
        <Tile icon={<TileIcons.truck />} label="DVIR" sublabel="Vehicle inspection" onClick={() => nav("/dvir")} />
        <Tile icon={<TileIcons.dollar />} label="Reimbursement" sublabel="Mileage & expenses" onClick={() => nav("/reimbursement")} />
        <Tile icon={<TileIcons.doc />} label="Documents" sublabel="Guides & forms" onClick={() => nav("/documents")} />
        <Tile icon={<TileIcons.calendar />} label="Availability" sublabel="Set your days" onClick={() => nav("/availability")} />
        {/* Carries the beta tag the removed Profile "Tools & Resources" card
            used to own. offJobHours is still in BETA_FEATURES; BetaTag renders
            null once it graduates, so this needs no cleanup at the next
            APP_VERSION bump. */}
        <Tile icon={<TileIcons.clock />} label="Off-job hours" sublabel="Log non-job time" onClick={() => nav("/off-job")} badge={<BetaTag feature="offJobHours" />} />
        <Tile icon={<TileIcons.road />} label="Long-distance" sublabel="HOS, RODS, per-diem" onClick={() => nav("/long-distance")} />
        <Tile icon={<TileIcons.bug />} label="Report a bug" sublabel="Something broken or off" onClick={() => nav("/report-bug")} />
        <Tile icon={<TileIcons.lightbulb />} label="Request a feature" sublabel="Suggest an idea or change" onClick={() => nav("/request-feature")} />
        {user?.role === "admin" && (
          <Tile icon={<TileIcons.gear />} label="Admin" sublabel="Console" onClick={() => nav("/admin")} />
        )}
      </TileGrid>
    </div>
  );
}
