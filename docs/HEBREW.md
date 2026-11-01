# Hebrew interface

The app runs in English or Hebrew (`prefs.lang`). This page covers how strings are written in code and which Hebrew words to use, so every screen speaks the same Hebrew.

## In code

- Strings live in `frontend/src/messages/{en,he}/<area>.json`, one file per area. `messages/index.ts` combines them. A Hebrew file that is missing a key fails `tsc`.
- In components, use `const t = useTranslations("<area>")` from `use-intl`, then `t("key")` or `t("key", { n })`.
- For text with markup, use `t.rich("key", { b: (c) => <b>{c}</b> })`.
- For code outside components (`lib/`), pass a translator in, typed `Translator<"area">` (from `lib/lang.tsx`). Tests build one with `createTranslator({ locale: "en", messages: en, namespace: "area" })`.
- Plurals use ICU, never `plural()`:
  - English: `{n, plural, one {# part} other {# parts}}`
  - Hebrew: `{n, plural, one {חלק אחד} two {שני חלקים} other {# חלקים}}`

  Hebrew has its own form for exactly two. Use it where it reads naturally; otherwise leave it out and `other` covers 2.
- A measurement inside text ("1800 × 800 mm", "3.0 m") goes in `<Ltr>` so it keeps its order in Hebrew. The Hebrew message can't hold JSX, so render the measurement as its own element or pass it through `t.rich`.
- Dates and numbers use `dateLocale(lang)` / `numberLocale(lang)` from `lib/lang.tsx`, with `lang = useLocale()`. English keeps "1 Nov 2026" and 1,234.5.
- Leave these as they are:
  - user content (names of projects, parts, sketches);
  - catalog item names (they have their own `.he`);
  - text from the API;
  - shortcut letters (Hebrew keyboards map to them);
  - units (`mm`, `cm`, `m`), since people type them;
  - the name Woodchunk.
- Default names the app gives new things (for example "Sketch 1" or "Part") are written in the app's language when created.
- English wording must not change: move each string into `en/*.json` exactly as it was.

## Hebrew style

- **Gender-neutral.**
  - Buttons and menu items use the verbal noun: "הוספת חלק", "שמירה", "מחיקה".
  - Instructions use the plural imperative: "ציירו קו", "לחצו פעמיים".
  - Never use the masculine singular imperative ("הוסף", "לחץ").
- **Short.** Keep to the English length or shorter; buttons and chips have little room.
- **Punctuation.** Use gershayim and geresh (סה״כ, מ״מ, דק׳) and maqaf (ב־). Use Western digits.
- **Tone.** Plain and friendly, like the English. Don't add politeness the English doesn't have.

## Glossary

| English | עברית | Notes |
|---|---|---|
| Project | פרויקט | |
| Catalog | קטלוג | |
| Template | תבנית | |
| Inventory | מלאי | "from your inventory": מהמלאי שלך |
| Build (tab) | בנייה | Project tabs: בנייה · קנייה · דף עבודה |
| Buy (tab) | קנייה | |
| Shop sheet | דף עבודה | |
| Shopping list | רשימת קניות | |
| Assembly | מכלול | |
| Part | חלק | |
| Material | חומר | |
| Lumber | עץ | as a category; one board is קרש |
| Board | קרש | |
| Sheet (plywood) | לוח | |
| Hardware | פרזול | |
| Supplier | ספק | |
| Price | מחיר | |
| Quantity / Qty | כמות | |
| Length | אורך | |
| Width | רוחב | |
| Thickness | עובי | |
| Stock length | אורך סטנדרטי | |
| Cutting plan | תוכנית חיתוך | |
| Cut order | סדר חיתוך | |
| Cut | חיתוך | |
| Rip (cut) | חיתוך לאורך | |
| Crosscut | חיתוך לרוחב | |
| Saw width / kerf | עובי מסור | |
| Offcut | שארית | |
| Waste | פחת | |
| Grain | כיוון סיבים | |
| Label | תווית | |
| Sketch | סקיצה | |
| Line | קו | |
| Rectangle | מלבן | |
| Circle | עיגול | |
| Arc | קשת | |
| Point | נקודה | |
| Midpoint | נקודת אמצע | |
| Helper line | קו עזר | (construction line) |
| Dimension | מידה | as a verb: מתן מידה |
| Relation | קשר | |
| Horizontal | אופקי | |
| Vertical | אנכי | |
| Parallel | מקביל | |
| Perpendicular | ניצב | |
| Equal | שווה | |
| Coincident | מתלכדות | (points) |
| Collinear | על אותו ישר | |
| Symmetric | סימטרי | |
| Tangent | משיק | |
| Concentric | בעלי מרכז משותף | |
| Fixed / pinned | מקובע | |
| Fully defined | מוגדר במלואו | |
| Driven (worked out) | מחושב | |
| Measure | מדידה | |
| Angle | זווית | |
| Grid | רשת | |
| Snap | הצמדה | |
| Fit to view | התאמה לתצוגה | |
| Select | בחירה | |
| Frame (3D) | מסגרת | |
| Bar / member | מוט | |
| Joint | חיבור | |
| Miter | חיתוך זוויתי | |
| Bevel | שיפוע | |
| Steel | פלדה | |
| Wood | עץ | |
| Undo / Redo | ביטול / ביצוע מחדש | |
| Save / Saved / Saving | שמירה / נשמר / שומר… | |
| Delete | מחיקה | |
| Cancel | ביטול | |
| Done | סיום | |
| Close | סגירה | |
| Share | שיתוף | |
| Settings | הגדרות | |
| Sign in / Sign out | כניסה / התנתקות | |
| Admin | ניהול | |
| Ask (AI) | שאלה | the AI panel: "שאלו את Woodchunk" |
| Describe it | תיאור | |
| Archive / Archived | העברה לארכיון / בארכיון | |
| Owner / Editor / Viewer | בעלים / עורך / צופה | |
