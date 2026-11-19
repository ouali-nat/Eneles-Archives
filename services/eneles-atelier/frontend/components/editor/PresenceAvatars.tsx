"use client";

import { memo } from "react";
import { AvatarGroup } from "@/components/people/Avatar";
import { type RemoteUser } from "@/hooks/useCollaboration";

interface PresenceAvatarsProps {
  remoteUsers: RemoteUser[];
  /** Map of file IDs to file paths, used to display readable file names */
  filePathMap?: Record<string, string>;
  maxVisible?: number;
}

/** Who else has the project open, left of the Share button: the shared face stack, each card saying which file the person is in. */
export const PresenceAvatars = memo(function PresenceAvatars({
  remoteUsers,
  filePathMap = {},
  maxVisible = 4,
}: PresenceAvatarsProps) {
  if (remoteUsers.length === 0) return null;

  const fileName = (filePath: string | null) => {
    if (!filePath) return null;
    const entry = Object.entries(filePathMap).find(([, p]) => p === filePath);
    const displayPath = entry ? entry[1] : filePath;
    return displayPath.split("/").pop() || displayPath;
  };

  return (
    <AvatarGroup
      className="me-2"
      label="People here"
      size="md"
      ring="background"
      max={maxVisible}
      people={remoteUsers.map((user) => {
        const file = fileName(user.activeFile);
        return {
          key: user.userId,
          id: user.userId,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl ?? null,
          role: file ? `Viewing ${file}` : "No file open",
        };
      })}
    />
  );
});
