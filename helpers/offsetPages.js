/**
 * Read numeric-offset pages with a small overlap. A common order ID between
 * adjacent responses confirms that their boundary has not been skipped while
 * open orders are being added or removed. This assumes the exchange preserves
 * the relative order of orders that remain open.
 *
 * @template T
 * @param {(offset: number) => Promise<T[] | undefined | null>} fetchPage
 * @param {object} options
 * @param {number} options.limit Maximum orders returned by one request
 * @param {number} [options.overlap=10] Number of orders repeated at each boundary
 * @param {(item: T) => string | number} options.idOf Stable order ID
 * @param {{ warn?: (message: string) => void }} [options.logger]
 * @param {string} [options.label]
 * @param {number} [options.maxRequests=10] Total request budget, including repairs
 * @param {number} [options.maxRepairs=2] Maximum boundary repairs
 * @returns {Promise<T[] | undefined>}
 */
async function collectOffsetPages(fetchPage, options) {
  const {
    limit,
    overlap = 10,
    idOf,
    logger,
    label = '',
    maxRequests = 10,
    maxRepairs = 2,
  } = options;

  if (!Number.isInteger(limit) || limit < 1 ||
      !Number.isInteger(overlap) || overlap < 1 || overlap >= limit ||
      !Number.isInteger(maxRequests) || maxRequests < 1 ||
      !Number.isInteger(maxRepairs) || maxRepairs < 0) {
    throw new TypeError('collectOffsetPages requires a positive limit and request budget, with overlap smaller than limit');
  }

  const prefix = label ? `${label}: ` : '';
  /** @type {Map<string, T>} */
  const byId = new Map();
  /** @type {Set<string> | undefined} */
  let previousIds;
  let offset = 0;
  let repairs = 0;

  for (let request = 0; request < maxRequests; request++) {
    const batch = await fetchPage(offset);
    const ids = readPageIds(batch, limit, idOf);

    if (!ids) {
      logger?.warn?.(`${prefix}Invalid or failed open-order page at offset ${offset}. Discarding the list.`);
      return undefined;
    }

    if (previousIds && !ids.some((id) => previousIds.has(id))) {
      if (offset === 0 || repairs >= maxRepairs) {
        logger?.warn?.(`${prefix}Open-order pages no longer overlap at offset ${offset}. Discarding the list.`);
        return undefined;
      }

      // A deletion ahead of the offset may have moved the previous page's tail
      // behind it. Re-read a little earlier to find a shared boundary.
      offset = Math.max(0, offset - overlap * (repairs + 2));
      repairs++;
      continue;
    }

    batch.forEach((item, index) => byId.set(ids[index], item));

    if (batch.length < limit) return [...byId.values()];

    previousIds = new Set(ids);
    offset += limit - overlap;
  }

  logger?.warn?.(`${prefix}Open-order pagination exceeded ${maxRequests} requests. Discarding the partial list.`);
  return undefined;
}

/**
 * Read numbered pages with an overlap. A numbered API starts page N at
 * (N - 1) * pageSize, so gradually reducing pageSize creates an overlap while
 * still requiring only one walk. A missing shared ID invalidates the list.
 *
 * @template T
 * @param {(page: number, pageSize: number) => Promise<T[] | { orders: T[], totalPages: number } | undefined | null>} fetchPage
 * @param {object} options
 * @param {number} options.limit Maximum orders returned by one request
 * @param {number} [options.overlap=10] Minimum orders repeated at each boundary
 * @param {(item: T) => string | number} options.idOf Stable order ID
 * @param {boolean} [options.requiresTotalPages=false] Require a reported page count
 * @param {{ warn?: (message: string) => void }} [options.logger]
 * @param {string} [options.label]
 * @param {number} [options.maxRequests=10] Total request budget, including repairs
 * @param {number} [options.maxRepairs=2] Maximum boundary repairs
 * @returns {Promise<T[] | undefined>}
 */
async function collectNumberedPages(fetchPage, options) {
  const {
    limit,
    overlap = 10,
    idOf,
    requiresTotalPages = false,
    logger,
    label = '',
    maxRequests = 10,
    maxRepairs = 2,
  } = options;

  if (!Number.isInteger(limit) || limit < 1 ||
      !Number.isInteger(overlap) || overlap < 1 || overlap >= limit ||
      !Number.isInteger(maxRequests) || maxRequests < 1 ||
      !Number.isInteger(maxRepairs) || maxRepairs < 0) {
    throw new TypeError('collectNumberedPages requires a positive limit and request budget, with overlap smaller than limit');
  }

  const prefix = label ? `${label}: ` : '';
  /** @type {Map<string, T>} */
  const byId = new Map();
  /** @type {Set<string> | undefined} */
  let previousIds;
  let page = 1;
  let pageSize = limit;
  let repairs = 0;

  for (let request = 0; request < maxRequests; request++) {
    const response = await fetchPage(page, pageSize);
    const batch = Array.isArray(response) ? response : response?.orders;
    const ids = readPageIds(batch, pageSize, idOf);
    const totalPages = Array.isArray(response) ? undefined : response?.totalPages;

    if (!ids || (requiresTotalPages && !Number.isInteger(totalPages)) ||
        (totalPages !== undefined && (!Number.isInteger(totalPages) || totalPages < 0 ||
          page > Math.max(1, totalPages)))) {
      logger?.warn?.(`${prefix}Invalid or failed open-order page ${page}. Discarding the list.`);
      return undefined;
    }

    if (previousIds && !ids.some((id) => previousIds.has(id))) {
      if (repairs >= maxRepairs) {
        logger?.warn?.(`${prefix}Open-order pages no longer overlap at page ${page}. Discarding the list.`);
        return undefined;
      }

      // Reducing pageSize moves the start of page N back by N - 1 rows.
      pageSize -= Math.ceil(overlap * (repairs + 2) / (page - 1));
      if (pageSize < 1) {
        logger?.warn?.(`${prefix}Unable to repair open-order page ${page}. Discarding the list.`);
        return undefined;
      }

      repairs++;
      continue;
    }

    batch.forEach((item, index) => byId.set(ids[index], item));

    if (totalPages !== undefined && ((totalPages === 0 && batch.length !== 0) ||
        (page < totalPages && batch.length !== pageSize))) {
      logger?.warn?.(`${prefix}Open-order page ${page} disagrees with the reported page count. Discarding the list.`);
      return undefined;
    }

    if (batch.length < pageSize || (totalPages !== undefined && page >= totalPages)) {
      return [...byId.values()];
    }

    previousIds = new Set(ids);
    const nextPage = page + 1;
    const endOffset = (page - 1) * pageSize + pageSize;
    pageSize = Math.min(limit, Math.floor((endOffset - overlap) / (nextPage - 1)));
    page = nextPage;

    if (pageSize < 1) {
      logger?.warn?.(`${prefix}Unable to continue open-order pagination after page ${page - 1}. Discarding the list.`);
      return undefined;
    }
  }

  logger?.warn?.(`${prefix}Open-order pagination exceeded ${maxRequests} requests. Discarding the partial list.`);
  return undefined;
}

/**
 * @template T
 * @param {T[] | undefined | null} batch
 * @param {number} limit
 * @param {(item: T) => string | number} idOf
 * @returns {string[] | undefined}
 */
function readPageIds(batch, limit, idOf) {
  if (!Array.isArray(batch) || batch.length > limit) return undefined;

  const ids = [];
  const seen = new Set();

  for (const item of batch) {
    let rawId;

    try {
      rawId = idOf(item);
    } catch {
      return undefined;
    }

    if ((typeof rawId !== 'string' && typeof rawId !== 'number') ||
        (typeof rawId === 'number' && !Number.isFinite(rawId)) || String(rawId).trim() === '') {
      return undefined;
    }

    const id = String(rawId);

    if (seen.has(id)) return undefined;

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

module.exports = {
  collectOffsetPages,
  collectNumberedPages,
};
