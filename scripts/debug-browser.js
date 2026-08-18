/**
 * Debug script to see what's in the browser's React state
 */
console.log("=== Filing Data Debug ===");
console.log("Run this in browser console on the filing detail page");
console.log("");
console.log("1. Check if declarationDraft exists:");
console.log("   Look in React DevTools > Components > FilingDetailClient > props > filing.declarationDraft");
console.log("");
console.log("2. Check declarationData state:");
console.log("   Look in React DevTools > Components > FilingDetailClient > hooks > declarationData");
console.log("");
console.log("3. Expected structure:");
console.log("   declarationData should contain:");
console.log("   { GoodsDeclaration: { ReferenceNumber: 'LRN_IMP_002', ... } }");
