"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-context";
import type { VerificationIdentity } from "@/lib/api";
import { useRouter } from "next/navigation";
import { BrandMarks } from "@/components/BrandMarks";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

interface VerificationModalProps {
  email: string;
  /**
   * Set only for signups, where it is the negative pending-signup handle.
   * Logins leave it undefined and are verified by email, because the login
   * response deliberately does not disclose whether an account exists.
   */
  userId?: number;
  isOpen: boolean;
  isNewUser?: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** Sends a new code. Defaults to the site's resend; the admin panel sends through its own route. */
  onResend?: () => Promise<unknown>;
}

export function VerificationModal({
  email,
  userId,
  isOpen,
  isNewUser = false,
  onClose,
  onSuccess,
  onResend,
}: VerificationModalProps) {
  // Who this verification is for, in the shape the API expects.
  const identity: VerificationIdentity =
    typeof userId === "number" ? { userId } : { email };

  // Whether an account is being created right now. Derived from the identity
  // rather than trusted from the caller: the signup page passes isNewUser,
  // but when the address already had an account the server silently sent a
  // login code instead, and the copy below must not promise a new account.
  const creatingAccount = isNewUser && typeof userId === "number";
  const [step, setStep] = useState<"EMAIL_OTP" | "APP_2FA">("EMAIL_OTP");
  const [verificationCode, setVerificationCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const { verifyLoginCode, verifyApp2FA, resendLoginCode } = useAuth();
  const router = useRouter();

  const [lastAttemptedCode, setLastAttemptedCode] = useState("");

  // Takes the code and the last attempted code as arguments because the handlers that call it (typing the last digit, resending) know the new values before the next render does.
  const verifyCode = useCallback(async (code: string, lastCode: string) => {
    if (code.length !== 6) {
      setError("Please enter the complete 6-digit verification code");
      return;
    }

    // Prevent retrying the same failed code immediately
    if (code === lastCode) {
      return;
    }

    setIsVerifying(true);
    setLastAttemptedCode(code);
    setError("");
    setSuccess("");

    try {
      if (step === "EMAIL_OTP") {
        const response = await verifyLoginCode(identity, code);

        // Check if 2FA is required
        if (response.requires2FA) {
          setStep("APP_2FA");
          setVerificationCode("");
          setLastAttemptedCode("");
          setSuccess("Email verified. Please enter your 2FA code.");
          setTimeout(() => setSuccess(""), 3000); // Clear success message after delay
          return;
        }

        if (creatingAccount) {
          setSuccess("Account created successfully! Redirecting...");
        } else {
          setSuccess("Login verified successfully! Redirecting...");
        }

        onClose();
        if (onSuccess) onSuccess();
        else router.push("/dashboard");
      } else {
        // App 2FA Step
        await verifyApp2FA(identity, code);
        setSuccess("Authentication successful! Redirecting...");

        onClose();
        if (onSuccess) onSuccess();
        else router.push("/dashboard");
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to verify code. Please try again.");
      }
      // Do NOT reset lastAttemptedCode here: the failed code would count as untried again
    } finally {
      setIsVerifying(false);
    }
  }, [
    identity,
    creatingAccount,
    onClose,
    onSuccess,
    router,
    verifyLoginCode,
    verifyApp2FA,
    step,
  ]);

  const handleVerify = useCallback(
    () => verifyCode(verificationCode, lastAttemptedCode),
    [verifyCode, verificationCode, lastAttemptedCode],
  );

  // Auto-submit as soon as 6 digits are entered
  const handleCodeChange = (code: string) => {
    setVerificationCode(code);
    if (code.length === 6 && !isVerifying && code !== lastAttemptedCode) {
      void verifyCode(code, lastAttemptedCode);
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    setError("");
    setSuccess("");
    // A new code is on its way, so the one in the box is finished: empty it rather than leave a code that can only fail.
    setLastAttemptedCode("");
    setVerificationCode("");

    try {
      await (onResend ? onResend() : resendLoginCode(identity));
      setSuccess("Verification code resent. Please check your email.");
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to resend verification code. Please try again.");
      }
    } finally {
      setIsResending(false);
    }
  };

  // Handle Enter key to submit
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && verificationCode.length === 6 && !isVerifying) {
        e.preventDefault();
        handleVerify();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, verificationCode, isVerifying, handleVerify]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="@min-[40rem]:max-w-[30rem]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {step === "EMAIL_OTP"
              ? "Authentication code"
              : "Two-factor authentication"}
          </DialogTitle>
          <DialogDescription>
            {step === "EMAIL_OTP"
              ? creatingAccount
                ? `Please enter the 6-digit verification code sent to ${email}`
                : // Covers two cases the client cannot and must not distinguish:
                  // a login for an address that may or may not exist, and a
                  // signup for an address that already had an account (the
                  // server sent a sign-in code rather than saying so).
                  `If there is an account for ${email}, a 6-digit code is on its way.`
              : `Please enter the 6-digit code from your authenticator app`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {error && (
            <div className="p-3 text-sm text-danger rounded bg-danger/10">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 text-sm text-success rounded bg-success/10">
              {success}
            </div>
          )}

          <div className="flex flex-col items-center justify-center gap-4">
            <InputOTP
              maxLength={6}
              value={verificationCode}
              onChange={handleCodeChange}
              disabled={isVerifying}
              containerClassName="gap-2 @min-[40rem]:gap-4"
            >
              <InputOTPGroup>
                {Array.from({ length: 6 }).map((_, index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    className={`h-14 w-11 font-mono text-xl @min-[40rem]:w-12 ${isVerifying ? "opacity-50" : ""}`}
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>

          {step === "EMAIL_OTP" && (
            <div className="mt-2 flex flex-col items-center gap-1">
              <Button
                variant="link"
                onClick={handleResend}
                disabled={isResending}
                className="px-0"
              >
                {isResending ? (
                  <>
                    <BrandMarks.spinner className="w-4 h-4 me-2 animate-spin" />
                    Resending...
                  </>
                ) : (
                  "Didn't receive a code? Resend"
                )}
              </Button>
              {/* With login no longer confirming that an account exists, a
                  missing email is the only signal a new user gets. Say so, but
                  only on the login page; on signup the address either just got
                  a signup code or already had an account and got a sign-in
                  code, and in both cases the right move is to check the inbox. */}
              {!creatingAccount && !isNewUser && (
                <p className="text-center text-xs text-muted-foreground">
                  Still nothing after a minute? You may not have an account
                  yet.{" "}
                  <a
                    href="/signup"
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    Sign up
                  </a>
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            size="lg"
            onClick={handleVerify}
            disabled={isVerifying || verificationCode.length !== 6}
            className="w-full"
          >
            {isVerifying ? (
              <>
                <BrandMarks.spinner className="size-4 animate-spin" />
                Checking the code
              </>
            ) : (
              "Continue"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
