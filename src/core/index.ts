// Public entry of the pure core library, shared by the app and the MCP bundle.
// Compiled by tsconfig.core.json with no DOM and no Node types, so impure code cannot slip in.
export * from './types';
export { CoreError, toOpError } from './errors';
export { generateId, isValidId, isValidTempId, seededRng, type IdPrefix, type Rng } from './ids';
export {
  deriveName,
  normalizeDoc,
  normalizeNode,
  normalizeTokens,
  type LooseDoc,
  type LooseNode,
} from './normalize';
export {
  DEFAULT_TOKENS,
  findTokenIssues,
  isOnSpacingScale,
  isTokenRef,
  nearestSpacing,
  parseTokenRef,
  resolveColor,
  resolveFont,
  resolveRadius,
  type TokenGroup,
  type TokenIssue,
  type TokenRef,
} from './tokens';
export {
  isValidColor,
  isValidHref,
  propIssues,
  validateDoc,
  type Issue,
  type ValidationResult,
} from './validate';
export {
  ancestorIds,
  descendantIds,
  getArtboards,
  getRoot,
  isEffectivelyLocked,
  isInSubtree,
} from './tree';
export {
  createNode,
  deleteNode,
  duplicateNode,
  LIMITS,
  moveNode,
  updateNode,
  type CreateResult,
} from './ops';
export { applyChanges, type ApplyOptions } from './apply';
export {
  cssPropertyName,
  cssToString,
  fontStack,
  GLOBAL_RESET_CSS,
  nodeToCss,
  type CssRecord,
} from './style';
export {
  getOutline,
  type Outline,
  type OutlineDetail,
  type OutlineNode,
  type OutlineOptions,
} from './outline';
export { migrate, MIGRATIONS, type Migration, type MigrateResult } from './migrate';
export {
  bumpRev,
  createEmptyDoc,
  loadDoc,
  serializeDoc,
  type CreateDocOptions,
  type LoadResult,
} from './doc';
export { createMemoryContext, type MemoryContext } from './memory-context';
export {
  findTool,
  getToolDefinitions,
  runTool,
  TOOLS,
  ToolFailure,
  type Tool,
  type ToolDefinition,
  type ToolError,
  type ToolResult,
} from './tools';
