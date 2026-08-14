import type { ReasonableCarePackage } from "./reasonableCarePackage";

/**
 * Generates printable HTML document for a Reasonable Care Package suitable for PDF conversion or print.
 */
export function generateReasonableCarePdfHtml(pkg: ReasonableCarePackage): string {
  const classificationRows = pkg.sections.classification
    .map(
      (c) => `
      <tr>
        <td>Line ${c.lineItemNumber}</td>
        <td><strong>${c.htsCode || "UNCLASSIFIED"}</strong></td>
        <td>${c.description}</td>
        <td>${c.griSteps.length ? c.griSteps.join("<br/>") : "None specified"}</td>
        <td>${c.approver || "System / Unapproved"}</td>
      </tr>
    `
    )
    .join("");

  const documentRows = pkg.sections.documents
    .map(
      (d) => `
      <tr>
        <td>${d.fileName}</td>
        <td>${d.docType}</td>
        <td>${d.status}</td>
        <td><code>${d.checksum || "N/A"}</code></td>
      </tr>
    `
    )
    .join("");

  const decisionRows = pkg.sections.decisions
    .map(
      (d) => `
      <tr>
        <td>${d.agentName}</td>
        <td>${d.status}</td>
        <td>${d.autoApproved ? "Auto-Approved" : "Manual Review"}</td>
        <td>${d.confidence != null ? `${d.confidence}%` : "N/A"}</td>
      </tr>
    `
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>CBP Reasonable Care Package - Entry ${pkg.entryNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 40px; color: #1e293b; line-height: 1.5; }
    h1 { font-size: 24px; color: #0f172a; margin-bottom: 4px; }
    .subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    .badge { display: inline-block; padding: 4px 12px; background: #e0f2fe; color: #0369a1; font-size: 12px; font-weight: 600; borderRadius: 4px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .card-title { font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-bottom: 8px; }
    .card-value { font-size: 16px; font-weight: 600; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; margin-bottom: 24px; font-size: 14px; }
    th { text-align: left; background: #f1f5f9; padding: 8px 12px; font-weight: 600; border-bottom: 2px solid #cbd5e1; }
    td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .section-header { font-size: 18px; font-weight: 600; color: #0f172a; margin-top: 24px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
  </style>
</head>
<body>
  <h1>CBP Reasonable Care Package</h1>
  <div class="subtitle">Entry Number: ${pkg.entryNumber} | Generated: ${pkg.generatedAt}</div>
  
  <div class="grid">
    <div class="card">
      <div class="card-title">Importer of Record</div>
      <div class="card-value">${pkg.importerOfRecord.name || "N/A"}</div>
      <div>CBP Importer Number: ${pkg.importerOfRecord.cbpNumber || "None on file"}</div>
    </div>
    <div class="card">
      <div class="card-title">Compliance Score</div>
      <div class="card-value">${pkg.completenessScore}% Completeness</div>
      <div>Status: Verified Evidence Trail</div>
    </div>
  </div>

  <div class="section-header">1. HTS Classification & Reasoning</div>
  <table>
    <thead>
      <tr>
        <th>Line</th>
        <th>HTS Code</th>
        <th>Description</th>
        <th>GRI Reasoning</th>
        <th>Reviewer / Approver</th>
      </tr>
    </thead>
    <tbody>
      ${classificationRows || '<tr><td colspan="5">No classification records.</td></tr>'}
    </tbody>
  </table>

  <div class="section-header">2. Customs Valuation Summary</div>
  <div class="card" style="margin-top: 12px;">
    <div>Declared Customs Value: <strong>$${pkg.sections.valuation.declaredCustomsValue.toLocaleString()} USD</strong></div>
    <div>Assists Total: ${pkg.sections.valuation.assistsTotal != null ? `$${pkg.sections.valuation.assistsTotal.toLocaleString()}` : "None recorded"}</div>
    <div>Related Party Transaction: ${pkg.sections.valuation.relatedPartyFlag ? "Yes" : "No"}</div>
  </div>

  <div class="section-header">3. Associated Verification Documents</div>
  <table>
    <thead>
      <tr>
        <th>File Name</th>
        <th>Document Type</th>
        <th>Status</th>
        <th>SHA-256 Checksum</th>
      </tr>
    </thead>
    <tbody>
      ${documentRows || '<tr><td colspan="4">No documents attached.</td></tr>'}
    </tbody>
  </table>

  <div class="section-header">4. System & Agent Audit Trail</div>
  <table>
    <thead>
      <tr>
        <th>Agent / Processor</th>
        <th>Status</th>
        <th>Approval Mode</th>
        <th>Confidence</th>
      </tr>
    </thead>
    <tbody>
      ${decisionRows || '<tr><td colspan="4">No agent decisions logged.</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;
}
