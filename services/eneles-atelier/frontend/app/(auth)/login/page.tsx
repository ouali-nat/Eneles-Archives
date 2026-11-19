"use client";

import { safeRedirect } from "@/lib/safe-redirect";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandMarks } from "@/components/BrandMarks";
import { Button } from "@/components/ui/button";
import { AuthCard, authInput } from "@/components/essential/auth/AuthFrame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useAuth } from "@/lib/auth-context";
import { VerificationModal } from "@/components/essential/auth/OTPModal";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loginWithEmail, isLoading } = useAuth();
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [loginData, setLoginData] = useState<{
    email: string;
    isNewUser: boolean;
  } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email") as string;

    if (!email) {
      toast.error("Please enter your email address");
      return;
    }

    try {
      // Call the new email-only login, which will initiate OTP process
      const result = await loginWithEmail(email);

      // Store login data for verification
      setLoginData(result);

      // Show verification modal
      setIsVerificationModalOpen(true);
    } catch (err: any) {
      // The server no longer distinguishes "no such account" from success, so
      // there is no not-found branch to route to signup from. Anything landing
      // here is a genuine failure: validation, rate limit, or mail delivery.
      if (err instanceof Error) {
        toast.error(err.message);
      } else {
        toast.error("Failed to login. Please try again.");
      }
    }
  }

  const handleLoginSuccess = () => {
    router.push(safeRedirect(searchParams.get("redirect")));
  };

  const redirect = searchParams.get("redirect");
  const signupHref = redirect ? `/signup?redirect=${encodeURIComponent(redirect)}` : "/signup";

  return (
    <>
      <AuthCard
        title="Sign in"
        description="We email you a six-digit code. There is no password to remember."
        footer={
          <>
            New to Eneles?{" "}
            <Link href={signupHref} className="font-medium text-foreground underline underline-offset-4">
              Create an account
            </Link>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@university.edu"
              required
              disabled={isLoading}
              className={authInput}
            />
          </div>
          <Button size="lg" className="w-full" type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <BrandMarks.spinner className="size-4 animate-spin" />
                Sending code
              </>
            ) : (
              "Send code"
            )}
          </Button>
        </form>
      </AuthCard>

      {isVerificationModalOpen && loginData && (
        <VerificationModal
          email={loginData.email}
          isNewUser={loginData.isNewUser}
          isOpen={isVerificationModalOpen}
          onClose={() => setIsVerificationModalOpen(false)}
          onSuccess={handleLoginSuccess}
        />
      )}
    </>
  );
}
