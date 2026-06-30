// xlsx-js-style is a styling-enabled fork of SheetJS with the same runtime API
// but no bundled type declarations. We only consume it through the typed `xlsx`
// surface (utils/write) plus a loose per-cell `.s` style, so a minimal ambient
// declaration is enough.
declare module "xlsx-js-style";
