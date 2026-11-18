"use client";

import { LoadingScreen } from "@/components/essential/status/LoadingScreen";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { projectsAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle } from "@/components/icons";

export default function InviteAcceptPage() {
  const router = useRouter();
  const params = useParams();
  const inviteToken = params.token as string;
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error" | "auth_required">("loading");
  const [message, setMessage] = useState("");

  // If not authenticated, ask for a sign-in (the button sends the return URL along). Checked on the first render and again whenever the token or the sign-in state changes.
  const [checked, setChecked] = useState<{ inviteToken: string; isAuthenticated: boolean } | null>(null);
  if (!checked || checked.inviteToken !== inviteToken || checked.isAuthenticated !== isAuthenticated) {
    setChecked({ inviteToken, isAuthenticated });
    if (inviteToken && !isAuthenticated) setStatus("auth_required");
  }

  useEffect(() => {
    if (!inviteToken || !isAuthenticated) return;

    // Accept the invitation
    projectsAPI
      .acceptInvitation(inviteToken)
      .then(() => {
        setStatus("success");
        setMessage("You've been added as a collaborator!");
      })
      .catch((err: any) => {
        setStatus("error");
        setMessage(err.message || "Failed to accept invitation");
      });
  }, [inviteToken, isAuthenticated]);

  if (status === "loading") {
    return <LoadingScreen label="Accepting the invitation" showLabel />;
  }

  if (status === "auth_required") {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-xl font-semibold">Sign in to accept invitation</h2>
          <p className="text-muted-foreground">
            You need to sign in or create an account to accept this project invitation.
          </p>
          <Button onClick={() => router.push(`/login?redirect=/invite/${inviteToken}`)}>
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="text-center space-y-4 max-w-md">
        {status === "success" ? (
          <>
            <CheckCircle className="h-12 w-12 text-hue-green mx-auto" />
            <h2 className="text-xl font-semibold">{message}</h2>
            <p className="text-muted-foreground">
              The shared project is now available in your projects list.
            </p>
            <Button onClick={() => router.push("/projects")}>
              Go to projects
            </Button>
          </>
        ) : (
          <>
            <XCircle className="h-12 w-12 text-danger mx-auto" />
            <h2 className="text-xl font-semibold">This invitation did not work</h2>
            <p className="text-muted-foreground">{message}</p>
            <Button variant="outline" onClick={() => router.push("/projects")}>
              Go to projects
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
