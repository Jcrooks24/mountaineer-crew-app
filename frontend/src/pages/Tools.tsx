import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AppHeader from "../components/AppHeader";
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
        <Tile icon={<TileIcons.clock />} label="Off-job hours" sublabel="Log non-job time" onClick={() => nav("/off-job")} />
        <Tile icon={<TileIcons.road />} label="Long-distance" sublabel="HOS, RODS, per-diem" onClick={() => nav("/long-distance")} />
        {user?.role === "admin" && (
          <Tile icon={<TileIcons.gear />} label="Admin" sublabel="Console" onClick={() => nav("/admin")} />
        )}
      </TileGrid>
    </div>
  );
}
