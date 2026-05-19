import { redirect } from "react-router";
import type { Route } from "./+types/workspace.legacy-folder";

export async function loader({ params }: Route.LoaderArgs) {
  throw redirect(`/w/folder/${params.folderId}`);
}
