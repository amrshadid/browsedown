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
export {
  markTree,
  renderIndexBody,
  renderMissingBody,
  renderPage,
  renderTreeList,
  type OutlineEntry,
  type PageOptions,
} from './pages';
export { resolveLink, type LinkTarget } from './links';
export {
  entryUrl,
  fileUrl,
  indexUrl,
  missingUrl,
  parseRoute,
  type AssetName,
  type MissingReason,
  type Route,
} from './routes';
export {
  applyDiscovery,
  findRootReadme,
  SessionStore,
  type Discovery,
  type DiscoveryResult,
  type Session,
} from './sessions';
export { ancestorFolders, buildTree, type TreeFile, type TreeFolder, type TreeNode } from './tree';
