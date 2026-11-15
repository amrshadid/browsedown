/** Public surface of the pure core. Adapters import from here only. */
export {
  isSupportedEnvironment,
  UNSUPPORTED_ENVIRONMENT_MESSAGE,
  type HostEnvironment,
} from './environment';
export {
  checkDecodedPath,
  checkScopedPath,
  type PathFlavor,
  type ScopeCheck,
  type ScopedPath,
  type ScopeRejection,
} from './scope';
