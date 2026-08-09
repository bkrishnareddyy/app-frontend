"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { en, TranslationKeys } from "./dictionaries/en";
import { es } from "./dictionaries/es";

export type Locale = "en" | "es" | "zh" | "de" | "ja" | "fr" | "pt";

export interface CountryConfig {
  code: string;
  name: string;
  flag: string;
  defaultLocale: Locale;
  languageName: string;
  regionalTariffAuthority: string;
}

export const COUNTRIES: CountryConfig[] = [
  { code: "US", name: "United States", flag: "🇺🇸", defaultLocale: "en", languageName: "English (US)", regionalTariffAuthority: "US Customs & Border Protection (CBP)" },
  { code: "MX", name: "Mexico", flag: "🇲🇽", defaultLocale: "es", languageName: "Español (México)", regionalTariffAuthority: "Agencia Nacional de Aduanas de México (ANAM)" },
  { code: "ES", name: "Spain", flag: "🇪🇸", defaultLocale: "es", languageName: "Español (España)", regionalTariffAuthority: "Agencia Tributaria - Aduanas" },
  { code: "CN", name: "China", flag: "🇨🇳", defaultLocale: "zh", languageName: "Mandarin (简体中文)", regionalTariffAuthority: "General Administration of Customs China (GACC)" },
  { code: "DE", name: "Germany", flag: "🇩🇪", defaultLocale: "de", languageName: "German (Deutsch)", regionalTariffAuthority: "Bundeszollverwaltung (German Customs)" },
  { code: "JP", name: "Japan", flag: "🇯🇵", defaultLocale: "ja", languageName: "Japanese (日本語)", regionalTariffAuthority: "Japan Customs (財務省関税局)" },
  { code: "FR", name: "France", flag: "🇫🇷", defaultLocale: "fr", languageName: "French (Français)", regionalTariffAuthority: "Douanes Françaises (DGDDI)" },
  { code: "BR", name: "Brazil", flag: "🇧🇷", defaultLocale: "pt", languageName: "Portuguese (Português)", regionalTariffAuthority: "Receita Federal do Brasil" },
  { code: "CA", name: "Canada", flag: "🇨🇦", defaultLocale: "en", languageName: "English / French (Canada)", regionalTariffAuthority: "Canada Border Services Agency (CBSA)" },
];

interface LanguageContextType {
  locale: Locale;
  country: CountryConfig;
  setCountryByCode: (countryCode: string) => void;
  setLocale: (locale: Locale) => void;
  t: TranslationKeys;
}

const LanguageContext = createContext<LanguageContextType>({
  locale: "en",
  country: COUNTRIES[0],
  setCountryByCode: () => {},
  setLocale: () => {},
  t: en,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [country, setCountryState] = useState<CountryConfig>(COUNTRIES[0]);

  // localStorage is unreadable during SSR, so the saved locale can only be applied
  // after mount. Reading it in a lazy initializer would desync hydration.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const savedCountry = localStorage.getItem("qubere_country_code");
    if (savedCountry) {
      const matched = COUNTRIES.find((c) => c.code === savedCountry);
      if (matched) {
        setCountryState(matched);
      }
    }

    const savedLocale = localStorage.getItem("qubere_locale") as Locale | null;
    if (savedLocale && ["en", "es", "zh", "de", "ja", "fr", "pt"].includes(savedLocale)) {
      setLocaleState(savedLocale);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const setCountryByCode = (countryCode: string) => {
    const matched = COUNTRIES.find((c) => c.code === countryCode) || COUNTRIES[0];
    setCountryState(matched);
    setLocaleState(matched.defaultLocale);

    localStorage.setItem("qubere_country_code", matched.code);
    localStorage.setItem("qubere_locale", matched.defaultLocale);
    document.cookie = `NEXT_COUNTRY=${matched.code}; path=/; max-age=31536000`;
    document.cookie = `NEXT_LOCALE=${matched.defaultLocale}; path=/; max-age=31536000`;
  };

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("qubere_locale", newLocale);
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000`;
  };

  // Resolve dictionary (falls back to Spanish or English)
  const t = locale === "es" ? es : en;

  return (
    <LanguageContext.Provider value={{ locale, country, setCountryByCode, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
