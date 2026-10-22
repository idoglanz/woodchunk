/** Words used on exports (shopping list, shop sheet). The app UI itself is English. */
export type Lang = "en" | "he";

const WORDS = {
  en: {
    shoppingList: "Shopping list", shopSheet: "Shop sheet", total: "Total", subtotal: "Subtotal", lumber: "Lumber",
    sheets: "Sheets", hardware: "Hardware", parts: "Parts", buy: "Buy", board: "Board", sheet: "Sheet", cutOrder: "Cut order",
    rip: "Rip", crosscut: "Crosscut", at: "at", offcut: "Offcut", waste: "waste", kerf: "Saw width", label: "Label",
    part: "Part", qty: "Qty", length: "Length", width: "Width", material: "Material", assembly: "Assembly",
    pickedUp: "picked up", grain: "Grain", fromWorkshop: "From your workshop", alreadyBought: "Already bought", each: "each",
    printed: "Printed", supplier: "Supplier", keep: "keep", cuts: "Cuts", piece: "piece",
  },
  he: {
    shoppingList: "רשימת קניות", shopSheet: "דף עבודה", total: "סה״כ", subtotal: "ביניים", lumber: "עץ", sheets: "לוחות",
    hardware: "פרזול", parts: "חלקים", buy: "לקנות", board: "קרש", sheet: "לוח", cutOrder: "סדר חיתוך", rip: "חיתוך לאורך",
    crosscut: "חיתוך לרוחב", at: "ב־", offcut: "שארית", waste: "פחת", kerf: "עובי מסור", label: "תווית", part: "חלק",
    qty: "כמות", length: "אורך", width: "רוחב", material: "חומר", assembly: "מכלול", pickedUp: "נאספו", grain: "כיוון סיבים",
    fromWorkshop: "מהמחסן שלך", alreadyBought: "כבר נקנה", each: "יחידה", printed: "הודפס", supplier: "ספק", keep: "לשמור",
    cuts: "חיתוכים", piece: "חתיכה",
  },
} as const;

export type WordKey = keyof (typeof WORDS)["en"];

export function t(lang: Lang, key: WordKey): string {
  return WORDS[lang][key];
}

export function dirOf(lang: Lang): "rtl" | "ltr" {
  return lang === "he" ? "rtl" : "ltr";
}
