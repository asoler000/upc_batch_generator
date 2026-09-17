LifeWorks UPC Tool - Master List Persistence Fix

Changes made:
1. Clear Export List now clears only the current savedRows batch and explicitly confirms that the Master UPC List is retained.
2. Master-list deletion remains isolated to the Delete Master List action, with a clearer destructive confirmation.
3. IndexedDB initialization restores masterRows and savedRows independently, so a failure reading one no longer automatically discards the other.
4. The lookup status no longer tells the user to upload the master CSV when a master is already loaded.
5. Removed the genspark sandbox inspection script from index.html when present.

Expected workflow:
Upload master CSV once -> paste models -> generate -> Clear Export List -> paste next batch -> generate.
The master list remains stored in this browser until Delete Master List is deliberately used.

Note:
IndexedDB storage is browser/origin-specific. Clearing site/browser data, using a different browser/device/profile, or private browsing can remove or isolate the saved master.
