/**
 * Maintenance uses the normal document and storage origin without starting application owners.
 *
 * Call stack:
 * index.html
 *   -> startup.main
 *     -> backup.main (maintenance)
 *     -> main (normal application)
 */
if (new URLSearchParams(location.search).get('wow-backup') === '1')
  void import('./backup.main')
else
  void import('./main')
