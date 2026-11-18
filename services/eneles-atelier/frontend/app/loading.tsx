import { LoadingScreen } from "@/components/essential/status/LoadingScreen";

/** Shown while a route with no skeleton of its own loads. Signed-in routes have their own (app/(user)/loading.tsx), which keeps the sidebar. */
export default function Loading() {
  return <LoadingScreen />;
}
