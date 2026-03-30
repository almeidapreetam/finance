function GETMF(schemeCode, field) {
  try {
    const url = "https://api.mfapi.in/mf/" + schemeCode + "/latest";
    const response = UrlFetchApp.fetch(url);
    const json = JSON.parse(response.getContentText());
    
    field = field.toLowerCase();
    
    if (field === "nav") return parseFloat(json.data[0].nav);
    if (field === "date") return json.data[0].date;
    if (field === "name") return json.meta.scheme_name;
    if (field === "house") return json.meta.fund_house;
    if (field === "category") return json.meta.scheme_category;
    
    return "Invalid Field";
  } catch (e) {
    return "Error: Check Scheme Code";
  }
}

function doGet() {
  // --- CONFIGURATION ---
  const VERSION = "1.24"; // Hardcoded version number
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheet = ss.getSheetByName("Ledger");
  const liveSheet = ss.getSheetByName("stockLive");
  const watchlistSheet = ss.getSheetByName("WatchList");
  
  if (!ledgerSheet || !liveSheet) {
    return ContentService.createTextOutput(JSON.stringify({
      version: VERSION,
      error: "Required sheets (Ledger or stockLive) not found"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Added ETF to the holdings object
  const holdings = { Stock: {}, MF: {}, ETF: {} };
  const transactions = [];

  // 1. Process Ledger
  const ledgerData = ledgerSheet.getDataRange().getValues();
  ledgerData.shift(); // Remove headers
  
  ledgerData.forEach(row => {
    const date = row[0];
    const type = row[1]; // Expected to be "Stock", "MF", or "ETF"
    const symbol = row[2];
    const name = row[3];
    const action = row[4];
    const units = parseFloat(row[5]) || 0;
    const amount = parseFloat(row[7]) || 0;

    if (date && action) {
      transactions.push({
        date: date,
        action: action,
        amount: amount
      });
    }

    if (!holdings[type]) return;
    if (!holdings[type][symbol]) {
      holdings[type][symbol] = { name: name, units: 0, invested: 0 };
    }

    if (action === "BUY") {
      holdings[type][symbol].units += units;
      holdings[type][symbol].invested += amount;
    } else if (action === "SELL") {
      const ratio = units / (holdings[type][symbol].units || 1);
      holdings[type][symbol].invested -= (holdings[type][symbol].invested * ratio);
      holdings[type][symbol].units -= units;
    }
  });

  // 2. Map Stock and ETF Data from stockLive
  const liveData = liveSheet.getDataRange().getValues();
  const headers = liveData[0]; 
  const colMap = {};
  headers.forEach((header, index) => colMap[header.toLowerCase()] = index);

  for (let i = 1; i < liveData.length; i++) {
    const row = liveData[i];
    const symbol = row[0];
    
    // Check both Stock and ETF categories for the symbol
    const typesToUpdate = ['Stock', 'ETF'];
    
    typesToUpdate.forEach(assetType => {
      if (holdings[assetType][symbol]) {
        const s = holdings[assetType][symbol];
        s.livePrice = parseFloat(row[colMap['price']]) || 0;
        s.marketCap = row[colMap['marketcap']] || 0;
        s.pe = parseFloat(row[colMap['pe']]) || 0;
        s.changePct = parseFloat(row[colMap['changepct']]) || 0;
        s.high52 = parseFloat(row[colMap['high52']]) || 0;
        s.low52 = parseFloat(row[colMap['low52']]) || 0;
        
        s.currentValue = s.livePrice * s.units;
        s.pnl = s.currentValue - s.invested;
        s.pnlPct = s.invested > 0 ? (s.pnl / s.invested) * 100 : 0;
      }
    });
  }

  // 3. Process Mutual Funds
  const mfSymbols = Object.keys(holdings.MF);
  mfSymbols.forEach(code => {
    const m = holdings.MF[code];
    try {
      const res = UrlFetchApp.fetch(`https://api.mfapi.in/mf/${code}/latest`);
      const json = JSON.parse(res.getContentText());
      m.livePrice = parseFloat(json.data[0].nav) || 0;
      m.currentValue = m.livePrice * m.units;
      m.pnl = m.currentValue - m.invested;
      m.pnlPct = m.invested > 0 ? (m.pnl / m.invested) * 100 : 0;
    } catch(e) {
      m.livePrice = 0;
    }
  });

  const watchlist = getWatchlist(watchlistSheet);
  // Final combined response
  const finalOutput = {
    version: VERSION,
    Stock: holdings.Stock,
    ETF: holdings.ETF, // ETF added to the final output
    MF: holdings.MF,
    Transactions: transactions,
    Watchlist: watchlist
  };

  return ContentService.createTextOutput(JSON.stringify(finalOutput))
    .setMimeType(ContentService.MimeType.JSON);
}

function getWatchlist(sheet) {
  if (!sheet) {
    return {};
  }
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return {};
  }
  const headers = data.shift();
  const colMap = {};
  headers.forEach((header, index) => colMap[header.toLowerCase()] = index);

  if (typeof colMap['symbol'] === 'undefined') {
      // return array of objects
      return data.map(row => {
          const rowData = {};
          headers.forEach((h, i) => rowData[h.toLowerCase()] = row[i]);
          return rowData;
      });
  }

  const watchlist = {};
  data.forEach(row => {
    const symbol = row[colMap['symbol']];
    if (symbol) {
      const item = {};
      for (const header in colMap) {
        item[header] = row[colMap[header]];
      }
      watchlist[symbol] = item;
    }
  });
  return watchlist;
}