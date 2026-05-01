/**
 * One-time cleanup: re-sort each known tab so the newest row is at the
 * top, descending by the tab's primary timestamp column.
 *
 * Run after deploying the backend "insert-at-top" change to bring all
 * existing data into the same order. Idempotent — re-running is safe;
 * already-sorted tabs are no-ops.
 *
 * How to run
 * ----------
 * 1. Open the Mountaineer crew-logs spreadsheet.
 * 2. Extensions → Apps Script.
 * 3. Paste this file's contents into a new script (or replace existing).
 * 4. Save (disk icon).
 * 5. Select function `reorderAllSheetsNewestFirst` in the toolbar.
 * 6. Run. First run will prompt for spreadsheet permissions — accept.
 * 7. Watch the execution log (View → Logs) for one line per tab.
 *
 * Sort-only — never rewrites cell values, never inserts/deletes rows.
 */

function reorderAllSheetsNewestFirst() {
  // tab name -> primary sort column (header text in row 1)
  // Both prod and Staging variants are listed; missing tabs are skipped.
  var TABS = {
    "Events":              "timestamp",
    "EventsStaging":       "timestamp",
    "Materials":           "created_at",
    "MaterialsStaging":    "created_at",
    "JobReports":          "updated_at",
    "JobReportsStaging":   "updated_at",
    "Bills":               "updated_at",
    "BillsStaging":        "updated_at",
    "DVIRs":               "created_at",
    "DVIRsStaging":        "created_at",
    "PriorOnDuty":         "created_at",
    "PriorOnDutyStaging":  "created_at",
    "RODS":                "created_at",
    "RODSStaging":         "created_at",
    "Estimates":           "updated_at",
    "EstimatesStaging":    "updated_at",
    "EstimateItems":       "exported_at",
    "EstimateItemsStaging":"exported_at",
  };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var totalSorted = 0;
  var totalSkipped = 0;

  Object.keys(TABS).forEach(function (tabName) {
    var sortHeader = TABS[tabName];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      Logger.log("skip '" + tabName + "' — tab not found");
      totalSkipped++;
      return;
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) {
      Logger.log("skip '" + tabName + "' — header only or empty");
      totalSkipped++;
      return;
    }

    var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var colIndex = headerRow.indexOf(sortHeader);
    if (colIndex === -1) {
      Logger.log("skip '" + tabName + "' — header '" + sortHeader + "' not found");
      totalSkipped++;
      return;
    }

    // Sort the data rows (everything below the frozen header) descending by
    // the chosen column. Apps Script's Range.sort uses 1-based column index.
    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    dataRange.sort({ column: colIndex + 1, ascending: false });
    Logger.log(
      "sorted '" + tabName + "' by " + sortHeader + " desc — " +
      (lastRow - 1) + " row(s)"
    );
    totalSorted++;
  });

  Logger.log("done — " + totalSorted + " tab(s) sorted, " + totalSkipped + " skipped");
}
