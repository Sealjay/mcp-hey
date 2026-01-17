/**
 * Cache module exports.
 */

export {
  closeDatabase,
  getDatabase,
  runMaintenance,
  unixNow,
} from "./db"

export {
  type CacheMetadata,
  type CachedResult,
  cacheEmailDetail,
  cacheMessages,
  cacheSearchResults,
  getCacheStats,
  getCachedEmailDetail,
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
