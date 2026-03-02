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
  type CacheMetadata,
  type CachedResult,
  cacheEmailDetail,
  cacheFolderHtml,
  cacheMessages,
  cacheSearchResults,
  getCacheStats,
  getCachedEmailDetail,
  getCachedFolderHtml,
  getCachedMessages,
  getCachedSearch,
  invalidateForAction,
  needsRefresh,
  updateReadStatus,
} from "./messages"

export {
  ftsSearch,
  getMessageCount,
  getUnreadCount,
  searchBySender,
  searchBySubject,
} from "./search"

export { TTL_CONFIG } from "./schema"
