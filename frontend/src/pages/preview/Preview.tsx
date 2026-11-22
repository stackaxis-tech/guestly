/** Side-by-side Home concepts: /preview/a, /preview/b, /preview/c. */
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { SegmentedTabs } from "../../components/mobile";
import { HomeDay } from "./HomeDay";
import { HomeKeyRack } from "./HomeKeyRack";
import { HomeNextUp } from "./HomeNextUp";

const concepts = {
  a: { label: "A · Key rack", page: <HomeKeyRack /> },
  b: { label: "B · The day", page: <HomeDay /> },
  c: { label: "C · Next up", page: <HomeNextUp /> },
} as const;
type Id = keyof typeof concepts;

export function PreviewPage() {
  const { concept } = useParams();
  const navigate = useNavigate();
  if (!concept || !(concept in concepts)) return <Navigate to="/preview/a" replace />;
  const id = concept as Id;
  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-5">
        <SegmentedTabs value={id} onChange={(v) => navigate(`/preview/${v}`, { replace: true })} options={(Object.keys(concepts) as Id[]).map((k) => ({ value: k, label: concepts[k].label }))} />
      </div>
      {concepts[id].page}
    </div>
  );
}
