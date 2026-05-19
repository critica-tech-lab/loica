import { redirect } from "react-router";
import type { Route } from "./+types/workspace.legacy-doc";

export async function loader({ params }: Route.LoaderArgs) {
  throw redirect(`/w/doc/${params.id}`);
}
