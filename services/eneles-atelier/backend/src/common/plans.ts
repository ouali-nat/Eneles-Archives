/** One public Eneles access level. -1 means no per-account subscription quota.
 * Service-wide safeguards and maximum request sizes remain enforced separately.
 */
export type PlanId = 'free' | 'pro' | 'team' | 'enterprise';
export interface PlanAllowance {
  snipsPerMonth: number; pdfPagesPerMonth: number; uploadStorageBytes: number; aiAssistant: boolean;
}
export const PLAN_ALLOWANCES: Record<PlanId, PlanAllowance> = {
  free: { snipsPerMonth: -1, pdfPagesPerMonth: -1, uploadStorageBytes: -1, aiAssistant: true },
  pro: { snipsPerMonth: -1, pdfPagesPerMonth: -1, uploadStorageBytes: -1, aiAssistant: true },
  team: { snipsPerMonth: -1, pdfPagesPerMonth: -1, uploadStorageBytes: -1, aiAssistant: true },
  enterprise: { snipsPerMonth: -1, pdfPagesPerMonth: -1, uploadStorageBytes: -1, aiAssistant: true },
};
export function planAllowance(_subscriptionType: string | null | undefined): PlanAllowance {
  return PLAN_ALLOWANCES.free;
}
export function formatBytes(bytes: number): string {
  const MB = 1024 * 1024; const GB = 1024 * MB;
  return bytes >= GB ? `${Math.round(bytes / GB)} GB` : `${Math.round(bytes / MB)} MB`;
}
