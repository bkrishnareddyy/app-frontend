# Multi-Currency Filing Design

## Status

Implemented contract for shipment-based customs filings.

## Design Principles

1. Commercial invoice value and customs valuation value are different financial facts.
2. Qubere never changes the currency label on an amount without converting the amount.
3. Qubere never overwrites original commercial values during customs conversion.
4. Exchange-rate information is filing-specific and auditable.
5. Cross-currency filing requires an explicit positive rate, rate source, and effective date.
6. Qubere does not silently use a generic market FX quote for customs valuation.
7. The exact conversion context used for transmission is frozen in `FilingSnapshot.snapshotData`.

## Currency Terms

### Commercial Currency

The currency of the commercial invoice and source line-item values.

Example:

- Invoice amount: 10,000
- Commercial currency: EUR

### Customs Valuation Currency

The currency in which the customs authority expects customs value and duty calculations.

Example for a US filing:

- Customs valuation currency: USD

### Exchange Rate

`exchangeRate` is defined as:

> customs-currency units per 1 commercial-currency unit

Example:

- Commercial currency: EUR
- Customs currency: USD
- Exchange rate: 1.1642
- EUR 10,000 commercial value becomes USD 11,642 customs value

## Filing Currency Context

The filing stores the working currency context before submission and freezes the same facts into the immutable filing snapshot:

```ts
{
  commercialCurrency: "EUR",
  customsCurrency: "USD",
  exchangeRate: 1.1642,
  exchangeRateSource: "CBP WEEKLY RATE",
  exchangeRateEffectiveDate: "2026-08-17T00:00:00.000Z"
}
```

For a same-currency filing:

```ts
{
  commercialCurrency: "USD",
  customsCurrency: "USD",
  exchangeRate: 1,
  exchangeRateSource: "IDENTITY",
  exchangeRateEffectiveDate: "..."
}
```

## Calculation Flow

```text
Original commercial line items
          │
          ├── remain unchanged ───────────────→ Canonical InvoiceAmount / InvoiceCurrency
          │
          └── apply frozen filing FX rate
                         │
                         ↓
                Customs-value line copies
                         │
                         ↓
                    Tariff engine
                         │
                         ↓
              Customs value / duty / fees
```

### Example

Original line:

```text
Quantity: 2
Unit price: EUR 5,000
Total: EUR 10,000
```

Filing FX context:

```text
EUR → USD = 1.1642
Source = CBP WEEKLY RATE
Effective date = 2026-08-17
```

Canonical commercial declaration:

```text
InvoiceAmount = 10,000
InvoiceCurrency = EUR
```

Tariff calculation input:

```text
Unit price = USD 5,821
Total = USD 11,642
```

The EUR values remain in the snapshot and are never replaced by USD values.

## Filing Snapshot Contract

`FilingSnapshot.snapshotData` freezes:

- Original shipment data
- Original commercial line values
- `commercialCurrency`
- `customsCurrency`
- `exchangeRate`
- `exchangeRateSource`
- `exchangeRateEffectiveDate`
- Original commercial total
- Converted customs value total
- Calculated duty/tax/fee totals

This is necessary so an auditor can reproduce the filed customs value even if exchange rates or shipment data change later.

## Canonical Declaration Mapping

### Import

`ImportDeclaration.GoodsDeclaration.InvoiceAmount`

Uses the original commercial invoice total.

`ImportDeclaration.GoodsDeclaration.InvoiceCurrency`

Uses `FilingSnapshot.currency.commercialCurrency`.

`GoodsItem[].InvoiceLineValue`

Uses the original commercial line value.

`GoodsItem[].CustomsValuation.ChargeableAmount`

Uses the converted customs-value amount from the tariff engine.

### Export

The same commercial-vs-customs separation applies to `ExportDeclaration`.

## API

### GET `/api/filing/:id/currency`

Returns the current filing currency context.

### PATCH `/api/filing/:id/currency`

Accepts:

```json
{
  "commercialCurrency": "EUR",
  "customsCurrency": "USD",
  "exchangeRate": 1.1642,
  "exchangeRateSource": "CBP WEEKLY RATE",
  "exchangeRateEffectiveDate": "2026-08-17T00:00:00.000Z"
}
```

Cross-currency filings reject missing rate/source/effective date.

Currency configuration is locked after submission except in explicitly editable correction/rejection states.

## UI

The filing workspace includes **Filing Currency & Customs Valuation**.

The broker can configure:

- Commercial/invoice currency
- Customs valuation currency
- Exchange rate
- Rate source
- Effective date

The FX controls are shown when commercial and customs currencies differ.

## Auditability

Every currency configuration change creates a `CustomsFiling` audit entry containing the complete currency context.

At submission, the same context is frozen into the filing snapshot and the outbound canonical declaration is generated from that snapshot.

The system therefore supports the audit question:

> Why was EUR 10,000 declared as USD 11,642 for customs value?

with:

- Original value: EUR 10,000
- Rate: 1.1642 USD/EUR
- Source: CBP WEEKLY RATE
- Effective date: 2026-08-17
- Converted value: USD 11,642

## Backward Compatibility

Existing filings with no stored currency context are treated as same-currency filings using the known customs valuation currency for the filing jurisdiction. No conversion is performed.

Legacy `dutyBreakdown` arrays remain readable. When currency metadata is added, Qubere normalizes the JSON to:

```json
{
  "fees": [],
  "currencyContext": {}
}
```

Standalone filings continue to use their stored canonical declaration draft; shipment-based filings use the currency conversion workflow described above.

## Non-Goals

This implementation does not:

- Fetch live consumer/market FX rates.
- Guess the legally applicable customs exchange rate.
- Implement every jurisdiction's tax/duty engine.
- Convert historical filed values using today's rate.

Jurisdiction-specific authoritative FX feeds can be added later behind a provider interface, but any fetched rate must still persist its source, publication/effective date, and exact value before use.
