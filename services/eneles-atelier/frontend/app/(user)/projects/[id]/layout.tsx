/**
 * Full-screen editor layout that overrides the (user) layout's sidebar and header.
 * This layout is used when viewing a specific project in the editor.
 */
export default function ProjectEditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
