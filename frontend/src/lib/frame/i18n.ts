import { createTranslator } from "use-intl";
import type { Translator } from "@/lib/lang";
import { en } from "@/messages";

/** English frame text: what the server writes too (stored warnings), and the default where no translator is passed. */
export const enFrame: Translator<"frame"> = createTranslator({ locale: "en", messages: en, namespace: "frame" });
