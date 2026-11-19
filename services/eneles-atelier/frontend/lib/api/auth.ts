import { API_URL, apiFetch } from "./client";
import type { VerificationIdentity } from "./users";

/**
 * Sends (or resends) an OTP code to the user's email
 */
export async function sendOTP(
  identity: VerificationIdentity,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await apiFetch(`${API_URL}/auth/send-otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(identity),
      credentials: "include",
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.message || "Failed to send verification code",
      };
    }

    return {
      success: true,
      message: data.message || "Verification code sent successfully",
    };
  } catch (error) {
    console.error("Error sending OTP:", error);
    return {
      success: false,
      message: "An unexpected error occurred",
    };
  }
}
