/** Extensible currency catalogue: a curated list (with African and major trading currencies first) merged with every ISO-4217 code the runtime knows. */
export interface Currency { code: string; name: string; symbol: string; decimals: number }
const C = (code: string, name: string, symbol: string, decimals = 2): Currency => ({ code, name, symbol, decimals });
export const CURATED: Currency[] = [
  C("GHS", "Ghana Cedi", "GH₵"), C("USD", "US Dollar", "$"), C("EUR", "Euro", "€"), C("GBP", "British Pound", "£"), C("NGN", "Nigerian Naira", "₦"), C("ZAR", "South African Rand", "R"),
  C("CAD", "Canadian Dollar", "CA$"), C("AUD", "Australian Dollar", "A$"), C("AED", "UAE Dirham", "د.إ"), C("CNY", "Chinese Yuan", "CN¥"), C("JPY", "Japanese Yen", "¥", 0),
  C("XOF", "West African CFA Franc", "CFA", 0), C("XAF", "Central African CFA Franc", "FCFA", 0), C("KES", "Kenyan Shilling", "KSh"), C("UGX", "Ugandan Shilling", "USh", 0), C("TZS", "Tanzanian Shilling", "TSh"),
  C("RWF", "Rwandan Franc", "RF", 0), C("EGP", "Egyptian Pound", "E£"), C("MAD", "Moroccan Dirham", "MAD"), C("ETB", "Ethiopian Birr", "Br"), C("ZMW", "Zambian Kwacha", "ZK"), C("BWP", "Botswana Pula", "P"),
  C("INR", "Indian Rupee", "₹"), C("BRL", "Brazilian Real", "R$"), C("MXN", "Mexican Peso", "MX$"), C("CHF", "Swiss Franc", "CHF"), C("SEK", "Swedish Krona", "kr"), C("NOK", "Norwegian Krone", "kr"),
  C("DKK", "Danish Krone", "kr"), C("NZD", "New Zealand Dollar", "NZ$"), C("SGD", "Singapore Dollar", "S$"), C("HKD", "Hong Kong Dollar", "HK$"), C("SAR", "Saudi Riyal", "SAR"), C("QAR", "Qatari Riyal", "QAR"),
  C("TRY", "Turkish Lira", "₺"), C("KRW", "South Korean Won", "₩", 0), C("PLN", "Polish Zloty", "zł"), C("THB", "Thai Baht", "฿"), C("MYR", "Malaysian Ringgit", "RM"), C("IDR", "Indonesian Rupiah", "Rp"),
];
const ZERO = new Set(["JPY", "KRW", "UGX", "RWF", "XOF", "XAF", "VND", "CLP", "PYG", "ISK", "KMF", "GNF", "DJF", "BIF", "VUV", "XPF"]);

export function catalogue(): Currency[] {
  const out = new Map(CURATED.map((c) => [c.code, c]));
  try {
    const codes: string[] = (Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf("currency") : [];
    const names = new Intl.DisplayNames(["en"], { type: "currency" });
    for (const code of codes) if (!out.has(code)) {
      let symbol = code;
      try { symbol = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? code; } catch { /* keep code */ }
      out.set(code, { code, name: names.of(code) ?? code, symbol, decimals: ZERO.has(code) ? 0 : 2 });
    }
  } catch { /* the curated list alone is still complete for the listed currencies */ }
  return [...out.values()];
}
export const isKnownCurrency = (code: string) => catalogue().some((c) => c.code === code);
