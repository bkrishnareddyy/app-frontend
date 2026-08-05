export type AccountType = "ENTERPRISE" | "INDIVIDUAL";

export type AccountStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";

export type MembershipStatus = "ACTIVE" | "INACTIVE" | "DISABLED";

export type SystemRoleName = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export interface AccountDTO {
  id: string;
  name: string;
  slug: string;
  type: AccountType;
  status: AccountStatus;
  ownerUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDTO {
  id: string;
  clerkUserId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: Date;
}

export interface MembershipDTO {
  id: string;
  accountId: string;
  userId: string;
  roleId: string;
  status: MembershipStatus;
  roleName: string;
}

export interface AuditLogDTO {
  id: string;
  accountId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  success: boolean;
  createdAt: Date;
}

// Phase 2 Trade AI Agent Job Contracts
export interface DocumentProcessingJob {
  jobId: string;
  documentId: string;
  accountId: string;
  fileUrl: string;
  status: "QUEUED" | "PARSING_OCR" | "EXTRACTING_FIELDS" | "CLASSIFYING_HTS" | "SCREENING_SANCTIONS" | "COMPLETED" | "FAILED";
  confidenceScore?: number;
  results?: {
    lineItems?: Array<{
      description: string;
      unitPrice: number;
      quantity: number;
      suggestedHtsCode?: string;
      confidence?: number;
    }>;
    sanctionMatches?: string[];
  };
}
