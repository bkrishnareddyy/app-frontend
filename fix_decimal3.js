const fs = require('fs');

function fix(file, regex, replacement) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(regex, replacement);
    fs.writeFileSync(file, content);
  }
}

// 1. Dashboard
fix('src/app/api/dashboard/route.ts', /metrics\.totalUSVolumeVal \+ f\.totalValue/g, 'Number(metrics.totalUSVolumeVal) + Number(f.totalValue)');

// 2. Filing route
fix('src/app/api/filing/route.ts', /filing\.totalAmount \+ f\.totalAmount/g, 'Number(filing.totalAmount) + Number(f.totalAmount)');
fix('src/app/api/filing/route.ts', /filing\.totalDuties \+ /g, 'Number(filing.totalDuties) + ');
fix('src/app/api/filing/route.ts', /filing\.totalTaxes \+ /g, 'Number(filing.totalTaxes) + ');
fix('src/app/api/filing/route.ts', /filing\.totalValue \+ /g, 'Number(filing.totalValue) + ');
fix('src/app/api/filing/route.ts', /item\.unitPrice \* item\.quantity/g, 'Number(item.unitPrice) * Number(item.quantity)');
fix('src/app/api/filing/route.ts', /c\.totalValue \+ /g, 'Number(c.totalValue) + ');
fix('src/app/api/filing/route.ts', /c\.totalAmount \+ /g, 'Number(c.totalAmount) + ');

// 3. Simulator compare
fix('src/app/api/simulator/compare/route.ts', /scenario\.computedDuty \+ item\.computedDuty/g, 'Number(scenario.computedDuty) + Number(item.computedDuty)');
fix('src/app/api/simulator/compare/route.ts', /scenario\.computedFees \+ item\.computedFees/g, 'Number(scenario.computedFees) + Number(item.computedFees)');
fix('src/app/api/simulator/compare/route.ts', /scenario\.freightCost \+ item\.freightCost/g, 'Number(scenario.freightCost) + Number(item.freightCost)');
fix('src/app/api/simulator/compare/route.ts', /scenario\.insuranceCost \+ item\.insuranceCost/g, 'Number(scenario.insuranceCost) + Number(item.insuranceCost)');
fix('src/app/api/simulator/compare/route.ts', /scenario\.computedLandedCost \+ item\.computedLandedCost/g, 'Number(scenario.computedLandedCost) + Number(item.computedLandedCost)');

// 4. Simulator calculate
fix('src/app/api/simulator/scenarios/[id]/calculate/route.ts', /item\.unitValue \* item\.quantity/g, 'Number(item.unitValue) * Number(item.quantity)');
fix('src/app/api/simulator/scenarios/[id]/calculate/route.ts', /scenario\.freightCost \+ scenario\.insuranceCost/g, 'Number(scenario.freightCost) + Number(scenario.insuranceCost)');
fix('src/app/api/simulator/scenarios/[id]/calculate/route.ts', /item\.totalValue \* /g, 'Number(item.totalValue) * ');
fix('src/app/api/simulator/scenarios/[id]/calculate/route.ts', /item\.totalValue \+ item\.computedDuty \+ item\.computedFees/g, 'Number(item.totalValue) + Number(item.computedDuty) + Number(item.computedFees)');
fix('src/app/api/simulator/scenarios/[id]/calculate/route.ts', /scenario\.computedDuty \+ scenario\.computedFees/g, 'Number(scenario.computedDuty) + Number(scenario.computedFees)');

// 5. Simulator line items
fix('src/app/api/simulator/scenarios/[id]/line-items/route.ts', /li\.unitPrice \* li\.quantity/g, 'Number(li.unitPrice) * Number(li.quantity)');
fix('src/app/api/simulator/scenarios/[id]/line-items/route.ts', /li\.totalValue \* /g, 'Number(li.totalValue) * ');

// 6. Shipments page
fix('src/app/app/shipments/[id]/page.tsx', /shipment\.totalDuties \+ shipment\.totalTaxes/g, 'Number(shipment.totalDuties) + Number(shipment.totalTaxes)');
fix('src/app/app/shipments/[id]/page.tsx', /shipment\.totalDuties \+ /g, 'Number(shipment.totalDuties) + ');
fix('src/app/app/shipments/[id]/page.tsx', /lineItem\.unitPrice \* lineItem\.quantity/g, 'Number(lineItem.unitPrice) * Number(lineItem.quantity)');
fix('src/app/app/shipments/[id]/page.tsx', /item\.unitPrice \* item\.quantity/g, 'Number(item.unitPrice) * Number(item.quantity)');
fix('src/app/app/shipments/[id]/page.tsx', /li\.unitPrice \* li\.quantity/g, 'Number(li.unitPrice) * Number(li.quantity)');
fix('src/app/app/shipments/[id]/page.tsx', /\{shipment.totalDuties \+ shipment.totalTaxes\}/g, '{Number(shipment.totalDuties) + Number(shipment.totalTaxes)}');
fix('src/app/app/shipments/[id]/page.tsx', /\(shipment.totalDuties \+ shipment.totalTaxes\)/g, '(Number(shipment.totalDuties) + Number(shipment.totalTaxes))');

// 7. Tariff dutyEngine
fix('src/lib/tariff/dutyEngine.ts', /item\.totalValue \* \(generalRate /g, 'Number(item.totalValue) * (Number(generalRate) ');
fix('src/lib/tariff/dutyEngine.ts', /item\.totalValue \* \(generalRate \/ 100\)/g, 'Number(item.totalValue) * (Number(generalRate) / 100)');
fix('src/lib/tariff/dutyEngine.ts', /item\.totalValue \* \(dutyRate \/ 100\)/g, 'Number(item.totalValue) * (Number(dutyRate) / 100)');
fix('src/lib/tariff/dutyEngine.ts', /item\.totalValue \* \(mpfRate \/ 100\)/g, 'Number(item.totalValue) * (Number(mpfRate) / 100)');
fix('src/lib/tariff/dutyEngine.ts', /item\.totalValue \* \(hmfRate \/ 100\)/g, 'Number(item.totalValue) * (Number(hmfRate) / 100)');


// 8. Drawback service
fix('src/modules/drawback/drawback.service.ts', /existingPsc\.originalDutyAmount - existingPsc\.correctedDutyAmount/g, 'Number(existingPsc.originalDutyAmount) - Number(existingPsc.correctedDutyAmount)');
fix('src/modules/drawback/drawback.service.ts', /match\.dutyAttributed \*/g, 'Number(match.dutyAttributed) *');

// 9. Filing service
fix('src/modules/filings/filing.service.ts', /c\.totalDuties \+ match\.dutyAttributed/g, 'Number(c.totalDuties) + Number(match.dutyAttributed)');
fix('src/modules/filings/filing.service.ts', /match\.dutyAttributed \/ filing\.totalDuties/g, 'Number(match.dutyAttributed) / Number(filing.totalDuties)');

console.log('Fixed typescript errors round 3');
