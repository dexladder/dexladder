/* Phase-1 architecture mount (web/app → DLAPP). Runs after every legacy script and layer has
   defined and wrapped nav(), so the navigation presenter sees the final router. */
(function () { try { window.DLAPP && DLAPP.nav.install(); } catch (e) {} })();
/* The Blog's command-palette entries (DLCORE is defined by now). */
(function () { try { window.DLAPP && DLAPP.legacy.blog.install(); } catch (e) {} })();
