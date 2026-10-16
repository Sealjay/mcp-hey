/**
 * Cache module exports.
 */

export {
  closeDatabase,
  getDatabase,
  resetDatabase,
  runMaintenance,
  unixNow,
} from "./db"

export {
  type CachedResult,
  type CacheMetadata,
  cacheEmailDetail,
  cacheFolderHtml,
  cacheMessages,
  cacheSearchResults,
  getCachedEmailDetail,
  getCachedFolderHtml,
  getCachedMessages,
  getCachedSearch,
  getCacheStats,
  invalidateForAction,
  needsRefresh,
  updateReadStatus,
} from "./messages"
export { TTL_CONFIG } from "./schema"
export { ftsSearch, getMessageCount, getUnreadCount } from "./search"
