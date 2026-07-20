/**
 * Geo catalog exports. The <GeoMapEditor> MapLibre component was retired in
 * the maps-next-gen pass (replaced everywhere by <UsChoropleth>); only the
 * shared us-atlas geometry catalog lives on here.
 */
export {
  getStateOutline,
  getCountiesInState,
  getCountyByGeoid,
  loadGeoCatalog,
  STATE_FIPS_TO_USPS,
  STATE_USPS_TO_FIPS,
} from "./geoCatalog";
export type {
  GeoStateFeature,
  GeoCountyFeature,
} from "./geoCatalog";
