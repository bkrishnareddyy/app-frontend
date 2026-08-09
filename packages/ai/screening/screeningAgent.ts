export type ScreeningStatus = "BLOCKED" | "PASSED" | "INDETERMINATE";

export interface ScreeningResult {
  status: ScreeningStatus;
  /** Null unless a real list was consulted; a screen that did not run has no pass/fail. */
  isPassed: boolean | null;
  matchedParties: Array<{
    entityName: string;
    listName: string;
    score: number;
  }>;
  /** Why the screen could not be relied on. Null when it genuinely ran. */
  unavailableReason: string | null;
}

/**
 * No sanctions data source is wired up in this build. This previously returned
 * isPassed:true unconditionally, so every party appeared to clear OFAC and BIS
 * screening without any list ever being consulted.
 */
export class ScreeningAgent {
  static async screenParty(partyName: string): Promise<ScreeningResult> {
    const subject = partyName.trim() ? `"${partyName.trim()}"` : "This party";
    return {
      status: "INDETERMINATE",
      isPassed: null,
      matchedParties: [],
      unavailableReason: `No sanctions screening provider is configured, so ${subject} has not been screened against OFAC, BIS, UN, EU or UK lists.`,
    };
  }
}
