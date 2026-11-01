// One file per area of the app, so areas can be translated side by side.
// Every English message needs its Hebrew: lib/lang.tsx checks that at compile time.

import enCommon from "./en/common.json";
import enNav from "./en/nav.json";
import enSettings from "./en/settings.json";
import enHome from "./en/home.json";
import enCatalog from "./en/catalog.json";
import enAdmin from "./en/admin.json";
import enPages from "./en/pages.json";
import enSignIn from "./en/signIn.json";
import enUi from "./en/ui.json";
import enProject from "./en/project.json";
import enPlan from "./en/plan.json";
import enSketch from "./en/sketch.json";
import enFrame from "./en/frame.json";
import heCommon from "./he/common.json";
import heNav from "./he/nav.json";
import heSettings from "./he/settings.json";
import heHome from "./he/home.json";
import heCatalog from "./he/catalog.json";
import heAdmin from "./he/admin.json";
import hePages from "./he/pages.json";
import heSignIn from "./he/signIn.json";
import heUi from "./he/ui.json";
import heProject from "./he/project.json";
import hePlan from "./he/plan.json";
import heSketch from "./he/sketch.json";
import heFrame from "./he/frame.json";

export const en = {
  common: enCommon,
  nav: enNav,
  settings: enSettings,
  home: enHome,
  catalog: enCatalog,
  admin: enAdmin,
  pages: enPages,
  signIn: enSignIn,
  ui: enUi,
  project: enProject,
  plan: enPlan,
  sketch: enSketch,
  frame: enFrame,
};
export const he = {
  common: heCommon,
  nav: heNav,
  settings: heSettings,
  home: heHome,
  catalog: heCatalog,
  admin: heAdmin,
  pages: hePages,
  signIn: heSignIn,
  ui: heUi,
  project: heProject,
  plan: hePlan,
  sketch: heSketch,
  frame: heFrame,
};
