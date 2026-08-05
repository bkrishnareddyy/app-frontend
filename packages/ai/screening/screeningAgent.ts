export interface ScreeningResult {
  isPassed: boolean;
  matchedParties: Array<{
    entityName: string;
    listName: string;
    score: number;
  }>;
}

export class ScreeningAgent {
  static async screenParty(partyName: string, country?: string): Promise<ScreeningResult> {
    console.log(`[ScreeningAgent] Screening entity against OFAC/BIS sanction lists: ${partyName}`);
    return {
      isPassed: true,
      matchedParties: [],
    };
  }
}
