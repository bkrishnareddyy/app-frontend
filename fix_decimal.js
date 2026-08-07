const fs = require('fs');

const files = [
  'src/app/api/compliance/audits/run/route.ts',
  'src/app/api/dashboard/route.ts',
  'src/app/api/filing/[id]/route.ts',
  'src/app/api/filing/[id]/validate/route.ts',
  'src/app/api/filing/route.ts',
  'src/app/api/refunds/opportunities/scan/route.ts',
  'src/app/api/refunds/psc/[id]/route.ts',
  'src/app/api/simulator/compare/route.ts',
  'src/app/api/simulator/scenarios/[id]/calculate/route.ts',
  'src/app/api/simulator/scenarios/[id]/line-items/route.ts',
  'src/app/app/shipments/[id]/page.tsx',
  'src/lib/tariff/dutyEngine.ts',
  'src/modules/drawback/drawback.service.ts',
  'src/modules/filings/filing.service.ts'
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  // Simple regex fixes for common decimal issues
  content = content.replace(/filing\.totalDuties \*/g, 'Number(filing.totalDuties) *');
  content = content.replace(/filing\.totalValue \*/g, 'Number(filing.totalValue) *');
  content = content.replace(/filing\.totalDuties\.toFixed/g, 'Number(filing.totalDuties).toFixed');
  content = content.replace(/filing\.totalDuties \+/g, 'Number(filing.totalDuties) +');
  content = content.replace(/filing\.totalTaxes \+/g, 'Number(filing.totalTaxes) +');
  content = content.replace(/item\.unitValue \*/g, 'Number(item.unitValue) *');
  content = content.replace(/item\.quantity \*/g, 'Number(item.quantity) *');
  content = content.replace(/li\.unitPrice \*/g, 'Number(li.unitPrice) *');
  content = content.replace(/li\.totalValue/g, 'Number(li.totalValue)');
  content = content.replace(/item\.unitPrice \*/g, 'Number(item.unitPrice) *');
  content = content.replace(/item\.totalValue/g, 'Number(item.totalValue)');
  content = content.replace(/existingPsc\.originalDutyAmount -/g, 'Number(existingPsc.originalDutyAmount) -');
  content = content.replace(/scenario\.computedDuty \+/g, 'Number(scenario.computedDuty) +');
  content = content.replace(/scenario\.computedFees \+/g, 'Number(scenario.computedFees) +');
  content = content.replace(/scenario\.computedLandedCost/g, 'Number(scenario.computedLandedCost)');
  content = content.replace(/scenario\.freightCost/g, 'Number(scenario.freightCost)');
  content = content.replace(/scenario\.insuranceCost/g, 'Number(scenario.insuranceCost)');
  content = content.replace(/metrics\.totalUSVolumeVal/g, 'Number(metrics.totalUSVolumeVal)');
  content = content.replace(/metrics\.avgDeclaredPrice/g, 'Number(metrics.avgDeclaredPrice)');
  content = content.replace(/c\.totalAmount/g, 'Number(c.totalAmount)');
  content = content.replace(/c\.totalValue/g, 'Number(c.totalValue)');
  content = content.replace(/f\.totalDuties/g, 'Number(f.totalDuties)');
  content = content.replace(/f\.totalValue/g, 'Number(f.totalValue)');
  content = content.replace(/f\.totalTaxes/g, 'Number(f.totalTaxes)');
  content = content.replace(/f\.totalAmount/g, 'Number(f.totalAmount)');
  content = content.replace(/match\.dutyAttributed/g, 'Number(match.dutyAttributed)');
  content = content.replace(/filing\.totalAmount/g, 'Number(filing.totalAmount)');
  content = content.replace(/filing\.totalValue/g, 'Number(filing.totalValue)');
  content = content.replace(/existingPsc\.correctedDutyAmount/g, 'Number(existingPsc.correctedDutyAmount)');
  content = content.replace(/item\.computedDuty/g, 'Number(item.computedDuty)');
  content = content.replace(/item\.computedFees/g, 'Number(item.computedFees)');
  content = content.replace(/item\.computedLandedCost/g, 'Number(item.computedLandedCost)');
  content = content.replace(/item\.freightCost/g, 'Number(item.freightCost)');
  content = content.replace(/item\.insuranceCost/g, 'Number(item.insuranceCost)');
  content = content.replace(/lineItem\.totalValue/g, 'Number(lineItem.totalValue)');
  content = content.replace(/lineItem\.unitPrice/g, 'Number(lineItem.unitPrice)');
  
  fs.writeFileSync(file, content);
}
console.log('Applied Decimal fixes');
