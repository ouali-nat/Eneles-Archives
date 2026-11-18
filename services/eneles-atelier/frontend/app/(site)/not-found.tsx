import { StatusPage } from "@/components/essential/status/StatusPage";

/** A page of the site that called notFound() (a template or a manual page that does not exist): the status inside the site's header and footer. */
export default function SiteNotFound() {
  return <StatusPage kind="not-found" frame="fill" actions={[{ label: "Go home", href: "/" }, { label: "Go back", back: true, fallback: "/" }]} />;
}
