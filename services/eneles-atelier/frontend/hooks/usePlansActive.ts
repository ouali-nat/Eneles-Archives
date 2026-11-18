"use client";

import { useEffect, useState } from "react";
import { billingAPI } from "@/lib/api";

// Asked once per page load and shared: every Upgrade prompt reads the same answer.
let known: boolean | null = null;
let pending: Promise<boolean> | null = null;

/** Whether paid plans can be bought (the API's BILLING_PLANS_ACTIVE). Null until known; callers treat that as paused, so no Upgrade is offered that the API would refuse. */
export function usePlansActive(): boolean | null {
  const [active, setActive] = useState(known);
  useEffect(() => {
    if (known !== null) return;
    pending ??= billingAPI
      .getStatus()
      .then((status) => (known = !!status?.plansActive))
      .catch(() => {
        // Asked again on the next mount; meanwhile, paused.
        pending = null;
        return false;
      });
    let live = true;
    void pending.then((value) => live && setActive(value));
    return () => {
      live = false;
    };
  }, []);
  return active;
}
