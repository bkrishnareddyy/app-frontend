export interface ReleaseLogEntry {
  version: string;
  commit: string;
  date: string;
  summary: [string, string];
}

// Newest entry first. Add a new entry here whenever a notable set of
// changes is rolled out; the platform admin version pill reads this list.
export const RELEASE_LOG: ReleaseLogEntry[] = [
  {
    version: "0.1.1",
    commit: "current",
    date: "2026-08-10T00:00:00Z",
    summary: [
      "Moved deployment info from a header pill to a dedicated Deployments tab.",
      "Shows the currently deployed build plus rollout history, matching Accounts/HTS tabs.",
    ],
  },
  {
    version: "0.1.0",
    commit: "b3149ce",
    date: "2026-08-10T00:00:00Z",
    summary: [
      "Added platform admin version pill showing deployed build and rollout history.",
      "Merged latest changes from main, including the document preview rendering fix.",
    ],
  },
];

export const CURRENT_RELEASE = RELEASE_LOG[0];
