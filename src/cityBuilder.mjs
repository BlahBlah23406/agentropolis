// Compat facade — the shim at ~/.openclaw/city_builder/cityBuilder.mjs and
// older imports expect resolveRegistry()/loadAssets() here. The real logic
// lives in citySchema.mjs (mergeCity keeps the no-orphan guarantee).
import { loadRegistry, loadCityConfig, mergeCity, loadAssets } from './citySchema.mjs';

export { loadAssets };
export * from './citySchema.mjs';

// The merged registry the server should serve: system capabilities
// (departments.json, the wire protocol) skinned by the user's city.
export function resolveRegistry() {
  return mergeCity(loadRegistry(), loadCityConfig());
}
